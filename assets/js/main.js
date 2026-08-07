// Subito Pizza — comportements partagés (nav active, lightbox galerie, intro, animations)

document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  markActiveNavLink();
  initLightbox();
  initReviewForm();
  initScrollReveal();
  initIntroSplash();
  initHeaderCompact();
  initBackToTop();
  initParallax();
  initHeroCarousel();
});

// Fait défiler la photo du héros à travers toute la carte des pizzas
// (même cadre circulaire que la Pizza Subito), une image à la fois avec
// un fondu doux. Ne charge la photo suivante qu'au moment où elle est
// nécessaire, pour ne pas alourdir le chargement initial sur mobile.
function initHeroCarousel() {
  const img = document.getElementById('hero-plate-img');
  const caption = document.getElementById('hero-plate-caption');
  if (!img || !caption) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const pizzas = [
    { name: 'Subito', src: 'assets/img/photos/photo-24.jpg', caption: 'Notre signature, celle qui porte fièrement le nom de la maison : la <strong>Pizza Subito</strong>' },
    { name: 'Carnivora', src: 'assets/img/photos/carnivora.jpg' },
    { name: '4 Fromages', src: 'assets/img/photos/photo-01.jpg' },
    { name: 'Chèvre miel', src: 'assets/img/photos/chevre-miel.jpg' },
    { name: 'Végétarienne', src: 'assets/img/photos/photo-07.jpg' },
    { name: '3 Jambons', src: 'assets/img/photos/photo-30.jpg' },
    { name: '4 Saisons', src: 'assets/img/photos/photo-08.jpg' },
    { name: 'Calzone', src: 'assets/img/photos/photo-31.jpg' },
    { name: 'Campione', src: 'assets/img/photos/photo-06.jpg' },
    { name: 'Kebab', src: 'assets/img/photos/photo-28.jpg' },
    { name: 'Napolitaine', src: 'assets/img/photos/photo-09.jpg' },
    { name: 'Régina', src: 'assets/img/photos/photo-22.jpg' },
    { name: 'Chicken', src: 'assets/img/photos/photo-02.jpg' },
    { name: 'Kefta', src: 'assets/img/photos/photo-27.jpg' },
    { name: 'Neptune', src: 'assets/img/photos/photo-05.jpg' },
    { name: "L'Extravagante", src: 'assets/img/photos/photo-23.jpg' },
    { name: 'Fruits de mer', src: 'assets/img/photos/photo-13.jpg' },
    { name: 'Orientale', src: 'assets/img/photos/photo-04.jpg' },
    { name: 'Pacifico', src: 'assets/img/photos/photo-03.jpg' },
    { name: 'Venezia', src: 'assets/img/photos/photo-19.jpg' },
    { name: 'Chicken Chika', src: 'assets/img/photos/photo-21.jpg' },
    { name: 'Milano', src: 'assets/img/photos/photo-18.jpg' },
    { name: 'Normande', src: 'assets/img/photos/photo-16.jpg' },
    { name: 'Fajitas', src: 'assets/img/photos/photo-20.jpg' },
    { name: 'Maroilles', src: 'assets/img/photos/maroilles.jpg' },
    { name: 'Pollame', src: 'assets/img/photos/pollame.jpg' },
    { name: 'Savoyarde', src: 'assets/img/photos/photo-15.jpg' },
    { name: 'Indienne', src: 'assets/img/photos/photo-14.jpg' },
    { name: 'Carolina', src: 'assets/img/photos/carolina.jpg' }
  ];

  const preloadAt = (i) => {
    const next = new Image();
    next.src = pizzas[(i + 1) % pizzas.length].src;
  };
  preloadAt(0);

  let index = 0;
  window.setInterval(() => {
    index = (index + 1) % pizzas.length;
    const p = pizzas[index];

    img.classList.add('is-swapping');
    caption.classList.add('is-swapping');

    window.setTimeout(() => {
      img.src = p.src;
      img.alt = `Pizza ${p.name}, à retrouver sur notre carte`;
      caption.innerHTML = p.caption || `🍕 À retrouver sur notre carte : <strong>Pizza ${p.name}</strong>`;
      img.classList.remove('is-swapping');
      caption.classList.remove('is-swapping');
    }, 250);

    preloadAt(index);
  }, 3200);
}

// Léger effet de profondeur sur les halos décoratifs du héros, desktop
// uniquement : sur mobile, priorité à la fluidité, on ne touche pas au
// scroll (voir prefers-reduced-motion aussi respecté).
function initParallax() {
  const glows = document.querySelectorAll('.hero__glow');
  if (!glows.length) return;
  if (window.matchMedia('(max-width: 759px)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    glows.forEach((glow, i) => {
      glow.style.transform = `translateY(${y * (i === 0 ? 0.12 : 0.08)}px)`;
    });
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
  ['.gallery-grid__item', '.review-card', '.delivery-tier'].forEach((selector) => {
    const items = document.querySelectorAll(selector);
    if (!items.length) return;
    items.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${Math.min(i, 5) * 70}ms`;
      observer.observe(el);
    });
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
  const form = document.getElementById('review-form');
  if (!funnel || !form) return;

  // Adresse affichée dans le code / dans le mail du client (pas la vraie boîte
  // finale) : voir TODO plus bas dans avis.html pour la redirection OVH à créer
  // vers subito.pizza.hb@gmail.com.
  const ownerEmail = 'contact@subito-pizza-heninbeaumont.fr';

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

      // Petite pause pour que le client voie bien les étoiles se remplir
      // avant d'enchaîner sur l'étape suivante.
      setTimeout(() => {
        // 5 étoiles = très satisfait -> on encourage l'avis public sur Google.
        // 1 à 4 étoiles = insatisfaction -> on garde le retour en interne, jamais vers Google.
        if (currentNote === 5) {
          showPanel('thanks-google');
        } else {
          showPanel('comment');
          form.nom.focus();
        }
      }, 350);
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = form.nom.value.trim();
    const avis = form.avis.value.trim();

    if (!nom) { form.nom.focus(); return; }
    if (!avis) { form.avis.focus(); return; }

    const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const stars = '★'.repeat(currentNote) + '☆'.repeat(5 - currentNote);

    const subject = `Nouvel avis client (${currentNote}/5) — ${nom}`;
    const body =
      `Nouvel avis reçu depuis le site Subito Pizza\n` +
      `-----------------------------------------\n` +
      `Note      : ${stars}  (${currentNote}/5)\n` +
      `Prénom    : ${nom}\n` +
      `Date      : ${date}\n` +
      `-----------------------------------------\n\n` +
      `Message du client :\n${avis}\n\n` +
      `-----------------------------------------\n` +
      `Cet avis est privé : il n'est pas publié sur Google.`;
    const mailtoUrl = `mailto:${ownerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = mailtoUrl;
    showPanel('thanks-internal');
  });
}
