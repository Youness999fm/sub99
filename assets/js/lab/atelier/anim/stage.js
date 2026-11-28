/**
 * Mise en scène — ce qui se passe entre le clic sur un bac et l'ingrédient
 * posé sur la pizza.
 *
 * Trois chorégraphies :
 *   1. `pourSauce`  — la louche puise dans le bac, verse au centre, puis la
 *                     sauce s'étale réellement (masque en spirale du canvas).
 *   2. `dropPortion`— une portion s'envole du bac, retombe sur la pâte et
 *                     éclate en morceaux qui se répartissent un par un.
 *   3. `grateCheese`— la râpe balaie la pizza et les copeaux tombent dans son
 *                     sillage (parmesan).
 *
 * Les éléments volants vivent dans un calque `position: fixed` au-dessus de
 * tout : ils peuvent donc voyager d'un bac (en haut de page) jusqu'au centre du
 * plan de travail sans se faire rogner par un overflow.
 */

import { createRng, range, intRange } from '../core/random.js';
import { animate, settle, settleAll, wait, EASE, prefersReducedMotion } from './motion.js';

export function createStage() {
  const overlay = document.createElement('div');
  overlay.className = 'atelier-stage';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  /* -------------------------------------------------------------- outils */

  function spawn(html, { width, ratio, x, y, rot = 0, scale = 1, zIndex = 1 }) {
    const node = document.createElement('div');
    node.className = 'atelier-stage__item';
    node.style.width = `${width}px`;
    node.style.height = `${width * ratio}px`;
    node.style.zIndex = String(zIndex);
    node.style.transform = pose({ x, y, rot, scale });
    node.innerHTML = html;
    overlay.appendChild(node);
    return node;
  }

  function pose({ x, y, rot = 0, scale = 1 }) {
    return `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${rot}deg) scale(${scale})`;
  }

  /** Bouffée de farine / éclaboussure au point d'impact. */
  function puff(x, y, size, color) {
    const node = spawn(
      `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="${color}"/></svg>`,
      { width: size, ratio: 1, x, y, scale: 0.3, zIndex: 0 }
    );
    node.style.filter = 'blur(6px)';
    return settle(
      animate(
        node,
        [
          { opacity: 0.55, transform: pose({ x, y, scale: 0.3 }) },
          { opacity: 0, transform: pose({ x, y, scale: 1.5 }) }
        ],
        { duration: 520, easing: EASE.out }
      )
    ).then(() => node.remove());
  }

  /* ----------------------------------------------------- 1. la sauce ---- */

  async function pourSauce({ tray, canvas, ingredient }) {
    const sauce = canvas.setSauce(ingredient);
    const origin = tray.binCenter(ingredient.id);
    const target = canvas.centerOnScreen();
    const radius = canvas.screenRadius();

    if (prefersReducedMotion() || !origin) {
      sauce.showInstantly();
      return;
    }

    const ladleWidth = Math.max(78, radius * 0.6);
    const ink = ingredient.sauce ? ingredient.sauce.ink : '#9E2214';
    const fillGrad = ingredient.sauce ? ingredient.sauce.pool : 'atg-pool-tomate';

    // Repère de la louche : le bol est à (0,0), le manche monte vers -64.
    const ladle = spawn(
      `<svg viewBox="-34 -66 68 94">
         <g filter="url(#atf-tool)">
           <use href="#atl-ladle" xlink:href="#atl-ladle"/>
           <g class="ladle-fill" opacity="0" style="color:${ink}">
             <use href="#atl-ladle-fill" xlink:href="#atl-ladle-fill"/>
           </g>
         </g>
       </svg>`,
      { width: ladleWidth, ratio: 94 / 68, x: origin.x, y: origin.y - radius * 0.9, scale: 0.9, zIndex: 3 }
    );
    // Le bol n'est pas au centre du cadre : on compense pour que le point
    // piloté soit bien le bol et pas le milieu du dessin.
    const bowlOffset = ladleWidth * (28 / 68);
    const fillEl = ladle.querySelector('.ladle-fill');

    const at = (x, y, rot, scale) => pose({ x, y: y + bowlOffset, rot, scale });

    // 1. descente vers le bac
    await settle(
      animate(
        ladle,
        [
          { transform: at(origin.x, origin.y - radius * 0.9, -14, 0.9) },
          { transform: at(origin.x, origin.y + 6, -6, 1) }
        ],
        { duration: 420, easing: EASE.inOut }
      )
    );

    // 2. puisage : la louche s'enfonce et se remplit
    await settleAll([
      animate(
        ladle,
        [
          { transform: at(origin.x, origin.y + 6, -6, 1) },
          { transform: at(origin.x - 6, origin.y + 14, 4, 1.02) },
          { transform: at(origin.x + 4, origin.y + 4, -4, 1) }
        ],
        { duration: 520, easing: EASE.inOut }
      ),
      animate(fillEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 220 }),
      tray.nudge(ingredient.id) || Promise.resolve()
    ]);

    // 3. transport jusqu'au centre de la pizza
    await settle(
      animate(
        ladle,
        [
          { transform: at(origin.x + 4, origin.y + 4, -4, 1) },
          { transform: at((origin.x + target.x) / 2, origin.y - radius * 0.5, -10, 1.04), offset: 0.55 },
          { transform: at(target.x, target.y - radius * 0.42, -6, 1) }
        ],
        { duration: 620, easing: EASE.inOut }
      )
    );

    // 4. versement : la louche bascule, une coulée tombe au centre
    const blob = spawn(
      `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="46" ry="42" fill="url(#${fillGrad})"/></svg>`,
      { width: radius * 0.46, ratio: 1, x: target.x, y: target.y - radius * 0.3, scale: 0.5, zIndex: 2 }
    );

    await settleAll([
      animate(
        ladle,
        [
          { transform: at(target.x, target.y - radius * 0.42, -6, 1) },
          { transform: at(target.x - radius * 0.06, target.y - radius * 0.46, 58, 1) }
        ],
        { duration: 380, easing: EASE.inOut }
      ),
      animate(fillEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 160 }),
      animate(
        blob,
        [
          { opacity: 0, transform: pose({ x: target.x, y: target.y - radius * 0.34, scale: 0.35 }) },
          { opacity: 1, transform: pose({ x: target.x, y: target.y - radius * 0.1, scale: 0.8 }), offset: 0.55 },
          { opacity: 1, transform: pose({ x: target.x, y: target.y, scale: 1.1 }) }
        ],
        { duration: 420, delay: 140, easing: EASE.drop }
      )
    ]);

    // 5. étalage : la sauce apparaît en spirale, la louche tourne au-dessus
    const sweep = sauceSweep(ladle, at, target, radius);
    await settleAll([
      sauce.spread(1040),
      animate(
        blob,
        [
          { opacity: 1, transform: pose({ x: target.x, y: target.y, scale: 1.1 }) },
          { opacity: 0, transform: pose({ x: target.x, y: target.y, scale: 2.1 }) }
        ],
        { duration: 420, easing: EASE.out }
      ),
      sweep
    ]);
    blob.remove();

    // 6. sortie
    await settle(
      animate(
        ladle,
        [
          { opacity: 1, transform: at(target.x, target.y - radius * 0.5, 20, 1) },
          { opacity: 0, transform: at(target.x + radius * 0.3, target.y - radius * 1.5, 40, 0.86) }
        ],
        { duration: 440, easing: EASE.out }
      )
    );
    ladle.remove();
  }

  /** Le dos de la louche qui tourne pour répartir : trois quarts de cercle. */
  function sauceSweep(ladle, at, target, radius) {
    const r = radius * 0.46;
    const frames = [];
    const steps = 9;
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * Math.PI * 1.85 - Math.PI * 0.4;
      frames.push({
        transform: at(
          target.x + Math.cos(t) * r * (0.35 + (0.65 * i) / steps),
          target.y + Math.sin(t) * r * (0.35 + (0.65 * i) / steps) - radius * 0.3,
          34 + i * 2,
          1
        )
      });
    }
    return animate(ladle, frames, { duration: 1040, easing: 'linear' });
  }

  /* ------------------------------------------- 2. viandes / légumes ---- */

  async function dropPortion({ tray, canvas, ingredient, entry }) {
    if (!entry) return;
    const origin = tray.binCenter(ingredient.id);
    const target = canvas.centerOnScreen();
    const radius = canvas.screenRadius();

    if (prefersReducedMotion() || !origin) {
      canvas.showIngredientInstantly(entry);
      return;
    }

    const shapes = (ingredient.art && ingredient.art.shapes) || [];
    const chipWidth = Math.max(54, radius * 0.34);
    const rng = createRng('fly-' + ingredient.id);
    const landing = {
      x: target.x + range(rng, -0.12, 0.12) * radius,
      y: target.y + range(rng, -0.12, 0.12) * radius
    };

    // La portion : un petit amas des vraies formes de l'ingrédient.
    const cluster = shapes.length
      ? Array.from({ length: 3 }, (_, i) => {
          const id = shapes[intRange(rng, 0, shapes.length - 1)];
          const a = (i / 3) * Math.PI * 2;
          return `<use href="#${id}" xlink:href="#${id}" transform="translate(${
            Math.cos(a) * 16
          },${Math.sin(a) * 13}) rotate(${range(rng, -40, 40)}) scale(1.05)"/>`;
        }).join('')
      : '';

    const chip = spawn(
      `<svg viewBox="-46 -46 92 92"><g filter="url(#atf-piece)">${cluster}</g></svg>`,
      { width: chipWidth, ratio: 1, x: origin.x, y: origin.y, scale: 0.8, zIndex: 2 }
    );

    tray.nudge(ingredient.id);

    // Trajectoire en cloche : la portion est soulevée puis retombe.
    const apexX = (origin.x + landing.x) / 2;
    const apexY = Math.min(origin.y, landing.y) - radius * 0.42;
    await settle(
      animate(
        chip,
        [
          { opacity: 0, transform: pose({ x: origin.x, y: origin.y, scale: 0.7, rot: 0 }) },
          { opacity: 1, transform: pose({ x: origin.x, y: origin.y - radius * 0.2, scale: 1, rot: -8 }), offset: 0.22 },
          { opacity: 1, transform: pose({ x: apexX, y: apexY, scale: 1.1, rot: 14 }), offset: 0.58 },
          { opacity: 1, transform: pose({ x: landing.x, y: landing.y, scale: 1.05, rot: 26 }) }
        ],
        { duration: 700, easing: 'cubic-bezier(0.38, 0.1, 0.62, 1)' }
      )
    );

    puff(landing.x, landing.y, radius * 0.5, '#FFF4DE');

    // Éclatement : la portion disparaît pendant que les morceaux se posent.
    const fade = animate(
      chip,
      [
        { opacity: 1, transform: pose({ x: landing.x, y: landing.y, scale: 1.05, rot: 26 }) },
        { opacity: 0, transform: pose({ x: landing.x, y: landing.y, scale: 1.5, rot: 34 }) }
      ],
      { duration: 240, easing: EASE.out }
    );

    // Les morceaux proches du point de chute apparaissent d'abord.
    const ordered = entry.pieces
      .map((p, i) => ({ p, i, d: Math.hypot(p.x, p.y) }))
      .sort((a, b) => a.d - b.d);
    await Promise.all(
      ordered.map(({ p }, rank) => canvas.revealPiece(p, 40 + rank * 38))
    );
    await settle(fade);
    chip.remove();
  }

  /* ----------------------------------------------- 3. la râpe (parmesan) */

  async function grateCheese({ tray, canvas, ingredient, entry }) {
    if (!entry) return;
    const target = canvas.centerOnScreen();
    const radius = canvas.screenRadius();
    const origin = tray.binCenter(ingredient.id);

    if (prefersReducedMotion() || !origin) {
      canvas.showIngredientInstantly(entry);
      return;
    }

    const graterWidth = Math.max(70, radius * 0.5);
    const grater = spawn(
      `<svg viewBox="-30 -60 60 100"><g filter="url(#atf-tool)">
         <use href="#atl-grater" xlink:href="#atl-grater"/>
       </g></svg>`,
      { width: graterWidth, ratio: 100 / 60, x: origin.x, y: origin.y, scale: 0.85, zIndex: 3 }
    );

    tray.nudge(ingredient.id);

    const left = target.x - radius * 0.85;
    const right = target.x + radius * 0.85;
    const high = target.y - radius * 0.72;

    await settle(
      animate(
        grater,
        [
          { opacity: 0, transform: pose({ x: origin.x, y: origin.y, scale: 0.8, rot: -18 }) },
          { opacity: 1, transform: pose({ x: left, y: high, scale: 1, rot: -14 }) }
        ],
        { duration: 460, easing: EASE.inOut }
      )
    );

    // Balayage gauche → droite, avec le tremblement du geste de râpage.
    const shake = [];
    const steps = 14;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      shake.push({
        transform: pose({
          x: left + (right - left) * t,
          y: high + Math.sin(t * Math.PI) * -radius * 0.12 + (i % 2 ? 5 : -5),
          rot: -14 + (i % 2 ? 6 : -2),
          scale: 1
        })
      });
    }

    // Les copeaux tombent dans le sillage : on les révèle de gauche à droite.
    const ordered = entry.pieces.slice().sort((a, b) => a.x - b.x);
    const sweepDuration = 1500;
    await Promise.all([
      settle(animate(grater, shake, { duration: sweepDuration, easing: 'linear' })),
      Promise.all(
        ordered.map((p, i) =>
          canvas.revealPiece(p, 120 + (i / Math.max(1, ordered.length - 1)) * (sweepDuration - 320))
        )
      )
    ]);

    await settle(
      animate(
        grater,
        [
          { opacity: 1, transform: pose({ x: right, y: high, scale: 1, rot: -10 }) },
          { opacity: 0, transform: pose({ x: right + radius * 0.3, y: high - radius * 0.7, scale: 0.84, rot: 10 }) }
        ],
        { duration: 400, easing: EASE.out }
      )
    );
    grater.remove();
  }

  /* ------------------------------------------------ 4. mozzarella base */

  async function spreadBaseCheese({ canvas }) {
    const handle = canvas.setBaseCheese({ hidden: true });
    await wait(prefersReducedMotion() ? 0 : 120);
    await handle.reveal();
  }

  function destroy() {
    overlay.remove();
  }

  return { pourSauce, dropPortion, grateCheese, spreadBaseCheese, destroy, element: overlay };
}
