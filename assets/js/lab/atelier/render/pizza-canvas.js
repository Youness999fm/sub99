/**
 * PizzaCanvas — la pizza elle-même.
 *
 * Un seul <svg> dans un repère fixe (1000×1000, pizza de rayon 420 centrée).
 * Le changement de taille est une simple mise à l'échelle du groupe pizza :
 * l'animation est donc parfaitement fluide et aucune géométrie n'est
 * recalculée. Les morceaux de garniture, eux, sont contre-mis à l'échelle pour
 * garder une taille physique constante (une rondelle de chorizo ne grossit pas
 * parce qu'on passe en XXL — il y en a simplement plus).
 */

import { createRng, range } from '../core/random.js';
import { getSize, getIngredient } from '../data/ingredients.js';
import { wobblyCircle, spiralPath, spriteMarkup } from './svg-defs.js';
import { BASE_RADIUS, TOPPING_RATIO, placePieces } from './placement.js';
import { animate, settle, settleAll, EASE, prefersReducedMotion } from '../anim/motion.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CENTER = 500;
const R = BASE_RADIUS;
const SAUCE_R = R * TOPPING_RATIO;
/** Fin de la spirale : + la demi-épaisseur du trait, elle couvre tout le disque. */
const SPIRAL_R = SAUCE_R - 36;
const SPIRAL_WIDTH = 92;

let uid = 0;

export function createPizzaCanvas(root) {
  const id = `pz${(uid += 1)}`;
  const svg = el('svg', {
    class: 'pz',
    viewBox: '0 0 1000 1000',
    role: 'img',
    'aria-label': 'Aperçu de votre pizza en préparation'
  });

  svg.innerHTML = `
    <defs>
      <!-- Masque et clip sont résolus dans l'espace utilisateur de l'élément
           qui les référence : ici le groupe pizza, déjà centré. Aucun
           translate supplémentaire, sinon tout part hors cadre. -->
      <clipPath id="${id}-dough-clip">
        <path d="${wobblyCircle(R * 0.915, 0.014, 'dough-clip')}"/>
      </clipPath>
      <mask id="${id}-sauce-mask" maskUnits="userSpaceOnUse"
            x="${-R}" y="${-R}" width="${R * 2}" height="${R * 2}">
        <path class="pz-spiral" d="${spiralPath(SPIRAL_R, 4.6)}"
              fill="none" stroke="#fff" stroke-width="${SPIRAL_WIDTH}"
              stroke-linecap="round" stroke-linejoin="round"/>
      </mask>
    </defs>

    <ellipse class="pz-shadow" cx="${CENTER}" cy="${CENTER + 26}" rx="${R * 1.08}" ry="${R * 1.02}"
             fill="url(#atg-shadow)"/>

    <g class="pz-pizza" transform="translate(${CENTER},${CENTER}) scale(0.76)">
      <g class="pz-base">
        <g filter="url(#atf-crust)">
          <path d="${wobblyCircle(R, 0.017, 'crust-outer')}" fill="url(#atg-crust-ring)"/>
          <path d="${wobblyCircle(R * 0.915, 0.014, 'crust-inner')}" fill="url(#atg-dough)"/>
        </g>
        ${crustBubbles()}
        <g clip-path="url(#${id}-dough-clip)" style="mix-blend-mode:soft-light" opacity="0.5">
          <rect x="${-R}" y="${-R}" width="${R * 2}" height="${R * 2}" filter="url(#atf-grain)"/>
        </g>
        <path d="${wobblyCircle(R * 0.915, 0.014, 'crust-inner')}" fill="none"
              stroke="#B07C3C" stroke-width="3" opacity="0.28"/>
      </g>

      <g class="pz-sauce" mask="url(#${id}-sauce-mask)" aria-hidden="true"></g>
      <g class="pz-mozza" aria-hidden="true"></g>
      <g class="pz-layer" data-layer="viandes" filter="url(#atf-piece)"></g>
      <g class="pz-layer" data-layer="legumes" filter="url(#atf-piece)"></g>
      <g class="pz-layer" data-layer="fromages" filter="url(#atf-piece)"></g>
    </g>`;

  root.appendChild(svg);

  const pizza = svg.querySelector('.pz-pizza');
  const sauceLayer = svg.querySelector('.pz-sauce');
  const mozzaLayer = svg.querySelector('.pz-mozza');
  const spiral = svg.querySelector('.pz-spiral');
  const layers = {
    viandes: svg.querySelector('[data-layer="viandes"]'),
    legumes: svg.querySelector('[data-layer="legumes"]'),
    fromages: svg.querySelector('[data-layer="fromages"]')
  };

  const spiralLength = spiral.getTotalLength ? spiral.getTotalLength() : 4000;
  spiral.style.strokeDasharray = `${spiralLength}`;
  spiral.style.strokeDashoffset = `${spiralLength}`;

  let sizeId = 'duo';
  /** id ingrédient -> { group, pieces: [{node, x, y, r}] } */
  const placed = new Map();

  /* ------------------------------------------------------------- taille */

  function setSize(nextSizeId, { animate: doAnimate = true } = {}) {
    const size = getSize(nextSizeId);
    if (!size) return Promise.resolve();
    const from = getSize(sizeId);
    sizeId = nextSizeId;

    // Les positions dépendent de la taille (densité + contre-échelle) :
    // on les recalcule silencieusement sous l'animation de zoom.
    const toRebuild = Array.from(placed.keys());
    toRebuild.forEach((ingId) => removeIngredient(ingId, { animate: false }));

    const anim = animate(
      pizza,
      [
        { transform: `translate(${CENTER}px,${CENTER}px) scale(${from ? from.scale : 0.76})` },
        { transform: `translate(${CENTER}px,${CENTER}px) scale(${size.scale})` }
      ],
      { duration: doAnimate && !prefersReducedMotion() ? 620 : 0, easing: EASE.pop }
    );

    toRebuild.forEach((ingId) => {
      const ing = getIngredient(ingId);
      if (ing) addIngredient(ing, { hidden: false });
    });

    return settle(anim);
  }

  /* -------------------------------------------------------------- sauce */

  /**
   * Prépare la sauce (masque fermé : rien n'est visible) puis renvoie la
   * fonction d'étalage, que la mise en scène déclenche au bon moment — juste
   * après que la louche a versé.
   */
  function setSauce(ingredient) {
    const seed = 'sauce-' + ingredient.id;
    const fill = ingredient.sauce ? ingredient.sauce.fill : 'atg-sauce-tomate';
    sauceLayer.innerHTML = `
      <g filter="url(#atf-sauce)">
        <path d="${wobblyCircle(SAUCE_R, 0.028, seed)}" fill="url(#${fill})"/>
      </g>
      ${sauceSwirls(seed, ingredient)}`;
    spiral.style.strokeDashoffset = `${spiralLength}`;
    sauceLayer.removeAttribute('aria-hidden');

    return {
      spread(duration = 1000) {
        if (prefersReducedMotion()) {
          spiral.style.strokeDashoffset = '0';
          return Promise.resolve();
        }
        const reveal = animate(
          spiral,
          [{ strokeDashoffset: spiralLength }, { strokeDashoffset: 0 }],
          { duration, easing: 'cubic-bezier(0.3, 0.6, 0.25, 1)' }
        );
        // Micro-rotation pendant l'étalage : le geste du dos de la louche.
        const twist = animate(
          sauceLayer,
          [{ transform: 'rotate(-7deg)' }, { transform: 'rotate(0deg)' }],
          { duration: duration + 160, easing: EASE.out }
        );
        return settleAll([reveal, twist]);
      },
      showInstantly() {
        spiral.style.strokeDashoffset = '0';
      }
    };
  }

  function clearSauce() {
    sauceLayer.innerHTML = '';
    sauceLayer.setAttribute('aria-hidden', 'true');
    spiral.style.strokeDashoffset = `${spiralLength}`;
  }

  /* ------------------------------------------- fromage de la Marguerita */

  function setBaseCheese({ hidden = false } = {}) {
    if (mozzaLayer.childElementCount) return { reveal: () => Promise.resolve() };
    mozzaLayer.innerHTML = mozzarella();
    mozzaLayer.removeAttribute('aria-hidden');
    mozzaLayer.style.opacity = hidden ? '0' : '1';
    return {
      reveal() {
        if (prefersReducedMotion()) {
          mozzaLayer.style.opacity = '1';
          return Promise.resolve();
        }
        return settle(
          animate(
            mozzaLayer,
            [
              { opacity: 0, transform: 'scale(0.86)' },
              { opacity: 1, transform: 'scale(1)' }
            ],
            { duration: 760, easing: EASE.out }
          )
        );
      }
    };
  }

  function clearBaseCheese() {
    mozzaLayer.innerHTML = '';
    mozzaLayer.setAttribute('aria-hidden', 'true');
  }

  /* ---------------------------------------------------------- garniture */

  /** Liste partagée pour que les calques ne s'empilent pas au même endroit. */
  function occupiedPoints() {
    const all = [];
    placed.forEach((entry) => {
      entry.pieces.forEach((p) => all.push(p));
    });
    return all;
  }

  /**
   * Insère les morceaux d'un ingrédient. Avec `hidden: true` ils sont posés
   * mais invisibles : c'est la mise en scène qui les révèle un par un via
   * `revealPiece`, pour l'effet « la portion se répartit ».
   */
  function addIngredient(ingredient, { hidden = true } = {}) {
    if (placed.has(ingredient.id)) return placed.get(ingredient.id);
    const layer = layers[ingredient.category];
    if (!layer) return null;

    const points = placePieces(ingredient, sizeId, occupiedPoints());
    const group = el('g', { 'data-ing': ingredient.id });
    const pieces = points.map((p) => {
      const node = el('use', {
        href: `#${p.shapeId}`,
        transform: `translate(${p.x},${p.y}) rotate(${p.rot}) scale(${p.scale})`
      });
      node.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${p.shapeId}`);
      if (hidden) node.style.opacity = '0';
      group.appendChild(node);
      return { node, x: p.x, y: p.y, r: p.r };
    });

    layer.appendChild(group);
    const entry = { group, pieces };
    placed.set(ingredient.id, entry);
    return entry;
  }

  /** Apparition d'un morceau : il tombe de quelques unités et s'écrase. */
  function revealPiece(piece, delay = 0) {
    const base = `translate(${piece.x}px,${piece.y}px)`;
    if (prefersReducedMotion()) {
      piece.node.style.opacity = '1';
      return Promise.resolve();
    }
    piece.node.style.opacity = '1';
    return settle(
      animate(
        piece.node,
        [
          { opacity: 0, transform: `${base} translateY(-26px) scale(0.55)`, offset: 0 },
          { opacity: 1, transform: `${base} translateY(0) scale(1.14)`, offset: 0.62 },
          { opacity: 1, transform: `${base} translateY(0) scale(1)`, offset: 1 }
        ],
        { duration: 420, delay, easing: EASE.pop }
      )
    );
  }

  function revealAll(entry, { stagger = 42, from = 0 } = {}) {
    if (!entry) return Promise.resolve();
    return Promise.all(entry.pieces.map((p, i) => revealPiece(p, from + i * stagger)));
  }

  function showIngredientInstantly(entry) {
    if (!entry) return;
    entry.pieces.forEach((p) => {
      p.node.style.opacity = '1';
    });
  }

  function removeIngredient(ingredientId, { animate: doAnimate = true } = {}) {
    const entry = placed.get(ingredientId);
    if (!entry) return Promise.resolve();
    placed.delete(ingredientId);

    if (!doAnimate || prefersReducedMotion()) {
      entry.group.remove();
      return Promise.resolve();
    }

    const outs = entry.pieces.map((p, i) =>
      settle(
        animate(
          p.node,
          [
            { opacity: 1, transform: `translate(${p.x}px,${p.y}px) scale(1)` },
            { opacity: 0, transform: `translate(${p.x}px,${p.y}px) translateY(-34px) scale(0.5)` }
          ],
          { duration: 300, delay: i * 18, easing: EASE.out }
        )
      )
    );
    return Promise.all(outs).then(() => entry.group.remove());
  }

  function has(ingredientId) {
    return placed.has(ingredientId);
  }

  /* ------------------------------------------------------- coordonnées */

  /** Point du repère SVG → coordonnées écran (pour les vols depuis les bacs). */
  function toScreen(x, y) {
    const ctm = pizza.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const out = pt.matrixTransform(ctm);
    return { x: out.x, y: out.y };
  }

  function centerOnScreen() {
    return toScreen(0, 0);
  }

  /** Rayon garni, en pixels écran — utile pour calibrer les trajectoires. */
  function screenRadius() {
    const a = toScreen(0, 0);
    const b = toScreen(SAUCE_R, 0);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function reset() {
    clearSauce();
    clearBaseCheese();
    Array.from(placed.keys()).forEach((ingId) => removeIngredient(ingId, { animate: false }));
  }

  return {
    svg,
    setSize,
    setSauce,
    clearSauce,
    setBaseCheese,
    clearBaseCheese,
    addIngredient,
    removeIngredient,
    revealAll,
    revealPiece,
    showIngredientInstantly,
    has,
    toScreen,
    centerOnScreen,
    screenRadius,
    reset,
    get sizeId() {
      return sizeId;
    }
  };
}

/* ------------------------------------------------------- export d'aperçu */

/**
 * Rend une composition complète en un SVG autonome, sans DOM.
 *
 * C'est la base de l'« aperçu photographique » du §63 : une image propre de la
 * pizza créée, partageable, construite à partir des ressources réellement
 * sélectionnées — et non d'une photo générique. Fonctionne aussi hors
 * navigateur (Node), ce qui permet de générer des aperçus en ligne de commande.
 */
export function renderStaticSvg({ sizeId = 'duo', sauceId = null, baseCheese = false, ingredients = [] } = {}) {
  const size = getSize(sizeId) || getSize('duo');
  const occupied = [];
  const layers = { viandes: '', legumes: '', fromages: '' };

  ingredients.forEach((id) => {
    const ing = getIngredient(id);
    if (!ing || !layers.hasOwnProperty(ing.category)) return;
    const points = placePieces(ing, size.id, occupied);
    points.forEach((p) => occupied.push(p));
    layers[ing.category] += points
      .map((p) => `<use href="#${p.shapeId}" transform="translate(${p.x},${p.y}) rotate(${p.rot}) scale(${p.scale})"/>`)
      .join('');
  });

  const sauce = sauceId ? getIngredient(sauceId) : null;
  const sauceFill = sauce && sauce.sauce ? sauce.sauce.fill : null;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 1000" width="1000" height="1000">
  ${spriteMarkup()}
  <rect width="1000" height="1000" fill="url(#atg-worktop)"/>
  <rect width="1000" height="1000" fill="#FFFFFF" opacity="0.12" filter="url(#atf-brushed)" style="mix-blend-mode:overlay"/>
  <rect width="1000" height="1000" fill="#FFFFFF" opacity="0.08" filter="url(#atf-scratches)" style="mix-blend-mode:screen"/>
  <ellipse cx="300" cy="-60" rx="760" ry="700" fill="url(#atg-lamp)" style="mix-blend-mode:screen"/>
  <rect width="1000" height="1000" fill="url(#atg-corners)" style="mix-blend-mode:multiply"/>
  <ellipse cx="${CENTER}" cy="${CENTER + 26}" rx="${R * 1.08}" ry="${R * 1.02}" fill="url(#atg-shadow)"/>
  <g transform="translate(${CENTER},${CENTER}) scale(${size.scale})">
    <g filter="url(#atf-crust)">
      <path d="${wobblyCircle(R, 0.017, 'crust-outer')}" fill="url(#atg-crust-ring)"/>
      <path d="${wobblyCircle(R * 0.915, 0.014, 'crust-inner')}" fill="url(#atg-dough)"/>
    </g>
    ${crustBubbles()}
    ${sauceFill
      ? `<g><g filter="url(#atf-sauce)"><path d="${wobblyCircle(SAUCE_R, 0.028, 'sauce-' + sauce.id)}" fill="url(#${sauceFill})"/></g>${sauceSwirls('sauce-' + sauce.id, sauce)}</g>`
      : ''}
    ${baseCheese ? mozzarella() : ''}
    <g filter="url(#atf-piece)">${layers.viandes}</g>
    <g filter="url(#atf-piece)">${layers.legumes}</g>
    <g filter="url(#atf-piece)">${layers.fromages}</g>
  </g>
</svg>`;
}

/* ----------------------------------------------------------- décor de base */

/** Cloques et marques de four sur le bourrelet. */
function crustBubbles() {
  const rng = createRng('crust-bubbles');
  let out = '';
  const count = 26;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + range(rng, -0.08, 0.08);
    const rad = R * range(rng, 0.925, 0.985);
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    const size = range(rng, 7, 20);
    const dark = rng() > 0.45;
    out += dark
      ? `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(size)}" ry="${r1(size * 0.72)}" fill="#8A5422" opacity="${r2(range(rng, 0.18, 0.42))}" transform="rotate(${r1((a * 180) / Math.PI)} ${r1(x)} ${r1(y)})"/>`
      : `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(size)}" ry="${r1(size * 0.66)}" fill="#FFF1CF" opacity="${r2(range(rng, 0.2, 0.5))}" transform="rotate(${r1((a * 180) / Math.PI)} ${r1(x)} ${r1(y)})"/>`;
  }
  // Quelques grains de semoule sur la pâte.
  const srng = createRng('semoule');
  for (let i = 0; i < 40; i += 1) {
    const a = srng() * Math.PI * 2;
    const rad = Math.sqrt(srng()) * R * 0.88;
    out += `<circle cx="${r1(Math.cos(a) * rad)}" cy="${r1(Math.sin(a) * rad)}" r="${r2(range(srng, 1.2, 2.8))}" fill="#FFF6E2" opacity="${r2(range(srng, 0.25, 0.6))}"/>`;
  }
  return out;
}

/** Traînées plus sombres dans la sauce : trace du dos de la louche. */
function sauceSwirls(seed, ingredient) {
  const rng = createRng(seed + '-swirl');
  const ink = ingredient.sauce ? ingredient.sauce.ink : '#9E2214';
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    const r0 = SAUCE_R * range(rng, 0.3, 0.86);
    const a0 = rng() * Math.PI * 2;
    const sweep = range(rng, 1.6, 3.2);
    const pts = [];
    for (let t = 0; t <= 10; t += 1) {
      const a = a0 + (sweep * t) / 10;
      const rr = r0 * (1 + 0.06 * Math.sin(t));
      pts.push(`${r1(Math.cos(a) * rr)},${r1(Math.sin(a) * rr)}`);
    }
    out += `<path d="M${pts.join(' L')}" fill="none" stroke="${ink}" stroke-width="${r1(range(rng, 7, 16))}" opacity="${r2(range(rng, 0.1, 0.22))}" stroke-linecap="round"/>`;
  }
  out += `<ellipse cx="${r1(-SAUCE_R * 0.25)}" cy="${r1(-SAUCE_R * 0.3)}" rx="${r1(SAUCE_R * 0.42)}" ry="${r1(SAUCE_R * 0.3)}" fill="#FFF" opacity="0.07"/>`;
  return out;
}

/**
 * Fromage de base — julienne crue.
 *
 * Subito coupe son fromage en julienne : des bâtonnets longs et droits, pas du
 * râpé frisé. Et à ce stade la pizza n'est pas cuite : surtout pas de nappe
 * fondue (§39). On sème donc une couche dense de bâtonnets, orientés dans
 * toutes les directions et se croisant, exactement comme une poignée de
 * julienne jetée à la main.
 */
function mozzarella() {
  const rng = createRng('julienne');
  const area = SAUCE_R * 0.9;
  const shapes = ['atl-julienne-a', 'atl-julienne-b', 'atl-julienne-c'];
  const count = 900;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let out = '';

  for (let i = 0; i < count; i += 1) {
    // Tournesol + jitter : couverture régulière sans alignement visible.
    const rad = area * Math.sqrt((i + 0.5) / count);
    const a = i * golden + range(rng, -0.3, 0.3);
    const x = Math.cos(a) * rad + range(rng, -16, 16);
    const y = Math.sin(a) * rad + range(rng, -16, 16);
    if (Math.hypot(x, y) > area) continue;
    const shape = shapes[Math.floor(rng() * shapes.length)];
    const rot = range(rng, -180, 180);
    const sc = range(rng, 0.8, 1.15);
    out += `<use href="#${shape}" xlink:href="#${shape}" transform="translate(${r1(x)},${r1(y)}) rotate(${r1(rot)}) scale(${r2(sc)})"/>`;
  }

  // Un voile crème très léger sous les bâtonnets : il unifie la couche et
  // empêche la julienne de ressembler à de la paille jetée sur du rouge.
  return `
    <circle r="${r1(area)}" fill="url(#atg-julienne)" opacity="0.2"/>
    <g filter="url(#atf-piece)">${out}</g>`;
}

/* ------------------------------------------------------------------ helpers */

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  Object.keys(attrs || {}).forEach((key) => node.setAttribute(key, attrs[key]));
  return node;
}

function r1(n) {
  return Math.round(n * 10) / 10;
}

function r2(n) {
  return Math.round(n * 100) / 100;
}
