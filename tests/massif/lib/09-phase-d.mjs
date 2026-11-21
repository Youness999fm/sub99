// Phase D — navigateur réel : la tablette du patron, le suivi client et « Mon compte » affichent les textes
// créés par la phase C (noms, rue, remarques XSS). Rien ne doit jamais s'exécuter : chaque page est auditée
// avec auditer() (lib/09-navigateur.mjs), qui détecte window.__pwn, les attributs d'événement, les balises
// dangereuses injectées, les liens javascript: et les boîtes de dialogue natives. Un budget de 4 onglets au
// plus (voir avecNavigateur(..., { pagesMax: 4 }) dans le fichier principal).
import { ClientIP, ipFictive } from './clients.mjs';
import { ouvrir, auditer, erreursPage, purgerErreurs } from './09-navigateur.mjs';
import { controle, detail, phase } from './09-verifs.mjs';

export async function phaseNavigateur({ nav, site, donnees, patron, clients, cleOrdre, commandeLivraison }) {
  phase('D · Navigateur réel : tablette, suivi, Mon compte (rien ne s\'exécute)');
  const crees = (donnees && donnees.crees) || [];
  if (!crees.length) { controle('D · au moins un client XSS créé en phase C (sinon rien à vérifier ici)', false, 'phase C vide ou non exécutée'); return; }

  // D1 : tablette du patron — la file affiche les commandes (noms, remarques) des clients XSS de la phase C.
  {
    const p = await ouvrir(nav, site.base + '/commercant/', { cookies: patron(), largeur: 820, hauteur: 1180 });
    await p.waitFor("document.querySelector('#queue') || document.querySelector('.login')", 8000, 60).catch(() => {});
    const anomalies = await auditer(p, ['#app', '#queue', '#decision', '#dlg'], { scriptsAttendus: 0 });
    const erreurs = erreursPage(p);
    controle('D1 · tablette du patron : aucune exécution ni attribut dangereux (noms/remarques XSS affichés)', anomalies.length === 0, anomalies.slice(0, 5).join(' ; '));
    controle('D1 · tablette du patron : aucune erreur console imprévue', erreurs.length === 0, erreurs.slice(0, 3).join(' ; '));
    purgerErreurs(p);
  }

  // D2 : suivi client d'une commande passée par un client XSS (si la phase C en a créé au moins une).
  {
    const idCmd = donnees.premiereCommandeId;
    if (idCmd) {
      const c0 = crees[0];
      const visiteur = new ClientIP('xss-suivi', ipFictive(970001));
      await visiteur.post('customer_login.php', { email: c0.email, password: c0.password }).catch(() => {});
      const p = await ouvrir(nav, site.base + '/commande.html?id=' + idCmd, { cookies: visiteur });
      await p.waitFor("document.querySelector('.order-track-number')", 8000, 60).catch(() => {});
      // Racine #orderTrackBody (zone rendue dynamiquement, nom/remarque du client) : évite le <img> du logo statique
      // dans le <header>, qui n'a rien à voir avec l'injection testée ici.
      const anomalies = await auditer(p, ['#orderTrackBody'], { scriptsAttendus: 0 });
      const erreurs = erreursPage(p);
      controle('D2 · page de suivi d\'une commande XSS : aucune exécution ni attribut dangereux', anomalies.length === 0, anomalies.slice(0, 5).join(' ; '));
      controle('D2 · page de suivi : aucune erreur console imprévue', erreurs.length === 0, erreurs.slice(0, 3).join(' ; '));
      purgerErreurs(p);
    } else {
      controle('D2 · page de suivi d\'une commande XSS', false, 'aucune commande XSS disponible (phase C)');
    }
  }

  // D3 : « Mon compte » de deux clients XSS représentatifs (prénom/nom affichés bien en vue).
  const echantillon = crees.filter((c) => c.id === 'script' || c.id === 'svg');
  for (const c of (echantillon.length ? echantillon : crees.slice(0, 2))) {
    const visiteur = new ClientIP('xss-compte-' + c.id, ipFictive(970010 + echantillon.indexOf(c)));
    const l = await visiteur.post('customer_login.php', { email: c.email, password: c.password }).catch(() => null);
    if (!l || l.status !== 200) { controle(`D3 · Mon compte (${c.id}) : connexion`, false, `statut ${l && l.status}`); continue; }
    const p = await ouvrir(nav, site.base + '/compte.html', { cookies: visiteur });
    await p.waitFor("document.querySelector('#accountName')", 8000, 60).catch(() => {});
    // Racines ciblant uniquement le texte rendu depuis les données du client (nom, e-mail, prénom/nom/téléphone/adresse,
    // historique des commandes) : évite le <img> du logo et les <form>/<input> légitimes de connexion/édition du profil,
    // qui existent sur cette page indépendamment de toute injection.
    const anomalies = await auditer(p, ['#accountName', '#accountEmail', '#profileView', '#accountOrders'], { scriptsAttendus: 0 });
    const erreurs = erreursPage(p);
    controle(`D3 · Mon compte (${c.id}) : aucune exécution ni attribut dangereux`, anomalies.length === 0, anomalies.slice(0, 5).join(' ; '));
    controle(`D3 · Mon compte (${c.id}) : aucune erreur console imprévue`, erreurs.length === 0, erreurs.slice(0, 3).join(' ; '));
    purgerErreurs(p);
  }
}
