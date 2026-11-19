/* ============================================================
   Subito Pizza — petite fenêtre d'accueil "Commandez en ligne"
   Chargée uniquement sur index.html. Indépendante du popup
   "réseaux sociaux" déjà existant (subito-popup.js) : clé de
   stockage distincte, et non chargée sur les mêmes pages (ce
   popup n'est que sur index.html, l'autre ne l'est pas) — pas
   de risque que les deux s'affichent en même temps.

   Affichée une seule fois par visiteur, jamais relancée après
   une fermeture (bouton ✕, clic hors de la fenêtre, ou Échap).
   ============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY = "subito_order_launch_popup_seen";
  // Élément qui avait le focus avant l'ouverture : il le récupère à la fermeture.
  let lastFocused = null;

  function qs(id) { return document.getElementById(id); }

  // Éléments atteignables au clavier dans la fenêtre (pour garder Tab à l'intérieur).
  function focusables(overlay) {
    return Array.prototype.slice.call(overlay.querySelectorAll("a[href], button:not([disabled])"));
  }

  function openPopup(overlay) {
    lastFocused = document.activeElement;
    overlay.hidden = false;
    const close = qs("orderPopupClose");
    if (close) close.focus();
  }

  function closePopup() {
    const overlay = qs("orderPopupOverlay");
    const wasOpen = !!overlay && !overlay.hidden;
    if (overlay) overlay.hidden = true;
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch (e) { /* stockage indisponible : tant pis, elle ne réapparaîtra pas pendant cette visite */ }
    if (wasOpen && lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    lastFocused = null;
  }

  function init() {
    const overlay = qs("orderPopupOverlay");
    if (!overlay) return;

    qs("orderPopupClose").addEventListener("click", closePopup);
    qs("orderPopupDismiss").addEventListener("click", closePopup);
    // « Créer mon compte » compte aussi comme vu : la fenêtre ne doit pas revenir au retour sur l'accueil.
    const cta = overlay.querySelector(".order-popup__cta");
    if (cta) cta.addEventListener("click", function () {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch (e) { /* stockage bloqué : tant pis */ }
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closePopup();
    });
    document.addEventListener("keydown", function (e) {
      if (overlay.hidden) return;
      if (e.key === "Escape") { closePopup(); return; }
      if (e.key !== "Tab") return;
      // Tab reste à l'intérieur de la fenêtre tant qu'elle est ouverte.
      const items = focusables(overlay);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    let alreadySeen = false;
    try { alreadySeen = localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { /* pas de stockage : on considère que non, tant pis si ça réapparaît */ }
    if (alreadySeen) return;

    setTimeout(function () {
      openPopup(overlay);
    }, 1600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
