// Entrega uma página estática para um endereço bonito, como /c/rafa ou /a/abc123.
export async function entregarPagina({ request, env }, caminho) {
  const destino = new URL(caminho, request.url);
  let resposta = await env.ASSETS.fetch(new Request(destino, { headers: request.headers }));
  // A Cloudflare pode redirecionar "/pagina.html" para "/pagina"; seguimos uma vez.
  if (resposta.status >= 300 && resposta.status < 400 && resposta.headers.get('location')) {
    const novo = new URL(resposta.headers.get('location'), destino);
    resposta = await env.ASSETS.fetch(new Request(novo, { headers: request.headers }));
  }
  return resposta;
}
