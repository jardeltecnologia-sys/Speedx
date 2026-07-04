// =============================================================================
// SPEEDX PASSAGEIRO - SERVICE WORKER (o motor do PWA)
// =============================================================================
// O Service Worker é um "porteiro" entre o app e a internet. Ele permite:
//   1. INSTALAR o app pelo navegador (sem loja de aplicativos!)
//   2. Abrir instantaneamente, mesmo com internet ruim (cache local)
//
// Estratégia: "rede primeiro, cache de socorro" — sempre tenta baixar a
// versão mais nova; se a internet falhar, usa a cópia guardada.
// =============================================================================

// Mude a versão quando os arquivos do app mudarem: o navegador troca o cache
const CACHE = 'speedx-passageiro-v1';

// Tudo que o app precisa para ABRIR (o "esqueleto" do aplicativo)
const ARQUIVOS_DO_APP = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'vendor/socket.io.min.js',
  'manifest.webmanifest',
  'icones/icone-192.png',
  'icones/icone-512.png'
];

// INSTALAÇÃO: guarda o esqueleto do app no cache do navegador
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS_DO_APP))
  );
  self.skipWaiting(); // Ativa a versão nova imediatamente
});

// ATIVAÇÃO: apaga caches de versões antigas do app
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// INTERCEPTAÇÃO: decide de onde vem cada arquivo (rede ou cache)
self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Só cuidamos de downloads simples (GET) do NOSSO site
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Tempo real e API NUNCA passam pelo cache (precisam ser ao vivo!)
  if (url.pathname.includes('/socket.io/') || url.pathname.startsWith('/api/')) return;

  // Rede primeiro; se falhar (offline), serve a cópia do cache
  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        // Guarda uma cópia fresca no cache para a próxima vez
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copia));
        return resposta;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
