// Contrôles de la batterie 09 : une ligne PASS / FAIL par contrôle (avec la valeur observée), compteurs, résumé chiffré.
// Les caractères de contrôle et de format (NUL, U+202E…) sont rendus visibles (\uXXXX) pour ne pas gêner le terminal.
const t0 = Date.now();
const etat = { total: 0, reussis: 0, echoues: 0, echecs: [], phases: [] };
let phaseCourante = null;

export function visible(valeur, max = 240) {
  let s = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
  if (s === undefined) s = String(valeur);
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return s.length > max ? s.slice(0, max) + '…(+' + (s.length - max) + ' car.)' : s;
}

/** Un contrôle : ok = vrai/faux ; valeur = ce qui a été observé (affiché). */
export function controle(nom, ok, valeur) {
  const reussi = Boolean(ok);
  etat.total++;
  if (reussi) etat.reussis++;
  else { etat.echoues++; etat.echecs.push(nom); }
  if (phaseCourante) { phaseCourante.total++; if (!reussi) phaseCourante.echoues++; }
  console.log(`${reussi ? 'PASS' : 'FAIL'}  ${nom}${valeur === undefined ? '' : '  — ' + visible(valeur)}`);
  return reussi;
}

/** Ligne de détail (sous un contrôle en échec ou pour une mesure) : n'est pas un contrôle. */
export function detail(texte) {
  console.log('      ↳ ' + visible(texte, 420));
}

export function info(texte) {
  console.log('INFO  ' + visible(texte, 420));
}

export function phase(nom) {
  if (phaseCourante) phaseCourante.ms = Date.now() - phaseCourante.debut;
  phaseCourante = { nom, debut: Date.now(), total: 0, echoues: 0, ms: 0 };
  etat.phases.push(phaseCourante);
  console.log(`\n=== ${nom} ===`);
}

export function dureeS() {
  return Math.round((Date.now() - t0) / 100) / 10;
}

/** Résumé chiffré ; renvoie le code de sortie (0 = tout bon). */
export function bilan() {
  if (phaseCourante) phaseCourante.ms = Date.now() - phaseCourante.debut;
  console.log('\n=== RÉSUMÉ ===');
  for (const p of etat.phases) console.log(`  ${p.nom.padEnd(52)} ${String(p.total).padStart(4)} contrôles, ${p.echoues} échec(s), ${(p.ms / 1000).toFixed(1)} s`);
  console.log(`TOTAL : ${etat.total} contrôles, ${etat.reussis} PASS, ${etat.echoues} FAIL, durée ${dureeS()} s`);
  if (etat.echecs.length) {
    console.log('Contrôles en échec :');
    for (const e of etat.echecs) console.log('  - ' + visible(e, 200));
  }
  return etat.echoues === 0 ? 0 : 1;
}

export const compteurs = () => ({ ...etat, phases: etat.phases.map((p) => ({ ...p })) });
