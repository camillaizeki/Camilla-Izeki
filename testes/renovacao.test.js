// Renovação automática no cartão (assinatura do Mercado Pago com pagamento autorizado), com o Mercado Pago simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoFalso } from './banco-falso.js';
import { atenderApi } from '../src/api.js';
import { esquecerBanco } from '../lib/banco.js';
import { somarMeses } from '../lib/assinatura.js';

const resposta = (dados, status = 200) => new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });

function montarAmbiente({ chavePublica = 'APP_USR-chave-publica' } = {}) {
  const mp = { assinaturas: new Map(), autorizados: new Map(), pagamentos: new Map(), pedidos: [], recusarCartao: false };
  const env = {
    DB: bancoFalso(),
    ADMIN_KEY: 'chave-de-administracao-de-teste-123',
    MP_ACCESS_TOKEN: 'APP_USR-token-de-teste',
    ...(chavePublica && { MP_PUBLIC_KEY: chavePublica }),
    MP_FETCH: async (url, opcoes) => {
      const u = new URL(url);
      const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
      mp.pedidos.push({ metodo: opcoes.method, caminho: u.pathname + u.search, corpo });
      if (u.pathname === '/preapproval' && opcoes.method === 'POST') {
        if (mp.recusarCartao) return resposta({ message: 'Card token invalid', status: 400 }, 400);
        const id = 'pre' + (mp.assinaturas.size + 1);
        const pre = { id, status: 'authorized', external_reference: corpo.external_reference, next_payment_date: '2026-12-01T10:00:00.000-03:00', auto_recurring: corpo.auto_recurring };
        mp.assinaturas.set(id, pre);
        return resposta(pre);
      }
      const pre = u.pathname.match(/^\/preapproval\/(\w+)$/)?.[1];
      if (pre && opcoes.method === 'PUT') {
        Object.assign(mp.assinaturas.get(pre), corpo);
        return resposta(mp.assinaturas.get(pre));
      }
      if (pre) return mp.assinaturas.has(pre) ? resposta(mp.assinaturas.get(pre)) : resposta({}, 404);
      const aut = u.pathname.match(/^\/authorized_payments\/(\d+)$/)?.[1];
      if (aut) return resposta(mp.autorizados.get(aut));
      if (u.pathname === '/authorized_payments/search') {
        return resposta({ results: [...mp.autorizados.values()].filter((a) => a.preapproval_id === u.searchParams.get('preapproval_id')) });
      }
      if (u.pathname === '/v1/payments/search') {
        return resposta({ results: [...mp.pagamentos.values()].filter((p) => p.external_reference === u.searchParams.get('external_reference')) });
      }
      const pag = u.pathname.match(/^\/v1\/payments\/(\d+)$/)?.[1];
      if (pag) return resposta(mp.pagamentos.get(pag));
      return resposta({ message: 'not found' }, 404);
    },
  };
  const cookies = { personal: '', admin: '' };
  async function chamar(caminho, metodo = 'GET', dados, quem = 'personal') {
    const url = 'https://renova.exemplo/api/' + caminho;
    const request = new Request(url, {
      method: metodo,
      headers: { 'content-type': 'application/json', cookie: [cookies.personal, cookies.admin].filter(Boolean).join('; ') },
      body: dados ? JSON.stringify(dados) : undefined,
    });
    const r = await atenderApi(request, env, new URL(url).pathname.slice(5).split('/'));
    const definido = r.headers.get('set-cookie');
    if (definido && quem) cookies[definido.startsWith('admin=') ? 'admin' : 'personal'] = definido.split(';')[0];
    return { status: r.status, corpo: await r.json() };
  }
  const aviso = (tipo, id) => chamar('assinatura/webhook', 'POST', { type: tipo, data: { id: String(id) } }, null);
  const sql = (texto, ...v) => env.DB.sqlite.prepare(texto).run(...v);
  const um = (texto, ...v) => env.DB.sqlite.prepare(texto).get(...v);
  return { env, mp, chamar, aviso, sql, um };
}

test('sem a chave pública, a renovação automática fica indisponível', async () => {
  esquecerBanco();
  const { chamar } = montarAmbiente({ chavePublica: null });
  await chamar('conta/criar', 'POST', { nome: 'Rafa', email: 'rafa@exemplo.com', senha: 'senha-forte-1', slug: 'rafa' });
  const r = await chamar('assinatura');
  assert.equal(r.corpo.recorrenteDisponivel, false);
  assert.equal((await chamar('assinatura/recorrente', 'POST', { plano: 'mensal', token: 'tokendecartao123' })).status, 503);
  esquecerBanco();
});

test('renovação automática: ativa com o cartão do app, cobra a cada período, pausa e cancela', async () => {
  esquecerBanco();
  const { mp, chamar, aviso, sql, um } = montarAmbiente();
  await chamar('conta/criar', 'POST', { nome: 'Bia Souza', email: 'bia@exemplo.com', senha: 'senha-forte-1', slug: 'bia' });
  const conta = um('SELECT id FROM personais WHERE slug = ?', 'bia');
  sql("UPDATE personais SET acesso_ate = '2020-01-01T00:00:00.000Z' WHERE id = ?", conta.id);
  assert.equal((await chamar('painel')).status, 402);

  let r = await chamar('assinatura');
  assert.equal(r.corpo.recorrenteDisponivel, true);
  assert.equal(r.corpo.chavePublica, 'APP_USR-chave-publica');
  assert.equal(r.corpo.email, 'bia@exemplo.com');
  assert.equal(r.corpo.recorrente, null);

  // Token inválido é barrado antes de falar com o Mercado Pago
  assert.equal((await chamar('assinatura/recorrente', 'POST', { plano: 'semestral', token: 'x' })).status, 400);

  // Cartão recusado pelo Mercado Pago: mensagem clara e nada liberado
  mp.recusarCartao = true;
  r = await chamar('assinatura/recorrente', 'POST', { plano: 'semestral', token: 'tokendecartao123' });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /cartão não foi aceito/);
  assert.equal(um('SELECT status FROM assinaturas_recorrentes ORDER BY id DESC').status, 'recusada');
  assert.equal((await chamar('painel')).status, 402);
  mp.recusarCartao = false;

  // Semestral com renovação: R$ 119,90 a cada 6 meses, cartão como token, sem página do Mercado Pago
  r = await chamar('assinatura/recorrente', 'POST', { plano: 'semestral', token: 'tokendecartao123' });
  assert.equal(r.status, 200);
  const pedido = mp.pedidos.filter((x) => x.caminho === '/preapproval' && x.metodo === 'POST').at(-1).corpo;
  assert.deepEqual(pedido.auto_recurring, { frequency: 6, frequency_type: 'months', transaction_amount: 119.9, currency_id: 'BRL' });
  assert.equal(pedido.card_token_id, 'tokendecartao123');
  assert.equal(pedido.status, 'authorized');
  assert.equal(pedido.payer_email, 'bia@exemplo.com');
  const recId = r.corpo.recorrente.id;
  assert.equal(pedido.external_reference, 'rec-' + recId);
  assert.equal(r.corpo.recorrente.status, 'ativa');
  assert.equal(r.corpo.recorrente.proximaCobranca, '2026-12-01T10:00:00.000-03:00');
  // Enquanto a primeira cobrança não sai (até 1 hora), o painel libera por 1 dia
  assert.equal(r.corpo.assinatura.liberado, true);
  assert.equal((await chamar('painel')).status, 200);

  // Não dá para ter duas renovações ao mesmo tempo
  assert.equal((await chamar('assinatura/recorrente', 'POST', { plano: 'mensal', token: 'tokendecartao123' })).status, 400);

  // Primeira cobrança aprovada (aviso de pagamento autorizado): soma 6 meses, uma vez só
  const antes = um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate;
  mp.autorizados.set('8001', { id: 8001, preapproval_id: 'pre1', transaction_amount: 119.9, payment: { id: 9001, status: 'approved' } });
  assert.equal((await aviso('subscription_authorized_payment', 8001)).status, 200);
  await aviso('subscription_authorized_payment', 8001);
  // O mesmo pagamento também chega como aviso "payment", com a referência da assinatura
  mp.pagamentos.set('9001', { id: 9001, status: 'approved', external_reference: 'rec-' + recId, transaction_amount: 119.9, currency_id: 'BRL' });
  await aviso('payment', 9001);
  const cobrancas = () => um("SELECT COUNT(*) AS n FROM assinatura_pagamentos WHERE metodo = 'recorrente' AND status = 'aprovado'").n;
  assert.equal(cobrancas(), 1);
  const depois1 = um('SELECT plano, acesso_ate FROM personais WHERE id = ?', conta.id);
  assert.equal(depois1.plano, 'semestral');
  assert.equal(depois1.acesso_ate, somarMeses(antes, 6));

  // Seis meses depois, a segunda cobrança chega só como aviso "payment"
  mp.pagamentos.set('9002', { id: 9002, status: 'approved', external_reference: 'rec-' + recId, transaction_amount: 119.9, currency_id: 'BRL' });
  await aviso('payment', 9002);
  assert.equal(cobrancas(), 2);
  assert.equal(um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate, somarMeses(depois1.acesso_ate, 6));

  // Cobrança recusada fica registrada e não libera nada
  const acessoAtual = um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate;
  mp.autorizados.set('8003', { id: 8003, preapproval_id: 'pre1', transaction_amount: 119.9, payment: { id: 9003, status: 'rejected' } });
  await aviso('subscription_authorized_payment', 8003);
  assert.equal(um("SELECT status FROM assinatura_pagamentos WHERE mp_pagamento = '9003'").status, 'recusado');
  assert.equal(um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate, acessoAtual);

  // O Mercado Pago pausa a assinatura depois das falhas
  mp.assinaturas.get('pre1').status = 'paused';
  await aviso('subscription_preapproval', 'pre1');
  r = await chamar('assinatura');
  assert.equal(r.corpo.recorrente.status, 'pausada');

  // Administração: resumo e ficha mostram a renovação
  await chamar('admin/entrar', 'POST', { chave: 'chave-de-administracao-de-teste-123' }, 'admin');
  r = await chamar('admin/resumo', 'GET', undefined, 'admin');
  assert.equal(r.corpo.receita.porMetodo.recorrente, 11990 * 2);
  assert.equal(r.corpo.assinantes.porPlano.semestral, 1);
  assert.equal(r.corpo.mrr, Math.round(11990 / 6));
  r = await chamar('admin/usuarios', 'GET', undefined, 'admin');
  assert.equal(r.corpo.usuarios[0].renovacao, 'pausada');
  r = await chamar('admin/pagamentos', 'GET', undefined, 'admin');
  assert.equal(r.corpo.pagamentos.filter((g) => g.metodo === 'recorrente').length, 3);

  // A administração confere de novo no Mercado Pago (volta a ativa)
  mp.assinaturas.get('pre1').status = 'authorized';
  r = await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'conferirRenovacao' }, 'admin');
  assert.equal(r.corpo.usuario.renovacao, 'ativa');

  // O personal cancela: o Mercado Pago recebe o cancelamento e o acesso pago continua
  const acessoFinal = um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate;
  r = await chamar('assinatura/recorrente/cancelar', 'POST', {});
  assert.equal(r.status, 200);
  assert.equal(mp.assinaturas.get('pre1').status, 'cancelled');
  assert.equal(um('SELECT status FROM assinaturas_recorrentes WHERE id = ?', recId).status, 'cancelada');
  assert.equal(um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate, acessoFinal);
  assert.equal((await chamar('assinatura/recorrente/cancelar', 'POST', {})).status, 400);
  assert.equal((await chamar('painel')).status, 200);

  // Pode ativar de novo depois; a administração também consegue cancelar
  r = await chamar('assinatura/recorrente', 'POST', { plano: 'mensal', token: 'tokendecartao456' });
  assert.equal(r.status, 200);
  assert.equal(mp.pedidos.filter((x) => x.caminho === '/preapproval' && x.metodo === 'POST').at(-1).corpo.auto_recurring.transaction_amount, 24.9);
  r = await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'cancelarRenovacao' }, 'admin');
  assert.equal(r.corpo.usuario.renovacao, null);
  esquecerBanco();
});

