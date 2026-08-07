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
});

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

  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    targets.forEach((el) => el.classList.add('is-visible'));
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
