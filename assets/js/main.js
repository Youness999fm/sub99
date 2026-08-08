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
  initOrderStatus();
  initDaysCounter();
  initMenuJumpActive();
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

// Fait apparaître le nombre de jours écoulés depuis 1999 en le comptant
// jusqu'à sa valeur réelle (jamais figée), dans la scène finale. Ajoute
// un accent visuel discret si le site a franchi les 10 000 jours.
function initDaysCounter() {
  const numberEl = document.getElementById('finale-days-number');
  const wrapEl = document.getElementById('finale-days');
  if (!numberEl || !wrapEl) return;

  const target = daysSinceOpening();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (n) => n.toLocaleString('fr-FR');

  if (target >= 10000) wrapEl.classList.add('is-milestone');

  const setFinal = () => { numberEl.textContent = fmt(target); };

  if (reduceMotion) { setFinal(); return; }

  const animate = () => {
    const duration = 1400;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      numberEl.textContent = fmt(Math.round(eased * target));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        setFinal();
      }
    };
    window.requestAnimationFrame(step);
  };

  if (!('IntersectionObserver' in window)) { animate(); return; }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        // Synchronisé avec le temps d'arrivée de ce bloc dans la mise en
        // scène de la section finale (transition-delay CSS de 0.95s +
        // le temps que le fondu devienne perceptible).
        window.setTimeout(animate, 1250);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  observer.observe(wrapEl);
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
function setOdometer(container, valueStr, reduceMotion) {
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
      if (reduceMotion) track.style.transition = 'none';
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
  const sections = document.querySelectorAll('.menu-category[id]');
  if (!jump || !sections.length || !('IntersectionObserver' in window)) return;

  const links = Array.from(jump.querySelectorAll('a[href^="#"]'));
  const linkFor = (id) => links.find((a) => a.getAttribute('href') === `#${id}`);

  const setActive = (id) => {
    links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${id}`));
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && linkFor(entry.target.id)) {
        setActive(entry.target.id);
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

  sections.forEach((section) => observer.observe(section));
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

  const googleUrl = 'https://www.google.com/maps/search/?api=1&query=Subito+Pizza+333+rue+Elie+Gruyelle+H%C3%A9nin-Beaumont';

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

  const ownerEmail = 'contact@subito-pizza-heninbeaumont.fr';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = form.nom.value.trim();
    const telephone = form.telephone.value.trim();
    const categorie = form.categorie.value;
    const message = form.message.value.trim();

    if (!nom) { form.nom.focus(); return; }
    if (!categorie) { form.categorie.focus(); return; }
    if (!message) { form.message.focus(); return; }

    const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

    const subject = `[Réclamation] ${categorie} — ${nom}`;
    const body =
      `Réclamation reçue depuis le site Subito Pizza\n` +
      `-----------------------------------------\n` +
      `Catégorie : ${categorie}\n` +
      `Prénom    : ${nom}\n` +
      `Téléphone : ${telephone || 'non communiqué'}\n` +
      `Date      : ${date}\n` +
      `-----------------------------------------\n\n` +
      `Message du client :\n${message}`;
    const mailtoUrl = `mailto:${ownerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = mailtoUrl;
    if (choice) choice.hidden = true;
    if (note) note.hidden = true;
    sent.hidden = false;
  });
}
