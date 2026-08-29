// Détection du palier de qualité visuelle : "high", "medium" ou "off".
// Décidé une seule fois au chargement, consommé par particles.js et
// reveal.js. Le principe : le show doit rester complet et lisible à
// tous les paliers (même contenu, même texte réel, même durée
// narrative) — seule l'intensité des effets d'atmosphère change.

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function looksLikeLowEndDevice() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4; // non supporté partout, valeur par défaut neutre
  const saveData = navigator.connection && navigator.connection.saveData;
  const slowConnection = navigator.connection && /2g/.test(navigator.connection.effectiveType || '');
  return cores <= 4 || mem <= 2 || saveData || slowConnection;
}

// Sonde FPS courte (quelques frames) pour détecter en direct un device
// qui rame déjà avant même d'avoir affiché de particules — plus fiable
// que les seules heuristiques statiques ci-dessus sur du matériel
// atypique (throttling thermique, tablette ancienne, etc.).
function probeFrameRate(durationMs = 350) {
  return new Promise((resolve) => {
    let frames = 0;
    let start = null;
    function tick(t) {
      if (start === null) start = t;
      frames += 1;
      if (t - start < durationMs) {
        requestAnimationFrame(tick);
      } else {
        resolve((frames * 1000) / (t - start));
      }
    }
    requestAnimationFrame(tick);
  });
}

export async function detectQualityTier() {
  if (prefersReducedMotion()) return 'off';

  const staticLowEnd = looksLikeLowEndDevice();
  const fps = await probeFrameRate();

  if (fps < 40 || (staticLowEnd && fps < 50)) return 'medium';
  if (staticLowEnd) return 'medium';
  return 'high';
}

export function onReducedMotionChange(callback) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = () => callback(mq.matches);
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
}
