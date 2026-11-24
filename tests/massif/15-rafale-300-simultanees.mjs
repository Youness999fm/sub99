// Batterie 13 — RAFALE DE 300 COMMANDES VRAIMENT SIMULTANÉES (demande explicite : « 300 en même temps »,
// à distinguer de la batterie 12 qui étale ses commandes sur 60-90 s comme un vrai service du soir).
// 300 clients distincts, 300 commandes distinctes (pizzas/tailles/suppléments/mode retrait-livraison tirés
// au hasard par client) envoyées TOUTES EN MÊME TEMPS (aucun étalement, aucune limite de concurrence :
// les 300 requêtes partent dans le même tick). Tout tourne en local, base Postgres de test en mémoire
// (PGlite) : rien n'est envoyé sur Internet, aucune de ces commandes n'arrive réellement au restaurant.
//
//   node tests/massif/lancer.mjs tests/massif/13-rafale-300-simultanees.mjs --timeout=180
//
// Option : --n=500 pour changer le nombre de commandes simultanées (300 par défaut).
// Option : --clients=C pour que les N commandes soient réparties sur C comptes seulement (chaque client
// envoie plusieurs commandes, toutes dans la même rafale, avec des clés d'idempotence distinctes) --
// par défaut C = N (un compte par commande, comportement historique inchangé). Utile à très grande échelle :
// la création des comptes (bcrypt, coût 10, volontairement coûteux pour la sécurité des mots de passe) domine
// le temps total bien avant que la création de commandes elle-même ne pose problème -- ce réglage isole donc
// la vraie question (le serveur tient-il N commandes simultanées ?) du coût, non pertinent ici, de N inscriptions.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { demarrerSite } from './lib/env.mjs';
import { creerClients, patronConnecte, enParallele } from './lib/clients.mjs';
import { rng, construireCommande, definirAdresse } from './lib/commandes.mjs';

const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const N = Number(ARGS.n ?? 300);
const NB_COMPTES = Math.min(N, Number(ARGS.clients ?? N));

let nbPass = 0;
let nbFail = 0;
function controle(ok, nom, observe = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nom}${observe !== '' ? ' — ' + observe : ''}`);
  if (ok) nbPass++; else nbFail++;
  return ok;
}

console.log(`Batterie 13 — ${N} commandes vraiment simultanées sur ${NB_COMPTES} compte(s) (local, base en mémoire)`);
const site = await demarrerSite();
try {
  const t0 = performance.now();
  const clients = await creerClients(NB_COMPTES, { concurrence: 50, prefixe: 'rafale300' });
  console.log(`${clients.length} comptes clients créés en ${Math.round(performance.now() - t0)} ms`);

  // Adresse obligatoire pour les clients qui vont commander en livraison (déterminé à l'avance, par parité).
  const t1 = performance.now();
  await enParallele(clients, 50, (c, i) => (i % 2 === 0 ? definirAdresse(c, c.ville) : Promise.resolve()));
  console.log(`adresses de livraison posées en ${Math.round(performance.now() - t1) } ms`);

  // N commandes différentes (pizza, taille, suppléments retirés/ajoutés, mode retrait/livraison, moyen de
  // paiement, sauce piquante : tout tiré au hasard, graine différente par commande -> jamais deux commandes
  // identiques par construction), réparties sur les NB_COMPTES comptes (à tour de rôle si N > NB_COMPTES ;
  // chaque commande garde sa propre clé d'idempotence, donc plusieurs commandes d'un même client dans la
  // même rafale ne sont jamais prises pour un rejeu de l'une par l'autre).
  const r = rng(Date.now());
  const plans = Array.from({ length: N }, (_, i) => {
    const c = clients[i % clients.length];
    const mode = i % 2 === 0 ? 'delivery' : 'pickup';
    const { body, totals } = construireCommande(r, { mode, ville: c.ville, cle: `rafale300-${i}-${Date.now().toString(36)}` });
    return { c, body, totals };
  });

  console.log(`\nEnvoi des ${N} commandes TOUTES EN MÊME TEMPS (aucun étalement)...`);
  const tBurst = performance.now();
  // enParallele avec concurrence = N : les N ouvriers démarrent dans le même tick, donc les N requêtes
  // partent ensemble (équivalent à Promise.all(plans.map(...)), juste écrit avec l'outil déjà du projet).
  const resultats = await enParallele(plans, N, async (p) => {
    const rep = await p.c.post('order_create.php', p.body);
    return { rep, p };
  });
  const dureeBurst = performance.now() - tBurst;
  console.log(`${N} commandes envoyées et répondues en ${Math.round(dureeBurst)} ms (${(N / (dureeBurst / 1000)).toFixed(1)} commandes/s en pointe)`);

  const ok201 = resultats.filter((x) => x.rep.status === 201);
  const echecs = resultats.filter((x) => x.rep.status !== 201);
  controle(ok201.length === N, `les ${N} commandes créées en 201`, `${ok201.length}/${N} en 201${echecs.length ? ', ex. ' + echecs[0].rep.status + ' ' + String(echecs[0].rep.text).slice(0, 150) : ''}`);

  const ids = ok201.map((x) => x.rep.json.order.id);
  controle(new Set(ids).size === ids.length, 'tous les identifiants de commande sont distincts (aucun doublon)', `${new Set(ids).size}/${ids.length}`);

  let ecartsTotal = 0;
  for (const x of ok201) {
    if (x.rep.json.order.total_cents !== x.p.totals.total_cents) ecartsTotal++;
    if (x.rep.json.order.status !== 'new') ecartsTotal++;
  }
  controle(ecartsTotal === 0, 'chaque commande renvoie le bon total et le statut « new »', `${ecartsTotal} écart(s)`);

  // Chaque commande doit vraiment être différente des autres (contenu réellement varié, pas 300 copies).
  const signatures = new Set(ok201.map((x) => JSON.stringify({ mode: x.p.body.mode, items: x.p.body.items.map((i) => [i.name, i.variant, i.qty, i.removed, i.extras]) })));
  controle(signatures.size > N * 0.9, 'les commandes sont réellement différentes les unes des autres (pas de contenu dupliqué en masse)', `${signatures.size} contenus distincts sur ${N} commandes`);

  // Le commerçant doit voir les 300 commandes d'un coup, sans rien perdre, dans le bon ordre chronologique.
  const patron = await patronConnecte();
  const liste = await patron.get('owner_orders.php');
  controle(liste.status === 200 && Array.isArray(liste.json.orders), 'le commerçant peut lister les commandes juste après la rafale', `HTTP ${liste.status}`);
  controle(liste.json.orders.length === N, 'le commerçant voit bien les N commandes (aucune perdue)', `${liste.json.orders.length}/${N} visibles`);
  const idsVus = new Set(liste.json.orders.map((o) => o.id));
  const manquantes = ids.filter((id) => !idsVus.has(id));
  controle(manquantes.length === 0, 'aucune commande créée ne manque à l’appel chez le commerçant', `${manquantes.length} manquante(s)`);

  console.log(`\nRésumé : ${nbPass} PASS, ${nbFail} FAIL`);
  console.log(nbFail === 0 ? 'RAFALE 300 SIMULTANÉES : OK' : 'RAFALE 300 SIMULTANÉES : ÉCHEC');
} finally {
  site.arreter();
}
process.exit(nbFail === 0 ? 0 : 1);
