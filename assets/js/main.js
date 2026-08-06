// Subito Pizza — comportements partagés (nav active, lightbox galerie)

document.addEventListener('DOMContentLoaded', () => {
  markActiveNavLink();
  initLightbox();
  initReviewForm();
  initSplash();
});

function initSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;

  const hide = () => {
    splash.classList.add('is-hidden');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  };

  window.addEventListener('load', () => setTimeout(hide, 500));
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

  document.querySelectorAll('[data-lightbox-src]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      lightboxImg.src = trigger.getAttribute('data-lightbox-src');
      lightboxImg.alt = trigger.getAttribute('data-lightbox-alt') || '';
      lightbox.classList.add('is-open');
    });
  });

  const close = () => {
    lightbox.classList.remove('is-open');
    lightboxImg.src = '';
  };

  closeBtn.addEventListener('click', close);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function initReviewForm() {
  const form = document.getElementById('review-form');
  if (!form) return;

  // TODO: remplacer par l'adresse email où Subito Pizza veut recevoir les avis clients.
  const ownerEmail = 'avis@subito-pizza-heninbeaumont.fr';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = form.nom.value.trim();
    const note = form.note.value;
    const avis = form.avis.value.trim();

    if (!nom) { form.nom.focus(); return; }
    if (!avis) { form.avis.focus(); return; }

    const subject = `Nouvel avis client Subito Pizza — ${nom}`;
    const body = `Prénom : ${nom}\nNote : ${note}\n\nAvis :\n${avis}`;
    const mailtoUrl = `mailto:${ownerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = mailtoUrl;
  });
}
