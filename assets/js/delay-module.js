/* ============================================================
   Subito Pizza — module "Délais actuels" (page d'accueil)
   Le délai à emporter reflète le réglage réel du commerçant
   (default_delay_minutes, lu via /api/pickup_delay.php, public,
   lecture seule). Le délai de livraison est fixe (1h), jamais
   recalculé : aucun appel serveur pour cette carte.
   ============================================================ */

(function () {
  "use strict";

  const POLL_MS = 60000;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lastMinutes = null;

  function render(numEl, unitEl, minutes) {
    const isHour = minutes === 60;
    const num = isHour ? "1" : String(minutes);
    const unit = isHour ? "h" : "min";
    if (reduceMotion || lastMinutes === null) {
      numEl.textContent = num;
      unitEl.textContent = unit;
      return;
    }
    numEl.classList.add("is-updating");
    setTimeout(function () {
      numEl.textContent = num;
      unitEl.textContent = unit;
      numEl.classList.remove("is-updating");
    }, 220);
  }

  function refresh(numEl, unitEl) {
    fetch("/api/pickup_delay.php", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        const minutes = data && Number.isInteger(data.pickup_delay_minutes) ? data.pickup_delay_minutes : null;
        if (minutes === null || minutes === lastMinutes) return;
        render(numEl, unitEl, minutes);
        lastMinutes = minutes;
      })
      .catch(function () { /* panne réseau : la valeur déjà affichée reste, pas d'erreur visible */ });
  }

  function init() {
    const numEl = document.getElementById("delayPickupNum");
    const unitEl = document.getElementById("delayPickupUnit");
    if (!numEl || !unitEl) return;
    refresh(numEl, unitEl);
    setInterval(function () { refresh(numEl, unitEl); }, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
