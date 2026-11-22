// Planos do Renova.AI: mostra os valores, leva ao pagamento (Mercado Pago) e confere a volta.
import { api, el, reais } from './comum.js';

let plano = 'anual';
let metodo = 'pix';
let enviando = false;
let erroPlano = '';

export const SUPORTE = 'izekicamilla@gmail.com';

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
export function blocoPlanos(info, redesenhar) {
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
    resumo = `Total no Pix: ${reais(t[plano].pix)}${economia > 0 ? ` (${t.descontoPix}% de desconto, ${reais(economia)} a menos)` : ''}. O código aparece na próxima tela e o acesso libera assim que o banco confirmar.`;
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
          location.href = r.url;
        } catch (e) {
          erroPlano = e.message;
          enviando = false;
          redesenhar();
        }
      },
    }, enviando ? 'Abrindo o pagamento…' : metodo === 'pix' ? `Pagar ${reais(valor)} com Pix` : 'Pagar com cartão'),
    el('p', { class: 'pequeno suave centro' }, 'Pagamento seguro pelo Mercado Pago. Sem renovação automática: você renova quando quiser, e os dias que ainda restam continuam valendo.')
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
