// Test de charge local : 100 commandes finalisées en 60 secondes (données synthétiques).
// Isolé : base SQLite neuve dans un dossier temporaire, serveur PHP intégré sur 127.0.0.1, aucun
// service externe, aucune donnée réelle. Mesure le chemin « commande reçue » de l'API seulement.
// Ce test NE démontre PAS la capacité de l'hébergement OVH (MySQL mutualisé) : il le dit dans le rapport.
//
// Usage :  node tests/capacite/capacite.mjs
// Sortie : résumé dans la console + fichier JSON dans le dossier temporaire du test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { appel, cookieDe, demarrerServeurTest, PROPRIETAIRE, sleep } from '../lib/serveur-test.mjs';

const CLIENTS = 10;
const COMMANDES = 100;
const FENETRE_MS = 60000;
const INTERVALLE_MS = FENETRE_MS / COMMANDES;

function percentile(valeurs, p) {
  if (!valeurs.length) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const index = Math.min(triees.length - 1, Math.ceil((p / 100) * triees.length) - 1);
  return triees[Math.max(0, index)];
}

const serveur = await demarrerServeurTest({ nom: 'capacite' });
const resultat = { date: new Date().toISOString(), commandesVisees: COMMANDES, fenetreSecondes: FENETRE_MS / 1000, clients: CLIENTS, serveur: 'PHP intégré + SQLite (local)' };

try {
  // 1. Clients synthétiques, insérés directement dans la base de test. Pas d'inscription : la limite
  //    d'inscriptions par IP de l'API ne doit ni être contournée ni consommée par ce test. Chaque client
  //    reçoit une vraie session (jeton aléatoire ; seul son hachage SHA-256 est stocké, comme l'API le fait).
  const base = new DatabaseSync(serveur.dbFile);
  const dateUtc = (d) => d.toISOString().slice(0, 19) + 'Z';
  const insertClient = base.prepare('INSERT INTO customers (email, password_hash, first_name, last_name, phone, street, city, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)');
  const insertSession = base.prepare('INSERT INTO sessions (token_hash, user_type, user_id, remember, created_at, last_seen_at, expires_at, revoked_at, device) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, ?)');
  const cookies = [];
  for (let i = 0; i < CLIENTS; i += 1) {
    const num = String(i + 1).padStart(2, '0');
    const maintenant = dateUtc(new Date());
    const expiration = dateUtc(new Date(Date.now() + 30 * 24 * 3600 * 1000));
    const { lastInsertRowid } = insertClient.run(`charge${num}@example.test`, '!non-connectable', 'Test', 'Charge' + num, '06 00 00 00 ' + num, '1 rue de test', 'Hénin-Beaumont', maintenant, maintenant);
    const jeton = randomBytes(32).toString('base64url');
    insertSession.run(createHash('sha256').update(jeton).digest('hex'), 'customer', Number(lastInsertRowid), maintenant, maintenant, expiration, 'capacite');
    cookies.push('subito_customer=' + jeton);
  }
  base.close();

  // 2. Une commande par intervalle, réparties sur 60 s, en rotation sur les clients.
  const debut = Date.now();
  const envois = [];
  const erreurs = [];
  const latences = [];
  let reussies = 0;

  async function envoyer(index) {
    const cookie = cookies[index % CLIENTS];
    const corps = {
      idempotency_key: crypto.randomUUID(),
      mode: 'pickup',
      payment_methods: [],
      cash_change_for: null,
      items: [{
        name: 'Végétarienne',
        variant: 'Solo',
        qty: 1,
        unit_price_cents: 1100,
        removed: [],
        extras: [],
        half: null,
        note: '',
      }],
      delivery_fee_cents: 0,
      total_cents: 1100,
    };
    const t0 = performance.now();
    try {
      const r = await appel('order_create.php', { methode: 'POST', corps, cookie });
      const duree = performance.now() - t0;
      latences.push(duree);
      if (r.status === 201 && r.data && r.data.ok === true) {
        reussies += 1;
      } else {
        erreurs.push({ index, status: r.status, texte: r.texte.slice(0, 200) });
      }
    } catch (error) {
      latences.push(performance.now() - t0);
      erreurs.push({ index, erreur: String(error.message || error) });
    }
  }

  for (let i = 0; i < COMMANDES; i += 1) {
    const cible = debut + i * INTERVALLE_MS;
    const attente = cible - Date.now();
    if (attente > 0) await sleep(attente);
    envois.push(envoyer(i));
  }
  await Promise.all(envois);
  const duree = (Date.now() - debut) / 1000;

  // 3. Contrôle côté propriétaire : toutes les commandes doivent être visibles.
  const login = await appel('owner_login.php', { methode: 'POST', corps: { email: PROPRIETAIRE.email, password: PROPRIETAIRE.password, remember: false } });
  if (login.status !== 200) throw new Error('Connexion propriétaire de test impossible : ' + login.status);
  const ownerCookie = 'subito_owner=' + cookieDe(login.res, 'subito_owner');
  const liste = await appel('owner_orders.php', { cookie: ownerCookie });
  const visibles = liste.data && Array.isArray(liste.data.orders) ? liste.data.orders.length : -1;

  resultat.commandesReussies = reussies;
  resultat.erreurs = erreurs.length;
  resultat.detailErreurs = erreurs.slice(0, 5);
  resultat.dureeEnvoisSecondes = Number(duree.toFixed(1));
  resultat.latenceMs = {
    mediane: Number((percentile(latences, 50) || 0).toFixed(1)),
    p95: Number((percentile(latences, 95) || 0).toFixed(1)),
    max: Number((Math.max(...latences, 0)).toFixed(1)),
  };
  resultat.commandesVisiblesCoteProprietaire = visibles;
  resultat.verdict = reussies === COMMANDES && erreurs.length === 0 && visibles >= COMMANDES
    ? 'PASS : 100 commandes enregistrées et visibles, sans erreur (environnement local)'
    : 'FAIL : voir les détails';
  resultat.limite = 'Capacité de production non démontrée : pas de MySQL OVH, pas de charge réseau réelle.';
} catch (error) {
  resultat.verdict = 'ERREUR DU TEST : ' + (error.message || error);
} finally {
  serveur.stop();
}

const fichier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'subito-capacite-resultat-')), 'capacite.json');
fs.writeFileSync(fichier, JSON.stringify(resultat, null, 2), 'utf8');
console.log(JSON.stringify(resultat, null, 2));
console.log('Résultat écrit dans : ' + fichier);
process.exitCode = resultat.verdict.startsWith('PASS') ? 0 : 1;
