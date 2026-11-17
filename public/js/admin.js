// Área de administração (/admin): resumo, usuários, pagamentos e configuração da assinatura.
// Entrada com a chave de administração, guardada como segredo ADMIN_KEY na Cloudflare.
import { api, el, campo, copiar, montar, reais, paraCentavos } from './comum.js';

let entrou = null; // null: ainda verificando
let aba = 'resumo';
let erro = '';
let aviso = '';
let resumo = null;
let usuarios = null;
let pagamentos = null;
let config = null;
let aberto = null; // id do usuário aberto
let codigo = null; // { nome, email, codigo } recém-gerado
let busca = '';
let filtroUsuarios = 'todos';
let filtroPagamentos = 'todos';
let incluirNaoConcluidos = false;

const SITUACAO = {
  teste: ['neutro', 'Em teste'],
  ativa: ['lima', 'Ativa'],
  cortesia: ['lima', 'Cortesia'],
  teste_encerrado: ['forte', 'Teste encerrado'],
  vencida: ['forte', 'Vencida'],
  bloqueada: ['vazio', 'Suspensa'],
};
const STATUS = {
  aprovado: ['lima', 'Aprovado'],
  pendente: ['neutro', 'Pendente'],
  aguardando: ['vazio', 'Não concluído'],
  recusado: ['forte', 'Recusado'],
  cancelado: ['vazio', 'Cancelado'],
  reembolsado: ['forte', 'Devolvido'],
  divergente: ['forte', 'Conferir valor'],
};
const METODO = { pix: 'Pix', cartao: 'Cartão', manual: 'Manual' };
const PLANO = { mensal: 'Mensal', anual: 'Anual', teste: 'Teste' };

const chip = ([cor, texto]) => el('span', { class: 'chip ' + cor }, texto);
const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
const paraCampo = (centavos) => (centavos / 100).toFixed(2).replace('.', ',');
const dataCampo = (iso) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) : '');

function chaveForte() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => letras[b % letras.length]).join('');
}

function botaoCopiar(texto, rotulo) {
  const botao = el('button', {
    class: 'botao claro menor', type: 'button',
    onclick: async () => { botao.textContent = (await copiar(texto)) ? 'Copiado' : 'Selecione e copie o texto acima'; },
  }, rotulo);
  return botao;
}

async function carregarAba(nome = aba) {
  if (nome === 'resumo') resumo = await api('admin/resumo');
  if (nome === 'usuarios') usuarios = (await api('admin/usuarios')).usuarios;
  if (nome === 'pagamentos' || (nome === 'usuarios' && aberto)) pagamentos = (await api('admin/pagamentos' + (incluirNaoConcluidos ? '?todos=1' : ''))).pagamentos;
  if (nome === 'config') config = await api('admin/config');
}

// Executa uma ação, recarrega a aba e mostra erro ou aviso.
async function agir(funcao, mensagem = '') {
  erro = '';
  aviso = '';
  try {
    await funcao();
    await carregarAba();
    aviso = mensagem;
  } catch (e) {
    if (e.status === 401) entrou = false;
    erro = e.message;
  }
  desenhar();
}

async function trocarAba(nome) {
  aba = nome;
  aberto = null;
  codigo = null;
  erro = '';
  aviso = '';
  desenhar();
  await agir(async () => {});
}

// ---------- Entrar ----------

function telaEntrar() {
  const sugestao = el('div', { class: 'cartao', hidden: true });
  return [
    el('div', { class: 'coluna', style: 'margin-top: 4vh; max-width: 460px' },
      el('p', { class: 'pequeno', style: 'font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase' }, 'Renova.AI · Administração'),
      el('h1', {}, 'Entrar na administração'),
      el('p', { class: 'suave' }, 'Usuários, pagamentos e configuração dos planos.')
    ),
    el('form', {
      class: 'coluna', style: 'gap: 14px; max-width: 460px',
      onsubmit: async (e) => {
        e.preventDefault();
        erro = '';
        try {
          await api('admin/entrar', 'POST', { chave: e.target.chave.value });
          entrou = true;
          await carregarAba();
        } catch (falha) {
          erro = falha.message;
        }
        desenhar();
      },
    },
      campo('Chave de administração', { id: 'chave', name: 'chave', type: 'password', required: true, autocomplete: 'current-password' }),
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('button', { class: 'botao', type: 'submit' }, 'Entrar')
    ),
    el('button', {
      class: 'link', style: 'align-self: flex-start',
      onclick: () => {
        const nova = chaveForte();
        sugestao.hidden = false;
        sugestao.replaceChildren(
          el('h3', {}, 'Chave sugerida'),
          el('p', { class: 'pequeno suave' }, 'Use só na primeira configuração: cadastre na Cloudflare como segredo com o nome ADMIN_KEY e guarde uma cópia em lugar seguro.'),
          el('div', { class: 'pix-codigo' }, nova),
          botaoCopiar(nova, 'Copiar chave')
        );
      },
    }, 'Primeira vez? Criar uma chave forte'),
    sugestao,
  ];
}

// ---------- Resumo ----------

const numero = (rotulo, valor, aoTocar, dica) =>
  el(aoTocar ? 'button' : 'div', { class: 'numero', onclick: aoTocar, title: dica },
    el('span', { class: 'pequeno suave' }, rotulo), el('strong', {}, valor));

function irParaUsuarios(filtro) {
  filtroUsuarios = filtro;
  busca = '';
  trocarAba('usuarios');
}

function grafico(serie) {
  const maior = Math.max(1, ...serie.map((m) => m.valor));
  return el('div', { class: 'grafico', role: 'img', 'aria-label': 'Receita dos últimos 12 meses' },
    serie.map((m, i) =>
      el('div', { class: 'coluna-barra' + (i === serie.length - 1 ? ' atual' : ''), title: `${m.rotulo}: ${reais(m.valor)} (${m.quantidade} pagamentos)` },
        el('span', {}, m.valor ? reais(m.valor).replace(/,\d\d$/, '') : ''),
        el('div', { style: `height: ${Math.round((m.valor / maior) * 100)}%` }),
        el('span', {}, m.rotulo.slice(0, 3))
      )
    )
  );
}

function abaResumo() {
  if (!resumo) return el('p', { class: 'suave' }, 'Carregando…');
  const r = resumo;
  const u = r.usuarios;
  const dif = r.receita.mes - r.receita.mesAnterior;
  return [
    !r.configurado && el('p', { class: 'aviso' }, 'Mercado Pago ainda não configurado: os personais veem os planos, mas não conseguem pagar. Veja a aba Configuração.'),
    el('div', { class: 'cartao escuro' },
      el('p', { class: 'suave' }, 'Recebido neste mês'),
      el('p', { class: 'grande' }, reais(r.receita.mes)),
      el('p', { class: 'pequeno suave' }, `Mês passado: ${reais(r.receita.mesAnterior)}${r.receita.mesAnterior ? ` (${dif >= 0 ? '+' : '−'}${reais(Math.abs(dif))})` : ''}. Total desde o início: ${reais(r.receita.total)}.`),
      el('p', { class: 'pequeno suave' }, `Receita recorrente estimada: ${reais(r.mrr)}/mês (${r.assinantes.mensais} mensais e ${r.assinantes.anuais} anuais).`)
    ),
    el('div', { class: 'grade-numeros' },
      numero('Pix no mês', reais(r.receita.porMetodo.pix)),
      numero('Cartão no mês', reais(r.receita.porMetodo.cartao)),
      numero('Manual no mês', reais(r.receita.porMetodo.manual)),
      numero('Conversão do teste', r.conversao == null ? '—' : r.conversao + '%', null, 'Dos que terminaram o teste, quantos pagaram')
    ),
    el('div', { class: 'cartao' }, el('h3', {}, 'Receita dos últimos 12 meses'), grafico(r.receita.serie)),
    el('h2', {}, 'Usuários'),
    el('div', { class: 'grade-numeros' },
      numero('Total', String(u.total), () => irParaUsuarios('todos')),
      numero('Em teste', String(u.teste), () => irParaUsuarios('teste')),
      numero('Assinantes', String(u.ativa), () => irParaUsuarios('ativa')),
      numero('Cortesia', String(u.cortesia), () => irParaUsuarios('cortesia')),
      numero('Teste encerrado', String(u.testeEncerrado), () => irParaUsuarios('teste_encerrado')),
      numero('Plano vencido', String(u.vencida), () => irParaUsuarios('vencida')),
      numero('Suspensos', String(u.bloqueada), () => irParaUsuarios('bloqueada')),
      numero('Novos em 30 dias', String(u.novos30))
    ),
    (r.pendentes > 0 || r.divergentes > 0) && el('div', { class: 'cartao' },
      el('h3', {}, 'Pagamentos para olhar'),
      el('p', { class: 'suave' }, [r.pendentes && `${r.pendentes} pendente(s)`, r.divergentes && `${r.divergentes} com valor diferente do plano`].filter(Boolean).join(' e ') + '.'),
      el('button', { class: 'botao claro menor', onclick: () => { filtroPagamentos = r.divergentes ? 'divergente' : 'pendente'; trocarAba('pagamentos'); } }, 'Ver pagamentos')
    ),
    el('div', { class: 'cartao' },
      el('h3', {}, 'Vencem nos próximos 7 dias'),
      r.vencendo.length
        ? r.vencendo.map((v) => el('button', { class: 'linha entre link', style: 'text-decoration: none; width: 100%', onclick: () => abrirUsuario(v.id) },
            el('span', {}, `${v.nome} · ${PLANO[v.plano] || v.plano}`), el('span', { class: 'chip forte' }, v.diasRestantes === 1 ? '1 dia' : `${v.diasRestantes} dias`)))
        : el('p', { class: 'suave' }, 'Nenhum plano vence nesta semana.'),
      r.terminandoTeste > 0 && el('p', { class: 'pequeno suave' }, `${r.terminandoTeste} teste(s) grátis terminam em até 2 dias.`)
    ),
  ];
}

// ---------- Usuários ----------

async function abrirUsuario(id) {
  aba = 'usuarios';
  aberto = id;
  codigo = null;
  erro = '';
  aviso = '';
  desenhar();
  await agir(async () => {});
}

function usuariosFiltrados() {
  const termo = busca.trim().toLowerCase();
  return (usuarios || []).filter((u) =>
    (filtroUsuarios === 'todos' || u.situacao === filtroUsuarios) &&
    (!termo || u.nome.toLowerCase().includes(termo) || u.email.includes(termo) || u.slug.includes(termo))
  );
}

function abaUsuarios() {
  if (!usuarios) return el('p', { class: 'suave' }, 'Carregando…');
  if (aberto) return detalheUsuario();
  const lista = usuariosFiltrados();
  const entrada = el('input', {
    class: 'campo-busca', type: 'search', placeholder: 'Buscar por nome, e-mail ou link', value: busca, 'aria-label': 'Buscar usuário',
    oninput: (e) => { busca = e.target.value; desenharMantendoFoco(e.target); },
  });
  return [
    entrada,
    el('div', { class: 'filtros' },
      [['todos', 'Todos'], ...Object.entries(SITUACAO).map(([k, [, t]]) => [k, t])].map(([id, rotulo]) =>
        el('button', { class: 'filtro', 'aria-pressed': String(filtroUsuarios === id), onclick: () => { filtroUsuarios = id; desenhar(); } },
          rotulo + (id === 'todos' ? ` (${usuarios.length})` : ` (${usuarios.filter((u) => u.situacao === id).length})`)))
    ),
    lista.length
      ? el('div', { class: 'tabela-rolagem' },
          el('table', { class: 'tabela' },
            el('thead', {}, el('tr', {}, ['Personal', 'Situação', 'Acesso até', 'Alunos', 'Total pago', 'Criado em'].map((t, i) => el('th', { class: i >= 3 && i <= 4 ? 'num' : null }, t)))),
            el('tbody', {}, lista.map((u) =>
              el('tr', { class: 'clicavel', tabindex: '0', onclick: () => abrirUsuario(u.id), onkeydown: (e) => { if (e.key === 'Enter') abrirUsuario(u.id); } },
                el('td', {}, el('strong', {}, u.nome), el('br'), el('span', { class: 'pequeno suave' }, u.email)),
                el('td', {}, chip(SITUACAO[u.situacao]), u.plano !== 'teste' && u.situacao !== 'cortesia' ? el('span', { class: 'pequeno suave' }, ' ' + (PLANO[u.plano] || '')) : null),
                el('td', {}, u.situacao === 'cortesia' ? 'Sem prazo' : dataBR(u.acessoAte)),
                el('td', { class: 'num' }, String(u.alunos)),
                el('td', { class: 'num' }, reais(u.totalPago)),
                el('td', {}, dataBR(u.criadoEm))
              )
            ))
          )
        )
      : el('p', { class: 'suave' }, 'Nenhum usuário encontrado.'),
  ];
}

function desenharMantendoFoco(entrada) {
  const posicao = entrada.selectionStart;
  desenhar();
  const nova = document.querySelector('.campo-busca');
  if (nova) {
    nova.focus();
    nova.setSelectionRange(posicao, posicao);
  }
}

function telaCodigo() {
  const mensagem =
    `Oi, ${codigo.nome.split(' ')[0]}! Seu novo código de recuperação do Renova AI é ${codigo.codigo}. ` +
    `Abra ${location.origin}/painel, toque em "Esqueci minha senha" e use esse código para criar uma senha nova.`;
  return el('div', { class: 'cartao' },
    el('h3', {}, 'Código de recuperação gerado'),
    el('p', { class: 'pequeno suave' }, 'O código anterior deixou de valer. Envie somente para o e-mail cadastrado: quem tiver este código consegue entrar e trocar a chave Pix.'),
    el('div', { class: 'cartao escuro centro' },
      el('p', { style: "font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 24px; letter-spacing: 0.06em" }, codigo.codigo)
    ),
    el('div', { class: 'acoes' },
      botaoCopiar(codigo.codigo, 'Copiar só o código'),
      botaoCopiar(mensagem, 'Copiar mensagem pronta'),
      el('a', { class: 'botao menor', href: `mailto:${codigo.email}?subject=${encodeURIComponent('Seu acesso ao Renova.AI')}&body=${encodeURIComponent(mensagem)}` }, 'Abrir e-mail')
    )
  );
}

function detalheUsuario() {
  const u = usuarios.find((x) => x.id === aberto);
  if (!u) return el('p', { class: 'suave' }, 'Usuário não encontrado.');
  const acao = (dados, mensagem) => agir(() => api(`admin/usuarios/${u.id}`, 'PUT', dados), mensagem);
  const seus = (pagamentos || []).filter((g) => g.personal?.id === u.id);
  const plano = el('select', { id: 'plano-manual', name: 'plano' }, el('option', { value: 'mensal' }, 'Mensal'), el('option', { value: 'anual' }, 'Anual'));
  const valorManual = el('input', { id: 'valor-manual', name: 'valor', inputmode: 'decimal', value: config ? paraCampo(config.config.mensal) : '24,90' });
  plano.addEventListener('change', () => {
    if (config) valorManual.value = paraCampo(config.config[plano.value]);
  });
  if (!config) api('admin/config').then((c) => { config = c; valorManual.value = paraCampo(c.config[plano.value]); }).catch(() => {});

  return [
    el('button', { class: 'link', style: 'align-self: flex-start', onclick: () => { aberto = null; codigo = null; erro = ''; aviso = ''; desenhar(); } }, '← Todos os usuários'),
    el('div', { class: 'admin-topo' },
      el('div', {}, el('h2', {}, u.nome), el('p', { class: 'suave' }, `${u.email} · ${location.host}/c/${u.slug}`)),
      chip(SITUACAO[u.situacao])
    ),
    el('div', { class: 'grade-numeros' },
      numero('Plano', u.situacao === 'cortesia' ? 'Cortesia' : PLANO[u.plano] || u.plano),
      numero('Acesso até', u.situacao === 'cortesia' ? 'Sem prazo' : dataBR(u.acessoAte)),
      numero('Dias restantes', u.situacao === 'cortesia' ? '—' : String(u.diasRestantes)),
      numero('Alunos', String(u.alunos)),
      numero('Total pago', reais(u.totalPago)),
      numero('Conta criada', dataBR(u.criadoEm))
    ),
    codigo && telaCodigo(),
    el('div', { class: 'cartao' },
      el('h3', {}, 'Acesso'),
      el('div', { class: 'acoes' },
        el('button', { class: 'botao claro menor', onclick: () => acao({ acao: 'dias', dias: 7 }, '7 dias acrescentados.') }, '+7 dias'),
        el('button', { class: 'botao claro menor', onclick: () => acao({ acao: 'dias', dias: 30 }, '30 dias acrescentados.') }, '+30 dias'),
        el('button', { class: 'botao claro menor', onclick: () => acao({ acao: 'cortesia', ativa: !u.cortesia }, u.cortesia ? 'Cortesia removida.' : 'Acesso liberado sem prazo.') }, u.cortesia ? 'Tirar cortesia' : 'Liberar como cortesia'),
        el('button', { class: 'botao claro menor', onclick: () => acao({ acao: 'bloquear', ativo: !u.bloqueado }, u.bloqueado ? 'Conta reativada.' : 'Conta suspensa.') }, u.bloqueado ? 'Reativar conta' : 'Suspender conta')
      ),
      el('form', {
        class: 'linha', style: 'align-items: flex-end; flex-wrap: wrap',
        onsubmit: (e) => { e.preventDefault(); acao({ acao: 'ate', data: e.target.data.value }, 'Data final atualizada.'); },
      },
        el('div', { class: 'cresce' }, campo('Acesso até (data final)', { id: 'data-final', name: 'data', type: 'date', required: true, value: dataCampo(u.acessoAte) })),
        el('button', { class: 'botao menor', type: 'submit', style: 'width: auto; padding: 0 20px' }, 'Salvar data')
      ),
      el('p', { class: 'pequeno suave' }, 'Cortesia libera o painel sem prazo e sem pagamento. Suspender trava o painel; os links dos alunos continuam funcionando.')
    ),
    el('form', {
      class: 'cartao',
      onsubmit: (e) => {
        e.preventDefault();
        const valor = paraCentavos(valorManual.value);
        agir(() => api(`admin/usuarios/${u.id}/pagamento`, 'POST', { plano: plano.value, valor, observacao: e.target.observacao.value }), 'Pagamento registrado e acesso liberado.');
      },
    },
      el('h3', {}, 'Registrar pagamento recebido por fora'),
      el('p', { class: 'pequeno suave' }, 'Para quem pagou direto (Pix na sua conta, dinheiro). Soma o período do plano ao acesso.'),
      el('div', { class: 'dupla' },
        el('div', { class: 'campo' }, el('label', { for: 'plano-manual' }, 'Plano'), plano),
        el('div', { class: 'campo' }, el('label', { for: 'valor-manual' }, 'Valor recebido (R$)'), valorManual)
      ),
      campo('Observação', { id: 'observacao', name: 'observacao', maxlength: '200', placeholder: 'Ex.: Pix recebido em 17/11' }),
      el('button', { class: 'botao menor', type: 'submit' }, 'Registrar pagamento')
    ),
    el('div', { class: 'cartao' },
      el('h3', {}, 'Senha'),
      el('p', { class: 'pequeno suave' }, 'Antes, confirme que o pedido veio do e-mail cadastrado.'),
      el('button', {
        class: 'botao claro menor',
        onclick: () => agir(async () => { codigo = await api('admin/codigo', 'POST', { email: u.email }); }),
      }, 'Gerar código de recuperação')
    ),
    el('h3', {}, 'Pagamentos deste usuário'),
    seus.length ? tabelaPagamentos(seus, false) : el('p', { class: 'suave' }, 'Nenhum pagamento ainda.'),
  ];
}

// ---------- Pagamentos ----------

function tabelaPagamentos(lista, comUsuario = true) {
  return el('div', { class: 'tabela-rolagem' },
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, [
        'Data', comUsuario && 'Personal', 'Plano', 'Forma', 'Valor', 'Pago pelo cliente', 'Status', '',
      ].filter((t) => t !== false).map((t) => el('th', { class: ['Valor', 'Pago pelo cliente'].includes(t) ? 'num' : null }, t)))),
      el('tbody', {}, lista.map((g) =>
        el('tr', {},
          el('td', {}, dataHoraBR(g.aprovadoEm || g.criadoEm)),
          comUsuario && el('td', {}, el('button', { class: 'link', style: 'min-height: 0; text-align: left', onclick: () => abrirUsuario(g.personal.id) }, g.personal.nome), el('br'), el('span', { class: 'pequeno suave' }, g.personal.email)),
          el('td', {}, PLANO[g.plano] || g.plano),
          el('td', {}, METODO[g.metodo] || g.metodo, g.parcelas > 1 ? el('span', { class: 'pequeno suave' }, ` ${g.parcelas}x`) : null),
          el('td', { class: 'num' }, reais(g.valor)),
          el('td', { class: 'num' }, g.valorPago ? reais(g.valorPago) : '—'),
          el('td', {}, chip(STATUS[g.status] || ['neutro', g.status]), g.observacao ? el('p', { class: 'pequeno suave' }, g.observacao) : null),
          el('td', {}, ['pendente', 'aguardando', 'divergente'].includes(g.status) && g.metodo !== 'manual'
            ? el('button', { class: 'link', style: 'min-height: 0', onclick: () => agir(() => api(`admin/pagamentos/${g.id}/verificar`, 'POST', {}), 'Pagamento conferido no Mercado Pago.') }, 'Conferir')
            : null)
        )
      ))
    )
  );
}

function abaPagamentos() {
  if (!pagamentos) return el('p', { class: 'suave' }, 'Carregando…');
  const lista = pagamentos.filter((g) => filtroPagamentos === 'todos' || g.status === filtroPagamentos);
  const aprovados = lista.filter((g) => g.status === 'aprovado');
  const contar = (s) => pagamentos.filter((g) => g.status === s).length;
  const opcoes = [['todos', 'Todos'], ...Object.entries(STATUS).filter(([k]) => k !== 'aguardando' || incluirNaoConcluidos).map(([k, [, t]]) => [k, t])];
  return [
    el('div', { class: 'filtros' },
      opcoes.map(([id, rotulo]) => el('button', { class: 'filtro', 'aria-pressed': String(filtroPagamentos === id), onclick: () => { filtroPagamentos = id; desenhar(); } },
        rotulo + ` (${id === 'todos' ? pagamentos.length : contar(id)})`))
    ),
    el('label', { class: 'marca' },
      el('input', { type: 'checkbox', checked: incluirNaoConcluidos, onchange: (e) => { incluirNaoConcluidos = e.target.checked; if (!incluirNaoConcluidos && filtroPagamentos === 'aguardando') filtroPagamentos = 'todos'; agir(async () => {}); } }),
      el('span', {}, 'Mostrar checkouts abertos e não concluídos')
    ),
    aprovados.length > 0 && el('p', { class: 'pequeno suave' }, `${aprovados.length} aprovado(s) nesta lista, somando ${reais(aprovados.reduce((t, g) => t + g.valor, 0))}. "Pago pelo cliente" inclui os juros do parcelamento, que ficam com o Mercado Pago.`),
    lista.length ? tabelaPagamentos(lista) : el('p', { class: 'suave' }, 'Nenhum pagamento por aqui.'),
  ];
}

// ---------- Configuração ----------

function abaConfig() {
  if (!config) return el('p', { class: 'suave' }, 'Carregando…');
  const c = config.config;
  const t = config.planos;
  return [
    el('form', {
      class: 'cartao',
      onsubmit: (e) => {
        e.preventDefault();
        const f = e.target;
        agir(async () => {
          config = await api('admin/config', 'PUT', {
            mensal: paraCentavos(f.mensal.value),
            anual: paraCentavos(f.anual.value),
            diasTeste: Number(f.diasTeste.value),
            descontoPix: Number(f.descontoPix.value),
            parcelasMax: Number(f.parcelasMax.value),
          });
        }, 'Configuração salva. Vale para os próximos pagamentos e para as contas criadas a partir de agora.');
      },
    },
      el('h3', {}, 'Planos e preços'),
      el('div', { class: 'dupla' },
        campo('Plano mensal (R$)', { id: 'mensal', name: 'mensal', inputmode: 'decimal', required: true, value: paraCampo(c.mensal) }),
        campo('Plano anual (R$)', { id: 'anual', name: 'anual', inputmode: 'decimal', required: true, value: paraCampo(c.anual) })
      ),
      el('div', { class: 'dupla' },
        campo('Dias de teste grátis', { id: 'diasTeste', name: 'diasTeste', type: 'number', min: '0', max: '90', required: true, value: String(c.diasTeste) }),
        campo('Desconto no Pix (%)', { id: 'descontoPix', name: 'descontoPix', type: 'number', min: '0', max: '50', required: true, value: String(c.descontoPix) })
      ),
      campo('Parcelas no cartão (plano anual)', { id: 'parcelasMax', name: 'parcelasMax', type: 'number', min: '1', max: '12', required: true, value: String(c.parcelasMax) }, 'input',
        'Os juros do parcelamento ficam por conta de quem paga. Mantenha o "parcelamento sem juros" desligado na conta do Mercado Pago.'),
      el('p', { class: 'pequeno suave' },
        `Hoje o personal vê: mensal ${reais(t.mensal.cartao)} (Pix ${reais(t.mensal.pix)}) e anual ${reais(t.anual.cartao)} (Pix ${reais(t.anual.pix)}, até ${t.anual.parcelas}x no cartão).`),
      el('button', { class: 'botao menor', type: 'submit' }, 'Salvar configuração')
    ),
    el('div', { class: 'cartao' },
      el('h3', {}, 'Integração com o Mercado Pago'),
      el('p', {}, config.configurado ? '✓ Token de acesso configurado.' : '✗ Falta o token de acesso.'),
      el('p', {}, config.avisoProtegido ? '✓ Avisos de pagamento com assinatura conferida.' : '○ Assinatura dos avisos não configurada (opcional).'),
      el('p', { class: 'pequeno suave' },
        'Na Cloudflare, em Settings > Variables and Secrets, cadastre como Secret: MP_ACCESS_TOKEN (Access Token de produção do Mercado Pago) e, opcionalmente, MP_WEBHOOK_SECRET (assinatura secreta dos webhooks). ' +
        `O endereço dos avisos é ${location.origin}/api/assinatura/webhook, evento "Pagamentos".`)
    ),
  ];
}

// ---------- Montagem ----------

function desenhar() {
  document.body.classList.add('admin');
  if (entrou === null) return montar(el('p', { class: 'suave' }, 'Carregando…'));
  if (!entrou) return montar(telaEntrar());
  const abas = [['resumo', 'Resumo'], ['usuarios', 'Usuários'], ['pagamentos', 'Pagamentos'], ['config', 'Configuração']];
  const conteudo = { resumo: abaResumo, usuarios: abaUsuarios, pagamentos: abaPagamentos, config: abaConfig }[aba];
  montar(
    el('header', { class: 'admin-topo' },
      el('div', { class: 'cabeca' },
        el('img', { class: 'cabeca-icone', src: '/icones/icone-192.png', alt: '' }),
        el('div', {}, el('p', { class: 'logo-texto' }, 'Renova', el('span', {}, '.AI')), el('h1', {}, 'Administração'))
      ),
      el('button', { class: 'link', onclick: async () => { await api('admin/sair', 'POST', {}).catch(() => {}); entrou = false; erro = ''; desenhar(); } }, 'Sair')
    ),
    el('nav', { class: 'abas', 'aria-label': 'Seções da administração' },
      abas.map(([id, rotulo]) => el('button', { class: 'aba', 'aria-pressed': String(aba === id), onclick: () => trocarAba(id) }, rotulo))
    ),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    aviso && el('p', { class: 'aviso', role: 'status' }, aviso),
    conteudo()
  );
}

desenhar();
try {
  await carregarAba();
  entrou = true;
} catch (e) {
  entrou = false;
  if (e.status !== 401) erro = e.message;
}
desenhar();
