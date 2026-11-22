// Conversa com o Mercado Pago (Checkout Pro). O aluno não passa por aqui: só a assinatura do personal.
// O token fica na Cloudflare como segredo MP_ACCESS_TOKEN. Sem ele, o pagamento aparece como "em configuração".

const BASE = 'https://api.mercadopago.com';

export class ErroMP extends Error {}

export const mpConfigurado = (env) => String(env.MP_ACCESS_TOKEN || '').length > 10;

export async function chamarMP(env, caminho, { metodo = 'GET', corpo, idempotencia } = {}) {
  if (!mpConfigurado(env)) throw new ErroMP('O pagamento ainda não foi configurado.');
  const buscar = env.MP_FETCH || fetch; // MP_FETCH só existe nos testes
  let r;
  try {
    r = await buscar(BASE + caminho, {
      method: metodo,
      headers: {
        authorization: 'Bearer ' + env.MP_ACCESS_TOKEN,
        'content-type': 'application/json',
        ...(idempotencia && { 'x-idempotency-key': idempotencia }),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (e) {
    console.error('Mercado Pago sem resposta', String(e?.message || e));
    throw new ErroMP('Não consegui falar com o Mercado Pago agora.');
  }
  if (!r.ok) {
    console.error('Mercado Pago', r.status, caminho, (await r.text()).slice(0, 500)); // aparece em Observability
    throw new ErroMP('O Mercado Pago recusou o pedido.');
  }
  return r.json();
}

const TITULOS = { mensal: 'Renova.AI · Plano mensal', anual: 'Renova.AI · Plano anual' };

// Preferência do Checkout Pro. No Pix, só o Pix aparece; no cartão, só cartão.
// Parcelas: só no anual. Os juros do parcelamento ficam com quem paga (padrão do Mercado Pago,
// desde que o "parcelamento sem juros" não esteja ligado na conta).
export function montarPreferencia({ registro, personal, origem, parcelasMax }) {
  const voltar = `${origem}/painel?assinatura=${registro.id}`;
  const pix = registro.metodo === 'pix';
  const expira = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  return {
    items: [
      {
        id: 'renova-' + registro.plano,
        title: TITULOS[registro.plano],
        description: registro.plano === 'anual' ? '12 meses de acesso ao painel' : '1 mês de acesso ao painel',
        category_id: 'services',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: registro.valor / 100,
      },
    ],
    payer: { email: personal.email, name: personal.nome },
    external_reference: String(registro.id),
    statement_descriptor: 'RENOVAAI',
    back_urls: { success: voltar, pending: voltar, failure: voltar },
    auto_return: 'approved',
    // O Mercado Pago só aceita avisos em endereço https (no computador, sem aviso; a volta ao app confere o pagamento).
    ...(origem.startsWith('https://') && { notification_url: `${origem}/api/assinatura/webhook` }),
    expires: true,
    expiration_date_to: expira,
    ...(pix && { date_of_expiration: expira }),
    payment_methods: pix
      ? {
          excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'prepaid_card' }, { id: 'ticket' }, { id: 'atm' }],
          installments: 1,
        }
      : {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }],
          installments: registro.plano === 'anual' ? parcelasMax : 1,
          default_installments: 1,
        },
    metadata: { personal_id: personal.id, plano: registro.plano, metodo: registro.metodo },
  };
}

// Pix direto pela API de pagamentos: o app recebe o código "copia e cola" e o QR Code e mostra na própria tela.
// Quem paga não sai do app e não precisa de conta no Mercado Pago.
export function montarPix({ registro, personal, origem }) {
  const expira = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
  const brasilia = new Date(expira.getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00');
  const [nome, ...resto] = String(personal.nome || '').trim().split(/\s+/);
  return {
    transaction_amount: registro.valor / 100,
    description: TITULOS[registro.plano],
    payment_method_id: 'pix',
    payer: { email: personal.email, first_name: nome || undefined, last_name: resto.join(' ') || undefined },
    external_reference: String(registro.id),
    date_of_expiration: brasilia,
    ...(origem.startsWith('https://') && { notification_url: `${origem}/api/assinatura/webhook` }),
    metadata: { personal_id: personal.id, plano: registro.plano, metodo: 'pix' },
  };
}

export function dadosDoPix(pag) {
  const t = pag?.point_of_interaction?.transaction_data || {};
  if (!t.qr_code) throw new ErroMP('O Mercado Pago não devolveu o código Pix. Confira se a conta tem uma chave Pix cadastrada.');
  return { copiaECola: t.qr_code, qrBase64: t.qr_code_base64 || null, expiraEm: pag.date_of_expiration || null };
}

// Endereço de pagamento. Token de teste (TEST-...) abre o ambiente de testes.
export const linkDoCheckout = (env, pref) =>
  String(env.MP_ACCESS_TOKEN).startsWith('TEST-') ? pref.sandbox_init_point || pref.init_point : pref.init_point;

// Confere a assinatura do aviso (x-signature), quando o segredo MP_WEBHOOK_SECRET existe.
// Mesmo sem ela, o app nunca confia no aviso: busca o pagamento direto no Mercado Pago.
export async function avisoAutentico(env, request, idDoAviso) {
  const segredo = String(env.MP_WEBHOOK_SECRET || '');
  if (!segredo) return true;
  const assinatura = request.headers.get('x-signature') || '';
  const pedido = request.headers.get('x-request-id') || '';
  const partes = Object.fromEntries(assinatura.split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(idDoAviso) ? String(idDoAviso).toLowerCase() : idDoAviso;
  const texto = `id:${id};request-id:${pedido};ts:${partes.ts};`;
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bits = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto));
  const esperado = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (esperado.length !== partes.v1.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return dif === 0;
}
