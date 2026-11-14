// Área de administração (/admin): gera um código de recuperação para um personal que perdeu o acesso.
// Só funciona com a chave de administração, guardada como segredo ADMIN_KEY na Cloudflare.
import { api, el, campo, copiar, montar } from './comum.js';

let erro = '';
let resultado = null; // { nome, email, codigo }
let chave = '';

function chaveForte() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => letras[b % letras.length]).join('');
}

function botaoCopiar(texto, rotulo) {
  const botao = el('button', {
    class: 'botao claro menor', type: 'button',
    onclick: async () => {
      botao.textContent = (await copiar(texto)) ? 'Copiado' : 'Selecione e copie o texto acima';
    },
  }, rotulo);
  return botao;
}

function telaResultado() {
  const mensagem =
    `Oi, ${resultado.nome.split(' ')[0]}! Seu novo código de recuperação do Renova.AI é ${resultado.codigo}. ` +
    `Abra ${location.origin}/painel, toque em "Esqueci minha senha" e use esse código para criar uma senha nova.`;
  return [
    el('h1', {}, 'Código gerado'),
    el('p', { class: 'suave' }, `Conta de ${resultado.nome} (${resultado.email}). O código anterior deixou de valer.`),
    el('div', { class: 'cartao escuro centro' },
      el('p', { style: "font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 26px; letter-spacing: 0.06em" }, resultado.codigo)
    ),
    el('p', { class: 'aviso' }, 'Envie somente para o e-mail cadastrado na conta. Quem tiver este código consegue entrar e trocar a chave Pix.'),
    botaoCopiar(resultado.codigo, 'Copiar só o código'),
    botaoCopiar(mensagem, 'Copiar mensagem pronta'),
    el('a', { class: 'botao', href: `mailto:${resultado.email}?subject=${encodeURIComponent('Seu acesso ao Renova.AI')}&body=${encodeURIComponent(mensagem)}` }, 'Abrir e-mail para ' + resultado.email),
    el('button', { class: 'link', onclick: () => { resultado = null; desenhar(); } }, 'Gerar para outra conta'),
  ];
}

function telaFormulario() {
  const sugestao = el('div', { class: 'cartao', hidden: true });
  return [
    el('div', { class: 'coluna', style: 'margin-top: 4vh' },
      el('p', { class: 'pequeno', style: 'font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase' }, 'Renova.AI · Administração'),
      el('h1', {}, 'Recuperar acesso de um personal'),
      el('p', { class: 'suave' }, 'Gera um código de recuperação novo para a conta. Antes, confirme que o pedido veio do e-mail cadastrado.')
    ),
    el('form', {
      class: 'coluna', style: 'gap: 14px',
      onsubmit: async (e) => {
        e.preventDefault();
        erro = '';
        chave = e.target.chave.value;
        try {
          resultado = await api('admin/codigo', 'POST', { chave, email: e.target.email.value });
        } catch (falha) {
          erro = falha.message;
        }
        desenhar();
      },
    },
      campo('Sua chave de administração', { id: 'chave', name: 'chave', type: 'password', required: true, autocomplete: 'off', value: chave }),
      campo('E-mail da conta do personal', { id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'off' }),
      erro && el('p', { class: 'erro', role: 'alert' }, erro),
      el('button', { class: 'botao', type: 'submit' }, 'Gerar código de recuperação')
    ),
    el('button', {
      class: 'link',
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

function desenhar() {
  montar(resultado ? telaResultado() : telaFormulario());
}

desenhar();
