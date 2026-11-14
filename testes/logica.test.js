import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16, gerarPix, normalizarChave } from '../lib/pix.js';
import { calcular, fases, mesesIniciais, somaMes, seloAtual, marcoDe } from '../lib/jornada.js';

test('crc16 bate com o valor de referência do padrão', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('pix copia e cola tem estrutura e verificador válidos', () => {
  const codigo = gerarPix({ chave: 'ana@exemplo.com', nome: 'Rafael Conceição', cidade: 'São Paulo', centavos: 25000, txid: 'RENOVA1M202612' });
  assert.ok(codigo.startsWith('000201'));
  assert.ok(codigo.includes('0014br.gov.bcb.pix0115ana@exemplo.com'));
  assert.ok(codigo.includes('5406250.00'));
  assert.ok(codigo.includes('5916RAFAEL CONCEICAO'));
  assert.ok(codigo.includes('6009SAO PAULO'));
  assert.equal(crc16(codigo.slice(0, -4)), codigo.slice(-4));
});

test('chaves pix são normalizadas', () => {
  assert.equal(normalizarChave('celular', '(11) 98888-7777'), '+5511988887777');
  assert.equal(normalizarChave('cpf_cnpj', '123.456.789-09'), '12345678909');
  assert.equal(normalizarChave('email', ' Ana@Exemplo.com '), 'ana@exemplo.com');
});

test('meses andam certo na virada do ano', () => {
  assert.equal(somaMes('2026-11', 2), '2027-01');
  assert.equal(somaMes('2027-01', -1), '2026-12');
});

test('meses iniciais descontam a pausa', () => {
  assert.equal(mesesIniciais('2026-07', '2026-11', 0), 5);
  assert.equal(mesesIniciais('2026-07', '2026-11', 2), 3);
  assert.equal(mesesIniciais(null, '2026-11', 0), 1);
});

const aluno = { base_meses: 5, seq_base: 5, mes_cadastro: '2026-11', dia_venc: 5, status: 'ativo' };

test('aluno recém-cadastrado mira o mês seguinte', () => {
  const c = calcular(aluno, [], { ano: 2026, mes: 11, dia: 14 });
  assert.equal(c.alvo, '2026-12');
  assert.equal(c.meses, 5);
  assert.equal(c.sequencia, 5);
  assert.equal(c.situacao, 'em_dia');
});

test('perto do dia de renovação entra na fila', () => {
  assert.equal(calcular(aluno, [], { ano: 2026, mes: 12, dia: 2 }).situacao, 'renova_em');
  assert.equal(calcular(aluno, [], { ano: 2026, mes: 12, dia: 5 }).situacao, 'renova_hoje');
  assert.equal(calcular(aluno, [], { ano: 2026, mes: 12, dia: 9 }).situacao, 'aguardando');
});

test('pagamento informado e confirmado mudam a situação', () => {
  const dia = { ano: 2026, mes: 12, dia: 5 };
  assert.equal(calcular(aluno, [{ mes: '2026-12', status: 'informado' }], dia).situacao, 'informado');
  const c = calcular(aluno, [{ mes: '2026-12', status: 'confirmado' }], dia);
  assert.equal(c.meses, 6);
  assert.equal(c.sequencia, 6);
  assert.equal(c.alvo, '2027-01');
  assert.equal(c.selo.nome, 'Ouro');
});

test('mês pulado quebra a sequência mas não vira dívida', () => {
  const c = calcular(aluno, [{ mes: '2026-12', status: 'confirmado' }], { ano: 2027, mes: 3, dia: 1 });
  assert.equal(c.alvo, '2027-03');
  assert.equal(c.meses, 6);
  assert.equal(c.sequencia, 0);
});

test('selos e marcos', () => {
  assert.equal(seloAtual(5).nome, 'Prata');
  assert.deepEqual(seloAtual(5).proximo, { nome: 'Ouro', faltam: 1 });
  assert.equal(marcoDe(24), '2 anos');
  assert.deepEqual(seloAtual(14).proximo, { nome: '2 anos', faltam: 10 });
});

test('trilha mostra conquistadas, a próxima e as bloqueadas', () => {
  const f = fases(5, 'informado', 'dezembro');
  assert.equal(f.length, 8);
  assert.equal(f[4].nota, 'Você está aqui');
  assert.equal(f[5].estado, 'pendente');
  assert.equal(f[5].mes, 'dezembro');
  assert.equal(f[6].estado, 'travada');
});
