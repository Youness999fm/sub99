/**
 * Le plan de travail — la scène, pas un fond d'écran.
 *
 * Toute l'expérience se déroule sur UNE surface continue : le rail réfrigéré
 * où les bacs sont encastrés et la zone de travail où repose la pizza
 * appartiennent au même plan inox. C'est ce qui fait la différence entre
 * « une interface avec une photo de cuisine derrière » et « on regarde dans la
 * cuisine » (§07, §08).
 *
 * L'inox est construit en couches superposées, parce qu'un dégradé gris ne
 * trompe personne :
 *   1. la courbure de la tôle (dégradé radial, lampe en haut à gauche) ;
 *   2. le grain anisotrope du brossage (bruit très étiré horizontalement) ;
 *   3. les rayures d'usage, plus longues et plus rares ;
 *   4. le halo de la lampe, puis l'assombrissement des angles.
 *
 * Et par-dessus, ce qui donne la vie : la farine. Un voile, des grains avec
 * leur micro-ombre, et une trace balayée le long du rail.
 *
 * La séparation rail / zone de travail n'est pas une proportion arbitraire :
 * elle est mesurée sur la rangée de bacs réelle, et suivie en continu. Sinon
 * l'arête du rail tombe au milieu de rien dès que la mise en page change.
 */

import { createRng, range } from '../core/random.js';

/**
 * Les deux tôles sont rendues en `slice` et non en `none` : étirer le viewBox
 * déforme le bruit du brossage et fait basculer le grain à la verticale dès
 * que la fenêtre est étroite. On préfère recadrer — l'inox n'a de toute façon
 * pas de composition à préserver.
 */
const RAIL_VB = { w: 1600, h: 400 };
const BENCH_VB = { w: 1600, h: 900 };

export function createKitchen(root, { railAnchor } = {}) {
  const node = document.createElement('div');
  node.className = 'kitchen';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `
    <div class="kitchen__rail">
      <svg viewBox="0 0 ${RAIL_VB.w} ${RAIL_VB.h}" preserveAspectRatio="xMidYMid slice">
        <rect width="${RAIL_VB.w}" height="${RAIL_VB.h}" fill="url(#atg-rail)"/>
        <rect width="${RAIL_VB.w}" height="${RAIL_VB.h}" fill="#FFFFFF" opacity="0.16"
              filter="url(#atf-brushed)" style="mix-blend-mode:overlay"/>
        <rect width="${RAIL_VB.w}" height="${RAIL_VB.h}" fill="#FFFFFF" opacity="0.06"
              filter="url(#atf-scratches)" style="mix-blend-mode:screen"/>
        <!-- Le néon du passe, réfléchi en bande sur la tôle du fond. -->
        <ellipse cx="${RAIL_VB.w * 0.33}" cy="${RAIL_VB.h * 0.22}" rx="${RAIL_VB.w * 0.42}"
                 ry="${RAIL_VB.h * 0.3}" fill="url(#atg-lamp)" style="mix-blend-mode:screen"/>
        <rect width="${RAIL_VB.w}" height="${RAIL_VB.h}" fill="url(#atg-corners)"
              style="mix-blend-mode:multiply"/>
        <rect x="0" y="${RAIL_VB.h - 30}" width="${RAIL_VB.w}" height="30" fill="url(#atg-rail-lip)"/>
      </svg>
      <span class="kitchen__edge"></span>
    </div>

    <div class="kitchen__bench">
      <svg viewBox="0 0 ${BENCH_VB.w} ${BENCH_VB.h}" preserveAspectRatio="xMidYMid slice">
        <rect width="${BENCH_VB.w}" height="${BENCH_VB.h}" fill="url(#atg-worktop)"/>
        <rect width="${BENCH_VB.w}" height="${BENCH_VB.h}" fill="#FFFFFF" opacity="0.12"
              filter="url(#atf-brushed)" style="mix-blend-mode:overlay"/>
        <rect width="${BENCH_VB.w}" height="${BENCH_VB.h}" fill="#FFFFFF" opacity="0.08"
              filter="url(#atf-scratches)" style="mix-blend-mode:screen"/>
        <g opacity="0.32">${longScratches()}</g>
        <ellipse cx="${BENCH_VB.w * 0.3}" cy="${-BENCH_VB.h * 0.1}" rx="${BENCH_VB.w * 0.7}"
                 ry="${BENCH_VB.h * 0.85}" fill="url(#atg-lamp)" style="mix-blend-mode:screen"/>
        <rect width="${BENCH_VB.w}" height="${BENCH_VB.h}" fill="url(#atg-corners)"
              style="mix-blend-mode:multiply"/>
        <rect x="0" y="0" width="${BENCH_VB.w}" height="46" fill="url(#atg-rail-shadow)"/>
        <g>${flour()}</g>
      </svg>
    </div>`;

  root.insertBefore(node, root.firstChild);

  const rail = node.querySelector('.kitchen__rail');
  const bench = node.querySelector('.kitchen__bench');

  /** Cale l'arête du rail sur le bas réel de la rangée de bacs. */
  function sync() {
    const anchor = typeof railAnchor === 'function' ? railAnchor() : null;
    if (!anchor || !anchor.isConnected) return;
    const rootBox = root.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    if (!rootBox.height) return;
    const edge = Math.max(0, Math.min(rootBox.height, anchorBox.bottom - rootBox.top));
    rail.style.height = `${edge}px`;
    bench.style.top = `${edge}px`;
  }

  // La cuisine est montée avant la rangée de bacs : au premier appel l'ancre
  // n'existe pas encore. On re-cale donc à l'apparition, puis on suit.
  let observer = null;
  let watched = null;

  function syncAndWatch() {
    sync();
    const anchor = typeof railAnchor === 'function' ? railAnchor() : null;
    if (observer && anchor && anchor !== watched) {
      if (watched) observer.unobserve(watched);
      observer.observe(anchor);
      watched = anchor;
    }
  }

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(sync);
    observer.observe(root);
  }

  syncAndWatch();
  requestAnimationFrame(syncAndWatch);
  // Les bacs arrivent avec une animation d'entrée : une dernière passe une fois
  // la rangée stabilisée.
  window.setTimeout(syncAndWatch, 400);
  window.addEventListener('resize', sync);

  return { element: node, sync };
}

/** Rayures longues : le vrai inox en a peu, mais elles se voient. */
function longScratches() {
  const rng = createRng('scratches');
  let out = '';
  for (let i = 0; i < 30; i += 1) {
    const y = range(rng, 0, BENCH_VB.h);
    const x = range(rng, -100, BENCH_VB.w);
    const len = range(rng, 60, 520);
    const tilt = range(rng, -2.5, 2.5);
    const light = rng() > 0.45;
    out += `<path d="M${r(x)},${r(y)} L${r(x + len)},${r(y + tilt)}"
      stroke="${light ? '#F2F7FA' : '#1B2125'}" stroke-opacity="${r2(range(rng, 0.12, 0.42))}"
      stroke-width="${r2(range(rng, 0.6, 1.5))}" stroke-linecap="round"/>`;
  }
  return out;
}

/**
 * La farine. Trois registres : le voile presque invisible, les grains isolés
 * — chacun avec sa micro-ombre, sans quoi ils flottent — et une trace balayée,
 * celle que laisse une main qui a repoussé la farine vers le bord du plan.
 */
function flour() {
  const rng = createRng('flour');
  const { w, h } = BENCH_VB;
  let out = '';

  for (let i = 0; i < 8; i += 1) {
    out += `<ellipse cx="${r(range(rng, w * 0.1, w * 0.9))}" cy="${r(range(rng, 60, h - 30))}"
      rx="${r(range(rng, 70, 190))}" ry="${r(range(rng, 24, 64))}"
      fill="#FFFDF6" opacity="${r2(range(rng, 0.04, 0.09))}" filter="url(#atf-soft)"/>`;
  }

  for (let i = 0; i < 210; i += 1) {
    const x = range(rng, 16, w - 16);
    const y = range(rng, 18, h - 8);
    const s = range(rng, 0.7, 2.3);
    out += `<circle cx="${r(x + 0.7)}" cy="${r(y + 0.9)}" r="${r2(s)}" fill="#0C1013" opacity="0.32"/>`;
    out += `<circle cx="${r(x)}" cy="${r(y)}" r="${r2(s)}" fill="#FFFCF2" opacity="${r2(range(rng, 0.55, 0.95))}"/>`;
  }

  out += `<path d="M${w * 0.07},64 C${w * 0.3},46 ${w * 0.62},80 ${w * 0.94},58"
    fill="none" stroke="#FFFBF0" stroke-opacity="0.1" stroke-width="26" stroke-linecap="round"
    filter="url(#atf-soft)"/>`;

  return out;
}

function r(n) {
  return Math.round(n * 10) / 10;
}

function r2(n) {
  return Math.round(n * 100) / 100;
}
