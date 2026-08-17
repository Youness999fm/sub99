// Subito Pizza — comportements partagés (nav active, lightbox galerie, intro, animations)

document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  markActiveNavLink();
  initLightbox();
  initReviewForm();
  initComplaintForm();
  initScrollReveal();
  initIntroSplash();
  initHeaderCompact();
  initBackToTop();
  initParallax();
  initHeroCarousel();
  initYearCounter();
  initHeroMilestone();
  initOrderStatus();
  initDaysCounter();
  initFinaleEmbers();
  initMenuJumpActive();
  initPizzaBaseNav();
  initContestCountdown();
  initContestPresence();
});

// Nombre de jours complets depuis l'ouverture (1er avril 1999), calculé
// en dates civiles (pas d'heures/minutes) pour éviter tout effet de
// fuseau horaire ou d'heure d'été sur le décompte.
function daysSinceOpening() {
  const openingUTC = Date.UTC(1999, 3, 1);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((todayUTC - openingUTC) / 86400000);
}

// Nombre de samedis compris entre l'ouverture (jour 0) et le jour `target`
// inclus, calculé par formule (pas par boucle) à partir du vrai jour de la
// semaine du 1ᵉʳ avril 1999. Sert à l'équivalence "samedis soir" de la
// scène finale — une vraie donnée calendaire, jamais une estimation.
function saturdaysSinceOpening(target) {
  const openingWeekday = new Date(Date.UTC(1999, 3, 1)).getUTCDay(); // 0 = dimanche … 6 = samedi
  const firstSaturdayOffset = (6 - openingWeekday + 7) % 7;
  if (target < firstSaturdayOffset) return 0;
  return Math.floor((target - firstSaturdayOffset) / 7) + 1;
}

// Nombre de jours restants avant le tirage au sort du concours (vidéo
// TikTok, 30 août), même logique de date civile (sans heure) que
// daysSinceOpening() ci-dessus.
function daysUntilContestDraw() {
  const drawUTC = Date.UTC(2026, 7, 30); // 30 août 2026 (mois 0-indexé)
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((drawUTC - todayUTC) / 86400000);
}

// Pilote les points de contact du concours ajoutés en dehors de la carte
// détaillée (bandeau global, teaser accueil, pastille menu, ligne de pied
// de page) : même règle que initContestCountdown() ci-dessus — calculé
// depuis la vraie date du tirage, masqué proprement une fois le tirage
// passé, sans jamais nécessiter de retrait manuel le 31 août.
function initContestPresence() {
  const days = daysUntilContestDraw();
  const isOpen = days >= 0;
  const daysLabel = days === 0 ? 'dernier jour !' : days === 1 ? "plus qu'1 jour" : `plus que ${days} jours`;

  const ribbon = document.getElementById('event-ribbon');
  if (ribbon) {
    if (!isOpen) {
      ribbon.hidden = true;
    } else {
      const daysEl = document.getElementById('event-ribbon-days');
      if (daysEl) daysEl.textContent = daysLabel;
    }
  }

  const teaser = document.getElementById('contest-teaser');
  if (teaser && !isOpen) teaser.hidden = true;

  const pill = document.getElementById('menu-contest-pill');
  if (pill && !isOpen) pill.hidden = true;

  const footerLine = document.getElementById('footer-contest-line');
  if (footerLine) {
    if (!isOpen) {
      footerLine.hidden = true;
    } else {
      const footerDaysEl = document.getElementById('footer-contest-days');
      if (footerDaysEl) footerDaysEl.textContent = days;
    }
  }
}

function initContestCountdown() {
  const wrap = document.getElementById('contest-countdown');
  const numberEl = document.getElementById('contest-countdown-number');
  const labelEl = document.getElementById('contest-countdown-label');
  if (!wrap || !numberEl || !labelEl) return;

  const days = daysUntilContestDraw();

  if (days < 0) {
    // Le tirage est déjà passé : un compte à rebours négatif n'aurait
    // aucun sens, on masque le bloc plutôt que d'afficher un chiffre faux.
    wrap.hidden = true;
    return;
  }

  if (days === 0) {
    numberEl.textContent = "🎉";
    labelEl.textContent = "C'est aujourd'hui !";
    return;
  }

  numberEl.textContent = days;
  labelEl.textContent = days === 1 ? 'jour avant le tirage au sort' : 'jours avant le tirage au sort';
}

// Fenêtre "10 000 jours" : le jour exact où le seuil est franchi, plus
// une marge (2 semaines, choix assumé) pendant laquelle la petite
// signature "✦ 10 000 JOURS ✦" reste visible. Calculée depuis la vraie
// date d'ouverture, jamais une valeur ou une date codée en dur.
const MILESTONE_DAY = 10000;
const MILESTONE_WINDOW_END = MILESTONE_DAY + 13;

// Signal du 10 000e jour dès le premier écran (voir commentaire CSS
// .hero__milestone-pill) : sans lui, seule la scène finale — tout en bas
// de la page — parle de l'événement, ratée par tout visiteur qui ne
// descend pas jusque-là.
function initHeroMilestone() {
  const pill = document.getElementById('hero-milestone-pill');
  if (!pill) return;
  const days = daysSinceOpening();
  if (days >= MILESTONE_DAY && days <= MILESTONE_WINDOW_END) pill.hidden = false;
}

// Fait apparaître le nombre de jours écoulés depuis 1999 en le comptant
// jusqu'à sa valeur réelle (jamais figée), dans la scène finale, sous
// forme d'un vrai compteur à rouleaux (réutilise setOdometer()). Au
// passage exact des 10 000 jours, déclenche une courte célébration ;
// rejouable en cliquant/appuyant sur le chiffre.
function initDaysCounter() {
  const numberBtn = document.getElementById('finale-days-number');
  const wrapEl = document.getElementById('finale-days');
  const labelEl = document.getElementById('finale-days-label');
  const badgeEl = document.getElementById('finale-milestone-badge');
  const yearEl = document.getElementById('finale-year');
  const finaleEl = document.getElementById('finale');
  const milestoneDateEl = document.getElementById('finale-milestone-date');
  const equivalencesEl = document.getElementById('finale-equivalences');
  const eqYearsEl = document.getElementById('finale-eq-years');
  const eqWeeksEl = document.getElementById('finale-eq-weeks');
  const eqSaturdaysEl = document.getElementById('finale-eq-saturdays');
  if (!numberBtn || !wrapEl || !labelEl) return;

  const target = daysSinceOpening();
  const width = String(target).length;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMilestoneWindow = target >= MILESTONE_DAY && target <= MILESTONE_WINDOW_END;
  const defaultLabel = labelEl.textContent;
  const celebrationLine = "Depuis le 1ᵉʳ avril 1999. Et toujours le four allumé. 🔥🍕";

  if (target >= MILESTONE_DAY) wrapEl.classList.add('is-milestone');

  if (isMilestoneWindow && badgeEl) badgeEl.hidden = false;

  // Plaque datée, réelle : uniquement visible pendant la vraie fenêtre des
  // 10 000 jours, avec la date du jour telle qu'elle est — pas une mise en
  // scène figée à l'avance.
  if (isMilestoneWindow && milestoneDateEl) {
    const today = new Date();
    const formatted = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(today);
    milestoneDateEl.textContent = `Constaté aujourd'hui, ${formatted}`;
    milestoneDateEl.hidden = false;
  }

  // Équivalences humaines, calculées en vrai à partir de la même date
  // d'ouverture (jamais des chiffres inventés) : transforment un nombre
  // abstrait en quelque chose de concret.
  if (eqYearsEl) eqYearsEl.textContent = String(yearsSinceOpening());
  if (eqWeeksEl) eqWeeksEl.textContent = Math.floor(target / 7).toLocaleString('fr-FR');
  if (eqSaturdaysEl) eqSaturdaysEl.textContent = saturdaysSinceOpening(target).toLocaleString('fr-FR');
  const revealEquivalences = () => { if (equivalencesEl) equivalencesEl.classList.add('is-revealed'); };
  if (reduceMotion) revealEquivalences();

  const pad = (n) => String(n).padStart(width, '0');
  const finalValueStr = pad(target);
  numberBtn.setAttribute('aria-label', `${target} jours depuis l'ouverture — appuyer pour rejouer l'animation`);

  // Léger rebond d'arrivée une fois la valeur finale posée — le moment où
  // le chiffre "atterrit". Une seule fois par appel, nettoyé ensuite pour
  // pouvoir être rejoué à l'identique.
  const settle = () => {
    numberBtn.classList.remove('is-settling');
    void numberBtn.offsetWidth;
    numberBtn.classList.add('is-settling');
    window.setTimeout(() => numberBtn.classList.remove('is-settling'), 520);
  };

  // Quelques braises chaudes montent depuis le chiffre — pas des
  // confettis multicolores. Nettoyées du DOM après leur animation, pour
  // pouvoir être rejouées sans s'accumuler.
  const spawnEmbers = () => {
    for (let i = 0; i < 10; i++) {
      const ember = document.createElement('span');
      ember.className = 'finale__ember';
      ember.style.left = `${20 + Math.random() * 60}%`;
      ember.style.setProperty('--ember-drift', `${(Math.random() - 0.5) * 60}px`);
      ember.style.animationDelay = `${Math.random() * 300}ms`;
      wrapEl.appendChild(ember);
      window.setTimeout(() => ember.remove(), 2400);
    }
  };

  const celebrate = (fromUserGesture) => {
    sessionStorage.setItem('subito10kPlayed', '1');
    // Les navigateurs bloquent (et journalisent une erreur) tout appel à
    // navigator.vibrate() hors d'un vrai geste utilisateur — donc jamais
    // lors du déclenchement automatique au scroll, seulement au clic/tap.
    if (fromUserGesture && navigator.vibrate) {
      try { navigator.vibrate(25); } catch (e) { /* vibration indisponible, tant pis */ }
    }
    if (reduceMotion) return; // le badge statique + le libellé permanent (ci-dessous) suffisent déjà

    spawnEmbers();
    if (yearEl) {
      yearEl.textContent = '10 000';
      yearEl.classList.add('is-climax');
      window.setTimeout(() => {
        yearEl.classList.remove('is-climax');
        yearEl.textContent = '1999';
      }, 3200);
    }
    labelEl.textContent = celebrationLine;
    window.setTimeout(() => { labelEl.textContent = defaultLabel; }, 5200);
  };

  // Sous réduction de mouvement, l'information reste entièrement
  // disponible sans dépendre d'une animation temporisée : le libellé
  // reste en permanence sur la phrase de célébration pendant la fenêtre,
  // plutôt que d'apparaître puis de disparaître.
  if (reduceMotion) {
    setOdometer(numberBtn, finalValueStr, true, true);
    if (isMilestoneWindow) labelEl.textContent = celebrationLine;
  }

  // Révélation façon "rouleau" : chaque chiffre tourne sur lui-même
  // (plusieurs tours complets à travers 0-9) avant de se figer sur sa
  // valeur réelle, en cascade de gauche à droite — un vrai mouvement
  // mécanique plutôt qu'un défilement de valeurs. Une seule transition
  // CSS par chiffre, posée une fois pour toutes : jamais de mise à jour
  // par frame, donc jamais de saccade, quel que soit l'appareil.
  const spin = (dramatic, onDone) => {
    const extraCycles = dramatic ? 3 : 1;
    const baseDuration = dramatic ? 1300 : 800;
    const stepDuration = dramatic ? 170 : 90;
    const stepDelay = dramatic ? 110 : 60;

    numberBtn.innerHTML = '';
    numberBtn.dataset.value = finalValueStr;
    let maxTotal = 0;

    numberBtn.classList.remove('is-growing');
    void numberBtn.offsetWidth;
    numberBtn.style.setProperty('--finale-grow-duration', `${baseDuration + (finalValueStr.length - 1) * stepDuration}ms`);
    numberBtn.classList.add('is-growing');

    for (let i = 0; i < finalValueStr.length; i++) {
      const digit = Number(finalValueStr[i]);
      const totalSlots = extraCycles * 10 + digit + 1;
      const slot = document.createElement('span');
      slot.className = 'order-status__odo-digit';
      const track = document.createElement('span');
      track.className = 'order-status__odo-track';
      for (let s = 0; s < totalSlots; s++) {
        const d = document.createElement('span');
        d.textContent = String(s % 10);
        track.appendChild(d);
      }
      slot.appendChild(track);
      numberBtn.appendChild(slot);

      const delay = i * stepDelay;
      const duration = baseDuration + i * stepDuration;
      maxTotal = Math.max(maxTotal, delay + duration);
      track.style.transform = 'translateY(0)';
      void track.offsetWidth; // fige le départ avant de lancer la transition
      track.style.transition = `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`;
      track.style.transform = `translateY(-${totalSlots - 1}em)`;
    }

    window.setTimeout(() => {
      settle();
      revealEquivalences();
      if (onDone) onDone();
    }, maxTotal);
  };

  // Rejeu volontaire au clic/tap/clavier (vrai <button>, activable au
  // clavier sans code de gestion de touches). Pendant la fenêtre : le
  // chiffre retourne et la célébration complète rejoue. En dehors : un
  // petit clin d'oeil honnête vers la prochaine étape, calculé en vrai.
  numberBtn.addEventListener('click', () => {
    if (isMilestoneWindow) {
      if (!reduceMotion) spin(true, () => celebrate(true));
      else celebrate(true);
      return;
    }
    const daysTo20k = 20000 - target;
    labelEl.textContent = daysTo20k > 0
      ? `✦ Prochaine étape : dans ${daysTo20k.toLocaleString('fr-FR')} jours, les 20 000 ✦`
      : defaultLabel;
    window.setTimeout(() => { labelEl.textContent = defaultLabel; }, 3200);
    if (!reduceMotion) spin(false);
  });

  if (reduceMotion) return;

  if (!('IntersectionObserver' in window)) { spin(isMilestoneWindow, isMilestoneWindow ? () => celebrate(false) : undefined); return; }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        // Synchronisé avec le temps d'arrivée de ce bloc dans la mise en
        // scène de la section finale (transition-delay CSS de 0.95s +
        // le temps que le fondu devienne perceptible).
        window.setTimeout(() => {
          const dramatic = isMilestoneWindow && sessionStorage.getItem('subito10kPlayed') !== '1';
          spin(dramatic, dramatic ? () => celebrate(false) : undefined);
        }, 1250);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  observer.observe(wrapEl);
}

// Braises ambiantes derrière le chiffre des "10 000 jours" — un nuage
// discret de particules chaudes en canvas (clin d'oeil au four à bois,
// pas des confettis), qui donne une sensation de masse/temps accumulé
// sans jamais coûter cher en performance : ne tourne que pendant que la
// section est réellement visible, se met en pause si l'onglet passe en
// arrière-plan, et ne se lance pas du tout sous réduction de mouvement.
function initFinaleEmbers() {
  const canvas = document.getElementById('finale-embers-canvas');
  const finaleEl = document.getElementById('finale');
  if (!canvas || !finaleEl) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const isMilestoneWindow = () => {
    const days = daysSinceOpening();
    return days >= MILESTONE_DAY && days <= MILESTONE_WINDOW_END;
  };

  let particles = [];
  let rafId = null;
  let width = 0;
  let height = 0;
  let dpr = 1;

  const maxParticles = () => (window.innerWidth < 600 ? 16 : 34);

  const resize = () => {
    const rect = finaleEl.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const spawn = () => {
    if (particles.length >= maxParticles()) return;
    particles.push({
      x: width * (0.15 + Math.random() * 0.7),
      y: height * (0.55 + Math.random() * 0.35),
      r: 1 + Math.random() * 1.8,
      speed: 8 + Math.random() * 14, // px/s vers le haut
      drift: (Math.random() - 0.5) * 10, // px/s latéral
      life: 0,
      maxLife: 3.2 + Math.random() * 2.6,
      warm: isMilestoneWindow(),
    });
  };

  let lastSpawn = 0;
  let lastFrame = 0;

  const step = (now) => {
    if (!lastFrame) lastFrame = now;
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    if (now - lastSpawn > 220) {
      spawn();
      lastSpawn = now;
    }

    ctx.clearRect(0, 0, width, height);
    particles = particles.filter((p) => p.life < p.maxLife);
    particles.forEach((p) => {
      p.life += dt;
      p.y -= p.speed * dt;
      p.x += p.drift * dt;
      const lifeRatio = p.life / p.maxLife;
      const opacity = lifeRatio < 0.15
        ? lifeRatio / 0.15
        : Math.max(0, 1 - (lifeRatio - 0.15) / 0.85);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.warm
        ? `rgba(255, 209, 102, ${0.75 * opacity})`
        : `rgba(212, 175, 100, ${0.5 * opacity})`;
      ctx.fill();
    });

    rafId = window.requestAnimationFrame(step);
  };

  const start = () => {
    if (rafId) return;
    resize();
    lastFrame = 0;
    rafId = window.requestAnimationFrame(step);
  };

  const stop = () => {
    if (!rafId) return;
    window.cancelAnimationFrame(rafId);
    rafId = null;
    particles = [];
    ctx.clearRect(0, 0, width, height);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (finaleEl.getBoundingClientRect().top < window.innerHeight && finaleEl.getBoundingClientRect().bottom > 0) start();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!rafId) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) start();
      else stop();
    });
  }, { threshold: 0 });

  observer.observe(finaleEl);
}

// Statut "commandes ouvertes/fermées" en temps réel, avec effet odomètre
// sur les chiffres (comme un compteur premium, pas un simple texte qui
// change). Créneau réel : commandes prises de 18h00 à 22h47.
function initOrderStatus() {
  const root = document.getElementById('order-status');
  if (!root) return;

  const labelEl = document.getElementById('order-status-label');
  const verbEl = document.getElementById('order-status-verb');
  const hoursEl = document.getElementById('order-status-hours');
  const minutesEl = document.getElementById('order-status-minutes');
  const srEl = document.getElementById('order-status-sr');
  if (!labelEl || !verbEl || !hoursEl || !minutesEl || !srEl) return;

  const OPEN_H = 18, OPEN_M = 0;
  const CLOSE_H = 22, CLOSE_M = 47;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const computeState = (now) => {
    const openToday = new Date(now);
    openToday.setHours(OPEN_H, OPEN_M, 0, 0);
    const closeToday = new Date(now);
    closeToday.setHours(CLOSE_H, CLOSE_M, 0, 0);

    if (now >= openToday && now < closeToday) {
      return { isOpen: true, target: closeToday };
    }
    let nextOpen = openToday;
    if (now >= closeToday) {
      nextOpen = new Date(openToday);
      nextOpen.setDate(nextOpen.getDate() + 1);
    }
    return { isOpen: false, target: nextOpen };
  };

  const pad2 = (n) => String(n).padStart(2, '0');

  let lastRenderKey = null;
  let lastIsOpen = null;

  const applyState = (isOpen, h, m) => {
    root.classList.toggle('is-open', isOpen);
    root.classList.toggle('is-closed', !isOpen);
    labelEl.textContent = isOpen ? 'Commandes ouvertes' : 'Commandes fermées';
    verbEl.textContent = isOpen ? 'Ferment dans' : 'Ouvrent dans';
    setOdometer(hoursEl, String(h), reduceMotion);
    setOdometer(minutesEl, pad2(m), reduceMotion);
    const hPart = h > 0 ? `${h} heure${h > 1 ? 's' : ''} ` : '';
    srEl.textContent = `${isOpen ? 'Commandes ouvertes' : 'Commandes fermées'}. ${isOpen ? 'Ferment' : 'Ouvrent'} dans ${hPart}${m} minute${m > 1 ? 's' : ''}.`;
  };

  const render = () => {
    const now = new Date();
    const { isOpen, target } = computeState(now);
    const diffSec = Math.max(0, Math.floor((target - now) / 1000));
    const h = Math.floor(diffSec / 3600);
    const m = Math.floor((diffSec % 3600) / 60);

    const key = `${isOpen}-${h}-${m}`;
    if (key === lastRenderKey) return; // rien de visible n'a changé : on ne touche pas au DOM
    lastRenderKey = key;

    const stateChanged = lastIsOpen !== null && lastIsOpen !== isOpen;
    lastIsOpen = isOpen;

    if (stateChanged && !reduceMotion) {
      root.classList.add('is-transitioning');
      window.setTimeout(() => {
        applyState(isOpen, h, m);
        root.classList.remove('is-transitioning');
      }, 320);
    } else {
      applyState(isOpen, h, m);
    }
  };

  render();
  window.setInterval(render, 1000);
}

// Petit "odomètre" : chaque chiffre glisse verticalement vers sa nouvelle
// valeur au lieu d'être simplement remplacé. Ne touche le DOM que si la
// valeur affichée a réellement changé.
function setOdometer(container, valueStr, reduceMotion, instant) {
  const prev = container.dataset.value;
  if (prev === valueStr) return;
  const rebuild = !prev || prev.length !== valueStr.length;
  container.dataset.value = valueStr;

  if (rebuild) {
    container.innerHTML = '';
    for (let i = 0; i < valueStr.length; i++) {
      const slot = document.createElement('span');
      slot.className = 'order-status__odo-digit';
      const track = document.createElement('span');
      track.className = 'order-status__odo-track';
      if (reduceMotion || instant) track.style.transition = 'none';
      for (let d = 0; d <= 9; d++) {
        const digitEl = document.createElement('span');
        digitEl.textContent = String(d);
        track.appendChild(digitEl);
      }
      slot.appendChild(track);
      container.appendChild(slot);
    }
  }

  const tracks = container.querySelectorAll('.order-status__odo-track');
  for (let i = 0; i < valueStr.length; i++) {
    tracks[i].style.transform = `translateY(-${Number(valueStr[i]) * 10}%)`;
  }
}

// Nombre d'années complètes depuis l'ouverture (1er avril 1999), calculé
// à partir de la date réelle du navigateur — jamais une valeur figée.
function yearsSinceOpening() {
  const opening = new Date(1999, 3, 1); // 1er avril 1999 (mois 0-indexé)
  const now = new Date();
  let years = now.getFullYear() - opening.getFullYear();
  const anniversaryPassedThisYear =
    now.getMonth() > opening.getMonth() ||
    (now.getMonth() === opening.getMonth() && now.getDate() >= opening.getDate());
  if (!anniversaryPassedThisYear) years -= 1;
  return years;
}

function initYearCounter() {
  const el = document.getElementById('year-counter');
  const wrap = document.getElementById('hero-year-counter-wrap');
  if (!el) return;

  const target = yearsSinceOpening();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const setFinal = () => { el.textContent = String(target); };

  if (reduceMotion) { setFinal(); return; }

  const animate = () => {
    const duration = 1200;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = String(Math.round(eased * target));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        setFinal();
        if (wrap) {
          wrap.classList.add('is-done');
          wrap.addEventListener('animationend', () => wrap.classList.remove('is-done'), { once: true });
        }
      }
    };
    window.requestAnimationFrame(step);
  };

  // Le compteur est dans le héros, potentiellement masqué par l'écran
  // d'intro au premier chargement : dans ce cas on attend qu'il ait
  // disparu pour lancer l'animation, sinon elle se joue en coulisses et
  // le visiteur ne voit jamais le comptage, seulement le nombre final.
  const splash = document.getElementById('intro-splash');
  if (splash) {
    window.setTimeout(animate, 3600);
    return;
  }

  if (!('IntersectionObserver' in window)) { animate(); return; }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animate();
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });

  observer.observe(el);
}

// Fait défiler la photo du héros à travers toute la carte des pizzas
// (même cadre circulaire que la Pizza Subito), une image à la fois avec
// un fondu doux. Ne charge la photo suivante qu'au moment où elle est
// nécessaire, pour ne pas alourdir le chargement initial sur mobile.
function initHeroCarousel() {
  const img = document.getElementById('hero-plate-img');
  const caption = document.getElementById('hero-plate-caption');
  if (!img || !caption) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // La carte complète, mélangée exprès (pizza, pâte, tex-mex...) plutôt
  // que catégorie par catégorie, pour montrer un maximum de variété en
  // quelques secondes. Boissons et subitowichs volontairement exclus.
  const menuItems = [
    { name: 'Pizza Subito', src: 'assets/img/photos/photo-24.jpg', caption: 'Notre signature, celle qui porte fièrement le nom de la maison : la <strong>Pizza Subito</strong>' },
    { name: 'Pizza Carnivora', src: 'assets/img/photos/carnivora.jpg' },
    { name: 'Pâtes Bolognaise', src: 'assets/img/photos/photo-45.jpg' },
    { name: 'Pizza 4 Fromages', src: 'assets/img/photos/photo-01.jpg' },
    { name: 'Pizza Chèvre miel', src: 'assets/img/photos/chevre-miel.jpg' },
    { name: 'Wings', src: 'assets/img/photos/photo-40.jpg' },
    { name: 'Pizza Végétarienne', src: 'assets/img/photos/photo-07.jpg' },
    { name: 'Salade Exotique', src: 'assets/img/photos/photo-49.jpg' },
    { name: 'Pizza 3 Jambons', src: 'assets/img/photos/photo-30.jpg' },
    { name: 'Tiramisubito Spéculoos', src: 'assets/img/photos/tiramisubito-speculoos.jpg' },
    { name: 'Pizza 4 Saisons', src: 'assets/img/photos/photo-08.jpg' },
    { name: 'Pâtes 3 fromages', src: 'assets/img/photos/photo-44.jpg' },
    { name: 'Calzone soufflée', src: 'assets/img/photos/photo-31.jpg' },
    { name: 'Pizza Campione', src: 'assets/img/photos/photo-06.jpg' },
    { name: 'Tenders de poulet', src: 'assets/img/photos/photo-41.jpg' },
    { name: 'Pizza Kebab', src: 'assets/img/photos/photo-28.jpg' },
    { name: 'Salade Niçoise', src: 'assets/img/photos/photo-50.jpg' },
    { name: 'Pizza Napolitaine', src: 'assets/img/photos/photo-09.jpg' },
    { name: 'Tiramisubito Oreo', src: 'assets/img/photos/photo-54.jpg' },
    { name: 'Pizza Régina', src: 'assets/img/photos/photo-22.jpg' },
    { name: 'Pâtes Saumon', src: 'assets/img/photos/photo-47.jpg' },
    { name: 'Pizza Chicken', src: 'assets/img/photos/photo-02.jpg' },
    { name: 'Pizza Kefta', src: 'assets/img/photos/photo-27.jpg' },
    { name: 'Nuggets', src: 'assets/img/photos/photo-42.jpg' },
    { name: 'Pizza Neptune', src: 'assets/img/photos/photo-05.jpg' },
    { name: 'Salade Printanière', src: 'assets/img/photos/photo-51.jpg' },
    { name: "Pizza L'Extravagante", src: 'assets/img/photos/photo-23.jpg' },
    { name: "Tiramisubito M&M's", src: 'assets/img/photos/photo-56.jpg' },
    { name: 'Pizza Fruits de mer', src: 'assets/img/photos/photo-13.jpg' },
    { name: 'Pâtes Carbonara', src: 'assets/img/photos/photo-46.jpg' },
    { name: 'Pizza Orientale', src: 'assets/img/photos/photo-04.jpg' },
    { name: 'Pizza Pacifico', src: 'assets/img/photos/photo-03.jpg' },
    { name: 'Oignon ring', src: 'assets/img/photos/photo-43.jpg' },
    { name: 'Pizza Venezia', src: 'assets/img/photos/photo-19.jpg' },
    { name: 'Salade Di Roma', src: 'assets/img/photos/photo-52.jpg' },
    { name: 'Pizza Chicken Chika', src: 'assets/img/photos/photo-21.jpg' },
    { name: 'Calzone Nutella', src: 'assets/img/photos/photo-57.jpg' },
    { name: 'Pizza Milano', src: 'assets/img/photos/photo-18.jpg' },
    { name: 'Pizza Normande', src: 'assets/img/photos/photo-16.jpg' },
    { name: 'Pizza Fajitas', src: 'assets/img/photos/photo-20.jpg' },
    { name: 'Pizza Maroilles', src: 'assets/img/photos/maroilles.jpg' },
    { name: 'Pizza Pollame', src: 'assets/img/photos/pollame.jpg' },
    { name: 'Pizza Savoyarde', src: 'assets/img/photos/photo-15.jpg' },
    { name: 'Pizza Indienne', src: 'assets/img/photos/photo-14.jpg' },
    { name: 'Pizza Carolina', src: 'assets/img/photos/carolina.jpg' }
  ];

  const preloadAt = (i) => {
    const next = new Image();
    next.src = menuItems[(i + 1) % menuItems.length].src;
  };
  preloadAt(0);

  let index = 0;
  window.setInterval(() => {
    index = (index + 1) % menuItems.length;
    const p = menuItems[index];

    img.classList.add('is-swapping');
    caption.classList.add('is-swapping');

    window.setTimeout(() => {
      img.src = p.src;
      img.alt = `${p.name}, à retrouver sur notre carte`;
      caption.innerHTML = p.caption || `🍕 À retrouver sur notre carte : <strong>${p.name}</strong>`;
      img.classList.remove('is-swapping');
      caption.classList.remove('is-swapping');
    }, 380);

    preloadAt(index);
  }, 1600);
}

// Léger effet de profondeur sur les halos décoratifs du héros et sur le
// "1999" de la section histoire, desktop uniquement : sur mobile, priorité
// à la fluidité, on ne touche pas au scroll (prefers-reduced-motion aussi
// respecté).
function initParallax() {
  if (window.matchMedia('(max-width: 759px)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const glows = document.querySelectorAll('.hero__glow');
  const year = document.getElementById('presentation-year');
  if (!glows.length && !year) return;

  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    glows.forEach((glow, i) => {
      glow.style.transform = `translateY(${y * (i === 0 ? 0.12 : 0.08)}px)`;
    });

    if (year) {
      // Décalage minime (quelques px max) basé sur la position réelle de
      // la section à l'écran, pas sur le scroll absolu de la page — pour
      // que le mouvement reste imperceptible en tant que "ça bouge".
      const rect = year.parentElement.getBoundingClientRect();
      const offsetFromCenter = (rect.top + rect.height / 2) - window.innerHeight / 2;
      const shift = Math.max(-18, Math.min(18, offsetFromCenter * -0.03));
      year.style.transform = `translate(-50%, calc(-50% + ${shift}px))`;
    }

    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });
}

function initBackToTop() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Revenir en haut de la page');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(btn);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  let ticking = false;
  const update = () => {
    btn.classList.toggle('is-visible', window.scrollY > 600);
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });

  update();
}

function initHeaderCompact() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  let ticking = false;
  const update = () => {
    header.classList.toggle('site-header--compact', window.scrollY > 40);
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });

  update();
}

function markActiveNavLink() {
  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-nav__link').forEach((link) => {
    const hrefPage = link.getAttribute('href').split('#')[0];
    if (hrefPage === current) link.classList.add('is-active');
  });
}

function initLightbox() {
  const lightbox = document.querySelector('.lightbox');
  if (!lightbox) return;
  const lightboxImg = lightbox.querySelector('img');
  const closeBtn = lightbox.querySelector('.lightbox__close');
  let lastTrigger = null;

  document.querySelectorAll('[data-lightbox-src]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      lightboxImg.src = trigger.getAttribute('data-lightbox-src');
      lightboxImg.alt = trigger.getAttribute('data-lightbox-alt') || '';
      lastTrigger = trigger;
      lightbox.classList.add('is-open');
      closeBtn.focus();
    });
  });

  const close = () => {
    if (!lightbox.classList.contains('is-open')) return;
    lightbox.classList.remove('is-open');
    lightboxImg.src = '';
    if (lastTrigger) lastTrigger.focus();
  };

  closeBtn.addEventListener('click', close);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !lightbox.classList.contains('is-open')) return;
    close();
  });
  lightbox.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') e.preventDefault(); // seul le bouton fermer est interactif dans la lightbox
  });
}

function initScrollReveal() {
  const targets = document.querySelectorAll('main > section, main > nav.menu-jump');
  if (!targets.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!('IntersectionObserver' in window) || reduceMotion) {
    targets.forEach((el) => el.classList.add('is-visible'));
    document.querySelectorAll('.gallery-grid__item, .review-card, .delivery-tier').forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0, rootMargin: '0px 0px -5% 0px' });

  targets.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${Math.min(i, 4) * 60}ms`;
    observer.observe(el);
  });

  // Sections "moment fort" : un peu plus de présence à l'arrivée (translate +
  // scale via .reveal--feature) que le simple fondu appliqué aux autres.
  document.querySelectorAll('.promo-highlight, .contest-teaser, .presentation-section').forEach((el) => {
    el.classList.add('reveal--feature');
  });

  // Petite apparition en cascade pour les grilles de cartes (galerie, avis,
  // zone de livraison) — délai local au groupe, plafonné pour rester rapide
  // même quand il y a beaucoup d'éléments.
  ['.gallery-grid__item', '.review-card', '.delivery-tier', '.menu-item'].forEach((selector) => {
    const items = document.querySelectorAll(selector);
    if (!items.length) return;
    items.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${Math.min(i, 5) * 70}ms`;
      observer.observe(el);
    });
  });

  // Le "1999" monumental de la section histoire : sa propre apparition
  // (géré par une animation CSS dédiée, pas par .reveal).
  const year = document.getElementById('presentation-year');
  if (year) observer.observe(year);
}

// Surligne dans la barre de catégories (.menu-jump) le lien correspondant
// à la section actuellement visible à l'écran, pendant le défilement de
// menu.html.
function initMenuJumpActive() {
  const jump = document.querySelector('.menu-jump');
  const quicknav = document.querySelector('.menu-quicknav');
  const sections = document.querySelectorAll('.menu-category[id]');
  if (!jump || !sections.length || !('IntersectionObserver' in window)) return;

  // La grille (.menu-jump) et la barre fine (.menu-quicknav) partagent les
  // mêmes ancres (#pizzas, #pates, ...) : les deux sont tenues à jour en
  // même temps, pour que la catégorie active soit toujours cohérente entre
  // les deux, quelle que soit celle que le client a sous les yeux.
  const links = Array.from(jump.querySelectorAll('a[href^="#"]'))
    .concat(quicknav ? Array.from(quicknav.querySelectorAll('a[href^="#"]')) : []);
  const linkFor = (id) => links.find((a) => a.getAttribute('href') === `#${id}`);

  const setActive = (id) => {
    let activeInQuicknav = null;
    links.forEach((a) => {
      const match = a.getAttribute('href') === `#${id}`;
      a.classList.toggle('is-active', match);
      if (match && quicknav && quicknav.contains(a)) activeInQuicknav = a;
    });
    // Fait glisser la barre fine horizontalement pour garder l'onglet actif
    // visible, sans quoi sur mobile la catégorie surlignée peut se
    // retrouver hors champ après plusieurs clics ou un long défilement.
    if (activeInQuicknav) {
      activeInQuicknav.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  };

  let observer = null;
  let stickyH = 16;

  // Reconstruit l'observateur avec une marge en pixels calée sur la
  // hauteur réelle de la barre fine collante : avec un pourcentage fixe,
  // la zone de détection se retrouvait cachée derrière elle, et la
  // catégorie surlignée restait bloquée sur la précédente au lieu de
  // suivre ce que le client voit réellement.
  const rebuildObserver = () => {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && linkFor(entry.target.id)) {
          setActive(entry.target.id);
        }
      });
    }, { rootMargin: `-${stickyH + 20}px 0px -55% 0px`, threshold: 0 });
    sections.forEach((section) => observer.observe(section));
  };

  rebuildObserver();

  if (!quicknav) return;

  // La barre fine reste masquée tant que la grille est encore à l'écran :
  // elle n'apparaît qu'une fois qu'on a descendu la page au point où la
  // grille sort du champ (relais naturel), ou immédiatement si le client
  // clique sur une catégorie de la grille (pas besoin d'attendre la fin
  // du défilement fluide pour que la barre soit prête).
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      quicknav.classList.toggle('is-visible', !entry.isIntersecting);
    });
  }, { threshold: 0 });
  revealObserver.observe(jump);

  jump.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', () => quicknav.classList.add('is-visible'));
  });

  // Hauteur de la barre fine mesurée en JS (sert à la fois à la marge de
  // détection ci-dessus et au décalage de défilement des sections, pour
  // que le titre de catégorie n'apparaisse jamais caché derrière elle).
  const syncStickyOffsets = () => {
    stickyH = quicknav.offsetHeight;
    document.documentElement.style.setProperty('--menu-sticky-h', `${stickyH + 16}px`);
    rebuildObserver();
  };

  syncStickyOffsets();
  window.addEventListener('load', syncStickyOffsets);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncStickyOffsets, 150);
  });
}

// Sous-navigation "Base tomate / Base crème / Base spéciale" à l'intérieur
// de la section Pizzas (menu.html) : surligne le groupe actuellement
// affiché, sur le même principe que initMenuJumpActive() ci-dessus.
function initPizzaBaseNav() {
  const nav = document.querySelector('.pizza-base-nav');
  const groups = document.querySelectorAll('.pizza-base-group[id]');
  if (!nav || !groups.length || !('IntersectionObserver' in window)) return;

  const indicator = nav.querySelector('.pizza-base-nav__indicator');
  const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
  const linkFor = (id) => links.find((a) => a.getAttribute('href') === `#${id}`);

  // Glisse la pastille jusqu'au lien actif (largeur + position mesurées en
  // JS plutôt que supposées en CSS, pour rester exact quelle que soit la
  // longueur du texte de chaque onglet).
  const moveIndicator = (link) => {
    if (!indicator || !link) return;
    indicator.style.width = `${link.offsetWidth}px`;
    indicator.style.transform = `translateX(${link.offsetLeft}px)`;
    indicator.classList.add('is-ready');
  };

  const setActive = (id) => {
    let activeLink = null;
    links.forEach((a) => {
      const match = a.getAttribute('href') === `#${id}`;
      a.classList.toggle('is-active', match);
      if (match) activeLink = a;
    });
    moveIndicator(activeLink);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && linkFor(entry.target.id)) {
        setActive(entry.target.id);
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

  groups.forEach((group) => observer.observe(group));

  // Repositionne la pastille sur le lien actuellement actif après un
  // redimensionnement (les largeurs de texte peuvent changer de ligne).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const current = links.find((a) => a.classList.contains('is-active'));
      if (current) moveIndicator(current);
    }, 150);
  });
}

function initIntroSplash() {
  const splash = document.getElementById('intro-splash');
  if (!splash) return;

  let alreadySeen = false;
  try { alreadySeen = sessionStorage.getItem('subitoIntroSeen') === '1'; } catch (e) { /* stockage indisponible : on rejoue l'intro */ }

  if (alreadySeen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    return;
  }

  document.documentElement.classList.add('intro-lock');
  document.body.classList.add('intro-lock');
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add('is-hiding');
    document.documentElement.classList.remove('intro-lock');
    document.body.classList.remove('intro-lock');
    try { sessionStorage.setItem('subitoIntroSeen', '1'); } catch (e) { /* tant pis, l'intro rejouera */ }
    window.removeEventListener('keydown', dismiss);
    splash.removeEventListener('click', dismiss);
    setTimeout(() => splash.remove(), 950);
  };

  window.addEventListener('keydown', dismiss, { once: true });
  splash.addEventListener('click', dismiss, { once: true });
  setTimeout(dismiss, 2600);
}

function initReviewForm() {
  const funnel = document.getElementById('review-funnel');
  if (!funnel) return;

  const googleUrl = 'https://www.google.com/maps?cid=9858007054937316298';

  const panels = funnel.querySelectorAll('[data-panel]');
  const showPanel = (name) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
    funnel.dataset.step = name;
  };

  let currentNote = null;

  const stars = Array.from(funnel.querySelectorAll('.review-star'));
  const starsGroup = funnel.querySelector('.review-stars');

  // Remplit l'étoile cliquée/survolée ET toutes celles qui la précèdent
  // (ex : cliquer sur la 4e étoile allume aussi les 3 premières).
  const paintStars = (value) => {
    stars.forEach((star) => {
      star.classList.toggle('is-active', Number(star.dataset.value) <= value);
    });
  };

  stars.forEach((star) => {
    const value = Number(star.dataset.value);
    star.addEventListener('mouseenter', () => paintStars(value));
    star.addEventListener('focus', () => paintStars(value));
  });

  if (starsGroup) {
    starsGroup.addEventListener('mouseleave', () => paintStars(currentNote || 0));
    starsGroup.addEventListener('focusout', (e) => {
      if (!starsGroup.contains(e.relatedTarget)) paintStars(currentNote || 0);
    });
  }

  stars.forEach((star) => {
    star.addEventListener('click', () => {
      currentNote = Number(star.dataset.value);
      paintStars(currentNote);

      if (currentNote >= 4) {
        // 4-5 étoiles : ouverture directe de Google dans un nouvel onglet.
        // Déclenché de façon synchrone dans le geste de clic pour ne pas
        // être bloqué par le navigateur comme pop-up.
        window.open(googleUrl, '_blank', 'noopener');
        showPanel('thanks');
      } else {
        // 1-3 étoiles : direction immédiate vers la section réclamation,
        // pour traiter concrètement le souci plutôt que de simplement
        // encaisser une note basse. Le lien Google reste disponible en
        // permanence dans cette section (voir avis.html) : il n'est
        // jamais masqué selon la note, pour rester conforme à la
        // politique Google sur le "review gating".
        const target = document.getElementById('reclamation');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const firstField = target.querySelector('#complaint-form input, #complaint-form select');
          if (firstField) setTimeout(() => firstField.focus(), 500);
        }
      }
    });
  });
}

// Formulaire de réclamation (commande incorrecte, retard, etc.) —
// entièrement séparé du parcours d'avis : ce n'est pas un avis, c'est un
// signalement, il ne doit jamais être confondu avec la note 1-5 étoiles.
function initComplaintForm() {
  const form = document.getElementById('complaint-form');
  const sent = document.getElementById('complaint-sent');
  const choice = document.getElementById('complaint-choice');
  const note = document.querySelector('.complaint-section__note');
  if (!form || !sent) return;

  // Numéro perso du gérant — jamais affiché comme texte sur la page,
  // utilisé uniquement comme destinataire du SMS ouvert par le
  // navigateur du client. Le client le voit dans SA propre appli SMS au
  // moment d'envoyer (comportement natif de tout lien "sms:", impossible
  // à masquer côté site), mais il n'apparaît nulle part dans le contenu
  // visible ni dans le code visité de la page.
  const ownerSmsNumber = '+33765299386';
  // Séparateur avant "body=" dans un lien sms: — iOS attend "&", les
  // autres plateformes (Android, desktop) attendent "?". Sans cette
  // distinction, le message n'est pas pré-rempli sur la moitié des
  // téléphones.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const smsSeparator = isIOS ? '&' : '?';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = form.nom.value.trim();
    const telephone = form.telephone.value.trim();
    const categorie = form.categorie.value;
    const message = form.message.value.trim();

    if (!nom) { form.nom.focus(); return; }
    if (!categorie) { form.categorie.focus(); return; }
    if (!message) { form.message.focus(); return; }

    const body =
      `Réclamation Subito Pizza\n` +
      `Catégorie : ${categorie}\n` +
      `Prénom : ${nom}\n` +
      `Tél : ${telephone || 'non communiqué'}\n` +
      `Message : ${message}`;
    const smsUrl = `sms:${ownerSmsNumber}${smsSeparator}body=${encodeURIComponent(body)}`;

    window.location.href = smsUrl;
    if (choice) choice.hidden = true;
    if (note) note.hidden = true;
    sent.hidden = false;
  });
}
