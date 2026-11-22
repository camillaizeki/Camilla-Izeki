// Tela de convite: o aluno se cadastra pelo link do personal (/c/<link>).
import { api, el, campo, montar, mascararWhats } from './comum.js';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
let personal = null;
let temPausa = false;
let mesesParado = 1;
let enviando = false;
let erro = '';

// Anamnese em etapas depois dos dados básicos. A lista de perguntas vem da API.
let roteiro = [];
let etapa = 0; // 0 = dados básicos; 1..n = etapas da anamnese
let basicos = null; // { nome, whats, desde, dia } guardados ao sair da etapa 0
const respostas = {};
const detalhes = {};
let pularSaude = false;
let consentimentoSaude = false;
const EXCLUSIVAS = ['Nenhuma', 'Está ótimo assim', 'Nada, sou constante'];
const P = () => personal.nome.trim(); // nome como o personal cadastrou (ex.: "Personal Fiona")
const comNome = (t) => t.replaceAll('{personal}', P());

function foto() {
  if (personal.temFoto) return el('img', { class: 'foto', src: '/api/foto/' + personal.slug, alt: 'Foto de ' + personal.nome });
  return el('div', { class: 'foto vazia', 'aria-hidden': 'true' }, personal.nome.slice(0, 1));
}

// Etapa 0: guarda os dados básicos e segue para a anamnese.
function continuar(evento) {
  evento.preventDefault();
  const f = evento.target;
  basicos = { nome: f.nome.value, whats: f.whats.value, desde: f.desde.value, dia: f.dia.value };
  erro = '';
  irPara(roteiro.length ? 1 : 'enviar');
}

async function enviar() {
  if (enviando) return;
  enviando = true;
  erro = '';
  desenharEtapa();
  try {
    const { token } = await api('convite/' + slug, 'POST', {
      nome: basicos.nome,
      whatsapp: basicos.whats,
      mesInicio: basicos.desde || null,
      mesesPausa: basicos.desde && temPausa ? mesesParado : 0,
      diaVenc: basicos.dia ? Number(basicos.dia) : null,
      aceite: true,
      anamnese: roteiro.length ? { respostas, detalhes, pularSaude, consentimentoSaude } : undefined,
    });
    location.href = '/a/' + token + '?novo=1';
  } catch (e) {
    erro = e.message;
    enviando = false;
    desenharEtapa();
  }
}

function irPara(n) {
  if (n === 'enviar') return enviar();
  etapa = n;
  erro = '';
  if (etapa === 0) desenhar(basicos);
  else desenharEtapa();
  window.scrollTo(0, 0);
}

// ---------- Anamnese ----------

const visivel = (q) => !q.mostrarSe || respostas[q.mostrarSe.id] === q.mostrarSe.valor;
const detalheAtivo = (q) => {
  const v = respostas[q.id];
  if (!q.detalhe || v == null || (Array.isArray(v) && !v.length)) return false;
  if (q.detalhe.quando === '*') return true;
  return (Array.isArray(v) ? v : [v]).some((x) => q.detalhe.quando.includes(x));
};

function escolher(q, opcao) {
  if (q.tipo !== 'varios') {
    respostas[q.id] = opcao;
  } else {
    let lista = respostas[q.id] || [];
    if (lista.includes(opcao)) lista = lista.filter((x) => x !== opcao);
    else if (EXCLUSIVAS.includes(opcao)) lista = [opcao];
    else {
      lista = lista.filter((x) => !EXCLUSIVAS.includes(x));
      if (q.max && lista.length >= q.max) lista = [...lista.slice(1)]; // troca a mais antiga
      lista = [...lista, opcao];
    }
    respostas[q.id] = lista;
  }
  desenharEtapa();
}

function pergunta(q) {
  if (!visivel(q)) return null;
  const opcoes = q.tipo === 'simnao' ? ['Sim', 'Não'] : q.opcoes;
  const marcada = (o) => (q.tipo === 'varios' ? (respostas[q.id] || []).includes(o) : respostas[q.id] === o);
  const muitas = opcoes.length > 4 || opcoes.some((o) => o.length > 22);
  let campoDetalhe = null;
  if (detalheAtivo(q)) {
    const id = 'det-' + q.id;
    const atributos = {
      id, name: id, value: detalhes[q.id] ?? '',
      oninput: (e) => { detalhes[q.id] = e.target.value; },
    };
    campoDetalhe = el('div', { class: 'campo' },
      el('label', { for: id }, q.detalhe.rotulo),
      q.detalhe.tipo === 'numero'
        ? el('input', { ...atributos, type: 'number', inputmode: 'numeric', min: String(q.detalhe.min), max: String(q.detalhe.max) })
        : el('textarea', { ...atributos, rows: '3', maxlength: '400', required: !!q.detalhe.obrigatorio })
    );
  }
  return el('div', { class: 'pergunta', role: 'group' },
    el('p', { class: 'pergunta-titulo' }, comNome(q.texto)),
    q.ajuda && el('p', { class: 'pequeno suave' }, q.ajuda),
    el('div', { class: 'opcoes' + (muitas ? ' lista' : '') },
      opcoes.map((o) => el('button', { type: 'button', class: 'opcao', 'aria-pressed': String(marcada(o)), onclick: () => escolher(q, o) }, o))
    ),
    campoDetalhe
  );
}

// Confere a etapa antes de seguir: toda pergunta visível respondida e os campos obrigatórios preenchidos.
function faltando(bloco) {
  if (bloco.saude && pularSaude) return null;
  for (const q of bloco.perguntas) {
    if (!visivel(q)) continue;
    const v = respostas[q.id];
    if (v == null || (Array.isArray(v) && !v.length)) return `Responda: ${comNome(q.texto)}`;
    if (detalheAtivo(q) && q.detalhe.obrigatorio && !String(detalhes[q.id] || '').trim()) return `Preencha: ${q.detalhe.rotulo}`;
  }
  if (bloco.saude && !consentimentoSaude) return 'Marque a autorização para guardar as respostas de saúde, ou toque em "Prefiro não responder".';
  return null;
}

function desenharEtapa() {
  const bloco = roteiro[etapa - 1];
  const total = roteiro.length + 1;
  const ultima = etapa === roteiro.length;
  const seguir = () => {
    const falta = faltando(bloco);
    if (falta) {
      erro = falta;
      desenharEtapa();
      return;
    }
    irPara(ultima ? 'enviar' : etapa + 1);
  };
  montar(
    el('div', { class: 'coluna', style: 'gap: 8px' },
      el('p', { class: 'pequeno suave' }, `Etapa ${etapa + 1} de ${total}`),
      el('div', { class: 'progresso', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(total), 'aria-valuenow': String(etapa + 1) },
        el('div', { style: `width: ${Math.round(((etapa + 1) / total) * 100)}%` })),
      el('h1', { style: 'font-size: 28px' }, bloco.etapa),
      el('p', { class: 'suave' }, bloco.saude
        ? `Essas respostas ajudam ${P()} a montar um treino seguro para você. Só ${P()} vê.`
        : etapa === 1 ? `Responda em poucos toques para ${P()} conhecer você melhor.` : 'Toque nas opções que combinam com você.')
    ),
    el('div', { class: 'coluna', style: 'gap: 12px' },
      bloco.perguntas.map(pergunta),
      bloco.saude && el('label', { class: 'marca' },
        el('input', { type: 'checkbox', checked: consentimentoSaude, onchange: (e) => { consentimentoSaude = e.target.checked; pularSaude = false; } }),
        el('span', { class: 'pequeno' }, `Autorizo ${P()} a usar essas informações de saúde para adaptar meus treinos.`)
      )
    ),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    el('div', { class: 'coluna fim' },
      el('button', { class: 'botao', type: 'button', disabled: enviando, onclick: seguir }, enviando ? 'Enviando…' : ultima ? 'Começar minha jornada' : 'Continuar'),
      bloco.saude && el('button', {
        class: 'link', type: 'button',
        onclick: () => {
          pularSaude = true;
          consentimentoSaude = false;
          irPara(ultima ? 'enviar' : etapa + 1);
        },
      }, 'Prefiro não responder sobre saúde agora'),
      el('button', { class: 'link', type: 'button', disabled: enviando, onclick: () => irPara(etapa - 1) }, 'Voltar'),
      ultima && el('p', { class: 'pequeno suave centro' },
        `Ao continuar, você concorda em compartilhar esses dados com ${P()}. `,
        el('a', { href: '/privacidade' }, 'Privacidade'))
    )
  );
}

function desenhar(anterior) {
  const valores = anterior || { nome: '', whats: '', desde: '', dia: '' };

  // Pergunta de pausa: só aparece depois que a pessoa diz desde quando treina,
  // porque serve apenas para descontar da contagem os meses sem treino.
  const rotuloMeses = el('strong', { 'aria-live': 'polite' });
  const menos = el('button', { type: 'button', class: 'icone-botao', 'aria-label': 'Menos um mês' }, '−');
  const mais = el('button', { type: 'button', class: 'icone-botao', 'aria-label': 'Mais um mês' }, '+');
  const atualizarContador = () => {
    rotuloMeses.textContent = mesesParado === 1 ? '1 mês' : mesesParado + ' meses';
    menos.disabled = mesesParado <= 1;
  };
  menos.addEventListener('click', () => { mesesParado = Math.max(1, mesesParado - 1); atualizarContador(); });
  mais.addEventListener('click', () => { mesesParado = Math.min(240, mesesParado + 1); atualizarContador(); });
  atualizarContador();

  const quanto = el('div', { class: 'campo', hidden: !temPausa },
    el('span', { class: 'rotulo-campo' }, 'Quanto tempo ficou sem treinar, somando tudo?'),
    el('div', { class: 'contador' }, menos, rotuloMeses, mais),
    el('p', { class: 'pequeno suave' }, 'Esses meses não entram na contagem da sua jornada.')
  );
  const escolha = (valor, texto) => el('button', {
    type: 'button', class: 'opcao', 'aria-pressed': String(temPausa === valor),
    onclick: (e) => {
      temPausa = valor;
      e.currentTarget.parentElement.querySelectorAll('.opcao').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      quanto.hidden = !temPausa;
    },
  }, texto);
  const pausaCampo = el('div', { class: 'pergunta', role: 'group', hidden: !valores.desde },
    el('p', { class: 'pergunta-titulo' }, 'Nesse período, você ficou algum tempo sem treinar com ' + personal.nome + '?'),
    el('div', { class: 'opcoes' }, escolha(false, 'Não, treinei direto'), escolha(true, 'Sim, dei uma pausa')),
    quanto
  );

  queueMicrotask(() => {
    const campoWhats = document.getElementById('whats');
    if (campoWhats) mascararWhats(campoWhats);
  });
  montar(
    el('div', { class: 'coluna', style: 'align-items: flex-start' },
      foto(),
      el('h1', { style: 'font-size: 32px' }, personal.nome + ' te convidou'),
      el('p', { class: 'suave' }, 'Acompanhe sua jornada de treino e desbloqueie cada mês em um toque.')
    ),
    roteiro.length > 0 && el('p', { class: 'pequeno suave' }, `Etapa 1 de ${roteiro.length + 1}`),
    el('form', { class: 'coluna cresce', style: 'gap: 14px', onsubmit: continuar },
      campo('Seu nome', { id: 'nome', name: 'nome', type: 'text', required: true, autocomplete: 'name', value: valores.nome }),
      campo('Seu WhatsApp', { id: 'whats', name: 'whats', type: 'tel', required: true, autocomplete: 'tel', placeholder: '(62) 900000000', value: valores.whats }),
      campo('Desde quando treina com ' + personal.nome + '? (opcional)', {
        id: 'desde', name: 'desde', type: 'month', value: valores.desde,
        oninput: (e) => { pausaCampo.hidden = !e.target.value; },
        onchange: (e) => { pausaCampo.hidden = !e.target.value; },
      }, 'input', 'Mês e ano em que começou. Conta para os seus selos.'),
      pausaCampo,
      el('div', { class: 'campo' },
        el('label', { for: 'dia' }, 'Dia do vencimento (opcional)'),
        el('select', { id: 'dia', name: 'dia' },
          el('option', { value: '', selected: !valores.dia, disabled: true, hidden: true }, 'Escolha o dia'),
          Array.from({ length: 31 }, (_, i) => el('option', { value: String(i + 1), selected: valores.dia === String(i + 1) }, 'Todo dia ' + (i + 1)))
        ),
        el('p', { class: 'pequeno suave' }, 'O dia do mês em que você costuma pagar. ' + personal.nome + ' pode ajustar depois.')
      ),
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('div', { class: 'coluna fim' },
        el('button', { class: 'botao', type: 'submit' }, roteiro.length ? 'Continuar' : 'Começar minha jornada'),
        !roteiro.length && el('p', { class: 'pequeno suave centro' },
          'Ao continuar, você concorda em compartilhar esses dados com ' + personal.nome + '. ',
          el('a', { href: '/privacidade' }, 'Privacidade')
        )
      )
    )
  );
}

try {
  const dadosConvite = await api('convite/' + slug);
  personal = dadosConvite.personal;
  roteiro = dadosConvite.anamnese || [];
  document.title = 'Convite de ' + personal.nome + ' | Renova.AI';
  desenhar();
} catch (e) {
  montar(el('h1', {}, 'Convite não encontrado'), el('p', { class: 'suave' }, e.message));
}
