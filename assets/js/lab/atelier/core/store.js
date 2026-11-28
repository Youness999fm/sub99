/**
 * État de la composition — store minimal avec abonnement.
 *
 * Volontairement sans dépendance : un seul objet d'état, des mutations
 * nommées, et une notification à tous les abonnés. C'est le point d'entrée
 * unique pour brancher plus tard un vrai panier (voir `toOrderPayload`).
 */

import { STEPS, getIngredient, getSize, supplementPrice } from '../data/ingredients.js';

const CATEGORY_ORDER = ['base', 'viandes', 'legumes', 'fromages'];

export function createStore() {
  const state = {
    sizeId: null,
    /** category -> tableau d'ids, dans l'ordre d'ajout par l'utilisateur. */
    selections: { base: [], viandes: [], legumes: [], fromages: [] },
    stepIndex: 0,
    /** Index le plus loin atteint : autorise la navigation arrière libre. */
    furthestStep: 0,
    baseCheese: false
  };

  const listeners = new Set();

  function notify(reason, detail) {
    listeners.forEach((fn) => fn(state, { reason, ...detail }));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ------------------------------------------------------------- lectures */

  function currentStep() {
    return STEPS[state.stepIndex];
  }

  function isSelected(id) {
    const ing = getIngredient(id);
    if (!ing) return false;
    return state.selections[ing.category].includes(id);
  }

  function selected(category) {
    return state.selections[category].slice();
  }

  /** Toutes les sélections à plat, dans l'ordre des calques de la pizza. */
  function allSelected() {
    return CATEGORY_ORDER.flatMap((cat) => state.selections[cat]);
  }

  function selectedCount(category) {
    return state.selections[category].length;
  }

  /** L'étape courante est-elle franchissable ? */
  function canAdvance() {
    const step = currentStep();
    if (step.kind === 'size') return Boolean(state.sizeId);
    if (step.kind === 'single') return state.selections[step.category].length > 0;
    return true;
  }

  /* ------------------------------------------------------------ mutations */

  function setSize(sizeId) {
    if (!getSize(sizeId) || state.sizeId === sizeId) return false;
    const previous = state.sizeId;
    state.sizeId = sizeId;
    notify('size', { sizeId, previous });
    return true;
  }

  /**
   * Bascule un ingrédient. Renvoie l'action réellement effectuée pour que
   * l'appelant sache quelle animation jouer :
   *   { action: 'added' | 'removed' | 'replaced', id, replacedId }
   */
  function toggleIngredient(id) {
    const ing = getIngredient(id);
    if (!ing) return null;
    const list = state.selections[ing.category];
    const at = list.indexOf(id);

    if (at >= 0) {
      // Une sauce est obligatoire : on ne la retire pas par simple re-clic,
      // on la remplace en choisissant une autre.
      if (ing.category === 'base') return null;
      list.splice(at, 1);
      notify('ingredient', { action: 'removed', id });
      return { action: 'removed', id };
    }

    if (ing.category === 'base') {
      const replacedId = list[0] || null;
      state.selections.base = [id];
      const firstSauce = !replacedId;
      if (firstSauce) state.baseCheese = true;
      notify('ingredient', { action: replacedId ? 'replaced' : 'added', id, replacedId });
      return { action: replacedId ? 'replaced' : 'added', id, replacedId, firstSauce };
    }

    list.push(id);
    notify('ingredient', { action: 'added', id });
    return { action: 'added', id };
  }

  function goToStep(index) {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, index));
    if (clamped === state.stepIndex) return false;
    if (clamped > state.furthestStep + 1) return false;
    state.stepIndex = clamped;
    state.furthestStep = Math.max(state.furthestStep, clamped);
    notify('step', { stepIndex: clamped });
    return true;
  }

  function nextStep() {
    return goToStep(state.stepIndex + 1);
  }

  function previousStep() {
    return goToStep(state.stepIndex - 1);
  }

  function reset() {
    state.sizeId = null;
    state.selections = { base: [], viandes: [], legumes: [], fromages: [] };
    state.stepIndex = 0;
    state.furthestStep = 0;
    state.baseCheese = false;
    notify('reset', {});
  }

  /**
   * Charge utile prête pour un vrai panier. Rien ne l'appelle en prototype :
   * elle existe pour que l'intégration future n'ait pas à fouiller l'état.
   * Le mapping vers `SubitoPizzaWidget` / `addLine()` se fera ici.
   */
  function toOrderPayload() {
    const size = getSize(state.sizeId);
    if (!size) return null;
    const extras = allSelected().map((id) => {
      const ing = getIngredient(id);
      return {
        id: ing.id,
        label: ing.label,
        category: ing.category,
        rate: ing.rate,
        price: supplementPrice(ing, size.id)
      };
    });
    return {
      product: 'pizza-composee',
      size: { id: size.id, label: size.label, diameter: size.diameter, price: size.price },
      extras,
      includesBaseCheese: state.baseCheese
    };
  }

  return {
    state,
    subscribe,
    currentStep,
    isSelected,
    selected,
    selectedCount,
    allSelected,
    canAdvance,
    setSize,
    toggleIngredient,
    goToStep,
    nextStep,
    previousStep,
    reset,
    toOrderPayload
  };
}
