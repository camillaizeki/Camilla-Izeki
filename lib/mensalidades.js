// Controle mensal: quais mensalidades existem para cada aluno e em que situação estão.
import { chaveMes, somaMes, dataISO, pausaEm, nomeMes } from './jornada.js';

export const vencimentoDe = (mes, dia) => mes + '-' + String(Math.min(Math.max(dia || 5, 1), 28)).padStart(2, '0');

export const rotuloMes = (mes) => nomeMes(mes) + ' de ' + mes.slice(0, 4);

// Situação que o personal vê em cada mensalidade.
export function situacaoMensalidade(m, hoje) {
  if (m.status === 'confirmado') return 'pago';
  if (m.status === 'pausa') return 'pausado';
  if (m.status === 'dispensado') return 'dispensado';
  return m.vencimento < dataISO(hoje) ? 'atrasado' : 'pendente';
}

// Mensalidades que ainda precisam ser criadas para um aluno ativo, do primeiro mês controlado até o mês atual.
// Mês que venceu durante uma pausa sem cobrança nasce como "pausa".
export function faltantes(aluno, pagamentos, pausas, hoje) {
  if (aluno.status !== 'ativo' || !(aluno.valor > 0) || !aluno.mes_controle) return [];
  const atual = chaveMes(hoje.ano, hoje.mes);
  const existentes = new Set(pagamentos.map((p) => p.mes));
  let mes = aluno.mes_controle;
  if (aluno.gerar_desde && aluno.gerar_desde > mes) mes = aluno.gerar_desde;
  const limite = somaMes(atual, -35);
  if (mes < limite) mes = limite;
  const novas = [];
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
