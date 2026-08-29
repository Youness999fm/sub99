import { PRIZES } from './data.js';

// Moteur de révélation "scène" : anime chaque gagnant en 3 temps
// (préparation → suspense → révélation) dans l'ordre officiel (jamais de
// tirage au sort côté client — voir data.js). Le rythme suit la structure
// demandée : 1 (spectaculaire) → 4 (rapide) → 5 (montée) → 4 (accélération)
// → 1 (grand final d'acte). Cette structure n'a pas changé — seule la mise
// en scène de chaque reveal a été retravaillée.
const RHYTHM_GROUPS = [
  { count: 1, tempo: 'spectacular' },
  { count: 4, tempo: 'fast' },
  { count: 5, tempo: 'building' },
  { count: 4, tempo: 'accelerate' },
  { count: 1, tempo: 'finale' },
];

// Durées par phase (ms), à vitesse normale. Volontairement courtes pour
// les tempos "fast/building/accelerate" (le gros du volume : 13 des 15
// gagnants d'un acte) — la qualité vient de la mise en scène, pas de la
// durée. "spectacular"/"finale" (1er et dernier de l'acte) restent plus
// posés pour laisser le temps de savourer.
const TEMPO_TIMING = {
  spectacular: { prep: 150, suspense: 480, flash: 260, hold: 1500, exit: 320 },
  fast:        { prep: 50,  suspense: 190, flash: 130, hold: 620,  exit: 140 },
  building:    { prep: 50,  suspense: 210, flash: 140, hold: 680,  exit: 150 },
  accelerate:  { prep: 40,  suspense: 150, flash: 110, hold: 520,  exit: 130 },
  finale:      { prep: 180, suspense: 560, flash: 320, hold: 1900, exit: 380 },
};

// Variations subtiles des deux petits éléments qui encadrent le badge
// "★ GAGNANT ★" — cycle déterministe (pas de hasard) pour que deux
// rechargements de page donnent le même résultat, tout en évitant que les
// 30 révélations soient visuellement identiques.
const DECOR_FLAVORS = [
  ['🍕', '🍕'],
  ['✦', '✦'],
  ['🍕', '✦'],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export class RevealEngine {
  constructor({ stageEl, particleField, sound, quality, onAnnounce, liveListEl }) {
    this.stageEl = stageEl;
    this.particleField = particleField;
    this.sound = sound;
    this.quality = quality; // affecte durée/complexité, jamais le contenu
    this.reduceMotion = quality === 'off';
    this.onAnnounce = onAnnounce || (() => {});
    this.liveListEl = liveListEl || null;
    this.cancelled = false;
    this._flavorIndex = 0;
  }

  cancel() {
    this.cancelled = true;
  }

  _scale(ms) {
    if (this.quality === 'off') return Math.round(ms * 0.25);
    if (this.quality === 'medium') return Math.round(ms * 0.8);
    return ms;
  }

  _timingFor(tempo) {
    const t = TEMPO_TIMING[tempo];
    return {
      prep: this._scale(t.prep),
      suspense: this._scale(t.suspense),
      flash: this._scale(t.flash),
      hold: this._scale(t.hold),
      exit: this._scale(t.exit),
    };
  }

  _center() {
    const r = this.stageEl.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }

  _buildSuspense() {
    const el = document.createElement('div');
    el.className = 'tirage-suspense';
    el.innerHTML = `
      <span class="tirage-suspense__ticket" aria-hidden="true">🎟️</span>
      <p class="tirage-suspense__text">Et le gagnant est…</p>`;
    return el;
  }

  _buildWinnerCard(winner, tempo, flavor, isUltimate) {
    const prize = PRIZES[winner.prize];
    const el = document.createElement('div');
    el.className = `tirage-winner-card tirage-winner-card--${winner.prize} tirage-winner-card--${tempo}${isUltimate ? ' tirage-winner-card--ultimate' : ''}`;
    el.innerHTML = `
      <span class="tirage-winner-card__decor tirage-winner-card__decor--left" aria-hidden="true">${flavor[0]}</span>
      <span class="tirage-winner-card__decor tirage-winner-card__decor--right" aria-hidden="true">${flavor[1]}</span>
      <p class="tirage-winner-card__badge">${isUltimate ? '★ Dernier gagnant ★' : '★ Gagnant ★'}</p>
      <p class="tirage-winner-card__name">${winner.pseudo}</p>
      <p class="tirage-winner-card__prize">
        <span class="tirage-winner-card__prize-icon" aria-hidden="true">${prize.emoji}</span>
        <span class="tirage-winner-card__prize-label">${prize.label}</span>
      </p>`;
    return el;
  }

  // Ajoute le gagnant à la liste "derniers gagnants" (mirroir décoratif de
  // la vraie liste accessible, déjà complète et présente ailleurs dans le
  // DOM depuis le chargement — voir renderResultsList() dans main.js).
  _pushLiveList(winner) {
    if (!this.liveListEl) return;
    const prize = PRIZES[winner.prize];
    const item = document.createElement('div');
    item.className = 'tirage-live-item';
    item.innerHTML = `<span class="tirage-live-item__icon" aria-hidden="true">${prize.emoji}</span><span class="tirage-live-item__name">${winner.pseudo}</span><span class="tirage-live-item__prize">${prize.label}</span>`;
    this.liveListEl.prepend(item);

    if (!this.reduceMotion) {
      item.animate(
        [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 260, easing: 'ease-out' }
      );
    }

    const items = this.liveListEl.querySelectorAll('.tirage-live-item');
    if (items.length > 4) {
      const last = items[items.length - 1];
      if (this.reduceMotion) {
        last.remove();
      } else {
        const anim = last.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
        anim.finished.then(() => last.remove()).catch(() => last.remove());
      }
    }
  }

  async _playOne(winner, tempo, index, total, isUltimate) {
    if (this.cancelled) return;
    const timing = this._timingFor(tempo);
    const big = tempo === 'spectacular' || tempo === 'finale' || isUltimate;
    const flavor = DECOR_FLAVORS[this._flavorIndex % DECOR_FLAVORS.length];
    this._flavorIndex += 1;
    const { x: cx, y: cy } = this._center();

    this.stageEl.innerHTML = '';

    // ÉTAPE 1 — préparation : très courte, juste un frémissement de la
    // scène (pas de texte, pas de "bip" — le son n'intervient qu'aux
    // moments forts pour éviter l'effet "bip bip bip" répétitif).
    this.stageEl.classList.add('tirage-stage--prep');
    if (big) this.sound.clic();
    await sleep(timing.prep);
    if (this.cancelled) return;
    this.stageEl.classList.remove('tirage-stage--prep');

    // ÉTAPE 2 — suspense : "Et le gagnant est…", ticket qui tourne
    // doucement. Une seule mécanique forte (le ticket), jamais dix effets
    // différents en même temps.
    const suspenseEl = this._buildSuspense();
    this.stageEl.appendChild(suspenseEl);
    if (this.reduceMotion) {
      suspenseEl.style.opacity = '1';
    } else {
      suspenseEl.animate(
        [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: Math.min(200, timing.suspense * 0.6), easing: 'ease-out', fill: 'both' }
      );
    }
    if (big) this.sound.riseTension(Math.max(0.25, timing.suspense / 1000), 220, 820);
    await sleep(timing.suspense);
    if (this.cancelled) return;

    if (!this.reduceMotion) {
      const fadeOut = suspenseEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' });
      await fadeOut.finished.catch(() => {});
    }
    suspenseEl.remove();

    // ÉTAPE 3 — révélation : flash + particules, puis la carte apparaît
    // comme un vrai objet premium (zoom léger + fondu + léger flou qui se
    // dissipe), jamais une simple div qui surgit.
    this.stageEl.classList.add('tirage-stage--flash');
    this.sound.stinger(index / Math.max(1, total - 1));
    if (big) this.sound.boom();
    this.particleField?.burst(cx, cy, big ? 85 : 26, { force: big ? 0.32 : 0.17 });
    await sleep(this.reduceMotion ? 0 : 90);
    this.stageEl.classList.remove('tirage-stage--flash');
    if (this.cancelled) return;

    const card = this._buildWinnerCard(winner, tempo, flavor, isUltimate);
    this.stageEl.appendChild(card);

    if (this.reduceMotion) {
      card.style.opacity = '1';
    } else {
      const cardIn = card.animate(
        [
          { opacity: 0, transform: 'scale(0.78) translateY(8px)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'scale(1.035) translateY(0)', filter: 'blur(0)' },
          { opacity: 1, transform: 'scale(1) translateY(0)', filter: 'blur(0)' },
        ],
        { duration: Math.max(240, timing.flash + 120), easing: 'cubic-bezier(0.22, 0.85, 0.25, 1.05)', fill: 'both' }
      );
      await cardIn.finished.catch(() => {});
    }
    if (big) this.sound.chime([1046, 1318]);

    if (tempo === 'spectacular') {
      this.onAnnounce(`Premier gagnant : ${winner.pseudo}, ${PRIZES[winner.prize].label}.`);
    }
    if (isUltimate) {
      this.onAnnounce(`Dernier gagnant du tirage : ${winner.pseudo}, ${PRIZES[winner.prize].label}.`);
    }

    await sleep(timing.hold);
    if (this.cancelled) return;

    // Sortie : la carte se réduit et rejoint la liste des derniers
    // gagnants, plutôt que de disparaître brutalement.
    if (!this.reduceMotion) {
      const cardOut = card.animate(
        [
          { opacity: 1, transform: 'scale(1) translateY(0)' },
          { opacity: 0, transform: 'scale(0.4) translateY(36px)' },
        ],
        { duration: timing.exit, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' }
      );
      this.sound.whoosh(Math.max(0.12, timing.exit / 1000 * 0.5));
      await cardOut.finished.catch(() => {});
    }
    this._pushLiveList(winner);
  }

  // Révèle une liste ordonnée de gagnants (un acte complet) en suivant la
  // structure de rythme. `onEach` est appelé après chaque reveal avec
  // (winner, indexDansActe). `ultimateFinaleIndex` marque, s'il est fourni,
  // l'indice du tout dernier gagnant du show entier (pas seulement de
  // l'acte) pour lui donner une révélation renforcée.
  async playAct(winners, { onEach, ultimateFinaleIndex } = {}) {
    let i = 0;
    for (const group of RHYTHM_GROUPS) {
      for (let g = 0; g < group.count && i < winners.length; g++, i++) {
        if (this.cancelled) return;
        const isUltimate = ultimateFinaleIndex === i;
        await this._playOne(winners[i], group.tempo, i, winners.length, isUltimate);
        if (onEach) onEach(winners[i], i);
      }
    }
  }

  clearStage() {
    this.stageEl.innerHTML = '';
  }
}
