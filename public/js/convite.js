// Tela de convite: o aluno se cadastra pelo link do personal (/c/<link>).
import { api, el, campo, montar, mascararWhats } from './comum.js';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
let personal = null;
let temPausa = false;
let mesesParado = 1;
let enviando = false;
let erro = '';

function foto() {
  if (personal.temFoto) return el('img', { class: 'foto', src: '/api/foto/' + personal.slug, alt: 'Foto de ' + personal.nome });
  return el('div', { class: 'foto vazia', 'aria-hidden': 'true' }, personal.nome.slice(0, 1));
}

async function enviar(evento) {
  evento.preventDefault();
  if (enviando) return;
  const f = evento.target;
  enviando = true;
  erro = '';
  try {
    const { token } = await api('convite/' + slug, 'POST', {
      nome: f.nome.value,
      whatsapp: f.whats.value,
      mesInicio: f.desde.value || null,
      mesesPausa: f.desde.value && temPausa ? mesesParado : 0,
      aceite: true,
    });
    location.href = '/a/' + token + '?novo=1';
  } catch (e) {
    erro = e.message;
    enviando = false;
    desenhar(f);
  }
}

function desenhar(anterior) {
  const valores = anterior
    ? { nome: anterior.nome.value, whats: anterior.whats.value, desde: anterior.desde.value }
    : { nome: '', whats: '', desde: '' };

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
  const pausaCampo = el('fieldset', { class: 'pergunta', hidden: !valores.desde },
    el('legend', {}, 'Nesse período, você ficou algum tempo sem treinar com ' + personal.nome + '?'),
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
    el('form', { class: 'coluna cresce', style: 'gap: 14px', onsubmit: enviar },
      campo('Seu nome', { id: 'nome', name: 'nome', type: 'text', required: true, autocomplete: 'name', value: valores.nome }),
      campo('Seu WhatsApp', { id: 'whats', name: 'whats', type: 'tel', required: true, autocomplete: 'tel', placeholder: '(62) 900000000', value: valores.whats }),
      campo('Desde quando treina com ' + personal.nome + '? (opcional)', {
        id: 'desde', name: 'desde', type: 'month', value: valores.desde,
        oninput: (e) => { pausaCampo.hidden = !e.target.value; },
        onchange: (e) => { pausaCampo.hidden = !e.target.value; },
      }, 'input', 'Mês e ano em que começou. Conta para os seus selos.'),
      pausaCampo,
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('div', { class: 'coluna fim' },
        el('button', { class: 'botao', type: 'submit' }, 'Começar minha jornada'),
        el('p', { class: 'pequeno suave centro' },
          'Ao continuar, você concorda em compartilhar esses dados com ' + personal.nome + '. ',
          el('a', { href: '/privacidade' }, 'Privacidade')
        )
      )
    )
  );
}

try {
  personal = (await api('convite/' + slug)).personal;
  document.title = 'Convite de ' + personal.nome + ' | Renova.AI';
  desenhar();
} catch (e) {
  montar(el('h1', {}, 'Convite não encontrado'), el('p', { class: 'suave' }, e.message));
}
