import { WINNERS, PIZZA_WINNERS, TIRAMISU_WINNERS, PRIZES, STATS, validateWinners, findWinner } from './data.js';
import { detectQualityTier } from './state.js';
import { soundEngine } from './audio.js';
import { ParticleField } from './particles.js';
import { RevealEngine } from './reveal.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function $(id) {
  return document.getElementById(id);
}

// ---------- UI : liste des résultats + recherche (indépendant du show) ----------
// Rempli immédiatement au chargement de la page, jamais gaté par
// l'animation : un visiteur qui clique "passer" ou coupe le JS des
// scènes doit quand même pouvoir consulter la liste complète.

function renderResultsList() {
  const pizzaList = $('tirage-list-pizza');
  const tiramisuList = $('tirage-list-tiramisu');
  if (pizzaList) {
    pizzaList.innerHTML = PIZZA_WINNERS.map((pseudo, i) =>
      `<li><span class="tirage-list__rank">${i + 1}</span><span class="tirage-list__pseudo">${pseudo}</span><span class="tirage-list__prize">🍕🍕 2 pizzas XXL</span></li>`
    ).join('');
  }
  if (tiramisuList) {
    tiramisuList.innerHTML = TIRAMISU_WINNERS.map((pseudo, i) =>
      `<li><span class="tirage-list__rank">${i + 1}</span><span class="tirage-list__pseudo">${pseudo}</span><span class="tirage-list__prize">🍰 1 tiramisu</span></li>`
    ).join('');
  }
}

function shareText(winner) {
  const base = winner.prize === 'pizza'
    ? "J'ai gagné 2 pizzas XXL chez Subito Pizza Hénin-Beaumont 🍕🍕🔥"
    : "J'ai gagné un tiramisu chez Subito Pizza Hénin-Beaumont 🍰❤️";
  return `${base} — ${location.href.split('#')[0]}`;
}

async function shareResult(winner, triggerBtn) {
  const text = shareText(winner);
  if (navigator.share) {
    try {
      await navigator.share({ text, url: location.href.split('#')[0] });
      return;
    } catch {
      // annulé par l'utilisateur ou indisponible : on retombe sur le presse-papiers
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    if (triggerBtn) {
      const original = triggerBtn.textContent;
      triggerBtn.textContent = 'Copié ✓';
      setTimeout(() => { triggerBtn.textContent = original; }, 1800);
    }
  } catch {
    /* environnement sans presse-papiers : le texte reste visible à l'écran */
  }
}

function renderSearchResult(query) {
  const resultEl = $('tirage-search-result');
  if (!resultEl) return;
  const winner = findWinner(query);

  if (!winner) {
    resultEl.innerHTML = `
      <div class="tirage-result-card tirage-result-card--miss">
        <p class="tirage-result-card__title">Pas de chance cette fois-ci 😔</p>
        <p>Ce pseudo ne fait pas partie des 30 gagnants du tirage — mais merci d'avoir participé, sincèrement !</p>
        <p>Pour se rattraper un peu : l'offre <strong>1 pizza achetée = 1 offerte</strong> à emporter reste valable, tous les jours.</p>
      </div>`;
    return;
  }

  const prize = PRIZES[winner.prize];
  resultEl.innerHTML = `
    <div class="tirage-result-card tirage-result-card--win tirage-result-card--${winner.prize}">
      <p class="tirage-result-card__eyebrow">🎉 C'est toi !</p>
      <p class="tirage-result-card__pseudo">${winner.pseudo}</p>
      <p class="tirage-result-card__prize">${prize.emoji} Tu as gagné ${prize.label} !</p>
      <button type="button" class="btn-solid tirage-share-btn">Partager ma victoire</button>
    </div>`;
  resultEl.querySelector('.tirage-share-btn').addEventListener('click', (e) => shareResult(winner, e.currentTarget));
}

// ---------- Orchestration du show ----------

async function boot() {
  renderResultsList();

  const check = validateWinners();
  if (!check.ok) {
    const warn = $('tirage-data-warning');
    if (warn) {
      warn.hidden = false;
      warn.textContent = `⚠️ Contrôle des gagnants en échec : ${check.errors.join(' ')}`;
    }
    console.error('[Grand Tirage] Contrôle des données gagnants échoué :', check.errors);
  }

  const searchForm = $('tirage-search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      renderSearchResult($('tirage-search-input').value);
    });
  }

  const soundToggle = $('tirage-sound-toggle');
  function syncSoundToggle() {
    if (!soundToggle) return;
    soundToggle.setAttribute('aria-pressed', String(soundEngine.isEnabled));
    soundToggle.textContent = soundEngine.isEnabled ? '🔊 Son activé' : '🔇 Son coupé';
  }
  if (soundToggle) {
    syncSoundToggle();
    soundToggle.addEventListener('click', () => {
      soundEngine.ensureContext();
      soundEngine.toggle();
      syncSoundToggle();
    });
  }

  const announcer = $('tirage-announcer');
  const announce = (text) => { if (announcer) announcer.textContent = text; };

  const quality = await detectQualityTier();
  document.documentElement.dataset.tirageQuality = quality;

  const canvas = $('tirage-canvas');
  const particleField = canvas ? new ParticleField(canvas, quality) : null;
  if (particleField) {
    particleField.setIntensity(0.08);
    particleField.start();
  }

  const stageWrapper = $('tirage-stage-wrapper');
  const stage = $('tirage-stage');
  const hero = $('tirage-hero');
  const lever = $('tirage-lever');
  const skipBtn = $('tirage-skip');
  const counterEl = $('tirage-counter');
  const counterNumber = $('tirage-counter-number');
  const counterLabel = $('tirage-counter-label');
  const falseEndingEl = $('tirage-false-ending');
  const falseEndingText = $('tirage-false-ending-text');
  const curtainEl = $('tirage-curtain');
  const finalEl = $('tirage-final');
  const finalLines = finalEl ? Array.from(finalEl.querySelectorAll('[data-final-line]')) : [];
  const replayBtn = $('tirage-replay');

  let engine = null;
  let showRunning = false;
  let cancelled = false;

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }

  async function runCounterDrama() {
    if (!counterEl) return;
    counterEl.hidden = false;
    counterNumber.textContent = STATS.participants;
    counterLabel.textContent = 'participants';
    soundEngine.whoosh(0.5);
    await sleep(900);
    if (cancelled) return;

    const { x, y } = centerOf(stage);
    particleField?.convergeTo(x, y, quality === 'high' ? 60 : 24);
    counterEl.classList.add('tirage-counter--scramble');
    await sleep(500);
    counterEl.classList.remove('tirage-counter--scramble');
    counterNumber.textContent = STATS.winners;
    counterLabel.textContent = 'gagnants';
    soundEngine.stinger(0.6);
    await sleep(900);
    if (cancelled) return;

    counterNumber.textContent = STATS.gifts;
    counterLabel.textContent = 'cadeaux au total';
    soundEngine.chime([660, 880]);
    particleField?.burst(x, y, quality === 'high' ? 50 : 18, { force: 0.2 });
    await sleep(1100);
    if (cancelled) return;

    counterEl.hidden = true;
  }

  async function runFalseEnding() {
    falseEndingEl.hidden = false;
    falseEndingText.textContent = "C'EST TERMINÉ…";
    particleField?.setIntensity(0.03);
    await sleep(1600);
    if (cancelled) return;

    falseEndingEl.classList.add('tirage-false-ending--alert');
    const rumble = soundEngine.startRumble();
    await sleep(900);
    if (cancelled) { soundEngine.stopRumble(rumble); return; }

    falseEndingText.textContent = '… OU PAS 👀';
    soundEngine.stinger(0.9);
    particleField?.setIntensity(0.2);
    await sleep(1300);
    soundEngine.stopRumble(rumble);
    falseEndingEl.hidden = true;
    falseEndingEl.classList.remove('tirage-false-ending--alert');
  }

  async function runTiramisuTransition() {
    curtainEl.hidden = false;
    particleField?.setPalette('tiramisu');
    soundEngine.chime([523, 659, 784]);
    curtainEl.classList.add('tirage-curtain--open');
    await sleep(1400);
    if (cancelled) return;
    particleField?.setIntensity(0.35);
    await sleep(600);
    curtainEl.hidden = true;
  }

  async function runGrandFinal() {
    finalEl.hidden = false;
    const { x, y } = centerOf(stage);
    for (let i = 0; i < finalLines.length; i++) {
      const line = finalLines[i];
      finalLines.forEach((l) => l.classList.remove('is-active'));
      line.classList.add('is-active');
      if (i === 0) soundEngine.boom();
      else if (i === finalLines.length - 1) soundEngine.chime([440, 660, 880, 1100]);
      else soundEngine.stinger(0.7);
      particleField?.burst(x, y, quality === 'high' ? 90 : 30, { force: 0.3 });
      await sleep(i === finalLines.length - 1 ? 2200 : 1300);
      if (cancelled) return;
    }
  }

  async function runShow() {
    if (showRunning) return;
    showRunning = true;
    cancelled = false;
    hero.classList.add('tirage-hero--hidden');
    stageWrapper.setAttribute('aria-hidden', 'false');
    await sleep(400);

    await runCounterDrama();
    if (cancelled) return finishShow();

    announce('Acte 1 : les 15 gagnants de 2 pizzas XXL.');
    engine = new RevealEngine({ stageEl: stage, particleField, sound: soundEngine, quality, onAnnounce: announce });
    const pizzaWinners = WINNERS.filter((w) => w.prize === 'pizza');
    await engine.playAct(pizzaWinners);
    if (cancelled) return finishShow();
    engine.clearStage();

    await runFalseEnding();
    if (cancelled) return finishShow();

    await runTiramisuTransition();
    if (cancelled) return finishShow();

    announce('Mode Tiramisu activé : 15 gagnants supplémentaires.');
    const tiramisuWinners = WINNERS.filter((w) => w.prize === 'tiramisu');
    await engine.playAct(tiramisuWinners);
    if (cancelled) return finishShow();
    engine.clearStage();

    await runGrandFinal();
    finishShow();
  }

  function finishShow() {
    showRunning = false;
    finalEl.hidden = true;
    finalLines.forEach((l) => l.classList.remove('is-active'));
    particleField?.setPalette('green');
    particleField?.setIntensity(0.1);
    goToResults();
  }

  function goToResults() {
    const resultsSection = $('tirage-resultats');
    stageWrapper.setAttribute('aria-hidden', 'true');
    if (resultsSection) {
      resultsSection.hidden = false;
      resultsSection.scrollIntoView({ behavior: quality === 'off' ? 'auto' : 'smooth', block: 'start' });
      resultsSection.setAttribute('tabindex', '-1');
      resultsSection.focus({ preventScroll: true });
    }
  }

  function activateMachine() {
    if (lever.dataset.activated === '1') return;
    lever.dataset.activated = '1';
    lever.setAttribute('aria-disabled', 'true');
    lever.classList.add('tirage-lever--pulled');

    soundEngine.ensureContext();
    soundEngine.clac();
    particleField?.setIntensity(0.5);
    soundEngine.riseTension(1.3, 140, 700);
    stageWrapper.classList.add('tirage-stage-wrapper--shake');

    setTimeout(() => {
      stageWrapper.classList.remove('tirage-stage-wrapper--shake');
      soundEngine.boom();
      const { x, y } = centerOf(stage);
      particleField?.burst(x, y, quality === 'high' ? 100 : 34, { force: 0.35 });
      runShow();
    }, 1350);
  }

  if (lever) {
    lever.addEventListener('click', activateMachine);
    lever.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateMachine(); }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      cancelled = true;
      if (engine) engine.cancel();
      hero.classList.add('tirage-hero--hidden');
      [counterEl, falseEndingEl, curtainEl, finalEl].forEach((el) => { if (el) el.hidden = true; });
      goToResults();
    });
  }

  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      const resultsSection = $('tirage-resultats');
      if (resultsSection) resultsSection.hidden = true;
      hero.classList.remove('tirage-hero--hidden');
      lever.dataset.activated = '';
      lever.removeAttribute('aria-disabled');
      lever.classList.remove('tirage-lever--pulled');
      window.scrollTo({ top: 0, behavior: quality === 'off' ? 'auto' : 'smooth' });
    });
  }

  // Easter egg discret : 5 clics sur la signature finale, jamais requis
  // pour accéder à quoi que ce soit.
  const signature = $('tirage-final-signature');
  if (signature) {
    let clicks = 0;
    signature.addEventListener('click', () => {
      clicks += 1;
      if (clicks === 5) {
        signature.setAttribute('data-secret', '1');
        announce('Merci d\'avoir vécu Le Grand Tirage jusqu\'au bout. 🍕');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', boot);
