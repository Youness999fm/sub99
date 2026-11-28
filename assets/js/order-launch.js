/* ============================================================
   Subito Pizza — petite fenêtre d'accueil "Commandez en ligne"
   Chargée uniquement sur index.html. Indépendante du popup
   "réseaux sociaux" déjà existant (subito-popup.js) : clé de
   stockage distincte, et non chargée sur les mêmes pages (ce
   popup n'est que sur index.html, l'autre ne l'est pas) — pas
   de risque que les deux s'affichent en même temps.

   Affichée à CHAQUE ouverture de l'accueil (demande du
   27/11/2026) : le message « commande en ligne, aucun paiement
   en ligne » doit être vu, pas seulement à la toute première
   visite. Elle reste refermable immédiatement (bouton ✕, clic
   hors de la fenêtre, ou Échap), et n'est jamais montrée à un
   client déjà connecté — il n'a plus de compte à créer.
   ============================================================ */

(function () {
  "use strict";

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
    // Plus rien n'est mémorisé : la fenêtre doit revenir à la prochaine ouverture
    // de l'accueil. Fermée, elle ne réapparaît pas tant qu'on reste sur la page.
    if (wasOpen && lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    lastFocused = null;
  }

  function maybeOpenPopup(overlay) {
    setTimeout(function () {
      openPopup(overlay);
    }, 1600);
  }

  function init() {
    const overlay = qs("orderPopupOverlay");
    const launchSection = qs("orderLaunchSection");
    if (!overlay) return;

    qs("orderPopupClose").addEventListener("click", closePopup);
    qs("orderPopupDismiss").addEventListener("click", closePopup);
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

    // La section « ★ Nouveau ★ commandez en ligne » et la fenêtre qui invite à créer un
    // compte n'ont de sens que pour un visiteur qui n'en a pas encore : un client déjà
    // connecté le sait déjà (code 2026-11-20). Les deux restent visibles par défaut (cas
    // du simple visiteur, majoritaire) et ne sont masquées qu'une fois la session confirmée.
    if (window.SubitoAccount) {
      window.SubitoAccount.me().then(function (session) {
        if (session) {
          if (launchSection) launchSection.hidden = true;
        } else {
          maybeOpenPopup(overlay);
        }
      }).catch(function () {
        // Panne du service de session : on se comporte comme avant (visiteur), tant pis.
        maybeOpenPopup(overlay);
      });
    } else {
      maybeOpenPopup(overlay);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
