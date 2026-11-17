// Controle por pacote de aulas: o aluno paga um pacote (ex.: 10 aulas) e o personal marca cada aula dada.
import { chaveMes, somaMes, dataISO, pausaEm } from './jornada.js';

export const saldoDe = (pacotes, aulas) => pacotes.reduce((t, p) => t + (p.aulas || 0), 0) - aulas.length;

// Valor de uma aula, pelo pacote atual do aluno.
export const precoAula = (aluno) => (aluno.pacote_aulas > 0 ? Math.round((aluno.valor || 0) / aluno.pacote_aulas) : 0);

// Situação do aluno de pacote, nos mesmos termos dos alunos de mensalidade:
//  filtro:   em qual filtro da lista ele aparece (pago, em_dia, pendente, atrasado, pausado, inativo, novo)
//  situacao: usada pela fila de lembretes (renova_em, renova_hoje, aguardando, informado, em_dia, pausado)
//  aVencer / emAtraso: quanto entra nesses totais do dashboard
export function situacaoPacote(aluno, pacotes, aulas, pausas, hoje) {
  const saldo = saldoDe(pacotes, aulas);
  const atual = chaveMes(hoje.ano, hoje.mes);
  const emPausa = !!pausaEm(pausas, dataISO(hoje));
  const r = { saldo, emPausa, aVencer: 0, emAtraso: 0 };
  if (aluno.status === 'novo') return { ...r, filtro: 'novo', situacao: 'novo' };
  if (aluno.status === 'inativo') return { ...r, filtro: 'inativo', situacao: 'inativo' };
  if (saldo < 0) {
    // Aulas dadas além do pacote: ficam devendo, pelo valor de cada aula.
    return { ...r, filtro: 'atrasado', situacao: aluno.pacote_informado_em ? 'informado' : 'aguardando', emAtraso: -saldo * precoAula(aluno) };
  }
  if (emPausa) return { ...r, filtro: 'pausado', situacao: 'pausado' };
  if (saldo === 0) {
    return { ...r, filtro: 'pendente', situacao: aluno.pacote_informado_em ? 'informado' : 'renova_hoje', aVencer: aluno.valor || 0 };
  }
  const pagouEsteMes = pacotes.some((p) => (p.recebido_em || '').startsWith(atual));
  return {
    ...r,
    filtro: pagouEsteMes ? 'pago' : 'em_dia',
    situacao: aluno.pacote_informado_em ? 'informado' : saldo <= 2 ? 'renova_em' : 'em_dia',
  };
}

// Pacotes pagos no formato das mensalidades pagas, para entrarem no faturamento do dashboard.
// O mês de referência é o do recebimento: pacote não pertence a um mês.
export const pacotesComoRecebimentos = (pacotes) =>
  pacotes
    .filter((p) => p.recebido_em)
    .map((p) => ({ mes: p.recebido_em.slice(0, 7), status: 'confirmado', valor_previsto: p.valor, valor_recebido: p.valor, recebido_em: p.recebido_em }));

// Meses em que houve aula, no formato de mensalidades pagas, só para a trilha do aluno contar os meses de treino.
export function mesesComAula(aulas, hoje) {
  const atual = chaveMes(hoje.ano, hoje.mes);
  const meses = new Set(aulas.map((a) => a.data.slice(0, 7)).filter((m) => m <= atual));
  return [...meses].map((mes) => ({ mes, status: 'confirmado', vencimento: mes + '-01' }));
}

export { somaMes };
