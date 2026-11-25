// Renova.AI · Leitura de comprovantes (navegador)
// Transforma imagem ou PDF em texto, tudo no próprio celular:
//  - PDF com texto (o que o banco gera): leitura direta com pdf.js, sem OCR.
//  - PDF digitalizado, foto ou print: OCR com Tesseract.js (português).
// Nada é enviado ao servidor e nada é gravado: o arquivo só existe na memória
// durante a leitura.

import { extrairDados } from './extracao.js';

const PDFJS_VERSAO = '6.2.108';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSAO}/legacy/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSAO}/legacy/build/pdf.worker.min.mjs`;
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export const TAMANHO_MAXIMO = 10 * 1024 * 1024; // 10 MB
const LADO_MAXIMO = 2000; // px: suficiente para o OCR, leve para o celular
const MIN_CARACTERES_PDF = 40; // menos que isso = PDF sem texto (digitalizado)

export class ErroLeitura extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

// ---------------------------------------------------------------------------
// Carregamento sob demanda das bibliotecas (só quando o personal usa)
// ---------------------------------------------------------------------------

let pdfjsPromessa = null;
function carregarPdfjs() {
  if (!pdfjsPromessa) {
    pdfjsPromessa = import(/* @vite-ignore */ PDFJS_URL).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    });
    pdfjsPromessa.catch(() => { pdfjsPromessa = null; });
  }
  return pdfjsPromessa;
}

let tesseractPromessa = null;
function carregarTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!tesseractPromessa) {
    tesseractPromessa = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.async = true;
      s.onload = () => resolve(globalThis.Tesseract);
      s.onerror = () => { tesseractPromessa = null; reject(new ErroLeitura('sem_conexao', 'Não foi possível carregar o leitor.')); };
      document.head.appendChild(s);
    });
  }
  return tesseractPromessa;
}

// Um único worker de OCR é reaproveitado para vários comprovantes da fila.
let workerOcr = null;
let progressoAtual = null;
async function obterWorkerOcr() {
  if (!workerOcr) {
    const Tesseract = await carregarTesseract();
    workerOcr = Tesseract.createWorker('por', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && progressoAtual) progressoAtual(m.progress);
      },
    });
    workerOcr.catch(() => { workerOcr = null; });
  }
  return workerOcr;
}

/** Libera a memória do OCR. Chame ao terminar a fila. */
export async function encerrarLeitura() {
  if (workerOcr) {
    const w = workerOcr;
    workerOcr = null;
    try { (await w).terminate(); } catch { /* já encerrado */ }
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export function ehPdf(arquivo) {
  return arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name || '');
}

export function ehImagem(arquivo) {
  return /^image\//.test(arquivo.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(arquivo.name || '');
}

// Modos de leitura do Tesseract: "6" lê a página como um bloco (bom para as linhas "rótulo  valor"
// dos comprovantes); "3" separa a página em blocos sozinho e pega o que o "6" às vezes pula,
// como um valor grande e isolado ("R$ 300"). A segunda leitura só acontece se faltar valor ou pagador.
async function ocrDeCanvas(canvas, onProgresso) {
  const worker = await obterWorkerOcr();
  const ler = async (modo, inicio, peso) => {
    await worker.setParameters?.({ tessedit_pageseg_mode: modo });
    progressoAtual = onProgresso ? (f) => onProgresso(inicio + f * peso) : null;
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  };
  try {
    let texto = await ler('6', 0, 0.85);
    const dados = extrairDados(texto);
    if (dados.valor == null || !dados.pagador) texto += '\n' + (await ler('3', 0.85, 0.15)); // o primeiro achado de cada campo vale
    return texto;
  } finally {
    progressoAtual = null;
  }
}

function canvasReduzido(origem, largura, altura) {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(largura, altura));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largura * escala);
  canvas.height = Math.round(altura * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fundo branco para PNG transparente
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(origem, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function liberarCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

async function lerImagem(arquivo, onProgresso) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(arquivo);
  } catch {
    throw new ErroLeitura('formato', 'Não conseguimos abrir esta imagem.');
  }
  const canvas = canvasReduzido(bitmap, bitmap.width, bitmap.height);
  bitmap.close?.();
  try {
    return { texto: await ocrDeCanvas(canvas, onProgresso), origem: 'ocr' };
  } finally {
    liberarCanvas(canvas);
  }
}

async function lerPdf(arquivo, onProgresso) {
  const pdfjs = await carregarPdfjs().catch(() => {
    throw new ErroLeitura('sem_conexao', 'Não foi possível carregar o leitor de PDF.');
  });
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) });
  let doc;
  try {
    doc = await tarefa.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new ErroLeitura('pdf_senha', 'Este PDF tem senha.');
    const erro = new ErroLeitura('formato', 'Não conseguimos abrir este PDF.');
    erro.cause = e;
    throw erro;
  }
  try {
    const pagina = await doc.getPage(1); // os dados do Pix ficam na primeira página
    const conteudo = await pagina.getTextContent();
    const texto = conteudo.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('');
    if (texto.replace(/\s/g, '').length >= MIN_CARACTERES_PDF) {
      onProgresso?.(1);
      return { texto, origem: 'pdf-texto' };
    }
    // PDF digitalizado: renderiza a página e aplica OCR.
    const base = pagina.getViewport({ scale: 1 });
    const escala = Math.min(2.5, LADO_MAXIMO / Math.max(base.width, base.height));
    const viewport = pagina.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    try {
      return { texto: await ocrDeCanvas(canvas, onProgresso), origem: 'pdf-ocr' };
    } finally {
      liberarCanvas(canvas);
    }
  } finally {
    tarefa.destroy().catch?.(() => {}); // libera o PDF da memória
  }
}

/**
 * Lê um comprovante (imagem ou PDF) e devolve o texto.
 * @param {File|Blob} arquivo
 * @param {{onProgresso?: (fracao:number) => void}} [opcoes]
 * @returns {Promise<{texto: string, origem: 'ocr'|'pdf-texto'|'pdf-ocr'}>}
 */
export async function lerComprovante(arquivo, { onProgresso } = {}) {
  if (!arquivo) throw new ErroLeitura('formato', 'Nenhum arquivo.');
  if (arquivo.size > TAMANHO_MAXIMO) {
    throw new ErroLeitura('tamanho', 'O arquivo passa de 10 MB.');
  }
  if (ehPdf(arquivo)) return lerPdf(arquivo, onProgresso);
  if (ehImagem(arquivo)) return lerImagem(arquivo, onProgresso);
  throw new ErroLeitura('formato', 'Formato não aceito.');
}
