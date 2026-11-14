// Funções usadas por todas as telas.

export async function api(caminho, metodo = 'GET', dados) {
  let resposta;
  try {
    resposta = await fetch('/api/' + caminho, {
      method: metodo,
      headers: dados ? { 'content-type': 'application/json' } : undefined,
      body: dados ? JSON.stringify(dados) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Sem conexão. Confira a internet e tente de novo.');
  }
  let corpo = {};
  try {
    corpo = await resposta.json();
  } catch {
    /* resposta sem corpo */
  }
  if (!resposta.ok) {
    const erro = new Error(corpo.erro || 'Algo deu errado. Tente de novo.');
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

// Cria elementos sem montar HTML com texto do usuário.
export function el(tag, atributos = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos || {})) {
    if (valor == null || valor === false) continue;
    if (chave === 'class') no.className = valor;
    else if (chave.startsWith('on')) no.addEventListener(chave.slice(2), valor);
    else if (chave === 'value') no.value = valor;
    else if (chave === 'checked') no.checked = !!valor;
    else no.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of filhos.flat(3)) {
    if (filho == null || filho === false) continue;
    no.append(filho.nodeType ? filho : String(filho));
  }
  return no;
}

const DESENHOS = {
  check: '<path d="M5 12l5 5 9-10"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  compartilhar: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  raio: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  trocar: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
};

export function icone(nome, { tamanho = 22, cor = 'currentColor', traco = 2 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', tamanho);
  svg.setAttribute('height', tamanho);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', cor);
  svg.setAttribute('stroke-width', traco);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = DESENHOS[nome] || '';
  return svg;
}

export const meses = (n) => (n === 1 ? '1 mês' : n + ' meses');

export const reais = (centavos) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// "250", "250,5" ou "R$ 250,00" viram centavos.
export function paraCentavos(texto) {
  const limpo = String(texto || '').replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const valor = Math.round(parseFloat(limpo) * 100);
  return Number.isFinite(valor) ? valor : 0;
}

export function campo(rotulo, atributos, tag = 'input') {
  const id = atributos.id;
  return el('div', { class: 'campo' }, el('label', { for: id }, rotulo), el(tag, atributos));
}

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = el('textarea', { value: texto, style: 'position:fixed;opacity:0' });
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function montar(...filhos) {
  const app = document.getElementById('app');
  app.replaceChildren(...filhos.flat(3).filter(Boolean));
}
