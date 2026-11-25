// Renova.AI · Recebe comprovantes compartilhados pelo WhatsApp (Android)
//
// Carregado pelo /sw.js com importScripts.
//
// O arquivo compartilhado fica no cache do próprio celular só até a página
// abrir e ler; a página apaga em seguida. Nada vai para o servidor.

const RNV_CACHE_COMPARTILHADO = 'renova-comprovantes-compartilhados';
const RNV_ROTA_COMPARTILHAR = '/comprovante';
// Página do personal que abre o leitor.
const RNV_PAGINA_DESTINO = '/painel';
const RNV_LIMITE_ARQUIVOS = 10;
const RNV_TAMANHO_MAXIMO = 10 * 1024 * 1024;

function rnvDestino(marca) {
  const url = new URL(RNV_PAGINA_DESTINO, self.location.origin);
  url.searchParams.set('comprovante', marca);
  return url.href;
}

async function rnvReceberCompartilhamento(request) {
  try {
    const form = await request.formData();
    const arquivos = form.getAll('arquivos')
      .filter((f) => f && typeof f === 'object' && f.size > 0 && f.size <= RNV_TAMANHO_MAXIMO)
      .slice(0, RNV_LIMITE_ARQUIVOS);
    await caches.delete(RNV_CACHE_COMPARTILHADO); // sobras de um compartilhamento anterior
    if (!arquivos.length) return Response.redirect(rnvDestino('reenviar'), 303);
    const cache = await caches.open(RNV_CACHE_COMPARTILHADO);
    await Promise.all(arquivos.map((f, i) => cache.put(
      `/__comprovante-compartilhado/${i}`,
      new Response(f, {
        headers: {
          'Content-Type': f.type || 'application/octet-stream',
          'X-Nome': encodeURIComponent(f.name || `comprovante-${i + 1}`),
        },
      }),
    )));
    return Response.redirect(rnvDestino('compartilhado'), 303);
  } catch {
    return Response.redirect(rnvDestino('reenviar'), 303);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === RNV_ROTA_COMPARTILHAR) {
    event.respondWith(rnvReceberCompartilhamento(event.request));
  }
});
