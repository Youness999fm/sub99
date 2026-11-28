/* ============================================================================
   SUBITO PIZZA — Page « Nos allergènes » : recherche et filtres
   ----------------------------------------------------------------------------
   Confort uniquement : la page est entièrement lisible sans JavaScript (tout
   le contenu est dans le HTML). Ce script ne fait que masquer/afficher des
   fiches déjà présentes. Il ne touche à rien d'autre sur le site.
   ========================================================================== */
(function () {
  'use strict';

  function demarrer() {
    var recherche = document.getElementById('allergenRecherche');
    var vide = document.getElementById('allergenVide');
    var sections = [].slice.call(document.querySelectorAll('.subito-allergen-page__cat'));
    var filtres = [].slice.call(document.querySelectorAll('.subito-allergen-page__filtre'));
    if (!sections.length) return;

    var filtreActif = 'tout';

    function appliquer() {
      var q = (recherche && recherche.value || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      var visibles = 0;

      sections.forEach(function (section) {
        var cat = section.getAttribute('data-categorie');
        var okCategorie = filtreActif === 'tout' || filtreActif === cat;
        var fichesVisibles = 0;

        [].slice.call(section.querySelectorAll('[data-nom]')).forEach(function (fiche) {
          var nom = (fiche.getAttribute('data-nom') || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
          var montrer = okCategorie && (!q || nom.indexOf(q) !== -1);
          fiche.hidden = !montrer;
          if (montrer) fichesVisibles++;
        });

        section.hidden = fichesVisibles === 0;
        visibles += fichesVisibles;
      });

      if (vide) vide.hidden = visibles > 0;
    }

    if (recherche) recherche.addEventListener('input', appliquer);

    filtres.forEach(function (bouton) {
      bouton.addEventListener('click', function () {
        filtreActif = bouton.getAttribute('data-filtre') || 'tout';
        filtres.forEach(function (b) {
          var actif = b === bouton;
          b.classList.toggle('is-actif', actif);
          b.setAttribute('aria-pressed', actif ? 'true' : 'false');
        });
        appliquer();
      });
      bouton.setAttribute('aria-pressed', bouton.classList.contains('is-actif') ? 'true' : 'false');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
})();
