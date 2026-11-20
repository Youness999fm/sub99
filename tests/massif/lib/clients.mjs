// Faux clients : chacun a sa boîte à cookies et sa propre adresse IP simulée (en-tête x-subito-test-ip, mode test seulement),
// pour que la limitation de débit par adresse ne les confonde pas.
import { Client, OWNER_CODE } from '../../api-vercel/lib/harness.mjs';
import { DELIVERY_ZONES } from '../../../serveur/util.js';

export class ClientIP extends Client {
  constructor(nom, ip) {
    super(nom);
    this.ip = ip;
  }

  request(method, route, opts = {}) {
    return super.request(method, route, { ...opts, headers: { 'x-subito-test-ip': this.ip, ...(opts.headers || {}) } });
  }
}

/** Adresse IPv4 fictive n° i (1 à 16 millions), dans 10.0.0.0/8. */
export const ipFictive = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

/** Exécute fn sur chaque élément avec au plus `concurrence` appels simultanés. Résultats dans l'ordre. */
export async function enParallele(elements, concurrence, fn) {
  const sortie = new Array(elements.length);
  let suivant = 0;
  async function ouvrier() {
    for (;;) {
      const i = suivant++;
      if (i >= elements.length) return;
      sortie[i] = await fn(elements[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrence, elements.length) }, ouvrier));
  return sortie;
}

export const VILLES = Object.keys(DELIVERY_ZONES);

/** Corps d'inscription n° i (e-mail et mot de passe fictifs, propres aux tests). */
export function corpsInscription(i, { ville = null, rue = null, prefixe = 'massif' } = {}) {
  return {
    first_name: 'Client' + i,
    last_name: 'Massif',
    email: `${prefixe}-${i}@example.test`,
    phone: '06 ' + String(10000000 + (i % 89999999)).slice(0, 2) + ' ' + String(i % 100).padStart(2, '0') + ' 00 ' + String((i * 7) % 100).padStart(2, '0'),
    password: `Essai-${prefixe}-${i}-Aa1!`,
    street: ville ? (rue || `${i} rue des Tests`) : null,
    city: ville,
    housing_type: ville ? 'maison' : null
  };
}

/**
 * Crée n comptes clients (n° debut… debut+n-1), chacun depuis son adresse fictive.
 * Renvoie des ClientIP connectés, avec .num, .email, .password, .customer.
 * Les villes sont réparties sur les 8 zones de livraison si `villes` est vrai.
 */
export async function creerClients(n, { debut = 1, villes = true, concurrence = 20, prefixe = 'massif' } = {}) {
  const numeros = Array.from({ length: n }, (_, k) => debut + k);
  return enParallele(numeros, concurrence, async (num) => {
    const client = new ClientIP('client-' + num, ipFictive(num));
    const ville = villes ? VILLES[num % VILLES.length] : null;
    const corps = corpsInscription(num, { ville, prefixe });
    const r = await client.post('customer_signup.php', corps);
    if (r.status !== 201) throw new Error(`Inscription du client ${num} refusée : ${r.status} ${r.text}`);
    Object.assign(client, { num, email: corps.email, password: corps.password, customer: r.json.customer, ville });
    return client;
  });
}

/** Commerçant connecté (code patron du site de test), depuis une adresse fictive à part. */
export async function patronConnecte(ip = '10.250.250.250', remember = false) {
  const patron = new ClientIP('patron', ip);
  const r = await patron.post('owner_login.php', { code: OWNER_CODE, remember });
  if (r.status !== 200) throw new Error('Connexion du patron refusée : ' + r.status + ' ' + r.text);
  return patron;
}
