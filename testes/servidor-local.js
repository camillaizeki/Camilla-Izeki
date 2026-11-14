// Servidor só para testar no computador, com banco em memória. Não é usado na Cloudflare.
// Uso: node testes/servidor-local.js  (abre em http://localhost:8788)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { atenderApi } from '../src/api.js';

const sqlite = new DatabaseSync(':memory:');
const preparar = (sql, valores = []) => ({
  bind: (...v) => preparar(sql, v.map((x) => (x === undefined ? null : x))),
  first: async () => sqlite.prepare(sql).get(...valores) ?? null,
  all: async () => ({ results: sqlite.prepare(sql).all(...valores) }),
  run: async () => ({ meta: { last_row_id: Number(sqlite.prepare(sql).run(...valores).lastInsertRowid) } }),
});
const env = {
  DB: { prepare: (sql) => preparar(sql), batch: async (lista) => Promise.all(lista.map((p) => p.run())) },
  AI: { run: async () => ({ response: 'Mais um mês sobrevivendo aos treinos\nMinhas pernas pediram férias, eu renovei\nTreino em dia, preguiça atrasada' }) },
};
const TIPOS = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json' };

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
