/**
 * Génère un aperçu autonome d'une composition, sans navigateur.
 *
 *   node lab/tools/apercu.mjs quatro sauce-tomate jambon chorizo olives champignons
 *   → lab/apercu.svg
 *
 * Le premier argument est la taille, le deuxième la sauce, les suivants les
 * ingrédients. Sert à contrôler un rendu rapidement, et c'est la brique de
 * l'« aperçu photographique » partageable du §63.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Sous Windows, un chemin absolu « C:\… » n'est pas une URL de module valide :
// il faut passer par file://.
const { renderStaticSvg } = await import(
  pathToFileURL(resolve(here, '../../assets/js/lab/atelier/render/pizza-canvas.js')).href
);

const [sizeId = 'quatro', sauceId = 'sauce-tomate', ...ingredients] = process.argv.slice(2);

const svg = renderStaticSvg({
  sizeId,
  sauceId: sauceId === 'none' ? null : sauceId,
  baseCheese: true,
  ingredients
});

const out = resolve(here, '..', 'apercu.svg');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg, 'utf8');

console.log(`${out}  (${sizeId}, ${sauceId}, ${ingredients.join(', ') || 'sans supplément'})`);
console.log(`${Math.round(svg.length / 1024)} Ko`);
