// Regras da jornada do aluno: meses de treino, sequência, selos e próxima renovação.
// Meses são sempre textos no formato "AAAA-MM" e o horário é o de Brasília.

export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function hojeBR(agora = Date.now()) {
  const d = new Date(agora - 3 * 3600 * 1000);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

export function chaveMes(ano, mes) {
  return ano + '-' + String(mes).padStart(2, '0');
}

export function somaMes(chave, n) {
  const [ano, mes] = chave.split('-').map(Number);
  const total = ano * 12 + (mes - 1) + n;
  return chaveMes(Math.floor(total / 12), (total % 12) + 1);
}

export function diferencaMeses(de, ate) {
  const [a1, m1] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  return a2 * 12 + m2 - (a1 * 12 + m1);
}

export function nomeMes(chave) {
  return MESES[Number(chave.split('-')[1]) - 1];
}

const MARCOS = [
  { meses: 1, nome: 'Bronze' },
  { meses: 3, nome: 'Prata' },
  { meses: 6, nome: 'Ouro' },
  { meses: 12, nome: 'Diamante' },
];

// Depois de 12 meses, cada aniversário vira um marco ("2 anos", "3 anos"...).
export function marcoDe(meses) {
  const fixo = MARCOS.find((m) => m.meses === meses);
  if (fixo) return fixo.nome;
  if (meses > 12 && meses % 12 === 0) return meses / 12 + ' anos';
  return null;
}

export function seloAtual(meses) {
  let atual = null;
  for (const m of MARCOS) if (meses >= m.meses) atual = m.nome;
  if (meses >= 24) atual = Math.floor(meses / 12) + ' anos';
  let proximo = MARCOS.find((m) => m.meses > meses);
  if (!proximo) {
    const alvo = (Math.floor(meses / 12) + 1) * 12;
    proximo = { meses: alvo, nome: alvo / 12 + ' anos' };
  }
  return { nome: atual, proximo: { nome: proximo.nome, faltam: proximo.meses - meses } };
}

// Meses de treino informados no cadastro: do início até o mês do cadastro, menos as pausas.
export function mesesIniciais(mesInicio, mesCadastro, mesesPausa) {
  if (!mesInicio) return 1;
  const corridos = diferencaMeses(mesInicio, mesCadastro) + 1;
  return Math.max(1, corridos - Math.max(0, mesesPausa || 0));
}

function diasEntre(a, b) {
  const ms = Date.UTC(b.ano, b.mes - 1, b.dia) - Date.UTC(a.ano, a.mes - 1, a.dia);
  return Math.round(ms / 86400000);
}

// aluno: { base_meses, seq_base, mes_cadastro, dia_venc, status }
// pagamentos: [{ mes, status: 'informado' | 'confirmado' }]
export function calcular(aluno, pagamentos, hoje = hojeBR()) {
  const confirmados = new Set(pagamentos.filter((p) => p.status === 'confirmado').map((p) => p.mes));
  const informados = new Set(pagamentos.filter((p) => p.status === 'informado').map((p) => p.mes));
  const primeiroMes = somaMes(aluno.mes_cadastro, 1);

  // Próximo mês a desbloquear. Mês que passou sem renovação vira intervalo, nunca dívida.
  let alvo = chaveMes(hoje.ano, hoje.mes);
  if (alvo < primeiroMes) alvo = primeiroMes;
  while (confirmados.has(alvo)) alvo = somaMes(alvo, 1);

  const meses = aluno.base_meses + confirmados.size;

  // Sequência: meses seguidos até o mês anterior ao alvo.
  let sequencia = 0;
  let cursor = somaMes(alvo, -1);
  while (confirmados.has(cursor)) {
    sequencia++;
    cursor = somaMes(cursor, -1);
  }
  if (cursor < primeiroMes) sequencia += aluno.seq_base || 0;

  const [anoAlvo, mesAlvo] = alvo.split('-').map(Number);
  const vencimento = { ano: anoAlvo, mes: mesAlvo, dia: Math.min(Math.max(aluno.dia_venc || 5, 1), 28) };
  const dias = diasEntre(hoje, vencimento);

  let situacao;
  if (aluno.status === 'novo') situacao = 'novo';
  else if (aluno.status === 'pausado') situacao = 'pausado';
  else if (informados.has(alvo)) situacao = 'informado';
  else if (dias > 5) situacao = 'em_dia';
  else if (dias > 0) situacao = 'renova_em';
  else if (dias === 0) situacao = 'renova_hoje';
  else situacao = 'aguardando';

  return { meses, sequencia, alvo, nomeAlvo: nomeMes(alvo), dias, situacao, selo: seloAtual(meses) };
}

// Fases mostradas na trilha: as últimas conquistadas, a próxima e duas bloqueadas.
export function fases(meses, situacao, nomeAlvo) {
  const lista = [];
  const inicio = Math.max(1, meses - 4);
  for (let n = inicio; n <= meses; n++) {
    const marco = marcoDe(n);
    lista.push({
      n,
      estado: 'feita',
      nota: n === meses ? 'Você está aqui' : marco ? 'Selo ' + marco : 'Concluído',
    });
  }
  for (let n = meses + 1; n <= meses + 3; n++) {
    const marco = marcoDe(n);
    const proxima = n === meses + 1;
    let nota = marco ? 'Selo ' + marco + ' à espera' : 'Bloqueado';
    let estado = 'travada';
    if (proxima && situacao === 'informado') {
      estado = 'pendente';
      nota = 'Aguardando confirmação';
    }
    lista.push({ n, estado, nota, mes: proxima ? nomeAlvo : null });
  }
  return lista;
}
