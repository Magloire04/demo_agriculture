// Service worker : garde l'interface en cache pour qu'elle s'ouvre même sans réseau.
// Les appels à l'API (/api/...) passent toujours par le réseau.

const CACHE = 'agrifon-v6';
const FICHIERS = [
  './',
  'index.html',
  'conseiller.html',
  'manifest.webmanifest',
  'css/app.css',
  'css/polices.css',
  'js/app.js',
  'js/dom.js',
  'js/enregistreur.js',
  'js/voix.js',
  'js/conseiller.js',
  'img/logo-agrifon.svg',
  'icons/icone.svg',
  'icons/icone-192.png',
  'fonts/montserrat-latin-300-normal.woff2',
  'fonts/montserrat-latin-400-normal.woff2',
  'fonts/montserrat-latin-600-normal.woff2',
  'fonts/montserrat-latin-700-normal.woff2',
  'fonts/montserrat-latin-ext-300-normal.woff2',
  'fonts/montserrat-latin-ext-400-normal.woff2',
  'fonts/montserrat-latin-ext-600-normal.woff2',
  'fonts/montserrat-latin-ext-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((cle) => cle !== CACHE).map((cle) => caches.delete(cle))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord (pour avoir la dernière version pendant la démo), cache en secours.
self.addEventListener('fetch', (e) => {
  const requete = e.request;
  const url = new URL(requete.url);
  if (requete.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  e.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(async () => {
        const enCache = await caches.match(requete, { ignoreSearch: requete.mode === 'navigate' });
        if (enCache) return enCache;
        if (requete.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      }),
  );
});
