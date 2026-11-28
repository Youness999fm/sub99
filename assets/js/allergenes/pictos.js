/* ============================================================================
   SUBITO PIZZA — Pictogrammes des 14 catégories d'allergènes
   ----------------------------------------------------------------------------
   Même grammaire graphique que les icônes déjà présentes sur le site
   (assets/js/icons.js) : viewBox 24×24, trait 1.8, bouts et angles arrondis,
   couleur héritée via currentColor. Aucun emoji, aucune couleur en dur : les
   pictogrammes s'adaptent donc au contexte où ils sont posés.

   Ce ne sont PAS des symboles réglementaires officiels : ils accompagnent le
   nom écrit de l'allergène, qui reste la seule information qui fait foi.
   ========================================================================== */
(function (global) {
  'use strict';

  var TRACES = {
    /* Épi de blé */
    gluten: '<path d="M12 21V9"/><path d="M12 9c0-2 1.5-3.5 3.5-3.5C15.5 7.5 14 9 12 9Z"/><path d="M12 9C12 7 10.5 5.5 8.5 5.5 8.5 7.5 10 9 12 9Z"/><path d="M12 13.5c0-2 1.5-3.5 3.5-3.5 0 2-1.5 3.5-3.5 3.5Z"/><path d="M12 13.5c0-2-1.5-3.5-3.5-3.5 0 2 1.5 3.5 3.5 3.5Z"/><path d="M12 18c0-2 1.5-3.5 3.5-3.5 0 2-1.5 3.5-3.5 3.5Z"/><path d="M12 18c0-2-1.5-3.5-3.5-3.5 0 2 1.5 3.5 3.5 3.5Z"/>',
    /* Crevette */
    crustaces: '<path d="M19 7c-4.5 0-8 2.5-8 6 0 2.5 2 4.5 4.5 4.5"/><path d="M19 7c0 4.5-2.5 8-6 8"/><path d="M11 13c-2.5 0-4.5-1-5.5-2.5"/><path d="M10 16.5c-2 .5-4 0-5.5-1.5"/><path d="M19 7c1 0 2-.6 2.5-1.5"/><circle cx="17" cy="9.5" r=".6" fill="currentColor" stroke="none"/>',
    /* Œuf sur le plat */
    oeufs: '<path d="M12 4c3.9 0 6 3.4 6 7.5S15.9 20 12 20s-6-4.4-6-8.5S8.1 4 12 4Z"/><circle cx="12" cy="11.5" r="2.6"/>',
    /* Poisson */
    poissons: '<path d="M3 12c2.5-3.5 6-5.5 9.5-5.5S19 8.5 21 12c-2 3.5-5 5.5-8.5 5.5S5.5 15.5 3 12Z"/><path d="M21 12c-1 1-1.8 2.2-2.2 3.5"/><circle cx="8.5" cy="11" r=".7" fill="currentColor" stroke="none"/>',
    /* Cacahuète */
    arachides: '<path d="M14.5 4.5c2 1.2 2.6 3.6 1.5 5.4-.6 1-.6 2.2 0 3.2 1.1 1.8.5 4.2-1.5 5.4-2.3 1.4-5.3.6-6.6-1.7-.8-1.4-.7-3 .1-4.3.5-.8.5-1.8 0-2.6-.8-1.3-.9-2.9-.1-4.3 1.3-2.3 4.3-3.1 6.6-1.1Z"/><path d="M9.5 8.5h2M9.5 15h2"/>',
    /* Gousse de soja */
    soja: '<path d="M5 15c0-4.4 3.6-8 8-8 2.8 0 5 2.2 5 5s-2.2 5-5 5H8a3 3 0 0 1-3-2Z"/><circle cx="10" cy="13" r="1.2"/><circle cx="14.5" cy="12" r="1.2"/>',
    /* Brique / verre de lait */
    lait: '<path d="M8 8h8l1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L8 8Z"/><path d="M9 3h6l1 5H8l1-5Z"/><path d="M7.6 14h8.8"/>',
    /* Noisette */
    fruitsCoque: '<path d="M12 4c4 0 7 3.1 7 7 0 4.4-3.1 9-7 9s-7-4.6-7-9c0-3.9 3-7 7-7Z"/><path d="M12 4c-1.6 2.3-2.4 5-2.4 7.8 0 2.9.8 5.6 2.4 8.2"/>',
    /* Branche de céleri */
    celeri: '<path d="M8 21c-.6-4.5-.3-9 1-13.5"/><path d="M16 21c.6-4.5.3-9-1-13.5"/><path d="M12 21V7"/><path d="M9 7.5C8 5.5 9 3.5 11 3c.6 1.4.6 2.8 0 4.2"/><path d="M15 7.5c1-2 0-4-2-4.5-.6 1.4-.6 2.8 0 4.2"/><path d="M7.5 21h9"/>',
    /* Pot de moutarde */
    moutarde: '<path d="M9 9h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><path d="M10 9V6.5a2 2 0 0 1 4 0V9"/><path d="M9.5 13.5h5"/>',
    /* Graines de sésame */
    sesame: '<ellipse cx="9" cy="8.5" rx="2.1" ry="1.3" transform="rotate(-25 9 8.5)"/><ellipse cx="15" cy="11" rx="2.1" ry="1.3" transform="rotate(20 15 11)"/><ellipse cx="8.5" cy="14.5" rx="2.1" ry="1.3" transform="rotate(15 8.5 14.5)"/><ellipse cx="14" cy="17" rx="2.1" ry="1.3" transform="rotate(-20 14 17)"/>',
    /* Fiole / conservateur */
    sulfites: '<path d="M10 3h4"/><path d="M11 3v6.2L6.6 17a2 2 0 0 0 1.7 3h7.4a2 2 0 0 0 1.7-3L13 9.2V3"/><path d="M8.4 14h7.2"/>',
    /* Fleur de lupin */
    lupin: '<path d="M12 21V11"/><path d="M12 11c-1.9 0-3-1.3-3-2.8S10.1 5 12 5s3 1.7 3 3.2-1.1 2.8-3 2.8Z"/><path d="M12 5c0-1.1.9-2 2-2"/><path d="M9.5 13.5C8 13.5 7 12.6 7 11.4"/><path d="M14.5 16C16 16 17 15.1 17 13.9"/>',
    /* Coquillage */
    mollusques: '<path d="M12 20c-4.4 0-8-3.1-8-7 0-2.8 2.2-5 5-5h6c2.8 0 5 2.2 5 5 0 3.9-3.6 7-8 7Z"/><path d="M12 8v12"/><path d="M8.5 8.4 6.5 19"/><path d="M15.5 8.4 17.5 19"/>'
  };

  /* <svg> complet pour une catégorie. aria-hidden : le nom écrit juste à côté
     porte déjà l'information pour les lecteurs d'écran. */
  function svg(cle, taille) {
    var t = taille || '1em';
    var d = TRACES[cle];
    if (!d) return '';
    return '<svg class="subito-allergen-picto" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
      + d + '</svg>';
  }

  global.SubitoAllergenePictos = { svg: svg, traces: TRACES };
})(window);
