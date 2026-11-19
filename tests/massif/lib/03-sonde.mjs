// Sonde temporaire de la batterie 03 (à supprimer) : « fetch failed » lors d'une rafale de 25 créations simultanées après un temps mort.
import { demarrerSite } from './env.mjs';
import { creerClients } from './clients.mjs';
import { rng, construireCommande } from './commandes.mjs';

const site = await demarrerSite();
try {
  const clients = await creerClients(25, { concurrence: 25, debut: 9000 });
  for (let tour = 0; tour < 8; tour++) {
    const attente = [100, 6000, 100, 4500, 5200, 100, 5500, 100][tour];
    await new Promise((r) => setTimeout(r, attente));
    const r = rng(tour + 1);
    const res = await Promise.allSettled(clients.map(async (c) => {
      const { body } = construireCommande(r, { mode: 'pickup' });
      const t = Date.now();
      try { return await c.post('order_create.php', body); } catch (e) { e.duree = Date.now() - t; throw e; }
    }));
    const ko = res.filter((x) => x.status === 'rejected');
    const non201 = res.filter((x) => x.status === 'fulfilled' && x.value.status !== 201);
    console.log(`tour ${tour} (attente ${attente} ms) : ${ko.length} échec(s) réseau, ${non201.length} réponse(s) non 201`,
      ko.slice(0, 3).map((x) => `${x.reason.message} cause=${x.reason.cause && (x.reason.cause.code || x.reason.cause.message)} après ${x.reason.duree} ms`).join(' | '),
      non201.slice(0, 2).map((x) => x.value.status + ' ' + x.value.text.slice(0, 100)).join(' | '));
  }
  console.log('journal serveur :', site.journal().trim() || '(vide)');
} finally {
  site.arreter();
}
process.exit(0);
