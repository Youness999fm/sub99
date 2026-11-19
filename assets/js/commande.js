/* ============================================================
   Subito Pizza — page de suivi de commande (commande.html?id=…)
   Autonome (ne dépend pas de l'état du panier : le client peut avoir
   vidé son panier — tout vient de l'API, pour le client connecté dont
   c'est la commande, voir submitOrder() dans cart.js qui redirige ici
   juste après l'envoi).

   Sonde /api/order_status.php toutes les 4s tant que la commande est
   "new" (en attente) ; s'arrête dès qu'elle est acceptée ou refusée.
   Une fois acceptée, un minuteur compte le délai annoncé par le
   restaurant, jusqu'à "Votre commande est prête !".

   Ce suivi en direct s'arrête de lui-même 2h après l'heure prévue
   (qu'il y ait eu du retard ou non) : au-delà, la page renvoie vers
   l'historique de "Mon compte" plutôt que de continuer à afficher un
   suivi qui n'a plus de sens — demande explicite pour que "tout
   s'efface" côté suivi en direct, l'historique restant consultable
   séparément depuis le compte client.
   ============================================================ */

(function () {
  "use strict";

  function qs(id) { return document.getElementById(id); }
  function formatPrice(n) { return n.toFixed(2).replace(".", ",") + " €"; }
  function formatCents(cents) { return formatPrice((Number(cents) || 0) / 100); }

  // Échappement minimal : `note` (demande libre) et le nom du client sont du
  // texte saisi par quelqu'un, jamais à insérer tel quel dans le HTML.
  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  const params = new URLSearchParams(window.location.search);
  const orderId = /^\d+$/.test(params.get("id") || "") ? params.get("id") : null;

  const EXPIRE_AFTER_READY_MS = 2 * 60 * 60 * 1000; // 2h après l'heure prévue, au grand maximum

  let pollTimer = null;
  // Sondage séquentiel : une requête à la fois, délai qui grandit après un échec (30 s au plus),
  // arrêt après 30 minutes sans changement d'état.
  const POLL_BASE_MS = 4000;
  const POLL_MAX_MS = 30000;
  const POLL_STALE_MS = 30 * 60 * 1000;
  let polling = false;
  let inFlight = false;
  let pollFailures = 0;
  let lastStatus = null;
  let lastChangeAt = Date.now();
  let countdownTimer = null;
  // Clé du dernier rendu : le sondage ne reconstruit la page que si la commande change.
  let lastRenderKey = null;
  // Décalage entre l'horloge du serveur et celle du téléphone (serveur - téléphone, en ms) :
  // le minuteur se règle sur l'heure du serveur, pas sur celle de l'appareil.
  let clockOffset = 0;
  let readyAtMs = null;
  // Nom du client de la dernière commande reçue (pour le message de fin de suivi).
  let lastCustomerName = null;

  function serverNow() { return Date.now() + clockOffset; }

  const PAYMENT_LABELS = { card: SubitoIcons.svg('credit-card') + " Carte bancaire", cash: SubitoIcons.svg('banknote') + " Espèces", ticket: SubitoIcons.svg('ticket') + " Ticket Restaurant", ticket_card: SubitoIcons.svg('wallet') + " Carte Ticket Restaurant" };

  // Un ou plusieurs moyens de paiement (ex. espèces + carte ticket restaurant) :
  // libellés joints ; le détail du billet ne s'affiche que si les espèces sont cochées.
  function paymentLabel(methods, cashChangeFor) {
    const list = Array.isArray(methods) ? methods : [methods];
    return list.map(function (method) {
      let label = Object.prototype.hasOwnProperty.call(PAYMENT_LABELS, method) ? PAYMENT_LABELS[method] : esc(method);
      if (method === "cash") label += cashChangeFor ? " (billet de " + esc(cashChangeFor) + " €)" : " (appoint exact)";
      return label;
    }).join(" · ");
  }

  function renderItems(items) {
    return (items || []).map(function (it) {
      const label = esc(it.name) + (it.variant ? " (" + esc(it.variant) + ")" : "");
      const bits = [];
      if (it.half) bits.push("Moitié : " + esc(it.half.flavor1) + " / " + esc(it.half.flavor2));
      if (it.removed && it.removed.length) bits.push("Sans : " + esc(it.removed.join(", ")));
      if (it.extras && it.extras.length) bits.push("Suppléments : " + esc(it.extras.map(function (e) { return e.name; }).join(", ")));
      if (it.note) bits.push("Note : " + esc(it.note));
      return (
        '<div class="order-track-item">' +
          '<div class="order-track-item__head"><span>' + esc(Number(it.qty) || 1) + ' × ' + label + '</span><span>' + formatCents(it.line_total_cents != null ? it.line_total_cents : it.unit_price_cents * it.qty) + '</span></div>' +
          (bits.length ? '<p class="order-track-item__details">' + bits.join(" · ") + '</p>' : "") +
        '</div>'
      );
    }).join("");
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // Petit mot d'excuse affiché si le délai est dépassé : on ne sait jamais
  // à l'avance s'il y aura du retard (coup de feu en cuisine, circulation
  // pour le livreur…), donc il n'apparaît qu'une fois le minuteur à zéro,
  // jamais annoncé avant — demande explicite pour rester honnête.
  function sorryMessage(mode) {
    return mode === "delivery"
      ? SubitoIcons.svg('hand-heart') + " S'il y a un peu de retard, ne nous en voulez pas — votre livreur arrive, promis !"
      : SubitoIcons.svg('hand-heart') + " S'il y a un peu de retard, ne nous en voulez pas — on fait notre maximum pour que ce soit toujours aussi bon !";
  }

  function startCountdown(mode) {
    if (countdownTimer) clearInterval(countdownTimer);
    function tick() {
      const el = qs("orderCountdown");
      if (!el) { clearInterval(countdownTimer); return; }
      // Au-delà de 2 h après l'heure prévue, le suivi s'arrête, même si le sondage était déjà arrêté.
      if (serverNow() - readyAtMs > EXPIRE_AFTER_READY_MS) {
        renderExpired({ customer_name: lastCustomerName });
        return;
      }
      const remaining = readyAtMs - serverNow();
      if (remaining <= 0) {
        // Écrit une seule fois, et annoncé une fois (aria-live passe à polite) ; le minuteur continue,
        // pour que la limite de 2 h s'applique toujours.
        const pret = mode === "delivery" ? "Votre livreur devrait arriver" : "Votre commande est prête !";
        if (el.textContent !== pret) {
          el.setAttribute("aria-live", "polite");
          el.textContent = pret;
          const sorryEl = qs("orderSorry");
          if (sorryEl) {
            sorryEl.innerHTML = sorryMessage(mode);
            sorryEl.hidden = false;
          }
        }
      } else {
        el.textContent = formatCountdown(remaining);
      }
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // Au-delà de 2h après l'heure prévue, on arrête tout (sondage, minuteur)
  // et on renvoie vers l'historique du compte plutôt que de continuer à
  // afficher un suivi périmé.
  function renderExpired(order) {
    const body = qs("orderTrackBody");
    if (!body) return;
    body.innerHTML =
      '<p class="order-track-number">Commande de ' + esc(order.customer_name) + '</p>' +
      '<div class="order-track-status order-track-status--info" role="status">' +
        '<p class="order-track-status__title">Ce suivi n’est plus disponible.</p>' +
        '<p class="order-track-hint">Retrouvez vos commandes passées dans <a href="compte.html">Mon compte</a>.</p>' +
      '</div>';
    stopPolling();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function scheduleNext() {
    if (!polling) return;
    if (Date.now() - lastChangeAt > POLL_STALE_MS) {
      stopPolling();
      const body = qs("orderTrackBody");
      if (body && !qs("orderTrackNotice")) {
        const notice = document.createElement("p");
        notice.id = "orderTrackNotice";
        notice.className = "account-hint";
        notice.setAttribute("role", "status");
        notice.textContent = "Mise à jour automatique en pause : rechargez la page pour voir si votre commande a changé.";
        body.insertBefore(notice, body.firstChild);
      }
      return;
    }
    const delay = Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.pow(2, pollFailures));
    pollTimer = setTimeout(fetchStatus, delay);
  }

  function render(order) {
    lastCustomerName = order.customer_name || null;
    const parsedReady = order.status === "accepted" && order.ready_at ? Date.parse(order.ready_at) : NaN;
    readyAtMs = isNaN(parsedReady) ? null : parsedReady;

    if (readyAtMs !== null && (serverNow() - readyAtMs) > EXPIRE_AFTER_READY_MS) {
      renderExpired(order);
      return;
    }

    if (order.status !== lastStatus) { lastStatus = order.status; lastChangeAt = Date.now(); }

    // Sondage régulier : on ne reconstruit la page que si la commande a changé
    // (sinon le contenu serait remplacé sans cesse, y compris pour les lecteurs d'écran).
    const renderKey = JSON.stringify(order);
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;

    const body = qs("orderTrackBody");
    if (!body) return;
    const modeLabel = order.mode === "delivery" ? SubitoIcons.svg('bike') + " Livraison" : SubitoIcons.svg('shopping-bag') + " À emporter";
    let statusHtml = "";

    if (order.status === "new") {
      statusHtml =
        '<div class="order-track-status order-track-status--pending" role="status">' +
          '<span class="order-track-status__spinner" aria-hidden="true"></span>' +
          '<p>' + SubitoIcons.svg('hourglass') + ' En attente de confirmation du restaurant…</p>' +
          '<p class="order-track-hint">Cette page se met à jour toute seule, inutile de recharger.</p>' +
        '</div>';
    } else if (order.status === "accepted") {
      statusHtml =
        '<div class="order-track-status order-track-status--ok" role="status">' +
          '<p class="order-track-status__title">' + SubitoIcons.svg('circle-check', '1em', 'subito-icon--ok') + ' Commande acceptée !</p>' +
          '<p class="order-track-countdown" id="orderCountdown" aria-live="off">--:--</p>' +
          '<p class="order-track-hint">' + (order.mode === "delivery" ? "Votre livreur arrive dans ce délai." : "Votre commande sera prête dans ce délai.") + '</p>' +
          '<p class="order-track-sorry" id="orderSorry" hidden></p>' +
        '</div>';
    } else if (order.status === "refused") {
      statusHtml =
        '<div class="order-track-status order-track-status--error" role="status">' +
          '<p class="order-track-status__title">' + SubitoIcons.svg('frown', '1em', 'subito-icon--error') + ' Commande refusée par le restaurant.</p>' +
          '<p class="order-track-hint">Merci de nous appeler pour plus d’informations.</p>' +
          '<a class="btn-solid" href="tel:0321200033">' + SubitoIcons.svg('phone') + ' Appeler le restaurant</a>' +
        '</div>';
    }

    body.innerHTML =
      '<p class="order-track-number">Commande de ' + esc(order.customer_name) + ' — ' + modeLabel + '</p>' +
      statusHtml +
      '<div class="order-track-items">' + renderItems(order.items) + '</div>' +
      (order.promo_cents > 0 ? '<div class="order-track-fee"><span>Promotion</span><span>− ' + formatCents(order.promo_cents) + '</span></div>' : "") +
      (order.delivery_fee_cents > 0 ? '<div class="order-track-fee"><span>Frais de livraison</span><span>' + formatCents(order.delivery_fee_cents) + '</span></div>' : "") +
      '<div class="order-track-total"><span>Total</span><strong>' + formatCents(order.total_cents) + '</strong></div>' +
      (order.mode === "delivery" && order.payment_methods && order.payment_methods.length ? '<p class="order-track-payment">' + paymentLabel(order.payment_methods, order.cash_change_for) + '</p>' : "");

    if (readyAtMs !== null) {
      startCountdown(order.mode);
    } else if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }

    // Une fois traitée (acceptée ou refusée), le statut ne changera plus :
    // inutile de continuer à solliciter l'API toutes les 4 secondes. Le
    // minuteur, lui, continue de tourner localement jusqu'à l'expiration.
    if (order.status !== "new") stopPolling();
  }

  // Commande introuvable dans ce compte (ou à un autre client) : on n'insiste pas.
  function renderNotFound() {
    stopPolling();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const body = qs("orderTrackBody");
    if (body) body.innerHTML = '<p class="account-error" role="alert">Cette commande est introuvable dans votre compte.</p><p class="account-hint"><a href="compte.html">Mon compte</a></p>';
  }

  function fetchStatus() {
    if (inFlight) return;
    inFlight = true;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    let failed = false;
    // Délai maximal, corps compris : une requête suspendue (réseau mobile) ne doit pas bloquer le suivi.
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = setTimeout(function () { if (controller) controller.abort(); }, 10000);
    fetch("/api/order_status.php?id=" + encodeURIComponent(orderId), { credentials: "include", signal: controller ? controller.signal : undefined })
      .then(function (res) {
        if (res.status === 401) {
          stopPolling();
          window.location.href = "compte.html?retour=" + encodeURIComponent(window.location.pathname + window.location.search);
          return null;
        }
        if (res.status === 404) { renderNotFound(); return null; }
        if (!res.ok) throw new Error("http_" + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        pollFailures = 0;
        const notice = qs("orderTrackNotice");
        if (notice) notice.remove();
        const serverMs = data && data.server_now ? Date.parse(data.server_now) : NaN;
        if (!isNaN(serverMs)) clockOffset = serverMs - Date.now();
        if (data && data.order) render(data.order);
      })
      .catch(function () {
        failed = true;
        pollFailures++;
        const body = qs("orderTrackBody");
        if (!body) return;
        // Un rafraîchissement raté ne doit pas effacer une commande déjà affichée :
        // on garde le dernier état, avec un petit bandeau qui dit ce qui se passe.
        if (lastRenderKey !== null) {
          if (!qs("orderTrackNotice")) {
            const notice = document.createElement("p");
            notice.id = "orderTrackNotice";
            notice.className = "account-hint";
            notice.setAttribute("role", "status");
            notice.textContent = "Connexion perdue : nouvel essai automatique dès que possible.";
            body.insertBefore(notice, body.firstChild);
          }
          return;
        }
        body.innerHTML = '<p class="account-error" role="alert">Impossible de récupérer votre commande pour l’instant. Réessayez dans un instant, ou appelez-nous directement.</p>';
      })
      .then(function () {
        clearTimeout(timeout);
        inFlight = false;
        scheduleNext();
      });
  }

  function init() {
    const body = qs("orderTrackBody");
    if (!orderId) {
      if (body) body.innerHTML = '<p class="account-error" role="alert">Aucune commande à afficher — ce lien n’est pas valide.</p>';
      return;
    }
    polling = true;
    fetchStatus();
    // Sur mobile, l'onglet est souvent mis en veille : on revérifie dès
    // qu'il redevient visible plutôt que d'attendre le prochain sondage.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || inFlight) return;
      if (lastStatus !== null && lastStatus !== "new") return;
      lastChangeAt = Date.now();
      polling = true;
      fetchStatus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
