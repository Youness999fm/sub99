/* ============================================================================
   SUBITO PIZZA — Insertion de l'accordéon allergènes dans les fiches produits
   ----------------------------------------------------------------------------
   Strictement additif. Ce script :
     — ne modifie aucun élément existant (il n'en AJOUTE qu'un : un <details>) ;
     — n'écoute aucun événement du site, n'en intercepte aucun, n'en remplace
       aucun : <details>/<summary> est natif, il n'y a aucun JS d'ouverture ;
     — n'utilise ni MutationObserver, ni surcharge de fonction, ni modification
       de prototype ;
     — ne touche jamais au panier, aux prix, à la personnalisation.

   Point d'insertion : juste après <p class="menu-item__ingredients">, soit
   « à proximité de la description ». Sans danger pour l'existant, vérifié :
   cart.js lit .menu-item__ingredients (élément distinct, non modifié) puis
   empile ses widgets avec body.appendChild() — nos éléments insérés avant
   n'altèrent donc ni sa lecture ni l'ordre de ses propres ajouts.

   Un produit non documenté n'obtient simplement aucun accordéon.
   ========================================================================== */
(function () {
  'use strict';

  var D = window.SubitoAllergenes;
  var P = window.SubitoAllergenePictos;
  if (!D || !P) return; // dépendances absentes : on ne fait rien, rien ne casse.

  /* id de la <section class="menu-category"> → table de données. */
  var CATEGORIE_DOM = {
    pizzas: 'pizzas',
    pates: 'pates',
    subitowichs: 'subitowichs',
    'tex-mex': 'texmex',
    salades: 'salades',
    desserts: 'desserts'
    /* « boissons » volontairement absent : références à confirmer une par une
       auprès des fabricants avant publication. */
  };

  /* Fromages réellement nommés sur la carte : sert UNIQUEMENT à décider si la
     mention « lait pasteurisé » est pertinente pour ce produit. Ce n'est jamais
     une déduction d'allergène — ceux-ci viennent exclusivement du tableau. */
  var MOTS_FROMAGE = /fromage|mozzarella|brie|bleu|parmesan|ch[eè]vre|maroilles|reblochon|mascarpone|raclette/i;

  function echapper(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var CHEVRON = '<svg class="subito-allergen__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="m6 9 6 6 6-6"/></svg>';

  var INFO = '<svg class="subito-allergen__icone" width="14" height="14" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>';

  var CONTROLE = '<svg class="subito-allergen-picto" width="1em" height="1em" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M12 3.5 5 6v5.5c0 4 3 7.6 7 9 4-1.4 7-5 7-9V6l-7-2.5Z"/><path d="m9.2 12 2 2 3.6-3.8"/></svg>';

  /* Construit le <details> d'un produit. Retourne null si rien à afficher. */
  function construire(cles, avecFromage) {
    if (!cles || !cles.length) return null;

    var puces = cles.map(function (cle) {
      var cat = D.CATEGORIES[cle];
      if (!cat) return '';
      return '<li class="subito-allergen__item">' + P.svg(cle) + '<span>' + echapper(cat.nom) + '</span></li>';
    }).join('');

    var fromage = avecFromage
      ? '<p class="subito-allergen__fromage">' + CONTROLE + '<span>' + echapper(D.MENTION_FROMAGE) + '</span></p>'
      : '';

    var details = document.createElement('details');
    details.className = 'subito-allergen';
    details.innerHTML =
      '<summary class="subito-allergen__resume">'
        + INFO
        + '<span class="subito-allergen__label">Allergènes</span>'
        + CHEVRON
      + '</summary>'
      + '<div class="subito-allergen__contenu">'
        + '<ul class="subito-allergen__liste">' + puces + '</ul>'
        + fromage
        + '<p class="subito-allergen__note">' + echapper(D.MENTION_PERSO) + '</p>'
        + '<p class="subito-allergen__note">' + echapper(D.MENTION_CROISEE) + '</p>'
      + '</div>';
    return details;
  }

  function poser() {
    var fiches = document.querySelectorAll('.menu-item');
    for (var i = 0; i < fiches.length; i++) {
      var fiche = fiches[i];
      if (fiche.querySelector('.subito-allergen')) continue; // jamais deux fois

      /* Catégorie : soit l'id de la <section class="menu-category"> (menu.html),
         soit un attribut posé sur un conteneur pour les pages qui n'ont pas ce
         découpage (vegetarien.html n'a qu'une .menu-grid). */
      var section = fiche.closest('.menu-category');
      var categorie = section ? CATEGORIE_DOM[section.id] : null;
      if (!categorie) {
        var porteur = fiche.closest('[data-subito-allergen-categorie]');
        if (porteur) categorie = porteur.getAttribute('data-subito-allergen-categorie');
      }
      if (!categorie || !D.parCategorie[categorie]) continue;

      var nomEl = fiche.querySelector('.menu-item__name');
      var ingEl = fiche.querySelector('.menu-item__ingredients');
      if (!nomEl || !ingEl) continue;

      var cles = D.allergenesDe(categorie, nomEl.textContent);
      if (!cles) continue; // produit non documenté : aucun accordéon, aucune mention

      var bloc = construire(cles, MOTS_FROMAGE.test(ingEl.textContent));
      if (bloc) ingEl.insertAdjacentElement('afterend', bloc);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', poser);
  } else {
    poser();
  }
})();
