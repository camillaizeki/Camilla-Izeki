// Assinatura do personal: teste grátis, trava, pagamento pelo Mercado Pago (simulado) e administração.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoFalso } from './banco-falso.js';
import { atenderApi } from '../src/api.js';
import { esquecerBanco } from '../lib/banco.js';
import {
  CONFIG_PADRAO, valorCobrado, tabelaPlanos, estenderAcesso, somarMeses, situacaoDoAcesso, diasRestantes, validarConfig,
} from '../lib/assinatura.js';
import { montarPreferencia, avisoAutentico } from '../lib/mercadopago.js';

test('preços: Pix com 5% de desconto, anual parcelado e economia do anual', () => {
  assert.equal(valorCobrado(CONFIG_PADRAO, 'mensal', 'cartao'), 2490);
  assert.equal(valorCobrado(CONFIG_PADRAO, 'mensal', 'pix'), 2366);
  assert.equal(valorCobrado(CONFIG_PADRAO, 'anual', 'cartao'), 19900);
  assert.equal(valorCobrado(CONFIG_PADRAO, 'anual', 'pix'), 18905);
  const t = tabelaPlanos(CONFIG_PADRAO);
  assert.equal(t.anual.parcelas, 12);
  assert.equal(t.mensal.parcelas, 1);
  assert.equal(t.anual.economia, 2490 * 12 - 19900);
  assert.throws(() => validarConfig({ ...CONFIG_PADRAO, descontoPix: 80 }));
});

test('acesso: dias que sobram continuam valendo e meses curtos são respeitados', () => {
  const agora = new Date('2026-11-17T12:00:00Z');
  assert.equal(estenderAcesso('2026-11-20T12:00:00.000Z', 'mensal', agora), '2026-12-20T12:00:00.000Z');
  assert.equal(estenderAcesso('2026-11-01T00:00:00.000Z', 'mensal', agora), '2026-12-17T12:00:00.000Z'); // vencido: conta de hoje
  assert.equal(estenderAcesso(null, 'anual', agora), '2027-11-17T12:00:00.000Z');
  assert.equal(somarMeses('2027-01-31T10:00:00.000Z', 1), '2027-02-28T10:00:00.000Z');
  assert.equal(situacaoDoAcesso({ plano: 'teste', acesso_ate: '2026-11-18T00:00:00Z' }, agora), 'teste');
  assert.equal(situacaoDoAcesso({ plano: 'teste', acesso_ate: '2026-11-17T00:00:00Z' }, agora), 'teste_encerrado');
  assert.equal(situacaoDoAcesso({ plano: 'mensal', acesso_ate: '2026-11-17T00:00:00Z' }, agora), 'vencida');
  assert.equal(situacaoDoAcesso({ plano: 'mensal', acesso_ate: '2026-11-17T00:00:00Z', cortesia: 1 }, agora), 'cortesia');
  assert.equal(situacaoDoAcesso({ plano: 'anual', acesso_ate: '2027-11-17T00:00:00Z', bloqueado: 1 }, agora), 'bloqueada');
  assert.equal(diasRestantes('2026-11-24T12:00:00Z', agora), 7);
});

test('checkout: Pix só aceita Pix; cartão parcela só no anual', () => {
  const personal = { id: 1, email: 'rafa@exemplo.com', nome: 'Rafa' };
  const pix = montarPreferencia({ registro: { id: 9, plano: 'anual', metodo: 'pix', valor: 18905 }, personal, origem: 'https://app.exemplo', parcelasMax: 12 });
  assert.equal(pix.items[0].unit_price, 189.05);
  assert.ok(pix.payment_methods.excluded_payment_types.some((t) => t.id === 'credit_card'));
  assert.equal(pix.external_reference, '9');
  assert.equal(pix.notification_url, 'https://app.exemplo/api/assinatura/webhook');
  const anual = montarPreferencia({ registro: { id: 10, plano: 'anual', metodo: 'cartao', valor: 19900 }, personal, origem: 'https://app.exemplo', parcelasMax: 12 });
  assert.equal(anual.payment_methods.installments, 12);
  assert.ok(anual.payment_methods.excluded_payment_types.some((t) => t.id === 'bank_transfer'));
  const mensal = montarPreferencia({ registro: { id: 11, plano: 'mensal', metodo: 'cartao', valor: 2490 }, personal, origem: 'http://localhost:8788', parcelasMax: 12 });
  assert.equal(mensal.payment_methods.installments, 1);
  assert.equal(mensal.notification_url, undefined); // sem https não há aviso
});

test('aviso do Mercado Pago com assinatura x-signature', async () => {
  const env = { MP_WEBHOOK_SECRET: 'segredo-de-teste' };
  const texto = 'id:123;request-id:abc;ts:1700000000;';
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MP_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const v1 = Buffer.from(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto))).toString('hex');
  const pedido = (assinatura) => new Request('https://x/api/assinatura/webhook?data.id=123', { method: 'POST', headers: { 'x-signature': assinatura, 'x-request-id': 'abc' } });
  assert.equal(await avisoAutentico(env, pedido(`ts=1700000000,v1=${v1}`), '123'), true);
  assert.equal(await avisoAutentico(env, pedido('ts=1700000000,v1=00'), '123'), false);
  assert.equal(await avisoAutentico({}, pedido(''), '123'), true); // sem segredo configurado, não confere
});

// ---------- De ponta a ponta, com o Mercado Pago simulado ----------

const pagamentosMP = new Map(); // id -> pagamento do Mercado Pago
const preferencias = [];
const pixCriados = [];
const resposta = (dados, status = 200) => new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });

const env = {
  DB: bancoFalso(),
  ADMIN_KEY: 'chave-de-administracao-de-teste-123',
  MP_ACCESS_TOKEN: 'APP_USR-token-de-teste',
  MP_FETCH: async (url, opcoes) => {
    const u = new URL(url);
    assert.equal(opcoes.headers.authorization, 'Bearer APP_USR-token-de-teste');
    if (u.pathname === '/checkout/preferences') {
      const pref = JSON.parse(opcoes.body);
      preferencias.push(pref);
      return resposta({ id: 'pref-' + pref.external_reference, init_point: 'https://mp.exemplo/checkout/' + pref.external_reference });
    }
    if (u.pathname === '/v1/payments' && opcoes.method === 'POST') {
      const pag = JSON.parse(opcoes.body);
      assert.ok(opcoes.headers['x-idempotency-key'], 'Pix exige chave de idempotência');
      pixCriados.push(pag);
      return resposta({ id: 7000 + pixCriados.length, status: 'pending', date_of_expiration: pag.date_of_expiration,
        point_of_interaction: { transaction_data: { qr_code: '00020126PIXCOPIAECOLA' + pag.external_reference, qr_code_base64: 'iVBORw0KGgo=' } } });
    }
    if (u.pathname === '/v1/payments/search') {
      const ref = u.searchParams.get('external_reference');
      return resposta({ results: [...pagamentosMP.values()].filter((p) => p.external_reference === ref).reverse() });
    }
    const id = u.pathname.match(/^\/v1\/payments\/(\d+)$/)?.[1];
    if (id && pagamentosMP.has(id)) return resposta(pagamentosMP.get(id));
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

const sql = (texto, ...v) => env.DB.sqlite.prepare(texto).run(...v);
const um = (texto, ...v) => env.DB.sqlite.prepare(texto).get(...v);

test('teste grátis de 7 dias, trava, pagamento por Pix e cartão, e administração', async () => {
  esquecerBanco();
  let r = await chamar('conta/criar', 'POST', { nome: 'Rafa Lima', email: 'rafa@exemplo.com', senha: 'senha-forte-1', slug: 'rafa' });
  assert.equal(r.status, 200);
  const conta = um('SELECT id, plano, acesso_ate FROM personais WHERE slug = ?', 'rafa');
  assert.equal(conta.plano, 'teste');
  assert.ok(Math.abs((Date.parse(conta.acesso_ate) - Date.now()) / 86400000 - 7) < 0.01);

  r = await chamar('painel');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.personal.assinatura.situacao, 'teste');
  assert.equal(r.corpo.personal.assinatura.diasRestantes, 7);

  // Passaram os 7 dias: o painel trava, mas dá para ver os planos e pagar
  sql("UPDATE personais SET acesso_ate = '2020-01-01T00:00:00.000Z' WHERE id = ?", conta.id);
  r = await chamar('painel');
  assert.equal(r.status, 402);
  assert.equal(r.corpo.travado, true);
  assert.equal(r.corpo.assinatura.situacao, 'teste_encerrado');
  assert.equal((await chamar('alunos', 'POST', { nome: 'Ana', whatsapp: '62911112222', valor: 20000, diaVenc: 10 })).status, 402);

  r = await chamar('assinatura');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.planos.mensal.pix, 2366);
  assert.equal(r.corpo.configurado, true);

  // Pix do plano mensal, com desconto: o código aparece no app, sem ir para o Mercado Pago
  r = await chamar('assinatura/checkout', 'POST', { plano: 'mensal', metodo: 'pix' });
  assert.equal(r.status, 200);
  const idPix = r.corpo.id;
  assert.equal(r.corpo.url, undefined);
  assert.equal(r.corpo.pix.copiaECola, '00020126PIXCOPIAECOLA' + idPix);
  assert.equal(r.corpo.pix.qrBase64, 'iVBORw0KGgo=');
  assert.equal(r.corpo.valor, 2366);
  assert.equal(pixCriados.at(-1).transaction_amount, 23.66);
  assert.equal(pixCriados.at(-1).payment_method_id, 'pix');
  assert.equal(pixCriados.at(-1).external_reference, String(idPix));
  assert.equal(pixCriados.at(-1).payer.email, 'rafa@exemplo.com');
  assert.match(pixCriados.at(-1).date_of_expiration, /-03:00$/);
  assert.equal(preferencias.length, 0); // nenhuma página do Mercado Pago no Pix

  // Aviso chega antes de pagar (pendente): continua travado
  pagamentosMP.set('5001', { id: 5001, external_reference: String(idPix), status: 'pending', transaction_amount: 23.66, currency_id: 'BRL' });
  assert.equal((await chamar('assinatura/webhook', 'POST', { type: 'payment', data: { id: '5001' } }, null)).status, 200);
  assert.equal(um('SELECT status FROM assinatura_pagamentos WHERE id = ?', idPix).status, 'pendente');
  assert.equal((await chamar('painel')).status, 402);

  // Pix aprovado: libera 1 mês a partir de hoje (o aviso repetido não soma de novo)
  pagamentosMP.set('5001', { ...pagamentosMP.get('5001'), status: 'approved', transaction_details: { total_paid_amount: 23.66 } });
  await chamar('assinatura/webhook', 'POST', { type: 'payment', data: { id: '5001' } }, null);
  const depoisPix = um('SELECT plano, acesso_ate FROM personais WHERE id = ?', conta.id);
  await chamar('assinatura/webhook', 'POST', { type: 'payment', data: { id: '5001' } }, null);
  assert.equal(um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate, depoisPix.acesso_ate);
  assert.equal(depoisPix.plano, 'mensal');
  const diasPix = (Date.parse(depoisPix.acesso_ate) - Date.now()) / 86400000;
  assert.ok(diasPix > 27 && diasPix < 32);
  r = await chamar('painel');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.personal.assinatura.situacao, 'ativa');

  // Anual no cartão em 12x: o comprador paga os juros; o app recebe o valor do plano e soma 12 meses
  r = await chamar('assinatura/checkout', 'POST', { plano: 'anual', metodo: 'cartao' });
  const idCartao = r.corpo.id;
  assert.equal(preferencias.at(-1).payment_methods.installments, 12);
  pagamentosMP.set('5002', { id: 5002, external_reference: String(idCartao), status: 'rejected', transaction_amount: 199, currency_id: 'BRL', installments: 12 });
  pagamentosMP.set('5003', { id: 5003, external_reference: String(idCartao), status: 'approved', transaction_amount: 199, currency_id: 'BRL', installments: 12, transaction_details: { total_paid_amount: 231.4 } });
  r = await chamar('assinatura/verificar', 'POST', { id: idCartao }); // volta do checkout, sem esperar o aviso
  assert.equal(r.corpo.status, 'aprovado');
  const g = um('SELECT valor, valor_pago, parcelas FROM assinatura_pagamentos WHERE id = ?', idCartao);
  assert.deepEqual({ ...g }, { valor: 19900, valor_pago: 23140, parcelas: 12 });
  // Aviso atrasado da tentativa recusada não desfaz a aprovação
  await chamar('assinatura/webhook', 'POST', { type: 'payment', data: { id: '5002' } }, null);
  assert.equal(um('SELECT status FROM assinatura_pagamentos WHERE id = ?', idCartao).status, 'aprovado');
  const anual = um('SELECT plano, acesso_ate FROM personais WHERE id = ?', conta.id);
  assert.equal(anual.plano, 'anual');
  assert.equal(anual.acesso_ate, somarMeses(depoisPix.acesso_ate, 12));

  // Valor pago menor que o cobrado não libera
  r = await chamar('assinatura/checkout', 'POST', { plano: 'mensal', metodo: 'cartao' });
  pagamentosMP.set('5004', { id: 5004, external_reference: String(r.corpo.id), status: 'approved', transaction_amount: 1, currency_id: 'BRL' });
  await chamar('assinatura/webhook', 'POST', { type: 'payment', data: { id: '5004' } }, null);
  assert.equal(um('SELECT status FROM assinatura_pagamentos WHERE id = ?', r.corpo.id).status, 'divergente');
  assert.equal(um('SELECT acesso_ate FROM personais WHERE id = ?', conta.id).acesso_ate, anual.acesso_ate);

  // Pagamento de outra conta não aparece para este personal
  assert.equal((await chamar('assinatura/verificar', 'POST', { id: 9999 })).status, 404);

  // ---------- Administração ----------
  assert.equal((await chamar('admin/resumo', 'GET', undefined, 'admin')).status, 401);
  assert.equal((await chamar('admin/entrar', 'POST', { chave: 'errada' }, 'admin')).status, 401);
  r = await chamar('admin/entrar', 'POST', { chave: env.ADMIN_KEY }, 'admin');
  assert.equal(r.status, 200);
  assert.ok(cookies.admin.startsWith('admin='));

  r = await chamar('admin/resumo', 'GET', undefined, 'admin');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.usuarios.total, 1);
  assert.equal(r.corpo.usuarios.ativa, 1);
  assert.equal(r.corpo.assinantes.anuais, 1);
  assert.equal(r.corpo.receita.mes, 2366 + 19900);
  assert.equal(r.corpo.receita.porMetodo.pix, 2366);
  assert.equal(r.corpo.receita.serie.length, 12);
  assert.equal(r.corpo.divergentes, 1);
  assert.equal(r.corpo.conversao, 100);

  r = await chamar('admin/usuarios', 'GET', undefined, 'admin');
  assert.equal(r.corpo.usuarios[0].totalPago, 2366 + 19900);

  r = await chamar('admin/pagamentos', 'GET', undefined, 'admin');
  assert.equal(r.corpo.pagamentos.length, 3); // checkouts abandonados ("aguardando") ficam de fora
  assert.equal(r.corpo.pagamentos.find((x) => x.id === idCartao).personal.email, 'rafa@exemplo.com');

  // Suspender trava o painel; reativar libera
  await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'bloquear', ativo: true }, 'admin');
  r = await chamar('painel');
  assert.equal(r.status, 402);
  assert.equal(r.corpo.assinatura.situacao, 'bloqueada');
  assert.equal((await chamar('assinatura/checkout', 'POST', { plano: 'mensal', metodo: 'pix' })).status, 403);
  await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'bloquear', ativo: false }, 'admin');
  assert.equal((await chamar('painel')).status, 200);

  // Data final, dias extras, cortesia e pagamento manual
  r = await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'ate', data: '2020-05-10' }, 'admin');
  assert.equal(r.corpo.usuario.situacao, 'vencida');
  r = await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'dias', dias: 30 }, 'admin');
  assert.equal(r.corpo.usuario.diasRestantes, 30);
  r = await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'cortesia', ativa: true }, 'admin');
  assert.equal(r.corpo.usuario.situacao, 'cortesia');
  assert.equal((await chamar('assinatura/checkout', 'POST', { plano: 'mensal', metodo: 'pix' })).status, 400);
  await chamar(`admin/usuarios/${conta.id}`, 'PUT', { acao: 'cortesia', ativa: false }, 'admin');
  r = await chamar(`admin/usuarios/${conta.id}/pagamento`, 'POST', { plano: 'mensal', valor: 2490, observacao: 'Pix direto' }, 'admin');
  assert.equal(r.status, 200);
  assert.ok(r.corpo.usuario.diasRestantes >= 58);

  // Configuração: preço novo vale para os próximos pagamentos
  r = await chamar('admin/config', 'PUT', { mensal: 2990, anual: 24900, diasTeste: 14, descontoPix: 10, parcelasMax: 6 }, 'admin');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.planos.mensal.pix, 2691);
  assert.equal((await chamar('admin/config', 'PUT', { mensal: 0, anual: 1, diasTeste: 1, descontoPix: 1, parcelasMax: 1 }, 'admin')).status, 400);
  r = await chamar('assinatura');
  assert.equal(r.corpo.planos.anual.parcelas, 6);
  r = await chamar('conta/criar', 'POST', { nome: 'Bia', email: 'bia@exemplo.com', senha: 'senha-forte-2', slug: 'bia' });
  const bia = um('SELECT acesso_ate FROM personais WHERE slug = ?', 'bia');
  assert.ok(Math.abs((Date.parse(bia.acesso_ate) - Date.now()) / 86400000 - 14) < 0.01);

  // Sair da administração
  await chamar('admin/sair', 'POST', {}, 'admin');
  assert.equal((await chamar('admin/resumo', 'GET', undefined, 'admin')).status, 401);
  esquecerBanco();
});

test('sem token do Mercado Pago, o checkout avisa que está em configuração', async () => {
  esquecerBanco();
  const semMP = { DB: bancoFalso() };
  const pedir = async (caminho, dados, cookie = '') => {
    const r = await atenderApi(new Request('https://x/api/' + caminho, { method: 'POST', headers: { cookie }, body: JSON.stringify(dados) }), semMP, caminho.split('/'));
    return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const { cookie } = await pedir('conta/criar', { nome: 'Caio', email: 'caio@exemplo.com', senha: 'senha-forte-3', slug: 'caio' });
  assert.equal((await pedir('assinatura/checkout', { plano: 'anual', metodo: 'pix' }, cookie)).status, 503);
  esquecerBanco();
});
