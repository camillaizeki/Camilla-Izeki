// Baixa pelo comprovante: API de ponta a ponta com banco em memória.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoFalso } from './banco-falso.js';
import { atenderApi } from '../src/api.js';
import { esquecerBanco } from '../lib/banco.js';
import { hojeBR, chaveMes, somaMes, dataISO } from '../lib/jornada.js';
import { chaveDoComprovante } from '../public/comprovante/extracao.js';

const hoje = hojeBR();
const mesAtual = chaveMes(hoje.ano, hoje.mes);
const hojeISO = dataISO(hoje);

function cliente() {
  const env = { DB: bancoFalso() };
  let cookie = '';
  return async function chamar(caminho, metodo = 'GET', dados) {
    const request = new Request('https://teste.local/api/' + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: dados ? JSON.stringify(dados) : undefined,
    });
    const resposta = await atenderApi(request, env, caminho.split('/'));
    const definido = resposta.headers.get('set-cookie');
    if (definido) cookie = definido.split(';')[0];
    return { status: resposta.status, corpo: await resposta.json() };
  };
}

async function preparar(slug = 'rafa') {
  esquecerBanco();
  const chamar = cliente();
  await chamar('conta/criar', 'POST', { nome: 'Rafael Andrade Lima', email: `${slug}@exemplo.com`, senha: 'senha-forte-1', slug });
  const joao = (await chamar('alunos', 'POST', { nome: 'João Pedro Silva', whatsapp: '62991234567', valor: 25000, diaVenc: 5 })).corpo.id;
  const lucas = (await chamar('alunos', 'POST', { nome: 'Lucas Souza', whatsapp: '62991234568', valor: 25000, diaVenc: 10 })).corpo.id;
  const bia = (await chamar('alunos', 'POST', { nome: 'Bia Costa', whatsapp: '62991234569', modo: 'pacote', valor: 40000, pacoteAulas: 8 })).corpo.id;
  return { chamar, joao, lucas, bia };
}

const E2E = 'E18236120202611241141S03A9B2C4D1';
const alunoDoPainel = async (chamar, id) => (await chamar('painel')).corpo.alunos.find((a) => a.id === id);

test('baixa pelo comprovante: mensalidade, repetido, desfazer e lançar de novo', async () => {
  const { chamar, joao } = await preparar();
  const chave = await chaveDoComprovante({ e2e: E2E });

  // Antes da baixa: nada lançado
  let r = await chamar('comprovantes/verificar', 'POST', { chave });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.duplicado, null);
  assert.equal((await alunoDoPainel(chamar, joao)).abertas[0].mes, mesAtual);

  // Baixa
  r = await chamar('comprovantes', 'POST', { alunoId: joao, mes: mesAtual, valor: 25000, data: hojeISO, chave });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.aluno, 'João Pedro Silva');
  let a = await alunoDoPainel(chamar, joao);
  assert.equal(a.abertas.length, 0);
  assert.equal(a.filtro, 'pago');
  assert.deepEqual(a.mesSeguinte.mes, somaMes(mesAtual, 1));

  // O mesmo comprovante não entra de novo, nem para outro mês
  r = await chamar('comprovantes/verificar', 'POST', { chave });
  assert.equal(r.corpo.duplicado.alunoNome, 'João Pedro Silva');
  assert.equal(r.corpo.duplicado.data, hojeISO);
  r = await chamar('comprovantes', 'POST', { alunoId: joao, mes: somaMes(mesAtual, 1), valor: 25000, data: hojeISO, chave });
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /já foi lançado para João Pedro Silva/);
  a = await alunoDoPainel(chamar, joao);
  assert.equal(a.pagoAte, null, 'o mês seguinte não pode ter sido pago');

  // Mês já pago não recebe outra baixa
  const outra = await chaveDoComprovante({ e2e: 'E00416968202611241205ABCDEFGHIJK' });
  r = await chamar('comprovantes', 'POST', { alunoId: joao, mes: mesAtual, valor: 25000, data: hojeISO, chave: outra });
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /já está pago/);

  // Desfazer a baixa libera o comprovante
  await chamar(`alunos/${joao}/mensalidades/${mesAtual}`, 'POST', { acao: 'reabrir' });
  assert.equal((await chamar('comprovantes/verificar', 'POST', { chave })).corpo.duplicado, null);
  r = await chamar('comprovantes', 'POST', { alunoId: joao, mes: mesAtual, valor: 20000, data: hojeISO, chave });
  assert.equal(r.status, 200);
  const historico = (await chamar(`alunos/${joao}/mensalidades`)).corpo.mensalidades.find((m) => m.mes === mesAtual);
  assert.equal(historico.situacao, 'pago');
  assert.equal(historico.valorRecebido, 20000);
});

test('pagador lembrado, adiantado e comprovante sem ID', async () => {
  const { chamar, lucas } = await preparar('rafa2');
  const proximo = somaMes(mesAtual, 1);
  const chave = await chaveDoComprovante({ pagador: 'Maria Aparecida Souza', valor: 250, data: hojeISO });
  assert.equal(chave.tipo, 'aproximada');

  let r = await chamar('comprovantes', 'POST', {
    alunoId: lucas, mes: mesAtual, valor: 25000, data: hojeISO, chave, lembrarPagador: 'Maria Aparecida Souza',
  });
  assert.equal(r.status, 200);
  r = await chamar('comprovantes');
  assert.deepEqual(r.corpo.pagadores, [{ nome: 'Maria Aparecida Souza', alunoId: lucas }]);

  // Lembrar de novo (com outra grafia) não duplica
  await chamar('comprovantes', 'POST', { alunoId: lucas, mes: proximo, valor: 25000, data: hojeISO, lembrarPagador: 'MARIA APARECIDA SOUZA' });
  assert.equal((await chamar('comprovantes')).corpo.pagadores.length, 1);
  const a = await alunoDoPainel(chamar, lucas);
  assert.match(a.pagoAte, /de \d{4}$/);
  assert.equal(a.mesSeguinte.mes, somaMes(mesAtual, 2));

  // Chave aproximada não bloqueia (só avisa no celular)
  assert.ok((await chamar('comprovantes/verificar', 'POST', { chave })).corpo.duplicado);
  await chamar(`alunos/${lucas}/mensalidades/${proximo}`, 'POST', { acao: 'reabrir' });
  r = await chamar('comprovantes', 'POST', { alunoId: lucas, mes: proximo, valor: 25000, data: hojeISO, chave });
  assert.equal(r.status, 200);
});

test('pacote de aulas pelo comprovante e apagar o pacote libera o comprovante', async () => {
  const { chamar, bia } = await preparar('rafa3');
  const chave = await chaveDoComprovante({ e2e: E2E });
  let r = await chamar('comprovantes', 'POST', { alunoId: bia, valor: 40000, data: hojeISO, chave });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.referente, 'pacote de 8 aulas');
  const h = (await chamar(`alunos/${bia}/mensalidades`)).corpo;
  assert.equal(h.pacotes.length, 1);
  assert.equal(h.pacotes[0].valor, 40000);
  assert.equal((await alunoDoPainel(chamar, bia)).saldo, 8);
  assert.equal((await chamar('comprovantes', 'POST', { alunoId: bia, valor: 40000, data: hojeISO, chave })).status, 409);
  assert.equal((await chamar(`alunos/${bia}/mensalidades`)).corpo.pacotes.length, 1, 'o repetido não cria pacote');

  await chamar(`alunos/${bia}/pacotes/${h.pacotes[0].id}`, 'DELETE');
  assert.equal((await chamar('comprovantes/verificar', 'POST', { chave })).corpo.duplicado, null);
});

test('validações e isolamento entre personais', async () => {
  const { chamar, joao } = await preparar('rafa4');
  const chave = await chaveDoComprovante({ e2e: E2E });
  const base = { alunoId: joao, mes: mesAtual, valor: 25000, data: hojeISO };
  assert.equal((await chamar('comprovantes', 'POST', { ...base, chave: { tipo: 'e2e', hash: E2E } })).status, 400, 'ID em claro é recusado');
  assert.equal((await chamar('comprovantes', 'POST', { ...base, mes: undefined })).status, 400);
  assert.equal((await chamar('comprovantes', 'POST', { ...base, mes: somaMes(mesAtual, 13) })).status, 400);
  assert.equal((await chamar('comprovantes', 'POST', { ...base, data: dataISO({ ano: hoje.ano + 1, mes: 1, dia: 1 }) })).status, 400);
  assert.equal((await chamar('comprovantes', 'POST', { ...base, valor: 0 })).status, 400);
  assert.equal((await chamar('comprovantes/verificar', 'POST', { chave: null })).status, 400);

  // Outro personal (mesmo banco) não enxerga nem usa os alunos, comprovantes e pagadores do primeiro
  await chamar('comprovantes', 'POST', { ...base, chave, lembrarPagador: 'Maria Souza' });
  await chamar('conta/sair', 'POST', {});
  await chamar('conta/criar', 'POST', { nome: 'Outra Pessoa', email: 'outra@exemplo.com', senha: 'senha-forte-1', slug: 'outra' });
  assert.equal((await chamar('comprovantes', 'POST', { ...base, mes: somaMes(mesAtual, 1) })).status, 404);
  assert.equal((await chamar('comprovantes/verificar', 'POST', { chave })).corpo.duplicado, null);
  assert.deepEqual((await chamar('comprovantes')).corpo.pagadores, []);

  // Sem login
  await chamar('conta/sair', 'POST', {});
  assert.equal((await chamar('comprovantes')).status, 401);
});

test('apagar o aluno apaga os comprovantes e pagadores dele', async () => {
  const { chamar, lucas } = await preparar('rafa5');
  const chave = await chaveDoComprovante({ e2e: E2E });
  await chamar('comprovantes', 'POST', { alunoId: lucas, mes: mesAtual, valor: 25000, data: hojeISO, chave, lembrarPagador: 'Maria Souza' });
  await chamar(`alunos/${lucas}`, 'DELETE');
  assert.deepEqual((await chamar('comprovantes')).corpo.pagadores, []);
  assert.equal((await chamar('comprovantes/verificar', 'POST', { chave })).corpo.duplicado, null);
});
