// Assinatura do personal: teste grátis, planos, preços e situação do acesso.
// Tudo aqui é cálculo puro, sem banco, para poder testar.

const DIA = 24 * 3600 * 1000;

// Valores em centavos. A administração pode mudar em /admin > Configuração.
export const CONFIG_PADRAO = {
  mensal: 2490,
  anual: 19900,
  diasTeste: 7,
  descontoPix: 5, // % de desconto no Pix
  parcelasMax: 12, // parcelas no cartão (só no plano anual); os juros ficam por conta de quem paga
};

export const PLANOS = ['mensal', 'anual'];
export const METODOS = ['pix', 'cartao'];
export const MESES_DO_PLANO = { mensal: 1, anual: 12 };

function inteiroEntre(valor, min, max, nome) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Confira o campo ${nome}.`);
  return n;
}

// Junta o que está salvo com o padrão, para nunca faltar um campo.
export function lerConfig(salvo) {
  let dados = {};
  try {
    dados = typeof salvo === 'string' ? JSON.parse(salvo) : salvo || {};
  } catch {
    dados = {};
  }
  const c = { ...CONFIG_PADRAO };
  for (const k of Object.keys(CONFIG_PADRAO)) if (Number.isInteger(dados[k])) c[k] = dados[k];
  return c;
}

export function validarConfig(d) {
  return {
    mensal: inteiroEntre(d.mensal, 100, 100000, 'preço mensal'),
    anual: inteiroEntre(d.anual, 100, 1000000, 'preço anual'),
    diasTeste: inteiroEntre(d.diasTeste, 0, 90, 'dias de teste'),
    descontoPix: inteiroEntre(d.descontoPix, 0, 50, 'desconto no Pix'),
    parcelasMax: inteiroEntre(d.parcelasMax, 1, 12, 'parcelas no cartão'),
  };
}

// Quanto cobrar por um plano e uma forma de pagamento.
export function valorCobrado(config, plano, metodo) {
  const base = config[plano];
  if (!base) throw new Error('Plano inválido.');
  return metodo === 'pix' ? Math.round((base * (100 - config.descontoPix)) / 100) : base;
}

// Tabela de preços mostrada no app.
export function tabelaPlanos(config) {
  const cheio = config.mensal * 12;
  return {
    descontoPix: config.descontoPix,
    parcelasMax: config.parcelasMax,
    mensal: { cartao: config.mensal, pix: valorCobrado(config, 'mensal', 'pix'), parcelas: 1 },
    anual: {
      cartao: config.anual,
      pix: valorCobrado(config, 'anual', 'pix'),
      parcelas: config.parcelasMax,
      porMes: Math.round(config.anual / 12),
      economia: Math.max(0, cheio - config.anual),
    },
  };
}

export const inicioDoTeste = (agora, config) => new Date(agora.getTime() + config.diasTeste * DIA).toISOString();

// Soma meses de calendário. 31/01 + 1 mês cai em 28/02 (ou 29/02).
export function somarMeses(iso, meses) {
  const d = new Date(iso);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString();
}

// Novo fim do acesso depois de um pagamento. Os dias que ainda restavam (do teste ou do plano) continuam valendo.
export function estenderAcesso(acessoAte, plano, agora = new Date()) {
  const atual = acessoAte ? new Date(acessoAte) : null;
  const base = atual && atual > agora ? atual : agora;
  return somarMeses(base.toISOString(), MESES_DO_PLANO[plano] || 1);
}

// teste | ativa | cortesia: liberado. teste_encerrado | vencida | bloqueada: painel travado.
export function situacaoDoAcesso(p, agora = new Date()) {
  if (p.bloqueado) return 'bloqueada';
  if (p.cortesia) return 'cortesia';
  const valeAte = p.acesso_ate ? new Date(p.acesso_ate) : null;
  const teste = !p.plano || p.plano === 'teste';
  if (valeAte && valeAte > agora) return teste ? 'teste' : 'ativa';
  return teste ? 'teste_encerrado' : 'vencida';
}

export const LIBERADO = ['teste', 'ativa', 'cortesia'];
export const temAcesso = (p, agora = new Date()) => LIBERADO.includes(situacaoDoAcesso(p, agora));

export function diasRestantes(acessoAte, agora = new Date()) {
  if (!acessoAte) return 0;
  return Math.max(0, Math.ceil((new Date(acessoAte).getTime() - agora.getTime()) / DIA));
}

export function assinaturaPublica(p, agora = new Date()) {
  const situacao = situacaoDoAcesso(p, agora);
  return {
    situacao,
    liberado: LIBERADO.includes(situacao),
    plano: p.plano || 'teste',
    acessoAte: p.acesso_ate || null,
    diasRestantes: situacao === 'cortesia' ? null : diasRestantes(p.acesso_ate, agora),
  };
}

// Status do Mercado Pago para o status do app.
export function statusDoMP(status) {
  if (status === 'approved') return 'aprovado';
  if (status === 'rejected') return 'recusado';
  if (status === 'cancelled') return 'cancelado';
  if (status === 'refunded' || status === 'charged_back') return 'reembolsado';
  return 'pendente'; // pending, in_process, authorized, in_mediation
}

// Mês (AAAA-MM) no horário de Brasília de uma data ISO.
export const mesBR = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 7);
