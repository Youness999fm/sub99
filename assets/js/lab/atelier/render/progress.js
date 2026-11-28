/**
 * StepProgress — fil d'étapes horizontal.
 *
 * Les étapes déjà franchies sont cliquables (on revient librement en arrière),
 * celles qui restent sont inertes : impossible de sauter la taille ou la sauce.
 */

import { STEPS } from '../data/ingredients.js';

export function createProgress(root, { onGoToStep }) {
  const nav = document.createElement('nav');
  nav.className = 'steps';
  nav.setAttribute('aria-label', 'Progression de la composition');

  const list = document.createElement('ol');
  list.className = 'steps__list';

  const items = STEPS.map((step, index) => {
    const li = document.createElement('li');
    li.className = 'steps__item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'steps__btn';
    button.dataset.step = String(index);
    button.innerHTML = `
      <span class="steps__dot" aria-hidden="true">${index + 1}</span>
      <span class="steps__label">${step.short}</span>`;
    button.addEventListener('click', () => onGoToStep(index));

    li.appendChild(button);
    list.appendChild(li);
    return { li, button };
  });

  const bar = document.createElement('div');
  bar.className = 'steps__bar';
  bar.innerHTML = '<span class="steps__fill"></span>';
  const fill = bar.querySelector('.steps__fill');

  nav.appendChild(bar);
  nav.appendChild(list);
  root.appendChild(nav);

  function render(state) {
    items.forEach(({ li, button }, index) => {
      const done = index < state.stepIndex;
      const current = index === state.stepIndex;
      const reachable = index <= state.furthestStep;
      li.classList.toggle('is-done', done);
      li.classList.toggle('is-current', current);
      li.classList.toggle('is-locked', !reachable);
      button.disabled = !reachable;
      button.setAttribute('aria-current', current ? 'step' : 'false');
    });
    const ratio = STEPS.length > 1 ? state.stepIndex / (STEPS.length - 1) : 0;
    fill.style.transform = `scaleX(${ratio})`;
  }

  return { render, element: nav };
}
