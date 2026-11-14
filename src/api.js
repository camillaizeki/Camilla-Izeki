// API do Renova.AI: atende tudo que começa com /api/.
import { prepararBanco, FRASES_PADRAO } from '../lib/banco.js';
import { gerarPix, normalizarChave } from '../lib/pix.js';
import { calcular, fases, hojeBR, chaveMes, mesesIniciais, marcoDe } from '../lib/jornada.js';

const RESERVADOS = ['api', 'painel', 'aluno', 'convite', 'admin', 'renova', 'renovaai', 'privacidade', 'c', 'a'];
const MODELO_PADRAO = '@cf/meta/llama-3.1-8b-instruct';
const TRINTA_DIAS = 30 * 24 * 3600;

class Falha extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
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
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0];
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

async function personalLogado(request, db) {
  const token = lerCookie(request, 'sessao');
  if (!token) throw new Falha('Entre na sua conta.', 401);
  const agora = Math.floor(Date.now() / 1000);
  const p = await db
    .prepare('SELECT p.* FROM sessoes s JOIN personais p ON p.id = s.personal_id WHERE s.token = ? AND s.expira_em > ?')
    .bind(token, agora)
    .first();
  if (!p) throw new Falha('Entre na sua conta.', 401);
  return p;
}

function personalPublico(p) {
  return {
    nome: p.nome,
    primeiroNome: primeiroNome(p.nome),
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
  };
}

function alunoParaPainel(a, pagamentos) {
  const c = calcular(a, pagamentos);
  return {
    id: a.id,
    token: a.token,
    nome: a.nome,
    whatsapp: a.whatsapp,
    status: a.status,
    valor: a.valor,
    diaVenc: a.dia_venc,
    baseMeses: a.base_meses,
    mesInicio: a.mes_inicio,
    mesesPausa: a.meses_pausa,
    meses: c.meses,
    sequencia: c.sequencia,
    nomeAlvo: c.nomeAlvo,
    dias: c.dias,
    situacao: c.situacao,
    proximoMarco: marcoDe(c.meses + 1),
    lembradoHoje: a.lembrado_em === dataHoje(),
  };
}

async function alunoDoPersonal(db, personal, id) {
  const a = await db.prepare('SELECT * FROM alunos WHERE id = ? AND personal_id = ?').bind(Number(id), personal.id).first();
  if (!a) throw new Falha('Aluno não encontrado.', 404);
  return a;
}

async function pagamentosDe(db, alunoId) {
  const r = await db.prepare('SELECT mes, status FROM pagamentos WHERE aluno_id = ?').bind(alunoId).all();
  return r.results || [];
}

async function pedirIA(env, sistema, pedido) {
  if (!env.AI) throw new Falha('A IA ainda não está ligada neste app. Use o texto padrão.', 503);
  try {
    const r = await env.AI.run(env.AI_MODEL || MODELO_PADRAO, {
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
    console.error('IA', e);
    throw new Falha('A IA não respondeu agora (pode ter chegado ao limite de hoje). Use o texto padrão.', 503);
  }
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
    const r = await db
      .prepare('INSERT INTO personais (slug, nome, email, senha_hash, senha_sal, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(slug, nome, email, hash, sal, new Date().toISOString())
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
    const p = await personalLogado(request, db);
    return json({ codigo: await trocarCodigo(db, p.id) });
  }

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
    const valorPadrao = d.valorPadrao ? inteiro(d.valorPadrao, 100, 10000000, 'mensalidade') : null;
    const diaPadrao = inteiro(d.diaPadrao || 5, 1, 28, 'dia de renovação');
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
    const alunos = (await db.prepare('SELECT * FROM alunos WHERE personal_id = ? ORDER BY nome').bind(p.id).all()).results || [];
    const pags = (
      await db
        .prepare('SELECT g.aluno_id, g.mes, g.status FROM pagamentos g JOIN alunos al ON al.id = g.aluno_id WHERE al.personal_id = ?')
        .bind(p.id)
        .all()
    ).results || [];
    const porAluno = new Map();
    for (const g of pags) {
      if (!porAluno.has(g.aluno_id)) porAluno.set(g.aluno_id, []);
      porAluno.get(g.aluno_id).push(g);
    }
    const frases = (await db.prepare('SELECT id, texto, ativa, origem FROM frases WHERE personal_id = ? ORDER BY id').bind(p.id).all()).results || [];
    return json({
      personal: personalPublico(p),
      alunos: alunos.map((al) => alunoParaPainel(al, porAluno.get(al.id) || [])),
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
  if (a === 'alunos' && b) {
    const p = await personalLogado(request, db);
    const aluno = await alunoDoPersonal(db, p, b);

    if (!c && metodo === 'PUT') {
      const d = await corpo(request);
      const valor = inteiro(d.valor, 100, 10000000, 'mensalidade');
      const dia = inteiro(d.diaVenc, 1, 28, 'dia de renovação');
      const base = inteiro(d.baseMeses, 1, 600, 'meses de treino');
      const status = ['ativo', 'pausado'].includes(d.status) ? d.status : 'ativo';
      const seqBase = base === aluno.base_meses ? aluno.seq_base : aluno.meses_pausa > 0 ? 0 : base;
      await db
        .prepare('UPDATE alunos SET valor = ?, dia_venc = ?, base_meses = ?, seq_base = ?, status = ? WHERE id = ?')
        .bind(valor, dia, base, seqBase, status, aluno.id)
        .run();
      return json({ ok: true });
    }

    if (!c && metodo === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM pagamentos WHERE aluno_id = ?').bind(aluno.id),
        db.prepare('DELETE FROM alunos WHERE id = ?').bind(aluno.id),
      ]);
      return json({ ok: true });
    }

    if (c === 'pagamento' && metodo === 'POST') {
      const d = await corpo(request);
      const { alvo } = calcular(aluno, await pagamentosDe(db, aluno.id));
      if (d.acao === 'recusar') {
        await db.prepare("DELETE FROM pagamentos WHERE aluno_id = ? AND mes = ? AND status = 'informado'").bind(aluno.id, alvo).run();
        return json({ ok: true });
      }
      const agora = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            "INSERT INTO pagamentos (aluno_id, mes, status, confirmado_em) VALUES (?, ?, 'confirmado', ?) " +
              "ON CONFLICT (aluno_id, mes) DO UPDATE SET status = 'confirmado', confirmado_em = excluded.confirmado_em"
          )
          .bind(aluno.id, alvo, agora),
        db.prepare("UPDATE alunos SET status = 'ativo' WHERE id = ? AND status = 'pausado'").bind(aluno.id),
      ]);
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
    const nome = primeiroNome(p.nome);
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
    const c2 = calcular(aluno, await pagamentosDe(db, aluno.id));
    const marco = marcoDe(c2.meses + 1);
    const fatos = [
      `Aluno: ${primeiroNome(aluno.nome)}.`,
      `Personal: ${primeiroNome(p.nome)}.`,
      `Meses de treino até agora: ${c2.meses}.`,
      `Próximo mês a desbloquear: ${c2.nomeAlvo}.`,
      marco ? `Ao desbloquear, o aluno ganha o selo ${marco}.` : '',
      aluno.status === 'pausado' ? 'O aluno está com os treinos pausados; o convite é para voltar, sem pressão.' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const saida = await pedirIA(
      env,
      'Você escreve mensagens curtas de WhatsApp em português do Brasil, em nome de um app de personal trainer. ' +
        'Responda só com a mensagem, sem aspas, sem link e sem explicações.',
      `Escreva uma mensagem de até 2 frases, em tom ${TONS[p.tom] || TONS.zoeiro}, celebrando a jornada do aluno e convidando a ver o cartão dele e desbloquear o próximo mês. ` +
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
      return json({ personal: { nome: p.nome, primeiroNome: primeiroNome(p.nome), slug: p.slug, temFoto: !!p.foto } });
    }
    if (metodo === 'POST') {
      const d = await corpo(request);
      const nome = texto(d.nome, 2, 60, 'nome');
      let whats = String(d.whatsapp || '').replace(/\D/g, '');
      if (whats.length === 10 || whats.length === 11) whats = '55' + whats;
      if (whats.length < 12 || whats.length > 13) throw new Falha('Confira o WhatsApp, com DDD.');
      if (!d.aceite) throw new Falha('É preciso aceitar o compartilhamento dos dados para continuar.');
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
      const total = await db.prepare('SELECT COUNT(*) AS n FROM alunos WHERE personal_id = ?').bind(p.id).first();
      if (total.n >= 500) throw new Falha('Este personal chegou ao limite de alunos. Fale com ele.');
      const base = mesesIniciais(mesInicio, mesCadastro, pausa);
      const token = aleatorio(12);
      await db
        .prepare(
          'INSERT INTO alunos (personal_id, token, nome, whatsapp, mes_inicio, meses_pausa, base_meses, seq_base, mes_cadastro, status, valor, dia_venc, criado_em) ' +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?)"
        )
        .bind(p.id, token, nome, whats, mesInicio, pausa, base, pausa > 0 ? 0 : base, mesCadastro, p.valor_padrao, p.dia_padrao || 5, new Date().toISOString())
        .run();
      return json({ token });
    }
  }

  // --- Página do aluno (pública, pelo link pessoal) ---
  if (a === 'aluno' && b) {
    const aluno = await db.prepare('SELECT * FROM alunos WHERE token = ?').bind(String(b)).first();
    if (!aluno) throw new Falha('Link não encontrado. Peça um novo ao seu personal.', 404);
    const p = await db.prepare('SELECT * FROM personais WHERE id = ?').bind(aluno.personal_id).first();
    const calc = calcular(aluno, await pagamentosDe(db, aluno.id));

    if (!c && metodo === 'GET') {
      const nomeP = primeiroNome(p.nome);
      const frases = (await db.prepare('SELECT texto FROM frases WHERE personal_id = ? AND ativa = 1').bind(p.id).all()).results || [];
      const podePagar = aluno.status !== 'novo' && aluno.valor > 0 && !!p.pix_chave;
      return json({
        nome: primeiroNome(aluno.nome),
        personal: { nome: p.nome, primeiroNome: nomeP, slug: p.slug, temFoto: !!p.foto },
        status: aluno.status,
        meses: calc.meses,
        sequencia: calc.sequencia,
        selo: calc.selo,
        situacao: calc.situacao,
        nomeAlvo: calc.nomeAlvo,
        fases: fases(calc.meses, calc.situacao, calc.nomeAlvo),
        valor: aluno.valor,
        pix: podePagar
          ? gerarPix({
              chave: p.pix_chave,
              nome: p.pix_nome || p.nome,
              cidade: p.pix_cidade,
              centavos: aluno.valor,
              txid: 'RENOVA' + aluno.id + 'M' + calc.alvo.replace('-', ''),
            })
          : null,
        frases: frases.map((f) => f.texto.replaceAll('{personal}', nomeP)),
      });
    }

    if (c === 'paguei' && metodo === 'POST') {
      if (aluno.status === 'novo') throw new Falha('Seu cadastro ainda está aguardando a confirmação do personal.');
      await db
        .prepare("INSERT INTO pagamentos (aluno_id, mes, status, informado_em) VALUES (?, ?, 'informado', ?) ON CONFLICT (aluno_id, mes) DO NOTHING")
        .bind(aluno.id, calc.alvo, new Date().toISOString())
        .run();
      return json({ ok: true });
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
    if (e instanceof Falha) return json({ erro: e.message }, e.status);
    console.error(e);
    return json({ erro: 'Algo deu errado do nosso lado. Tente de novo em instantes.' }, 500);
  }
}
