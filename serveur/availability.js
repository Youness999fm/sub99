// Disponibilités : entrées effectives aujourd'hui, correspondance tolérante des noms (port de api/lib/availability.php).
import { all } from './db.js';
import { nameKeys, precleanName, serviceDay } from './util.js';

export const AVAILABILITY_KINDS = ['pizza', 'product', 'ingredient'];

/** Entrées indisponibles effectives : out_manual, et out_today du jour de service courant. */
export async function availabilityEffective() {
  const rows = await all(
    `SELECT kind, name, status, service_day FROM availability
     WHERE status = 'out_manual' OR (status = 'out_today' AND service_day = ?)
     ORDER BY kind, name`,
    [serviceDay()]
  );
  return rows.map((r) => ({
    kind: String(r.kind),
    name: String(r.name),
    status: String(r.status),
    service_day: r.status === 'out_today' ? String(r.service_day) : null
  }));
}

/**
 * Nom de base d'une ligne : avant le premier séparateur de garniture.
 * « — » et « – » avec ou sans espaces ; « - » seulement entouré d'espaces.
 */
export function itemBaseName(name) {
  const net = String(name).replace(/\p{Cf}+/gu, '');
  const morceaux = net.split(/\s*[—–]\s*|\s+-\s+/u);
  return precleanName(morceaux[0]);
}

/** Noms des pizzas indisponibles présentes dans les lignes (ligne, et moitiés éventuelles). */
export async function unavailablePizzas(items) {
  const keys = new Set();
  for (const e of await availabilityEffective()) {
    if (e.kind === 'pizza') for (const k of nameKeys(e.name)) keys.add(k);
  }
  if (keys.size === 0) return [];
  const sortie = new Set();
  for (const it of items) {
    const candidats = [itemBaseName(it.name)];
    if (it.half !== null && typeof it.half === 'object') {
      candidats.push(itemBaseName(it.half.flavor1), itemBaseName(it.half.flavor2));
    }
    for (const cand of candidats) {
      if (cand === '') continue;
      if (nameKeys(cand).some((k) => keys.has(k))) sortie.add(cand);
    }
  }
  return [...sortie];
}
