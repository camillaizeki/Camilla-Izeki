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

// Meses de treino anteriores ao primeiro mês controlado (que só conta quando for pago).
export function mesesBase(mesInicio, mesCadastro, mesControle, mesesPausa) {
  const corridos = diferencaMeses(mesInicio || mesCadastro, mesControle);
  return Math.max(0, corridos - Math.max(0, mesesPausa || 0));
}

function diasEntre(a, b) {
  const ms = Date.UTC(b.ano, b.mes - 1, b.dia) - Date.UTC(a.ano, a.mes - 1, a.dia);
  return Math.round(ms / 86400000);
}

export const dataISO = (d) => chaveMes(d.ano, d.mes) + '-' + String(d.dia).padStart(2, '0');

// Pausa que cobre uma data (AAAA-MM-DD), se houver.
export function pausaEm(pausas, data) {
  return (pausas || []).find((p) => p.inicio <= data && (!p.fim || p.fim >= data)) || null;
}

// aluno: { base_meses, seq_base, mes_cadastro, mes_controle, dia_venc, status }
// pagamentos: [{ mes, status, vencimento }] com status
//   'aberto' (gerada, sem pagamento), 'informado' (o aluno disse que pagou),
//   'confirmado' (paga), 'pausa' ou 'dispensado' (não é devida).
export function calcular(aluno, pagamentos, hoje = hojeBR(), pausas = []) {
  const porMes = new Map(pagamentos.map((p) => [p.mes, p]));
  const pago = (m) => porMes.get(m)?.status === 'confirmado';
  const isento = (m) => ['pausa', 'dispensado'].includes(porMes.get(m)?.status);
  const primeiroMes = aluno.mes_controle || somaMes(aluno.mes_cadastro, 1);

  // Próximo mês a pagar: a mensalidade em aberto mais antiga; sem nenhuma, o próximo mês livre.
  const abertas = pagamentos.filter((p) => p.status === 'aberto' || p.status === 'informado').sort((x, y) => (x.mes < y.mes ? -1 : 1));
  let alvo;
  if (abertas.length) alvo = abertas[0].mes;
  else {
    alvo = chaveMes(hoje.ano, hoje.mes);
    if (alvo < primeiroMes) alvo = primeiroMes;
    while (pago(alvo) || isento(alvo)) alvo = somaMes(alvo, 1);
  }

  // Meses de treino. Mês em pausa nunca conta, e cada mês conta uma vez só:
  //  - antes do primeiro mês controlado: os meses desde o início dos treinos;
  //  - a partir dele: os meses com mensalidade paga.
  // Pagamento lançado para um mês anterior ao controle é só financeiro (o mês já está na conta acima).
  const diaVenc = String(Math.min(Math.max(aluno.dia_venc || 5, 1), 28)).padStart(2, '0');
  const emPausaNoMes = (m) => !!pausaEm(pausas, m + '-' + diaVenc);
  const pagosContados = pagamentos.filter((p) => p.status === 'confirmado' && p.mes >= primeiroMes && !emPausaNoMes(p.mes)).length;

  let anteriores = aluno.base_meses || 0; // sem data de início, vale o número guardado no cadastro
  let seguidosAntes = aluno.seq_base || 0;
  if (aluno.mes_inicio) {
    anteriores = 0;
    seguidosAntes = 0;
    let semQuebra = true;
    for (let m = somaMes(primeiroMes, -1); m >= aluno.mes_inicio; m = somaMes(m, -1)) {
      if (emPausaNoMes(m)) semQuebra = false;
      else {
        anteriores++;
        if (semQuebra) seguidosAntes++;
      }
    }
    // Pausa informada só como "tantos meses" no autocadastro: desconta, e a sequência recomeça.
    const declarada = Math.max(0, aluno.meses_pausa || 0);
    if (declarada) {
      anteriores = Math.max(0, anteriores - declarada);
      seguidosAntes = 0;
    }
  }
  const meses = anteriores + pagosContados;

  // Sequência: meses pagos seguidos antes do alvo. Mês de pausa não conta nem quebra.
  let sequencia = 0;
  let cursor = somaMes(alvo, -1);
  while (cursor >= primeiroMes && (pago(cursor) || isento(cursor))) {
    if (pago(cursor) && !emPausaNoMes(cursor)) sequencia++;
    cursor = somaMes(cursor, -1);
  }
  if (cursor < primeiroMes) sequencia += seguidosAntes;

  const dia = String(Math.min(Math.max(aluno.dia_venc || 5, 1), 28)).padStart(2, '0');
  const vencimento = porMes.get(alvo)?.vencimento || alvo + '-' + dia;
  const [va, vm, vd] = vencimento.split('-').map(Number);
  const dias = diasEntre(hoje, { ano: va, mes: vm, dia: vd });
  const emPausa = !!pausaEm(pausas, dataISO(hoje));

  let situacao;
  if (aluno.status === 'novo') situacao = 'novo';
  else if (aluno.status === 'inativo') situacao = 'inativo';
  else if (porMes.get(alvo)?.status === 'informado') situacao = 'informado';
  else if (emPausa && !abertas.length) situacao = 'pausado';
  else if (dias > 5) situacao = 'em_dia';
  else if (dias > 0) situacao = 'renova_em';
  else if (dias === 0) situacao = 'renova_hoje';
  else situacao = 'aguardando';

  return { meses, sequencia, alvo, nomeAlvo: nomeMes(alvo), vencimento, dias, situacao, emPausa, selo: seloAtual(meses) };
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
