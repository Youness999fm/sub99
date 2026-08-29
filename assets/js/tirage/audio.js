// Signature sonore du Grand Tirage — entièrement synthétisée (oscillateurs
// + bruit filtré via Web Audio API), aucun fichier audio externe. Permet
// un contrôle total du timing (synchronisation fine avec les animations)
// et un poids réseau nul.
//
// Règle non négociable : jamais d'autoplay avant un vrai geste utilisateur
// (impossible techniquement de toute façon — Chrome/Safari/TikTok in-app
// bloquent l'audio sans interaction). Le son est actif "par préférence" dès
// le départ (pas de bouton "cliquez pour activer" séparé) : le vrai
// démarrage se fait au moment du geste déjà obligatoire pour voir le show —
// tirer le levier (voir ensureContext(), appelé depuis activateMachine()
// dans main.js). Le bouton en haut de page ne sert qu'à couper le son si on
// le souhaite, jamais à mentir sur un état "activé" qui ne jouerait rien.
const STORAGE_KEY = 'subitoTirageSoundOn';

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    const stored = localStorage.getItem(STORAGE_KEY);
    this.enabled = stored === null ? true : stored === '1';
    this._activeLoops = new Set();
  }

  get isEnabled() {
    return this.enabled;
  }

  // Doit être appelé depuis un vrai geste utilisateur (clic/tap) —
  // c'est aussi le moment où on obtient l'autorisation du navigateur.
  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.55 : 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.linearRampToValueAtTime(on ? 0.55 : 0, now + 0.12);
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  // ---- primitives ----

  _env(gainNode, t0, attack, hold, release, peak = 1) {
    gainNode.gain.cancelScheduledValues(t0);
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gainNode.gain.setValueAtTime(peak, t0 + attack + hold);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  }

  _tone({ freq, type = 'sine', t0, attack = 0.005, hold = 0.03, release = 0.12, peak = 0.5, glideTo = null }) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + attack + hold + release);
    this._env(gain, t0, attack, hold, release, peak);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + attack + hold + release + 0.05);
  }

  _noiseBuffer(duration) {
    const ctx = this.ensureContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _noiseBurst({ t0, duration = 0.15, filterFreq = 1200, type = 'bandpass', peak = 0.4, Q = 1 }) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = Q;
    const gain = ctx.createGain();
    this._env(gain, t0, 0.005, duration * 0.3, duration * 0.7, peak);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  // ---- vocabulaire sonore Subito ----

  clac() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this._noiseBurst({ t0: ctx.currentTime, duration: 0.05, filterFreq: 2200, peak: 0.5, Q: 2 });
  }

  clic() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this._tone({ freq: 1400, type: 'square', t0: ctx.currentTime, attack: 0.002, hold: 0.01, release: 0.04, peak: 0.18 });
  }

  bzzz(duration = 0.4) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this._tone({ freq: 90, type: 'sawtooth', t0: ctx.currentTime, attack: 0.02, hold: duration * 0.5, release: duration * 0.5, peak: 0.22, glideTo: 140 });
  }

  whoosh(duration = 0.6) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this._noiseBurst({ t0: ctx.currentTime, duration, filterFreq: 500, type: 'lowpass', peak: 0.3, Q: 0.7 });
  }

  // Montée de tension : glissando continu, utilisé pendant l'activation
  // de la machine et l'accélération de fin d'acte.
  riseTension(duration = 1.2, fromFreq = 120, toFreq = 640) {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(fromFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.28, t0 + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
    return osc;
  }

  // Stinger de révélation — varie légèrement la hauteur selon `intensity`
  // (0 à 1) pour que les 15 reveals d'un acte ne sonnent pas identiques.
  stinger(intensity = 0.5) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const base = 440 + intensity * 220;
    const t0 = ctx.currentTime;
    this._tone({ freq: base, type: 'triangle', t0, attack: 0.004, hold: 0.05, release: 0.18, peak: 0.35, glideTo: base * 1.5 });
    this._tone({ freq: base * 2, type: 'sine', t0: t0 + 0.01, attack: 0.004, hold: 0.03, release: 0.14, peak: 0.15 });
  }

  boom() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this._noiseBurst({ t0, duration: 0.35, filterFreq: 220, type: 'lowpass', peak: 0.55, Q: 0.6 });
    this._tone({ freq: 70, type: 'sine', t0, attack: 0.005, hold: 0.08, release: 0.35, peak: 0.5 });
  }

  // Grondement bas continu pour le faux-final — démarre/s'arrête
  // explicitement (boucle tenue), contrairement aux autres sons courts.
  startRumble() {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 55;
    lfo.type = 'sine';
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 1.2);
    osc.connect(gain).connect(this.master);
    osc.start();
    lfo.start();
    const handle = { osc, lfo, gain };
    this._activeLoops.add(handle);
    return handle;
  }

  stopRumble(handle) {
    if (!handle || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    handle.gain.gain.cancelScheduledValues(t0);
    handle.gain.gain.setValueAtTime(handle.gain.gain.value || 0.0001, t0);
    handle.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    handle.osc.stop(t0 + 0.55);
    handle.lfo.stop(t0 + 0.55);
    this._activeLoops.delete(handle);
  }

  // Petit carillon chaleureux pour l'entrée en Mode Tiramisu et le
  // grand final — timbre volontairement différent des stingers d'acte 1
  // (sinus purs superposés, pas de triangle/scie).
  chime(notes = [660, 880, 1100]) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    notes.forEach((freq, i) => {
      const t0 = ctx.currentTime + i * 0.09;
      this._tone({ freq, type: 'sine', t0, attack: 0.008, hold: 0.06, release: 0.4, peak: 0.28 });
    });
  }
}

export const soundEngine = new SoundEngine();
