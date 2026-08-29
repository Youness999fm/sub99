// Atmosphère visuelle du Grand Tirage : particules, traînées lumineuses
// et faisceaux façon "volumetric light", en canvas 2D. Choix délibéré
// plutôt que WebGL/Three.js — voir l'analyse de mission : ce rendu couvre
// la majorité du "wow" demandé (particules, traînées, halo type bloom)
// pour un poids et un risque de compatibilité mobile bien moindres.
//
// Trois paliers de qualité, décidés une seule fois par state.js :
// - "high"   : particules + traînées + faisceaux de lumière
// - "medium" : particules seules, densité réduite, pas de faisceaux
// - "off"    : pas de rendu du tout (fond CSS statique pris en relais)

const PALETTES = {
  green: { core: '255,214,102', mid: '212,175,100', edge: '14,59,39' },
  tiramisu: { core: '255,240,214', mid: '224,185,140', edge: '92,58,33' },
  ember: { core: '255,120,90', mid: '214,80,60', edge: '30,10,10' },
};

export class ParticleField {
  constructor(canvas, quality) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.quality = quality; // 'high' | 'medium' | 'off'
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.particles = [];
    this.beams = [];
    this.palette = PALETTES.green;
    this.intensity = 0.15; // dérive ambiante de base, avant activation
    this.running = false;
    this._raf = null;
    this._lastT = 0;

    this._resize = this._resize.bind(this);
    this._loop = this._loop.bind(this);
    this._resize();
    window.addEventListener('resize', this._resize);

    if (this.quality === 'high') {
      this.beams = Array.from({ length: 3 }, (_, i) => this._makeBeam(i));
    }
  }

  get maxParticles() {
    if (this.quality === 'high') return 140;
    if (this.quality === 'medium') return 55;
    return 0;
  }

  _resize() {
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = Math.max(1, clientWidth * this.dpr);
    this.canvas.height = Math.max(1, clientHeight * this.dpr);
    this.w = clientWidth;
    this.h = clientHeight;
  }

  _makeBeam(i) {
    return {
      angle: (Math.PI / 6) * i - Math.PI / 6,
      speed: 0.00006 + i * 0.00002,
      width: 0.35 + i * 0.12,
      alpha: 0.05 + i * 0.015,
    };
  }

  setPalette(name) {
    this.palette = PALETTES[name] || PALETTES.green;
  }

  setIntensity(level) {
    this.intensity = Math.max(0, Math.min(1, level));
  }

  _spawn(x, y, opts = {}) {
    if (this.particles.length >= this.maxParticles) return;
    const angle = opts.angle ?? Math.random() * Math.PI * 2;
    const speed = opts.speed ?? 0.02 + Math.random() * 0.06;
    this.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (opts.rise || 0),
      size: opts.size ?? 1.5 + Math.random() * 2.5,
      life: 0,
      maxLife: opts.maxLife ?? 1400 + Math.random() * 1200,
      trail: opts.trail ?? this.quality === 'high',
      hue: opts.hue ?? 0,
    });
  }

  // Dérive ambiante douce, appelée en continu quand la machine est
  // "sous tension" mais entre deux temps forts.
  ambientTick(count = 1) {
    if (this.quality === 'off') return;
    for (let i = 0; i < count; i++) {
      if (Math.random() > this.intensity) continue;
      this._spawn(Math.random() * this.w, this.h + 10, {
        angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.6,
        speed: 0.015 + Math.random() * 0.03,
        rise: 0,
        maxLife: 2200 + Math.random() * 1800,
        size: 1 + Math.random() * 2,
      });
    }
  }

  // Explosion ponctuelle utilisée aux moments forts (activation,
  // reveal, convergence du compteur, grand final). `count` est plafonné
  // par le palier de qualité via maxParticles, donc jamais de surcharge
  // même si on demande beaucoup de particules sur un device faible.
  burst(x, y, count = 30, opts = {}) {
    if (this.quality === 'off') return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      this._spawn(x, y, {
        angle,
        speed: 0.05 + Math.random() * (opts.force ?? 0.15),
        maxLife: 700 + Math.random() * 900,
        size: 1.5 + Math.random() * 3.5,
        ...opts,
      });
    }
  }

  // Fait converger un lot de particules depuis les bords vers un point
  // (utilisé pour la dramatisation du compteur 250 -> 30 -> 45).
  convergeTo(targetX, targetY, count = 40) {
    if (this.quality === 'off') return;
    for (let i = 0; i < count; i++) {
      const edge = Math.floor(Math.random() * 4);
      let x, y;
      if (edge === 0) { x = 0; y = Math.random() * this.h; }
      else if (edge === 1) { x = this.w; y = Math.random() * this.h; }
      else if (edge === 2) { x = Math.random() * this.w; y = 0; }
      else { x = Math.random() * this.w; y = this.h; }
      const dx = targetX - x, dy = targetY - y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      this._spawn(x, y, {
        angle: Math.atan2(dy, dx),
        speed: dist / 900,
        maxLife: 850 + Math.random() * 350,
        size: 2 + Math.random() * 2,
      });
    }
  }

  start() {
    if (this.quality === 'off' || this.running) return;
    this.running = true;
    this._lastT = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._resize);
  }

  _loop(t) {
    if (!this.running) return;
    const dt = Math.min(48, t - this._lastT);
    this._lastT = t;
    this._draw(dt, t);
    this._raf = requestAnimationFrame(this._loop);
  }

  _draw(dt, t) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fondu léger plutôt qu'un clearRect franc : laisse une traînée
    // lumineuse discrète derrière chaque particule sur le palier "high".
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.quality === 'high' ? 'rgba(9,15,12,0.28)' : 'rgba(9,15,12,1)';
    ctx.fillRect(0, 0, w, h);

    if (this.quality === 'high') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.beams.forEach((beam, i) => {
        beam.angle += beam.speed * dt;
        const cx = w * (0.25 + i * 0.25);
        const grad = ctx.createLinearGradient(cx, 0, cx + Math.sin(beam.angle) * 200, h);
        grad.addColorStop(0, `rgba(${this.palette.core},${beam.alpha})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx - w * beam.width * 0.15, 0);
        ctx.lineTo(cx + w * beam.width * 0.15, 0);
        ctx.lineTo(cx + Math.sin(beam.angle) * 260 + w * beam.width * 0.3, h);
        ctx.lineTo(cx + Math.sin(beam.angle) * 260 - w * beam.width * 0.3, h);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    }

    this.ambientTick(this.quality === 'high' ? 2 : 1);

    ctx.globalCompositeOperation = 'lighter';
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      if (p.life >= p.maxLife) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 0.00002 * dt; // légère flottaison vers le haut, façon braise

      const lifeRatio = p.life / p.maxLife;
      const alpha = Math.sin(Math.PI * (1 - lifeRatio)) * 0.9;
      const r = p.size * (1 - lifeRatio * 0.3);

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
      grad.addColorStop(0, `rgba(${this.palette.core},${alpha})`);
      grad.addColorStop(0.4, `rgba(${this.palette.mid},${alpha * 0.5})`);
      grad.addColorStop(1, `rgba(${this.palette.edge},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
  }
}
