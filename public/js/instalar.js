// Convite para o personal colocar o painel na tela de início do celular (PWA), sem loja de apps.
// Android/Chrome: botão que abre o pedido de instalação do próprio navegador.
// iPhone/iPad: o Safari não tem esse pedido, então mostramos o passo a passo do "Adicionar à Tela de Início".
import { el, icone } from './comum.js';

const CHAVE_ADIADO = 'renova-instalar-adiado';
const DIAS_ADIADO = 7;

let pedido = null; // evento beforeinstallprompt guardado para usar no toque do botão
let redesenhar = () => {};

const ua = navigator.userAgent;
const ehIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ehAndroid = /Android/i.test(ua);
// Navegadores dentro de outros apps (Instagram, Facebook etc.) não deixam instalar.
const dentroDeApp = /Instagram|FBAN|FBAV|Line\/|; wv\)/i.test(ua);

export const instalado = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const podeInstalar = () => !instalado() && (ehIOS || ehAndroid || !!pedido);

function adiado() {
  try {
    const quando = Number(localStorage.getItem(CHAVE_ADIADO));
    return !!quando && Date.now() - quando < DIAS_ADIADO * 864e5;
  } catch {
    return false;
  }
}

function adiar(valor) {
  try {
    if (valor) localStorage.setItem(CHAVE_ADIADO, String(Date.now()));
    else localStorage.removeItem(CHAVE_ADIADO);
  } catch { /* sem armazenamento: o aviso volta na próxima visita */ }
  redesenhar();
}

export function iniciarInstalacao(aoMudar) {
  redesenhar = aoMudar;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    pedido = evento;
    redesenhar();
  });
  window.addEventListener('appinstalled', () => {
    pedido = null;
    redesenhar();
  });
}

async function instalarAgora() {
  if (!pedido) return;
  const atual = pedido;
  pedido = null;
  await atual.prompt();
  await atual.userChoice.catch(() => null);
  redesenhar();
}

function passos() {
  if (pedido) {
    return el('button', { class: 'botao lima', onclick: instalarAgora }, 'Instalar o app');
  }
  if (dentroDeApp) {
    return el('p', { class: 'pequeno' }, ehIOS
      ? 'Abra este endereço no Safari para conseguir adicionar à tela de início.'
      : 'Abra este endereço no Chrome para conseguir instalar.');
  }
  if (ehIOS) {
    return el('ol', { class: 'passos' },
      el('li', {}, 'Toque em ', el('span', { class: 'tecla' }, icone('compartilhar', { tamanho: 16 }), 'Compartilhar'), ' na barra do Safari.'),
      el('li', {}, 'Role e escolha ', el('strong', {}, 'Adicionar à Tela de Início'), '.'),
      el('li', {}, 'Toque em ', el('strong', {}, 'Adicionar'), '.')
    );
  }
  return el('ol', { class: 'passos' },
    el('li', {}, 'Toque no menu ', el('span', { class: 'tecla' }, '⋮'), ' do navegador.'),
    el('li', {}, 'Escolha ', el('strong', {}, 'Instalar app'), ' ou ', el('strong', {}, 'Adicionar à tela inicial'), '.')
  );
}

function cartao(comAdiar) {
  return el('section', { class: 'cartao instalar', 'aria-label': 'Instalar o Renova.AI' },
    el('div', { class: 'linha topo' },
      el('img', { src: '/icones/icone-192.png', alt: '', width: '48', height: '48', class: 'instalar-icone' }),
      el('div', { class: 'cresce coluna', style: 'gap: 4px' },
        el('h3', {}, 'Coloque o Renova.AI na tela de início'),
        el('p', { class: 'pequeno suave' }, 'Abra o painel com um toque, em tela cheia, como um app. Não precisa baixar nada na loja.')
      )
    ),
    passos(),
    comAdiar && el('button', { class: 'link pequeno', onclick: () => adiar(true) }, 'Agora não')
  );
}

// Aviso no topo do painel. Some quando o app já está instalado ou se o personal tocar em "Agora não" (volta em 7 dias).
export function avisoInstalar() {
  if (!podeInstalar() || adiado()) return null;
  return cartao(true);
}

// Seção fixa na aba Conta, para quem adiou e quer instalar depois.
export function secaoInstalar() {
  if (instalado()) return el('p', { class: 'pequeno suave' }, 'O Renova.AI já está na tela de início deste aparelho.');
  if (!podeInstalar()) return null;
  return cartao(false);
}
