// Planos do Renova.AI: mostra os valores, leva ao pagamento (Mercado Pago) e confere a volta.
import { api, el, reais, copiar } from './comum.js';

let plano = 'anual';
let metodo = 'pix';
let enviando = false;
let erroPlano = '';
let pixAberto = null; // { id, valor, pix: { copiaECola, qrBase64 } } enquanto o Pix aguarda pagamento
let acompanhamento = null;
let ultimoRedesenhar = () => {};

// Voltar do checkout pelo botão "voltar" do navegador restaura a página como estava ("Abrindo o pagamento…").
window.addEventListener('pageshow', (e) => {
  if (e.persisted && enviando) {
    enviando = false;
    ultimoRedesenhar();
  }
});

function pararAcompanhamento() {
  if (acompanhamento) clearInterval(acompanhamento);
  acompanhamento = null;
}

// Confere o Pix a cada 5 segundos por até 30 minutos; ao aprovar, avisa a tela.
function acompanharPix(aoConfirmar) {
  pararAcompanhamento();
  let tentativas = 0;
  acompanhamento = setInterval(async () => {
    if (!pixAberto || ++tentativas > 360) return pararAcompanhamento();
    try {
      const r = await conferir(pixAberto.id);
      if (r.status === 'aprovado') {
        pararAcompanhamento();
        pixAberto = null;
        aoConfirmar(r);
      }
    } catch { /* tenta de novo */ }
  }, 5000);
}

function telaPix(redesenhar) {
  const copiarBotao = el('button', {
    class: 'botao',
    onclick: async () => {
      copiarBotao.textContent = (await copiar(pixAberto.pix.copiaECola)) ? 'Código copiado' : 'Selecione o código acima e copie';
    },
  }, 'Copiar código Pix');
  return el('div', { class: 'coluna', style: 'gap: 14px' },
    el('div', { class: 'cartao centro' },
      el('p', { class: 'suave' }, `Pague ${reais(pixAberto.valor)} no app do seu banco`),
      pixAberto.pix.qrBase64 && el('img', { src: 'data:image/png;base64,' + pixAberto.pix.qrBase64, alt: 'QR Code do Pix', width: '200', height: '200', style: 'margin: 6px auto; display: block; image-rendering: pixelated' }),
      el('p', { class: 'pequeno suave' }, 'No celular, copie o código e use "Pix Copia e Cola" no banco.')
    ),
    el('div', { class: 'cartao' },
      el('p', { class: 'pequeno suave' }, 'No seu banco, o recebedor aparece como:'),
      el('p', { style: 'font-weight: 600' }, RECEBEDOR),
      el('p', { class: 'pequeno suave' }, 'É a empresa responsável pelo App Renova.AI. Pode pagar tranquilo.')
    ),
    el('div', { class: 'pix-codigo' }, pixAberto.pix.copiaECola),
    copiarBotao,
    el('p', { class: 'aviso', role: 'status' }, 'Aguardando o pagamento… Assim que o banco confirmar, o acesso libera sozinho nesta tela. O código vale por 30 minutos.'),
    el('button', { class: 'link', onclick: () => { pararAcompanhamento(); pixAberto = null; redesenhar(); } }, 'Escolher outra forma de pagamento')
  );
}

export const SUPORTE = 'izekicamilla@gmail.com';
// Titular da conta que recebe: é o nome que o banco mostra na hora de pagar o Pix.
const RECEBEDOR = '36.348.714 CAMILLA IZEKI MARTINS';

const dataBR = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const faltam = (n) => (n === 1 ? 'falta 1 dia' : `faltam ${n} dias`);
const NOME_PLANO = { mensal: 'mensal', anual: 'anual', teste: 'de teste' };

export function textoSituacao(a) {
  if (a.situacao === 'teste') return a.diasRestantes ? `Teste grátis: ${faltam(a.diasRestantes)}.` : 'Seu teste grátis termina hoje.';
  if (a.situacao === 'ativa') return `Plano ${NOME_PLANO[a.plano] || ''} ativo até ${dataBR(a.acessoAte)}.`;
  if (a.situacao === 'cortesia') return 'Acesso liberado pela equipe Renova.AI.';
  if (a.situacao === 'teste_encerrado') return 'Seu teste grátis terminou.';
  if (a.situacao === 'vencida') return `Seu plano venceu em ${dataBR(a.acessoAte)}.`;
  return 'Sua conta está suspensa.';
}

// Escolha de plano e forma de pagamento. "redesenhar" atualiza a tela que contém o bloco.
// "aoConfirmar" é chamado quando o Pix é aprovado com a tela aberta.
export function blocoPlanos(info, redesenhar, aoConfirmar = () => location.reload()) {
  ultimoRedesenhar = redesenhar;
  if (pixAberto) return telaPix(redesenhar);
  const t = info.planos;
  const valor = t[plano][metodo];
  const escolherPlano = (id) => () => { plano = id; erroPlano = ''; redesenhar(); };
  const escolherMetodo = (id) => () => { metodo = id; erroPlano = ''; redesenhar(); };

  const cartaoPlano = (id, titulo, precoTexto, linhas, selo) =>
    el('button', { class: 'plano', type: 'button', 'aria-pressed': String(plano === id), onclick: escolherPlano(id) },
      selo && el('span', { class: 'plano-selo' }, selo),
      el('span', { class: 'plano-nome' }, titulo),
      el('strong', { class: 'plano-preco' }, precoTexto),
      ...linhas.map((l) => el('span', { class: 'pequeno suave' }, l))
    );

  let resumo;
  if (metodo === 'pix') {
    const economia = t[plano].cartao - t[plano].pix;
    resumo = `Total no Pix: ${reais(t[plano].pix)}${economia > 0 ? ` (${t.descontoPix}% de desconto, ${reais(economia)} a menos)` : ''}. O código Pix aparece aqui mesmo, e o acesso libera assim que o banco confirmar.`;
  } else if (plano === 'anual' && t.anual.parcelas > 1) {
    resumo = `${reais(t.anual.cartao)} à vista ou em até ${t.anual.parcelas}x no cartão. Os juros do parcelamento ficam por conta de quem paga e aparecem antes de você confirmar.`;
  } else {
    resumo = `${reais(t[plano].cartao)} no cartão, à vista.`;
  }

  return el('div', { class: 'coluna', style: 'gap: 14px' },
    el('div', { class: 'planos' },
      cartaoPlano('mensal', 'Mensal', reais(t.mensal.cartao), [`por mês`, `${reais(t.mensal.pix)} no Pix`]),
      cartaoPlano('anual', 'Anual', reais(t.anual.cartao), [`por ano, ${reais(t.anual.porMes)}/mês`, t.anual.parcelas > 1 ? `até ${t.anual.parcelas}x no cartão` : `${reais(t.anual.pix)} no Pix`],
        t.anual.economia > 0 ? `Economize ${reais(t.anual.economia)}` : null)
    ),
    el('fieldset', { class: 'pergunta' },
      el('legend', {}, 'Forma de pagamento'),
      el('div', { class: 'opcoes' },
        el('button', { class: 'opcao', type: 'button', 'aria-pressed': String(metodo === 'pix'), onclick: escolherMetodo('pix') }, t.descontoPix ? `Pix · ${t.descontoPix}% off` : 'Pix'),
        el('button', { class: 'opcao', type: 'button', 'aria-pressed': String(metodo === 'cartao'), onclick: escolherMetodo('cartao') }, 'Cartão')
      ),
      el('p', { class: 'pequeno suave' }, resumo)
    ),
    !info.configurado && el('p', { class: 'aviso' }, `O pagamento pelo app está sendo ativado. Enquanto isso, fale com a gente: ${SUPORTE}.`),
    erroPlano && el('p', { class: 'erro', role: 'alert' }, erroPlano),
    el('button', {
      class: 'botao',
      disabled: enviando || !info.configurado,
      onclick: async () => {
        enviando = true;
        erroPlano = '';
        redesenhar();
        try {
          const r = await api('assinatura/checkout', 'POST', { plano, metodo });
          if (r.pix) {
            enviando = false;
            pixAberto = r;
            acompanharPix(aoConfirmar);
            redesenhar();
            return;
          }
          location.href = r.url;
        } catch (e) {
          erroPlano = e.message;
          enviando = false;
          redesenhar();
        }
      },
    }, enviando ? (metodo === 'pix' ? 'Gerando o Pix…' : 'Abrindo o pagamento…') : metodo === 'pix' ? `Gerar Pix de ${reais(valor)}` : 'Pagar com cartão'),
    el('p', { class: 'pequeno suave centro' }, metodo === 'pix'
      ? 'Pix processado pelo Mercado Pago. Sem renovação automática: você renova quando quiser, e os dias que ainda restam continuam valendo.'
      : 'O cartão é pago na página segura do Mercado Pago, sem precisar de conta lá: basta preencher os dados do cartão. Sem renovação automática.')
  );
}

const MENSAGENS = {
  aprovado: (a) => ({ tipo: 'ok', texto: `Pagamento confirmado! Seu acesso vai até ${dataBR(a.acessoAte)}.` }),
  pendente: () => ({ tipo: 'espera', texto: 'Pagamento em processamento. No Pix, o acesso libera sozinho assim que o banco confirmar, normalmente em poucos minutos.' }),
  aguardando: () => ({ tipo: 'erro', texto: 'O pagamento não foi concluído. Se quiser, é só tentar de novo.' }),
  recusado: () => ({ tipo: 'erro', texto: 'O pagamento não foi aprovado. Tente de novo ou escolha outra forma de pagamento.' }),
  cancelado: () => ({ tipo: 'erro', texto: 'O pagamento foi cancelado. Se quiser, é só tentar de novo.' }),
  divergente: () => ({ tipo: 'erro', texto: `Recebemos um valor diferente do plano. Vamos conferir e falar com você pelo e-mail ${SUPORTE}.` }),
  reembolsado: () => ({ tipo: 'erro', texto: 'Este pagamento foi devolvido.' }),
};

async function conferir(id) {
  const r = await api('assinatura/verificar', 'POST', { id });
  return { status: r.status, ...(MENSAGENS[r.status] || MENSAGENS.pendente)(r.assinatura) };
}

// Volta do Mercado Pago: /painel?assinatura=<id>. Confere na hora e, se ainda estiver em processamento,
// confere de novo a cada 8 segundos por alguns minutos (o Pix costuma confirmar logo).
export async function voltaDoCheckout(aoMudar) {
  const id = Number(new URLSearchParams(location.search).get('assinatura'));
  if (!id) return null;
  history.replaceState(null, '', location.pathname);
  try {
    const primeira = await conferir(id);
    if (primeira.status === 'pendente') {
      let tentativas = 0;
      const timer = setInterval(async () => {
        if (++tentativas > 25) return clearInterval(timer);
        try {
          const r = await conferir(id);
          if (r.status !== 'pendente') {
            clearInterval(timer);
            aoMudar(r);
          }
        } catch { /* tenta de novo */ }
      }, 8000);
    }
    return primeira;
  } catch (e) {
    return e.status === 401 ? null : { tipo: 'erro', texto: e.message };
  }
}

export function avisoPagamento(msg) {
  if (!msg) return null;
  return el('p', { class: msg.tipo === 'erro' ? 'erro' : 'aviso', role: 'status' }, msg.texto);
}
