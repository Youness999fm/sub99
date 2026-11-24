/* Site public — service worker.
   Met en cache uniquement la coquille statique (réseau d'abord, cache en secours) : nécessaire pour
   que Chrome/Android propose l'installation (bouton « Installer » du site, voir assets/js/main.js).
   Les réponses de /api/ ne passent jamais par le cache. Pas de push. */
'use strict';

// v2 (audit perf du 24/11/2026) : la coquille référençait encore les fichiers non minifiés
// (style.css, cart.js...) — les pages chargent désormais leurs .min.* (tools/minify-assets.mjs),
// donc l'ancienne liste ne correspondait plus à rien de réellement chargé. Le bump de version
// fait nettoyer l'ancien cache par le handler activate ci-dessous.
const CACHE = 'subito-site-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/style.min.css',
  '/assets/css/cart.min.css',
  '/assets/js/main.min.js',
  '/assets/js/cart.min.js',
  '/assets/js/icons.min.js'
];
const SHELL_PATHS = new Set(SHELL);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(results => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') console.warn('Mise en cache impossible : ' + SHELL[i] + ' — ' + (r.reason && r.reason.message ? r.reason.message : String(r.reason)));
        });
      })
      .catch(e => console.warn('Cache du service worker indisponible : ' + (e && e.message ? e.message : String(e))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('subito-site-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // Le chemin seul décide (pas la query string) : un lien/script versionné (?v=...) sur un
  // fichier de la coquille reste mis en cache par son pathname, comme avant le versionnage.
  if (!SHELL_PATHS.has(url.pathname)) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(url.pathname, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(url.pathname).then(hit => hit || Response.error()))
  );
});
