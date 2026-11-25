// Renova.AI · Tela "Ler comprovante"
// Uso:
//   import { abrirLeitorComprovante, abrirSeCompartilhado } from '/comprovante/leitor-ui.js';
//   abrirLeitorComprovante({ alunos, pagadoresSalvos, nomesDoPersonal, onConfirmar, ... });
// Veja LEIAME.md para a descrição completa das opções.

import {
  extrairDados, encontrarAluno, conferirRecebedor, chaveDoComprovante, semelhancaNomes,
  formatarNome, formatarValor, formatarData, normalizarTexto,
} from './extracao.js';
import { lerComprovante, encerrarLeitura, ErroLeitura } from './leitura.js';

export const CACHE_COMPARTILHADO = 'renova-comprovantes-compartilhados';

const ERROS = {
  formato: 'Não conseguimos ler este arquivo. Envie um print ou o PDF do comprovante do banco.',
  sem_dados: 'Não encontramos dados de pagamento neste arquivo. Envie um print ou o PDF do comprovante do banco.',
  tamanho: 'Este arquivo passa de 10 MB. Envie um print ou o PDF do comprovante do banco.',
  pdf_senha: 'Este PDF está protegido por senha. Envie um print do comprovante.',
  sem_conexao: 'Sem internet para carregar o leitor. Tente de novo em instantes.',
};

const ORIGEM_TEXTO = {
  'pdf-texto': 'Lido do PDF do banco',
  'pdf-ocr': 'Lido do PDF (imagem)',
  ocr: 'Lido da imagem',
  manual: 'Lançamento manual',
};

const ICONES = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  imagem: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/></svg>',
  arquivo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg>',
  fechar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const primeiroNome = (nome) => formatarNome(nome).split(' ')[0];
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
// Texto do valor de referência do aluno ("Mensalidade R$ 250,00" ou o que o app mandar em descricaoValor).
const descricaoValor = (a) => a.descricaoValor || (a.mensalidade != null ? `Mensalidade ${formatarValor(Number(a.mensalidade))}` : '');
const doValor = (a) => (a.tipoValor === 'pacote' ? 'do pacote de' : 'da mensalidade de');

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function valorParaCampo(v) {
  return v == null ? '' : v.toFixed(2).replace('.', ',');
}

function valorDoCampo(texto) {
  const s = String(texto ?? '').replace(/[R$\s]/g, '');
  if (!s) return null;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * Abre a tela de leitura de comprovantes.
 * @param {object} op  opções (ver LEIAME.md)
 * @param {File[]|null} arquivosIniciais  arquivos vindos do compartilhamento
 */
export function abrirLeitorComprovante(op = {}, arquivosIniciais = null) {
  injetarEstilos();
  const focoAnterior = document.activeElement;

  const ctx = {
    alunos: [],
    salvos: [...(op.pagadoresSalvos || [])],
    itens: [],
    indice: 0,
    etapa: 'inicio',
    progresso: null,
    hashesDaSessao: new Map(),
    ocupado: false,
    registradas: [],
    puladas: 0,
    aviso: op.aviso || null,
  };

  const raiz = document.createElement('div');
  raiz.className = 'rnv-cp';
  raiz.innerHTML = `
    <div class="rnv-cp__fundo" data-acao="fechar"></div>
    <div class="rnv-cp__folha" role="dialog" aria-modal="true" aria-labelledby="rnv-cp-titulo" tabindex="-1">
      <button type="button" class="rnv-cp__x" data-acao="fechar" aria-label="Fechar">${ICONES.fechar}</button>
      <div class="rnv-cp__conteudo"></div>
    </div>
    <input type="file" hidden data-entrada="camera" accept="image/*" capture="environment">
    <input type="file" hidden data-entrada="galeria" accept="image/*" multiple>
    <input type="file" hidden data-entrada="arquivo" accept="image/*,application/pdf,.pdf" multiple>`;
  document.body.appendChild(raiz);
  document.documentElement.classList.add('rnv-cp-aberto');
  const conteudo = raiz.querySelector('.rnv-cp__conteudo');

  // ------------------------------------------------------------- dados ---

  async function obterAlunos() {
    const lista = typeof op.alunos === 'function' ? await op.alunos() : op.alunos;
    ctx.alunos = (lista || []).filter((a) => a && a.id != null && a.nome);
    return ctx.alunos;
  }

  const alunoPorId = (id) => ctx.alunos.find((a) => String(a.id) === String(id)) || null;

  function identificar(item) {
    const d = item.dados;
    item.identificacao = encontrarAluno(d.pagador, { alunos: ctx.alunos, pagadoresSalvos: ctx.salvos, valor: d.valor });
    const { tipo, candidatos, sugerido } = item.identificacao;
    item.alunoId = tipo === 'unico' ? candidatos[0].aluno.id : sugerido;
    item.modoBusca = tipo === 'nenhum';
    item.meses = null;
    item.mes = null;
    if (item.alunoId != null) carregarMeses(item);
  }

  async function verificarDuplicado(item) {
    item.duplicado = null;
    if (!item.chave) return;
    item.duplicado = ctx.hashesDaSessao.get(item.chave.hash) || null;
    if (!item.duplicado && op.verificarDuplicado) {
      try { item.duplicado = (await op.verificarDuplicado(item.chave)) || null; } catch { item.duplicado = null; }
    }
  }

  async function prepararItem(item) {
    const d = item.dados;
    item.recebedorOk = conferirRecebedor(d.recebedor, op.nomesDoPersonal);
    item.chave = await chaveDoComprovante(d);
    await verificarDuplicado(item);
    item.valorTexto = valorParaCampo(d.valor);
    item.data = d.data || hojeISO();
    item.lembrar = true;
    identificar(item);
  }

  function itemManual() {
    return {
      manual: true, origem: 'manual', erro: null,
      dados: { pagador: null, recebedor: null, valor: null, data: null, e2e: null },
    };
  }

  function carregarMeses(item) {
    item.meses = null;
    item.mes = null;
    const aluno = alunoPorId(item.alunoId);
    if (!op.mesesPendentes || !aluno) return;
    item.meses = 'carregando';
    Promise.resolve(op.mesesPendentes(aluno))
      .then((lista) => { item.meses = Array.isArray(lista) ? lista : []; })
      .catch(() => { item.meses = []; })
      .then(() => {
        item.mes = item.meses[0]?.valor ?? null; // padrão: mês pendente mais antigo
        if (ctx.itens[ctx.indice] === item && ctx.etapa === 'item') render();
      });
  }

  // --------------------------------------------------------- leitura ---

  async function processar(arquivos) {
    if (!arquivos?.length) return;
    ctx.etapa = 'lendo';
    ctx.aviso = null;
    ctx.progresso = { atual: 0, total: arquivos.length, fracao: 0 };
    render();
    await obterAlunos();

    const itens = [];
    for (let i = 0; i < arquivos.length; i++) {
      ctx.progresso = { atual: i + 1, total: arquivos.length, fracao: 0 };
      atualizarProgresso();
      const item = { erro: null, origem: null, dados: null };
      try {
        const { texto, origem } = await lerComprovante(arquivos[i], {
          onProgresso: (f) => { ctx.progresso.fracao = f; atualizarProgresso(); },
        });
        item.origem = origem;
        const dados = extrairDados(texto);
        if (dados.valor == null && !dados.pagador && !dados.e2e) item.erro = 'sem_dados';
        else item.dados = dados;
      } catch (e) {
        console.warn('[Renova.AI] leitura do comprovante:', e?.cause || e);
        item.erro = e instanceof ErroLeitura ? e.codigo : 'formato';
      }
      arquivos[i] = null; // o arquivo não é guardado em lugar nenhum
      itens.push(item);
    }
    await encerrarLeitura();
    for (const item of itens) if (!item.erro) await prepararItem(item);

    ctx.itens = itens;
    ctx.indice = 0;
    ctx.registradas = [];
    ctx.puladas = 0;
    ctx.etapa = itens.length > 1 ? 'resumo' : 'item';
    render();
  }

  async function lancarManual(substituirAtual = false) {
    if (op.onLancarManual) { fechar(); op.onLancarManual(); return; }
    await obterAlunos();
    const item = itemManual();
    await prepararItem(item);
    if (substituirAtual && ctx.etapa === 'item') {
      ctx.itens[ctx.indice] = item;
    } else {
      ctx.itens = [item];
      ctx.indice = 0;
      ctx.registradas = [];
      ctx.puladas = 0;
    }
    ctx.etapa = 'item';
    render();
  }

  // ------------------------------------------------------- confirmar ---

  function mostrarLembrar(item) {
    const aluno = alunoPorId(item.alunoId);
    if (!aluno || !item.dados.pagador) return false;
    const escolhido = item.identificacao.candidatos.find((c) => String(c.aluno.id) === String(item.alunoId));
    if (escolhido?.motivo === 'pagador_salvo') return false;
    return semelhancaNomes(item.dados.pagador, aluno.nome) < 0.6; // outra pessoa pagou
  }

  function podeConfirmar(item) {
    if (ctx.ocupado || item.alunoId == null || valorDoCampo(item.valorTexto) == null || !item.data) return false;
    if (op.mesesPendentes && (item.meses === 'carregando' || (item.meses?.length && item.mes == null))) return false;
    if (item.duplicado && item.chave?.tipo === 'e2e') return false;
    return true;
  }

  async function confirmar() {
    const item = ctx.itens[ctx.indice];
    if (!podeConfirmar(item)) return;
    const aluno = alunoPorId(item.alunoId);
    const pagador = item.dados.pagador ? formatarNome(item.dados.pagador) : null;
    const lembrar = mostrarLembrar(item) && item.lembrar;
    const baixa = {
      alunoId: aluno.id,
      alunoNome: aluno.nome,
      valor: valorDoCampo(item.valorTexto),
      data: item.data,
      mesReferencia: item.mes,
      pagador,
      chave: item.chave ? { tipo: item.chave.tipo, hash: item.chave.hash } : null,
      origemLeitura: item.origem || 'manual',
      identificacao: item.manual ? 'manual' : item.identificacao.tipo,
      lembrarPagador: lembrar ? { nome: pagador, alunoId: aluno.id } : null,
    };

    ctx.ocupado = true;
    item.erroConfirmar = null;
    render();
    try {
      await op.onConfirmar?.(baixa);
    } catch (e) {
      ctx.ocupado = false;
      item.erroConfirmar = e?.message || 'Não foi possível registrar a baixa. Tente de novo.';
      render();
      return;
    }
    ctx.ocupado = false;
    ctx.registradas.push(baixa);

    if (item.chave) ctx.hashesDaSessao.set(item.chave.hash, { data: hojeISO(), alunoNome: aluno.nome });
    if (lembrar) ctx.salvos.push({ nome: pagador, alunoId: aluno.id });

    // Os próximos da fila aproveitam o que acabou de ser aprendido.
    for (const prox of ctx.itens.slice(ctx.indice + 1)) {
      if (prox.erro || !prox.dados) continue;
      if (prox.chave && !prox.duplicado) prox.duplicado = ctx.hashesDaSessao.get(prox.chave.hash) || null;
      if (lembrar && prox.identificacao.tipo === 'nenhum') identificar(prox);
    }
    avancar();
  }

  // Ao chegar num comprovante, os meses em aberto são buscados de novo: um anterior da mesma fila pode ter quitado algum.
  function entrarNoItem() {
    const item = ctx.itens[ctx.indice];
    if (item && !item.erro && item.alunoId != null) carregarMeses(item);
  }

  function avancar() {
    ctx.indice += 1;
    ctx.etapa = ctx.indice >= ctx.itens.length ? 'fim' : 'item';
    if (ctx.etapa === 'item') entrarNoItem();
    render();
  }

  // ---------------------------------------------------------- render ---

  function render() {
    const telas = { inicio: telaInicio, lendo: telaLendo, resumo: telaResumo, item: telaItem, fim: telaFim };
    conteudo.innerHTML = telas[ctx.etapa]();
    // Só foca campos marcados: evita abrir o teclado do celular sem o personal pedir.
    const foco = conteudo.querySelector('[data-foco]') || raiz.querySelector('.rnv-cp__folha');
    foco?.focus({ preventScroll: true });
  }

  function telaInicio() {
    return `
      <h2 id="rnv-cp-titulo" class="rnv-cp__titulo">Ler comprovante</h2>
      <p class="rnv-cp__sub">Envie o comprovante que o aluno mandou e o Renova.AI dá a baixa para você.</p>
      ${ctx.aviso ? `<div class="rnv-cp__alerta">${ICONES.alerta}<p>${esc(ctx.aviso)}</p></div>` : ''}
      <div class="rnv-cp__opcoes">
        <button type="button" class="rnv-cp__opcao" data-acao="galeria" data-foco>
          ${ICONES.imagem}<span><strong>Escolher imagem</strong><small>Print salvo na galeria</small></span>
        </button>
        <button type="button" class="rnv-cp__opcao" data-acao="arquivo">
          ${ICONES.arquivo}<span><strong>Importar arquivo</strong><small>PDF do comprovante do banco</small></span>
        </button>
        <button type="button" class="rnv-cp__opcao" data-acao="camera">
          ${ICONES.camera}<span><strong>Tirar foto</strong><small>Comprovante em papel ou em outra tela</small></span>
        </button>
      </div>
      <button type="button" class="rnv-cp__link" data-acao="manual">Lançar pagamento manualmente</button>
      <p class="rnv-cp__nota">A imagem não é salva: o Renova.AI lê o comprovante no seu celular e guarda só os dados do pagamento.</p>`;
  }

  function telaLendo() {
    const p = ctx.progresso || { atual: 1, total: 1, fracao: 0 };
    const titulo = p.total > 1 ? `Lendo comprovante ${p.atual} de ${p.total}…` : 'Lendo comprovante…';
    return `
      <h2 id="rnv-cp-titulo" class="rnv-cp__titulo">${titulo}</h2>
      <div class="rnv-cp__barra" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
      <p class="rnv-cp__nota">Na primeira vez pode levar alguns segundos a mais.</p>`;
  }

  function atualizarProgresso() {
    if (ctx.etapa !== 'lendo') return;
    const p = ctx.progresso;
    const titulo = conteudo.querySelector('.rnv-cp__titulo');
    if (titulo) titulo.textContent = p.total > 1 ? `Lendo comprovante ${p.atual} de ${p.total}…` : 'Lendo comprovante…';
    const total = ((p.atual - 1 + (p.fracao || 0)) / p.total) * 100;
    const barra = conteudo.querySelector('.rnv-cp__barra');
    if (barra) {
      barra.setAttribute('aria-valuenow', String(Math.round(total)));
      barra.firstElementChild.style.width = `${Math.max(4, total)}%`;
    }
  }

  function telaResumo() {
    const n = ctx.itens.length;
    let prontos = 0; let ajuda = 0; let repetidos = 0; let erros = 0;
    for (const it of ctx.itens) {
      if (it.erro) erros++;
      else if (it.duplicado && it.chave?.tipo === 'e2e') repetidos++;
      else if (it.identificacao.tipo === 'unico' && it.dados.valor != null && it.recebedorOk !== false) prontos++;
      else ajuda++;
    }
    const linhas = [
      prontos && `<li class="ok">${ICONES.check}${plural(prontos, 'pronto', 'prontos')} para confirmar</li>`,
      ajuda && `<li class="atencao">${ICONES.alerta}${plural(ajuda, 'precisa', 'precisam')} da sua ajuda</li>`,
      repetidos && `<li class="atencao">${ICONES.alerta}${plural(repetidos, 'já lançado', 'já lançados')} antes</li>`,
      erros && `<li class="erro">${ICONES.alerta}${plural(erros, 'não pôde ser lido', 'não puderam ser lidos')}</li>`,
    ].filter(Boolean).join('');
    return `
      <h2 id="rnv-cp-titulo" class="rnv-cp__titulo">${n} comprovantes lidos</h2>
      <ul class="rnv-cp__resumo">${linhas}</ul>
      <div class="rnv-cp__acoes">
        <button type="button" class="rnv-cp__btn" data-acao="comecar" data-foco>Revisar e confirmar</button>
      </div>`;
  }

  function telaItem() {
    const it = ctx.itens[ctx.indice];
    const n = ctx.itens.length;
    const cabecalho = n > 1 ? `<p class="rnv-cp__passo">Comprovante ${ctx.indice + 1} de ${n}</p>` : '';
    const botaoPular = `<button type="button" class="rnv-cp__btn rnv-cp__btn--sec" data-acao="pular">${n > 1 ? 'Pular' : 'Cancelar'}</button>`;

    if (it.erro) {
      return `${cabecalho}
        <h2 id="rnv-cp-titulo" class="rnv-cp__titulo">Não deu para ler</h2>
        <div class="rnv-cp__alerta rnv-cp__alerta--erro">${ICONES.alerta}<p>${esc(ERROS[it.erro] || ERROS.formato)}</p></div>
        <div class="rnv-cp__acoes">
          <button type="button" class="rnv-cp__btn" data-acao="manual-item" data-foco>Lançar manualmente</button>
          ${botaoPular}
        </div>`;
    }

    const d = it.dados;
    const pagadorFmt = d.pagador ? formatarNome(d.pagador) : null;
    const alertas = [];
    const bloqueado = it.duplicado && it.chave?.tipo === 'e2e';
    if (it.duplicado) {
      const quando = it.duplicado.data ? ` em ${esc(formatarData(it.duplicado.data))}` : '';
      const para = it.duplicado.alunoNome ? ` para ${esc(formatarNome(it.duplicado.alunoNome))}` : '';
      alertas.push(bloqueado
        ? `<div class="rnv-cp__alerta rnv-cp__alerta--erro">${ICONES.alerta}<p>Este comprovante já foi lançado${quando}${para}.</p></div>`
        : `<div class="rnv-cp__alerta">${ICONES.alerta}<p>Parece que este pagamento já foi lançado${quando}${para}. Confira antes de confirmar.</p></div>`);
    }
    if (it.recebedorOk === false) {
      alertas.push(`<div class="rnv-cp__alerta">${ICONES.alerta}<p>Este comprovante não parece ter sido pago para você (recebedor: ${esc(formatarNome(d.recebedor))}). Confira antes de dar baixa.</p></div>`);
    }

    if (bloqueado) {
      return `${cabecalho}
        <h2 id="rnv-cp-titulo" class="rnv-cp__titulo">Comprovante repetido</h2>
        ${alertas.join('')}
        <div class="rnv-cp__acoes">${botaoPular.replace('class="', 'data-foco class="')}</div>`;
    }

    return `${cabecalho}
      <h2 id="rnv-cp-titulo" class="rnv-cp__titulo">${it.manual ? 'Lançar pagamento' : 'Confirmar pagamento'}</h2>
      ${alertas.join('')}
      <div class="rnv-cp__bloco" data-regiao="aluno">${blocoAluno(it, pagadorFmt)}</div>
      <div class="rnv-cp__campos">
        <label class="rnv-cp__campo"><span>Valor</span>
          <input type="text" inputmode="decimal" data-campo="valor" value="${esc(it.valorTexto)}" placeholder="0,00" autocomplete="off">
        </label>
        <label class="rnv-cp__campo"><span>Data do pagamento</span>
          <input type="date" data-campo="data" value="${esc(it.data)}" max="${hojeISO()}">
        </label>
      </div>
      ${blocoMes(it)}
      <div data-regiao="aviso-valor">${avisoValor(it)}</div>
      ${it.erroConfirmar ? `<div class="rnv-cp__alerta rnv-cp__alerta--erro">${ICONES.alerta}<p>${esc(it.erroConfirmar)}</p></div>` : ''}
      <p class="rnv-cp__nota">${esc(ORIGEM_TEXTO[it.origem] || '')}${it.manual ? '' : ' · confira os dados antes de confirmar'}</p>
      <div class="rnv-cp__acoes">
        <button type="button" class="rnv-cp__btn" data-acao="confirmar" ${podeConfirmar(it) ? '' : 'disabled'}>
          ${ctx.ocupado ? 'Registrando…' : 'Confirmar baixa'}
        </button>
        ${botaoPular}
      </div>`;
  }

  function cartaoAluno(it, aluno, pagadorFmt) {
    const pagoPorOutro = pagadorFmt && semelhancaNomes(pagadorFmt, aluno.nome) < 0.6;
    const lembrar = mostrarLembrar(it)
      ? `<label class="rnv-cp__check"><input type="checkbox" data-campo="lembrar" ${it.lembrar ? 'checked' : ''}>
           <span>Lembrar que ${esc(pagadorFmt)} paga por ${esc(primeiroNome(aluno.nome))}</span></label>`
      : '';
    return `
      <div class="rnv-cp__cartao">
        <div>
          <p class="rnv-cp__rotulo">Pagamento de</p>
          <p class="rnv-cp__nome">${esc(formatarNome(aluno.nome))}</p>
          ${pagoPorOutro ? `<p class="rnv-cp__detalhe">Pago por ${esc(pagadorFmt)}</p>` : ''}
          ${descricaoValor(aluno) ? `<p class="rnv-cp__detalhe">${esc(descricaoValor(aluno))}</p>` : ''}
        </div>
        <button type="button" class="rnv-cp__link" data-acao="trocar">Trocar</button>
      </div>
      ${lembrar}`;
  }

  function blocoAluno(it, pagadorFmt) {
    const { tipo, candidatos } = it.identificacao;
    const aluno = alunoPorId(it.alunoId);

    if (!it.modoBusca && tipo === 'unico' && aluno) return cartaoAluno(it, aluno, pagadorFmt);

    if (!it.modoBusca && tipo === 'ambiguo') {
      const salvo = candidatos[0]?.motivo === 'pagador_salvo';
      const msg = salvo
        ? `${esc(pagadorFmt)} paga por mais de um aluno. Para qual deles é esse pagamento?`
        : `Encontramos ${candidatos.length} alunos com nome parecido com “${esc(pagadorFmt)}”. Para qual deles é esse pagamento?`;
      const opcoes = candidatos.map((c) => `
        <label class="rnv-cp__escolha">
          <input type="radio" name="rnv-cp-aluno" value="${esc(c.aluno.id)}" data-campo="aluno" ${String(c.aluno.id) === String(it.alunoId) ? 'checked' : ''}>
          <span><strong>${esc(formatarNome(c.aluno.nome))}</strong>
          ${descricaoValor(c.aluno) ? `<small>${esc(descricaoValor(c.aluno))}</small>` : ''}</span>
          ${c.valorBate ? '<em class="rnv-cp__selo">valor bate</em>' : ''}
        </label>`).join('');
      return `
        <div class="rnv-cp__alerta rnv-cp__alerta--info">${ICONES.alerta}<p>${msg}</p></div>
        <div class="rnv-cp__lista">${opcoes}</div>
        ${aluno && mostrarLembrar(it) ? `<label class="rnv-cp__check"><input type="checkbox" data-campo="lembrar" ${it.lembrar ? 'checked' : ''}><span>Lembrar que ${esc(pagadorFmt)} paga por ${esc(primeiroNome(aluno.nome))}</span></label>` : ''}
        <button type="button" class="rnv-cp__link" data-acao="buscar">Não é nenhum deles</button>`;
    }

    // Busca manual (nenhum encontrado, "Trocar" ou lançamento manual)
    if (aluno) return cartaoAluno(it, aluno, pagadorFmt);
    let msg = 'Para qual aluno é esse pagamento?';
    if (!it.manual && tipo === 'nenhum') {
      msg = pagadorFmt
        ? `Não temos nenhum aluno chamado “${esc(pagadorFmt)}”. Para qual aluno é esse pagamento?`
        : 'Não conseguimos ler o nome de quem pagou. Para qual aluno é esse pagamento?';
    }
    return `
      <div class="rnv-cp__alerta rnv-cp__alerta--info">${ICONES.alerta}<p>${msg}</p></div>
      <label class="rnv-cp__campo"><span>Nome do aluno</span>
        <input type="search" data-campo="busca" placeholder="Digite o nome do aluno" autocomplete="off" data-foco value="${esc(it.busca || '')}">
      </label>
      <div class="rnv-cp__lista" data-regiao="resultados" role="listbox">${resultadosBusca(it)}</div>`;
  }

  function resultadosBusca(it) {
    const termo = normalizarTexto(it.busca || '');
    const valor = valorDoCampo(it.valorTexto);
    let lista = ctx.alunos.filter((a) => !termo || normalizarTexto(a.nome).includes(termo));
    lista = lista.sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome))).slice(0, 6);
    if (!lista.length) return `<p class="rnv-cp__vazio">Nenhum aluno com esse nome.</p>`;
    return lista.map((a) => {
      const bate = valor != null && a.mensalidade != null && Math.abs(Number(a.mensalidade) - valor) < 0.01;
      return `<button type="button" class="rnv-cp__escolha" role="option" data-acao="escolher" data-id="${esc(a.id)}">
        <span><strong>${esc(formatarNome(a.nome))}</strong>
        ${descricaoValor(a) ? `<small>${esc(descricaoValor(a))}</small>` : ''}</span>
        ${bate ? '<em class="rnv-cp__selo">valor bate</em>' : ''}
      </button>`;
    }).join('');
  }

  function blocoMes(it) {
    if (!op.mesesPendentes || it.alunoId == null) return '';
    if (it.meses === 'carregando' || it.meses == null) return '<p class="rnv-cp__nota">Buscando mensalidades pendentes…</p>';
    if (!it.meses.length) return '<p class="rnv-cp__nota">Este aluno não tem mensalidade pendente.</p>';
    const opcoes = it.meses.map((m) => `<option value="${esc(m.valor)}" ${m.valor === it.mes ? 'selected' : ''}>${esc(m.rotulo)}</option>`).join('');
    return `<label class="rnv-cp__campo"><span>Referente a</span><select data-campo="mes">${opcoes}</select></label>`;
  }

  function avisoValor(it) {
    const aluno = alunoPorId(it.alunoId);
    const valor = valorDoCampo(it.valorTexto);
    if (!aluno || valor == null || aluno.mensalidade == null) return '';
    const mensalidade = Number(aluno.mensalidade);
    if (Math.abs(mensalidade - valor) < 0.01) return '';
    return `<div class="rnv-cp__alerta">${ICONES.alerta}<p>O valor (${esc(formatarValor(valor))}) é diferente ${doValor(aluno)} ${esc(primeiroNome(aluno.nome))} (${esc(formatarValor(mensalidade))}). Quer registrar mesmo assim?</p></div>`;
  }

  function telaFim() {
    const r = ctx.registradas;
    let titulo = 'Nenhuma baixa registrada';
    let detalhe = '';
    if (r.length === 1) {
      titulo = 'Baixa registrada!';
      detalhe = `${esc(formatarNome(r[0].alunoNome))} · ${esc(formatarValor(r[0].valor))}`;
    } else if (r.length > 1) {
      titulo = `${r.length} baixas registradas!`;
      detalhe = r.map((b) => `${esc(primeiroNome(b.alunoNome))} · ${esc(formatarValor(b.valor))}`).join('<br>');
    }
    if (ctx.puladas) detalhe += `${detalhe ? '<br>' : ''}${plural(ctx.puladas, 'comprovante pulado', 'comprovantes pulados')}`;
    return `
      <div class="rnv-cp__fim ${r.length ? 'ok' : ''}">${r.length ? ICONES.check : ''}</div>
      <h2 id="rnv-cp-titulo" class="rnv-cp__titulo rnv-cp__centro">${titulo}</h2>
      ${detalhe ? `<p class="rnv-cp__sub rnv-cp__centro">${detalhe}</p>` : ''}
      <div class="rnv-cp__acoes">
        <button type="button" class="rnv-cp__btn" data-acao="fechar" data-foco>Fechar</button>
        <button type="button" class="rnv-cp__btn rnv-cp__btn--sec" data-acao="mais">Ler outro comprovante</button>
      </div>`;
  }

  // ---------------------------------------------------------- eventos ---

  raiz.addEventListener('click', (e) => {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo || ctx.ocupado) return;
    const item = ctx.itens[ctx.indice];
    switch (alvo.dataset.acao) {
      case 'fechar': if (ctx.etapa !== 'lendo') fechar(); break;
      case 'camera': case 'galeria': case 'arquivo':
        raiz.querySelector(`[data-entrada="${alvo.dataset.acao}"]`).click(); break;
      case 'manual': lancarManual(false); break;
      case 'manual-item': lancarManual(true); break;
      case 'comecar': ctx.etapa = 'item'; entrarNoItem(); render(); break;
      case 'pular': ctx.puladas++; avancar(); break;
      case 'mais': ctx.etapa = 'inicio'; ctx.itens = []; render(); break;
      case 'trocar': case 'buscar':
        item.modoBusca = true; item.alunoId = null; item.busca = ''; item.meses = null; item.mes = null; render(); break;
      case 'escolher':
        item.alunoId = alvo.dataset.id; item.modoBusca = true; carregarMeses(item); render(); break;
      case 'confirmar': confirmar(); break;
      default: break;
    }
  });

  raiz.addEventListener('input', (e) => {
    const item = ctx.itens[ctx.indice];
    const campo = e.target.dataset.campo;
    if (!item || !campo) return;
    if (campo === 'busca') {
      item.busca = e.target.value;
      conteudo.querySelector('[data-regiao="resultados"]').innerHTML = resultadosBusca(item);
    } else if (campo === 'valor') {
      item.valorTexto = e.target.value;
      conteudo.querySelector('[data-regiao="aviso-valor"]').innerHTML = avisoValor(item);
      atualizarBotaoConfirmar(item);
    } else if (campo === 'data') {
      item.data = e.target.value;
      atualizarBotaoConfirmar(item);
    }
  });

  raiz.addEventListener('change', (e) => {
    const item = ctx.itens[ctx.indice];
    const t = e.target;
    if (t.dataset.entrada) {
      const arquivos = [...t.files];
      t.value = '';
      processar(arquivos);
      return;
    }
    if (!item) return;
    if (t.dataset.campo === 'aluno') { item.alunoId = t.value; carregarMeses(item); render(); }
    if (t.dataset.campo === 'mes') item.mes = t.value;
    if (t.dataset.campo === 'lembrar') item.lembrar = t.checked;
  });

  raiz.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ctx.ocupado && ctx.etapa !== 'lendo') fechar();
    if (e.key === 'Enter' && e.target.dataset?.campo === 'busca') {
      const primeiro = conteudo.querySelector('[data-acao="escolher"]');
      if (primeiro) { e.preventDefault(); primeiro.click(); }
    }
  });

  function atualizarBotaoConfirmar(item) {
    const b = conteudo.querySelector('[data-acao="confirmar"]');
    if (b) b.disabled = !podeConfirmar(item);
  }

  let fechado = false;
  function fechar() {
    if (fechado) return;
    fechado = true;
    encerrarLeitura();
    raiz.remove();
    ctx.itens = [];
    document.documentElement.classList.remove('rnv-cp-aberto');
    focoAnterior?.focus?.();
    op.onFechar?.({ registradas: ctx.registradas.length });
  }

  render();
  if (arquivosIniciais?.length) processar([...arquivosIniciais]);
  return { fechar, processar };
}

// ---------------------------------------------------------------------------
// Compartilhamento (Android): arquivos que o service worker guardou
// ---------------------------------------------------------------------------

/** Lê e apaga na hora os arquivos compartilhados que o service worker guardou. */
export async function lerArquivosCompartilhados() {
  if (!('caches' in globalThis)) return [];
  const cache = await caches.open(CACHE_COMPARTILHADO);
  const arquivos = [];
  for (const req of await cache.keys()) {
    const resp = await cache.match(req);
    if (resp) {
      const blob = await resp.blob();
      const nome = decodeURIComponent(resp.headers.get('X-Nome') || 'comprovante');
      arquivos.push(new File([blob], nome, { type: resp.headers.get('Content-Type') || blob.type }));
    }
    await cache.delete(req);
  }
  await caches.delete(CACHE_COMPARTILHADO);
  return arquivos;
}

/**
 * Chame ao carregar a página do personal. Se ela foi aberta pelo
 * compartilhamento (?comprovante=...), abre o leitor já com os arquivos.
 */
export async function abrirSeCompartilhado(op = {}) {
  const url = new URL(location.href);
  const marca = url.searchParams.get('comprovante');
  if (!marca) return null;
  url.searchParams.delete('comprovante');
  history.replaceState(history.state, '', url);
  const arquivos = marca === 'compartilhado' ? await lerArquivosCompartilhados() : [];
  if (arquivos.length) return abrirLeitorComprovante(op, arquivos);
  return abrirLeitorComprovante({
    ...op,
    aviso: 'Não recebemos o arquivo compartilhado. Escolha o comprovante por uma das opções abaixo.',
  });
}

// ---------------------------------------------------------------------------
// Estilos (cores do Renova.AI via variáveis; ajuste em :root se quiser)
// ---------------------------------------------------------------------------

function injetarEstilos() {
  if (document.getElementById('rnv-cp-estilos')) return;
  const s = document.createElement('style');
  s.id = 'rnv-cp-estilos';
  s.textContent = `
.rnv-cp{--c:var(--rnv-teal,#0e9f9a);--c2:var(--rnv-laranja,#f28c28);--tx:var(--rnv-texto,#17303a);--sv:var(--rnv-suave,#5f7380);--bg:var(--rnv-fundo,#fff);--ln:var(--rnv-linha,#e3ecee);
  position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;font:inherit;color:var(--tx)}
html.rnv-cp-aberto{overflow:hidden}
.rnv-cp *{box-sizing:border-box}
.rnv-cp__fundo{position:absolute;inset:0;background:rgba(10,30,36,.45);animation:rnvFade .2s ease}
.rnv-cp__folha:focus{outline:none}
.rnv-cp__folha{position:relative;width:100%;max-width:480px;max-height:92vh;overflow:auto;background:var(--bg);border-radius:22px 22px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,.18);animation:rnvSobe .25s ease}
@media(min-width:600px){.rnv-cp{align-items:center}.rnv-cp__folha{border-radius:22px}}
@keyframes rnvSobe{from{transform:translateY(24px);opacity:0}}@keyframes rnvFade{from{opacity:0}}
.rnv-cp svg{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.rnv-cp__x{position:absolute;top:14px;right:14px;border:0;background:transparent;color:var(--sv);padding:6px;border-radius:50%;cursor:pointer}
.rnv-cp__titulo{font-size:1.25rem;line-height:1.3;margin:0 36px 6px 0;font-weight:700}
.rnv-cp__sub{margin:0 0 16px;color:var(--sv);line-height:1.45}
.rnv-cp__passo{margin:0 0 4px;font-size:.8rem;font-weight:600;color:var(--c);text-transform:uppercase;letter-spacing:.04em}
.rnv-cp__centro{text-align:center;margin-right:0}
.rnv-cp__opcoes{display:grid;gap:10px;margin:4px 0 14px}
.rnv-cp__opcao{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:14px 16px;border:1.5px solid var(--ln);border-radius:16px;background:var(--bg);color:var(--tx);font:inherit;cursor:pointer;transition:border-color .15s,background .15s}
.rnv-cp__opcao:hover,.rnv-cp__opcao:focus-visible{border-color:var(--c);background:color-mix(in srgb,var(--c) 6%,var(--bg))}
.rnv-cp__opcao svg{width:28px;height:28px;color:var(--c)}
.rnv-cp__opcao span{display:grid;gap:2px}.rnv-cp__opcao small{color:var(--sv)}
.rnv-cp__link{border:0;background:none;color:var(--c);font:inherit;font-weight:600;padding:8px 0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.rnv-cp__nota{font-size:.82rem;color:var(--sv);margin:10px 0 0;line-height:1.4}
.rnv-cp__barra{height:8px;border-radius:99px;background:var(--ln);overflow:hidden;margin:18px 0 6px}
.rnv-cp__barra span{display:block;height:100%;width:4%;background:linear-gradient(90deg,var(--c),var(--c2));border-radius:99px;transition:width .3s}
.rnv-cp__alerta{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:14px;background:#fff6ea;color:#7a4a00;margin:0 0 12px}
.rnv-cp__alerta p{margin:0;line-height:1.4}.rnv-cp__alerta svg{width:20px;height:20px;margin-top:1px}
.rnv-cp__alerta--erro{background:#fdecec;color:#9b1c1c}
.rnv-cp__alerta--info{background:color-mix(in srgb,var(--c) 10%,var(--bg));color:var(--tx)}
.rnv-cp__alerta--info svg{color:var(--c)}
.rnv-cp__bloco{margin:4px 0 14px}
.rnv-cp__cartao{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:16px;background:color-mix(in srgb,var(--c) 8%,var(--bg));border:1.5px solid color-mix(in srgb,var(--c) 30%,var(--bg))}
.rnv-cp__rotulo{margin:0;font-size:.78rem;color:var(--sv)}
.rnv-cp__nome{margin:2px 0 4px;font-size:1.1rem;font-weight:700}
.rnv-cp__detalhe{margin:0;font-size:.88rem;color:var(--sv)}
.rnv-cp__check{display:flex;gap:10px;align-items:center;margin:10px 2px 0;font-size:.92rem;cursor:pointer}
.rnv-cp__check input{width:20px;height:20px;accent-color:var(--c)}
.rnv-cp__lista{display:grid;gap:8px;margin:8px 0}
.rnv-cp__escolha{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 14px;border:1.5px solid var(--ln);border-radius:14px;background:var(--bg);color:var(--tx);font:inherit;cursor:pointer}
.rnv-cp__escolha:has(input:checked),.rnv-cp__escolha:hover{border-color:var(--c)}
.rnv-cp__escolha input{accent-color:var(--c);width:18px;height:18px}
.rnv-cp__escolha span{display:grid;gap:2px;flex:1}.rnv-cp__escolha small{color:var(--sv)}
.rnv-cp__selo{font-style:normal;font-size:.75rem;font-weight:700;color:#8a4b00;background:#ffe9cf;padding:3px 8px;border-radius:99px;white-space:nowrap}
.rnv-cp__vazio{color:var(--sv);margin:6px 2px}
.rnv-cp__campos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rnv-cp__campo{display:grid;gap:6px;margin:0 0 12px;font-size:.85rem;font-weight:600;color:var(--sv)}
.rnv-cp__campo input,.rnv-cp__campo select{font:inherit;font-size:1rem;font-weight:500;color:var(--tx);padding:12px 14px;border:1.5px solid var(--ln);border-radius:12px;background:var(--bg);width:100%;min-height:48px}
.rnv-cp__campo input:focus,.rnv-cp__campo select:focus{outline:none;border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 20%,transparent)}
.rnv-cp__acoes{display:grid;gap:8px;margin-top:16px}
.rnv-cp__btn{font:inherit;font-weight:700;font-size:1rem;padding:14px 18px;border-radius:14px;border:0;background:var(--c);color:#fff;cursor:pointer;min-height:50px}
.rnv-cp__btn:disabled{opacity:.45;cursor:not-allowed}
.rnv-cp__btn--sec{background:transparent;color:var(--sv);border:1.5px solid var(--ln)}
.rnv-cp__resumo{list-style:none;padding:0;margin:10px 0 0;display:grid;gap:10px}
.rnv-cp__resumo li{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:14px;background:#f5f8f9}
.rnv-cp__resumo li.ok svg{color:var(--c)}.rnv-cp__resumo li.atencao svg{color:var(--c2)}.rnv-cp__resumo li.erro svg{color:#c0392b}
.rnv-cp__fim{width:64px;height:64px;margin:8px auto 12px;border-radius:50%;display:grid;place-items:center}
.rnv-cp__fim.ok{background:linear-gradient(135deg,var(--c),var(--c2));color:#fff}
.rnv-cp__fim svg{width:34px;height:34px;stroke-width:2.6}
@media(prefers-reduced-motion:reduce){.rnv-cp__folha,.rnv-cp__fundo{animation:none}}
`;
  document.head.appendChild(s);
}
