// Batterie 02 (livraison) : une ligne PASS ou FAIL par contrôle (avec la valeur observée), puis un bilan chiffré.
// Les lignes de détail commencent par « >> » : elles ne sont jamais comptées comme des contrôles.
// IMPORTANT : le harnais de test remplace console.error pendant que le site tourne : tout est écrit avec console.log.
import { isDeepStrictEqual } from 'node:util';

export const bilan = { total: 0, reussis: 0, echoues: 0, echecs: [], debut: Date.now() };

/** Texte court d'une valeur (pour l'affichage de la valeur observée). */
export function court(v, max = 240) {
  let s;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

/** Un contrôle : PASS si `ok`. `observe` est la valeur observée (affichée après « | »). */
export function controle(nom, ok, observe) {
  bilan.total++;
  const suite = observe === undefined ? '' : ' | ' + court(observe);
  if (ok) {
    bilan.reussis++;
    console.log(`PASS ${nom}${suite}`);
  } else {
    bilan.echoues++;
    bilan.echecs.push(nom);
    console.log(`FAIL ${nom}${suite}`);
  }
  return Boolean(ok);
}

/** Égalité profonde stricte entre la valeur obtenue et la valeur attendue. */
export function egal(nom, obtenu, attendu) {
  const ok = isDeepStrictEqual(obtenu, attendu);
  return controle(nom, ok, ok ? obtenu : `obtenu ${court(obtenu, 170)} / attendu ${court(attendu, 170)}`);
}

/** Contrôle sur un lot : PASS si la liste d'anomalies est vide ; sinon, affiche les premières anomalies. */
export function lot(nom, total, anomalies, maxDetails = 8) {
  const ok = anomalies.length === 0;
  controle(nom, ok, ok ? `${total}/${total} conformes` : `${total - anomalies.length}/${total} conformes, ${anomalies.length} anomalie(s)`);
  if (!ok) for (const a of anomalies.slice(0, maxDetails)) console.log('  >> ' + court(a, 400));
  return ok;
}

/** Séparateur de section. */
export function section(titre) {
  console.log(`\n=== ${titre} ===`);
}

/** Différences entre deux objets, champ par champ (liste de textes), pour des messages précis. */
export function differences(obtenu, attendu, champs) {
  const d = [];
  for (const c of champs) {
    if (!isDeepStrictEqual(obtenu?.[c], attendu?.[c])) d.push(`${c}: ${court(obtenu?.[c], 110)} / attendu ${court(attendu?.[c], 110)}`);
  }
  return d;
}

/** Résumé chiffré (ne commence ni par PASS ni par FAIL). */
export function resume() {
  const duree = Math.round((Date.now() - bilan.debut) / 100) / 10;
  console.log(`\nRESUME : ${bilan.total} contrôles, ${bilan.reussis} réussis, ${bilan.echoues} échoués, durée ${duree} s`);
  if (bilan.echoues) for (const n of bilan.echecs.slice(0, 40)) console.log('  >> échec : ' + n);
  return { controles: bilan.total, reussis: bilan.reussis, echoues: bilan.echoues, duree_s: duree };
}
