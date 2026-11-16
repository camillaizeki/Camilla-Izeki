import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16, gerarPix, normalizarChave } from '../lib/pix.js';
import { calcular, fases, mesesIniciais, somaMes, seloAtual, marcoDe } from '../lib/jornada.js';
import { faltantes, situacaoMensalidade, filtroDoAluno, resumoDoMes, serieMensal, posicaoAtual, mesesFuturos, projecaoDoMes } from '../lib/mensalidades.js';

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

test('lançar pagamentos de meses antigos não conta os meses em dobro', () => {
  // Treina desde janeiro; o controle começou em novembro; o personal lançou janeiro a novembro como pagos.
  const camilla = { mes_inicio: '2026-01', base_meses: 10, seq_base: 10, mes_cadastro: '2026-11', mes_controle: '2026-11', dia_venc: 5, status: 'ativo' };
  const pagos = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].map((m) => ({ mes: '2026-' + m, status: 'confirmado', vencimento: `2026-${m}-05` }));
  const c = calcular(camilla, pagos, { ano: 2026, mes: 11, dia: 15 });
  assert.equal(c.meses, 11);
  assert.equal(c.sequencia, 11);
  // Antes de pagar novembro são 10: janeiro a outubro.
  assert.equal(calcular(camilla, pagos.slice(0, 10), { ano: 2026, mes: 11, dia: 15 }).meses, 10);
});

test('mês em pausa não entra na contagem de treino', () => {
  const aluno2 = { mes_inicio: '2026-01', mes_cadastro: '2026-11', mes_controle: '2026-11', dia_venc: 5, status: 'ativo' };
  const hoje = { ano: 2026, mes: 11, dia: 15 };
  const pago = [{ mes: '2026-11', status: 'confirmado', vencimento: '2026-11-05' }];
  // Pausa em março e abril: de janeiro a outubro sobram 8, mais novembro pago.
  const pausaAntiga = [{ inicio: '2026-03-01', fim: '2026-04-30', cobrar: 0 }];
  const c = calcular(aluno2, pago, hoje, pausaAntiga);
  assert.equal(c.meses, 9);
  assert.equal(c.sequencia, 7); // maio a novembro, depois da pausa
  // Mês pago durante uma pausa com mensalidade mantida também não conta como treino.
  const pausaAgora = [{ inicio: '2026-11-01', fim: null, cobrar: 1 }];
  assert.equal(calcular(aluno2, pago, hoje, pausaAgora).meses, 10);
  // Pausa declarada no autocadastro, sem datas, é descontada.
  assert.equal(calcular({ ...aluno2, meses_pausa: 2 }, pago, hoje).meses, 9);
});

test('meses de treino anteriores ao controle aparecem no histórico, sem virar dívida', () => {
  // Começou em outubro; cadastrada em novembro, com o controle a partir de novembro.
  const anne = { status: 'ativo', valor: 80000, dia_venc: 1, mes_inicio: '2026-10', mes_cadastro: '2026-11', mes_controle: '2026-11' };
  const hoje = { ano: 2026, mes: 11, dia: 15 };
  const novas = faltantes(anne, [], [], hoje);
  assert.deepEqual(novas.map((m) => [m.mes, m.status]), [['2026-10', 'anterior'], ['2026-11', 'aberto']]);
  assert.equal(situacaoMensalidade(novas[0], hoje), 'anterior');
  assert.equal(situacaoMensalidade(novas[1], hoje), 'atrasado');
  // Só novembro entra na cobrança e nos totais
  assert.deepEqual(resumoDoMes(novas, hoje), { recebido: 0, pendente: 0, atrasado: 80000 });
  assert.equal(filtroDoAluno(anne, novas, false, hoje), 'atrasado');
  const c = calcular(anne, novas, hoje);
  assert.equal(c.alvo, '2026-11');
  assert.equal(c.meses, 1);
  // Quem treina há anos mostra só os 12 meses anteriores
  const antigo = { ...anne, mes_inicio: '2020-01' };
  assert.equal(faltantes(antigo, [], [], hoje).filter((m) => m.status === 'anterior').length, 12);
  // Mês anterior já lançado pelo personal não é recriado
  assert.deepEqual(faltantes(anne, [{ mes: '2026-10', status: 'confirmado' }], [], hoje).map((m) => m.mes), ['2026-11']);
});

test('dashboard: faturamento pela data do recebimento, sem contar em dobro', () => {
  const hoje = { ano: 2026, mes: 11, dia: 15 };
  const pagamentos = [
    // outubro pago em outubro
    { mes: '2026-10', status: 'confirmado', valor_previsto: 25000, vencimento: '2026-10-05', recebido_em: '2026-10-04', valor_recebido: 25000 },
    // outubro de outro aluno, recebido só em novembro, com desconto
    { mes: '2026-10', status: 'confirmado', valor_previsto: 30000, vencimento: '2026-10-10', recebido_em: '2026-11-03', valor_recebido: 28000 },
    // novembro: um pago, um vencido, um a vencer, um avisado pelo aluno (ainda não conta)
    { mes: '2026-11', status: 'confirmado', valor_previsto: 25000, vencimento: '2026-11-05', recebido_em: '2026-11-05', valor_recebido: 25000 },
    { mes: '2026-11', status: 'aberto', valor_previsto: 30000, vencimento: '2026-11-10' },
    { mes: '2026-11', status: 'aberto', valor_previsto: 20000, vencimento: '2026-11-28' },
    { mes: '2026-11', status: 'informado', valor_previsto: 40000, vencimento: '2026-11-20' },
    // fora da conta: pausa, dispensa e mês anterior ao controle
    { mes: '2026-11', status: 'pausa', valor_previsto: 50000, vencimento: '2026-11-05' },
    { mes: '2026-11', status: 'dispensado', valor_previsto: 50000, vencimento: '2026-11-05' },
    { mes: '2026-10', status: 'anterior', valor_previsto: 50000, vencimento: '2026-10-05' },
  ];
  const serie = serieMensal(pagamentos, hoje, 12);
  assert.equal(serie.length, 12);
  assert.equal(serie[0].mes, '2025-12');
  const out = serie.at(-2);
  const nov = serie.at(-1);
  assert.deepEqual([out.recebido, out.previsto, out.total, out.pagas, out.recebidoDoMes], [25000, 55000, 2, 2, 53000]);
  assert.deepEqual([nov.recebido, nov.deOutrosMeses, nov.previsto, nov.total, nov.pagas, nov.recebidoDoMes], [53000, 28000, 115000, 4, 1, 25000]);
  // Cada real recebido aparece em um único mês
  assert.equal(serie.reduce((t, m) => t + m.recebido, 0), 25000 + 28000 + 25000);
  assert.deepEqual(posicaoAtual(pagamentos, hoje), { aVencer: 60000, emAtraso: 30000 });
});

test('pagamento adiantado: conta no caixa de hoje, aparece no mês futuro e não adianta a trilha', () => {
  const hoje = { ano: 2026, mes: 11, dia: 15 };
  const aluno = { id: 1, status: 'ativo', valor: 30000, dia_venc: 10, mes_inicio: '2026-09', mes_cadastro: '2026-11', mes_controle: '2026-11' };
  const pagos = ['2026-11', '2026-12', '2027-01'].map((mes) => ({ mes, status: 'confirmado', vencimento: mes + '-10', valor_previsto: 30000, recebido_em: '2026-11-15', valor_recebido: 30000 }));
  // Trilha: setembro, outubro e novembro. Dezembro e janeiro só contam quando chegarem.
  const c = calcular(aluno, pagos, hoje);
  assert.equal(c.meses, 3);
  assert.equal(c.sequencia, 3);
  assert.equal(c.alvo, '2027-02');
  assert.equal(c.situacao, 'em_dia');
  assert.equal(calcular(aluno, pagos, { ano: 2027, mes: 1, dia: 2 }).meses, 5);
  // Dashboard
  assert.equal(mesesFuturos(pagos, hoje), 3);
  assert.equal(mesesFuturos([...pagos, { mes: '2027-06', status: 'confirmado' }], hoje), 7);
  const serie = serieMensal(pagos, hoje, 12, 3);
  assert.equal(serie.length, 15);
  const nov = serie[11];
  assert.deepEqual([nov.mes, nov.futuro, nov.recebido, nov.adiantado, nov.deAnteriores], ['2026-11', false, 90000, 60000, 0]);
  assert.deepEqual([serie[12].mes, serie[12].futuro, serie[12].recebido, serie[12].pagas, serie[12].recebidoDoMes], ['2026-12', true, 0, 1, 30000]);
  // Previsto de um mês futuro: quem pagou adiantado, quem ainda vai pagar, e ninguém em pausa ou inativo
  const alunos = [
    aluno,
    { id: 2, status: 'ativo', valor: 25000, dia_venc: 5, mes_controle: '2026-11' },
    { id: 3, status: 'ativo', valor: 40000, dia_venc: 5, mes_controle: '2026-11' }, // em pausa
    { id: 4, status: 'inativo', valor: 40000, dia_venc: 5, mes_controle: '2026-11' },
    { id: 5, status: 'ativo', valor: 40000, dia_venc: 5, mes_controle: '2027-01' }, // controle começa depois
  ];
  const pags = new Map([[1, pagos]]);
  const pausas = new Map([[3, [{ inicio: '2026-11-20', fim: null, cobrar: 0 }]]]);
  assert.deepEqual(projecaoDoMes(alunos, pags, pausas, '2026-12'), { previsto: 55000, total: 2, pagas: 1, recebidoDoMes: 30000 });
});

test('vencimento nos dias 29, 30 e 31 cai no último dia dos meses mais curtos', async () => {
  const { vencimentoNoMes } = await import('../lib/jornada.js');
  const { vencimentoDe } = await import('../lib/mensalidades.js');
  assert.equal(vencimentoNoMes('2026-02', 31), '2026-02-28');
  assert.equal(vencimentoNoMes('2028-02', 30), '2028-02-29'); // bissexto
  assert.equal(vencimentoNoMes('2026-04', 31), '2026-04-30');
  assert.equal(vencimentoNoMes('2026-05', 31), '2026-05-31');
  assert.equal(vencimentoNoMes('2026-03', 30), '2026-03-30');
  assert.equal(vencimentoNoMes('2026-11', 5), '2026-11-05');
  assert.equal(vencimentoNoMes('2026-11', null), '2026-11-05');
  assert.equal(vencimentoDe('2026-02', 29), '2026-02-28');
});
