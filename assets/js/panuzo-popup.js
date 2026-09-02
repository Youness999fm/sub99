/* ============================================================
   Subito Pizza — Pop-up "Panuzo, il est de retour !"
   Campagne ONE SHOT : affichée au maximum une fois par navigateur,
   quelle que soit la façon dont elle est fermée.
   ============================================================ */

const PANUZO_POPUP_CONFIG = {
  ctaUrl: "menu.html#panuzo",
  popupDelay: 2500, // décalé après le voile d'intro de l'accueil (max ~2150ms)
  storageKey: "subito_panuzo_popup_state",
  debug: false
};

(function () {
  "use strict";

  const overlay = document.getElementById("panuzoPopupOverlay");
  if (!overlay) return;

  const container = overlay.querySelector(".panuzo-popup-container");
  const closeBtn = document.getElementById("panuzoPopupClose");
  const secondaryBtn = document.getElementById("panuzoPopupSecondary");
  const primaryCta = document.getElementById("panuzoPopupCta");

  if (primaryCta) primaryCta.href = PANUZO_POPUP_CONFIG.ctaUrl;

  let isOpen = false;
  let lastFocusedElement = null;
  let closeTimer = null;

  function log(message) {
    if (PANUZO_POPUP_CONFIG.debug) console.log("[Panuzo Popup] " + message);
  }

  /* ---------- Persistance : campagne one-shot ---------- */

  function hasBeenShown() {
    try {
      const raw = localStorage.getItem(PANUZO_POPUP_CONFIG.storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !!(parsed && parsed.shown);
    } catch (e) {
      return false; // storage indisponible : on affiche quand même (fail-open)
    }
  }

  function markShown() {
    try {
      localStorage.setItem(
        PANUZO_POPUP_CONFIG.storageKey,
        JSON.stringify({ shown: true, shownAt: new Date().toISOString() })
      );
    } catch (e) {
      log("localStorage indisponible : l'état ne sera pas mémorisé pour cette visite.");
    }
    log("POPUP2_SHOWN = true — campagne Panuzo ne sera plus jamais affichée sur ce navigateur.");
  }

  /* ---------- Focus / clavier ---------- */

  function getFocusableElements() {
    return Array.prototype.slice.call(
      container.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  function onKeydown(e) {
    if (!isOpen) return;
    if (e.key === "Escape" || e.key === "Esc") {
      closePopup();
      return;
    }
    if (e.key === "Tab") {
      const focusable = getFocusableElements();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onOverlayClick(e) {
    if (e.target === overlay) closePopup();
  }

  /* ---------- Ouverture / fermeture ---------- */

  function openPopup() {
    if (isOpen) return;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    isOpen = true;
    lastFocusedElement = document.activeElement;

    overlay.hidden = false;
    void overlay.offsetWidth; // reflow forcé pour garantir la transition d'entrée
    overlay.classList.add("is-visible");

    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown, true);

    if (closeBtn) closeBtn.focus();

    log("Popup Panuzo affiché");
  }

  // Fermeture demandée par le visiteur (X, overlay, ESC, "Accéder au site") :
  // toujours la même conséquence — on ne le dérangera plus avec cette campagne.
  function closePopup() {
    if (!isOpen) return;
    isOpen = false;

    overlay.classList.remove("is-visible");
    document.documentElement.style.overflow = "";
    document.removeEventListener("keydown", onKeydown, true);

    closeTimer = window.setTimeout(function () {
      overlay.hidden = true;
      closeTimer = null;
    }, 320);

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }

    markShown();
  }

  if (closeBtn) closeBtn.addEventListener("click", closePopup);
  if (secondaryBtn) secondaryBtn.addEventListener("click", closePopup);
  overlay.addEventListener("click", onOverlayClick);

  // Cliquer sur le CTA commercial est la meilleure issue possible : la
  // campagne a atteint son but, elle n'a donc plus besoin de revenir non plus.
  if (primaryCta) primaryCta.addEventListener("click", markShown);

  /* ---------- API publique (démo, tests, debug) ---------- */

  window.PanuzoPopup = { open: openPopup, close: closePopup };

  window.resetPanuzoPopup = function () {
    try {
      localStorage.removeItem(PANUZO_POPUP_CONFIG.storageKey);
    } catch (e) {
      /* rien à faire si le storage est indisponible */
    }
    log("État réinitialisé");
  };

  window.getPanuzoPopupState = function () {
    try {
      const raw = localStorage.getItem(PANUZO_POPUP_CONFIG.storageKey);
      return raw ? JSON.parse(raw) : { shown: false, shownAt: null };
    } catch (e) {
      return { shown: false, shownAt: null };
    }
  };

  /* ---------- Affichage automatique (une seule fois, jamais plus) ---------- */

  function scheduleAutoOpen() {
    if (hasBeenShown()) {
      log("Popup disabled: already shown once (one-shot campaign)");
      return;
    }
    window.setTimeout(function () {
      if (hasBeenShown()) {
        log("Popup disabled: already shown once (one-shot campaign)");
        return;
      }
      openPopup();
    }, PANUZO_POPUP_CONFIG.popupDelay);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleAutoOpen);
  } else {
    scheduleAutoOpen();
  }
})();
