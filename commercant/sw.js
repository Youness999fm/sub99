/* Espace commerçant — service worker.
   Met en cache uniquement la coquille statique de la page (réseau d'abord, cache en secours).
   Les réponses de /api/ ne passent jamais par le cache. Pas de push. */
'use strict';

// v2 (22/11/2026) : bump délibéré pour forcer la purge de l'ancien cache (activate() supprime toute clé
// « subito-commercant-* » différente de CACHE) sur les appareils restés ouverts depuis avant cette mission —
// la coquille réseau-d'abord protège déjà des nouveaux déploiements, mais ne corrige pas un cache déjà
// écrit avec une version de index.html/commercant.js antérieure à l'ajout des fonctionnalités d'annulation
// et d'ajout d'article.
const CACHE = 'subito-commercant-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  '../assets/css/commercant.css',
  '../assets/js/commercant.js'
];
const SHELL_PATHS = new Set(SHELL.map(p => new URL(p, self.location).pathname));

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
      .then(keys => Promise.all(keys.filter(k => k.startsWith('subito-commercant-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) return;
  if (!SHELL_PATHS.has(url.pathname) || url.search) return;

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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const scope = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const tab = list.find(c => c.url.startsWith(scope));
      if (tab && 'focus' in tab) return tab.focus();
      return self.clients.openWindow ? self.clients.openWindow(scope) : undefined;
    })
  );
});
