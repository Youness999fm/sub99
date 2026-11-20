// Politique de connexion (verrou par IP seulement), profil client, recherche clients en POST,
// horloge de test (expirations de sessions et de verrou). Version JavaScript de tests/api/politique.test.mjs.
// Lancer depuis la racine du dépôt :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/politique.test.mjs
// Ce fichier prend le port SUBITO_TEST_PORT + 1 (18431 ici) pour ne pas gêner le serveur de api.test.mjs
// lancé en parallèle par node --test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import http from 'node:http';
import path from 'node:path';
import { throttleIpKey } from '../../serveur/throttle.js';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 1);
const { PORT, ORIGIN, OWNER_CODE, SUPER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer, responses, secretScanText } = await import('./lib/harness.mjs');

// Mot de passe client de test généré à l'exécution (jamais écrit en clair dans le dépôt).
const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';
const CUSTOMER_PASSWORD = randomPassword();

const HOUR = 3600;
const DAY = 86400;
const IP_A = '127.0.0.1';
const IP_B = '127.0.0.2'; // autre adresse de bouclage : adresse source distincte vue par le serveur

let ctx;
let server;
let db;
let clockFile;
let clock = Math.floor(Date.now() / 1000);

/** Avance l'horloge de test (fichier relu par serveur/horloge.js à chaque appel de maintenantEpoch()). */
function setClock(epoch) {
  assert.ok(epoch >= clock, 'horloge monotone');
  clock = epoch;
  writeFileSync(clockFile, String(epoch));
}

/** Client HTTP dont on choisit l'adresse source (même boîte à cookies que le Client du harnais). */
class IpClient extends Client {
  constructor(name, ip = IP_A) {
    super(name);
    this.ip = ip;
  }

  request(method, route, { body, raw, headers = {}, origin } = {}) {
    const h = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', ...headers };
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (origin !== undefined) {
      if (origin !== null) h.Origin = origin;
    } else if (method !== 'GET') {
      h.Origin = ORIGIN;
    }
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    }
    if (payload !== undefined) h['Content-Length'] = Buffer.byteLength(payload);
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: PORT, path: '/api/' + route, method, headers: h, localAddress: this.ip, agent: false,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const hs = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            for (const one of Array.isArray(v) ? v : [v]) hs.append(k, String(one));
          }
          this.storeCookies(hs);
          let json = null;
          try { json = JSON.parse(text); } catch { /* contrôlé plus bas */ }
          const r = { status: res.statusCode, headers: hs, text, json, setCookies: this.lastSetCookies, route, method };
          responses.push(r);
          resolve(r);
        });
      });
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
  assert.equal(typeof r.json?.message, 'string');
}

const ownerLogin = (client, code = OWNER_CODE, remember = false) =>
  client.post('owner_login.php', { code, remember });

const signupBody = (over = {}) => ({
  first_name: 'Léo', last_name: 'Démo', email: 'leo@example.test', phone: '06 00 00 00 01',
  password: CUSTOMER_PASSWORD, street: '1 rue de l\'exemple', city: 'Rouvroy', ...over,
});

before(async () => {
  ctx = makeEnv();
  clockFile = path.join(ctx.dir, 'horloge.txt');
  writeFileSync(clockFile, String(clock));
  ctx.env.SUBITO_TEST_CLOCK_FILE = clockFile;
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  db = openTestDb(ctx);
  // Sous Windows, deux « php -S » peuvent écouter le même port : refuser un port déjà servi
  // (autre exécution en parallèle), sinon les requêtes se mélangent entre deux bases.
  const busy = await fetch(`http://127.0.0.1:${PORT}/api/availability.php`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.text().then(() => true), () => false);
  assert.equal(busy, false, `port ${PORT} déjà utilisé : une autre exécution des tests est en cours`);
  server = await startServer(ctx);
});

after(() => {
  stopServer(server);
  try { db?.close(); } catch { /* déjà fermée */ }
});

// ---------------------------------------------------------------- 1. verrou par IP seulement
test('1. connexion : verrou par adresse IP, aucun verrou par e-mail', async (t) => {
  await t.test('les deux adresses de bouclage sont bien distinctes côté serveur', async () => {
    const x = new IpClient('sonde', IP_B);
    expectError(await ownerLogin(x, 'mauvais'), 401, 'invalid_credentials');
    const row = db.prepare("SELECT bucket, attempts FROM throttle WHERE bucket = 'owner_login:ip:127.0.0.2'").get();
    assert.equal(row?.attempts, 1);
    assert.equal((await ownerLogin(x)).status, 200);
  });

  await t.test('propriétaire : 429 à la 6e tentative depuis une IP, succès depuis une autre IP', async () => {
    const attacker = new IpClient('attaquant', IP_A);
    for (let i = 1; i <= 5; i++) expectError(await ownerLogin(attacker, 'mauvais-' + i), 401, 'invalid_credentials');
    const sixth = await ownerLogin(attacker, 'mauvais-6');
    expectError(sixth, 429, 'too_many_attempts');
    assert.equal(sixth.json.message, 'Trop de tentatives. Réessayez plus tard.');
    assert.ok(sixth.json.retry_after_seconds > 0 && sixth.json.retry_after_seconds <= 900);
    assert.equal(sixth.headers.get('retry-after'), String(sixth.json.retry_after_seconds));
    // Même le bon mot de passe est refusé depuis l'IP verrouillée.
    const locked = await ownerLogin(new IpClient('meme-ip', IP_A));
    expectError(locked, 429, 'too_many_attempts');
    assert.equal(locked.setCookies.length, 0);
    // Le propriétaire, depuis une autre adresse, se connecte avec le même e-mail.
    const owner = new IpClient('proprietaire', IP_B);
    const ok = await ownerLogin(owner);
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await owner.get('owner_me.php')).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket LIKE '%email%'").get().n, 0);
  });

  await t.test('le verrou IP de 15 minutes expire', async () => {
    const t0 = clock; // le verrou a été posé à la 5e tentative, à t0
    setClock(t0 + 899);
    const still = await ownerLogin(new IpClient('a1', IP_A));
    expectError(still, 429, 'too_many_attempts');
    assert.equal(still.json.retry_after_seconds, 1);
    setClock(t0 + 901);
    const ok = await ownerLogin(new IpClient('a2', IP_A));
    assert.equal(ok.status, 200, ok.text);
    // Fenêtre expirée : la tentative ouvre une fenêtre neuve, la réussite est décomptée.
    assert.equal(Number(db.prepare("SELECT attempts FROM throttle WHERE bucket = 'owner_login:ip:127.0.0.1'").get().attempts), 0);
  });

  await t.test('client : 429 depuis une IP, succès depuis une autre IP avec le même e-mail', async () => {
    const s = await new IpClient('inscription', IP_B).post('customer_signup.php', signupBody());
    assert.equal(s.status, 201, s.text);
    const attacker = new IpClient('attaquant-client', IP_A);
    for (let i = 1; i <= 5; i++) {
      expectError(await attacker.post('customer_login.php', { email: 'leo@example.test', password: 'mauvais-' + i }), 401, 'invalid_credentials');
    }
    expectError(await attacker.post('customer_login.php', { email: 'leo@example.test', password: CUSTOMER_PASSWORD }), 429, 'too_many_attempts');
    const ok = await new IpClient('leo', IP_B).post('customer_login.php', { email: 'leo@example.test', password: CUSTOMER_PASSWORD });
    assert.equal(ok.status, 200, ok.text);
    // Le verrou client n'atteint pas la connexion propriétaire (seaux séparés).
    assert.equal((await ownerLogin(new IpClient('p', IP_A))).status, 200);
    // Libère l'IP A pour la suite : fin du verrou client.
    setClock(clock + 901);
    assert.equal((await new IpClient('leo2', IP_A).post('customer_login.php', { email: 'leo@example.test', password: CUSTOMER_PASSWORD })).status, 200);
  });

  await t.test('une connexion réussie à son propre compte ne remet pas le compteur IP à zéro', async () => {
    // Un client (Léo) tente le mot de passe d'un autre compte, puis se connecte au sien.
    const ip = '127.0.0.3';
    const bucket = 'customer_login:ip:' + ip;
    const attempts = () => Number(db.prepare('SELECT attempts FROM throttle WHERE bucket = ?').get(bucket)?.attempts ?? 0);
    const v = await new IpClient('victime', IP_B).post('customer_signup.php', signupBody({ email: 'victime@example.test', first_name: 'Vic' }));
    assert.equal(v.status, 201, v.text);
    const leo = new IpClient('leo-curieux', ip);
    const guess = (i) => leo.post('customer_login.php', { email: 'victime@example.test', password: 'devine-' + i });
    for (let i = 1; i <= 4; i++) expectError(await guess(i), 401, 'invalid_credentials');
    assert.equal(attempts(), 4);
    const own = await leo.post('customer_login.php', { email: 'leo@example.test', password: CUSTOMER_PASSWORD });
    assert.equal(own.status, 200, own.text);
    assert.equal(attempts(), 4, 'la réussite ne remet pas le compteur à zéro');
    expectError(await guess(5), 401, 'invalid_credentials'); // 5e échec : verrou
    expectError(await guess(6), 429, 'too_many_attempts');
    expectError(await leo.post('customer_login.php', { email: 'leo@example.test', password: CUSTOMER_PASSWORD }), 429, 'too_many_attempts');
  });

  await t.test('IPv6 : deux adresses du même /64 partagent le même seau', () => {
    const key = throttleIpKey; // fonction JavaScript de serveur/throttle.js (en PHP : throttle_ip_key)
    const a = key('2001:db8:1:2::1');
    assert.equal(a, '2001:0db8:0001:0002::/64');
    assert.equal(key('2001:0DB8:0001:0002:ffff:ffff:ffff:fffe'), a);
    assert.equal(key('2001:db8:1:2:abcd::42'), a);
    assert.notEqual(key('2001:db8:1:3::1'), a);
    assert.equal(key('203.0.113.7'), '203.0.113.7');
    assert.equal(key('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(key('pas-une-ip'), 'unknown');
  });
});

// ---------------------------------------------------------------- 2. durées de session (horloge de test)
test('2. sessions : expiration selon l\'horloge de test', async (t) => {
  await t.test('propriétaire sans « rester connecté » : expirée après 12 h d\'inactivité', async () => {
    const t0 = clock;
    const idle = new IpClient('inactif');
    const active = new IpClient('actif');
    assert.equal((await ownerLogin(idle, OWNER_CODE, false)).status, 200);
    assert.equal((await ownerLogin(active, OWNER_CODE, false)).status, 200);
    setClock(t0 + 12 * HOUR - 60);
    assert.equal((await active.get('owner_me.php')).status, 200); // activité : expiration repoussée de 12 h
    setClock(t0 + 12 * HOUR + 1);
    expectError(await idle.get('owner_me.php'), 401, 'unauthorized');
    assert.equal((await active.get('owner_me.php')).status, 200);
    setClock(t0 + 12 * HOUR - 60 + 12 * HOUR + 1);
    expectError(await active.get('owner_me.php'), 401, 'unauthorized');
  });

  await t.test('propriétaire avec « rester connecté » : la session vit un jour (et 30 jours glissants)', async () => {
    const t0 = clock;
    const keep = new IpClient('garde');
    assert.equal((await ownerLogin(keep, OWNER_CODE, true)).status, 200);
    setClock(t0 + DAY);
    const me = await keep.get('owner_me.php');
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.owner.remember, true);
    setClock(t0 + DAY + 30 * DAY + 1);
    expectError(await keep.get('owner_me.php'), 401, 'unauthorized');
  });

  await t.test('client : la session vit 30 jours', async () => {
    const t0 = clock;
    const c1 = new IpClient('client-actif');
    const c2 = new IpClient('client-inactif');
    const body = { email: 'leo@example.test', password: CUSTOMER_PASSWORD };
    assert.equal((await c1.post('customer_login.php', body)).status, 200);
    assert.equal((await c2.post('customer_login.php', body)).status, 200);
    setClock(t0 + 30 * DAY - 60);
    assert.equal((await c1.get('customer_orders.php')).status, 200); // c2 reste inactif
    setClock(t0 + 30 * DAY - 60 + 30 * DAY - 120);
    assert.equal((await c1.get('customer_orders.php')).status, 200);
    expectError(await c2.get('customer_orders.php'), 401, 'unauthorized');
    assert.equal((await c2.get('customer_me.php')).json.customer, null);
  });
});

// ---------------------------------------------------------------- 3. profil client
test('3. profil client (customer_update_profile.php)', async (t) => {
  const p = new IpClient('paul');
  const q = new IpClient('quentin');
  const ids = {};

  await t.test('comptes de test', async () => {
    const a = await p.post('customer_signup.php', signupBody({ email: 'paul@example.test', first_name: 'Paul', city: 'Dourges', street: '5 rue haute' }));
    assert.equal(a.status, 201, a.text);
    ids.p = a.json.customer.id;
    const b = await q.post('customer_signup.php', signupBody({ email: 'quentin@example.test', first_name: 'Quentin' }));
    assert.equal(b.status, 201, b.text);
    ids.q = b.json.customer.id;
  });

  await t.test('mise à jour réussie (adresse et e-mail inchangés)', async () => {
    const r = await p.post('customer_update_profile.php', {
      first_name: '  Paul   Henri ', last_name: 'Nouveau', phone: ' 07 11 22 33 44 ', street: 'ignorée', city: 'Rouvroy', email: 'autre@example.test',
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.customer, {
      id: ids.p, first_name: 'Paul Henri', last_name: 'Nouveau', email: 'paul@example.test', phone: '07 11 22 33 44',
      street: '5 rue haute', city: 'Dourges', housing_type: null,
    });
    assert.deepEqual((await p.get('customer_me.php')).json.customer, r.json.customer);
  });

  await t.test('téléphone invalide ou absent : 422 validation, rien de modifié', async () => {
    const before = db.prepare('SELECT first_name, last_name, phone, updated_at FROM customers WHERE id = ?').get(ids.p);
    const bad = await p.post('customer_update_profile.php', { first_name: 'X', last_name: 'Y', phone: '12ab' });
    expectError(bad, 422, 'validation');
    assert.equal(bad.json.message, 'Certains champs sont invalides.');
    assert.deepEqual(bad.json.fields, { phone: 'Numéro de téléphone invalide.' });
    const missing = await p.post('customer_update_profile.php', { first_name: 'X', last_name: 'Y' });
    expectError(missing, 422, 'validation');
    assert.equal(missing.json.fields.phone, 'Numéro de téléphone invalide.');
    const empty = await p.post('customer_update_profile.php', { first_name: '', last_name: 'Y'.repeat(61), phone: '06 00 00 00 09' });
    expectError(empty, 422, 'validation');
    assert.deepEqual(Object.keys(empty.json.fields).sort(), ['first_name', 'last_name']);
    assert.deepEqual(db.prepare('SELECT first_name, last_name, phone, updated_at FROM customers WHERE id = ?').get(ids.p), before);
  });

  await t.test('sans session : 401 ; session propriétaire seule : 403 ; GET : 405', async () => {
    const body = { first_name: 'A', last_name: 'B', phone: '06 00 00 00 02' };
    expectError(await new IpClient('anonyme').post('customer_update_profile.php', body), 401, 'unauthorized');
    const owner = new IpClient('patron');
    assert.equal((await ownerLogin(owner)).status, 200);
    expectError(await owner.post('customer_update_profile.php', body), 403, 'forbidden');
    expectError(await p.get('customer_update_profile.php'), 405, 'method_not_allowed');
  });

  await t.test('noms : caractères de sens d\'écriture et de contrôle retirés (inscription et profil)', async () => {
    const RLO = '‮';
    const s = await new IpClient('rlo').post('customer_signup.php', signupBody({
      email: 'rlo@example.test', first_name: `Ma${RLO}rie​`, last_name: `Du⁦${RLO}pont⁩`,
    }));
    assert.equal(s.status, 201, s.text);
    assert.equal(s.json.customer.first_name, 'Marie');
    assert.equal(s.json.customer.last_name, 'Dupont');
    // Seulement des caractères invisibles : refusé comme un champ vide.
    const only = await new IpClient('rlo2').post('customer_signup.php', signupBody({ email: 'rlo2@example.test', first_name: RLO + '​' }));
    expectError(only, 422, 'validation');
    assert.deepEqual(Object.keys(only.json.fields), ['first_name']);
    // Profil : même nettoyage ; un contrôle (tabulation) devient une espace.
    const r = await p.post('customer_update_profile.php', { first_name: `Paul${RLO}\tHenri`, last_name: `${RLO}Nouveau`, phone: '07 11 22 33 44' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.customer.first_name, 'Paul Henri');
    assert.equal(r.json.customer.last_name, 'Nouveau');
    const row = db.prepare('SELECT first_name, last_name FROM customers WHERE id = ?').get(ids.p);
    assert.equal(/[‪-‮⁦-⁩​]/.test(row.first_name + row.last_name), false);
    expectError(await p.post('customer_update_profile.php', { first_name: RLO, last_name: 'X', phone: '07 11 22 33 44' }), 422, 'validation');
  });

  await t.test('isolation : l\'autre client ne voit pas le changement', async () => {
    const me = await q.get('customer_me.php');
    assert.equal(me.json.customer.id, ids.q);
    assert.equal(me.json.customer.first_name, 'Quentin');
    assert.equal(me.json.customer.last_name, 'Démo');
    assert.equal(me.json.customer.phone, '06 00 00 00 01');
    const row = db.prepare('SELECT first_name, phone FROM customers WHERE id = ?').get(ids.q);
    assert.deepEqual({ ...row }, { first_name: 'Quentin', phone: '06 00 00 00 01' });
  });
});

// ---------------------------------------------------------------- 4. recherche clients en POST
test('4. recherche clients : POST {q} uniquement', async (t) => {
  const owner = new IpClient('patron-recherche');
  const cust = new IpClient('client-recherche');

  await t.test('connexions', async () => {
    assert.equal((await ownerLogin(owner)).status, 200);
    assert.equal((await cust.post('customer_login.php', { email: 'leo@example.test', password: CUSTOMER_PASSWORD })).status, 200);
  });

  await t.test('POST : résultats de la recherche', async () => {
    const emails = async (body) => {
      const r = await owner.post('owner_customers.php', { code: SUPER_CODE, ...body });
      assert.equal(r.status, 200, r.text);
      return r.json.customers.map((c) => c.email).sort();
    };
    const everyone = ['leo@example.test', 'paul@example.test', 'quentin@example.test', 'rlo@example.test', 'victime@example.test'];
    assert.deepEqual(await emails({}), everyone);
    assert.deepEqual(await emails({ q: '' }), everyone);
    assert.deepEqual(await emails({ q: 'Paul' }), ['paul@example.test']);
    assert.deepEqual(await emails({ q: 'quentin@' }), ['quentin@example.test']);
    assert.deepEqual(await emails({ q: '07 11' }), ['paul@example.test']);
    assert.deepEqual(await emails({ q: 'introuvable' }), []);
  });

  await t.test('GET : 405 (la recherche ne passe plus dans l\'URL)', async () => {
    const g = await owner.get('owner_customers.php?q=Paul');
    expectError(g, 405, 'method_not_allowed');
    assert.equal(g.json.message, 'Méthode non autorisée.');
    assert.equal(g.headers.get('allow'), 'POST');
    expectError(await owner.get('owner_customers.php'), 405, 'method_not_allowed');
  });

  await t.test('POST : q trop long ou non textuel : 422', async () => {
    const long = await owner.post('owner_customers.php', { code: SUPER_CODE, q: 'x'.repeat(81) });
    expectError(long, 422, 'validation');
    assert.ok(long.json.fields.q);
    const bad = await owner.post('owner_customers.php', { code: SUPER_CODE, q: ['Paul'] });
    expectError(bad, 422, 'validation');
    assert.equal(bad.json.fields.q, 'Recherche invalide.');
  });

  await t.test('POST sans session : 401 ; session client : 403', async () => {
    expectError(await new IpClient('anonyme-recherche').post('owner_customers.php', { code: SUPER_CODE, q: 'Paul' }), 401, 'unauthorized');
    expectError(await cust.post('owner_customers.php', { code: SUPER_CODE, q: 'Paul' }), 403, 'forbidden');
  });

  await t.test('POST sans code supérieur ou code faux : 403 invalid_super_code', async () => {
    expectError(await owner.post('owner_customers.php', { q: 'Paul' }), 403, 'invalid_super_code');
    expectError(await owner.post('owner_customers.php', { code: 'faux', q: 'Paul' }), 403, 'invalid_super_code');
  });
});

// ---------------------------------------------------------------- 5. contrôles transverses
test('5. réponses de ce fichier : JSON, sans secret, journal sans avertissement', () => {
  assert.ok(responses.length > 50, `réponses contrôlées : ${responses.length}`);
  for (const r of responses) {
    const ct = r.headers.get('content-type') || '';
    assert.match(ct, /^application\/json; charset=utf-8$/i, `${r.method} ${r.route} → ${ct}`);
    assert.equal(r.headers.get('cache-control'), 'no-store', r.route);
    assert.ok(r.json && typeof r.json.ok === 'boolean', `${r.method} ${r.route} : ${r.text.slice(0, 200)}`);
    const body = secretScanText(r).toLowerCase();
    for (const word of ['password', 'token']) {
      assert.equal(body.includes(word), false, `${r.method} ${r.route} contient « ${word} »`);
    }
  }
  assert.doesNotMatch(ctx.serverLog(), /Fatal error|Warning:|Notice:|Deprecated:|Horloge de test| 500 server_error/);
});
