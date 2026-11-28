/**
 * IngredientTray + IngredientCard — le mur de bacs.
 *
 * Un bac gastronorme par ingrédient, dessiné en légère plongée (la perspective
 * est appliquée en CSS sur le seul visuel, jamais sur le texte, qui doit rester
 * parfaitement lisible). Le contenu du bac réutilise la forme exacte de
 * l'ingrédient : ce qu'on voit dans le bac est ce qui tombera sur la pizza.
 */

import { SIZES, formatPrice, ingredientsOfCategory } from '../data/ingredients.js';
import { previewPrice } from '../core/price.js';
import { trayFill, PAN, panRect } from './svg-defs.js';
import { animate, settle, EASE, prefersReducedMotion } from '../anim/motion.js';

let clipUid = 0;

export function createTray(root, { onPickIngredient, onPickSize }) {
  const list = document.createElement('div');
  list.className = 'tray__row';
  root.appendChild(list);

  let mode = null;
  let currentKey = null;

  /* ------------------------------------------------------------- rendu */

  function renderStep(step, store) {
    const key = step.kind === 'size' ? 'size' : step.category;
    if (key === currentKey) {
      syncSelection(store);
      return;
    }
    const outgoing = Array.from(list.children);
    currentKey = key;
    mode = step.kind === 'size' ? 'size' : 'ingredient';

    // Sortie des anciens bacs : léger retrait vers le haut, en cascade.
    // Ils restent quelques centaines de millisecondes dans le DOM : on les
    // marque pour que syncSelection les ignore, sinon elle tente de lire le
    // prix d'une carte de taille comme si c'était un ingrédient.
    outgoing.forEach((node, i) => {
      node.dataset.outgoing = '1';
      if (prefersReducedMotion()) {
        node.remove();
        return;
      }
      settle(
        animate(
          node,
          [
            { opacity: 1, transform: 'translateY(0) scale(1)' },
            { opacity: 0, transform: 'translateY(-22px) scale(0.94)' }
          ],
          { duration: 210, delay: i * 18, easing: EASE.out }
        )
      ).then(() => node.remove());
    });

    const cards =
      mode === 'size'
        ? SIZES.map((size) => sizeCard(size))
        : ingredientsOfCategory(step.category).map((ing) => ingredientCard(ing, store));

    const holder = document.createDocumentFragment();
    cards.forEach((card) => holder.appendChild(card));
    list.appendChild(holder);

    cards.forEach((card, i) => {
      if (prefersReducedMotion()) return;
      animate(
        card,
        [
          { opacity: 0, transform: 'translateY(26px) scale(0.94)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ],
        { duration: 440, delay: 120 + i * 48, easing: EASE.out }
      );
    });

    syncSelection(store);
  }

  /** Met à jour prix et état sélectionné sans re-créer les cartes. */
  function syncSelection(store) {
    Array.from(list.children).forEach((card) => {
      if (card.dataset.outgoing === '1') return;
      const id = card.dataset.id;
      if (mode === 'size') {
        const active = store.state.sizeId === id;
        card.setAttribute('aria-pressed', String(active));
        card.classList.toggle('is-active', active);
        return;
      }
      const active = store.isSelected(id);
      card.setAttribute('aria-pressed', String(active));
      card.classList.toggle('is-active', active);
      const priceEl = card.querySelector('.tray-card__price');
      if (priceEl && card.__ingredient) {
        const ing = card.__ingredient;
        const price = previewPrice(ing, store.state.sizeId);
        priceEl.textContent = priceLabel(ing, price);
      }
    });
  }

  function priceLabel(ingredient, price) {
    if (price === null) return '';
    if (ingredient.includedInBase) return 'Incluse';
    return '+ ' + formatPrice(price);
  }

  /* ------------------------------------------------------------- cartes */

  function ingredientCard(ingredient, store) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tray-card';
    card.dataset.id = ingredient.id;
    card.__ingredient = ingredient;
    card.setAttribute('aria-pressed', 'false');

    const price = previewPrice(ingredient, store.state.sizeId);
    card.innerHTML = `
      <span class="tray-card__bin" aria-hidden="true">${bin(ingredient)}</span>
      <span class="tray-card__meta">
        <span class="tray-card__name">${escapeHtml(ingredient.label)}</span>
        <span class="tray-card__price">${priceLabel(ingredient, price)}</span>
      </span>
      <span class="tray-card__badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4.5 4.5L19 7"/></svg>
      </span>`;

    card.addEventListener('click', () => onPickIngredient(ingredient, card));
    return card;
  }

  function sizeCard(size) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tray-card tray-card--size';
    card.dataset.id = size.id;
    card.setAttribute('aria-pressed', 'false');
    // Pastille proportionnelle au diamètre réel : l'écart Solo → XXL doit se
    // lire d'un coup d'œil, ce que l'échelle du canvas (compressée) ne donne pas.
    const disc = 30 + (size.cm / 50) * 50;
    card.innerHTML = `
      <span class="tray-card__bin tray-card__bin--size" aria-hidden="true">
        <svg viewBox="0 0 200 150">
          <ellipse cx="100" cy="82" rx="${disc * 1.05}" ry="${disc * 0.95}" fill="url(#atg-shadow)" opacity="0.7"/>
          <circle cx="100" cy="76" r="${disc}" fill="url(#atg-crust-ring)"/>
          <circle cx="100" cy="76" r="${disc * 0.88}" fill="url(#atg-dough)"/>
          <circle cx="100" cy="76" r="${disc * 0.88}" fill="none" stroke="#B07C3C" stroke-width="1.6" opacity="0.3"/>
        </svg>
      </span>
      <span class="tray-card__meta">
        <span class="tray-card__name">${size.label}</span>
        <span class="tray-card__price">${formatPrice(size.price)}</span>
        <span class="tray-card__sub">${size.diameter}</span>
      </span>
      <span class="tray-card__badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4.5 4.5L19 7"/></svg>
      </span>`;
    card.addEventListener('click', () => onPickSize(size, card));
    return card;
  }

  /**
   * Bac gastronorme vu en plongée.
   *
   * Monté comme un vrai récipient et non comme une image plate : ombre portée
   * sur le rail, bord roulé avec son arête vive au nord-ouest, paroi
   * intérieure dont le côté éclairé est à l'opposé de la source, fond, puis
   * contenu entassé. Toute la lumière vient du haut-gauche, comme partout
   * ailleurs dans la scène.
   */
  function bin(ingredient) {
    const clipId = `bin-clip-${(clipUid += 1)}`;
    return `
      <svg viewBox="0 0 ${PAN.box.w} ${PAN.box.h}">
        <defs>
          <clipPath id="${clipId}">${panRect('cavity')}</clipPath>
        </defs>

        <!-- Ombre du bac sur le rail -->
        <rect x="${PAN.outer.x + 5}" y="${PAN.outer.y + 9}" width="${PAN.outer.w}"
              height="${PAN.outer.h}" rx="${PAN.outer.r}" fill="#0A0D10" opacity="0.5"
              filter="url(#atf-soft)"/>

        <!-- Bord roulé -->
        ${panRect('outer', 'fill="url(#atg-pan-rim)"')}
        ${panRect('outer', 'fill="#FFF" opacity="0.12" filter="url(#atf-brushed)"')}
        <path d="M${PAN.outer.x + PAN.outer.r},${PAN.outer.y + 2.5} H${PAN.outer.x + PAN.outer.w - PAN.outer.r}"
              stroke="#FFFFFF" stroke-opacity="0.72" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M${PAN.outer.x + 3},${PAN.outer.y + PAN.outer.r} V${PAN.outer.y + PAN.outer.h - PAN.outer.r}"
              stroke="#FFFFFF" stroke-opacity="0.34" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M${PAN.outer.x + PAN.outer.r},${PAN.outer.y + PAN.outer.h - 2} H${PAN.outer.x + PAN.outer.w - PAN.outer.r}"
              stroke="#10151A" stroke-opacity="0.55" stroke-width="2.4" stroke-linecap="round"/>

        <!-- Paroi et fond -->
        ${panRect('cavity', 'fill="url(#atg-pan-wall)"')}
        ${panRect('floor', 'fill="url(#atg-pan-floor)"')}

        <!-- Contenu, enfermé dans la cuve -->
        <g clip-path="url(#${clipId})">
          ${trayFill(ingredient)}
        </g>

        <!-- Arête intérieure : sépare nettement la paroi du contenu -->
        ${panRect('cavity', 'fill="none" stroke="#1A2024" stroke-opacity="0.75" stroke-width="2"')}
        <path d="M${PAN.cavity.x + PAN.cavity.r},${PAN.cavity.y + 1.4} H${PAN.cavity.x + PAN.cavity.w - PAN.cavity.r}"
              stroke="#C9D2D8" stroke-opacity="0.3" stroke-width="1.6" stroke-linecap="round"/>

        <!-- Reflets longs du néon sur le bord -->
        <path d="M${PAN.outer.x + 26},${PAN.outer.y + 6} H${PAN.outer.x + 92}"
              stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M${PAN.outer.x + 8},${PAN.outer.y + 34} V${PAN.outer.y + 96}"
              stroke="#FFFFFF" stroke-opacity="0.2" stroke-width="2.4" stroke-linecap="round"/>

        ${panRect('outer', 'fill="none" stroke="#39424A" stroke-width="1.6"')}
      </svg>`;
  }

  /* ------------------------------------------------------------ services */

  function cardEl(id) {
    return list.querySelector(`[data-id="${id}"]:not([data-outgoing])`);
  }

  /** Centre du contenu du bac, en coordonnées écran : départ des vols. */
  function binCenter(id) {
    const card = cardEl(id);
    if (!card) return null;
    const binEl = card.querySelector('.tray-card__bin');
    const rect = (binEl || card).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.52, rect };
  }

  /** Secousse du bac au moment où la portion en est prélevée. */
  function nudge(id) {
    const card = cardEl(id);
    if (!card || prefersReducedMotion()) return Promise.resolve();
    const binEl = card.querySelector('.tray-card__bin');
    return settle(
      animate(
        binEl,
        [
          { transform: 'translateY(0) scale(1)' },
          { transform: 'translateY(4px) scale(0.965)' },
          { transform: 'translateY(0) scale(1)' }
        ],
        { duration: 340, easing: EASE.out }
      )
    );
  }

  function setBusy(busy) {
    list.classList.toggle('is-busy', Boolean(busy));
  }

  return { renderStep, syncSelection, cardEl, binCenter, nudge, setBusy, element: list };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
