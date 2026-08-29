import { PRIZES } from './data.js';

// Moteur de révélation "scène" : anime un ticket par gagnant, dans
// l'ordre officiel (jamais de tirage au sort côté client — voir data.js).
// Le rythme suit la structure demandée : 1 (spectaculaire) → 4 (rapide)
// → 5 (montée) → 4 (accélération) → 1 (grand final d'acte).
const RHYTHM_GROUPS = [
  { count: 1, tempo: 'spectacular' },
  { count: 4, tempo: 'fast' },
  { count: 5, tempo: 'building' },
  { count: 4, tempo: 'accelerate' },
  { count: 1, tempo: 'finale' },
];

const TEMPO_TIMING = {
  // [durée du flip ms, tenue avant le suivant ms]
  spectacular: [1500, 1800],
  fast: [750, 420],
  building: [650, 380],
  accelerate: [520, 260],
  finale: [1700, 2000],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RevealEngine {
  constructor({ stageEl, particleField, sound, quality, onAnnounce }) {
    this.stageEl = stageEl;
    this.particleField = particleField;
    this.sound = sound;
    this.quality = quality; // affecte durée/complexité, jamais le contenu
    this.onAnnounce = onAnnounce || (() => {});
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  _timingFor(tempo) {
    const [flip, hold] = TEMPO_TIMING[tempo];
    if (this.quality === 'off') return [Math.min(flip, 260), Math.min(hold, 140)];
    if (this.quality === 'medium') return [flip * 0.75, hold * 0.8];
    return [flip, hold];
  }

  _buildTicket(winner, tempo) {
    const prize = PRIZES[winner.prize];
    const el = document.createElement('div');
    el.className = `tirage-ticket tirage-ticket--${winner.prize} tirage-ticket--${tempo}`;
    el.innerHTML = `
      <div class="tirage-ticket__inner">
        <div class="tirage-ticket__face tirage-ticket__face--front">
          <span class="tirage-ticket__hash">#${winner.rank}</span>
          <span class="tirage-ticket__mark" aria-hidden="true">SUBITO</span>
        </div>
        <div class="tirage-ticket__face tirage-ticket__face--back">
          <span class="tirage-ticket__emoji" aria-hidden="true">${prize.emoji}</span>
          <span class="tirage-ticket__pseudo">${winner.pseudo}</span>
          <span class="tirage-ticket__prize">${prize.label}</span>
        </div>
      </div>`;
    return el;
  }

  async _playOne(winner, tempo, index, total) {
    if (this.cancelled) return;
    const [flipMs, holdMs] = this._timingFor(tempo);
    const el = this._buildTicket(winner, tempo);
    this.stageEl.innerHTML = '';
    this.stageEl.appendChild(el);

    const rect = this.stageEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // Entrée
    const enterAnim = el.animate(
      [
        { transform: 'translateY(-40px) scale(0.6)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      { duration: Math.min(320, flipMs * 0.3), easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'both' }
    );
    this.sound.clic();
    await enterAnim.finished.catch(() => {});
    if (this.cancelled) return;

    // Petit silence avant le flip sur le tempo "spectaculaire"/"finale" —
    // c'est la tension qui vend le reveal, pas l'effet lui-même.
    if (tempo === 'spectacular' || tempo === 'finale') await sleep(350);
    if (this.cancelled) return;

    const inner = el.querySelector('.tirage-ticket__inner');
    const flipAnim = inner.animate(
      [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
      { duration: flipMs, easing: 'cubic-bezier(.5,0,.15,1)', fill: 'both' }
    );
    if (tempo === 'spectacular' || tempo === 'finale') {
      this.sound.riseTension(flipMs / 1000, 200, 900);
    } else {
      this.sound.clac();
    }
    await flipAnim.finished.catch(() => {});
    if (this.cancelled) return;

    this.sound.stinger(index / Math.max(1, total - 1));
    this.particleField.burst(cx, cy, tempo === 'spectacular' || tempo === 'finale' ? 70 : 24, {
      force: tempo === 'spectacular' || tempo === 'finale' ? 0.28 : 0.16,
    });

    el.classList.add('tirage-ticket--revealed');

    if (tempo === 'spectacular') {
      this.onAnnounce(`Premier gagnant : ${winner.pseudo}, ${PRIZES[winner.prize].label}.`);
    }
    if (tempo === 'finale') {
      this.onAnnounce(`Dernier gagnant de cette série : ${winner.pseudo}, ${PRIZES[winner.prize].label}.`);
    }

    await sleep(holdMs);
  }

  // Révèle une liste ordonnée de gagnants (un acte complet) en suivant
  // la structure de rythme. `onEach` est appelé après chaque reveal avec
  // (winner, indexDansActe) pour laisser main.js alimenter la liste
  // persistante / le tableau de bord en parallèle.
  async playAct(winners, { onEach } = {}) {
    let i = 0;
    for (const group of RHYTHM_GROUPS) {
      for (let g = 0; g < group.count && i < winners.length; g++, i++) {
        if (this.cancelled) return;
        await this._playOne(winners[i], group.tempo, i, winners.length);
        if (onEach) onEach(winners[i], i);
      }
    }
  }

  clearStage() {
    this.stageEl.innerHTML = '';
  }
}
