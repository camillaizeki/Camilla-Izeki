// Planos do Renova.AI: mostra os valores, leva ao pagamento (Mercado Pago) e confere a volta.
import { api, el, reais, copiar } from './comum.js';

let plano = 'anual';
let forma = 'pix'; // pix | cartao
let modoCartao = 'recorrente'; // recorrente | parcelado
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
      el('p', { class: 'pequeno suave' }, 'É a empresa responsável pelo App Renova.AI.')
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
const NOME_PLANO = { mensal: 'mensal', trimestral: 'trimestral', semestral: 'semestral', anual: 'anual', teste: 'de teste' };

export function textoSituacao(a) {
  if (a.situacao === 'teste') return a.diasRestantes ? `Teste grátis: ${faltam(a.diasRestantes)}.` : 'Seu teste grátis termina hoje.';
  if (a.situacao === 'ativa') return `Plano ${NOME_PLANO[a.plano] || ''} ativo até ${dataBR(a.acessoAte)}.`;
  if (a.situacao === 'cortesia') return 'Acesso liberado pela equipe Renova.AI.';
  if (a.situacao === 'teste_encerrado') return 'Seu teste grátis terminou.';
  if (a.situacao === 'vencida') return `Seu plano venceu em ${dataBR(a.acessoAte)}.`;
  return 'Sua conta está suspensa.';
}

// ---------- Renovação automática: cartão digitado no formulário seguro do Mercado Pago, dentro do app ----------

let cartaoAberto = false;
let telaCartaoNo = null; // a tela do cartão é montada uma vez: o formulário roda em iframes que não podem ser recriados
let controleCartao = null;

// O painel não deve redesenhar enquanto o formulário do cartão está aberto.
export const ocupado = () => cartaoAberto;

function carregarSdk() {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((ok, falha) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.onload = ok;
    script.onerror = () => falha(new Error('Não consegui carregar o formulário do cartão. Confira a internet e tente de novo, ou pague com Pix.'));
    document.head.append(script);
  });
}

function fecharCartao() {
  try {
    controleCartao?.unmount();
  } catch { /* já fechado */ }
  controleCartao = null;
  telaCartaoNo = null;
  cartaoAberto = false;
}

const periodo = (meses) => (meses === 1 ? 'por mês' : `a cada ${meses} meses`);

function telaCartao(info, redesenhar, aoConfirmar) {
  if (telaCartaoNo) return telaCartaoNo;
  const t = info.planos[plano];
  const escolhido = plano;
  const aviso = el('p', { class: 'pequeno suave' }, 'Carregando o formulário seguro do Mercado Pago…');
  const erro = el('p', { class: 'erro', role: 'alert', hidden: true });
  const caixa = el('div', { id: 'cartao-mp' });
  telaCartaoNo = el('div', { class: 'coluna', style: 'gap: 12px' },
    el('div', { class: 'cartao' },
      el('h3', {}, `${t.nome} com renovação automática`),
      el('p', { class: 'pequeno suave' }, `${reais(t.cartao)} ${periodo(t.meses)}, cobrado sozinho no cartão de crédito. A primeira cobrança sai em até 1 hora. Cancele quando quiser na aba Conta.`)
    ),
    aviso,
    caixa,
    erro,
    el('button', { class: 'link', onclick: () => { fecharCartao(); redesenhar(); } }, 'Voltar e escolher outra forma de pagamento')
  );

  // O formulário precisa da caixa já na tela.
  setTimeout(async () => {
    try {
      await carregarSdk();
      if (!telaCartaoNo) return;
      const mp = new window.MercadoPago(info.chavePublica, { locale: 'pt-BR' });
      controleCartao = await mp.bricks().create('cardPayment', 'cartao-mp', {
        initialization: { amount: t.cartao / 100, payer: { email: info.email } },
        customization: { paymentMethods: { maxInstallments: 1 } },
        callbacks: {
          onReady: () => { aviso.hidden = true; },
          onError: (e) => {
            console.error('Formulário do cartão', e);
            aviso.hidden = true;
          },
          onSubmit: (dados) => new Promise((ok, falha) => {
            erro.hidden = true;
            api('assinatura/recorrente', 'POST', { plano: escolhido, token: dados.token })
              .then((r) => {
                ok();
                fecharCartao();
                aoConfirmar({
                  status: 'aprovado',
                  tipo: 'ok',
                  texto: `Renovação automática ativada! A primeira cobrança de ${reais(r.recorrente.valor)} aparece no cartão em até 1 hora, e o acesso fica liberado.`,
                });
              })
              .catch((e) => {
                erro.textContent = e.message;
                erro.hidden = false;
                falha();
              });
          }),
        },
      });
    } catch (e) {
      aviso.hidden = true;
      erro.textContent = e.message;
      erro.hidden = false;
    }
  }, 0);
  return telaCartaoNo;
}

// Escolha de plano e forma de pagamento. "redesenhar" atualiza a tela que contém o bloco.
// "aoConfirmar" é chamado quando o pagamento é aprovado com a tela aberta (Pix ou renovação automática).
export function blocoPlanos(info, redesenhar, aoConfirmar = () => location.reload()) {
  ultimoRedesenhar = redesenhar;
  if (pixAberto) return telaPix(redesenhar);
  if (cartaoAberto) return telaCartao(info, redesenhar, aoConfirmar);
  const t = info.planos;
  const p = t[plano];
  const jaTemRenovacao = ['ativa', 'pausada'].includes(info.recorrente?.status);
  const podeRenovar = info.recorrenteDisponivel && !jaTemRenovacao;
  if (!podeRenovar && modoCartao === 'recorrente') modoCartao = 'parcelado';
  const metodo = forma === 'pix' ? 'pix' : modoCartao === 'recorrente' ? 'recorrente' : 'cartao';
  const escolherPlano = (id) => () => { plano = id; erroPlano = ''; redesenhar(); };
  const escolher = (fn) => () => { fn(); erroPlano = ''; redesenhar(); };

  const cartaoPlano = (id) => {
    const x = t[id];
    return el('button', { class: 'plano', type: 'button', 'aria-pressed': String(plano === id), onclick: escolherPlano(id) },
      id === 'anual' && x.economia > 0 && el('span', { class: 'plano-selo' }, 'Melhor preço'),
      el('span', { class: 'plano-nome' }, x.nome),
      el('strong', { class: 'plano-preco' }, reais(x.cartao)),
      el('span', { class: 'pequeno suave' }, x.meses === 1 ? 'por mês' : `${reais(x.porMes)}/mês`),
      el('span', { class: 'pequeno suave' }, x.economia > 0 ? `economize ${reais(x.economia)}` : `${reais(x.pix)} no Pix`)
    );
  };

  let resumo;
  if (metodo === 'pix') {
    const economia = p.cartao - p.pix;
    resumo = `Total no Pix: ${reais(p.pix)}${economia > 0 ? ` (${t.descontoPix}% de desconto, ${reais(economia)} a menos)` : ''}. O código Pix aparece aqui mesmo, e o acesso libera assim que o banco confirmar. Sem renovação automática.`;
  } else if (metodo === 'recorrente') {
    resumo = `${reais(p.cartao)} ${periodo(p.meses)}, cobrado sozinho no cartão de crédito, sem parcelas e sem juros. Cancele quando quiser na aba Conta.`;
  } else if (p.parcelas > 1) {
    resumo = `${reais(p.cartao)} à vista ou em até ${p.parcelas}x. Os juros do parcelamento ficam por conta de quem paga e aparecem antes de você confirmar. Sem renovação automática.`;
  } else {
    resumo = `${reais(p.cartao)} no cartão, à vista, sem renovação automática.`;
  }

  const rodape = {
    pix: 'Pix processado pelo Mercado Pago. Você renova quando quiser, e os dias que ainda restam continuam valendo.',
    recorrente: 'Os dados do cartão são digitados no formulário seguro do Mercado Pago, aqui mesmo no app, sem precisar de conta lá.',
    cartao: 'O cartão é pago na página segura do Mercado Pago, sem precisar de conta lá: basta preencher os dados do cartão.',
  }[metodo];

  return el('div', { class: 'coluna', style: 'gap: 14px' },
    el('div', { class: 'planos' }, (t.ordem || ['mensal', 'anual']).map(cartaoPlano)),
    el('fieldset', { class: 'pergunta' },
      el('legend', {}, 'Forma de pagamento'),
      el('div', { class: 'opcoes' },
        el('button', { class: 'opcao', type: 'button', 'aria-pressed': String(forma === 'pix'), onclick: escolher(() => { forma = 'pix'; }) }, t.descontoPix ? `Pix · ${t.descontoPix}% off` : 'Pix'),
        el('button', { class: 'opcao', type: 'button', 'aria-pressed': String(forma === 'cartao'), onclick: escolher(() => { forma = 'cartao'; }) }, 'Cartão')
      ),
      forma === 'cartao' && podeRenovar && el('div', { class: 'opcoes' },
        el('button', { class: 'opcao', type: 'button', 'aria-pressed': String(modoCartao === 'recorrente'), onclick: escolher(() => { modoCartao = 'recorrente'; }) }, 'Renovação automática'),
        el('button', { class: 'opcao', type: 'button', 'aria-pressed': String(modoCartao === 'parcelado'), onclick: escolher(() => { modoCartao = 'parcelado'; }) }, p.parcelas > 1 ? `Parcelado até ${p.parcelas}x` : 'Só este período')
      ),
      forma === 'cartao' && jaTemRenovacao && el('p', { class: 'pequeno suave' }, 'Você já tem renovação automática ativa. Para trocar de plano, cancele na aba Conta.'),
      el('p', { class: 'pequeno suave' }, resumo)
    ),
    !info.configurado && el('p', { class: 'aviso' }, `O pagamento pelo app está sendo ativado. Enquanto isso, fale com a gente: ${SUPORTE}.`),
    erroPlano && el('p', { class: 'erro', role: 'alert' }, erroPlano),
    el('button', {
      class: 'botao',
      disabled: enviando || !info.configurado,
      onclick: async () => {
        if (metodo === 'recorrente') {
          cartaoAberto = true;
          redesenhar();
          return;
        }
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
    }, enviando
      ? (metodo === 'pix' ? 'Gerando o Pix…' : 'Abrindo o pagamento…')
      : metodo === 'pix' ? `Gerar Pix de ${reais(p.pix)}` : metodo === 'recorrente' ? 'Continuar com o cartão' : 'Pagar com cartão'),
    el('p', { class: 'pequeno suave centro' }, rodape)
  );
}

// Cartão da aba Conta: mostra a renovação automática e deixa cancelar (dois toques, para evitar engano).
let confirmarCancelamento = false;
let cancelando = false;
export function blocoRenovacao(info, aoMudar) {
  const r = info?.recorrente;
  if (!r || !['ativa', 'pausada'].includes(r.status)) return null;
  const t = info.planos[r.plano] || { nome: r.plano, meses: 1 };
  return el('div', { class: 'cartao' },
    el('h3', {}, 'Renovação automática'),
    r.status === 'ativa'
      ? el('p', { class: 'pequeno suave' }, `${t.nome}: ${reais(r.valor)} ${periodo(t.meses)} no cartão.${r.proximaCobranca ? ` Próxima cobrança em ${dataBR(r.proximaCobranca)}.` : ''}`)
      : el('p', { class: 'erro' }, 'O Mercado Pago pausou a renovação depois de cobranças recusadas. Cancele e ative de novo com outro cartão, ou pague com Pix.'),
    el('button', {
      class: 'botao claro menor',
      disabled: cancelando,
      onclick: async () => {
        if (!confirmarCancelamento) {
          confirmarCancelamento = true;
          aoMudar(null);
          return;
        }
        cancelando = true;
        aoMudar(null);
        try {
          const x = await api('assinatura/recorrente/cancelar', 'POST', {});
          aoMudar({ tipo: 'ok', texto: `Renovação automática cancelada. Seu acesso continua até ${dataBR(x.assinatura.acessoAte)}.` });
        } catch (e) {
          aoMudar({ tipo: 'erro', texto: e.message });
        } finally {
          cancelando = false;
          confirmarCancelamento = false;
        }
      },
    }, cancelando ? 'Cancelando…' : confirmarCancelamento ? 'Toque de novo para confirmar o cancelamento' : 'Cancelar renovação automática')
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
