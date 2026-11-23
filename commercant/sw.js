/* Espace commerçant — service worker.
   Ne met PLUS rien en cache (voir v3 ci-dessous) : gère seulement le clic sur une notification. Toute
   requête (coquille HTML/JS/CSS comme /api/) passe directement au réseau, jamais de repli sur une
   réponse mise en cache. Pas de push. */
'use strict';

// v3 (23/11/2026) : la mise en cache réseau-d'abord-repli-cache de la coquille (v1/v2) a fini par causer
// exactement le problème qu'elle devait éviter — sur un appareil où le fetch() réseau DANS le service
// worker échoue (même brièvement, même si la page elle-même et l'API fonctionnent très bien juste à côté,
// cas vécu avec une icône « ajoutée à l'écran d'accueil »), le repli servait silencieusement une ancienne
// version mise en cache de index.html/commercant.js, sans la moindre erreur visible — un ajout ou une
// annulation pouvait alors rester invisible indéfiniment malgré un correctif réellement déployé et
// vérifié côté serveur. Le bump de version seul (comme pour passer de v1 à v2) ne suffit qu'à purger
// l'ancien cache une fois la mise à jour reçue ; il ne protège pas contre un nouveau cache qui redeviendrait
// stale de la même façon. Plus aucune mise en cache de la coquille : plus aucun risque de ce genre, au prix
// de perdre le support hors-ligne de la coquille (sans valeur ici : l'appli dépend de toute façon de l'API
// en continu, hors-ligne elle ne peut déjà plus rien faire d'utile).
const CACHE = 'subito-commercant-v3';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('subito-commercant-')).map(k => caches.delete(k))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('subito-commercant-')).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
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
