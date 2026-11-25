// Service worker mínimo: existe para o painel poder ser instalado na tela de início
// e para receber comprovantes compartilhados pelo WhatsApp (Android).
// Não guarda nada em cache, então cada publicação nova aparece na hora.
importScripts('/comprovante/sw-compartilhamento.js');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
