// =============================================================================
// SPEEDX MOTORISTA - SERVICE WORKER (o motor do PWA)
// =============================================================================
// Mesmo mecanismo do app do passageiro: permite instalar pelo navegador e
// abrir rápido mesmo com internet fraca. Ver comentários detalhados no
// sw.js do app do passageiro.
// =============================================================================

const CACHE = 'speedx-motorista-v2';

const ARQUIVOS_DO_APP = [
  './',
  'index.html',
  'css/tokens.css',
  'css/components.css',
  'css/app.css',
  'js/app.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'vendor/socket.io.min.js',
  'manifest.webmanifest',
  'icones/icone-192.png',
  'icones/icone-512.png'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS_DO_APP))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/socket.io/') || url.pathname.startsWith('/api/')) return;

  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copia));
        return resposta;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
