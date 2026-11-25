// Leitura de comprovantes: extração dos dados e identificação do aluno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extrairDados, encontrarAluno, semelhancaNomes, conferirRecebedor,
  chaveDoComprovante, normalizarNome, formatarNome,
} from '../public/comprovante/extracao.js';

// Textos no formato que os bancos costumam gerar (dados fictícios).
const NUBANK = `Comprovante de transferência
24 NOV 2026 - 08:41:12
Valor
R$ 250,00
Tipo de transferência
Pix
Destino
Nome
Rafael Andrade Lima
CPF
•••.456.789-••
Instituição
NU PAGAMENTOS - IP
Origem
Nome
João Pedro da Silva
Instituição
NU PAGAMENTOS - IP
Agência
0001
ID da transação:
E18236120202611241141s0
3a9b2c4d1`;

const INTER = `Pix enviado
R$ 1.250,00
Data
24/11/2026
Quem recebeu
Nome
RAFAEL ANDRADE LIMA
CPF/CNPJ
***.456.789-**
Quem pagou
Nome
MARIA APARECIDA SOUZA
Instituição
BANCO INTER
ID da transação
E00416968202611241205ABCDEFGHIJK`;

const ITAU = `comprovante de transferência
Pix
dados do recebedor
para: Rafael Andrade Lima
chave: (62) 99999-9999
instituição: NU PAGAMENTOS S.A.
dados do pagador
de: Ana Paula Souza
CPF: ***.123.456-**
valor: R$ 180,00
data da transferência: 05/11/2026
autenticação
E60701190202611050930XYZ12345678`;

const MERCADO_PAGO = `Comprovante de Pix
Quinta-feira, 3 de outubro de 2026, às 10:15
R$ 300,00
De
Bruno Costa
CPF: ***.111.222-**
Mercado Pago
Para
Rafael Andrade Lima
Nu Pagamentos S.A.
ID de transação Pix
E10573521202610031315aaaaaaaaaaa`;

// OCR com ruído: "O" no lugar de "0", RS no lugar de R$, quebras.
const OCR_RUIDOSO = `Pix enviado com sucesso
Valor
RS 250,00
Data 24/11/2026
Destino
Rafael Andrade Lima
Origem
Nome Joao P. Silva
ID: E182361202O26112411 41s03a9b2c4d1`;

test('Nubank: nomes em seções Origem/Destino com rótulo "Nome"', () => {
  const d = extrairDados(NUBANK);
  assert.equal(d.pagador, 'João Pedro da Silva');
  assert.equal(d.recebedor, 'Rafael Andrade Lima');
  assert.equal(d.valor, 250);
  assert.equal(d.data, '2026-11-24');
  assert.equal(d.e2e, 'E18236120202611241141S03A9B2C4D1');
});

test('Inter: maiúsculas, milhar e "Quem pagou/Quem recebeu"', () => {
  const d = extrairDados(INTER);
  assert.equal(d.pagador, 'MARIA APARECIDA SOUZA');
  assert.equal(d.recebedor, 'RAFAEL ANDRADE LIMA');
  assert.equal(d.valor, 1250);
  assert.equal(d.data, '2026-11-24');
  assert.equal(d.e2e, 'E00416968202611241205ABCDEFGHIJK');
});

test('Itaú: "para:" e "de:" na mesma linha', () => {
  const d = extrairDados(ITAU);
  assert.equal(d.pagador, 'Ana Paula Souza');
  assert.equal(d.recebedor, 'Rafael Andrade Lima');
  assert.equal(d.valor, 180);
  assert.equal(d.data, '2026-11-05');
  assert.equal(d.e2e, 'E60701190202611050930XYZ12345678');
});

test('Mercado Pago: data por extenso e "De/Para" em linhas próprias', () => {
  const d = extrairDados(MERCADO_PAGO);
  assert.equal(d.pagador, 'Bruno Costa');
  assert.equal(d.recebedor, 'Rafael Andrade Lima');
  assert.equal(d.valor, 300);
  assert.equal(d.data, '2026-10-03');
});

test('OCR com ruído', () => {
  const d = extrairDados(OCR_RUIDOSO);
  assert.equal(d.pagador, 'Joao P Silva');
  assert.equal(d.recebedor, 'Rafael Andrade Lima');
  assert.equal(d.valor, 250);
  assert.equal(d.data, '2026-11-24');
  assert.equal(d.e2e, 'E18236120202611241141S03A9B2C4D1');
});

test('texto sem comprovante não inventa dados', () => {
  const d = extrairDados('Bom dia! Segue a foto do treino de hoje 💪');
  assert.deepEqual(d, { pagador: null, recebedor: null, valor: null, data: null, e2e: null });
});

test('data cai para a do ID da transação quando não há data no texto', () => {
  const d = extrairDados('Origem\nNome\nJoão Silva\nE18236120202611241141s03a9b2c4d1');
  assert.equal(d.data, '2026-11-24');
});

// ---------------------------------------------------------------------------

const ALUNOS = [
  { id: 'a1', nome: 'João Pedro Silva', mensalidade: 250 },
  { id: 'a2', nome: 'Ana Paula Souza', mensalidade: 180 },
  { id: 'a3', nome: 'Ana Paula Ferreira', mensalidade: 220 },
  { id: 'a4', nome: 'Bruno Costa', mensalidade: 300 },
  { id: 'a5', nome: 'Lucas Souza', mensalidade: 250 },
];

test('normalização ignora acentos, caixa e partículas', () => {
  assert.equal(normalizarNome('JOÃO Pedro da SILVA'), 'joao pedro silva');
  assert.equal(formatarNome('MARIA DA SILVA'), 'Maria da Silva');
});

test('nome igual → único', () => {
  const r = encontrarAluno('JOAO PEDRO DA SILVA', { alunos: ALUNOS, valor: 250 });
  assert.equal(r.tipo, 'unico');
  assert.equal(r.candidatos[0].aluno.id, 'a1');
});

test('nome abreviado pelo OCR → único', () => {
  const r = encontrarAluno('Joao P Silva', { alunos: ALUNOS });
  assert.equal(r.tipo, 'unico');
  assert.equal(r.candidatos[0].aluno.id, 'a1');
});

test('erro de uma letra no OCR → ainda encontra', () => {
  const r = encontrarAluno('Bruno Cosla', { alunos: ALUNOS });
  assert.equal(r.tipo, 'unico');
  assert.equal(r.candidatos[0].aluno.id, 'a4');
});

test('nome que serve para dois alunos → ambíguo, valor sugere o certo', () => {
  const r = encontrarAluno('Ana Paula', { alunos: ALUNOS, valor: 220 });
  assert.equal(r.tipo, 'ambiguo');
  assert.deepEqual(r.candidatos.map((c) => c.aluno.id).sort(), ['a2', 'a3']);
  assert.equal(r.sugerido, 'a3');
});

test('nome completo desempata mesmo com homônimo parcial', () => {
  const r = encontrarAluno('Ana Paula Souza', { alunos: ALUNOS });
  assert.equal(r.tipo, 'unico');
  assert.equal(r.candidatos[0].aluno.id, 'a2');
});

test('mãe com o mesmo sobrenome NÃO é confundida com o filho', () => {
  const r = encontrarAluno('Maria Aparecida Souza', { alunos: ALUNOS, valor: 250 });
  assert.equal(r.tipo, 'nenhum');
});

test('pagador salvo resolve direto', () => {
  const r = encontrarAluno('MARIA APARECIDA SOUZA', {
    alunos: ALUNOS,
    pagadoresSalvos: [{ nome: 'Maria Aparecida Souza', alunoId: 'a5' }],
  });
  assert.equal(r.tipo, 'unico');
  assert.equal(r.candidatos[0].aluno.id, 'a5');
  assert.equal(r.candidatos[0].motivo, 'pagador_salvo');
});

test('pagador salvo para dois alunos (ex.: mãe de irmãos) → ambíguo', () => {
  const r = encontrarAluno('Maria Souza', {
    alunos: ALUNOS,
    valor: 180,
    pagadoresSalvos: [{ nome: 'Maria Souza', alunoId: 'a2' }, { nome: 'maria souza', alunoId: 'a5' }],
  });
  assert.equal(r.tipo, 'ambiguo');
  assert.equal(r.sugerido, 'a2');
});

test('sem nome lido → nenhum', () => {
  assert.equal(encontrarAluno(null, { alunos: ALUNOS }).tipo, 'nenhum');
});

test('semelhança: primeiro nome diferente derruba a nota', () => {
  assert.ok(semelhancaNomes('Lucas Souza', 'Maria Souza') < 0.6);
  assert.ok(semelhancaNomes('Rafael Andrade Lima', 'RAFAEL A LIMA') >= 0.6);
});

test('recebedor: confere com o nome do personal', () => {
  assert.equal(conferirRecebedor('RAFAEL ANDRADE LIMA', 'Rafael Lima'), true);
  assert.equal(conferirRecebedor('Carlos Mendes', ['Rafael Lima', 'Rafa Personal']), false);
  assert.equal(conferirRecebedor(null, 'Rafael Lima'), null);
});

test('chave do comprovante: hash do E2E e chave aproximada', async () => {
  const a = await chaveDoComprovante({ e2e: 'E18236120202611241141S03A9B2C4D1' });
  const b = await chaveDoComprovante({ e2e: 'E18236120202611241141S03A9B2C4D1', pagador: 'x' });
  assert.equal(a.tipo, 'e2e');
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash.length, 64);
  assert.ok(!a.hash.includes('E1823'));
  const c = await chaveDoComprovante({ pagador: 'João Silva', valor: 250, data: '2026-11-24' });
  const d = await chaveDoComprovante({ pagador: 'JOAO DA SILVA', valor: 250, data: '2026-11-24' });
  assert.equal(c.tipo, 'aproximada');
  assert.equal(c.hash, d.hash);
  assert.equal(await chaveDoComprovante({ pagador: 'João' }), null);
});
