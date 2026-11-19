// Contrôle du socle des tests massifs : 100 clients, 100 commandes de tous types en rafale, statuts jusqu'à « prête »,
// puis une page de suivi réelle dans Chrome qui doit se mettre à jour toute seule.
//   $env:SUBITO_TEST_PORT='18500'; node tests/massif/00-socle.mjs
import assert from 'node:assert/strict';
import { demarrerSite } from './lib/env.mjs';
import { creerClients, patronConnecte, enParallele } from './lib/clients.mjs';
import { rng, construireCommande, definirAdresse } from './lib/commandes.mjs';
import { avecNavigateur } from './lib/chrome.mjs';

const site = await demarrerSite();
const t0 = Date.now();
try {
  const clients = await creerClients(100, { concurrence: 25 });
  console.log(`100 comptes créés en ${Date.now() - t0} ms`);
  await enParallele(clients, 25, (c) => definirAdresse(c, c.ville));

  const r = rng(42);
  const t1 = Date.now();
  const resultats = await enParallele(clients, 50, async (c, i) => {
    const mode = i % 2 === 0 ? 'pickup' : 'delivery';
    const { body, totals } = construireCommande(r, { mode, ville: c.ville });
    const rep = await c.post('order_create.php', body);
    return { rep, totals, mode, c };
  });
  const echecs = resultats.filter((x) => x.rep.status !== 201);
  console.log(`100 commandes envoyées en ${Date.now() - t1} ms ; refus : ${echecs.length}`);
  for (const e of echecs.slice(0, 5)) console.log('  refus', e.mode, e.c.ville, e.rep.status, e.rep.text.slice(0, 200));
  assert.equal(echecs.length, 0, 'toutes les commandes valides doivent être acceptées');
  for (const x of resultats) assert.equal(x.rep.json.order.total_cents, x.totals.total_cents);

  const patron = await patronConnecte();
  const liste = await patron.get('owner_orders.php');
  assert.equal(liste.json.orders.length, 100);

  // Une page de suivi réelle reste ouverte pendant que le patron change le statut.
  const cible = resultats[0];
  const id = cible.rep.json.order.id;
  await avecNavigateur(async (nav) => {
    const page = await nav.ouvrirPage(`${site.base}/commande.html?id=${id}`, { cookies: cible.c });
    await page.waitFor("document.getElementById('orderTrackBody') && document.getElementById('orderTrackBody').getAttribute('data-order-status') === 'new'", 10000);
    await patron.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 });
    const t2 = Date.now();
    await page.waitFor("document.getElementById('orderTrackBody').getAttribute('data-order-status') === 'accepted'", 15000);
    console.log(`page client : « acceptée » apparue sans rechargement après ${Date.now() - t2} ms`);
    await patron.post('owner_order_decide.php', { id, action: 'ready' });
    const t3 = Date.now();
    await page.waitFor("document.getElementById('orderTrackBody').getAttribute('data-order-status') === 'ready'", 15000);
    console.log(`page client : « prête » apparue sans rechargement après ${Date.now() - t3} ms`);
    const texte = await page.evaluate("document.getElementById('orderTrackBody').textContent");
    assert.match(texte, /Votre commande est prête/);
    console.log('erreurs de la page :', page.erreurs.length ? page.erreurs : 'aucune');
    await page.fermer();
  });
  console.log('journal serveur :', site.journal().trim() || '(vide)');
  console.log('SOCLE OK');
} finally {
  site.arreter();
}
process.exit(0);
