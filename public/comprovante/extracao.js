// Renova.AI · Leitura de comprovantes
// Funções puras (sem DOM): extraem os dados do texto do comprovante e
// identificam o aluno. Funcionam no navegador e no Node (para testes).

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'd']);

/** Minúsculas, sem acentos, sem pontuação, espaços simples. */
export function normalizarTexto(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens de um nome, sem partículas ("de", "da", "dos"...). */
export function tokensDoNome(nome) {
  return normalizarTexto(nome)
    .replace(/[0-9]/g, ' ')
    .split(' ')
    .filter((t) => t && !PARTICULAS.has(t));
}

export function normalizarNome(nome) {
  return tokensDoNome(nome).join(' ');
}

/** "JOAO DA SILVA" -> "Joao da Silva" (para exibição). */
export function formatarNome(nome) {
  return String(nome ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p) => (PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

export function formatarValor(v) {
  if (v == null || Number.isNaN(v)) return '';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// ---------------------------------------------------------------------------
// Extração dos dados do comprovante
// ---------------------------------------------------------------------------

const ROTULOS_ORIGEM = [
  'dados de quem pagou', 'dados do pagador', 'nome do pagador', 'dados de origem', 'conta de origem',
  'quem pagou', 'pago por', 'enviado por', 'origem', 'pagador', 'remetente', 'de',
];
const ROTULOS_DESTINO = [
  'dados de quem recebeu', 'dados do recebedor', 'nome do recebedor', 'dados do favorecido', 'dados de destino',
  'conta de destino', 'quem recebeu', 'enviado para', 'destino', 'recebedor',
  'favorecido', 'beneficiario', 'destinatario', 'para',
];

// Palavras que nunca formam um nome de pessoa.
const NAO_NOME = new Set([
  'nome', 'cpf', 'cnpj', 'pix', 'comprovante', 'transferencia', 'enviada', 'enviado',
  'realizada', 'realizado', 'recebida', 'pagamento', 'valor', 'data', 'hora', 'tipo',
  'chave', 'agencia', 'conta', 'corrente', 'poupanca', 'instituicao', 'banco', 'id',
  'transacao', 'autenticacao', 'codigo', 'descricao', 'mensagem', 'origem', 'destino',
  'pagador', 'recebedor', 'favorecido', 'detalhes', 'dados', 'sucesso', 'concluido',
  'concluida', 'aprovado', 'aprovada', 'agendado', 'saldo', 'total', 'tarifa',
]);
// Indícios de que a linha é o nome de um banco/instituição, não de uma pessoa.
const INSTITUICAO = /\b(pagamentos|banco|bank|ltda|instituicao|financeira|cooperativa|nubank|itau|bradesco|santander|sicoob|sicredi|mercado pago|picpay|caixa economica|c6|neon|ip)\b|\bs\s?a$/;
// Linhas de campos técnicos (não contêm o nome).
const CAMPO_TECNICO = /^(cpf|cnpj|instituicao|banco|agencia|conta|chave|tipo|valor|data|id|ispb|autenticacao|codigo|descricao|mensagem)\b/;

function nomePlausivel(texto, { exigirDuasPalavras = true } = {}) {
  const limpo = String(texto ?? '').replace(/[*•.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (limpo.length < 3 || limpo.length > 70) return null;
  if (/[0-9@/\\$%#]/.test(limpo)) return null;
  if (!/^[\p{L}\s'-]+$/u.test(limpo)) return null;
  const norm = normalizarTexto(limpo);
  if (INSTITUICAO.test(norm)) return null;
  const palavras = norm.split(' ');
  if (palavras.some((p) => NAO_NOME.has(p))) return null;
  const significativas = palavras.filter((p) => p.length >= 2 && !PARTICULAS.has(p));
  if (significativas.length === 0) return null;
  if (exigirDuasPalavras && significativas.length < 2) return null;
  return limpo;
}

/** Se a linha começa com um rótulo, devolve { tipo, resto }. */
function casarRotulo(linhaOriginal) {
  const palavrasOrig = linhaOriginal.trim().split(/\s+/);
  const palavrasNorm = palavrasOrig.map((p) => normalizarTexto(p));
  for (const [tipo, lista] of [['origem', ROTULOS_ORIGEM], ['destino', ROTULOS_DESTINO]]) {
    for (const rotulo of lista) {
      const pr = rotulo.split(' ');
      if (pr.every((p, i) => palavrasNorm[i] === p)) {
        const resto = palavrasOrig.slice(pr.length).join(' ').replace(/^[\s:–—-]+/, '').trim();
        return { tipo, resto };
      }
    }
  }
  return null;
}

function extrairNomes(linhas) {
  const r = { origem: null, destino: null };
  let secao = null;
  let limite = -1;

  const atribuir = (tipo, nome) => {
    if (tipo && nome && !r[tipo]) r[tipo] = nome;
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const norm = normalizarTexto(linha);

    const rot = casarRotulo(linha);
    if (rot) {
      // "de"/"para" sozinhos são ambíguos: só valem com nome na mesma linha
      // ou quando são a linha inteira.
      const nome = nomePlausivel(rot.resto, { exigirDuasPalavras: false });
      if (nome) { atribuir(rot.tipo, nome); secao = null; continue; }
      if (rot.resto === '' || /^(da conta|do pix)$/i.test(rot.resto)) {
        secao = rot.tipo; limite = i + 6; continue;
      }
    }

    if (/^nome\b/.test(norm) && secao) {
      const resto = linha.replace(/^\s*nome\s*[:–—-]?\s*/i, '');
      const nome = nomePlausivel(resto, { exigirDuasPalavras: false })
        || nomePlausivel(linhas[i + 1], { exigirDuasPalavras: false });
      if (nome) { atribuir(secao, nome); secao = null; }
      continue;
    }

    if (secao && i <= limite && !CAMPO_TECNICO.test(norm)) {
      const nome = nomePlausivel(linha);
      if (nome) { atribuir(secao, nome); secao = null; }
    }
    if (i > limite) secao = null;
  }
  return r;
}

// "R$ 1.250,00" e também "R$ 300" (alguns apps mostram o valor sem centavos).
const RE_DINHEIRO = /R\s?[$S5]\s*([0-9]{1,3}(?:\.?[0-9]{3})*(?:,[0-9]{2})?)(?![0-9.,])/i;
const RE_NUMERO_BR = /\b([0-9]{1,3}(?:\.?[0-9]{3})*,[0-9]{2})\b/;

function paraNumero(s) {
  return Number(s.replace(/[.\s]/g, '').replace(',', '.'));
}

function extrairValor(linhas) {
  for (let i = 0; i < linhas.length; i++) {
    if (/^valor\b/.test(normalizarTexto(linhas[i]))) {
      for (const l of [linhas[i], linhas[i + 1], linhas[i + 2]]) {
        if (!l) continue;
        const m = l.match(RE_DINHEIRO) || l.match(RE_NUMERO_BR);
        if (m) return paraNumero(m[1]);
      }
    }
  }
  for (const l of linhas) {
    const m = l.match(RE_DINHEIRO);
    if (m) return paraNumero(m[1]);
  }
  return null;
}

const MESES = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4,
  mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8,
  set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12,
};

function dataISO(d, m, a) {
  let ano = Number(a);
  if (ano < 100) ano += 2000;
  const dia = Number(d);
  const mes = Number(m);
  if (!(dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2000 && ano <= 2100)) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function dataDaLinha(linha) {
  let m = linha.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return dataISO(m[1], m[2], m[3]);
  const norm = normalizarTexto(linha);
  m = norm.match(/\b(\d{1,2})\s(?:de\s)?([a-z]{3,9})\s(?:de\s)?(\d{4})\b/);
  if (m && MESES[m[2]]) return dataISO(m[1], MESES[m[2]], m[3]);
  return null;
}

function extrairData(linhas, e2e) {
  for (let i = 0; i < linhas.length; i++) {
    if (/^(data|realizad|efetuad|pago em|enviado em)/.test(normalizarTexto(linhas[i]))) {
      for (const l of [linhas[i], linhas[i + 1]]) {
        const d = l && dataDaLinha(l);
        if (d) return d;
      }
    }
  }
  for (const l of linhas) {
    const d = dataDaLinha(l);
    if (d) return d;
  }
  // Último recurso: a data embutida no ID da transação (UTC).
  if (e2e) return dataISO(e2e.slice(15, 17), e2e.slice(13, 15), e2e.slice(9, 13));
  return null;
}

/**
 * ID fim a fim do Pix: "E" + ISPB (8 dígitos) + aaaaMMddHHmm (12) + 11 alfanuméricos.
 * Tolera quebras de linha/espaços e "O" lido no lugar de "0" pelo OCR.
 */
function extrairE2E(texto) {
  const corrido = texto.replace(/\s+/g, '');
  const re = /E[0-9Oo]{20}[A-Za-z0-9]{11}/g;
  let m;
  while ((m = re.exec(corrido))) {
    const bruto = m[0];
    const id = 'E' + bruto.slice(1, 21).replace(/[Oo]/g, '0') + bruto.slice(21);
    const ano = Number(id.slice(9, 13));
    const mes = Number(id.slice(13, 15));
    const dia = Number(id.slice(15, 17));
    if (ano >= 2020 && ano <= 2100 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return id.toUpperCase();
    }
    re.lastIndex = m.index + 1;
  }
  return null;
}

/**
 * Extrai os dados de um comprovante a partir do texto (OCR ou PDF).
 * @returns {{pagador: string|null, recebedor: string|null, valor: number|null,
 *            data: string|null, e2e: string|null}}
 */
export function extrairDados(texto) {
  const linhas = String(texto ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const nomes = extrairNomes(linhas);
  const e2e = extrairE2E(String(texto ?? ''));
  return {
    pagador: nomes.origem,
    recebedor: nomes.destino,
    valor: extrairValor(linhas),
    data: extrairData(linhas, e2e),
    e2e,
  };
}

// ---------------------------------------------------------------------------
// Identificação do aluno
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  if (a === b) return 0;
  const v = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = v[0];
    v[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = v[j];
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = tmp;
    }
  }
  return v[b.length];
}

function semelhancaToken(t, u) {
  if (t === u) return 1;
  if (t.length === 1 && u.startsWith(t)) return 0.5; // inicial: "P." de "Paula"
  if (u.length === 1 && t.startsWith(u)) return 0.5;
  if (Math.min(t.length, u.length) >= 5 && levenshtein(t, u) <= 1) return 0.9; // erro de OCR
  return 0;
}

const melhor = (t, lista) => lista.reduce((m, u) => Math.max(m, semelhancaToken(t, u)), 0);

/** Semelhança entre dois nomes, de 0 a 1. */
export function semelhancaNomes(a, b) {
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  if (!ta.length || !tb.length) return 0;
  const cobreA = ta.reduce((s, t) => s + melhor(t, tb), 0) / ta.length;
  const cobreB = tb.reduce((s, t) => s + melhor(t, ta), 0) / tb.length;
  let score = (cobreA + cobreB) / 2;
  // O primeiro nome precisa bater; sobrenome igual sozinho é outra pessoa (ex.: a mãe).
  if (semelhancaToken(ta[0], tb[0]) < 0.9) score *= 0.5;
  return Math.round(score * 100) / 100;
}

const LIMIAR_CANDIDATO = 0.6;
const valorBate = (aluno, valor) =>
  valor != null && aluno.mensalidade != null && Math.abs(Number(aluno.mensalidade) - valor) < 0.01;

/**
 * Descobre para qual aluno é o pagamento.
 * @param {string|null} pagador  nome lido no comprovante
 * @param {{alunos: Array<{id:string, nome:string, mensalidade?:number}>,
 *          pagadoresSalvos?: Array<{nome:string, alunoId:string}>,
 *          valor?: number|null}} contexto
 * @returns {{tipo: 'unico'|'ambiguo'|'nenhum',
 *            candidatos: Array<{aluno:object, score:number, valorBate:boolean, motivo:string}>,
 *            sugerido: string|null}}
 */
export function encontrarAluno(pagador, { alunos = [], pagadoresSalvos = [], valor = null } = {}) {
  const vazio = { tipo: 'nenhum', candidatos: [], sugerido: null };
  if (!pagador || !tokensDoNome(pagador).length) return vazio;

  const comValor = (c) => ({ ...c, valorBate: valorBate(c.aluno, valor) });
  const sugerir = (cands) => {
    const batem = cands.filter((c) => c.valorBate);
    return batem.length === 1 ? batem[0].aluno.id : null;
  };

  // 1) Pagador já conhecido ("Maria Souza paga pelo João").
  const chave = normalizarNome(pagador);
  const salvos = pagadoresSalvos
    .filter((s) => normalizarNome(s.nome) === chave)
    .map((s) => alunos.find((a) => a.id === s.alunoId))
    .filter(Boolean)
    .map((aluno) => comValor({ aluno, score: 1, motivo: 'pagador_salvo' }));
  if (salvos.length === 1) return { tipo: 'unico', candidatos: salvos, sugerido: salvos[0].aluno.id };
  if (salvos.length > 1) return { tipo: 'ambiguo', candidatos: salvos, sugerido: sugerir(salvos) };

  // 2) Nome parecido com o de algum aluno.
  const cands = alunos
    .map((aluno) => comValor({ aluno, score: semelhancaNomes(pagador, aluno.nome), motivo: 'nome' }))
    .filter((c) => c.score >= LIMIAR_CANDIDATO)
    .sort((x, y) => y.score - x.score || Number(y.valorBate) - Number(x.valorBate));

  if (cands.length === 0) return vazio;
  if (cands.length === 1) return { tipo: 'unico', candidatos: cands, sugerido: cands[0].aluno.id };

  const [primeiro, segundo] = cands;
  if (primeiro.score >= 0.95 && segundo.score < 0.75) {
    return { tipo: 'unico', candidatos: [primeiro], sugerido: primeiro.aluno.id };
  }
  return { tipo: 'ambiguo', candidatos: cands, sugerido: sugerir(cands) };
}

/** O comprovante foi pago para o personal? true / false / null (não deu para saber). */
export function conferirRecebedor(recebedor, nomesDoPersonal = []) {
  const nomes = (Array.isArray(nomesDoPersonal) ? nomesDoPersonal : [nomesDoPersonal]).filter(Boolean);
  if (!recebedor || !nomes.length) return null;
  return nomes.some((n) => semelhancaNomes(recebedor, n) >= LIMIAR_CANDIDATO);
}

// ---------------------------------------------------------------------------
// Chave contra lançamento duplicado
// ---------------------------------------------------------------------------

async function sha256(texto) {
  const bytes = new TextEncoder().encode(texto);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Chave para detectar comprovante repetido. Guarde só o hash, nunca o ID em si.
 * - 'e2e': hash do ID da transação Pix (exato).
 * - 'aproximada': hash de pagador + valor + data (quando não há ID; serve de alerta).
 */
export async function chaveDoComprovante({ e2e, pagador, valor, data }) {
  if (e2e) return { tipo: 'e2e', hash: await sha256(`e2e:${e2e}`) };
  if (pagador && valor != null && data) {
    return { tipo: 'aproximada', hash: await sha256(`aprox:${normalizarNome(pagador)}|${valor.toFixed(2)}|${data}`) };
  }
  return null;
}
