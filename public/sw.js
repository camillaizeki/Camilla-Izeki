// Service worker mínimo: só existe para o painel poder ser instalado na tela de início.
// Não guarda nada em cache, então cada publicação nova aparece na hora.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
