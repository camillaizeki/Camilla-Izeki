// Controle mensal: quais mensalidades existem para cada aluno e em que situação estão.
import { chaveMes, somaMes, dataISO, pausaEm, nomeMes, vencimentoNoMes } from './jornada.js';

// Quantos meses anteriores ao controle aparecem no histórico de cada aluno.
const MESES_ANTERIORES = 12;

export const vencimentoDe = vencimentoNoMes;

export const rotuloMes = (mes) => nomeMes(mes) + ' de ' + mes.slice(0, 4);

// Situação que o personal vê em cada mensalidade.
export function situacaoMensalidade(m, hoje) {
  if (m.status === 'confirmado') return 'pago';
  if (m.status === 'pausa') return 'pausado';
  if (m.status === 'dispensado') return 'dispensado';
  if (m.status === 'anterior') return 'anterior';
  return m.vencimento < dataISO(hoje) ? 'atrasado' : 'pendente';
}

// Mensalidades que ainda precisam ser criadas para um aluno ativo, do primeiro mês controlado até o mês atual.
// Mês que venceu durante uma pausa sem cobrança nasce como "pausa".
export function faltantes(aluno, pagamentos, pausas, hoje) {
  if (aluno.status !== 'ativo' || aluno.modo === 'pacote' || !(aluno.valor > 0) || !aluno.mes_controle) return [];
  const atual = chaveMes(hoje.ano, hoje.mes);
  const existentes = new Set(pagamentos.map((p) => p.mes));
  let mes = aluno.mes_controle;
  if (aluno.gerar_desde && aluno.gerar_desde > mes) mes = aluno.gerar_desde;
  const limite = somaMes(atual, -35);
  if (mes < limite) mes = limite;
  const novas = [];

  // Meses entre o início dos treinos e o começo do controle: entram no histórico como "anterior",
  // sem valer como dívida nem como faturamento. O personal pode lançar o recebimento ou cobrar cada um.
  if (aluno.mes_inicio && aluno.mes_inicio < aluno.mes_controle) {
    let anterior = somaMes(aluno.mes_controle, -MESES_ANTERIORES);
    if (anterior < aluno.mes_inicio) anterior = aluno.mes_inicio;
    for (; anterior < aluno.mes_controle; anterior = somaMes(anterior, 1)) {
      if (existentes.has(anterior)) continue;
      const vencimento = vencimentoDe(anterior, aluno.dia_venc);
      novas.push({ mes: anterior, vencimento, valor_previsto: aluno.valor, status: pausaEm(pausas, vencimento) ? 'pausa' : 'anterior' });
    }
  }

  for (; mes <= atual; mes = somaMes(mes, 1)) {
    if (existentes.has(mes)) continue;
    const vencimento = vencimentoDe(mes, aluno.dia_venc);
    const pausa = pausaEm(pausas, vencimento);
    novas.push({ mes, vencimento, valor_previsto: aluno.valor, status: pausa && !pausa.cobrar ? 'pausa' : 'aberto' });
  }
  return novas;
}

// Depois de mexer nas pausas: mensalidades em aberto que caíram em pausa viram "pausa", e vice-versa.
export function ajustesDePausa(pagamentos, pausas) {
  const mudancas = [];
  for (const p of pagamentos) {
    if (p.status !== 'aberto' && p.status !== 'pausa') continue;
    const pausa = pausaEm(pausas, p.vencimento);
    const certo = pausa && !pausa.cobrar ? 'pausa' : 'aberto';
    if (certo !== p.status) mudancas.push({ mes: p.mes, status: certo });
  }
  return mudancas;
}

// Em qual filtro da lista o aluno aparece.
export function filtroDoAluno(aluno, pagamentos, emPausa, hoje) {
  if (aluno.status === 'novo') return 'novo';
  if (aluno.status === 'inativo') return 'inativo';
  const abertas = pagamentos.filter((p) => p.status === 'aberto' || p.status === 'informado');
  if (abertas.some((p) => situacaoMensalidade(p, hoje) === 'atrasado')) return 'atrasado';
  if (abertas.length) return 'pendente';
  if (emPausa) return 'pausado';
  const atual = chaveMes(hoje.ano, hoje.mes);
  if (pagamentos.some((p) => p.mes === atual && p.status === 'confirmado')) return 'pago';
  return 'em_dia';
}

// Totais do mês para o topo da lista. "Recebido" usa a data real do recebimento.
export function resumoDoMes(pagamentos, hoje) {
  const atual = chaveMes(hoje.ano, hoje.mes);
  const r = { recebido: 0, pendente: 0, atrasado: 0 };
  for (const p of pagamentos) {
    if (p.status === 'confirmado') {
      if ((p.recebido_em || '').startsWith(atual)) r.recebido += p.valor_recebido || 0;
    } else if (p.status === 'aberto' || p.status === 'informado') {
      r[situacaoMensalidade(p, hoje)] += p.valor_previsto || 0;
    }
  }
  return r;
}

const VALE = ['aberto', 'informado', 'confirmado']; // mensalidades que contam como previstas

// Indicadores mês a mês para o dashboard (do mais antigo para o mais recente).
//  recebido:        tudo que entrou no mês, pela data real do recebimento
//  deOutrosMeses:   parte do recebido que quita mensalidades de outros meses
//  previsto:        soma das mensalidades do mês (pausa, dispensa e meses anteriores ao controle ficam fora)
//  total / pagas:   quantas mensalidades o mês tem e quantas já foram pagas
//  recebidoDoMes:   quanto das mensalidades do mês já foi recebido, em qualquer data
//  deAnteriores / adiantado: quanto do recebido é de meses passados e quanto é pagamento adiantado
// "futuros" acrescenta os próximos meses à série, para os pagamentos adiantados aparecerem.
export function serieMensal(pagamentos, hoje, quantidade = 12, futuros = 0) {
  const atual = chaveMes(hoje.ano, hoje.mes);
  const meses = new Map();
  for (let i = quantidade - 1; i >= -futuros; i--) {
    const mes = somaMes(atual, -i);
    meses.set(mes, {
      mes, rotulo: rotuloMes(mes), futuro: mes > atual,
      recebido: 0, deOutrosMeses: 0, deAnteriores: 0, adiantado: 0,
      previsto: 0, total: 0, pagas: 0, recebidoDoMes: 0,
    });
  }
  for (const p of pagamentos) {
    const doMes = meses.get(p.mes);
    if (doMes && VALE.includes(p.status)) {
      doMes.previsto += p.valor_previsto || 0;
      doMes.total++;
      if (p.status === 'confirmado') {
        doMes.pagas++;
        doMes.recebidoDoMes += p.valor_recebido || 0;
      }
    }
    if (p.status === 'confirmado' && p.recebido_em) {
      const caixa = meses.get(p.recebido_em.slice(0, 7));
      if (caixa) {
        const valor = p.valor_recebido || 0;
        caixa.recebido += valor;
        if (p.mes !== caixa.mes) caixa.deOutrosMeses += valor;
        if (p.mes < caixa.mes) caixa.deAnteriores += valor;
        if (p.mes > caixa.mes) caixa.adiantado += valor;
      }
    }
  }
  return [...meses.values()];
}

// Quantos meses à frente a série precisa mostrar: no mínimo 3, e até o último mês já pago adiantado (máximo 12).
export function mesesFuturos(pagamentos, hoje) {
  const atual = chaveMes(hoje.ano, hoje.mes);
  let ultimo = atual;
  for (const p of pagamentos) if (VALE.includes(p.status) && p.mes > ultimo) ultimo = p.mes;
  let n = 0;
  for (let m = atual; m < ultimo; m = somaMes(m, 1)) n++;
  return Math.min(12, Math.max(3, n));
}

// Previsto de um mês que ainda não chegou: as mensalidades dele ainda não foram geradas,
// então a conta sai do cadastro (aluno ativo, com mensalidade, fora de pausa sem cobrança).
// O que já foi pago adiantado entra com o valor do próprio lançamento.
export function projecaoDoMes(alunos, pagamentosPorAluno, pausasPorAluno, mes) {
  const r = { previsto: 0, total: 0, pagas: 0, recebidoDoMes: 0 };
  for (const a of alunos) {
    const linha = (pagamentosPorAluno.get(a.id) || []).find((p) => p.mes === mes);
    if (linha) {
      if (!VALE.includes(linha.status)) continue;
      r.previsto += linha.valor_previsto || 0;
      r.total++;
      if (linha.status === 'confirmado') {
        r.pagas++;
        r.recebidoDoMes += linha.valor_recebido || 0;
      }
      continue;
    }
    if (a.status !== 'ativo' || a.modo === 'pacote' || !(a.valor > 0) || !a.mes_controle || a.mes_controle > mes) continue;
    const pausa = pausaEm(pausasPorAluno.get(a.id) || [], vencimentoDe(mes, a.dia_venc));
    if (pausa && !pausa.cobrar) continue;
    r.previsto += a.valor;
    r.total++;
  }
  return r;
}

// Situação de agora: quanto ainda vai vencer e quanto já venceu sem pagamento, somando todos os meses.
export function posicaoAtual(pagamentos, hoje) {
  const r = { aVencer: 0, emAtraso: 0 };
  for (const p of pagamentos) {
    if (p.status !== 'aberto' && p.status !== 'informado') continue;
    r[situacaoMensalidade(p, hoje) === 'atrasado' ? 'emAtraso' : 'aVencer'] += p.valor_previsto || 0;
  }
  return r;
}
