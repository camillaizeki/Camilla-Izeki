// Painel do personal: renovações, novos alunos, arte e conta.
import { api, el, campo, meses, reais, paraCentavos, copiar, montar } from './comum.js';

let dados = null; // { personal, alunos, frases }
let aba = 'renovar';
let erro = '';
let modoConta = 'entrar';
let sugestoes = [];
let folha = null; // janela aberta por cima (fila de lembretes ou edição)

const P = () => dados.personal.primeiroNome;
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
  const enviar = async (evento) => {
    evento.preventDefault();
    const f = evento.target;
    erro = '';
    try {
      if (criando) {
        await api('conta/criar', 'POST', { nome: f.nome.value, email: f.email.value, senha: f.senha.value, slug: f.slug.value });
      } else {
        await api('conta/entrar', 'POST', { email: f.email.value, senha: f.senha.value });
      }
      await carregar();
      if (criando) aba = 'conta';
    } catch (e) {
      erro = e.message;
    }
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

  return [
    el('div', { class: 'coluna', style: 'margin-top: 6vh' },
      el('p', { class: 'pequeno', style: 'font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase' }, 'Renova.AI'),
      el('h1', {}, criando ? 'Criar conta de personal' : 'Entrar no painel')
    ),
    el('form', { class: 'coluna', style: 'gap: 14px', onsubmit: enviar },
      criando && el('div', { class: 'campo' }, el('label', { for: 'nome' }, 'Seu nome'), nome),
      campo('E-mail', { id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'email' }),
      campo(criando ? 'Crie uma senha (8 caracteres ou mais)' : 'Senha', {
        id: 'senha', name: 'senha', type: 'password', required: true, minlength: '8',
        autocomplete: criando ? 'new-password' : 'current-password',
      }),
      criando && el('div', { class: 'campo' },
        el('label', { for: 'slug' }, 'Seu link de convite'),
        slug,
        el('p', { class: 'pequeno suave' }, `Seus alunos vão acessar ${location.host}/c/seu-link`)
      ),
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('button', { class: 'botao', type: 'submit' }, criando ? 'Criar conta' : 'Entrar')
    ),
    el('button', {
      class: 'link',
      onclick: () => {
        modoConta = criando ? 'entrar' : 'criar';
        erro = '';
        desenhar();
      },
    }, criando ? 'Já tenho conta' : 'Sou novo por aqui: criar conta'),
  ];
}

// ---------- A renovar ----------

const CHIPS = {
  informado: ['lima', () => 'Disse que pagou'],
  renova_hoje: ['forte', () => 'Renova hoje'],
  renova_em: ['neutro', (a) => (a.dias === 1 ? 'Renova amanhã' : `Renova em ${a.dias} dias`)],
  aguardando: ['neutro', () => 'Aguardando renovação'],
  pausado: ['vazio', () => 'Pausado'],
  em_dia: ['vazio', () => 'Em dia'],
};
const ORDEM = ['informado', 'renova_hoje', 'renova_em', 'aguardando', 'pausado', 'em_dia'];
const precisaLembrar = (a) => ['renova_hoje', 'renova_em', 'aguardando'].includes(a.situacao) && !a.lembradoHoje;

function textoLembrete(a) {
  const nome = primeiro(a.nome);
  const assinatura = `\n\nResumo automático do Renova.AI para alunos de ${P()}`;
  if (a.status === 'pausado') {
    return `Oi, ${nome}! Sua jornada de ${meses(a.meses)} com ${P()} está guardada. Quando quiser voltar, é só reativar por aqui: ${linkAluno(a)}${assinatura}`;
  }
  const marco = a.proximoMarco ? ` e ganhe o selo ${a.proximoMarco}` : '';
  return `Oi, ${nome}! Você já tem ${meses(a.meses)} de treino com ${P()}. Veja seu cartão e desbloqueie ${a.nomeAlvo}${marco}: ${linkAluno(a)}${assinatura}`;
}

function cartaoAluno(a) {
  const [classe, rotulo] = CHIPS[a.situacao];
  const acoes = [];
  if (a.situacao === 'informado') {
    acoes.push(
      el('button', { class: 'botao menor', onclick: () => agir(() => api(`alunos/${a.id}/pagamento`, 'POST', { acao: 'confirmar' })) }, 'Confirmar Pix recebido'),
      el('button', { class: 'link pequeno', onclick: () => agir(() => api(`alunos/${a.id}/pagamento`, 'POST', { acao: 'recusar' })) }, 'Ainda não recebi')
    );
  } else if (a.lembradoHoje && a.situacao !== 'em_dia') {
    acoes.push(el('p', { class: 'pequeno suave' }, 'Lembrete enviado hoje pelo WhatsApp.'));
  } else if (a.situacao !== 'em_dia') {
    acoes.push(el('button', { class: 'botao claro menor', onclick: () => abrirFila([a]) }, a.status === 'pausado' ? 'Chamar de volta' : 'Lembrar pelo WhatsApp'));
  }
  return el('div', { class: 'cartao' },
    el('div', { class: 'linha entre topo' },
      el('div', {}, el('h3', {}, a.nome), el('p', { class: 'pequeno suave' }, meses(a.meses) + ' de treino')),
      el('span', { class: 'chip ' + classe }, rotulo(a))
    ),
    acoes,
    el('button', { class: 'link pequeno', style: 'align-self: flex-start; min-height: 32px', onclick: () => abrirEdicao(a) }, 'Editar ou marcar como renovado')
  );
}

function abaRenovar() {
  const ativos = dados.alunos.filter((a) => a.status !== 'novo').sort((x, y) => ORDEM.indexOf(x.situacao) - ORDEM.indexOf(y.situacao));
  const fila = ativos.filter(precisaLembrar);
  const semPix = !dados.personal.pixChave;
  return [
    semPix && el('p', { class: 'aviso' }, 'Cadastre sua chave Pix na aba Conta para os alunos conseguirem renovar.'),
    fila.length > 0 && el('button', { class: 'botao', onclick: () => abrirFila(fila) }, `Lembrar todos (${fila.length})`),
    !ativos.length && el('div', { class: 'cartao' },
      el('h3', {}, 'Nenhum aluno ainda'),
      el('p', { class: 'suave' }, 'Envie seu link de convite, que está na aba Novos. Cada aluno se cadastra sozinho e aparece aqui.')
    ),
    ativos.map(cartaoAluno),
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
  const whats = `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(f.texto)}`;
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
      class: 'botao', href: whats, target: '_blank', rel: 'noopener',
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
  folha = null;
  await carregar();
  desenhar();
}

// ---------- Edição do aluno ----------

function abrirEdicao(a) {
  folha = { tipo: 'edicao', a, aviso: '' };
  desenhar();
}

function formularioAluno(a, rotuloBotao, aoSalvar) {
  const valor = el('input', { id: 'valor' + a.id, type: 'text', inputmode: 'decimal', required: true, placeholder: '250,00', value: a.valor ? (a.valor / 100).toFixed(2).replace('.', ',') : '' });
  const dia = el('input', { id: 'dia' + a.id, type: 'number', min: '1', max: '28', required: true, value: a.diaVenc || dados.personal.diaPadrao || 5 });
  const base = el('input', { id: 'base' + a.id, type: 'number', min: '1', max: '600', required: true, value: a.baseMeses });
  return el('form', {
    class: 'coluna',
    onsubmit: (evento) => {
      evento.preventDefault();
      const centavos = paraCentavos(valor.value);
      if (centavos < 100) {
        erro = 'Informe o valor da mensalidade.';
        return desenhar();
      }
      aoSalvar({ valor: centavos, diaVenc: Number(dia.value), baseMeses: Number(base.value) });
    },
  },
    el('div', { class: 'dupla' },
      el('div', { class: 'campo' }, el('label', { for: valor.id }, 'Mensalidade (R$)'), valor),
      el('div', { class: 'campo' }, el('label', { for: dia.id }, 'Dia de renovação'), dia)
    ),
    el('div', { class: 'campo' },
      el('label', { for: base.id }, 'Meses de treino no cadastro'),
      base,
      el('p', { class: 'pequeno suave' }, 'É o ponto de partida da trilha. Ajuste se o aluno informou errado.')
    ),
    el('button', { class: 'botao menor', type: 'submit' }, rotuloBotao)
  );
}

function folhaEdicao() {
  const a = folha.a;
  const pausado = a.status === 'pausado';
  const salvar = (campos, status = a.status) =>
    agir(async () => {
      await api('alunos/' + a.id, 'PUT', { ...campos, status });
      folha = null;
    });
  const atuais = { valor: a.valor, diaVenc: a.diaVenc, baseMeses: a.baseMeses };
  const podeMarcar = a.situacao !== 'em_dia' && a.valor > 0;
  return [
    el('h2', {}, a.nome),
    el('p', { class: 'pequeno suave' }, 'WhatsApp: +' + a.whatsapp),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    podeMarcar && el('button', {
      class: 'botao lima menor',
      onclick: () => agir(async () => {
        await api(`alunos/${a.id}/pagamento`, 'POST', { acao: 'confirmar' });
        folha = null;
      }),
    }, `Marcar ${a.nomeAlvo} como renovado`),
    formularioAluno(a, 'Salvar', (campos) => salvar(campos)),
    a.valor > 0 && el('button', { class: 'botao claro menor', onclick: () => salvar(atuais, pausado ? 'ativo' : 'pausado') }, pausado ? 'Reativar aluno' : 'Pausar aluno'),
    el('div', { class: 'linha entre' },
      el('button', {
        class: 'link',
        onclick: () => {
          if (confirm(`Excluir ${a.nome} e todo o histórico? Isso não pode ser desfeito.`)) {
            agir(async () => {
              await api('alunos/' + a.id, 'DELETE');
              folha = null;
            });
          }
        },
      }, 'Excluir aluno'),
      el('button', { class: 'link', onclick: () => { folha = null; erro = ''; desenhar(); } }, 'Fechar')
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
  const convite = `Oi! Estou usando o Renova.AI para acompanhar a jornada dos meus alunos. Faz seu cadastro em 1 minuto: ${linkConvite()}`;
  return [
    el('div', { class: 'cartao escuro' },
      el('p', { class: 'pequeno suave' }, 'Seu link de convite'),
      el('p', { style: "font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 17px; word-break: break-all" }, linkConvite().replace(/^https?:\/\//, '')),
      copiarBotao,
      el('a', { class: 'botao claro menor', href: 'https://wa.me/?text=' + encodeURIComponent(convite), target: '_blank', rel: 'noopener' }, 'Enviar pelo WhatsApp')
    ),
    !novos.length && el('p', { class: 'suave centro' }, 'Nenhum cadastro aguardando confirmação.'),
    novos.map((a) => {
      const detalhes = [a.mesInicio ? `Informou ${meses(a.baseMeses)} de treino` : 'Não informou quando começou', a.mesesPausa ? `${meses(a.mesesPausa)} de pausa` : null].filter(Boolean).join(' e ');
      return el('div', { class: 'cartao' },
        el('div', {}, el('h3', {}, a.nome), el('p', { class: 'pequeno suave' }, `Cadastrou-se pelo seu link. ${detalhes}.`)),
        formularioAluno(a, 'Confirmar aluno', (campos) => agir(() => api('alunos/' + a.id, 'PUT', { ...campos, status: 'ativo' }))),
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
          el('p', { class: 'pequeno suave' }, 'Esta foto vira o fundo da arte que seus alunos compartilham. Fotos em pé funcionam melhor.'),
          arquivo,
          el('label', { class: 'botao claro menor', for: 'foto' }, p.temFoto ? 'Trocar foto' : 'Enviar foto')
        )
      )
    ),
    el('div', {}, el('h2', {}, 'Frases da arte'), el('p', { class: 'pequeno suave' }, 'O aluno sorteia entre as frases marcadas. Onde aparece {meses}, entra o número de meses de treino dele.')),
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
        el('div', { class: 'linha entre', style: 'padding-top: 10px; border-top: 1px solid #DDE0D6' },
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
      el('p', { class: 'pequeno suave' }, 'Só entram na arte as frases que você escolher.')
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
      campo('Cidade', { id: 'pixCidade', name: 'pixCidade', type: 'text', maxlength: '40', value: p.pixCidade || '' }),
      el('h2', {}, 'Padrões'),
      el('div', { class: 'dupla' },
        campo('Mensalidade padrão (R$)', { id: 'valorPadrao', name: 'valorPadrao', type: 'text', inputmode: 'decimal', placeholder: '250,00', value: p.valorPadrao ? (p.valorPadrao / 100).toFixed(2).replace('.', ',') : '' }),
        campo('Dia de renovação', { id: 'diaPadrao', name: 'diaPadrao', type: 'number', min: '1', max: '28', value: p.diaPadrao || 5 })
      ),
      el('div', { class: 'campo' }, el('label', { for: 'tom' }, 'Tom das mensagens com IA'), tom),
      el('h2', {}, 'Você'),
      campo('Seu nome', { id: 'nome', name: 'nome', type: 'text', required: true, value: p.nome }),
      el('p', { class: 'pequeno suave' }, 'E-mail: ' + p.email),
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('p', { class: 'aviso', id: 'salvo', hidden: true }, 'Dados salvos.'),
      botao
    ),
    el('button', { class: 'link', onclick: () => agir(async () => { await api('conta/sair', 'POST', {}); dados = null; }) }, 'Sair da conta'),
  ];
}

// ---------- Montagem ----------

// Ao trocar de aba ou voltar para o app, busca os dados de novo (um aluno pode ter se cadastrado ou pago).
async function trocarAba(id) {
  aba = id;
  erro = '';
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
  const novos = dados.alunos.filter((a) => a.status === 'novo').length;
  const abas = [['renovar', 'A renovar'], ['novos', novos ? `Novos (${novos})` : 'Novos'], ['arte', 'Arte'], ['conta', 'Conta']];
  const conteudo = { renovar: abaRenovar, novos: abaNovos, arte: abaArte, conta: abaConta }[aba];
  montar(
    el('div', {}, el('p', { class: 'suave' }, 'Renova.AI'), el('h1', {}, 'Painel de ' + P())),
    el('nav', { class: 'abas', 'aria-label': 'Seções do painel' },
      abas.map(([id, rotulo]) => el('button', { class: 'aba', 'aria-pressed': String(aba === id), onclick: () => trocarAba(id) }, rotulo))
    ),
    erro && !folha && aba !== 'conta' && el('p', { class: 'erro', role: 'alert' }, erro),
    conteudo(),
    folha && el('div', { class: 'folha-fundo' }, el('div', { class: 'folha', role: 'dialog', 'aria-modal': 'true' }, folha.tipo === 'fila' ? folhaFila() : folhaEdicao()))
  );
}

try {
  await carregar();
  desenhar();
} catch (e) {
  montar(el('h1', {}, 'Não foi possível abrir o painel'), el('p', { class: 'suave' }, e.message));
}
