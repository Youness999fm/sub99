/**
 * ComposePizzaPage — assemblage de L'Atelier Subito.
 *
 * PROTOTYPE ISOLÉ. Ce module ne touche ni au panier (`cart.js`), ni au
 * localStorage, ni à aucune API : il s'initialise sur un conteneur qu'on lui
 * passe et n'a aucun effet de bord ailleurs dans la page. Le seul point de
 * sortie prévu est `store.toOrderPayload()`.
 *
 *   import { mountAtelier } from './index.js';
 *   mountAtelier(document.querySelector('#atelier'));
 *
 * CONTRAINTE STRUCTURANTE : l'expérience tient dans un écran, sur téléphone
 * comme sur ordinateur. Rien ne défile, et le bouton d'action reste toujours
 * visible. La mise en page est en CSS ; ce qui ne peut pas l'être — la taille
 * des bacs, qui dépend à la fois du nombre d'ingrédients de l'étape et de la
 * hauteur réellement disponible — est calculé ici.
 */

import { STEPS, getIngredient, getSize, formatPrice, BASE_CHEESE } from './data/ingredients.js';
import { createStore } from './core/store.js';
import { computePrice } from './core/price.js';
import { mountSprite } from './render/svg-defs.js';
import { createPizzaCanvas } from './render/pizza-canvas.js';
import { createKitchen } from './render/kitchen.js';
import { createTray } from './render/tray.js';
import { createProgress } from './render/progress.js';
import { createStepPanel, createSummaryPanel } from './render/panels.js';
import { createStage } from './anim/stage.js';
import { createQueue, animate, settle, EASE, prefersReducedMotion } from './anim/motion.js';

/** Part de la hauteur que le rail a le droit de prendre, selon le nombre de rangées. */
const RAIL_SHARE = { 1: 0.3, 2: 0.44 };
/** Hauteur réservée au libellé sous un bac. */
const LABEL_H = 34;
/** Rapport hauteur/largeur du dessin d'un bac (viewBox 240 × 180). */
const BIN_RATIO = 0.75;

export function mountAtelier(root) {
  if (!root) throw new Error('mountAtelier: conteneur manquant');
  mountSprite();

  /* ---------------------------------------------------------- squelette */

  root.classList.add('atelier-app');
  root.innerHTML = `
    <div class="atelier-app__progress"></div>
    <div class="atelier-app__tray tray">
      <p class="tray__hint"></p>
    </div>
    <div class="atelier-app__floor">
      <div class="floor__canvas"></div>
      <p class="floor__caption"></p>
    </div>
    <p class="atelier-app__live visually-hidden-atelier" role="status" aria-live="polite"></p>`;

  const progressRoot = root.querySelector('.atelier-app__progress');
  const trayRoot = root.querySelector('.atelier-app__tray');
  const trayHint = root.querySelector('.tray__hint');
  const canvasRoot = root.querySelector('.floor__canvas');
  const caption = root.querySelector('.floor__caption');
  const live = root.querySelector('.atelier-app__live');

  /* ------------------------------------------------------------ éléments */

  const store = createStore();
  // Le plan de travail est posé en premier : tout le reste vit dessus. L'arête
  // du rail est calée sur le bas réel de la rangée de bacs.
  // L'arête tombe sous le bloc complet (bacs + libellés), pas sous la seule
  // rangée : sinon les libellés de la dernière rangée se retrouvent à cheval
  // sur la tôle claire et deviennent illisibles.
  const kitchen = createKitchen(root, {
    railAnchor: () => root.querySelector('.atelier-app__tray')
  });
  const canvas = createPizzaCanvas(canvasRoot);
  const stage = createStage();
  const enqueue = createQueue(3);

  const progress = createProgress(progressRoot, {
    onGoToStep: (index) => {
      if (store.goToStep(index)) renderAll();
    }
  });

  const tray = createTray(trayRoot, {
    onPickSize: (size) => pickSize(size),
    onPickIngredient: (ingredient) => pickIngredient(ingredient)
  });

  // Les deux panneaux sont des enfants directs du conteneur : flottants dans
  // les coins sur grand écran, bandeaux dans le flux sur petit écran. C'est la
  // CSS qui décide, pas le JS.
  const stepPanel = createStepPanel(root);
  const summaryPanel = createSummaryPanel(root, {
    onPrimary: () => advance(),
    onReset: () => resetAll()
  });

  /* ------------------------------------------------------------- actions */

  function pickSize(size) {
    if (!store.setSize(size.id)) return;
    canvas.setSize(size.id);
    announce(`Taille ${size.label}, ${size.diameter}. Base ${formatPrice(size.price)}.`);
    renderAll();
  }

  function pickIngredient(ingredient) {
    const result = store.toggleIngredient(ingredient.id);
    if (!result) return;
    renderAll();

    if (result.action === 'removed') {
      announce(`${ingredient.label} retiré. Total ${formatPrice(computePrice(store).total)}.`);
      enqueue(() => canvas.removeIngredient(ingredient.id));
      return;
    }

    announce(`${ingredient.label} ajouté. Total ${formatPrice(computePrice(store).total)}.`);

    if (ingredient.category === 'base') {
      enqueue(async () => {
        // Un changement de sauce efface la précédente avant de reverser.
        if (result.replacedId) canvas.clearSauce();
        await stage.pourSauce({ tray, canvas, ingredient });
        if (result.firstSauce) {
          await stage.spreadBaseCheese({ canvas });
          renderAll();
        }
      });
      return;
    }

    enqueue(async () => {
      // L'utilisateur a pu re-cliquer pour retirer pendant l'attente :
      // dans ce cas on ne pose rien du tout.
      if (!store.isSelected(ingredient.id)) return;
      const entry = canvas.addIngredient(ingredient, { hidden: true });
      if (ingredient.effect === 'rape') {
        await stage.grateCheese({ tray, canvas, ingredient, entry });
      } else {
        await stage.dropPortion({ tray, canvas, ingredient, entry });
      }
    });
  }

  function advance() {
    const last = store.state.stepIndex === STEPS.length - 1;
    if (last) {
      validateDemo();
      return;
    }
    if (!store.canAdvance()) {
      nudgeTray();
      return;
    }
    store.nextStep();
    renderAll();
  }

  function removeFromPanel(id) {
    const ingredient = getIngredient(id);
    if (ingredient) pickIngredient(ingredient);
  }

  function resetAll() {
    store.reset();
    canvas.reset();
    canvas.setSize('duo', { animate: false });
    renderAll();
    announce('Composition réinitialisée.');
  }

  /** Démo : rien n'est envoyé, on expose juste la charge utile. */
  function validateDemo() {
    const payload = store.toOrderPayload();
    if (window.console) window.console.info('[atelier] composition validée (démo) :', payload);
    toast('Composition validée — prototype, rien n’a été commandé.');
    if (!prefersReducedMotion()) {
      // Sur le conteneur et non sur le <svg> : les transformations du SVG ont
      // leur origine au coin du viewBox, pas au centre.
      animate(
        canvasRoot,
        [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
        { duration: 760, easing: EASE.pop }
      );
    }
  }

  function nudgeTray() {
    if (prefersReducedMotion()) return;
    animate(
      tray.element,
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-7px)' },
        { transform: 'translateX(7px)' },
        { transform: 'translateX(0)' }
      ],
      { duration: 320 }
    );
  }

  /* ------------------------------------------------------- mise en page */

  /**
   * Dimensionne les bacs pour qu'ils tiennent TOUJOURS dans l'écran.
   *
   * Deux contraintes à satisfaire en même temps : la largeur disponible
   * divisée par le nombre de bacs de la rangée, et la hauteur que le rail a le
   * droit de prendre. On garde la plus petite des deux — c'est ce qui évite à
   * la fois le débordement horizontal et le rail qui mange la pizza.
   */
  function layoutTray() {
    const row = tray.element;
    const cards = Array.from(row.children).filter((c) => c.dataset.outgoing !== '1');
    const count = cards.length;
    if (!count) return;

    const appHeight = root.clientHeight;
    const available = row.clientWidth || root.clientWidth;
    if (!appHeight || !available) return;

    const gap = parseFloat(getComputedStyle(root).getPropertyValue('--tray-gap')) || 10;
    const rows = count <= 5 ? 1 : 2;
    const perRow = Math.ceil(count / rows);

    const railBudget = appHeight * RAIL_SHARE[rows];
    const widthFromHeight = Math.max(40, railBudget / rows - LABEL_H) / BIN_RATIO;
    const widthFromWidth = (available - gap * (perRow - 1)) / perRow;

    const width = Math.max(52, Math.min(150, widthFromWidth, widthFromHeight));
    root.style.setProperty('--card-w', `${Math.floor(width)}px`);
  }

  let relayoutHandle = null;
  function relayout() {
    if (relayoutHandle) return;
    relayoutHandle = requestAnimationFrame(() => {
      relayoutHandle = null;
      layoutTray();
      kitchen.sync();
    });
  }

  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);

  /* --------------------------------------------------------------- rendu */

  function renderAll() {
    const { state } = store;
    const step = STEPS[state.stepIndex];
    root.dataset.step = step.id;

    progress.render(state);
    stepPanel.render(store, { onRemove: removeFromPanel });
    summaryPanel.render(store);

    if (step.kind === 'recap') {
      renderFinalStrip();
    } else {
      trayRoot.classList.remove('is-recap');
      const existing = trayRoot.querySelector('.final-strip');
      if (existing) existing.remove();
      tray.element.hidden = false;
      tray.renderStep(step, store);
      trayHint.textContent = trayHintFor(step, state);
      trayHint.hidden = false;
    }

    caption.textContent = captionFor(step, state);

    // Le nombre de bacs change d'une étape à l'autre : la taille des cartes et
    // l'arête du rail doivent suivre, avant puis après l'animation d'entrée.
    relayout();
    window.setTimeout(relayout, 420);
  }

  function trayHintFor(step, state) {
    if (step.kind === 'size') return 'Les bacs changent à chaque étape — commencez par la taille.';
    if (!state.sizeId) return 'Choisissez d’abord une taille pour voir les prix.';
    if (step.kind === 'single') return 'Une seule sauce : toucher un autre bac remplace la précédente.';
    return 'Touchez un bac pour en verser sur la pizza, touchez-le à nouveau pour le retirer.';
  }

  function captionFor(step, state) {
    const size = getSize(state.sizeId);
    if (!size) return 'Pâte façonnée — en attente de la taille';
    if (step.kind === 'recap') return `${size.label} · ${size.diameter} — composition terminée`;
    return `${size.label} · ${size.diameter}`;
  }

  /** Étape finale : les bacs laissent place au récapitulatif de la pizza. */
  function renderFinalStrip() {
    tray.element.hidden = true;
    trayHint.hidden = true;
    trayRoot.classList.add('is-recap');
    let strip = trayRoot.querySelector('.final-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'final-strip';
      trayRoot.appendChild(strip);
      if (!prefersReducedMotion()) {
        animate(
          strip,
          [
            { opacity: 0, transform: 'translateY(-14px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ],
          { duration: 460, easing: EASE.out }
        );
      }
    }

    const price = computePrice(store);
    const chips = [];
    if (store.state.baseCheese) chips.push({ label: BASE_CHEESE.label, included: true });
    price.lines.forEach((line) => chips.push({ label: line.label, included: line.included }));

    strip.innerHTML = `
      <div class="final-strip__head">
        <p class="final-strip__eyebrow">Votre pizza composée</p>
        <p class="final-strip__size">${price.sizeLabel || '—'}<small>${price.sizeDiameter || ''}</small></p>
      </div>
      <ul class="final-strip__chips">
        ${chips
          .map(
            (c) =>
              `<li class="${c.included ? 'is-included' : ''}">${escapeHtml(c.label)}${
                c.included ? '<small>incluse</small>' : ''
              }</li>`
          )
          .join('')}
      </ul>
      <p class="final-strip__total"><span>Total</span><strong>${formatPrice(price.total)}</strong></p>`;
  }

  /* ------------------------------------------------------------ services */

  function announce(message) {
    live.textContent = message;
  }

  let toastTimer = null;
  function toast(message) {
    let node = root.querySelector('.atelier-toast');
    if (!node) {
      node = document.createElement('p');
      node.className = 'atelier-toast';
      node.setAttribute('role', 'status');
      root.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('is-visible'), 3600);
  }

  /* ------------------------------------------------------------ amorçage */

  // Taille par défaut sur le canvas uniquement : l'état, lui, reste vide tant
  // que l'utilisateur n'a pas choisi (le résumé affiche « à choisir »).
  canvas.setSize('duo', { animate: false });
  renderAll();

  if (!prefersReducedMotion()) {
    settle(
      animate(
        canvasRoot,
        [
          { opacity: 0, transform: 'scale(0.9) translateY(18px)' },
          { opacity: 1, transform: 'scale(1) translateY(0)' }
        ],
        { duration: 760, easing: EASE.out }
      )
    );
  }

  return {
    store,
    canvas,
    relayout,
    destroy() {
      window.removeEventListener('resize', relayout);
      window.removeEventListener('orientationchange', relayout);
      stage.destroy();
      root.innerHTML = '';
      root.classList.remove('atelier-app');
    }
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Démarrage automatique si la page expose le conteneur attendu. */
const auto = document.querySelector('[data-atelier-root]');
if (auto) mountAtelier(auto);
