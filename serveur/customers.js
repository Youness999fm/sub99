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
    city: c.city === null ? null : String(c.city),
    housing_type: c.housing_type === null ? null : String(c.housing_type)
  };
}

/** Précisé par le client en même temps que son adresse, pour que le livreur sache à qui/quoi s'attendre. */
export const HOUSING_TYPES = ['maison', 'appartement', 'immeuble'];

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

/**
 * Valide rue + ville + type de logement (ville vide = pas d'adresse, le type non plus).
 * Le type de logement reste facultatif à l'enregistrement du profil (compte créé sans — ou avant
 * l'ajout de ce champ) ; il n'est exigé qu'au moment de passer une commande en livraison
 * (voir order_create.js, 'housing_type_required'), comme le moyen de paiement dans le panier.
 * Ajoute les erreurs dans `errors`. Renvoie [street, city, housingType].
 */
export function validateAddress(b, errors) {
  let street = b.street !== undefined ? b.street : '';
  let city = b.city !== undefined ? b.city : '';
  let housingType = b.housing_type !== undefined ? b.housing_type : '';
  if (street === null) street = '';
  if (city === null) city = '';
  if (housingType === null) housingType = '';
  if (typeof street !== 'string') { errors.street = 'Adresse invalide.'; street = ''; }
  if (typeof city !== 'string') { errors.city = 'Ville invalide.'; city = ''; }
  if (typeof housingType !== 'string') { errors.housing_type = 'Type de logement invalide.'; housingType = ''; }
  // Postgres refuse le caractère NUL dans un texte : refus propre (422) plutôt qu'une erreur 500.
  if (street.includes('\0') || city.includes('\0')) {
    errors.street = errors.street || 'Adresse invalide.';
    return [null, null, null];
  }
  street = cleanSpaces(street);
  city = city.trim();
  housingType = housingType.trim();
  if (strChars(street) > 150) errors.street = 'Adresse trop longue (150 caractères au plus).';
  if (city !== '' && !Object.prototype.hasOwnProperty.call(DELIVERY_ZONES, city)) {
    errors.city = "Cette ville n'est pas dans notre zone de livraison.";
  }
  if (city === '') return [null, null, null];
  if (housingType !== '' && !HOUSING_TYPES.includes(housingType)) {
    errors.housing_type = 'Type de logement invalide.';
    return [street === '' ? null : street, city, null];
  }
  return [street === '' ? null : street, city, housingType === '' ? null : housingType];
}
