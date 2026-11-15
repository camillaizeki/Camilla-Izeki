// Página do aluno (/a/<código>): trilha, renovação por Pix e arte para compartilhar.
import { api, el, icone, meses, reais, copiar, montar } from './comum.js';

const token = location.pathname.split('/').filter(Boolean)[1] || '';
let d = null; // dados vindos do servidor
let tela = new URLSearchParams(location.search).get('novo') ? 'desbloqueio' : 'trilha';
let fraseIdx = 0;
let aviso = '';
let fotoImg = null;

const P = () => d.personal.primeiroNome;

async function carregar() {
  d = await api('aluno/' + token);
  if (!d.frases.length) d.frases = ['Mais um mês de treino concluído.'];
}

function selo(numero, tamanho, borda = '#FFFFFF') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', tamanho);
  svg.setAttribute('height', tamanho);
  svg.setAttribute('viewBox', '0 0 96 96');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Selo de ' + meses(numero));
  svg.innerHTML =
    `<polygon points="48,4 88,26 88,70 48,92 8,70 8,26" fill="#C8F03C" stroke="${borda}" stroke-width="3" stroke-linejoin="round"/>` +
    `<text x="48" y="60" text-anchor="middle" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="${numero > 99 ? 26 : 36}" fill="#14181F">${Number(numero)}</text>`;
  return svg;
}

// ---------- Telas ----------

function telaDesbloqueio() {
  const s = d.selo;
  return el('div', { class: 'tela-escura' },
    selo(d.meses, 148),
    s.nome && el('p', { class: 'rotulo' }, 'Selo ' + s.nome + ' desbloqueado'),
    el('h1', { style: 'font-size: 32px' }, d.meses > 0 ? `${d.nome}, você já tem ${meses(d.meses)} de treino` : `${d.nome}, sua jornada com ${P()} começa agora`),
    el('p', { style: 'color: #C9CED8' }, `${s.proximo.faltam === 1 ? 'Falta 1 mês' : 'Faltam ' + s.proximo.faltam + ' meses'} para o selo ${s.proximo.nome}.`),
    el('button', { class: 'botao lima', style: 'margin-top: 12px', onclick: () => ir('trilha') }, 'Ver minha trilha')
  );
}

function fase(f) {
  const icones = { feita: ['check', 3], pendente: ['relogio', 2], travada: ['cadeado', 2] };
  const [nome, traco] = icones[f.estado];
  return el('div', { class: 'fase ' + f.estado },
    el('div', { class: 'no' }, icone(nome, { tamanho: 24, traco, cor: f.estado === 'travada' ? '#5A6170' : '#14181F' })),
    el('div', {},
      el('h3', {}, 'Mês ' + f.n + (f.mes ? ' · ' + f.mes : '')),
      el('p', { class: 'pequeno suave' }, f.nota)
    )
  );
}

function acaoDaTrilha() {
  if (d.status === 'novo') {
    return el('p', { class: 'aviso' }, `Cadastro enviado. Assim que ${P()} confirmar, você poderá desbloquear ${d.nomeAlvo} por aqui.`);
  }
  if (d.situacao === 'informado') {
    return [
      el('p', { class: 'pequeno suave centro' }, `${P()} vai confirmar o recebimento e ${d.nomeAlvo} fica desbloqueado.`),
      el('button', { class: 'botao lima', onclick: () => ir('arte') }, 'Compartilhar conquista'),
    ];
  }
  if (!d.pix) {
    return el('p', { class: 'aviso' }, `${P()} ainda está terminando de configurar a renovação. Volte em breve.`);
  }
  const rotulo = d.status === 'pausado' ? 'Voltar e desbloquear ' + d.nomeAlvo : 'Desbloquear ' + d.nomeAlvo;
  return el('button', { class: 'botao', onclick: () => ir('pix') }, rotulo);
}

function telaTrilha() {
  return [
    el('div', {},
      el('p', { class: 'suave' }, 'Oi, ' + d.nome),
      el('h1', { style: 'font-size: 26px' }, d.meses > 0 ? `${meses(d.meses)} treinando com ${P()}` : `Sua jornada com ${P()}`)
    ),
    d.sequencia >= 2 && el('div', { class: 'sequencia' }, icone('raio', { tamanho: 14, cor: '#C8F03C', traco: 2.5 }), `Sequência: ${d.sequencia} meses seguidos`),
    d.status === 'pausado' && el('p', { class: 'pequeno suave' }, 'Sua jornada está guardada. É só voltar quando quiser.'),
    el('div', { class: 'trilha cresce' }, d.fases.map(fase)),
    el('div', { class: 'coluna fim' },
      acaoDaTrilha(),
      d.status !== 'novo' && d.situacao !== 'informado' && d.meses > 0 &&
        el('button', { class: 'botao claro', onclick: () => ir('arte') }, icone('compartilhar', { tamanho: 18 }), 'Compartilhar minha conquista')
    ),
  ];
}

function telaPix() {
  const copiarBotao = el('button', {
    class: 'botao claro',
    onclick: async () => {
      copiarBotao.textContent = (await copiar(d.pix)) ? 'Código copiado' : 'Selecione e copie o código acima';
    },
  }, 'Copiar código Pix');

  const paguei = el('button', {
    class: 'botao',
    onclick: async () => {
      paguei.disabled = true;
      try {
        await api('aluno/' + token + '/paguei', 'POST', {});
        await carregar();
        fraseIdx = Math.floor(Math.random() * d.frases.length);
        ir('arte');
      } catch (e) {
        aviso = e.message;
        ir('pix');
      }
    },
  }, 'Já paguei');

  return [
    el('button', { class: 'link', style: 'align-self: flex-start', onclick: () => ir('trilha') }, 'Voltar para a trilha'),
    el('div', {},
      el('h1', { style: 'font-size: 30px' }, 'Desbloquear ' + d.nomeAlvo),
      el('p', { class: 'suave', style: 'margin-top: 8px' }, `Mais um mês com ${P()} na sua trilha.`)
    ),
    el('div', { class: 'cartao', style: 'border: 1.5px solid #14181F' },
      el('div', { class: 'linha entre' }, el('span', { class: 'suave' }, 'Mensalidade'), el('strong', { style: "font-family: 'Space Grotesk', sans-serif; font-size: 18px" }, reais(d.valor))),
      el('p', { class: 'pequeno suave' }, 'Abra o app do seu banco, escolha Pix copia e cola e cole o código:'),
      el('div', { class: 'pix-codigo' }, d.pix),
      copiarBotao
    ),
    aviso && el('p', { class: 'erro', role: 'alert' }, aviso),
    el('div', { class: 'coluna fim' },
      paguei,
      el('p', { class: 'pequeno suave centro' }, `${P()} confirma o recebimento e o mês fica desbloqueado na sua trilha.`)
    ),
  ];
}

// ---------- Arte ----------

function mesesNaArte() {
  return d.situacao === 'informado' ? d.meses + 1 : d.meses;
}

function fraseAtual() {
  return d.frases[fraseIdx % d.frases.length].replaceAll('{meses}', String(mesesNaArte()));
}

function quebrar(ctx, texto, largura) {
  const linhas = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/)) {
    const teste = atual ? atual + ' ' + palavra : palavra;
    if (ctx.measureText(teste).width > largura && atual) {
      linhas.push(atual);
      atual = palavra;
    } else atual = teste;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

async function carregarFoto() {
  if (!d.personal.temFoto || fotoImg) return;
  fotoImg = await new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = '/api/foto/' + d.personal.slug;
  });
}

async function desenharArte(canvas) {
  const L = 1080, A = 1920, topo = 1000;
  canvas.width = L;
  canvas.height = A;
  const ctx = canvas.getContext('2d');
  try {
    await Promise.all([document.fonts.load('700 84px "Space Grotesk"'), document.fonts.load('600 44px Inter')]);
  } catch { /* segue com a fonte do aparelho */ }
  await carregarFoto();

  ctx.fillStyle = '#14181F';
  ctx.fillRect(0, 0, L, A);
  if (fotoImg) {
    const escala = Math.max(L / fotoImg.width, topo / fotoImg.height);
    const w = fotoImg.width * escala, h = fotoImg.height * escala;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, L, topo);
    ctx.clip();
    ctx.drawImage(fotoImg, (L - w) / 2, (topo - h) / 2, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = '#2A303B';
    ctx.fillRect(0, 0, L, topo);
  }

  // Selo
  const cx = 210, cy = topo, r = 130;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 3) * i - Math.PI / 2;
    ctx[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(ang), cy + r * Math.sin(ang));
  }
  ctx.closePath();
  ctx.fillStyle = '#C8F03C';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#14181F';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = '#14181F';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = String(mesesNaArte());
  ctx.font = `700 ${n.length > 2 ? 90 : 120}px "Space Grotesk", sans-serif`;
  ctx.fillText(n, cx, cy + 6);

  // Frase
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  let tamanho = 88;
  let linhas;
  do {
    ctx.font = `700 ${tamanho}px "Space Grotesk", sans-serif`;
    linhas = quebrar(ctx, fraseAtual(), L - 160);
    tamanho -= 8;
  } while (linhas.length > 5 && tamanho > 48);
  const alturaLinha = (tamanho + 8) * 1.18;
  linhas.forEach((linha, i) => ctx.fillText(linha, 80, 1270 + i * alturaLinha));

  // Rodapé
  ctx.fillStyle = '#C8F03C';
  ctx.font = '600 44px Inter, sans-serif';
  ctx.fillText((mesesNaArte() > 0 ? `${meses(mesesNaArte())} de treino com ${P()}` : `Treinando com ${P()}`).toUpperCase(), 80, 1790);
  ctx.fillStyle = '#C9CED8';
  ctx.font = '500 34px Inter, sans-serif';
  ctx.fillText('Renova.AI', 80, 1850);
}

function telaArte() {
  const canvas = el('canvas', { class: 'arte', role: 'img', 'aria-label': 'Arte: ' + fraseAtual() });
  desenharArte(canvas);

  const compartilhar = el('button', {
    class: 'botao',
    onclick: async () => {
      const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
      const arquivo = new File([blob], 'renova-ai.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
        try {
          await navigator.share({ files: [arquivo] });
        } catch { /* a pessoa fechou o compartilhamento */ }
      } else {
        const link = el('a', { href: URL.createObjectURL(blob), download: 'renova-ai.png' });
        link.click();
        compartilhar.textContent = 'Imagem salva. Agora é só postar.';
      }
    },
  }, 'Compartilhar');

  return [
    el('h1', { style: 'font-size: 22px' }, 'Sua arte para compartilhar'),
    canvas,
    el('div', { class: 'coluna fim', style: 'gap: 10px' },
      d.frases.length > 1 && el('button', {
        class: 'botao claro',
        onclick: () => {
          fraseIdx++;
          canvas.setAttribute('aria-label', 'Arte: ' + fraseAtual());
          desenharArte(canvas);
        },
      }, icone('trocar', { tamanho: 18 }), 'Trocar frase'),
      compartilhar,
      el('button', { class: 'link', onclick: () => ir('trilha') }, 'Voltar para a trilha')
    ),
  ];
}

function ir(nova) {
  if (nova !== 'pix') aviso = '';
  tela = nova;
  const telas = { desbloqueio: telaDesbloqueio, trilha: telaTrilha, pix: telaPix, arte: telaArte };
  montar(telas[tela]());
  window.scrollTo(0, 0);
}

try {
  await carregar();
  history.replaceState(null, '', location.pathname);
  ir(tela);
} catch (e) {
  montar(el('h1', {}, 'Link não encontrado'), el('p', { class: 'suave' }, e.message));
}
