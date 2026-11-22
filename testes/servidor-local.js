// Servidor só para testar no computador, com banco em memória. Não é usado na Cloudflare.
// Uso: node testes/servidor-local.js  (abre em http://localhost:8788)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { bancoFalso } from './banco-falso.js';
import { atenderApi } from '../src/api.js';

const env = {
  DB: bancoFalso(),
  ADMIN_KEY: process.env.ADMIN_KEY || 'chave-local-de-teste-1234567890',
  AI: { run: async () => ({ response: 'Mais um mês sobrevivendo aos treinos\nMinhas pernas pediram férias, eu renovei\nTreino em dia, preguiça atrasada' }) },
};

// MP_SIMULADO=1 simula o Mercado Pago: o "pagamento" volta direto ao painel como aprovado.
if (process.env.MP_SIMULADO) {
  const prefs = new Map();
  env.MP_ACCESS_TOKEN = 'APP_USR-simulado-local';
  env.MP_FETCH = async (url, opcoes) => {
    const u = new URL(url);
    const responder = (d) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/v1/payments' && opcoes.method === 'POST') {
      const pag = JSON.parse(opcoes.body);
      // Pix simulado: fica pendente nas duas primeiras conferências e depois aprova.
      prefs.set(pag.external_reference, { items: [{ unit_price: pag.transaction_amount }], conferencias: 0, pix: true });
      return responder({ id: Number(pag.external_reference) + 9000, status: 'pending', point_of_interaction: { transaction_data: {
        qr_code: '00020126580014br.gov.bcb.pix0136simulado-renova-ai520400005303986540' + pag.transaction_amount + '5802BR5925RENOVA AI6009GOIANIA62070503***6304ABCD',
        qr_code_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==' } } });
    }
    if (u.pathname === '/checkout/preferences') {
      const pref = JSON.parse(opcoes.body);
      prefs.set(pref.external_reference, pref);
      return responder({ id: 'pref-' + pref.external_reference, init_point: pref.back_urls.success });
    }
    const ref = u.searchParams.get('external_reference');
    const pref = prefs.get(ref);
    if (pref?.pix && ++pref.conferencias <= 2) return responder({ results: [{ id: Number(ref) + 9000, external_reference: ref, status: 'pending', currency_id: 'BRL', transaction_amount: pref.items[0].unit_price }] });
    return responder({ results: pref ? [{ id: Number(ref) + 9000, external_reference: ref, status: 'approved', currency_id: 'BRL', transaction_amount: pref.items[0].unit_price, installments: 1 }] : [] });
  };
}
const TIPOS = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:8788');
    try {
      if (url.pathname.startsWith('/api/')) {
        const partes = [];
        for await (const p of req) partes.push(p);
        const corpo = Buffer.concat(partes);
        const request = new Request(url, { method: req.method, headers: req.headers, body: corpo.length ? corpo : undefined });
        const r = await atenderApi(request, env, url.pathname.slice(5).split('/'));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      let arquivo = url.pathname;
      if (arquivo.startsWith('/c/')) arquivo = '/convite.html';
      else if (arquivo.startsWith('/a/')) arquivo = '/aluno.html';
      else if (arquivo === '/') arquivo = '/index.html';
      else if (!arquivo.includes('.')) arquivo += '.html';
      const dados = await readFile(new URL('../public' + arquivo, import.meta.url));
      res.writeHead(200, { 'content-type': TIPOS[arquivo.split('.').pop()] || 'application/octet-stream' });
      res.end(dados);
    } catch {
      res.writeHead(404).end('Não encontrado');
    }
  })
  .listen(8788, () => console.log('Renova.AI local em http://localhost:8788'));
