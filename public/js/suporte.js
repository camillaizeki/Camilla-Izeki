// Pedido de suporte: WhatsApp ou e-mail, com a mensagem já começada.
import { el } from './comum.js';

export const SUPORTE_EMAIL = 'izekicamilla@gmail.com';
export const SUPORTE_WHATSAPP = '5562991070471';
export const SUPORTE_WHATSAPP_TEXTO = '(62) 99107-0471';

export const linkWhatsApp = (texto) => `https://wa.me/${SUPORTE_WHATSAPP}?text=${encodeURIComponent(texto)}`;
export const linkEmail = (assunto, corpo) =>
  `mailto:${SUPORTE_EMAIL}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;

// quem: { nome, email } do personal, quando houver. motivo: o assunto, em poucas palavras.
function mensagem(quem, motivo) {
  const identificacao = quem?.email ? `\n\nConta: ${quem.nome || ''} (${quem.email})` : '';
  return `Olá! Preciso de ajuda com o Renova.AI: ${motivo}.${identificacao}`;
}

// Dois botões lado a lado: WhatsApp e e-mail.
export function botoesSuporte(quem, motivo = 'tenho uma dúvida') {
  const texto = mensagem(quem, motivo);
  return el('div', { class: 'acoes-suporte' },
    el('a', { class: 'botao menor', href: linkWhatsApp(texto), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
    el('a', { class: 'botao claro menor', href: linkEmail('Suporte Renova.AI', texto) }, 'E-mail')
  );
}

export function cartaoSuporte(quem, { titulo = 'Suporte', texto, motivo } = {}) {
  return el('div', { class: 'cartao' },
    el('h3', {}, titulo),
    el('p', { class: 'pequeno suave' }, texto || `Fale com a gente pelo WhatsApp ${SUPORTE_WHATSAPP_TEXTO} ou pelo e-mail ${SUPORTE_EMAIL}.`),
    botoesSuporte(quem, motivo)
  );
}
