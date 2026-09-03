// Service worker: cache do app para funcionar offline (PWA).
const CACHE = 'fmp-teleprompter-v1';
const ASSETS = [
  './',
  './index.html',
  './remote.html',
  './output.html',
  './css/styles.css',
  './js/app.js',
  './js/prompter.js',
  './js/script-parser.js',
  './js/storage.js',
  './js/i18n.js',
  './js/voice.js',
  './js/camera.js',
  './js/remote.js',
  './js/pip.js',
  './js/ai.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Só trata a própria origem; CDNs (PeerJS, QR) e a API de IA passam direto.
  if (url.origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
