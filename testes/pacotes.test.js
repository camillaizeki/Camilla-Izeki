// Controle por pacote de aulas: saldo, situação, faturamento e página do aluno.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoFalso } from './banco-falso.js';
import { atenderApi } from '../src/api.js';
import { esquecerBanco } from '../lib/banco.js';
import { situacaoPacote, saldoDe, precoAula } from '../lib/pacotes.js';
import { hojeBR, chaveMes, dataISO, somaMes } from '../lib/jornada.js';

const hoje = hojeBR();
const hojeISO = dataISO(hoje);
const mesAtual = chaveMes(hoje.ano, hoje.mes);

test('regras do pacote: saldo, situação e quanto fica em aberto', () => {
  const dia = { ano: 2026, mes: 11, dia: 16 };
  const aluno = { status: 'ativo', modo: 'pacote', valor: 80000, pacote_aulas: 10 };
  const pacote = [{ aulas: 10, valor: 80000, recebido_em: '2026-11-02' }];
  const aulas = (n) => Array.from({ length: n }, (_, i) => ({ data: '2026-11-' + String(3 + i).padStart(2, '0') }));
  assert.equal(precoAula(aluno), 8000);
  assert.equal(saldoDe(pacote, aulas(3)), 7);
  assert.deepEqual(pick(situacaoPacote(aluno, pacote, aulas(3), [], dia)), ['pago', 'em_dia', 0, 0]);
  assert.deepEqual(pick(situacaoPacote(aluno, pacote, aulas(8), [], dia)), ['pago', 'renova_em', 0, 0]); // restam 2: entra nos lembretes
  assert.deepEqual(pick(situacaoPacote(aluno, pacote, aulas(10), [], dia)), ['pendente', 'renova_hoje', 80000, 0]); // acabou: pacote a renovar
  assert.deepEqual(pick(situacaoPacote(aluno, pacote, aulas(12), [], dia)), ['atrasado', 'aguardando', 0, 16000]); // 2 aulas além do pacote
  assert.equal(situacaoPacote({ ...aluno, pacote_informado_em: 'x' }, pacote, aulas(10), [], dia).situacao, 'informado');
  // Pacote pago em outro mês: segue em dia, mas não aparece em "Pagos" deste mês
  assert.equal(situacaoPacote(aluno, [{ ...pacote[0], recebido_em: '2026-10-20' }], aulas(3), [], dia).filtro, 'em_dia');
  // Pausa com saldo: aparece como pausado
  assert.equal(situacaoPacote(aluno, pacote, aulas(3), [{ inicio: '2026-11-10', fim: null }], dia).filtro, 'pausado');
});

const pick = (s) => [s.filtro, s.situacao, s.aVencer, s.emAtraso];

test('fluxo do pacote pela API', async () => {
  esquecerBanco();
  const env = { DB: bancoFalso() };
  let cookie = '';
  const chamar = async (caminho, metodo = 'GET', dados, comCookie = true) => {
    const request = new Request('https://teste.local/api/' + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(comCookie && cookie ? { cookie } : {}) },
      body: dados ? JSON.stringify(dados) : undefined,
    });
    const r = await atenderApi(request, env, caminho.split('/'));
    const c = r.headers.get('set-cookie');
    if (c) cookie = c.split(';')[0];
    return { status: r.status, corpo: await r.json() };
  };

  await chamar('conta/criar', 'POST', { nome: 'Thais Sousa', email: 't@exemplo.com', senha: 'senha-forte-1', slug: 'thais' });
  await chamar('conta', 'PUT', { nome: 'Thais Sousa', pixTipo: 'email', pixChave: 't@exemplo.com', pixCidade: 'Goiânia' });

  // Cadastro pelo personal: pacote de 10 aulas por R$ 800, já pago hoje
  assert.equal((await chamar('alunos', 'POST', { nome: 'Lia', whatsapp: '62911112222', modo: 'pacote', valor: 80000 })).status, 400); // falta a quantidade de aulas
  let r = await chamar('alunos', 'POST', { nome: 'Lia Costa', whatsapp: '62911112222', modo: 'pacote', valor: 80000, pacoteAulas: 10, pacotePago: true });
  assert.equal(r.status, 200);
  const id = r.corpo.id;
  // Um aluno de mensalidade, para conferir que os dois convivem
  await chamar('alunos', 'POST', { nome: 'Rui', whatsapp: '62933334444', valor: 30000, diaVenc: 28 });

  r = await chamar('painel');
  let lia = r.corpo.alunos.find((a) => a.id === id);
  assert.deepEqual([lia.modo, lia.saldo, lia.pacoteAulas, lia.precoAula, lia.filtro, lia.abertas.length], ['pacote', 10, 10, 8000, 'pago', 0]);
  assert.equal(r.corpo.financeiro.temPacote, true);
  assert.equal(r.corpo.financeiro.meses[r.corpo.financeiro.atual].recebido, 80000); // pacote entra no faturamento de hoje
  assert.equal(r.corpo.resumo.recebido, 80000);
  assert.equal((await chamar(`alunos/${id}/mensalidades`)).corpo.mensalidades.length, 0); // pacote não gera mensalidade

  // Registra 10 aulas: o pacote acaba e vira "a renovar"
  let ultimaAula;
  for (let i = 0; i < 10; i++) ultimaAula = (await chamar(`alunos/${id}/aulas`, 'POST', {})).corpo.id;
  assert.equal((await chamar(`alunos/${id}/aulas`, 'POST', { data: '2999-01-01' })).status, 400);
  r = await chamar('painel');
  lia = r.corpo.alunos.find((a) => a.id === id);
  assert.deepEqual([lia.saldo, lia.filtro, lia.situacao, lia.meses], [0, 'pendente', 'renova_hoje', 1]); // teve aula este mês: 1 mês de treino
  assert.equal(r.corpo.financeiro.aVencer, 80000 + (hoje.dia <= 28 ? 30000 : 0));

  // Uma aula a mais: deve 1 aula
  await chamar(`alunos/${id}/aulas`, 'POST', {});
  r = await chamar('painel');
  lia = r.corpo.alunos.find((a) => a.id === id);
  assert.deepEqual([lia.saldo, lia.filtro], [-1, 'atrasado']);
  assert.equal(r.corpo.financeiro.alunos.inadimplentes, 1 + (hoje.dia > 28 ? 1 : 0));
  assert.ok(r.corpo.financeiro.emAtraso >= 8000);

  // A aluna vê o saldo e avisa que pagou; isso não registra dinheiro
  const token = lia.token;
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.deepEqual([r.corpo.modo, r.corpo.saldo, r.corpo.pacoteAulas, r.corpo.valor], ['pacote', -1, 10, 80000]);
  assert.ok(r.corpo.pix.includes('5406800.00'));
  await chamar(`aluno/${token}/paguei`, 'POST', {}, false);
  r = await chamar('painel');
  lia = r.corpo.alunos.find((a) => a.id === id);
  assert.deepEqual([lia.pacoteInformado, lia.situacao], [true, 'informado']);
  assert.equal(r.corpo.resumo.recebido, 80000);

  // Personal registra o pacote novo: saldo volta, aviso some, faturamento soma
  assert.equal((await chamar(`alunos/${id}/pacotes`, 'POST', { aulas: 10, valor: 75000 })).status, 200);
  r = await chamar('painel');
  lia = r.corpo.alunos.find((a) => a.id === id);
  assert.deepEqual([lia.saldo, lia.pacoteInformado, lia.filtro], [9, false, 'pago']);
  assert.equal(r.corpo.resumo.recebido, 155000);

  // Histórico, correção e exclusão
  r = await chamar(`alunos/${id}/mensalidades`);
  assert.equal(r.corpo.pacotes.length, 2);
  assert.equal(r.corpo.aulas.length, 11);
  assert.equal(r.corpo.aulas[0].data, hojeISO);
  const pac = r.corpo.pacotes[0];
  await chamar(`alunos/${id}/pacotes/${pac.id}`, 'PUT', { aulas: 12, valor: 75000, data: hojeISO });
  assert.equal((await chamar('painel')).corpo.alunos.find((a) => a.id === id).saldo, 11);
  await chamar(`alunos/${id}/aulas/${ultimaAula}`, 'DELETE');
  assert.equal((await chamar('painel')).corpo.alunos.find((a) => a.id === id).saldo, 12);
  await chamar(`alunos/${id}/pacotes/${pac.id}`, 'DELETE');
  assert.equal((await chamar('painel')).corpo.resumo.recebido, 80000);

  // Lembrete com IA fala em renovar o pacote
  let pedido = '';
  env.AI = { run: async (_, { messages }) => { pedido = messages[1].content; return { response: 'Bora renovar!' }; } };
  assert.equal((await chamar('ia/lembrete', 'POST', { alunoId: id })).corpo.texto, 'Bora renovar!');
  assert.ok(pedido.includes('pacote de 10 aulas') && pedido.includes('renovar o pacote'));

  // Mudar para mensalidade: passa a gerar a mensalidade do mês
  await chamar('alunos/' + id, 'PUT', { modo: 'mensal', valor: 30000, diaVenc: 28 });
  lia = (await chamar('painel')).corpo.alunos.find((a) => a.id === id);
  assert.deepEqual([lia.modo, lia.abertas.length, lia.abertas[0]?.mes], ['mensal', 1, mesAtual]);
  // E de volta para pacote: a mensalidade aberta deste mês deixa de ser cobrada
  await chamar('alunos/' + id, 'PUT', { modo: 'pacote', valor: 80000, pacoteAulas: 10 });
  lia = (await chamar('painel')).corpo.alunos.find((a) => a.id === id);
  assert.deepEqual([lia.modo, lia.abertas.length], ['pacote', 0]);

  // Outro personal não registra aula nem pacote para ela
  const cookieThais = cookie;
  await chamar('conta/criar', 'POST', { nome: 'Outro', email: 'o@exemplo.com', senha: 'senha-forte-2', slug: 'outro' });
  assert.equal((await chamar(`alunos/${id}/aulas`, 'POST', {})).status, 404);
  assert.equal((await chamar(`alunos/${id}/pacotes`, 'POST', { aulas: 10, valor: 1 })).status, 404);
  cookie = cookieThais;

  // Excluir a aluna apaga pacotes e aulas
  await chamar('alunos/' + id, 'DELETE');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM aulas').get().n, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM pacotes').get().n, 0);
  esquecerBanco();
});

test('autocadastro com dia de vencimento escolhido pelo aluno', async () => {
  esquecerBanco();
  const env = { DB: bancoFalso() };
  const r0 = await atenderApi(new Request('https://t/api/conta/criar', { method: 'POST', body: JSON.stringify({ nome: 'Thais', email: 'x@exemplo.com', senha: 'senha-forte-1', slug: 'thais' }) }), env, ['conta', 'criar']);
  assert.equal(r0.status, 200);
  const r = await atenderApi(new Request('https://t/api/convite/thais', { method: 'POST', body: JSON.stringify({ nome: 'Ana', whatsapp: '62900001111', diaVenc: 31, aceite: true }) }), env, ['convite', 'thais']);
  assert.equal(r.status, 200);
  assert.equal(env.DB.sqlite.prepare('SELECT dia_venc, valor, status FROM alunos').get().dia_venc, 31);
  esquecerBanco();
});
