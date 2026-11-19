// Clients : validation des champs et vues renvoyées (port de api/lib/customers.php).
import { DELIVERY_ZONES, cleanSpaces, strChars } from './util.js';

export function customerView(c) {
  return {
    id: Number(c.id),
    first_name: String(c.first_name),
    last_name: String(c.last_name),
    email: String(c.email),
    phone: String(c.phone),
    street: c.street === null ? null : String(c.street),
    city: c.city === null ? null : String(c.city)
  };
}

const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+(?<!\.)@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function normalizeEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (e === '' || Buffer.byteLength(e) > 190 || !EMAIL.test(e)) return null;
  return e;
}

export function validPhone(p) {
  const len = Buffer.byteLength(p);
  return len >= 8 && len <= 20 && /^[0-9+ .\-()]+$/.test(p) && (p.match(/[0-9]/g) || []).length >= 8;
}

/**
 * Prénom ou nom nettoyé : caractères de format retirés (\p{Cf}), caractères de contrôle (\p{Cc}) remplacés
 * par une espace, puis espaces réduits.
 */
export function cleanPersonName(s) {
  return cleanSpaces(String(s).replace(/\p{Cf}+/gu, '').replace(/\p{Cc}+/gu, ' '));
}

/** Valide prénom, nom et téléphone. Ajoute les erreurs dans `errors`. Renvoie [first, last, phone]. */
export function validateProfile(b, errors) {
  const first = typeof b.first_name === 'string' ? cleanPersonName(b.first_name) : '';
  const last = typeof b.last_name === 'string' ? cleanPersonName(b.last_name) : '';
  if (first === '' || strChars(first) > 60) errors.first_name = 'Prénom attendu (60 caractères au plus).';
  if (last === '' || strChars(last) > 60) errors.last_name = 'Nom attendu (60 caractères au plus).';
  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  if (!validPhone(phone)) errors.phone = 'Numéro de téléphone invalide.';
  return [first, last, phone];
}

/** Valide rue + ville (ville vide = pas d'adresse). Ajoute les erreurs dans `errors`. Renvoie [street, city]. */
export function validateAddress(b, errors) {
  let street = b.street !== undefined ? b.street : '';
  let city = b.city !== undefined ? b.city : '';
  if (street === null) street = '';
  if (city === null) city = '';
  if (typeof street !== 'string') { errors.street = 'Adresse invalide.'; street = ''; }
  if (typeof city !== 'string') { errors.city = 'Ville invalide.'; city = ''; }
  street = cleanSpaces(street);
  city = city.trim();
  if (strChars(street) > 150) errors.street = 'Adresse trop longue (150 caractères au plus).';
  if (city !== '' && !Object.prototype.hasOwnProperty.call(DELIVERY_ZONES, city)) {
    errors.city = "Cette ville n'est pas dans notre zone de livraison.";
  }
  if (city === '') return [null, null];
  return [street === '' ? null : street, city];
}
