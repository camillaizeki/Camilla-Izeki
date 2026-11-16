// Painel do personal: renovações, novos alunos, arte e conta.
import { api, el, icone, campo, meses, reais, paraCentavos, copiar, montar, formatarWhats, mascararWhats } from './comum.js';
import { iniciarInstalacao, avisoInstalar, secaoInstalar } from './instalar.js';

let dados = null; // { personal, hoje, mesAtual, resumo, financeiro, alunos, frases }
let aba = 'inicio';
let mesVisto = null; // mês mostrado no dashboard (posição em dados.financeiro.meses)
let filtro = 'todos';
let busca = '';
let desfazer = null; // último pagamento marcado, para poder desfazer
let erro = '';
let modoConta = 'entrar';
let sugestoes = [];
let codigoNovo = ''; // código de recuperação recém-gerado, mostrado uma vez
let folha = null; // janela aberta por cima: fila de lembretes, aluno, pagamento, cadastro ou pausas

const P = () => dados.personal.nome;
const linkAluno = (a) => `${location.origin}/a/${a.token}`;
const linkConvite = () => `${location.origin}/c/${dados.personal.slug}`;
const primeiro = (nome) => nome.trim().split(/\s+/)[0];

async function carregar() {
  try {
    dados = await api('painel');
  } catch (e) {
    if (e.status === 401) dados = null;
    else throw e;
  }
}

async function agir(funcao) {
  erro = '';
  try {
    await funcao();
    await carregar();
  } catch (e) {
    erro = e.message;
  }
  desenhar();
}

// ---------- Entrar / criar conta ----------

function telaConta() {
  const criando = modoConta === 'criar';
  const esqueci = modoConta === 'esqueci';
  const enviar = async (evento) => {
    evento.preventDefault();
    const f = evento.target;
    erro = '';
    try {
      if (criando) {
        const r = await api('conta/criar', 'POST', { nome: f.nome.value, email: f.email.value, senha: f.senha.value, slug: f.slug.value });
        codigoNovo = r.codigo;
        aba = 'conta';
      } else if (esqueci) {
        const r = await api('conta/redefinir', 'POST', { email: f.email.value, codigo: f.codigo.value, senha: f.senha.value });
        codigoNovo = r.codigo;
      } else {
        await api('conta/entrar', 'POST', { email: f.email.value, senha: f.senha.value });
      }
      modoConta = 'entrar';
      await carregar();
    } catch (e) {
      erro = e.message;
    }
    desenhar();
  };
  const mudar = (modo) => () => {
    modoConta = modo;
    erro = '';
    desenhar();
  };

  const slug = el('input', { id: 'slug', name: 'slug', type: 'text', required: true, autocapitalize: 'none', placeholder: 'rafa' });
  const nome = el('input', {
    id: 'nome', name: 'nome', type: 'text', required: true, autocomplete: 'name',
    oninput: (e) => {
      if (slug.dataset.editado) return;
      slug.value = primeiro(e.target.value).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
    },
  });
  slug.addEventListener('input', () => (slug.dataset.editado = '1'));

  const titulo = criando ? 'Criar conta de personal' : esqueci ? 'Criar uma senha nova' : 'Entrar no painel';
  const rotuloSenha = criando ? 'Crie uma senha (8 caracteres ou mais)' : esqueci ? 'Senha nova (8 caracteres ou mais)' : 'Senha';

  return [
    el('div', { class: 'coluna', style: 'margin-top: 6vh' },
      el('div', { class: 'cabeca' }, el('img', { class: 'cabeca-icone', src: '/icones/icone-192.png', alt: '' }), el('p', { class: 'logo-texto', style: 'font-size: 18px' }, 'Renova', el('span', {}, '.AI'))),
      el('h1', {}, titulo),
      esqueci && el('p', { class: 'suave' }, 'Use o código de recuperação que você guardou ao criar a conta.')
    ),
    el('form', { class: 'coluna', style: 'gap: 14px', onsubmit: enviar },
      criando && el('div', { class: 'campo' }, el('label', { for: 'nome' }, 'Seu nome'), nome),
      campo('E-mail', { id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'email' }),
      esqueci && campo('Código de recuperação', { id: 'codigo', name: 'codigo', type: 'text', required: true, autocapitalize: 'characters', autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX' }),
      campo(rotuloSenha, {
        id: 'senha', name: 'senha', type: 'password', required: true, minlength: '8',
        autocomplete: criando || esqueci ? 'new-password' : 'current-password',
      }),
      criando && el('div', { class: 'campo' },
        el('label', { for: 'slug' }, 'Seu link de convite'),
        slug,
        el('p', { class: 'pequeno suave' }, `Seus alunos vão acessar ${location.host}/c/seu-link`)
      ),
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('button', { class: 'botao', type: 'submit' }, criando ? 'Criar conta' : esqueci ? 'Salvar senha nova' : 'Entrar')
    ),
    esqueci && el('p', { class: 'pequeno suave' }, 'Não tem mais o código? ', el('a', { href: '/privacidade' }, 'Fale com a gente'), ' para recuperar o acesso.'),
    !criando && !esqueci && el('button', { class: 'link', onclick: mudar('esqueci') }, 'Esqueci minha senha'),
    el('button', { class: 'link', onclick: mudar(criando || esqueci ? 'entrar' : 'criar') }, criando ? 'Já tenho conta' : esqueci ? 'Voltar para entrar' : 'Sou novo por aqui: criar conta'),
  ];
}

// Mostra o código de recuperação uma única vez, logo depois de ser gerado.
function telaCodigo() {
  const copiarBotao = el('button', {
    class: 'botao claro',
    onclick: async () => {
      copiarBotao.textContent = (await copiar(codigoNovo)) ? 'Código copiado' : 'Anote o código acima';
    },
  }, 'Copiar código');
  return [
    el('div', { class: 'coluna', style: 'margin-top: 6vh' },
      el('h1', {}, 'Guarde seu código de recuperação'),
      el('p', { class: 'suave' }, 'Se você esquecer a senha, é com este código que cria uma nova. Ele aparece só agora: anote ou salve em um lugar seguro.')
    ),
    el('div', { class: 'cartao escuro centro' },
      el('p', { style: "font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 26px; letter-spacing: 0.06em" }, codigoNovo)
    ),
    copiarBotao,
    el('button', {
      class: 'botao fim',
      onclick: () => {
        codigoNovo = '';
        desenhar();
      },
    }, 'Já guardei, continuar'),
  ];
}

// ---------- Início: dashboard financeiro ----------

const variacao = (agora, antes) => {
  const dif = agora - antes;
  const sinal = dif > 0 ? '+' : dif < 0 ? '−' : '';
  const pct = antes > 0 ? ` (${sinal}${Math.abs(Math.round((dif / antes) * 100))}%)` : '';
  return `${sinal}${reais(Math.abs(dif))}${pct}`;
};

function irParaAlunos(novoFiltro) {
  filtro = novoFiltro;
  busca = '';
  trocarAba('alunos');
}

function abaInicio() {
  const f = dados.financeiro;
  const ultimo = f.meses.length - 1;
  if (mesVisto == null || mesVisto > ultimo) mesVisto = f.atual;
  const m = f.meses[mesVisto];
  const anterior = f.meses[mesVisto - 1];
  const ehAtual = mesVisto === f.atual;
  const nomeMes = m.rotulo.split(' ')[0];
  const pct = m.previsto ? Math.min(100, Math.round((m.recebidoDoMes / m.previsto) * 100)) : 0;
  const ativos = dados.alunos.filter((a) => a.status !== 'novo');
  const fila = ativos.filter(precisaLembrar);
  const vencemHoje = ativos.filter((a) => a.filtro === 'pendente' && a.dias === 0).length;
  const avisaram = ativos.filter((a) => a.abertas.some((x) => x.informado)).length;
  const mudarMes = (passo) => () => {
    mesVisto += passo;
    desenhar();
  };
  const bloco = (rotulo, valor, aoTocar) =>
    el(aoTocar ? 'button' : 'div', { class: 'numero', onclick: aoTocar }, el('span', { class: 'pequeno suave' }, rotulo), el('strong', {}, valor));

  let comparacao = null;
  if (anterior && !m.futuro) {
    const nomeAnterior = anterior.rotulo.split(' ')[0];
    comparacao = ehAtual
      ? `${maiuscula(nomeAnterior)} fechou em ${reais(anterior.recebido)}.`
      : m.recebido === anterior.recebido
        ? `Mesmo valor de ${nomeAnterior}.`
        : `${variacao(m.recebido, anterior.recebido)} em relação a ${nomeAnterior}.`;
  }

  return [
    !dados.personal.pixChave && el('p', { class: 'aviso' }, 'Cadastre sua chave Pix na aba Conta para os alunos conseguirem pagar pelo link.'),
    ehAtual && (f.alunos.inadimplentes > 0 || vencemHoje > 0 || avisaram > 0) && el('div', { class: 'cartao' },
      el('h3', {}, 'Verificar hoje'),
      el('p', { class: 'suave' }, [
        f.alunos.inadimplentes ? `${f.alunos.inadimplentes} ${f.alunos.inadimplentes === 1 ? 'aluno com mensalidade vencida' : 'alunos com mensalidade vencida'}` : null,
        vencemHoje ? `${vencemHoje} ${vencemHoje === 1 ? 'vence hoje' : 'vencem hoje'}` : null,
        avisaram ? `${avisaram} ${avisaram === 1 ? 'aluno avisou que pagou' : 'alunos avisaram que pagaram'}` : null,
      ].filter(Boolean).join(', ') + '. Confira se o pagamento entrou.'),
      el('div', { class: 'dupla' },
        el('button', { class: 'botao menor', onclick: () => irParaAlunos(f.alunos.inadimplentes && !avisaram ? 'atrasado' : avisaram ? 'todos' : 'pendente') }, 'Conferir'),
        el('button', { class: 'botao claro menor', disabled: !fila.length, onclick: () => abrirFila(fila) }, fila.length ? `Lembrar (${fila.length})` : 'Lembretes em dia')
      )
    ),
    el('div', { class: 'linha entre mes-nav' },
      el('button', { class: 'icone-botao', 'aria-label': 'Mês anterior', disabled: mesVisto === 0, onclick: mudarMes(-1) }, '‹'),
      el('h2', { 'aria-live': 'polite' }, maiuscula(m.rotulo)),
      el('button', { class: 'icone-botao', 'aria-label': 'Próximo mês', disabled: mesVisto === ultimo, onclick: mudarMes(1) }, '›')
    ),
    m.futuro
      ? el('div', { class: 'cartao escuro' },
          el('p', { class: 'suave' }, `Previsto para ${nomeMes}`),
          el('p', { class: 'grande' }, reais(m.previsto)),
          el('p', { class: 'pequeno suave' }, m.pagas
            ? `${reais(m.recebidoDoMes)} já recebidos adiantado, de ${m.pagas} ${m.pagas === 1 ? 'aluno' : 'alunos'}.`
            : 'Nenhum pagamento adiantado para este mês.'),
          el('p', { class: 'pequeno suave' }, 'Estimativa pelos alunos ativos de hoje.')
        )
      : el('div', { class: 'cartao escuro' },
          el('p', { class: 'suave' }, `Recebido em ${nomeMes}`),
          el('p', { class: 'grande' }, reais(m.recebido)),
          m.deOutrosMeses > 0 && el('p', { class: 'pequeno suave' }, 'Inclui ' + [
            m.deAnteriores ? `${reais(m.deAnteriores)} de meses anteriores` : null,
            m.adiantado ? `${reais(m.adiantado)} pagos adiantado` : null,
          ].filter(Boolean).join(' e ') + '.'),
          comparacao && el('p', { class: 'pequeno suave' }, comparacao)
        ),
    el('div', { class: 'cartao' },
      el('div', { class: 'linha entre' }, el('h3', {}, `Mensalidades de ${nomeMes}`), el('strong', {}, m.total ? `${pct}%` : '')),
      m.total
        ? [
            el('div', { class: 'barra', role: 'img', 'aria-label': `${pct}% do previsto já recebido` }, el('div', { style: `width: ${pct}%` })),
            el('p', { class: 'pequeno suave' }, `${m.pagas} de ${m.total} pagas · ${reais(m.recebidoDoMes)} de ${reais(m.previsto)} previstos`),
          ]
        : el('p', { class: 'suave' }, 'Nenhuma mensalidade neste mês.')
    ),
    ehAtual && el('div', { class: 'dupla' },
      bloco('A vencer', reais(f.aVencer), () => irParaAlunos('pendente')),
      bloco('Em atraso', reais(f.emAtraso), () => irParaAlunos('atrasado'))
    ),
    ehAtual && el('div', { class: 'resumo' },
      bloco('Ativos', String(f.alunos.ativos), () => irParaAlunos('todos')),
      bloco('Pausados', String(f.alunos.pausados), () => irParaAlunos('pausado')),
      bloco('Inadimplentes', String(f.alunos.inadimplentes), () => irParaAlunos('atrasado'))
    ),
    ehAtual && f.alunos.inativos > 0 && el('p', { class: 'pequeno suave centro' }, `${f.alunos.inativos} ${f.alunos.inativos === 1 ? 'aluno inativo' : 'alunos inativos'}.`),
    ehAtual && !ativos.length && el('div', { class: 'cartao' },
      el('h3', {}, 'Comece cadastrando seus alunos'),
      el('p', { class: 'suave' }, 'Os números aparecem aqui assim que houver mensalidades.'),
      el('button', { class: 'botao menor', onclick: () => irParaAlunos('todos') }, 'Ir para Alunos')
    ),
    !ehAtual && el('button', { class: 'link', onclick: () => { mesVisto = f.atual; desenhar(); } }, 'Voltar para o mês atual'),
  ];
}

// ---------- Alunos e controle mensal ----------

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const paraCampoValor = (centavos) => (centavos ? (centavos / 100).toFixed(2).replace('.', ',') : '');
const whatsLocal = formatarWhats; // (62) 900000000

const FILTROS = [['todos', 'Todos'], ['pago', 'Pagos'], ['pendente', 'Pendentes'], ['atrasado', 'Atrasados'], ['pausado', 'Pausados']];
const ORDEM = ['atrasado', 'pendente', 'pago', 'em_dia', 'pausado', 'inativo'];
const CHIP_MENSALIDADE = { pago: ['lima', 'Pago'], pendente: ['neutro', 'Pendente'], atrasado: ['forte', 'Atrasado'], pausado: ['vazio', 'Em pausa'], dispensado: ['vazio', 'Dispensada'], anterior: ['vazio', 'Anterior'] };

function chipDoAluno(a) {
  if (a.filtro === 'inativo') return ['vazio', 'Inativo'];
  if (a.filtro === 'pausado') return ['vazio', 'Pausado'];
  if (a.filtro === 'pago') return ['lima', 'Pago'];
  if (a.filtro === 'em_dia') return ['vazio', 'Em dia'];
  if (a.filtro === 'atrasado') {
    const n = a.abertas.filter((m) => m.situacao === 'atrasado').length;
    return ['forte', n > 1 ? `Atrasado · ${n} meses` : 'Atrasado'];
  }
  if (a.abertas[0]?.informado) return ['neutro', 'Disse que pagou'];
  if (a.dias === 0) return ['neutro', 'Vence hoje'];
  if (a.dias === 1) return ['neutro', 'Vence amanhã'];
  if (a.dias > 1 && a.dias <= 5) return ['neutro', `Vence em ${a.dias} dias`];
  return ['neutro', 'Pendente'];
}

const precisaLembrar = (a) => ['renova_hoje', 'renova_em', 'aguardando'].includes(a.situacao) && !a.lembradoHoje;

// A mensagem ao aluno continua leve: fala da jornada, nunca de atraso.
function textoLembrete(a) {
  const nome = primeiro(a.nome);
  // Nas mensagens de WhatsApp o nome vai sem ponto: "Renova.AI" vira link clicável para um site que não é o app.
  const assinatura = `\n\nMensagem automática do Renova AI para alunos de ${P()}`;
  if (a.emPausa || a.status === 'inativo') {
    return `Oi, ${nome}! Sua jornada de ${meses(a.meses)} com ${P()} está guardada. Quando quiser voltar, é só reativar por aqui: ${linkAluno(a)}${assinatura}`;
  }
  const marco = a.proximoMarco ? ` e ganhe o selo ${a.proximoMarco}` : '';
  const jornada = a.meses > 0 ? `Você já tem ${meses(a.meses)} de treino com ${P()}.` : `Sua jornada com ${P()} está começando.`;
  return `Oi, ${nome}! ${jornada} Veja seu cartão e desbloqueie ${a.nomeAlvo}${marco}: ${linkAluno(a)}${assinatura}`;
}

// Um toque marca como pago hoje, pelo valor previsto. Dá para desfazer logo em seguida.
function marcarPago(a, m) {
  return agirNaFolha(async () => {
    await api(`alunos/${a.id}/mensalidades/${m.mes}`, 'POST', { acao: 'pagar' });
    const mes = m.rotulo.split(' ')[0];
    const aviso = `Oi, ${primeiro(a.nome)}! ${maiuscula(mes)} está desbloqueado na sua trilha com ${P()}. Veja seu selo e compartilhe a conquista: ${linkAluno(a)}`;
    desfazer = {
      id: a.id,
      mes: m.mes,
      texto: `${maiuscula(mes)} de ${primeiro(a.nome)} marcado como pago.`,
      avisar: `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(aviso)}`,
    };
  });
}

function cartaoAluno(a) {
  const [classe, rotulo] = chipDoAluno(a);
  const m = a.abertas[0];
  return el('div', { class: 'cartao' },
    el('div', { class: 'linha entre topo' },
      el('div', {},
        el('h3', {}, a.nome),
        el('p', { class: 'pequeno suave' }, a.valor ? `${reais(a.valor)} · vence dia ${a.diaVenc}` : 'Sem mensalidade definida')
      ),
      el('span', { class: 'chip ' + classe }, rotulo)
    ),
    a.abertas.length > 1 && el('p', { class: 'pequeno' }, `${a.abertas.length} mensalidades em aberto: ${reais(a.totalAberto)}`),
    a.pagoAte && el('p', { class: 'pequeno' }, `Pago adiantado até ${a.pagoAte}.`),
    m?.informado && el('p', { class: 'pequeno suave' }, 'O aluno avisou que pagou. Confira antes de marcar.'),
    m && el('button', { class: 'botao menor', onclick: () => marcarPago(a, m) }, `Marcar ${m.rotulo.split(' ')[0]} como pago`),
    el('div', { class: 'dupla' },
      el('button', { class: 'botao claro menor', onclick: () => abrirAluno(a) }, icone('relogio', { tamanho: 18 }), 'Histórico'),
      a.emPausa
        ? el('button', { class: 'botao claro menor', onclick: () => abrirAluno(a) }, icone('pausa', { tamanho: 18 }), 'Ver pausa')
        : el('button', { class: 'botao claro menor', disabled: a.status === 'inativo', onclick: () => abrirAluno(a, { novaPausa: true }) }, icone('pausa', { tamanho: 18 }), 'Pausar')
    )
  );
}

function alunosFiltrados() {
  const termo = busca.trim().toLowerCase();
  return dados.alunos
    .filter((a) => a.status !== 'novo')
    .filter((a) => filtro === 'todos' || a.filtro === filtro)
    .filter((a) => !termo || a.nome.toLowerCase().includes(termo))
    .sort((x, y) => ORDEM.indexOf(x.filtro) - ORDEM.indexOf(y.filtro) || x.nome.localeCompare(y.nome));
}

function listaDeAlunos() {
  const lista = alunosFiltrados();
  if (!lista.length) return [el('p', { class: 'suave centro' }, busca ? 'Nenhum aluno com esse nome.' : 'Nenhum aluno nesta situação.')];
  return lista.map(cartaoAluno);
}

function abaAlunos() {
  const ativos = dados.alunos.filter((a) => a.status !== 'novo');
  const fila = ativos.filter(precisaLembrar);
  const atrasados = ativos.filter((a) => a.filtro === 'atrasado').length;
  const vencemHoje = ativos.filter((a) => a.filtro === 'pendente' && a.dias === 0).length;
  const r = dados.resumo;
  const lista = el('div', { class: 'coluna', id: 'lista' }, ativos.length ? listaDeAlunos() : null);
  const numero = (rotulo, valor) => el('div', { class: 'numero' }, el('span', { class: 'pequeno suave' }, rotulo), el('strong', {}, reais(valor)));

  return [
    !dados.personal.pixChave && el('p', { class: 'aviso' }, 'Cadastre sua chave Pix na aba Conta para os alunos conseguirem pagar pelo link.'),
    desfazer && el('div', { class: 'aviso coluna' },
      el('span', {}, desfazer.texto),
      el('a', { class: 'botao menor', href: desfazer.avisar, target: '_blank', rel: 'noopener' }, 'Avisar o aluno e enviar a conquista'),
      el('button', {
        class: 'link',
        onclick: () => {
          const ultimo = desfazer;
          desfazer = null;
          agir(() => api(`alunos/${ultimo.id}/mensalidades/${ultimo.mes}`, 'POST', { acao: 'reabrir' }));
        },
      }, 'Desfazer')
    ),
    (atrasados > 0 || vencemHoje > 0) && el('div', { class: 'cartao escuro' },
      el('h3', {}, 'Verificar hoje'),
      el('p', { class: 'suave' }, [
        atrasados ? `${atrasados} ${atrasados === 1 ? 'aluno com mensalidade vencida' : 'alunos com mensalidade vencida'}` : null,
        vencemHoje ? `${vencemHoje} ${vencemHoje === 1 ? 'vence hoje' : 'vencem hoje'}` : null,
      ].filter(Boolean).join(' e ') + '. Confira se o pagamento entrou.'),
      atrasados > 0 && filtro !== 'atrasado' && el('button', { class: 'botao lima menor', onclick: () => { filtro = 'atrasado'; desenhar(); } }, 'Ver atrasados')
    ),
    el('div', { class: 'resumo', 'aria-label': 'Resumo de ' + dados.mesAtual },
      numero('Recebido em ' + dados.mesAtual.split(' ')[0], r.recebido),
      numero('Pendente', r.pendente),
      numero('Atrasado', r.atrasado)
    ),
    el('div', { class: 'dupla' },
      el('button', { class: 'botao menor', disabled: !fila.length, onclick: () => abrirFila(fila) }, fila.length ? `Lembrar (${fila.length})` : 'Lembretes em dia'),
      el('button', { class: 'botao claro menor', onclick: () => abrirFormulario(null) }, 'Novo aluno')
    ),
    !ativos.length && el('div', { class: 'cartao' },
      el('h3', {}, 'Nenhum aluno ainda'),
      el('p', { class: 'suave' }, 'Cadastre você mesmo em "Novo aluno" ou envie o link de convite da aba Novos para o aluno se cadastrar sozinho.')
    ),
    ativos.length > 0 && el('div', { class: 'campo' },
      el('label', { for: 'busca' }, 'Buscar aluno'),
      el('input', {
        id: 'busca', type: 'search', placeholder: 'Nome do aluno', value: busca,
        oninput: (e) => {
          busca = e.target.value;
          lista.replaceChildren(...listaDeAlunos());
        },
      })
    ),
    ativos.length > 0 && el('div', { class: 'filtros', role: 'group', 'aria-label': 'Filtrar alunos' },
      FILTROS.map(([id, rotulo]) => {
        const n = id === 'todos' ? ativos.length : ativos.filter((a) => a.filtro === id).length;
        return el('button', { class: 'filtro', 'aria-pressed': String(filtro === id), onclick: () => { filtro = id; desenhar(); } }, `${rotulo} ${n}`);
      })
    ),
    lista,
  ];
}

// ---------- Fila de lembretes ----------

function abrirFila(lista) {
  folha = { tipo: 'fila', lista, i: 0, texto: textoLembrete(lista[0]), ocupado: false, aviso: '' };
  desenhar();
}

function folhaFila() {
  const f = folha;
  const a = f.lista[f.i];
  if (!a) {
    return [
      el('h2', {}, 'Tudo enviado'),
      el('p', { class: 'suave' }, 'Cada aluno recebeu a mensagem com o link pessoal.'),
      el('button', { class: 'botao', onclick: fecharFolha }, 'Fechar'),
    ];
  }
  const area = el('textarea', { id: 'msg', value: f.texto, oninput: (e) => (f.texto = e.target.value) });
  const proximo = () => {
    f.i++;
    f.aviso = '';
    if (f.lista[f.i]) f.texto = textoLembrete(f.lista[f.i]);
    desenhar();
  };
  return [
    el('div', {},
      el('p', { class: 'pequeno suave' }, f.lista.length > 1 ? `${f.i + 1} de ${f.lista.length}` : 'Mensagem'),
      el('h2', {}, 'Para ' + a.nome)
    ),
    el('div', { class: 'campo' }, el('label', { for: 'msg' }, 'Você pode editar antes de enviar'), area),
    el('button', {
      class: 'botao claro menor',
      disabled: f.ocupado,
      onclick: async () => {
        f.ocupado = true;
        f.aviso = '';
        desenhar();
        try {
          const r = await api('ia/lembrete', 'POST', { alunoId: a.id });
          f.texto = `${r.texto}\n\n${linkAluno(a)}`;
        } catch (e) {
          f.aviso = e.message;
        }
        f.ocupado = false;
        desenhar();
      },
    }, f.ocupado ? 'Escrevendo…' : 'Reescrever com IA'),
    f.aviso && el('p', { class: 'erro', role: 'alert' }, f.aviso),
    el('a', {
      class: 'botao', href: `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(f.texto)}`, target: '_blank', rel: 'noopener',
      onclick: (ev) => {
        // Usa o texto que estiver na caixa neste momento.
        ev.currentTarget.href = `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(area.value)}`;
        api(`alunos/${a.id}/lembrado`, 'POST', {}).catch(() => {});
        a.lembradoHoje = true;
        setTimeout(proximo, 400);
      },
    }, 'Enviar pelo WhatsApp'),
    el('div', { class: 'linha entre' },
      f.lista.length > 1 ? el('button', { class: 'link', onclick: proximo }, 'Pular') : el('span'),
      el('button', { class: 'link', onclick: fecharFolha }, 'Fechar')
    ),
  ];
}

async function fecharFolha() {
  if (!folha) return;
  folha = null;
  erro = '';
  desenhar();
  try {
    await carregar();
    if (!folha) desenhar();
  } catch { /* mantém o que já está na tela */ }
}

// A janela entra no histórico do navegador: o gesto de voltar (iPhone) e o botão voltar (Android) fecham a janela
// em vez de sair do painel.
let folhaNoHistorico = false;
let tipoAnterior = null;
function sincronizarHistorico() {
  if (folha && !folhaNoHistorico) {
    history.pushState({ folha: true }, '');
    folhaNoHistorico = true;
  } else if (!folha && folhaNoHistorico) {
    folhaNoHistorico = false;
    if (history.state?.folha) history.back();
  }
}
window.addEventListener('popstate', () => {
  if (!folhaNoHistorico) return;
  folhaNoHistorico = false;
  fecharFolha();
});

// Arrastar a janela para baixo fecha; tocar fora dela também.
function janelaDeslizante(conteudo) {
  const entrando = !folhaNoHistorico; // só anima na abertura, não a cada atualização
  const janela = el('div', { class: 'folha' + (entrando ? ' entrando' : ''), role: 'dialog', 'aria-modal': 'true' }, conteudo);
  const fundo = el('div', { class: 'folha-fundo' + (entrando ? ' entrando' : ''), onclick: (e) => { if (e.target === fundo) fecharAnimado(); } }, janela);
  let inicioY = null;
  let deslocamento = 0;
  let instante = 0;
  function fecharAnimado() {
    janela.style.transition = 'transform 0.22s ease-in';
    janela.style.transform = 'translateY(105%)';
    fundo.style.transition = 'opacity 0.22s ease-in';
    fundo.style.opacity = '0';
    setTimeout(fecharFolha, 200);
  }
  janela.addEventListener('touchstart', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const naAlca = e.touches[0].clientY - janela.getBoundingClientRect().top < 48;
    if (janela.scrollTop > 0 && !naAlca) return;
    inicioY = e.touches[0].clientY;
    deslocamento = 0;
    instante = Date.now();
    janela.style.transition = 'none';
  }, { passive: true });
  janela.addEventListener('touchmove', (e) => {
    if (inicioY == null) return;
    deslocamento = Math.max(0, e.touches[0].clientY - inicioY);
    if (deslocamento > 0) {
      e.preventDefault();
      janela.style.transform = `translateY(${deslocamento}px)`;
      fundo.style.opacity = String(Math.max(0.3, 1 - deslocamento / 500));
    }
  }, { passive: false });
  const soltar = () => {
    if (inicioY == null) return;
    inicioY = null;
    const rapido = deslocamento > 40 && deslocamento / Math.max(1, Date.now() - instante) > 0.6;
    if (deslocamento > 120 || rapido) return fecharAnimado();
    janela.style.transition = 'transform 0.2s ease-out';
    janela.style.transform = '';
    fundo.style.opacity = '';
  };
  janela.addEventListener('touchend', soltar);
  janela.addEventListener('touchcancel', soltar);
  return fundo;
}

// ---------- Aluno: histórico, pagamento, cadastro e pausas ----------

// Executa uma ação e atualiza a lista e a janela aberta do aluno.
async function agirNaFolha(funcao) {
  erro = '';
  desfazer = null;
  try {
    await funcao();
    await carregar();
    if (folha && folha.id) {
      const a = dados.alunos.find((x) => x.id === folha.id);
      if (!a) folha = null;
      else folha.mensalidades = (await api(`alunos/${a.id}/mensalidades`)).mensalidades;
    }
  } catch (e) {
    erro = e.message;
  }
  desenhar();
}

const alunoDaFolha = () => dados.alunos.find((x) => x.id === folha.id);
const irPara = (tipo, extra = {}) => { erro = ''; folha = { ...folha, ...extra, tipo }; desenhar(); };

async function abrirAluno(a, extra = {}) {
  folha = { tipo: 'aluno', id: a.id, mensalidades: null, ...extra };
  desenhar();
  await agirNaFolha(async () => {});
}

function linhaMensalidade(a, m) {
  const [classe, rotulo] = CHIP_MENSALIDADE[m.situacao];
  const detalhe = {
    pago: `Recebido em ${dataBR(m.recebidoEm)} · ${reais(m.valorRecebido || 0)}${m.adiantado ? ' · adiantado' : ''}`,
    pendente: `Vence em ${dataBR(m.vencimento)} · ${reais(m.valor || 0)}`,
    atrasado: `Venceu em ${dataBR(m.vencimento)} · ${reais(m.valor || 0)}`,
    pausado: 'Aluno em pausa neste vencimento',
    dispensado: 'Não será cobrada',
    anterior: 'Mês de treino anterior ao controle pelo app',
  }[m.situacao];
  const aberta = m.situacao === 'pendente' || m.situacao === 'atrasado';
  return el('div', { class: 'mensalidade' },
    el('div', { class: 'linha entre topo' },
      el('div', {}, el('h3', {}, maiuscula(m.rotulo)), el('p', { class: 'pequeno suave' }, detalhe + (m.informado ? ' · aluno avisou que pagou' : ''))),
      el('span', { class: 'chip ' + classe }, rotulo)
    ),
    el('div', { class: 'linha' },
      aberta && el('button', { class: 'botao menor', style: 'width: auto; padding: 0 20px', onclick: () => marcarPago(a, m) }, 'Pago'),
      el('button', { class: 'link pequeno', onclick: () => irPara('pagar', { m }) }, aberta ? 'Outra data ou valor' : m.situacao === 'pago' ? 'Corrigir' : m.situacao === 'anterior' ? 'Informar se foi pago ou não' : 'Alterar')
    )
  );
}

function linhaPausa(a, p) {
  const aberta = !p.fim || p.fim >= dados.hoje;
  return el('div', { class: 'mensalidade pausa' },
    el('div', { class: 'linha entre topo' },
      el('div', {},
        el('h3', {}, `Pausa: ${dataBR(p.inicio)} ${p.fim ? 'até ' + dataBR(p.fim) : 'em diante'}`),
        el('p', { class: 'pequeno suave' }, p.cobrar ? 'Mensalidade mantida durante a pausa' : 'Sem mensalidade durante a pausa')
      ),
      el('span', { class: 'chip vazio' }, aberta && p.inicio <= dados.hoje ? 'Em pausa' : aberta ? 'Agendada' : 'Encerrada')
    ),
    el('div', { class: 'linha' },
      aberta && p.inicio <= dados.hoje && el('button', {
        class: 'link pequeno',
        onclick: () => agirNaFolha(() => api(`alunos/${a.id}/pausas/${p.id}`, 'PUT', { inicio: p.inicio, fim: dados.hoje, cobrar: p.cobrar })),
      }, 'Encerrar hoje'),
      el('button', { class: 'link pequeno', onclick: () => agirNaFolha(() => api(`alunos/${a.id}/pausas/${p.id}`, 'DELETE')) }, 'Apagar pausa')
    )
  );
}

function formularioPausa(a) {
  const inicio = el('input', { id: 'pInicio', type: 'date', required: true, value: dados.hoje });
  const fim = el('input', { id: 'pFim', type: 'date' });
  const cobrar = el('input', { type: 'checkbox' });
  return el('form', {
    class: 'cartao',
    onsubmit: (e) => {
      e.preventDefault();
      agirNaFolha(async () => {
        await api(`alunos/${a.id}/pausas`, 'POST', { inicio: inicio.value, fim: fim.value || null, cobrar: cobrar.checked });
        folha.novaPausa = false;
      });
    },
  },
    el('h3', {}, 'Nova pausa'),
    el('div', { class: 'dupla' },
      el('div', { class: 'campo' }, el('label', { for: 'pInicio' }, 'Início'), inicio),
      el('div', { class: 'campo' }, el('label', { for: 'pFim' }, 'Término (opcional)'), fim)
    ),
    el('p', { class: 'pequeno suave' }, 'Sem término, a pausa vale até você encerrar. Mensalidade que vence durante a pausa não é cobrada, a menos que você marque a opção abaixo.'
    ),
    el('label', { class: 'marca' }, cobrar, el('span', {}, 'Manter a mensalidade durante a pausa')),
    el('div', { class: 'dupla' },
      el('button', { class: 'botao menor', type: 'submit' }, 'Registrar'),
      el('button', { class: 'botao claro menor', type: 'button', onclick: () => irPara('aluno', { novaPausa: false }) }, 'Cancelar')
    )
  );
}

function folhaAluno() {
  const a = alunoDaFolha();
  const [classe, rotulo] = chipDoAluno(a);
  const trilha = `Oi, ${primeiro(a.nome)}! Este é o seu cartão no Renova AI, com sua trilha de treinos com ${P()}, seus selos e a imagem da sua conquista para compartilhar: ${linkAluno(a)}`;

  // Pausas e mensalidades juntas, da mais recente para a mais antiga.
  const historico = [
    ...(folha.mensalidades || []).map((m) => ({ data: m.vencimento, no: () => linhaMensalidade(a, m) })),
    ...a.pausas.map((p) => ({ data: p.inicio, no: () => linhaPausa(a, p) })),
  ].sort((x, y) => (x.data < y.data ? 1 : -1));

  return [
    el('div', { class: 'linha entre topo' },
      el('div', {},
        el('h2', {}, a.nome),
        el('p', { class: 'pequeno suave' }, [`WhatsApp ${whatsLocal(a.whatsapp)}`, a.dataInicio ? `treina desde ${dataBR(a.dataInicio)}` : null, `${meses(a.meses)} de treino`].filter(Boolean).join(' · '))
      ),
      el('span', { class: 'chip ' + classe }, rotulo)
    ),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    el('div', { class: 'dupla' },
      el('button', { class: 'botao claro menor', onclick: () => irPara('form') }, 'Editar cadastro'),
      el('button', { class: 'botao claro menor', disabled: !!folha.novaPausa, onclick: () => irPara('aluno', { novaPausa: true }) }, 'Registrar pausa')
    ),
    el('div', { class: 'dupla' },
      el('button', { class: 'botao claro menor', disabled: a.status === 'inativo', onclick: () => abrirFila([a]) }, 'Enviar lembrete'),
      el('a', { class: 'botao claro menor', href: `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(trilha)}`, target: '_blank', rel: 'noopener' }, 'Enviar link da trilha')
    ),
    folha.novaPausa && formularioPausa(a),
    el('h3', {}, 'Mensalidades e pausas'),
    !folha.mensalidades && el('p', { class: 'suave' }, 'Carregando…'),
    folha.mensalidades && !historico.length && el('p', { class: 'suave' }, 'Nada por aqui ainda. A primeira mensalidade aparece no mês em que o controle começa.'),
    folha.mensalidades && historico.map((item) => item.no()),
    el('div', { class: 'linha entre' },
      el('button', { class: 'link', onclick: () => irPara('pagar', { m: null }) }, 'Lançar outro mês'),
      el('button', { class: 'link', onclick: fecharFolha }, 'Fechar')
    ),
  ];
}

function folhaPagar() {
  const a = alunoDaFolha();
  const m = folha.m;
  const mes = el('input', { id: 'mesRef', type: 'month', required: true, value: dados.hoje.slice(0, 7) });
  const quantos = el('select', { id: 'quantos' }, [1, 2, 3, 4, 5, 6, 12].map((n) => el('option', { value: n }, n === 1 ? '1 mês' : `${n} meses`)));
  const data = el('input', { id: 'dataRec', type: 'date', required: true, max: dados.hoje, value: m?.recebidoEm || (m?.situacao === 'anterior' ? m.vencimento : dados.hoje) }); // mês antigo: sugere a data daquele mês
  const valor = el('input', { id: 'valorRec', type: 'text', inputmode: 'decimal', required: true, value: paraCampoValor(m?.valorRecebido || m?.valor || a.valor) });
  const acao = (nome) => agirNaFolha(async () => {
    await api(`alunos/${a.id}/mensalidades/${m.mes}`, 'POST', { acao: nome });
    folha = { tipo: 'aluno', id: a.id, mensalidades: folha.mensalidades };
  });
  return [
    el('div', {}, el('p', { class: 'pequeno suave' }, a.nome), el('h2', {}, m ? maiuscula(m.rotulo) : 'Lançar um recebimento')),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    m?.situacao === 'anterior' && el('p', { class: 'suave' }, 'Este mês é de antes do controle pelo app. Se foi recebido, salve como pago. Se ficou em aberto, marque como atrasado: ele entra na conta do aluno e na fila de lembretes.'),
    el('form', {
      class: 'coluna',
      onsubmit: (e) => {
        e.preventDefault();
        const centavos = paraCentavos(valor.value);
        if (centavos < 1) {
          erro = 'Informe o valor recebido.';
          return desenhar();
        }
        agirNaFolha(async () => {
          // Um lançamento por mês: quem paga três meses de uma vez gera três mensalidades pagas.
          let [ano, numero] = (m ? m.mes : mes.value).split('-').map(Number);
          for (let i = 0; i < (m ? 1 : Number(quantos.value)); i++) {
            const referencia = `${ano}-${String(numero).padStart(2, '0')}`;
            await api(`alunos/${a.id}/mensalidades/${referencia}`, 'POST', { acao: 'pagar', data: data.value, valor: centavos });
            numero++;
            if (numero > 12) { numero = 1; ano++; }
          }
          folha = { tipo: 'aluno', id: a.id, mensalidades: folha.mensalidades };
        });
      },
    },
      !m && el('div', { class: 'dupla' },
        el('div', { class: 'campo' }, el('label', { for: 'mesRef' }, 'A partir de qual mês'), mes),
        el('div', { class: 'campo' }, el('label', { for: 'quantos' }, 'Quantos meses'), quantos)
      ),
      !m && el('p', { class: 'pequeno suave' }, 'Vale para meses passados e futuros. Para quem paga adiantado, escolha os próximos meses.'),
      el('div', { class: 'dupla' },
        el('div', { class: 'campo' }, el('label', { for: 'dataRec' }, 'Recebido em'), data),
        el('div', { class: 'campo' }, el('label', { for: 'valorRec' }, m ? 'Valor recebido (R$)' : 'Valor por mês (R$)'), valor)
      ),
      el('p', { class: 'pequeno suave' }, 'O valor entra no faturamento do mês em que foi recebido.'),
      el('button', { class: 'botao', type: 'submit' }, m?.situacao === 'pago' ? 'Salvar correção' : 'Salvar como pago')
    ),
    m && m.situacao !== 'pendente' && m.situacao !== 'atrasado' && el('button', { class: 'botao claro menor', onclick: () => acao('reabrir') }, m.situacao === 'pago' ? (m.adiantado ? 'Desfazer pagamento adiantado' : 'Desfazer pagamento') : m.situacao === 'anterior' ? 'Não foi pago: marcar como atrasado' : 'Voltar a cobrar este mês'),
    m && (m.situacao === 'pendente' || m.situacao === 'atrasado') && el('button', { class: 'botao claro menor', onclick: () => acao('dispensar') }, 'Dispensar esta mensalidade'),
    el('button', { class: 'link', onclick: () => irPara('aluno') }, 'Voltar'),
  ];
}

// Cadastro pelo personal (aluno novo) ou edição de um aluno existente.
function abrirFormulario(a) {
  erro = '';
  folha = a ? { tipo: 'form', id: a.id } : { tipo: 'form', id: null };
  desenhar();
}

function folhaFormulario() {
  const a = folha.id ? alunoDaFolha() : null;
  const p = dados.personal;
  const nome = el('input', { id: 'fNome', type: 'text', required: true, autocomplete: 'off', value: a?.nome || '' });
  const whats = mascararWhats(el('input', { id: 'fWhats', type: 'tel', required: true, autocomplete: 'off', placeholder: '(62) 900000000', value: a ? whatsLocal(a.whatsapp) : '' }));
  const inicio = el('input', { id: 'fInicio', type: 'date', max: dados.hoje, value: a?.dataInicio || '' });
  const valor = el('input', { id: 'fValor', type: 'text', inputmode: 'decimal', required: true, placeholder: '250,00', value: paraCampoValor(a?.valor || p.valorPadrao) });
  const dia = el('input', { id: 'fDia', type: 'number', min: '1', max: '28', required: true, value: a?.diaVenc || p.diaPadrao || 5 });
  const primeira = el('select', { id: 'fPrimeira' }, el('option', { value: 'atual' }, 'Neste mês'), el('option', { value: 'proximo' }, 'No mês que vem'));
  const base = el('input', { id: 'fBase', type: 'number', min: '0', max: '600', value: a ? a.baseMeses : 0 });
  const situacao = el('select', { id: 'fSituacao' }, el('option', { value: 'ativo' }, 'Ativo'), el('option', { value: 'inativo' }, 'Inativo (parou de treinar)'));
  if (a) situacao.value = a.status === 'inativo' ? 'inativo' : 'ativo';
  const rotulado = (rotulo, campoEl, dica) => el('div', { class: 'campo' }, el('label', { for: campoEl.id }, rotulo), campoEl, dica && el('p', { class: 'pequeno suave' }, dica));

  return [
    el('h2', {}, a ? 'Editar ' + primeiro(a.nome) : 'Novo aluno'),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    el('form', {
      class: 'coluna',
      onsubmit: (e) => {
        e.preventDefault();
        const centavos = paraCentavos(valor.value);
        if (centavos < 100) {
          erro = 'Informe o valor da mensalidade.';
          return desenhar();
        }
        const campos = { nome: nome.value, whatsapp: whats.value, dataInicio: inicio.value || null, valor: centavos, diaVenc: Number(dia.value) };
        agirNaFolha(async () => {
          if (a) {
            await api('alunos/' + a.id, 'PUT', { ...campos, baseMeses: campos.dataInicio ? undefined : Number(base.value), status: situacao.value });
            folha = { tipo: 'aluno', id: a.id, mensalidades: null };
          } else {
            await api('alunos', 'POST', { ...campos, primeiroMes: primeira.value });
            folha = null;
            filtro = 'todos';
          }
        });
      },
    },
      rotulado('Nome completo', nome),
      rotulado('Celular / WhatsApp', whats),
      rotulado('Início dos treinos (opcional)', inicio, 'Serve para contar os meses de treino na trilha do aluno.'),
      el('div', { class: 'dupla' }, rotulado('Mensalidade (R$)', valor), rotulado('Dia do vencimento', dia)),
      !a && rotulado('Primeira mensalidade a controlar', primeira, 'Escolha "No mês que vem" se a deste mês já está resolvida.'),
      a && rotulado('Situação', situacao, 'Aluno inativo não gera novas mensalidades. Para uma parada temporária, registre uma pausa.'),
      a && !inicio.value && rotulado('Meses de treino antes do controle', base, 'Sem a data de início, informe aqui quantos meses o aluno já treinava. Só afeta a trilha e os selos.'),
      el('button', { class: 'botao', type: 'submit' }, a ? 'Salvar' : 'Cadastrar aluno')
    ),
    el('div', { class: 'linha entre' },
      a ? el('button', {
        class: 'link',
        onclick: () => {
          if (confirm(`Excluir ${a.nome} e todo o histórico de mensalidades? Isso não pode ser desfeito.`)) {
            agirNaFolha(async () => {
              await api('alunos/' + a.id, 'DELETE');
              folha = null;
            });
          }
        },
      }, 'Excluir aluno') : el('span'),
      el('button', { class: 'link', onclick: () => (a ? irPara('aluno') : fecharFolha()) }, a ? 'Voltar' : 'Fechar')
    ),
  ];
}

// ---------- Novos ----------

function abaNovos() {
  const novos = dados.alunos.filter((a) => a.status === 'novo');
  const copiarBotao = el('button', {
    class: 'botao lima menor',
    onclick: async () => {
      copiarBotao.textContent = (await copiar(linkConvite())) ? 'Link copiado' : 'Copie o link acima';
    },
  }, 'Copiar link');
  const convite = `Oi! Estou usando o Renova AI para acompanhar a jornada dos meus alunos. Faz seu cadastro em 1 minuto: ${linkConvite()}`;
  return [
    el('div', { class: 'cartao escuro' },
      el('p', { class: 'pequeno suave' }, 'Seu link de convite'),
      el('p', { style: "font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 17px; word-break: break-all" }, linkConvite().replace(/^https?:\/\//, '')),
      copiarBotao,
      el('a', { class: 'botao claro menor', href: 'https://wa.me/?text=' + encodeURIComponent(convite), target: '_blank', rel: 'noopener' }, 'Enviar pelo WhatsApp')
    ),
    !novos.length && el('p', { class: 'suave centro' }, 'Nenhum cadastro aguardando confirmação.'),
    novos.map((a) => {
      const detalhes = [a.mesInicio ? `Treina desde ${dataBR(a.dataInicio).slice(3)}` : 'Não informou quando começou', a.mesesPausa ? `${meses(a.mesesPausa)} de pausa` : null].filter(Boolean).join(', com ');
      const valor = el('input', { id: 'valor' + a.id, type: 'text', inputmode: 'decimal', required: true, placeholder: '250,00', value: paraCampoValor(a.valor || dados.personal.valorPadrao) });
      const dia = el('input', { id: 'dia' + a.id, type: 'number', min: '1', max: '28', required: true, value: a.diaVenc || dados.personal.diaPadrao || 5 });
      const primeira = el('select', { id: 'primeira' + a.id }, el('option', { value: 'atual' }, 'Neste mês'), el('option', { value: 'proximo' }, 'No mês que vem'));
      return el('div', { class: 'cartao' },
        el('div', {}, el('h3', {}, a.nome), el('p', { class: 'pequeno suave' }, `Cadastrou-se pelo seu link. ${detalhes}. WhatsApp ${whatsLocal(a.whatsapp)}.`)),
        el('form', {
          class: 'coluna',
          onsubmit: (e) => {
            e.preventDefault();
            const centavos = paraCentavos(valor.value);
            if (centavos < 100) {
              erro = 'Informe o valor da mensalidade.';
              return desenhar();
            }
            agir(() => api('alunos/' + a.id, 'PUT', { valor: centavos, diaVenc: Number(dia.value), primeiroMes: primeira.value, status: 'ativo' }));
          },
        },
          el('div', { class: 'dupla' },
            el('div', { class: 'campo' }, el('label', { for: valor.id }, 'Mensalidade (R$)'), valor),
            el('div', { class: 'campo' }, el('label', { for: dia.id }, 'Dia do vencimento'), dia)
          ),
          el('div', { class: 'campo' }, el('label', { for: primeira.id }, 'Primeira mensalidade a controlar'), primeira),
          el('button', { class: 'botao menor', type: 'submit' }, 'Confirmar aluno')
        ),
        el('button', {
          class: 'link pequeno',
          style: 'align-self: flex-start',
          onclick: () => {
            if (confirm(`Recusar o cadastro de ${a.nome}?`)) agir(() => api('alunos/' + a.id, 'DELETE'));
          },
        }, 'Não é meu aluno')
      );
    }),
  ];
}

// ---------- Arte ----------

function reduzirFoto(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 900 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      ok(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => falha(new Error('Não consegui abrir essa foto.'));
    img.src = URL.createObjectURL(arquivo);
  });
}

function abaArte() {
  const p = dados.personal;
  const arquivo = el('input', {
    type: 'file', accept: 'image/*', id: 'foto', style: 'display: none',
    onchange: (e) => {
      const escolhido = e.target.files[0];
      if (escolhido) agir(async () => api('foto', 'PUT', { foto: await reduzirFoto(escolhido) }));
    },
  });
  const tom = el('select', { id: 'tom-ia' },
    el('option', { value: 'zoeiro' }, 'Zoeiro'),
    el('option', { value: 'motivador' }, 'Motivador'),
    el('option', { value: 'carinhoso' }, 'Carinhoso')
  );
  tom.value = p.tom || 'zoeiro';
  const nova = el('input', { id: 'nova', type: 'text', maxlength: '110', placeholder: 'Mais um mês de…' });
  const sugerir = el('button', {
    class: 'botao menor',
    onclick: async () => {
      sugerir.disabled = true;
      sugerir.textContent = 'Criando frases…';
      erro = '';
      try {
        sugestoes = (await api('ia/frases', 'POST', { tom: tom.value })).frases;
      } catch (e) {
        erro = e.message;
      }
      desenhar();
    },
  }, 'Sugerir frases com IA');

  return [
    el('div', { class: 'cartao' },
      el('div', { class: 'linha' },
        p.temFoto
          ? el('img', { src: `/api/foto/${p.slug}?v=${Date.now()}`, alt: 'Sua foto', style: 'width: 72px; height: 96px; border-radius: 10px; object-fit: cover' })
          : el('div', { class: 'foto vazia', style: 'width: 72px; height: 96px; border-radius: 10px' }, 'Sua foto'),
        el('div', { class: 'coluna cresce', style: 'gap: 8px' },
          el('p', { class: 'pequeno suave' }, 'Esta foto vira o fundo da imagem de conquista que seus alunos compartilham. Fotos em pé funcionam melhor.'),
          arquivo,
          el('label', { class: 'botao claro menor', for: 'foto' }, p.temFoto ? 'Trocar foto' : 'Enviar foto')
        )
      )
    ),
    el('div', {}, el('h2', {}, 'Frases da conquista'), el('p', { class: 'pequeno suave' }, 'O aluno sorteia entre as frases marcadas. Onde aparece {meses}, entra o número de meses de treino dele.')),
    dados.frases.map((f) =>
      el('div', { class: 'cartao', style: 'flex-direction: row; align-items: center; padding: 8px 12px' },
        el('label', { class: 'marca cresce' },
          el('input', { type: 'checkbox', checked: f.ativa, onchange: (e) => agir(() => api('frases/' + f.id, 'PUT', { ativa: e.target.checked })) }),
          el('span', {}, f.texto.replaceAll('{personal}', P()))
        ),
        el('button', { class: 'link pequeno', 'aria-label': 'Apagar frase: ' + f.texto, onclick: () => agir(() => api('frases/' + f.id, 'DELETE')) }, 'Apagar')
      )
    ),
    el('form', {
      class: 'campo',
      onsubmit: (e) => {
        e.preventDefault();
        if (nova.value.trim()) agir(() => api('frases', 'POST', { texto: nova.value }));
      },
    },
      el('label', { for: 'nova' }, 'Adicionar uma frase sua'),
      el('div', { class: 'linha', style: 'gap: 8px' }, nova, el('button', { class: 'botao menor', type: 'submit', style: 'width: auto; min-height: 48px' }, 'Adicionar'))
    ),
    el('div', { class: 'cartao' },
      el('h3', {}, 'Sem ideias? A IA sugere'),
      el('div', { class: 'campo' }, el('label', { for: 'tom-ia' }, 'Tom das frases'), tom),
      sugerir,
      sugestoes.map((s) =>
        el('div', { class: 'linha entre', style: 'padding-top: 10px; border-top: 1px solid #DDE8E5' },
          el('span', { class: 'cresce' }, s),
          el('button', {
            class: 'link pequeno',
            onclick: () => {
              sugestoes = sugestoes.filter((x) => x !== s);
              agir(() => api('frases', 'POST', { texto: s, origem: 'ia' }));
            },
          }, 'Usar')
        )
      ),
      el('p', { class: 'pequeno suave' }, 'Só entram na imagem as frases que você escolher.')
    ),
  ];
}

// ---------- Conta ----------

function abaConta() {
  const p = dados.personal;
  const tipo = el('select', { id: 'pixTipo', name: 'pixTipo' },
    el('option', { value: 'celular' }, 'Celular'),
    el('option', { value: 'cpf_cnpj' }, 'CPF ou CNPJ'),
    el('option', { value: 'email' }, 'E-mail'),
    el('option', { value: 'aleatoria' }, 'Chave aleatória')
  );
  tipo.value = p.pixTipo || 'celular';
  const tom = el('select', { id: 'tom', name: 'tom' },
    el('option', { value: 'zoeiro' }, 'Zoeiro'),
    el('option', { value: 'motivador' }, 'Motivador'),
    el('option', { value: 'carinhoso' }, 'Carinhoso')
  );
  tom.value = p.tom || 'zoeiro';
  let salvo = false;
  const botao = el('button', { class: 'botao', type: 'submit' }, 'Salvar');
  return [
    el('form', {
      class: 'coluna', style: 'gap: 14px',
      onsubmit: async (e) => {
        e.preventDefault();
        const f = e.target;
        erro = '';
        try {
          await api('conta', 'PUT', {
            nome: f.nome.value, pixTipo: tipo.value, pixChave: f.pixChave.value, pixNome: f.pixNome.value, pixCidade: f.pixCidade.value,
            valorPadrao: paraCentavos(f.valorPadrao.value) || null, diaPadrao: Number(f.diaPadrao.value || 5), tom: tom.value,
          });
          await carregar();
          salvo = true;
        } catch (err) {
          erro = err.message;
        }
        desenhar();
        if (salvo) document.querySelector('#salvo')?.removeAttribute('hidden');
      },
    },
      el('h2', {}, 'Seu Pix'),
      el('p', { class: 'pequeno suave' }, 'O aluno paga direto para você. O app só monta o código copia e cola com o valor.'),
      el('div', { class: 'campo' }, el('label', { for: 'pixTipo' }, 'Tipo de chave'), tipo),
      campo('Chave Pix', { id: 'pixChave', name: 'pixChave', type: 'text', autocapitalize: 'none', value: p.pixChave || '' }),
      campo('Nome de quem recebe (como está no banco)', { id: 'pixNome', name: 'pixNome', type: 'text', maxlength: '60', value: p.pixNome || p.nome }),
      campo('Cidade', { id: 'pixCidade', name: 'pixCidade', type: 'text', maxlength: '40', value: p.pixCidade || '' }, 'input', 'O código Pix exige a cidade de quem recebe.'),
      el('h2', {}, 'Sugestão para novos alunos'),
      el('p', { class: 'pequeno suave' }, 'Estes valores só preenchem o cadastro de um aluno novo, para você digitar menos. Cada aluno pode ter mensalidade e dia próprios, e mudar aqui não altera quem já está cadastrado.'),
      el('div', { class: 'dupla' },
        campo('Mensalidade (R$)', { id: 'valorPadrao', name: 'valorPadrao', type: 'text', inputmode: 'decimal', placeholder: '250,00', value: p.valorPadrao ? (p.valorPadrao / 100).toFixed(2).replace('.', ',') : '' }),
        campo('Dia de vencimento', { id: 'diaPadrao', name: 'diaPadrao', type: 'number', min: '1', max: '28', value: p.diaPadrao || 5 })
      ),
      el('div', { class: 'campo' }, el('label', { for: 'tom' }, 'Tom das mensagens com IA'), tom, el('p', { class: 'pequeno suave' }, 'Usado quando você pede para a IA reescrever um lembrete ou sugerir frases.')),
      el('h2', {}, 'Você'),
      campo('Seu nome', { id: 'nome', name: 'nome', type: 'text', required: true, value: p.nome }),
      el('p', { class: 'pequeno suave' }, 'E-mail: ' + p.email),
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('p', { class: 'aviso', id: 'salvo', hidden: true }, 'Dados salvos.'),
      botao
    ),
    el('div', { class: 'cartao' },
      el('h3', {}, 'Recuperação de senha'),
      el('p', { class: 'pequeno suave' }, p.temCodigo
        ? 'Você já tem um código de recuperação. Se perdeu, gere outro: o antigo deixa de valer.'
        : 'Você ainda não tem um código de recuperação. Gere um e guarde, para o caso de esquecer a senha.'),
      el('button', {
        class: 'botao claro menor',
        onclick: () => agir(async () => {
          codigoNovo = (await api('conta/recuperacao', 'POST', {})).codigo;
        }),
      }, p.temCodigo ? 'Gerar novo código' : 'Gerar código de recuperação')
    ),
    secaoInstalar(),
    el('button', { class: 'link', onclick: () => agir(async () => { await api('conta/sair', 'POST', {}); dados = null; }) }, 'Sair da conta'),
  ];
}

// ---------- Montagem ----------

// Ao trocar de aba ou voltar para o app, busca os dados de novo (um aluno pode ter se cadastrado ou pago).
async function trocarAba(id) {
  aba = id;
  erro = '';
  desfazer = null;
  desenhar();
  window.scrollTo(0, 0);
  try {
    await carregar();
    desenhar();
  } catch { /* mantém o que já está na tela */ }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !dados || folha) return;
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  try {
    await carregar();
    desenhar();
  } catch { /* tenta de novo na próxima vez */ }
});

function desenhar() {
  if (!dados) return montar(telaConta());
  if (codigoNovo) return montar(telaCodigo());
  const novos = dados.alunos.filter((a) => a.status === 'novo').length;
  const abas = [['inicio', 'Início'], ['alunos', 'Alunos'], ['novos', novos ? `Novos (${novos})` : 'Novos'], ['arte', 'Conquista'], ['conta', 'Conta']];
  const conteudo = { inicio: abaInicio, alunos: abaAlunos, novos: abaNovos, arte: abaArte, conta: abaConta }[aba];
  const folhas = { fila: folhaFila, aluno: folhaAluno, pagar: folhaPagar, form: folhaFormulario };
  // Mantém a rolagem da janela quando ela é redesenhada com o mesmo conteúdo.
  const rolagem = folha && folha.tipo === tipoAnterior ? document.querySelector('.folha')?.scrollTop || 0 : 0;
  tipoAnterior = folha?.tipo || null;
  montar(
    el('header', { class: 'cabeca' },
      el('img', { class: 'cabeca-icone', src: '/icones/icone-192.png', alt: '' }),
      el('div', {}, el('p', { class: 'logo-texto' }, 'Renova', el('span', {}, '.AI')), el('h1', {}, 'Painel de ' + P()))
    ),
    el('nav', { class: 'abas', 'aria-label': 'Seções do painel' },
      abas.map(([id, rotulo]) => el('button', { class: 'aba', 'aria-pressed': String(aba === id), onclick: () => trocarAba(id) }, rotulo))
    ),
    aba !== 'conta' && avisoInstalar(),
    erro && !folha && aba !== 'conta' && el('p', { class: 'erro', role: 'alert' }, erro),
    conteudo(),
    folha && janelaDeslizante(folhas[folha.tipo]())
  );
  if (rolagem) document.querySelector('.folha').scrollTop = rolagem;
  sincronizarHistorico();
}

iniciarInstalacao(() => {
  if (dados && !codigoNovo && !folha) desenhar();
});

try {
  await carregar();
  desenhar();
} catch (e) {
  montar(el('h1', {}, 'Não foi possível abrir o painel'), el('p', { class: 'suave' }, e.message));
}
