/* ============================================================
   Subito Pizza — Popup "Rejoignez-nous sur nos réseaux"
   Vanilla JS, aucune dépendance.

   Deux blocs de configuration :
   - SUBITO_CONFIG      : liens TikTok / Snapchat.
   - SUBITO_POPUP_CONFIG: fréquence d'affichage intelligente (localStorage).
   ============================================================ */

const SUBITO_CONFIG = {
  tiktokUrl: "https://www.tiktok.com/@subitopizzaoriginal",
  snapchatUrl: "https://www.snapchat.com/add/subito_henin"
};

const SUBITO_POPUP_CONFIG = {
  maxImpressions: 3,        // nombre maximum d'affichages, tous appareils/sessions confondus sur ce navigateur
  stopAfterClose: true,     // fermer (X / overlay / ESC) désactive définitivement le popup
  stopAfterSocialClick: true, // cliquer TikTok ou Snapchat désactive définitivement le popup
  storageKey: "subito_popup_state",
  popupDelay: 1200,
  debug: false              // true = logs détaillés dans la console
};

(function () {
  "use strict";

  const overlay = document.getElementById("subitoPopupOverlay");
  if (!overlay) return;

  const container = overlay.querySelector(".subito-popup-container");
  const closeBtn = document.getElementById("subitoPopupClose");
  const tiktokLink = document.getElementById("subitoPopupTiktok");
  const snapchatLink = document.getElementById("subitoPopupSnapchat");

  if (tiktokLink) tiktokLink.href = SUBITO_CONFIG.tiktokUrl;
  if (snapchatLink) snapchatLink.href = SUBITO_CONFIG.snapchatUrl;

  let isOpen = false;
  let lastFocusedElement = null;
  let closeTimer = null;

  /* ---------- Debug ---------- */

  function log(message) {
    if (SUBITO_POPUP_CONFIG.debug) {
      console.log("[Subito Popup] " + message);
    }
  }

  /* ---------- Persistance (localStorage, source de vérité) ---------- */

  function defaultState() {
    return {
      impressions: 0,
      dismissed: false,
      socialClicked: false,
      lastShownAt: null,
      permanentlyDisabled: false
    };
  }

  // Toujours relue depuis localStorage (jamais mise en cache en mémoire) pour
  // rester cohérente si plusieurs onglets du site sont ouverts en parallèle.
  function readState() {
    try {
      const raw = localStorage.getItem(SUBITO_POPUP_CONFIG.storageKey);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // fusion défensive : un ancien format ou des données corrompues ne doivent
      // jamais faire planter le popup.
      return Object.assign(defaultState(), parsed && typeof parsed === "object" ? parsed : {});
    } catch (e) {
      return defaultState();
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(SUBITO_POPUP_CONFIG.storageKey, JSON.stringify(state));
    } catch (e) {
      log("localStorage indisponible : l'état ne sera pas mémorisé pour cette visite.");
    }
  }

  /* ---------- Décision d'affichage ---------- */

  // Retourne { allowed: bool, reason: string } — jamais d'incrément ici :
  // seule une apparition RÉELLE incrémente le compteur (voir openPopup).
  function evaluateDisplay(state) {
    if (state.socialClicked) {
      return { allowed: false, reason: "TikTok/Snapchat clicked" };
    }
    if (state.dismissed && SUBITO_POPUP_CONFIG.stopAfterClose) {
      return { allowed: false, reason: "user dismissed" };
    }
    if (state.permanentlyDisabled) {
      return { allowed: false, reason: "permanently disabled" };
    }
    if (state.impressions >= SUBITO_POPUP_CONFIG.maxImpressions) {
      return { allowed: false, reason: "max impressions reached" };
    }
    return { allowed: true, reason: "" };
  }

  function markDismissed() {
    const state = readState();
    state.dismissed = true;
    if (SUBITO_POPUP_CONFIG.stopAfterClose) state.permanentlyDisabled = true;
    writeState(state);
    log(state.permanentlyDisabled
      ? "Popup disabled: user dismissed"
      : "Popup dismissed (will still show again: stopAfterClose=false)");
  }

  function markSocialClicked() {
    const state = readState();
    state.socialClicked = true;
    if (SUBITO_POPUP_CONFIG.stopAfterSocialClick) state.permanentlyDisabled = true;
    writeState(state);
    log("Popup disabled: TikTok/Snapchat clicked");
  }

  function recordImpression() {
    const state = readState();
    state.impressions += 1;
    state.lastShownAt = new Date().toISOString();
    writeState(state);
    log("Impression " + state.impressions + "/" + SUBITO_POPUP_CONFIG.maxImpressions);
  }

  /* ---------- Tracking analytics (facultatif, ne bloque jamais le popup) ---------- */

  function track(eventName) {
    try {
      if (window.dataLayer && typeof window.dataLayer.push === "function") {
        window.dataLayer.push({ event: eventName });
      }
    } catch (e) {
      /* le tracking ne doit jamais casser le popup */
    }
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
    // reflow forcé pour garantir la transition d'entrée
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");

    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown, true);

    const focusTarget = closeBtn || container;
    if (focusTarget) focusTarget.focus();

    recordImpression();
    track("subito_popup_open");
  }

  // Ferme visuellement le popup, sans toucher à l'état de mémorisation.
  // Utilisé à la fois par une fermeture volontaire (croix/overlay/ESC) et
  // par un clic social (le popup n'a plus lieu d'être une fois l'action faite).
  function hidePopupVisually() {
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
  }

  function closePopup() {
    if (!isOpen) return;
    hidePopupVisually();

    // X, clic sur l'overlay et ESC passent tous les trois par ici : c'est
    // volontairement le même traitement (règle n°6 du brief).
    markDismissed();
    track("subito_popup_close");
  }

  if (closeBtn) closeBtn.addEventListener("click", closePopup);
  overlay.addEventListener("click", onOverlayClick);

  if (tiktokLink) {
    tiktokLink.addEventListener("click", function () {
      markSocialClicked();
      track("subito_tiktok_click");
      hidePopupVisually();
    });
  }
  if (snapchatLink) {
    snapchatLink.addEventListener("click", function () {
      markSocialClicked();
      track("subito_snapchat_click");
      hidePopupVisually();
    });
  }

  /* ---------- Affichage automatique ---------- */

  function scheduleAutoOpen() {
    const initialState = readState();
    const initialCheck = evaluateDisplay(initialState);
    if (!initialCheck.allowed) {
      log("Popup disabled: " + initialCheck.reason);
      return;
    }

    window.setTimeout(function () {
      // Relecture juste avant l'affichage réel : limite les incohérences si
      // un autre onglet du site a changé l'état entre-temps.
      const freshState = readState();
      const freshCheck = evaluateDisplay(freshState);
      if (!freshCheck.allowed) {
        log("Popup disabled: " + freshCheck.reason);
        return;
      }
      openPopup();
    }, SUBITO_POPUP_CONFIG.popupDelay);
  }

  /* ---------- API publique (démo, tests, debug) ---------- */

  // Réouverture/fermeture manuelle (utilisée par le bouton de démo).
  window.SubitoPopup = { open: openPopup, close: closePopup };

  // Outils de test demandés dans le brief — utilisables depuis la console.
  window.resetSubitoPopup = function () {
    try {
      localStorage.removeItem(SUBITO_POPUP_CONFIG.storageKey);
    } catch (e) {
      /* rien à faire si le storage est indisponible */
    }
    log("State reset");
  };

  window.getSubitoPopupState = function () {
    return readState();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleAutoOpen);
  } else {
    scheduleAutoOpen();
  }
})();
