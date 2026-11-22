// API do Renova.AI: atende tudo que começa com /api/.
import { prepararBanco, FRASES_PADRAO } from '../lib/banco.js';
import { gerarPix, normalizarChave } from '../lib/pix.js';
import { situacaoPacote, pacotesComoRecebimentos, mesesComAula, precoAula } from '../lib/pacotes.js';
import { calcular, fases, hojeBR, chaveMes, somaMes, mesesBase, marcoDe, dataISO } from '../lib/jornada.js';
import {
  lerConfig, validarConfig, valorCobrado, tabelaPlanos, inicioDoTeste, estenderAcesso, situacaoDoAcesso, temAcesso,
  assinaturaPublica, statusDoMP, mesBR, PLANOS, METODOS, MESES_DO_PLANO, parcelasDoPlano,
} from '../lib/assinatura.js';
import {
  chamarMP, mpConfigurado, montarPreferencia, montarPix, dadosDoPix, montarRecorrente, statusRecorrenteDoMP, linkDoCheckout, avisoAutentico, ErroMP,
} from '../lib/mercadopago.js';
import { ANAMNESE, validarAnamnese, lerAnamnese, itensDaAnamnese } from '../lib/anamnese.js';
import { faltantes, ajustesDePausa, filtroDoAluno, resumoDoMes, situacaoMensalidade, vencimentoDe, rotuloMes, serieMensal, posicaoAtual, mesesFuturos, projecaoDoMes } from '../lib/mensalidades.js';

const RESERVADOS = ['api', 'painel', 'aluno', 'convite', 'admin', 'renova', 'renovaai', 'privacidade', 'c', 'a'];
// Modelos de IA, em ordem de preferência: se o primeiro falhar, tenta o seguinte.
// O antigo @cf/meta/llama-3.1-8b-instruct foi desativado pela Cloudflare em 30/05/2026.
const MODELOS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];
const TRINTA_DIAS = 30 * 24 * 3600;

class Falha extends Error {
  constructor(mensagem, status = 400, dados = {}) {
    super(mensagem);
    this.status = status;
    this.dados = dados; // vai junto na resposta de erro
  }
}

function json(dados, status = 200, cabecalhos = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cabecalhos },
  });
}

async function corpo(request) {
  try {
    const texto = await request.text();
    if (texto.length > 800000) throw new Falha('Envio grande demais.', 413);
    return texto ? JSON.parse(texto) : {};
  } catch (e) {
    if (e instanceof Falha) throw e;
    throw new Falha('Não entendi os dados enviados.');
  }
}

function texto(valor, min, max, nomeCampo) {
  const t = String(valor ?? '').trim();
  if (t.length < min || t.length > max) throw new Falha(`Confira o campo ${nomeCampo}.`);
  return t;
}

function inteiro(valor, min, max, nomeCampo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new Falha(`Confira o campo ${nomeCampo}.`);
  return n;
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const aleatorio = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0]; // usado só para cumprimentar o aluno
const dataHoje = () => {
  const h = hojeBR();
  return chaveMes(h.ano, h.mes) + '-' + String(h.dia).padStart(2, '0');
};

async function hashSenha(senha, sal) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(sal), iterations: 100000 },
    chave,
    256
  );
  return hex(bits);
}

// Código de recuperação de senha: 12 caracteres fáceis de ler, no formato XXXX-XXXX-XXXX.
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function novoCodigo() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const texto = [...bytes].map((b) => LETRAS[b % LETRAS.length]).join('');
  return texto.slice(0, 4) + '-' + texto.slice(4, 8) + '-' + texto.slice(8);
}

const limparCodigo = (codigo) => String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCodigo = (codigo, personalId) => hashSenha(limparCodigo(codigo), 'recuperacao-' + personalId);

async function trocarCodigo(db, personalId) {
  const codigo = novoCodigo();
  await db.prepare('UPDATE personais SET recuperacao_hash = ? WHERE id = ?').bind(await hashCodigo(codigo, personalId), personalId).run();
  return codigo;
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function lerCookie(request, nome) {
  const cookies = request.headers.get('cookie') || '';
  for (const parte of cookies.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return null;
}

const cookieSessao = (token, duracao) =>
  `sessao=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${duracao}`;

async function abrirSessao(db, personalId) {
  const token = aleatorio(32);
  const expira = Math.floor(Date.now() / 1000) + TRINTA_DIAS;
  await db.prepare('INSERT INTO sessoes (token, personal_id, expira_em) VALUES (?, ?, ?)').bind(token, personalId, expira).run();
  return cookieSessao(token, TRINTA_DIAS);
}

// "livre": rotas que funcionam mesmo com o teste ou o plano vencido (assinar, recuperar senha).
// As demais respondem 402 e o painel mostra a tela de planos.
async function personalLogado(request, db, { livre = false } = {}) {
  const token = lerCookie(request, 'sessao');
  if (!token) throw new Falha('Entre na sua conta.', 401);
  const agora = Math.floor(Date.now() / 1000);
  const p = await db
    .prepare('SELECT p.* FROM sessoes s JOIN personais p ON p.id = s.personal_id WHERE s.token = ? AND s.expira_em > ?')
    .bind(token, agora)
    .first();
  if (!p) throw new Falha('Entre na sua conta.', 401);
  if (!livre && !temAcesso(p)) {
    const situacao = situacaoDoAcesso(p);
    const mensagem =
      situacao === 'bloqueada'
        ? 'Sua conta está suspensa. Fale com o suporte.'
        : situacao === 'teste_encerrado'
          ? 'Seu teste grátis terminou. Assine para continuar.'
          : 'Seu plano venceu. Renove para continuar.';
    throw new Falha(mensagem, 402, { travado: true, assinatura: assinaturaPublica(p) });
  }
  return p;
}

async function configDoApp(db) {
  const linha = await db.prepare("SELECT valor FROM meta WHERE chave = 'config_assinatura'").first();
  return lerConfig(linha?.valor);
}

function personalPublico(p) {
  return {
    nome: p.nome,
    slug: p.slug,
    email: p.email,
    pixTipo: p.pix_tipo,
    pixChave: p.pix_chave,
    pixNome: p.pix_nome,
    pixCidade: p.pix_cidade,
    valorPadrao: p.valor_padrao,
    diaPadrao: p.dia_padrao,
    tom: p.tom,
    temFoto: !!p.foto,
    temCodigo: !!p.recuperacao_hash,
    assinatura: assinaturaPublica(p),
  };
}

function normalizarWhats(valor) {
  let digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos;
  if (digitos.length < 12 || digitos.length > 13) throw new Falha('Confira o WhatsApp, com DDD.');
  return digitos;
}

function dataValida(valor, nomeCampo) {
  const t = String(valor || '');
  const d = new Date(t + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t || t < '1990-01-01') {
    throw new Falha(`Confira o campo ${nomeCampo}.`);
  }
  return t;
}

async function semDuplicado(db, personalId, whatsapp, ignorarId = 0) {
  const outro = await db
    .prepare('SELECT nome FROM alunos WHERE personal_id = ? AND whatsapp = ? AND id != ?')
    .bind(personalId, whatsapp, ignorarId)
    .first();
  if (outro) throw new Falha(`Este WhatsApp já está cadastrado (${outro.nome}).`, 409);
}

const COLUNAS_PAGAMENTO = 'aluno_id, mes, status, vencimento, valor_previsto, recebido_em, valor_recebido';

async function pagamentosDe(db, alunoId) {
  const r = await db.prepare(`SELECT ${COLUNAS_PAGAMENTO} FROM pagamentos WHERE aluno_id = ?`).bind(alunoId).all();
  return r.results || [];
}

async function pacotesEAulasDe(db, alunoId) {
  const pacotes = (await db.prepare('SELECT id, aulas, valor, recebido_em FROM pacotes WHERE aluno_id = ?').bind(alunoId).all()).results || [];
  const aulas = (await db.prepare('SELECT id, data FROM aulas WHERE aluno_id = ?').bind(alunoId).all()).results || [];
  return { pacotes, aulas };
}

async function pausasDe(db, alunoId) {
  const r = await db.prepare('SELECT id, aluno_id, inicio, fim, cobrar FROM pausas WHERE aluno_id = ? ORDER BY inicio').bind(alunoId).all();
  return r.results || [];
}

// Cria as mensalidades que faltam e acerta as que caíram (ou deixaram de cair) em pausa.
// Devolve a lista atualizada e os comandos para gravar tudo de uma vez.
function sincronizar(db, aluno, pagamentos, pausas, hoje) {
  const comandos = [];
  const lista = pagamentos.slice();
  for (const n of faltantes(aluno, pagamentos, pausas, hoje)) {
    lista.push({ aluno_id: aluno.id, recebido_em: null, valor_recebido: null, ...n });
    comandos.push(
      db
        .prepare('INSERT INTO pagamentos (aluno_id, mes, status, valor_previsto, vencimento) VALUES (?, ?, ?, ?, ?) ON CONFLICT (aluno_id, mes) DO NOTHING')
        .bind(aluno.id, n.mes, n.status, n.valor_previsto, n.vencimento)
    );
  }
  for (const m of ajustesDePausa(lista, pausas)) {
    lista.find((p) => p.mes === m.mes).status = m.status;
    comandos.push(db.prepare('UPDATE pagamentos SET status = ? WHERE aluno_id = ? AND mes = ?').bind(m.status, aluno.id, m.mes));
  }
  return { pagamentos: lista, comandos };
}

// Carrega um aluno com mensalidades e pausas já em dia.
async function estadoDoAluno(db, aluno, hoje = hojeBR()) {
  const pausas = await pausasDe(db, aluno.id);
  const { pagamentos, comandos } = sincronizar(db, aluno, await pagamentosDe(db, aluno.id), pausas, hoje);
  if (comandos.length) await db.batch(comandos);
  return { pagamentos, pausas, hoje };
}

function mensalidadeParaPainel(m, hoje) {
  return {
    mes: m.mes,
    rotulo: rotuloMes(m.mes),
    situacao: situacaoMensalidade(m, hoje),
    informado: m.status === 'informado',
    vencimento: m.vencimento,
    valor: m.valor_previsto,
    recebidoEm: m.recebido_em,
    valorRecebido: m.valor_recebido,
    adiantado: m.status === 'confirmado' && m.mes > chaveMes(hoje.ano, hoje.mes),
  };
}

// Para quem paga adiantado: último mês de uma sequência paga que começa no mês atual e passa dele.
function pagoAte(pagamentos, hoje) {
  const pagos = new Set(pagamentos.filter((p) => p.status === 'confirmado').map((p) => p.mes));
  const atual = chaveMes(hoje.ano, hoje.mes);
  let mes = atual;
  while (pagos.has(somaMes(mes, 1))) mes = somaMes(mes, 1);
  return pagos.has(atual) && mes > atual ? rotuloMes(mes) : null;
}

function alunoParaPainel(a, pagamentos, pausas, hoje, pacotes = [], aulas = []) {
  const ehPacote = a.modo === 'pacote';
  // Aluno de pacote: a trilha conta os meses em que teve aula.
  const c = calcular(a, ehPacote ? mesesComAula(aulas, hoje) : pagamentos, hoje, pausas);
  const pac = ehPacote ? situacaoPacote(a, pacotes, aulas, pausas, hoje) : null;
  const abertas = pagamentos
    .filter((m) => m.status === 'aberto' || m.status === 'informado')
    .sort((x, y) => (x.mes < y.mes ? -1 : 1))
    .map((m) => mensalidadeParaPainel(m, hoje));
  return {
    id: a.id,
    token: a.token,
    nome: a.nome,
    whatsapp: a.whatsapp,
    status: a.status,
    emPausa: c.emPausa,
    valor: a.valor,
    diaVenc: a.dia_venc,
    dataInicio: a.data_inicio,
    baseMeses: a.base_meses,
    mesInicio: a.mes_inicio,
    mesesPausa: a.meses_pausa,
    meses: c.meses,
    sequencia: c.sequencia,
    alvo: c.alvo,
    nomeAlvo: c.nomeAlvo,
    dias: c.dias,
    situacao: c.situacao,
    filtro: filtroDoAluno(a, pagamentos, c.emPausa, hoje),
    abertas,
    modo: ehPacote ? 'pacote' : 'mensal',
    anamnese: lerAnamnese(a.anamnese),
    ...(ehPacote && {
      situacao: pac.situacao,
      // Mensalidade antiga ainda em aberto (de antes de mudar para pacote) pesa mais que o pacote.
      filtro: abertas.some((m) => m.situacao === 'atrasado') ? 'atrasado' : abertas.length && pac.filtro !== 'atrasado' ? 'pendente' : pac.filtro,
      saldo: pac.saldo,
      pacoteAulas: a.pacote_aulas,
      precoAula: precoAula(a),
      pacoteInformado: !!a.pacote_informado_em,
      aVencerPacote: pac.aVencer,
      emAtrasoPacote: pac.emAtraso,
    }),
    totalAberto: abertas.reduce((t, m) => t + (m.valor || 0), 0),
    pausas: pausas.map((p) => ({ id: p.id, inicio: p.inicio, fim: p.fim, cobrar: !!p.cobrar })),
    pagoAte: pagoAte(pagamentos, hoje),
    proximoMarco: marcoDe(c.meses + 1),
    lembradoHoje: a.lembrado_em === dataHoje(),
  };
}

// Forma de cobrança enviada pelo painel: mensalidade (valor + dia) ou pacote de aulas (valor do pacote + aulas).
function lerCobranca(d, atual = {}) {
  const modo = d.modo === 'pacote' ? 'pacote' : d.modo === 'mensal' ? 'mensal' : atual.modo || 'mensal';
  if (modo === 'pacote') {
    return {
      modo,
      valor: inteiro(d.valor, 100, 10000000, 'valor do pacote'),
      pacoteAulas: inteiro(d.pacoteAulas, 1, 200, 'aulas no pacote'),
      dia: d.diaVenc ? inteiro(d.diaVenc, 1, 31, 'dia de vencimento') : atual.dia_venc || null,
    };
  }
  return { modo, valor: inteiro(d.valor, 100, 10000000, 'mensalidade'), pacoteAulas: atual.pacote_aulas || null, dia: inteiro(d.diaVenc, 1, 31, 'dia de vencimento') };
}

// Registra um pacote pago. Pagar o pacote apaga o aviso "já paguei" do aluno.
function comandosPacote(db, alunoId, aulas, valor, data) {
  return [
    db.prepare('INSERT INTO pacotes (aluno_id, aulas, valor, recebido_em, criado_em) VALUES (?, ?, ?, ?, ?)').bind(alunoId, aulas, valor, data, new Date().toISOString()),
    db.prepare('UPDATE alunos SET pacote_informado_em = NULL WHERE id = ?').bind(alunoId),
  ];
}

async function alunoDoPersonal(db, personal, id) {
  const a = await db.prepare('SELECT * FROM alunos WHERE id = ? AND personal_id = ?').bind(Number(id), personal.id).first();
  if (!a) throw new Falha('Aluno não encontrado.', 404);
  return a;
}

async function pedirIA(env, sistema, pedido) {
  if (!env.AI) throw new Falha('A IA ainda não está ligada neste app. Use o texto padrão.', 503);
  const modelos = env.AI_MODEL ? [env.AI_MODEL, ...MODELOS] : MODELOS;
  let ultimoErro = '';
  for (const modelo of modelos) {
    try {
      const r = await env.AI.run(modelo, {
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: pedido },
        ],
        max_tokens: 350,
        temperature: 0.9,
      });
      const saida = r?.response ?? r?.choices?.[0]?.message?.content ?? '';
      if (!String(saida).trim()) throw new Error('resposta vazia');
      return String(saida).trim();
    } catch (e) {
      ultimoErro = String(e?.message || e);
      console.error('IA', modelo, ultimoErro); // aparece em Observability, no painel da Cloudflare
    }
  }
  // 4006: acabou a cota gratuita do dia (volta no dia seguinte).
  const limite = /4006|daily free allocation|neurons/i.test(ultimoErro);
  throw new Falha(
    limite
      ? 'A IA chegou ao limite gratuito de hoje. Amanhã ela volta; até lá, use o texto padrão.'
      : 'A IA não respondeu agora. Tente de novo em alguns minutos ou use o texto padrão.',
    503
  );
}

const TONS = {
  zoeiro: 'bem-humorado e brincalhão, como piada interna de academia',
  motivador: 'motivador e positivo',
  carinhoso: 'carinhoso e acolhedor',
};

// ---------- Rotas ----------

async function rotear(request, env, partes) {
  const db = env.DB;
  const metodo = request.method;
  const [a, b, c] = partes;

  // --- Conta do personal ---
  if (a === 'conta' && b === 'criar' && metodo === 'POST') {
    const d = await corpo(request);
    const nome = texto(d.nome, 2, 60, 'nome');
    const email = texto(d.email, 5, 120, 'e-mail').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Falha('Confira o e-mail.');
    const senha = String(d.senha || '');
    if (senha.length < 8 || senha.length > 100) throw new Falha('A senha precisa ter pelo menos 8 caracteres.');
    const slug = texto(d.slug, 3, 30, 'link').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || RESERVADOS.includes(slug)) {
      throw new Falha('O link pode ter letras, números e hífen, com 3 a 30 caracteres.');
    }
    const existe = await db.prepare('SELECT email, slug FROM personais WHERE email = ? OR slug = ?').bind(email, slug).first();
    if (existe) throw new Falha(existe.email === email ? 'Já existe uma conta com esse e-mail.' : 'Esse link já está em uso. Escolha outro.');
    const sal = aleatorio(16);
    const hash = await hashSenha(senha, sal);
    const criacao = new Date();
    const r = await db
      .prepare("INSERT INTO personais (slug, nome, email, senha_hash, senha_sal, criado_em, plano, acesso_ate) VALUES (?, ?, ?, ?, ?, ?, 'teste', ?)")
      .bind(slug, nome, email, hash, sal, criacao.toISOString(), inicioDoTeste(criacao, await configDoApp(db)))
      .run();
    const id = r.meta.last_row_id;
    await db.batch(FRASES_PADRAO.map((f) => db.prepare("INSERT INTO frases (personal_id, texto, origem) VALUES (?, ?, 'padrao')").bind(id, f)));
    const codigo = await trocarCodigo(db, id);
    return json({ ok: true, codigo }, 200, { 'set-cookie': await abrirSessao(db, id) });
  }

  // Esqueci minha senha: e-mail + código de recuperação + senha nova.
  if (a === 'conta' && b === 'redefinir' && metodo === 'POST') {
    const d = await corpo(request);
    const email = String(d.email || '').trim().toLowerCase();
    const senha = String(d.senha || '');
    if (senha.length < 8 || senha.length > 100) throw new Falha('A senha nova precisa ter pelo menos 8 caracteres.');
    const p = await db.prepare('SELECT * FROM personais WHERE email = ?').bind(email).first();
    const hash = await hashCodigo(d.codigo, p ? p.id : 0);
    if (!p || !p.recuperacao_hash || !iguais(hash, p.recuperacao_hash)) {
      throw new Falha('E-mail ou código de recuperação incorretos.', 401);
    }
    const sal = aleatorio(16);
    await db.batch([
      db.prepare('UPDATE personais SET senha_hash = ?, senha_sal = ? WHERE id = ?').bind(await hashSenha(senha, sal), sal, p.id),
      db.prepare('DELETE FROM sessoes WHERE personal_id = ?').bind(p.id),
    ]);
    // O código usado deixa de valer; a pessoa recebe um novo para guardar.
    const codigo = await trocarCodigo(db, p.id);
    return json({ ok: true, codigo }, 200, { 'set-cookie': await abrirSessao(db, p.id) });
  }

  if (a === 'conta' && b === 'recuperacao' && metodo === 'POST') {
    const p = await personalLogado(request, db, { livre: true });
    return json({ codigo: await trocarCodigo(db, p.id) });
  }

  if (a === 'admin') return rotasAdmin(request, env, db, partes.slice(1));
  if (a === 'assinatura') return rotasAssinatura(request, env, db, partes.slice(1));

  if (a === 'conta' && b === 'entrar' && metodo === 'POST') {
    const d = await corpo(request);
    const email = String(d.email || '').trim().toLowerCase();
    const p = await db.prepare('SELECT * FROM personais WHERE email = ?').bind(email).first();
    const hash = await hashSenha(String(d.senha || ''), p ? p.senha_sal : 'sem-conta');
    if (!p || !iguais(hash, p.senha_hash)) throw new Falha('E-mail ou senha incorretos.', 401);
    return json({ ok: true }, 200, { 'set-cookie': await abrirSessao(db, p.id) });
  }

  if (a === 'conta' && b === 'sair' && metodo === 'POST') {
    const token = lerCookie(request, 'sessao');
    if (token) await db.prepare('DELETE FROM sessoes WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'set-cookie': cookieSessao('', 0) });
  }

  if (a === 'conta' && !b && metodo === 'PUT') {
    const p = await personalLogado(request, db);
    const d = await corpo(request);
    const nome = texto(d.nome, 2, 60, 'nome');
    const tipos = ['cpf_cnpj', 'celular', 'email', 'aleatoria'];
    const pixTipo = tipos.includes(d.pixTipo) ? d.pixTipo : null;
    const pixChave = pixTipo && String(d.pixChave || '').trim() ? normalizarChave(pixTipo, d.pixChave).slice(0, 80) : null;
    const pixNome = String(d.pixNome || '').trim().slice(0, 60) || null;
    const pixCidade = String(d.pixCidade || '').trim().slice(0, 40) || null;
    // Mensalidade e vencimento são definidos aluno a aluno; não há mais valor sugerido.
    const valorPadrao = null;
    const diaPadrao = null;
    const tom = TONS[d.tom] ? d.tom : 'zoeiro';
    await db
      .prepare('UPDATE personais SET nome = ?, pix_tipo = ?, pix_chave = ?, pix_nome = ?, pix_cidade = ?, valor_padrao = ?, dia_padrao = ?, tom = ? WHERE id = ?')
      .bind(nome, pixTipo, pixChave, pixNome, pixCidade, valorPadrao, diaPadrao, tom, p.id)
      .run();
    return json({ ok: true });
  }

  // --- Painel ---
  if (a === 'painel' && metodo === 'GET') {
    const p = await personalLogado(request, db);
    const hoje = hojeBR();
    const alunos = (await db.prepare('SELECT * FROM alunos WHERE personal_id = ? ORDER BY nome COLLATE NOCASE').bind(p.id).all()).results || [];
    const pags = (
      await db
        .prepare(`SELECT ${COLUNAS_PAGAMENTO.replace(/(\w+)/g, 'g.$1')} FROM pagamentos g JOIN alunos al ON al.id = g.aluno_id WHERE al.personal_id = ?`)
        .bind(p.id)
        .all()
    ).results || [];
    const paus = (
      await db
        .prepare('SELECT u.id, u.aluno_id, u.inicio, u.fim, u.cobrar FROM pausas u JOIN alunos al ON al.id = u.aluno_id WHERE al.personal_id = ? ORDER BY u.inicio')
        .bind(p.id)
        .all()
    ).results || [];
    const agrupar = (linhas) => {
      const mapa = new Map();
      for (const l of linhas) {
        if (!mapa.has(l.aluno_id)) mapa.set(l.aluno_id, []);
        mapa.get(l.aluno_id).push(l);
      }
      return mapa;
    };
    const pacs = (
      await db
        .prepare('SELECT k.id, k.aluno_id, k.aulas, k.valor, k.recebido_em FROM pacotes k JOIN alunos al ON al.id = k.aluno_id WHERE al.personal_id = ?')
        .bind(p.id)
        .all()
    ).results || [];
    const auls = (
      await db
        .prepare('SELECT u.id, u.aluno_id, u.data FROM aulas u JOIN alunos al ON al.id = u.aluno_id WHERE al.personal_id = ?')
        .bind(p.id)
        .all()
    ).results || [];
    const pagsPorAluno = agrupar(pags);
    const pausPorAluno = agrupar(paus);
    const pacsPorAluno = agrupar(pacs);
    const aulsPorAluno = agrupar(auls);
    const comandos = [];
    const todos = [];
    const saida = alunos.map((al) => {
      const pausas = pausPorAluno.get(al.id) || [];
      const r = sincronizar(db, al, pagsPorAluno.get(al.id) || [], pausas, hoje);
      comandos.push(...r.comandos);
      todos.push(...r.pagamentos);
      return alunoParaPainel(al, r.pagamentos, pausas, hoje, pacsPorAluno.get(al.id) || [], aulsPorAluno.get(al.id) || []);
    });
    if (comandos.length) await db.batch(comandos);
    // Pacotes pagos entram no faturamento pela data do recebimento; os que acabaram ou estão devendo aulas, nos totais em aberto.
    const recebimentos = [...todos, ...pacotesComoRecebimentos(pacs)];
    const somaPacote = (campo) => saida.reduce((t, x) => t + (x[campo] || 0), 0);
    const resumo = resumoDoMes(recebimentos, hoje);
    resumo.pendente += somaPacote('aVencerPacote');
    resumo.atrasado += somaPacote('emAtrasoPacote');
    const posicao = posicaoAtual(todos, hoje);
    posicao.aVencer += somaPacote('aVencerPacote');
    posicao.emAtraso += somaPacote('emAtrasoPacote');
    const frases = (await db.prepare('SELECT id, texto, ativa, origem FROM frases WHERE personal_id = ? ORDER BY id').bind(p.id).all()).results || [];
    return json({
      personal: personalPublico(p),
      hoje: dataISO(hoje),
      mesAtual: rotuloMes(chaveMes(hoje.ano, hoje.mes)),
      resumo,
      financeiro: {
        meses: serieMensal(recebimentos, hoje, 12, mesesFuturos(todos, hoje)).map((m) =>
          // Mês que ainda não chegou: o previsto vem do cadastro dos alunos.
          m.futuro ? { ...m, ...projecaoDoMes(alunos, pagsPorAluno, pausPorAluno, m.mes) } : m
        ),
        atual: 11, // posição do mês atual na lista acima
        ...posicao,
        temPacote: saida.some((x) => x.modo === 'pacote'),
        alunos: {
          ativos: saida.filter((x) => x.status === 'ativo' && !x.emPausa).length,
          pausados: saida.filter((x) => x.status === 'ativo' && x.emPausa).length,
          inadimplentes: saida.filter((x) => x.filtro === 'atrasado').length,
          inativos: saida.filter((x) => x.status === 'inativo').length,
        },
      },
      alunos: saida,
      frases: frases.map((f) => ({ id: f.id, texto: f.texto, ativa: !!f.ativa, origem: f.origem })),
    });
  }

  // --- Foto do personal ---
  if (a === 'foto' && !b && metodo === 'PUT') {
    const p = await personalLogado(request, db);
    const d = await corpo(request);
    const foto = String(d.foto || '');
    if (!foto.startsWith('data:image/jpeg;base64,') || foto.length > 600000) throw new Falha('Não consegui usar essa foto. Tente outra.');
    await db.prepare('UPDATE personais SET foto = ? WHERE id = ?').bind(foto, p.id).run();
    return json({ ok: true });
  }

  if (a === 'foto' && b && metodo === 'GET') {
    const p = await db.prepare('SELECT foto FROM personais WHERE slug = ?').bind(String(b).toLowerCase()).first();
    if (!p || !p.foto) return new Response('Sem foto', { status: 404 });
    const binario = atob(p.foto.split(',')[1]);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=300' } });
  }

  // --- Alunos (ações do personal) ---
  if (a === 'alunos' && !b && metodo === 'POST') {
    const p = await personalLogado(request, db);
    const d = await corpo(request);
    const nome = texto(d.nome, 2, 60, 'nome');
    const whats = normalizarWhats(d.whatsapp);
    await semDuplicado(db, p.id, whats);
    const { modo, valor, pacoteAulas, dia } = lerCobranca(d);
    const hoje = hojeBR();
    const mesCadastro = chaveMes(hoje.ano, hoje.mes);
    const dataInicio = d.dataInicio ? dataValida(d.dataInicio, 'data de início') : null;
    if (dataInicio && dataInicio > dataISO(hoje)) throw new Falha('A data de início não pode ser no futuro.');
    const mesInicio = dataInicio ? dataInicio.slice(0, 7) : null;
    const mesControle = d.primeiroMes === 'proximo' && modo === 'mensal' ? somaMes(mesCadastro, 1) : mesCadastro;
    const total = await db.prepare('SELECT COUNT(*) AS n FROM alunos WHERE personal_id = ?').bind(p.id).first();
    if (total.n >= 500) throw new Falha('Você chegou ao limite de 500 alunos.');
    const base = mesesBase(mesInicio, mesCadastro, mesControle, 0);
    const r = await db
      .prepare(
        'INSERT INTO alunos (personal_id, token, nome, whatsapp, mes_inicio, data_inicio, meses_pausa, base_meses, seq_base, mes_cadastro, mes_controle, status, valor, dia_venc, modo, pacote_aulas, criado_em) ' +
          "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'ativo', ?, ?, ?, ?, ?)"
      )
      .bind(p.id, aleatorio(12), nome, whats, mesInicio, dataInicio, base, base, mesCadastro, mesControle, valor, dia, modo, pacoteAulas, new Date().toISOString())
      .run();
    const id = r.meta.last_row_id;
    if (modo === 'pacote' && d.pacotePago) await db.batch(comandosPacote(db, id, pacoteAulas, valor, dataISO(hoje)));
    return json({ ok: true, id });
  }

  if (a === 'alunos' && b) {
    const p = await personalLogado(request, db);
    const aluno = await alunoDoPersonal(db, p, b);
    const d4 = partes[3];
    const hoje = hojeBR();
    const mesAtual = chaveMes(hoje.ano, hoje.mes);

    // Editar o cadastro (ou confirmar um aluno que veio pelo convite).
    if (!c && metodo === 'PUT') {
      const d = await corpo(request);
      const nome = d.nome == null ? aluno.nome : texto(d.nome, 2, 60, 'nome');
      const whats = d.whatsapp == null ? aluno.whatsapp : normalizarWhats(d.whatsapp);
      if (whats !== aluno.whatsapp) await semDuplicado(db, p.id, whats, aluno.id);
      const { modo, valor, pacoteAulas, dia } = lerCobranca(d, aluno);
      const status = d.status === 'inativo' ? 'inativo' : 'ativo';
      let dataInicio = aluno.data_inicio;
      if (d.dataInicio !== undefined) dataInicio = d.dataInicio ? dataValida(d.dataInicio, 'data de início') : null;
      if (dataInicio && dataInicio > dataISO(hoje)) throw new Falha('A data de início não pode ser no futuro.');
      const mesInicio = dataInicio ? dataInicio.slice(0, 7) : aluno.mes_inicio;

      let mesControle = aluno.mes_controle;
      let base = aluno.base_meses;
      let seqBase = aluno.seq_base;
      let gerarDesde = aluno.gerar_desde;
      if (aluno.status === 'novo' || !mesControle) {
        mesControle = d.primeiroMes === 'proximo' && modo === 'mensal' ? somaMes(mesAtual, 1) : mesAtual;
        base = mesesBase(mesInicio, aluno.mes_cadastro, mesControle, aluno.meses_pausa);
        seqBase = aluno.meses_pausa > 0 ? 0 : base;
      }
      if (mesInicio) {
        // Com data de início, os meses de treino saem da própria data.
        base = mesesBase(mesInicio, aluno.mes_cadastro, mesControle, aluno.meses_pausa);
        seqBase = aluno.meses_pausa > 0 ? 0 : base;
      } else if (d.baseMeses != null) {
        const informada = inteiro(d.baseMeses, 0, 600, 'meses de treino');
        if (informada !== base) {
          base = informada;
          seqBase = aluno.meses_pausa > 0 ? 0 : informada;
        }
      }
      if (aluno.status === 'inativo' && status === 'ativo') gerarDesde = mesAtual; // não cobra o período inativo
      // Voltando de pacote para mensalidade: as mensalidades recomeçam no mês atual, sem cobrar o período de pacote.
      if (aluno.modo === 'pacote' && modo === 'mensal' && aluno.status !== 'novo') gerarDesde = mesAtual;

      await db.batch([
        db
          .prepare(
            'UPDATE alunos SET nome = ?, whatsapp = ?, data_inicio = ?, mes_inicio = ?, valor = ?, dia_venc = ?, base_meses = ?, seq_base = ?, mes_controle = ?, gerar_desde = ?, status = ?, modo = ?, pacote_aulas = ? WHERE id = ?'
          )
          .bind(nome, whats, dataInicio, mesInicio, valor, dia, base, seqBase, mesControle, gerarDesde, status, modo, pacoteAulas, aluno.id),
        // Mensalidades ainda dentro do prazo acompanham o novo valor e o novo dia.
        ...(modo === 'mensal'
          ? [db
              .prepare("UPDATE pagamentos SET valor_previsto = ?, vencimento = mes || '-' || ? WHERE aluno_id = ? AND status = 'aberto' AND vencimento >= ?")
              .bind(valor, String(dia).padStart(2, '0'), aluno.id, dataISO(hoje))]
          : []),
        // Passando para pacote: a mensalidade deste mês ainda em aberto deixa de ser cobrada.
        ...(modo === 'pacote' && aluno.modo !== 'pacote'
          ? [db.prepare("UPDATE pagamentos SET status = 'dispensado' WHERE aluno_id = ? AND status = 'aberto' AND mes >= ?").bind(aluno.id, mesAtual)]
          : []),
        ...(modo === 'pacote' && d.pacotePago ? comandosPacote(db, aluno.id, pacoteAulas, valor, dataISO(hoje)) : []),
      ]);
      return json({ ok: true });
    }

    if (!c && metodo === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM pagamentos WHERE aluno_id = ?').bind(aluno.id),
        db.prepare('DELETE FROM pausas WHERE aluno_id = ?').bind(aluno.id),
        db.prepare('DELETE FROM pacotes WHERE aluno_id = ?').bind(aluno.id),
        db.prepare('DELETE FROM aulas WHERE aluno_id = ?').bind(aluno.id),
        db.prepare('DELETE FROM alunos WHERE id = ?').bind(aluno.id),
      ]);
      return json({ ok: true });
    }

    // Histórico de mensalidades do aluno.
    if (c === 'mensalidades' && !d4 && metodo === 'GET') {
      const { pagamentos } = await estadoDoAluno(db, aluno, hoje);
      const pacotes = (await db.prepare('SELECT id, aulas, valor, recebido_em FROM pacotes WHERE aluno_id = ? ORDER BY recebido_em DESC, id DESC').bind(aluno.id).all()).results || [];
      const aulas = (await db.prepare('SELECT id, data FROM aulas WHERE aluno_id = ? ORDER BY data DESC, id DESC LIMIT 200').bind(aluno.id).all()).results || [];
      return json({
        mensalidades: pagamentos.sort((x, y) => (x.mes < y.mes ? 1 : -1)).map((m) => mensalidadeParaPainel(m, hoje)),
        pacotes: pacotes.map((k) => ({ id: k.id, aulas: k.aulas, valor: k.valor, recebidoEm: k.recebido_em })),
        aulas: aulas.map((u) => ({ id: u.id, data: u.data })),
        anamnese: itensDaAnamnese(aluno.anamnese, 'você'),
      });
    }

    // Aulas dadas (aluno de pacote): registrar e apagar.
    if (c === 'aulas') {
      if (metodo === 'POST' && !d4) {
        const d = await corpo(request);
        const data = d.data ? dataValida(d.data, 'data da aula') : dataISO(hoje);
        if (data > dataISO(hoje)) throw new Falha('A data da aula não pode ser no futuro.');
        const r = await db.prepare('INSERT INTO aulas (aluno_id, data, criado_em) VALUES (?, ?, ?)').bind(aluno.id, data, new Date().toISOString()).run();
        return json({ ok: true, id: r.meta.last_row_id });
      }
      if (metodo === 'DELETE' && d4) {
        await db.prepare('DELETE FROM aulas WHERE id = ? AND aluno_id = ?').bind(Number(d4), aluno.id).run();
        return json({ ok: true });
      }
    }

    // Pacotes pagos: registrar, corrigir e apagar.
    if (c === 'pacotes') {
      if ((metodo === 'POST' && !d4) || (metodo === 'PUT' && d4)) {
        const d = await corpo(request);
        const aulas = inteiro(d.aulas, 1, 200, 'aulas no pacote');
        const valor = inteiro(d.valor, 1, 10000000, 'valor recebido');
        const data = d.data ? dataValida(d.data, 'data do recebimento') : dataISO(hoje);
        if (data > dataISO(hoje)) throw new Falha('A data do recebimento não pode ser no futuro.');
        if (metodo === 'POST') await db.batch(comandosPacote(db, aluno.id, aulas, valor, data));
        else await db.prepare('UPDATE pacotes SET aulas = ?, valor = ?, recebido_em = ? WHERE id = ? AND aluno_id = ?').bind(aulas, valor, data, Number(d4), aluno.id).run();
        return json({ ok: true });
      }
      if (metodo === 'DELETE' && d4) {
        await db.prepare('DELETE FROM pacotes WHERE id = ? AND aluno_id = ?').bind(Number(d4), aluno.id).run();
        return json({ ok: true });
      }
    }

    // Marcar como paga, corrigir, reabrir ou dispensar uma mensalidade.
    if (c === 'mensalidades' && d4 && metodo === 'POST') {
      const mes = String(d4);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || mes < '2000-01' || mes > somaMes(mesAtual, 12)) throw new Falha('Mês inválido.');
      const d = await corpo(request);
      const atual = await db.prepare('SELECT * FROM pagamentos WHERE aluno_id = ? AND mes = ?').bind(aluno.id, mes).first();
      const previsto = atual?.valor_previsto ?? aluno.valor ?? 0;
      const vencimento = atual?.vencimento || vencimentoDe(mes, aluno.dia_venc);

      if (d.acao === 'pagar') {
        const data = d.data ? dataValida(d.data, 'data do recebimento') : dataISO(hoje);
        if (data > dataISO(hoje)) throw new Falha('A data do recebimento não pode ser no futuro.');
        const valor = d.valor == null ? previsto : inteiro(d.valor, 1, 10000000, 'valor recebido');
        if (!(valor > 0)) throw new Falha('Informe o valor recebido.');
        await db
          .prepare(
            "INSERT INTO pagamentos (aluno_id, mes, status, valor_previsto, vencimento, recebido_em, valor_recebido, confirmado_em) VALUES (?, ?, 'confirmado', ?, ?, ?, ?, ?) " +
              "ON CONFLICT (aluno_id, mes) DO UPDATE SET status = 'confirmado', recebido_em = excluded.recebido_em, valor_recebido = excluded.valor_recebido, confirmado_em = excluded.confirmado_em"
          )
          .bind(aluno.id, mes, previsto || valor, vencimento, data, valor, new Date().toISOString())
          .run();
        return json({ ok: true });
      }
      if (!atual) throw new Falha('Mensalidade não encontrada.', 404);
      if (d.acao === 'reabrir' && mes > mesAtual) {
        // Desfazer um pagamento adiantado: o mês volta a não existir até chegar a vez dele.
        await db.prepare('DELETE FROM pagamentos WHERE aluno_id = ? AND mes = ?').bind(aluno.id, mes).run();
        return json({ ok: true });
      }
      if (d.acao === 'reabrir' || d.acao === 'dispensar') {
        await db
          .prepare('UPDATE pagamentos SET status = ?, recebido_em = NULL, valor_recebido = NULL, confirmado_em = NULL WHERE aluno_id = ? AND mes = ?')
          .bind(d.acao === 'reabrir' ? 'aberto' : 'dispensado', aluno.id, mes)
          .run();
        return json({ ok: true });
      }
      throw new Falha('Ação desconhecida.');
    }

    // Pausas nos treinos.
    if (c === 'pausas') {
      if (metodo === 'DELETE' && d4) {
        await db.prepare('DELETE FROM pausas WHERE id = ? AND aluno_id = ?').bind(Number(d4), aluno.id).run();
      } else if (metodo === 'POST' || (metodo === 'PUT' && d4)) {
        const d = await corpo(request);
        const inicio = dataValida(d.inicio, 'início da pausa');
        const fim = d.fim ? dataValida(d.fim, 'fim da pausa') : null;
        if (fim && fim < inicio) throw new Falha('O fim da pausa não pode ser antes do início.');
        const outras = (await pausasDe(db, aluno.id)).filter((x) => x.id !== Number(d4 || 0));
        if (outras.some((x) => x.inicio <= (fim || '9999-12-31') && (x.fim || '9999-12-31') >= inicio)) {
          throw new Falha('Já existe uma pausa nesse período.');
        }
        if (metodo === 'POST') {
          await db.prepare('INSERT INTO pausas (aluno_id, inicio, fim, cobrar) VALUES (?, ?, ?, ?)').bind(aluno.id, inicio, fim, d.cobrar ? 1 : 0).run();
        } else {
          await db.prepare('UPDATE pausas SET inicio = ?, fim = ?, cobrar = ? WHERE id = ? AND aluno_id = ?').bind(inicio, fim, d.cobrar ? 1 : 0, Number(d4), aluno.id).run();
        }
      } else throw new Falha('Caminho não encontrado.', 404);
      await estadoDoAluno(db, aluno, hoje); // acerta as mensalidades que caem na pausa
      return json({ ok: true });
    }

    if (c === 'lembrado' && metodo === 'POST') {
      await db.prepare('UPDATE alunos SET lembrado_em = ? WHERE id = ?').bind(dataHoje(), aluno.id).run();
      return json({ ok: true });
    }
  }

  // --- Frases da arte ---
  if (a === 'frases') {
    const p = await personalLogado(request, db);
    if (!b && metodo === 'POST') {
      const d = await corpo(request);
      const t = texto(d.texto, 3, 110, 'frase');
      const origem = d.origem === 'ia' ? 'ia' : 'propria';
      const total = await db.prepare('SELECT COUNT(*) AS n FROM frases WHERE personal_id = ?').bind(p.id).first();
      if (total.n >= 60) throw new Falha('Você chegou ao limite de 60 frases. Apague alguma para adicionar outra.');
      await db.prepare('INSERT INTO frases (personal_id, texto, origem) VALUES (?, ?, ?)').bind(p.id, t, origem).run();
      return json({ ok: true });
    }
    if (b && metodo === 'PUT') {
      const d = await corpo(request);
      await db.prepare('UPDATE frases SET ativa = ? WHERE id = ? AND personal_id = ?').bind(d.ativa ? 1 : 0, Number(b), p.id).run();
      return json({ ok: true });
    }
    if (b && metodo === 'DELETE') {
      await db.prepare('DELETE FROM frases WHERE id = ? AND personal_id = ?').bind(Number(b), p.id).run();
      return json({ ok: true });
    }
  }

  // --- IA: sugestões que o personal aprova antes de usar ---
  if (a === 'ia' && b === 'frases' && metodo === 'POST') {
    const p = await personalLogado(request, db);
    const d = await corpo(request);
    const tom = TONS[d.tom] || TONS[p.tom] || TONS.zoeiro;
    const nome = p.nome.trim();
    const saida = await pedirIA(
      env,
      'Você escreve frases curtas em português do Brasil para alunos de personal trainer postarem nos stories. ' +
        'Responda só com as frases, uma por linha, sem numeração, sem aspas e sem emojis.',
      `Crie 5 frases diferentes, em primeira pessoa (o aluno falando), com no máximo 80 caracteres cada, em tom ${tom}. ` +
        `O personal se chama ${nome} e as frases podem brincar com ele pelo nome. ` +
        'Tema: completar mais um mês de treino. Não fale de dinheiro, pagamento, corpo, peso ou dieta. Nada ofensivo.'
    );
    const frases = saida
      .split('\n')
      .map((l) => l.replace(/^[\s\-*•\d.)]+/, '').replace(/^["“”']+|["“”']+$/g, '').trim())
      .filter((l) => l.length >= 8 && l.length <= 110)
      .slice(0, 5);
    if (!frases.length) throw new Falha('A IA não trouxe frases boas agora. Tente de novo.', 503);
    return json({ frases });
  }

  if (a === 'ia' && b === 'lembrete' && metodo === 'POST') {
    const p = await personalLogado(request, db);
    const d = await corpo(request);
    const aluno = await alunoDoPersonal(db, p, d.alunoId);
    const estado = await estadoDoAluno(db, aluno);
    const ehPacote = aluno.modo === 'pacote';
    const pa = ehPacote ? await pacotesEAulasDe(db, aluno.id) : null;
    const c2 = calcular(aluno, ehPacote ? mesesComAula(pa.aulas, estado.hoje) : estado.pagamentos, estado.hoje, estado.pausas);
    const marco = marcoDe(c2.meses + 1);
    const saldo = ehPacote ? situacaoPacote(aluno, pa.pacotes, pa.aulas, estado.pausas, estado.hoje).saldo : 0;
    const fatos = [
      `Aluno: ${primeiroNome(aluno.nome)}.`,
      `Personal: ${p.nome.trim()}.`,
      `Meses de treino até agora: ${c2.meses}.`,
      ehPacote
        ? `O aluno treina por pacote de ${aluno.pacote_aulas} aulas. ${saldo > 0 ? `Restam ${saldo} aulas no pacote.` : 'As aulas do pacote acabaram.'} O convite é para renovar o pacote.`
        : `Próximo mês a desbloquear: ${c2.nomeAlvo}.`,
      !ehPacote && marco ? `Ao desbloquear, o aluno ganha o selo ${marco}.` : '',
      c2.emPausa || aluno.status === 'inativo' ? 'O aluno está com os treinos pausados; o convite é para voltar, sem pressão.' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const saida = await pedirIA(
      env,
      'Você escreve mensagens curtas de WhatsApp em português do Brasil, em nome de um app de personal trainer. ' +
        'Responda só com a mensagem, sem aspas, sem link e sem explicações.',
      `Escreva uma mensagem de até 2 frases, em tom ${TONS[p.tom] || TONS.zoeiro}, celebrando a jornada do aluno e convidando a ver o cartão dele e ${ehPacote ? 'renovar o pacote de aulas' : 'desbloquear o próximo mês'}. ` +
        'Nunca use as palavras cobrança, dívida, atraso, débito ou vencido. No máximo 1 emoji. Use só estes fatos: ' +
        fatos
    );
    return json({ texto: saida.replace(/^["“”']+|["“”']+$/g, '').slice(0, 400) });
  }

  // --- Convite (público): o aluno se cadastra pelo link do personal ---
  if (a === 'convite' && b) {
    const p = await db.prepare('SELECT * FROM personais WHERE slug = ?').bind(String(b).toLowerCase()).first();
    if (!p) throw new Falha('Convite não encontrado. Confira o link com seu personal.', 404);
    if (metodo === 'GET') {
      return json({ personal: { nome: p.nome, slug: p.slug, temFoto: !!p.foto }, anamnese: ANAMNESE });
    }
    if (metodo === 'POST') {
      const d = await corpo(request);
      const nome = texto(d.nome, 2, 60, 'nome');
      const whats = normalizarWhats(d.whatsapp);
      const repetido = await db.prepare('SELECT id FROM alunos WHERE personal_id = ? AND whatsapp = ?').bind(p.id, whats).first();
      if (repetido) throw new Falha(`Este WhatsApp já está cadastrado com ${p.nome.trim()}. Peça o seu link.`, 409);
      if (!d.aceite) throw new Falha('É preciso aceitar o compartilhamento dos dados para continuar.');
      // Anamnese: opcional para quem abriu a página antes desta versão; quando vem, é conferida inteira.
      let anamnese = null;
      if (d.anamnese) {
        try {
          anamnese = JSON.stringify(validarAnamnese(d.anamnese));
        } catch (e) {
          throw new Falha(e.message);
        }
      }
      const h = hojeBR();
      const mesCadastro = chaveMes(h.ano, h.mes);
      let mesInicio = null;
      if (d.mesInicio) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.mesInicio) || d.mesInicio > mesCadastro || d.mesInicio < '1990-01') {
          throw new Falha('Confira a data de início.');
        }
        mesInicio = d.mesInicio;
      }
      const pausa = d.mesesPausa ? inteiro(d.mesesPausa, 0, 600, 'meses de pausa') : 0;
      const diaAluno = d.diaVenc ? inteiro(d.diaVenc, 1, 31, 'dia do vencimento') : null; // sugestão do aluno; o personal confirma
      const total = await db.prepare('SELECT COUNT(*) AS n FROM alunos WHERE personal_id = ?').bind(p.id).first();
      if (total.n >= 500) throw new Falha('Este personal chegou ao limite de alunos. Fale com ele.');
      const base = mesesBase(mesInicio, mesCadastro, mesCadastro, pausa); // o mês do cadastro conta quando for pago
      const token = aleatorio(12);
      await db
        .prepare(
          'INSERT INTO alunos (personal_id, token, nome, whatsapp, mes_inicio, data_inicio, meses_pausa, base_meses, seq_base, mes_cadastro, status, valor, dia_venc, criado_em, anamnese) ' +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?, ?)"
        )
        .bind(p.id, token, nome, whats, mesInicio, mesInicio ? mesInicio + '-01' : null, pausa, base, pausa > 0 ? 0 : base, mesCadastro, null, diaAluno, new Date().toISOString(), anamnese)
        .run();
      return json({ token });
    }
  }

  // --- Página do aluno (pública, pelo link pessoal) ---
  if (a === 'aluno' && b) {
    const aluno = await db.prepare('SELECT * FROM alunos WHERE token = ?').bind(String(b)).first();
    if (!aluno) throw new Falha('Link não encontrado. Peça um novo ao seu personal.', 404);
    const p = await db.prepare('SELECT * FROM personais WHERE id = ?').bind(aluno.personal_id).first();
    const { pagamentos, pausas, hoje } = await estadoDoAluno(db, aluno);
    const ehPacote = aluno.modo === 'pacote';
    const pa = ehPacote ? await pacotesEAulasDe(db, aluno.id) : null;
    const calc = calcular(aluno, ehPacote ? mesesComAula(pa.aulas, hoje) : pagamentos, hoje, pausas);
    const sitPacote = ehPacote ? situacaoPacote(aluno, pa.pacotes, pa.aulas, pausas, hoje) : null;
    if (ehPacote) calc.situacao = sitPacote.situacao === 'informado' ? 'informado' : sitPacote.situacao; // trilha não tem mês pendente
    const daVez = pagamentos.find((m) => m.mes === calc.alvo);
    const valor = ehPacote ? aluno.valor : daVez?.valor_previsto ?? aluno.valor;

    if (!c && metodo === 'GET') {
      const nomeP = p.nome.trim();
      const frases = (await db.prepare('SELECT texto FROM frases WHERE personal_id = ? AND ativa = 1').bind(p.id).all()).results || [];
      const podePagar = aluno.status !== 'novo' && valor > 0 && !!p.pix_chave;
      return json({
        nome: primeiroNome(aluno.nome),
        personal: { nome: nomeP, slug: p.slug, temFoto: !!p.foto },
        status: aluno.status === 'novo' ? 'novo' : calc.emPausa || aluno.status === 'inativo' ? 'pausado' : 'ativo',
        meses: calc.meses,
        sequencia: calc.sequencia,
        selo: calc.selo,
        situacao: calc.situacao,
        nomeAlvo: calc.nomeAlvo,
        fases: fases(calc.meses, calc.situacao, calc.nomeAlvo),
        valor,
        modo: ehPacote ? 'pacote' : 'mensal',
        ...(ehPacote && { saldo: sitPacote.saldo, pacoteAulas: aluno.pacote_aulas, pacoteInformado: !!aluno.pacote_informado_em }),
        pix: podePagar
          ? gerarPix({
              chave: p.pix_chave,
              nome: p.pix_nome || p.nome,
              cidade: p.pix_cidade,
              centavos: valor,
              txid: 'RENOVA' + aluno.id + (ehPacote ? 'P' + String(pa.pacotes.length + 1) : 'M' + calc.alvo.replace('-', '')),
            })
          : null,
        frases: frases.map((f) => f.texto.replaceAll('{personal}', nomeP)),
      });
    }

    // O aluno avisa que pagou. Quem confirma o recebimento é sempre o personal.
    if (c === 'paguei' && metodo === 'POST') {
      if (aluno.status === 'novo') throw new Falha('Seu cadastro ainda está aguardando a confirmação do personal.');
      const agora = new Date().toISOString();
      if (ehPacote) {
        await db.prepare('UPDATE alunos SET pacote_informado_em = ? WHERE id = ?').bind(agora, aluno.id).run();
        return json({ ok: true });
      }
      await db
        .prepare(
          "INSERT INTO pagamentos (aluno_id, mes, status, valor_previsto, vencimento, informado_em) VALUES (?, ?, 'informado', ?, ?, ?) " +
            "ON CONFLICT (aluno_id, mes) DO UPDATE SET status = 'informado', informado_em = excluded.informado_em WHERE pagamentos.status = 'aberto'"
        )
        .bind(aluno.id, calc.alvo, valor, calc.vencimento, agora)
        .run();
      return json({ ok: true });
    }
  }

  throw new Falha('Caminho não encontrado.', 404);
}

// ---------- Assinatura do personal (Mercado Pago) ----------
// Status de um pagamento: aguardando (checkout aberto, nada pago ainda), pendente, aprovado, recusado,
// cancelado, reembolsado e divergente (valor diferente do cobrado: não libera e fica para a administração conferir).

const DIA_MS = 24 * 3600 * 1000;
const agoraISO = () => new Date().toISOString();

function pagamentoPublico(g) {
  return {
    id: g.id,
    plano: g.plano,
    metodo: g.metodo,
    valor: g.valor,
    valorPago: g.valor_pago,
    parcelas: g.parcelas,
    status: g.status,
    criadoEm: g.criado_em,
    aprovadoEm: g.aprovado_em,
    observacao: g.observacao,
    mpPagamento: g.mp_pagamento,
    ...(g.nome && { personal: { id: g.personal_id, nome: g.nome, email: g.email } }),
  };
}

// Estende o acesso uma única vez por pagamento aprovado, mesmo que o aviso chegue repetido.
async function liberarPagamento(db, registro) {
  const marcado = await db
    .prepare('UPDATE assinatura_pagamentos SET aplicado = 1, aprovado_em = COALESCE(aprovado_em, ?) WHERE id = ? AND aplicado = 0')
    .bind(agoraISO(), registro.id)
    .run();
  if (!marcado.meta?.changes) return false;
  const p = await db.prepare('SELECT acesso_ate FROM personais WHERE id = ?').bind(registro.personal_id).first();
  await db
    .prepare('UPDATE personais SET plano = ?, acesso_ate = ? WHERE id = ?')
    .bind(registro.plano, estenderAcesso(p?.acesso_ate, registro.plano), registro.personal_id)
    .run();
  return true;
}

// Grava o que o Mercado Pago informou sobre um pagamento e libera o acesso se foi aprovado.
async function registrarPagamentoMP(db, pag) {
  const id = Number(pag?.external_reference);
  if (!Number.isInteger(id) || id <= 0 || !pag.status) return null;
  const registro = await db.prepare('SELECT * FROM assinatura_pagamentos WHERE id = ?').bind(id).first();
  if (!registro || registro.metodo === 'manual') return null;
  let status = statusDoMP(pag.status);
  const base = Math.round(Number(pag.transaction_amount || 0) * 100);
  if (status === 'aprovado' && (pag.currency_id !== 'BRL' || base < registro.valor)) status = 'divergente';
  // Um pagamento aprovado não volta atrás por um aviso atrasado de outra tentativa; só um reembolso dele mesmo muda.
  if (registro.status === 'aprovado' && !(status === 'reembolsado' && String(pag.id) === registro.mp_pagamento)) return registro;
  const pago = Math.round(Number(pag.transaction_details?.total_paid_amount ?? pag.transaction_amount ?? 0) * 100);
  await db
    .prepare('UPDATE assinatura_pagamentos SET status = ?, mp_pagamento = ?, valor_pago = ?, parcelas = ?, atualizado_em = ? WHERE id = ?')
    .bind(status, String(pag.id), pago || null, Number(pag.installments) || 1, agoraISO(), registro.id)
    .run();
  if (status === 'aprovado') await liberarPagamento(db, registro);
  return { ...registro, status };
}

// Pergunta ao Mercado Pago como está um pagamento (usado na volta ao app e pela administração).
async function conferirNoMP(env, db, registro) {
  if (registro.metodo === 'manual' || !mpConfigurado(env)) return registro;
  const busca = await chamarMP(env, `/v1/payments/search?external_reference=${registro.id}&sort=date_created&criteria=desc&limit=20`);
  const lista = busca.results || [];
  const escolhido = lista.find((x) => x.status === 'approved') || lista[0];
  if (!escolhido) return registro;
  return (await registrarPagamentoMP(db, escolhido)) || registro;
}

// ---------- Renovação automática no cartão ----------
// Status: criada, ativa, pausada (o Mercado Pago parou após falhas), cancelada, recusada (cartão não aceito).

const recorrentePublica = (r) =>
  r && { id: r.id, plano: r.plano, valor: r.valor, status: r.status, proximaCobranca: r.proxima_cobranca, criadoEm: r.criado_em, canceladoEm: r.cancelado_em };

async function recorrenteAtual(db, personalId) {
  return db
    .prepare("SELECT * FROM assinaturas_recorrentes WHERE personal_id = ? AND status IN ('ativa', 'pausada') ORDER BY id DESC LIMIT 1")
    .bind(personalId)
    .first();
}

// Grava uma cobrança da renovação automática (uma vez por pagamento do Mercado Pago) e libera o período pago.
async function registrarCobranca(db, rec, { pagamentoId, statusMP, valorBase, valorPago }) {
  if (!pagamentoId || !statusMP) return null;
  let status = statusDoMP(statusMP);
  if (status === 'aprovado' && Math.round(Number(valorBase || 0) * 100) < rec.valor) status = 'divergente';
  const agora = agoraISO();
  const pago = Math.round(Number(valorPago ?? valorBase ?? 0) * 100) || null;
  await db
    .prepare(
      "INSERT OR IGNORE INTO assinatura_pagamentos (personal_id, plano, metodo, valor, valor_pago, parcelas, status, mp_pagamento, recorrente_id, criado_em, atualizado_em) VALUES (?, ?, 'recorrente', ?, ?, 1, ?, ?, ?, ?, ?)"
    )
    .bind(rec.personal_id, rec.plano, rec.valor, pago, status, String(pagamentoId), rec.id, agora, agora)
    .run();
  const registro = await db.prepare('SELECT * FROM assinatura_pagamentos WHERE mp_pagamento = ? AND recorrente_id IS NOT NULL').bind(String(pagamentoId)).first();
  if (!registro) return null;
  if (registro.status !== status && (registro.status !== 'aprovado' || status === 'reembolsado')) {
    await db.prepare('UPDATE assinatura_pagamentos SET status = ?, valor_pago = COALESCE(?, valor_pago), atualizado_em = ? WHERE id = ?').bind(status, pago, agora, registro.id).run();
  }
  if (status === 'aprovado') await liberarPagamento(db, registro);
  return { ...registro, status };
}

async function atualizarRecorrente(db, pre) {
  const ref = String(pre?.external_reference || '');
  const rec = await db
    .prepare('SELECT * FROM assinaturas_recorrentes WHERE mp_preapproval = ? OR id = ?')
    .bind(String(pre?.id || '-'), ref.startsWith('rec-') ? Number(ref.slice(4)) : -1)
    .first();
  if (!rec) return null;
  const status = statusRecorrenteDoMP(pre.status);
  await db
    .prepare('UPDATE assinaturas_recorrentes SET mp_preapproval = COALESCE(mp_preapproval, ?), status = ?, proxima_cobranca = ?, atualizado_em = ?, cancelado_em = COALESCE(cancelado_em, ?) WHERE id = ?')
    .bind(String(pre.id), status, pre.next_payment_date || null, agoraISO(), status === 'cancelada' ? agoraISO() : null, rec.id)
    .run();
  return { ...rec, status };
}

// Cobrança vinda do aviso "subscription_authorized_payment".
async function registrarCobrancaAutorizada(db, ap) {
  const rec = await db.prepare('SELECT * FROM assinaturas_recorrentes WHERE mp_preapproval = ?').bind(String(ap?.preapproval_id || '-')).first();
  if (!rec || !ap.payment?.id) return null;
  return registrarCobranca(db, rec, { pagamentoId: ap.payment.id, statusMP: ap.payment.status, valorBase: ap.transaction_amount });
}

// Pagamento comum cujo external_reference é "rec-<id>" (o Mercado Pago repete a referência da assinatura).
async function registrarPagamentoDeRecorrente(db, pag) {
  const ref = String(pag?.external_reference || '');
  if (!ref.startsWith('rec-')) return null;
  const rec = await db.prepare('SELECT * FROM assinaturas_recorrentes WHERE id = ?').bind(Number(ref.slice(4))).first();
  if (!rec) return null;
  return registrarCobranca(db, rec, {
    pagamentoId: pag.id,
    statusMP: pag.status,
    valorBase: pag.transaction_amount,
    valorPago: pag.transaction_details?.total_paid_amount,
  });
}

// Confere no Mercado Pago a assinatura e as cobranças dela, sem depender do aviso.
async function conferirRecorrente(env, db, rec) {
  if (!rec?.mp_preapproval || !mpConfigurado(env)) return rec;
  const pre = await chamarMP(env, '/preapproval/' + rec.mp_preapproval);
  await atualizarRecorrente(db, pre);
  try {
    const busca = await chamarMP(env, `/v1/payments/search?external_reference=rec-${rec.id}&sort=date_created&criteria=desc&limit=30`);
    for (const pag of busca.results || []) await registrarPagamentoDeRecorrente(db, pag);
  } catch (e) {
    if (!(e instanceof ErroMP)) throw e;
  }
  try {
    const busca = await chamarMP(env, `/authorized_payments/search?preapproval_id=${rec.mp_preapproval}`);
    for (const ap of busca.results || []) await registrarCobrancaAutorizada(db, ap);
  } catch (e) {
    if (!(e instanceof ErroMP)) throw e;
  }
  return db.prepare('SELECT * FROM assinaturas_recorrentes WHERE id = ?').bind(rec.id).first();
}

async function cancelarRecorrente(env, db, rec) {
  if (rec.mp_preapproval && mpConfigurado(env)) {
    await chamarMP(env, '/preapproval/' + rec.mp_preapproval, { metodo: 'PUT', corpo: { status: 'cancelled' } });
  }
  await db
    .prepare("UPDATE assinaturas_recorrentes SET status = 'cancelada', cancelado_em = ?, atualizado_em = ? WHERE id = ?")
    .bind(agoraISO(), agoraISO(), rec.id)
    .run();
}

async function rotasAssinatura(request, env, db, [b, c]) {
  const metodo = request.method;

  // Aviso do Mercado Pago (público). O conteúdo do aviso nunca é usado: o pagamento é buscado lá.
  if (b === 'webhook' && metodo === 'POST') {
    const url = new URL(request.url);
    let d = {};
    try {
      d = JSON.parse((await request.text()) || '{}');
    } catch {
      d = {};
    }
    const tipo = d.type || d.topic || url.searchParams.get('type') || url.searchParams.get('topic');
    const id = String(d.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
    const tipos = {
      payment: /^\d{1,30}$/,
      subscription_preapproval: /^[a-z0-9]{1,64}$/i,
      subscription_authorized_payment: /^\d{1,30}$/,
    };
    if (!tipos[tipo] || !tipos[tipo].test(id)) return json({ ok: true });
    if (!(await avisoAutentico(env, request, url.searchParams.get('data.id') || id))) throw new Falha('Aviso não reconhecido.', 401);
    if (tipo === 'payment') {
      const pag = await chamarMP(env, '/v1/payments/' + id);
      if (!(await registrarPagamentoDeRecorrente(db, pag))) await registrarPagamentoMP(db, pag);
    } else if (tipo === 'subscription_preapproval') {
      await atualizarRecorrente(db, await chamarMP(env, '/preapproval/' + id));
    } else {
      await registrarCobrancaAutorizada(db, await chamarMP(env, '/authorized_payments/' + id));
    }
    return json({ ok: true });
  }

  const p = await personalLogado(request, db, { livre: true });
  const config = await configDoApp(db);

  if (!b && metodo === 'GET') {
    const lista = (
      await db.prepare("SELECT * FROM assinatura_pagamentos WHERE personal_id = ? AND status != 'aguardando' ORDER BY id DESC LIMIT 12").bind(p.id).all()
    ).results || [];
    const rec = await db.prepare('SELECT * FROM assinaturas_recorrentes WHERE personal_id = ? AND status != ? ORDER BY id DESC LIMIT 1').bind(p.id, 'recusada').first();
    return json({
      nome: p.nome,
      email: p.email,
      assinatura: assinaturaPublica(p),
      planos: tabelaPlanos(config),
      configurado: mpConfigurado(env),
      // Renovação automática: precisa da chave pública do Mercado Pago para o formulário de cartão no app.
      recorrenteDisponivel: mpConfigurado(env) && !!env.MP_PUBLIC_KEY,
      chavePublica: env.MP_PUBLIC_KEY || null,
      recorrente: recorrentePublica(rec),
      pagamentos: lista.map(pagamentoPublico),
    });
  }

  if (b === 'checkout' && metodo === 'POST') {
    if (p.bloqueado) throw new Falha('Sua conta está suspensa. Fale com o suporte.', 403);
    if (p.cortesia) throw new Falha('Seu acesso já está liberado, sem custo.');
    const d = await corpo(request);
    if (!PLANOS.includes(d.plano)) throw new Falha('Escolha um plano.');
    if (!METODOS.includes(d.metodo)) throw new Falha('Escolha Pix ou cartão.');
    if (!mpConfigurado(env)) throw new Falha('O pagamento pelo app ainda está sendo configurado. Fale com o suporte.', 503);
    const valor = valorCobrado(config, d.plano, d.metodo);
    const agora = agoraISO();
    const r = await db
      .prepare("INSERT INTO assinatura_pagamentos (personal_id, plano, metodo, valor, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 'aguardando', ?, ?)")
      .bind(p.id, d.plano, d.metodo, valor, agora, agora)
      .run();
    const registro = { id: r.meta.last_row_id, plano: d.plano, metodo: d.metodo, valor };
    const origem = new URL(request.url).origin;
    // Pix: código na tela do app, sem sair para o Mercado Pago.
    if (d.metodo === 'pix') {
      const pag = await chamarMP(env, '/v1/payments', {
        metodo: 'POST',
        corpo: montarPix({ registro, personal: p, origem }),
        idempotencia: 'renova-pix-' + registro.id,
      });
      const pix = dadosDoPix(pag);
      await db.prepare('UPDATE assinatura_pagamentos SET mp_pagamento = ? WHERE id = ?').bind(String(pag.id || ''), registro.id).run();
      return json({ id: registro.id, valor, pix });
    }
    // Cartão: checkout do Mercado Pago, onde dá para pagar sem conta, só com os dados do cartão.
    const pref = await chamarMP(env, '/checkout/preferences', {
      metodo: 'POST',
      corpo: montarPreferencia({ registro, personal: p, origem, parcelas: parcelasDoPlano(config, d.plano) }),
      idempotencia: 'renova-pref-' + registro.id,
    });
    await db.prepare('UPDATE assinatura_pagamentos SET mp_preferencia = ? WHERE id = ?').bind(String(pref.id || ''), registro.id).run();
    return json({ id: registro.id, url: linkDoCheckout(env, pref) });
  }

  // Renovação automática: o app manda o token do cartão (gerado pelo formulário do Mercado Pago na tela).
  if (b === 'recorrente' && !c && metodo === 'POST') {
    if (p.bloqueado) throw new Falha('Sua conta está suspensa. Fale com o suporte.', 403);
    if (p.cortesia) throw new Falha('Seu acesso já está liberado, sem custo.');
    if (!mpConfigurado(env) || !env.MP_PUBLIC_KEY) throw new Falha('A renovação automática ainda está sendo configurada. Use o Pix ou o cartão parcelado.', 503);
    const d = await corpo(request);
    if (!PLANOS.includes(d.plano)) throw new Falha('Escolha um plano.');
    const token = String(d.token || '');
    if (!/^[a-zA-Z0-9]{8,64}$/.test(token)) throw new Falha('Confira os dados do cartão.');
    if (await recorrenteAtual(db, p.id)) throw new Falha('Você já tem renovação automática ativa. Cancele na aba Conta antes de trocar de plano.');
    const agora = agoraISO();
    const r = await db
      .prepare("INSERT INTO assinaturas_recorrentes (personal_id, plano, valor, status, criado_em, atualizado_em) VALUES (?, ?, ?, 'criada', ?, ?)")
      .bind(p.id, d.plano, config[d.plano], agora, agora)
      .run();
    const recorrente = { id: r.meta.last_row_id, plano: d.plano, valor: config[d.plano] };
    let pre;
    try {
      pre = await chamarMP(env, '/preapproval', {
        metodo: 'POST',
        corpo: montarRecorrente({ recorrente, personal: p, origem: new URL(request.url).origin, token, meses: MESES_DO_PLANO[d.plano] }),
        idempotencia: 'renova-rec-' + recorrente.id,
      });
    } catch (e) {
      await db.prepare("UPDATE assinaturas_recorrentes SET status = 'recusada', atualizado_em = ? WHERE id = ?").bind(agoraISO(), recorrente.id).run();
      if (e instanceof ErroMP && e.mpStatus >= 400 && e.mpStatus < 500) {
        throw new Falha('O cartão não foi aceito para cobrança automática. Confira os dados, use outro cartão de crédito ou pague com Pix.');
      }
      throw e;
    }
    await atualizarRecorrente(db, { ...pre, external_reference: 'rec-' + recorrente.id });
    // A primeira cobrança sai em até 1 hora. Se o painel estiver travado, libera 1 dia enquanto isso.
    if (!temAcesso(p) && statusRecorrenteDoMP(pre.status) === 'ativa') {
      await db.prepare('UPDATE personais SET acesso_ate = ? WHERE id = ?').bind(new Date(Date.now() + DIA_MS).toISOString(), p.id).run();
    }
    const depois = await db.prepare('SELECT * FROM personais WHERE id = ?').bind(p.id).first();
    const rec = await db.prepare('SELECT * FROM assinaturas_recorrentes WHERE id = ?').bind(recorrente.id).first();
    return json({ recorrente: recorrentePublica(rec), assinatura: assinaturaPublica(depois) });
  }

  if (b === 'recorrente' && c === 'cancelar' && metodo === 'POST') {
    const rec = await recorrenteAtual(db, p.id);
    if (!rec) throw new Falha('Você não tem renovação automática ativa.');
    await cancelarRecorrente(env, db, rec);
    return json({ ok: true, assinatura: assinaturaPublica(p) });
  }

  if (b === 'recorrente' && c === 'verificar' && metodo === 'POST') {
    const rec = await db.prepare('SELECT * FROM assinaturas_recorrentes WHERE personal_id = ? ORDER BY id DESC LIMIT 1').bind(p.id).first();
    const atualizada = rec ? await conferirRecorrente(env, db, rec) : null;
    const depois = await db.prepare('SELECT * FROM personais WHERE id = ?').bind(p.id).first();
    return json({ recorrente: recorrentePublica(atualizada), assinatura: assinaturaPublica(depois) });
  }

  // Volta do checkout: confere na hora, sem esperar o aviso do Mercado Pago.
  if (b === 'verificar' && metodo === 'POST') {
    const d = await corpo(request);
    const registro = await db.prepare('SELECT * FROM assinatura_pagamentos WHERE id = ? AND personal_id = ?').bind(Number(d.id), p.id).first();
    if (!registro) throw new Falha('Pagamento não encontrado.', 404);
    const atualizado = await conferirNoMP(env, db, registro);
    const depois = await db.prepare('SELECT * FROM personais WHERE id = ?').bind(p.id).first();
    return json({ status: atualizado.status, assinatura: assinaturaPublica(depois) });
  }

  throw new Falha('Caminho não encontrado.', 404);
}

// ---------- Administração (/admin) ----------
// Entrada com a chave guardada como segredo ADMIN_KEY na Cloudflare; a sessão dura 12 horas.

const DOZE_HORAS = 12 * 3600;
const resumoSha = async (t) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t || ''))));
const cookieAdmin = (token, duracao) => `admin=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${duracao}`;

async function adminLogado(request, env, db, chaveEnviada = null) {
  const certa = String(env.ADMIN_KEY || '');
  if (certa.length < 20) throw new Falha('A área de administração ainda não foi configurada.', 503);
  if (chaveEnviada != null) {
    if (!iguais(await resumoSha(chaveEnviada), await resumoSha(certa))) throw new Falha('Chave de administração incorreta.', 401);
    return;
  }
  const token = lerCookie(request, 'admin');
  const sessao = token && (await db.prepare('SELECT token FROM admin_sessoes WHERE token = ? AND expira_em > ?').bind(token, Math.floor(Date.now() / 1000)).first());
  if (!sessao) throw new Falha('Entre com a chave de administração.', 401);
}

async function listarUsuarios(db, id = null) {
  const r = await db
    .prepare(
      'SELECT p.id, p.nome, p.email, p.slug, p.criado_em, p.plano, p.acesso_ate, p.cortesia, p.bloqueado, ' +
        "(SELECT COUNT(*) FROM alunos al WHERE al.personal_id = p.id AND al.status != 'inativo') AS alunos, " +
        "(SELECT COALESCE(SUM(g.valor), 0) FROM assinatura_pagamentos g WHERE g.personal_id = p.id AND g.status = 'aprovado') AS total_pago, " +
        "(SELECT MAX(g.aprovado_em) FROM assinatura_pagamentos g WHERE g.personal_id = p.id AND g.status = 'aprovado') AS ultimo_pagamento, " +
        "(SELECT r.status FROM assinaturas_recorrentes r WHERE r.personal_id = p.id AND r.status IN ('ativa', 'pausada') ORDER BY r.id DESC LIMIT 1) AS renovacao, " +
        "(SELECT r.proxima_cobranca FROM assinaturas_recorrentes r WHERE r.personal_id = p.id AND r.status IN ('ativa', 'pausada') ORDER BY r.id DESC LIMIT 1) AS proxima_cobranca " +
        `FROM personais p ${id ? 'WHERE p.id = ?' : ''} ORDER BY p.criado_em DESC`
    )
    .bind(...(id ? [id] : []))
    .all();
  const agora = new Date();
  return (r.results || []).map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    slug: u.slug,
    criadoEm: u.criado_em,
    alunos: u.alunos,
    totalPago: u.total_pago,
    ultimoPagamento: u.ultimo_pagamento,
    cortesia: !!u.cortesia,
    bloqueado: !!u.bloqueado,
    renovacao: u.renovacao || null, // renovação automática: 'ativa', 'pausada' ou null
    proximaCobranca: u.proxima_cobranca || null,
    ...assinaturaPublica(u, agora),
  }));
}

async function resumoAdmin(env, db, config) {
  const usuarios = await listarUsuarios(db);
  const agora = new Date();
  const conta = (s) => usuarios.filter((u) => u.situacao === s).length;
  const ativos = usuarios.filter((u) => u.situacao === 'ativa');
  const porPlano = Object.fromEntries(PLANOS.map((pl) => [pl, ativos.filter((u) => u.plano === pl).length]));
  const mensais = porPlano.mensal;
  const anuais = porPlano.anual;
  const pags = (await db.prepare("SELECT metodo, valor, status, aprovado_em, criado_em FROM assinatura_pagamentos WHERE status != 'aguardando'").all()).results || [];
  const aprovados = pags.filter((g) => g.status === 'aprovado');
  const mesAgora = mesBR(agora.toISOString());
  const serie = [];
  for (let i = 11; i >= 0; i--) {
    const mes = somaMes(mesAgora, -i);
    const doMes = aprovados.filter((g) => mesBR(g.aprovado_em || g.criado_em) === mes);
    serie.push({ mes, rotulo: rotuloMes(mes), valor: doMes.reduce((t, g) => t + g.valor, 0), quantidade: doMes.length });
  }
  const doMesAtual = aprovados.filter((g) => mesBR(g.aprovado_em || g.criado_em) === mesAgora);
  const porMetodo = Object.fromEntries(['pix', 'cartao', 'recorrente', 'manual'].map((m) => [m, doMesAtual.filter((g) => g.metodo === m).reduce((t, g) => t + g.valor, 0)]));
  const pagantes = usuarios.filter((u) => u.totalPago > 0).length;
  const encerrados = conta('teste_encerrado');
  const limite30 = new Date(agora.getTime() - 30 * DIA_MS).toISOString();
  return {
    usuarios: {
      total: usuarios.length,
      teste: conta('teste'),
      ativa: ativos.length,
      cortesia: conta('cortesia'),
      testeEncerrado: encerrados,
      vencida: conta('vencida'),
      bloqueada: conta('bloqueada'),
      novos30: usuarios.filter((u) => u.criadoEm >= limite30).length,
      pagantes,
    },
    assinantes: { mensais, anuais, porPlano, renovacaoAutomatica: ativos.filter((u) => u.renovacao === 'ativa').length },
    mrr: PLANOS.reduce((t, pl) => t + porPlano[pl] * Math.round(config[pl] / MESES_DO_PLANO[pl]), 0),
    receita: {
      mes: serie[11].valor,
      mesAnterior: serie[10].valor,
      total: aprovados.reduce((t, g) => t + g.valor, 0),
      porMetodo,
      serie,
    },
    conversao: pagantes + encerrados ? Math.round((pagantes / (pagantes + encerrados)) * 100) : null,
    pendentes: pags.filter((g) => g.status === 'pendente').length,
    divergentes: pags.filter((g) => g.status === 'divergente').length,
    vencendo: ativos
      .filter((u) => u.diasRestantes <= 7)
      .sort((x, y) => x.diasRestantes - y.diasRestantes)
      .map((u) => ({ id: u.id, nome: u.nome, plano: u.plano, diasRestantes: u.diasRestantes })),
    terminandoTeste: usuarios.filter((u) => u.situacao === 'teste' && u.diasRestantes <= 2).length,
    configurado: mpConfigurado(env),
    avisoProtegido: !!env.MP_WEBHOOK_SECRET,
  };
}

async function rotasAdmin(request, env, db, [b, c, d4]) {
  const metodo = request.method;

  if (b === 'entrar' && metodo === 'POST') {
    const d = await corpo(request);
    await adminLogado(request, env, db, String(d.chave || ''));
    const token = aleatorio(32);
    const agora = Math.floor(Date.now() / 1000);
    await db.batch([
      db.prepare('DELETE FROM admin_sessoes WHERE expira_em < ?').bind(agora),
      db.prepare('INSERT INTO admin_sessoes (token, expira_em) VALUES (?, ?)').bind(token, agora + DOZE_HORAS),
    ]);
    return json({ ok: true }, 200, { 'set-cookie': cookieAdmin(token, DOZE_HORAS) });
  }

  if (b === 'sair' && metodo === 'POST') {
    const token = lerCookie(request, 'admin');
    if (token) await db.prepare('DELETE FROM admin_sessoes WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'set-cookie': cookieAdmin('', 0) });
  }

  // Código de recuperação de senha para um personal. Aceita a chave no pedido ou a sessão.
  if (b === 'codigo' && metodo === 'POST') {
    const d = await corpo(request);
    await adminLogado(request, env, db, d.chave == null ? null : String(d.chave));
    const email = String(d.email || '').trim().toLowerCase();
    const p = await db.prepare('SELECT id, nome, email FROM personais WHERE email = ?').bind(email).first();
    if (!p) throw new Falha('Não existe conta com esse e-mail.', 404);
    return json({ nome: p.nome, email: p.email, codigo: await trocarCodigo(db, p.id) });
  }

  await adminLogado(request, env, db);
  const config = await configDoApp(db);

  if (b === 'resumo' && metodo === 'GET') return json(await resumoAdmin(env, db, config));

  if (b === 'usuarios' && !c && metodo === 'GET') return json({ usuarios: await listarUsuarios(db) });

  if (b === 'usuarios' && c) {
    const u = await db.prepare('SELECT * FROM personais WHERE id = ?').bind(Number(c)).first();
    if (!u) throw new Falha('Usuário não encontrado.', 404);
    const d = await corpo(request);

    // Ajustes de acesso: somar dias, definir a data final, cortesia e suspensão.
    if (!d4 && metodo === 'PUT') {
      const agora = new Date();
      if (d.acao === 'dias') {
        const dias = inteiro(d.dias, -3650, 3650, 'dias');
        const atual = u.acesso_ate ? new Date(u.acesso_ate) : agora;
        const base = dias > 0 && atual < agora ? agora : atual;
        await db.prepare('UPDATE personais SET acesso_ate = ? WHERE id = ?').bind(new Date(base.getTime() + dias * DIA_MS).toISOString(), u.id).run();
      } else if (d.acao === 'ate') {
        const data = dataValida(d.data, 'data');
        await db.prepare('UPDATE personais SET acesso_ate = ? WHERE id = ?').bind(new Date(data + 'T23:59:59-03:00').toISOString(), u.id).run();
      } else if (d.acao === 'cortesia') {
        await db.prepare('UPDATE personais SET cortesia = ? WHERE id = ?').bind(d.ativa ? 1 : 0, u.id).run();
      } else if (d.acao === 'bloquear') {
        await db.prepare('UPDATE personais SET bloqueado = ? WHERE id = ?').bind(d.ativo ? 1 : 0, u.id).run();
      } else if (d.acao === 'cancelarRenovacao') {
        const rec = await recorrenteAtual(db, u.id);
        if (!rec) throw new Falha('Este usuário não tem renovação automática ativa.');
        await cancelarRecorrente(env, db, rec);
      } else if (d.acao === 'conferirRenovacao') {
        const rec = await db.prepare('SELECT * FROM assinaturas_recorrentes WHERE personal_id = ? ORDER BY id DESC LIMIT 1').bind(u.id).first();
        if (!rec) throw new Falha('Este usuário nunca ativou a renovação automática.');
        await conferirRecorrente(env, db, rec);
      } else throw new Falha('Ação desconhecida.');
      return json({ usuario: (await listarUsuarios(db, u.id))[0] });
    }

    // Pagamento recebido fora do app (ex.: Pix direto): registra e libera o acesso do plano.
    if (d4 === 'pagamento' && metodo === 'POST') {
      if (!PLANOS.includes(d.plano)) throw new Falha('Escolha o plano.');
      const valor = inteiro(d.valor, 0, 10000000, 'valor');
      const agora = agoraISO();
      const r = await db
        .prepare(
          "INSERT INTO assinatura_pagamentos (personal_id, plano, metodo, valor, valor_pago, parcelas, status, observacao, criado_em, atualizado_em, aprovado_em) VALUES (?, ?, 'manual', ?, ?, 1, 'aprovado', ?, ?, ?, ?)"
        )
        .bind(u.id, d.plano, valor, valor, String(d.observacao || '').trim().slice(0, 200) || null, agora, agora, agora)
        .run();
      await liberarPagamento(db, { id: r.meta.last_row_id, personal_id: u.id, plano: d.plano });
      return json({ usuario: (await listarUsuarios(db, u.id))[0] });
    }
  }

  if (b === 'pagamentos' && !c && metodo === 'GET') {
    const todos = new URL(request.url).searchParams.get('todos') === '1';
    const r = await db
      .prepare(
        'SELECT g.*, p.nome, p.email FROM assinatura_pagamentos g JOIN personais p ON p.id = g.personal_id ' +
          (todos ? '' : "WHERE g.status != 'aguardando' ") +
          'ORDER BY g.id DESC LIMIT 300'
      )
      .all();
    return json({ pagamentos: (r.results || []).map(pagamentoPublico) });
  }

  if (b === 'pagamentos' && c && d4 === 'verificar' && metodo === 'POST') {
    const registro = await db.prepare('SELECT * FROM assinatura_pagamentos WHERE id = ?').bind(Number(c)).first();
    if (!registro) throw new Falha('Pagamento não encontrado.', 404);
    if (!mpConfigurado(env)) throw new Falha('O Mercado Pago ainda não foi configurado.', 503);
    const atualizado = await conferirNoMP(env, db, registro);
    return json({ status: atualizado.status });
  }

  if (b === 'config') {
    if (metodo === 'PUT') {
      const d = await corpo(request);
      let nova;
      try {
        nova = validarConfig(d);
      } catch (e) {
        throw new Falha(e.message);
      }
      await db
        .prepare("INSERT INTO meta (chave, valor) VALUES ('config_assinatura', ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor")
        .bind(JSON.stringify(nova))
        .run();
      return json({ config: nova, planos: tabelaPlanos(nova), configurado: mpConfigurado(env), avisoProtegido: !!env.MP_WEBHOOK_SECRET, chavePublica: !!env.MP_PUBLIC_KEY });
    }
    if (metodo === 'GET') {
      return json({ config, planos: tabelaPlanos(config), configurado: mpConfigurado(env), avisoProtegido: !!env.MP_WEBHOOK_SECRET, chavePublica: !!env.MP_PUBLIC_KEY });
    }
  }

  throw new Falha('Caminho não encontrado.', 404);
}

// "partes" é o caminho depois de /api/, já separado: /api/alunos/3 vira ['alunos', '3'].
export async function atenderApi(request, env, partes) {
  try {
    if (!env.DB) throw new Falha('O banco de dados ainda não foi ligado a este app (binding "DB").', 500);
    await prepararBanco(env.DB);
    return await rotear(request, env, partes);
  } catch (e) {
    if (e instanceof Falha) return json({ erro: e.message, ...e.dados }, e.status);
    if (e instanceof ErroMP) return json({ erro: e.message + ' Tente de novo em instantes.' }, mpConfigurado(env) ? 502 : 503);
    console.error(e);
    return json({ erro: 'Algo deu errado do nosso lado. Tente de novo em instantes.' }, 500);
  }
}
