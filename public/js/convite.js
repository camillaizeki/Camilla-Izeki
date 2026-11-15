// Tela de convite: o aluno se cadastra pelo link do personal (/c/<link>).
import { api, el, campo, montar, mascararWhats } from './comum.js';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
let personal = null;
let temPausa = false;
let enviando = false;
let erro = '';

function foto() {
  if (personal.temFoto) return el('img', { class: 'foto', src: '/api/foto/' + personal.slug, alt: 'Foto de ' + personal.primeiroNome });
  return el('div', { class: 'foto vazia', 'aria-hidden': 'true' }, personal.primeiroNome.slice(0, 1));
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
      mesesPausa: temPausa ? Number(f.pausaMeses.value || 0) : 0,
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

  const pausaCampo = el('div', { id: 'pausa-campo', hidden: !temPausa },
    campo('Quantos meses parado, no total?', { id: 'pausaMeses', name: 'pausaMeses', type: 'number', min: '1', inputmode: 'numeric', placeholder: '2' })
  );

  queueMicrotask(() => {
    const campoWhats = document.getElementById('whats');
    if (campoWhats) mascararWhats(campoWhats);
  });
  montar(
    el('div', { class: 'coluna', style: 'align-items: flex-start' },
      foto(),
      el('h1', { style: 'font-size: 32px' }, personal.primeiroNome + ' te convidou'),
      el('p', { class: 'suave' }, 'Acompanhe sua jornada de treino e desbloqueie cada mês em um toque.')
    ),
    el('form', { class: 'coluna cresce', style: 'gap: 14px', onsubmit: enviar },
      campo('Seu nome', { id: 'nome', name: 'nome', type: 'text', required: true, autocomplete: 'name', value: valores.nome }),
      campo('Seu WhatsApp', { id: 'whats', name: 'whats', type: 'tel', required: true, autocomplete: 'tel', placeholder: '(62) 900000000', value: valores.whats }),
      campo('Desde quando treina com ' + personal.primeiroNome + '? (opcional)', { id: 'desde', name: 'desde', type: 'month', value: valores.desde }),
      el('label', { class: 'marca' },
        el('input', {
          type: 'checkbox',
          checked: temPausa,
          onchange: (e) => {
            temPausa = e.target.checked;
            pausaCampo.hidden = !temPausa;
          },
        }),
        el('span', {}, 'Já dei uma pausa nos treinos')
      ),
      pausaCampo,
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('div', { class: 'coluna fim' },
        el('button', { class: 'botao', type: 'submit' }, 'Começar minha jornada'),
        el('p', { class: 'pequeno suave centro' },
          'Ao continuar, você concorda em compartilhar esses dados com ' + personal.primeiroNome + '. ',
          el('a', { href: '/privacidade' }, 'Privacidade')
        )
      )
    )
  );
}

try {
  personal = (await api('convite/' + slug)).personal;
  document.title = 'Convite de ' + personal.primeiroNome + ' | Renova.AI';
  desenhar();
} catch (e) {
  montar(el('h1', {}, 'Convite não encontrado'), el('p', { class: 'suave' }, e.message));
}
