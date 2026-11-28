/**
 * Socle d'animation — Web Animations API, sans librairie.
 *
 * Pourquoi pas GSAP / Framer Motion : le site est statique, vanilla, sans
 * bundler. Ajouter une librairie de motion pour ce module signifierait soit un
 * build, soit un CDN bloquant sur toutes les pages. La WAAPI fait tout ce dont
 * on a besoin (timelines séquencées via `await finished`, easings custom,
 * composition) et elle est accélérée par le compositeur.
 */

/** Easings maison, réutilisées partout pour une signature cohérente. */
export const EASE = {
  /** Sortie franche : le standard du module (apparitions, déplacements). */
  out: 'cubic-bezier(0.22, 0.75, 0.2, 1)',
  /** Entrée-sortie douce : va-et-vient des ustensiles. */
  inOut: 'cubic-bezier(0.55, 0.05, 0.25, 1)',
  /** Léger dépassement : l'ingrédient qui « claque » sur la pâte. */
  pop: 'cubic-bezier(0.34, 1.56, 0.5, 1)',
  /** Chute : accélère puis s'écrase. */
  drop: 'cubic-bezier(0.4, 0.02, 0.8, 0.52)'
};

let reducedQuery = null;

export function prefersReducedMotion() {
  if (!reducedQuery && window.matchMedia) {
    reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return Boolean(reducedQuery && reducedQuery.matches);
}

/**
 * Onglet en arrière-plan : le navigateur gèle `document.timeline`. Une
 * animation lancée à ce moment-là reste indéfiniment à `currentTime: 0` et ne
 * résout jamais sa promesse `finished` — ce qui bloquerait pour toujours la
 * file de mise en scène, et l'utilisateur retrouverait en revenant une pizza
 * figée au milieu d'un geste.
 *
 * On traite donc l'onglet caché comme le mode « mouvement réduit » : l'état
 * final est appliqué tout de suite. Et on termine d'autorité les animations
 * déjà en cours au moment où l'onglet disparaît.
 */
const live = new Set();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    live.forEach((animation) => {
      try {
        animation.finish();
      } catch (err) {
        /* animation déjà terminée ou non finissable : sans conséquence */
      }
    });
    live.clear();
  });
}

function isFrozen() {
  return typeof document !== 'undefined' && document.hidden;
}

/**
 * `element.animate()` avec `fill: 'both'` par défaut et une tolérance aux
 * navigateurs sans WAAPI (on applique alors l'état final immédiatement).
 */
export function animate(element, keyframes, options) {
  if (!element) return finishedStub();
  if (typeof element.animate !== 'function' || isFrozen()) {
    applyLastFrame(element, keyframes);
    return finishedStub();
  }
  const animation = element.animate(
    keyframes,
    Object.assign({ fill: 'both', easing: EASE.out }, options)
  );
  live.add(animation);
  const forget = () => live.delete(animation);
  animation.finished.then(forget, forget);
  return animation;
}

/**
 * Enchaîne : `await settle(animate(...))`. Accepte aussi une promesse, pour
 * mélanger librement animations et étapes de chorégraphie dans un même
 * `settleAll`. Ne rejette jamais (une animation annulée n'est pas une erreur).
 */
export function settle(animation) {
  if (!animation) return Promise.resolve();
  if (typeof animation.then === 'function') return animation.catch(() => {});
  if (!animation.finished) return Promise.resolve();
  return animation.finished.catch(() => {});
}

export function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Attend la fin d'une liste d'animations. */
export function settleAll(animations) {
  return Promise.all(animations.map(settle));
}

function applyLastFrame(element, keyframes) {
  const frames = Array.isArray(keyframes) ? keyframes : [keyframes];
  const last = frames[frames.length - 1] || {};
  Object.keys(last).forEach((prop) => {
    if (prop === 'offset' || prop === 'easing' || prop === 'composite') return;
    // Les clés de keyframes sont déjà en camelCase CSS (`strokeDashoffset`,
    // `transform`…) : elles s'appliquent telles quelles sur `style`.
    try {
      element.style[prop] = last[prop];
    } catch (err) {
      /* propriété non stylable : on l'ignore plutôt que de casser la séquence */
    }
  });
}

function finishedStub() {
  return { finished: Promise.resolve(), cancel() {} };
}

/**
 * File d'attente séquentielle : les clics rapides sur les bacs ne doivent pas
 * faire jouer deux mises en scène par-dessus l'autre (deux louches à l'écran,
 * une sauce qui s'étale pendant qu'on verse des olives…). Chaque tâche attend
 * la précédente, et on borne la file pour ne pas accumuler 30 animations si
 * l'utilisateur martèle les bacs.
 */
export function createQueue(maxPending = 3) {
  let tail = Promise.resolve();
  let pending = 0;

  return function enqueue(task) {
    if (pending >= maxPending) return { skipped: true, done: Promise.resolve() };
    pending += 1;
    const done = tail.then(task).catch((err) => {
      if (window.console) window.console.error('[atelier]', err);
    });
    tail = done.then(() => {
      pending -= 1;
    });
    return { skipped: false, done };
  };
}
