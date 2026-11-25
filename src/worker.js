// Entrada do app na Cloudflare Workers.
// Arquivos de public/ são servidos direto; o que não for arquivo cai aqui.
import { atenderApi } from './api.js';
import { entregarPagina } from '../lib/pagina.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const partes = url.pathname.split('/').filter(Boolean);

    if (partes[0] === 'api') return atenderApi(request, env, partes.slice(1));

    // Comprovante compartilhado pelo WhatsApp (Android). Quem recebe o arquivo é o service worker,
    // no próprio celular; se ele ainda não estiver instalado, o pedido chega aqui. O arquivo não é
    // lido: o personal volta ao painel e escolhe o comprovante por lá.
    if (url.pathname === '/comprovante') {
      return Response.redirect(new URL('/painel?comprovante=reenviar', url).href, 303);
    }

    // Endereços bonitos: /c/<link do personal> e /a/<código do aluno>
    if (request.method === 'GET' && partes.length === 2) {
      if (partes[0] === 'c') return entregarPagina({ request, env }, '/convite');
      if (partes[0] === 'a') return entregarPagina({ request, env }, '/aluno');
    }

    return env.ASSETS.fetch(request);
  },
};
