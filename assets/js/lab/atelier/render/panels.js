/**
 * LeftStepPanel et RightSummaryPanel — les deux cartes flottantes.
 *
 * Gauche : où j'en suis, ce que je dois faire, ce que j'ai choisi à cette étape.
 * Droite : l'état complet de la pizza et le total, recalculé en direct.
 *
 * Les deux ne lisent que le store + PriceCalculator : aucune logique de prix
 * ici, aucun état local à resynchroniser.
 */

import { STEPS, getIngredient, formatPrice, BASE_CHEESE } from '../data/ingredients.js';
import { computePrice } from '../core/price.js';

const CATEGORY_TITLES = {
  base: 'Sauce',
  viandes: 'Viandes',
  legumes: 'Légumes',
  fromages: 'Fromages'
};

/* ------------------------------------------------------- panneau de gauche */

export function createStepPanel(root) {
  const panel = document.createElement('aside');
  panel.className = 'panel panel--step';
  panel.innerHTML = `
    <p class="panel__eyebrow"><span class="panel__step-num">1</span><span class="panel__step-total">/ ${STEPS.length}</span></p>
    <h2 class="panel__title"></h2>
    <p class="panel__help"></p>
    <div class="panel__picked">
      <p class="panel__picked-head"><span class="panel__picked-label">Sélection</span><span class="panel__count"></span></p>
      <ul class="chips"></ul>
      <p class="panel__empty">Rien pour l’instant — touchez un bac en haut.</p>
    </div>`;
  root.appendChild(panel);

  const numEl = panel.querySelector('.panel__step-num');
  const titleEl = panel.querySelector('.panel__title');
  const helpEl = panel.querySelector('.panel__help');
  const pickedEl = panel.querySelector('.panel__picked');
  const countEl = panel.querySelector('.panel__count');
  const chipsEl = panel.querySelector('.chips');
  const emptyEl = panel.querySelector('.panel__empty');

  function render(store, { onRemove }) {
    const { state } = store;
    const step = STEPS[state.stepIndex];
    numEl.textContent = String(state.stepIndex + 1);
    titleEl.textContent = step.title;
    helpEl.textContent = step.help;

    if (step.kind === 'size' || step.kind === 'recap') {
      pickedEl.hidden = true;
      return;
    }
    pickedEl.hidden = false;

    const ids = store.selected(step.category);
    countEl.textContent = ids.length
      ? `${ids.length} sélectionné${ids.length > 1 ? 's' : ''}`
      : '';
    emptyEl.hidden = ids.length > 0;
    chipsEl.innerHTML = '';

    ids.forEach((id) => {
      const ing = getIngredient(id);
      const li = document.createElement('li');
      li.className = 'chips__item';
      const removable = step.category !== 'base';
      li.innerHTML = `
        <span class="chips__name">${escapeHtml(ing.label)}</span>
        ${
          removable
            ? `<button type="button" class="chips__remove" aria-label="Retirer ${escapeHtml(ing.label)}">
                 <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
                      stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
               </button>`
            : '<span class="chips__fixed">base</span>'
        }`;
      const btn = li.querySelector('.chips__remove');
      if (btn) btn.addEventListener('click', () => onRemove(id));
      chipsEl.appendChild(li);
    });
  }

  return { render, element: panel };
}

/* -------------------------------------------------------- panneau de droite */

export function createSummaryPanel(root, { onPrimary, onReset }) {
  const panel = document.createElement('aside');
  panel.className = 'panel panel--summary';
  panel.innerHTML = `
    <button type="button" class="summary__toggle" aria-expanded="false">
      <span class="summary__toggle-label">Voir le détail</span>
    </button>
    <div class="summary__size">
      <span class="summary__size-name">Taille à choisir</span>
      <span class="summary__size-price"></span>
    </div>
    <div class="summary__body">
      <p class="summary__empty">La composition s’affichera ici au fur et à mesure.</p>
    </div>
    <div class="summary__foot">
      <div class="summary__total">
        <span class="summary__total-label">Total</span>
        <span class="summary__total-value">—</span>
      </div>
      <button type="button" class="btn-atelier btn-atelier--primary" data-action="primary"></button>
      <button type="button" class="btn-atelier btn-atelier--ghost" data-action="reset">Recommencer</button>
      <p class="summary__demo">Prototype — aucune commande n’est envoyée.</p>
    </div>`;
  root.appendChild(panel);

  // Sur petit écran le panneau devient une barre d'action : le total et le
  // bouton restent visibles, le détail se déplie vers le haut. Rien ne défile.
  const toggle = panel.querySelector('.summary__toggle');
  const toggleLabel = panel.querySelector('.summary__toggle-label');
  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggleLabel.textContent = open ? 'Masquer le détail' : 'Voir le détail';
  });

  const sizeName = panel.querySelector('.summary__size-name');
  const sizePrice = panel.querySelector('.summary__size-price');
  const body = panel.querySelector('.summary__body');
  const totalValue = panel.querySelector('.summary__total-value');
  const primary = panel.querySelector('[data-action="primary"]');
  panel.querySelector('[data-action="reset"]').addEventListener('click', onReset);
  primary.addEventListener('click', onPrimary);

  function render(store) {
    const { state } = store;
    const step = STEPS[state.stepIndex];
    const price = computePrice(store);

    sizeName.textContent = price.sizeLabel
      ? `${price.sizeLabel} · ${price.sizeDiameter}`
      : 'Taille à choisir';
    sizePrice.textContent = price.sizeLabel ? formatPrice(price.base) : '';
    panel.classList.toggle('has-size', Boolean(price.sizeLabel));

    body.innerHTML = '';
    const grouped = groupLines(price.lines);

    if (state.baseCheese) {
      body.appendChild(
        groupBlock('Base', [
          { label: BASE_CHEESE.label, price: 0, note: 'incluse' }
        ])
      );
    }

    Object.keys(CATEGORY_TITLES).forEach((category) => {
      const lines = grouped[category];
      if (!lines || !lines.length) return;
      body.appendChild(
        groupBlock(
          CATEGORY_TITLES[category],
          lines.map((line) => ({
            label: line.label,
            price: line.price,
            note: line.included ? 'incluse' : null
          }))
        )
      );
    });

    if (!body.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'summary__empty';
      empty.textContent = 'La composition s’affichera ici au fur et à mesure.';
      body.appendChild(empty);
    }

    const previousTotal = totalValue.dataset.value;
    totalValue.textContent = price.sizeLabel ? formatPrice(price.total) : '—';
    if (previousTotal !== undefined && previousTotal !== String(price.total)) {
      totalValue.classList.remove('is-bumped');
      // Reflow forcé : relance l'animation même si la classe était déjà là.
      void totalValue.offsetWidth;
      totalValue.classList.add('is-bumped');
    }
    totalValue.dataset.value = String(price.total);

    const last = state.stepIndex === STEPS.length - 1;
    primary.textContent = last ? 'Valider cette composition' : nextLabel(state.stepIndex);
    primary.disabled = !store.canAdvance() && !last;
    primary.classList.toggle('is-final', last);
  }

  function nextLabel(index) {
    const next = STEPS[index + 1];
    return next ? `Continuer — ${next.short}` : 'Continuer';
  }

  return { render, element: panel, primaryButton: primary };
}

/* ------------------------------------------------------------------ helpers */

function groupLines(lines) {
  return lines.reduce((acc, line) => {
    (acc[line.category] = acc[line.category] || []).push(line);
    return acc;
  }, {});
}

function groupBlock(title, entries) {
  const wrap = document.createElement('div');
  wrap.className = 'summary__group';
  wrap.innerHTML = `<p class="summary__group-title">${escapeHtml(title)}</p>`;
  const ul = document.createElement('ul');
  ul.className = 'summary__list';
  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'summary__line';
    li.innerHTML = `
      <span class="summary__line-name">${escapeHtml(entry.label)}</span>
      <span class="summary__line-price">${
        entry.note ? `<em>${escapeHtml(entry.note)}</em>` : '+ ' + formatPrice(entry.price)
      }</span>`;
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  return wrap;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
