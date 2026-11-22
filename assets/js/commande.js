/* ============================================================
   Subito Pizza — page de suivi de commande (commande.html?id=…)
   Autonome (ne dépend pas de l'état du panier : le client peut avoir
   vidé son panier — tout vient de l'API, pour le client connecté dont
   c'est la commande, voir submitOrder() dans cart.js qui redirige ici
   juste après l'envoi).

   Sonde /api/order_status.php toutes les 4s tant que la commande est
   "new" (en attente), puis toutes les 5s une fois "accepted" (le restaurant
   peut la marquer "ready" = prête) ; s'arrête dès qu'elle est prête ou
   refusée. L'écran se met à jour tout seul à chaque changement.
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

  // « aujourd'hui à 18h00 » / « demain à 12h30 » — même logique que commercant.js, en heure de Paris.
  function scheduledLabel(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return "";
    const TZ = "Europe/Paris";
    const dayKey = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
    const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
    let dayLabel;
    if (dayKey(d) === dayKey(new Date())) dayLabel = "aujourd’hui";
    else if (dayKey(d) === dayKey(new Date(Date.now() + 86400000))) dayLabel = "demain";
    else dayLabel = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
    return dayLabel + " à " + hm;
  }

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
  const POLL_ACCEPTED_MS = 5000;
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
  // Annulation (4 min) et ajout/modification (10 min) : fenêtres et indicateurs renvoyés par le serveur
  // (jamais recalculés côté client, même principe que readyAtMs/clockOffset ci-dessus).
  let cancelUntilMs = null;
  let addendumUntilMs = null;
  let canCancelFlag = false;
  let canAddFlag = false;
  let actionCountdownTimer = null;
  let currentOrder = null; // dernière commande complète reçue, nécessaire pour construire un ajout/modif
  let addPanelOpen = false;
  let addPanelBusy = false;
  let addendumKeySeq = 0;
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

  // allowModify : affiche un rappel d'appel sur chaque pizza déjà envoyée (jamais sur un article à prix
  // fixe) tant que le délai de 10 minutes est encore ouvert. Modifier un article déjà commandé n'est
  // volontairement PAS proposé en libre-service (décision du 22/11/2026) : seul un appel au restaurant
  // permet de changer les ingrédients d'une pizza déjà envoyée (ajouter un nouvel article reste possible
  // en libre-service, voir le panneau d'ajout plus bas).
  function renderItems(items, allowModify) {
    return (items || []).map(function (it) {
      const label = esc(it.name) + (it.variant ? " (" + esc(it.variant) + ")" : "");
      const bits = [];
      if (it.half) bits.push("Moitié : " + esc(it.half.flavor1) + " / " + esc(it.half.flavor2));
      if (it.removed && it.removed.length) bits.push("Sans : " + esc(it.removed.join(", ")));
      if (it.extras && it.extras.length) bits.push("Suppléments : " + esc(it.extras.map(function (e) { return e.name; }).join(", ")));
      if (it.note) bits.push("Note : " + esc(it.note));
      const showCallHint = allowModify && it.variant && it.id != null;
      return (
        '<div class="order-track-item">' +
          '<div class="order-track-item__head"><span>' + esc(Number(it.qty) || 1) + ' × ' + label + '</span><span>' + formatCents(it.line_total_cents != null ? it.line_total_cents : it.unit_price_cents * it.qty) + '</span></div>' +
          (bits.length ? '<p class="order-track-item__details">' + bits.join(" · ") + '</p>' : "") +
          (showCallHint ? '<p class="order-track-call-hint">Pour modifier cette pizza déjà commandée, appelez-nous : <a href="tel:0321200033">' + SubitoIcons.svg('phone') + ' 03 21 20 00 33</a></p>' : "") +
        '</div>'
      );
    }).join("");
  }

  function addendumKindLabel(kind) {
    return kind === "modify" ? "Modification" : kind === "cancel" ? "Annulation demandée" : "Ajout";
  }

  function renderAddendum(a, allowModify) {
    // Le rappel d'appel n'a de sens que sur un article introduit par un AJOUT (kind='add') : un
    // événement modify/cancel n'introduit jamais de nouvel article à pointer.
    const itemsHtml = renderItems(a.items, allowModify && a.kind === "add");
    return (
      '<div class="order-track-addendum">' +
        '<div class="order-track-addendum__head">' +
          '<span class="order-track-addendum__kind">AJOUT N°' + esc(a.seq) + " — " + addendumKindLabel(a.kind) + '</span>' +
          (a.delta_cents ? '<span>' + (a.delta_cents > 0 ? "+ " : "− ") + formatCents(Math.abs(a.delta_cents)) + '</span>' : '') +
        '</div>' +
        itemsHtml +
      '</div>'
    );
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
    // Pause après 30 minutes sans réponse du restaurant (« new » inchangé). Une commande déjà acceptée reste
    // suivie jusqu'à « prête » (un délai de 60 min dépasse 30 min) : son minuteur et l'expiration, 2 h après
    // l'heure prévue, bornent déjà la durée du suivi.
    if (lastStatus !== "accepted" && Date.now() - lastChangeAt > POLL_STALE_MS) {
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
    const base = lastStatus === "accepted" ? POLL_ACCEPTED_MS : POLL_BASE_MS;
    const delay = Math.min(POLL_MAX_MS, base * Math.pow(2, pollFailures));
    pollTimer = setTimeout(fetchStatus, delay);
  }

  // Signal d'un changement d'état détecté pendant le suivi (jamais au premier affichage). L'écran est déjà mis
  // à jour tout seul ; en plus : titre de l'onglet si la page est en arrière-plan, vibration si le navigateur
  // l'autorise, et notification système seulement si la permission a déjà été accordée (aucune demande ici).
  const baseTitle = document.title;
  function signalChange(order) {
    const ready = order.status === "ready";
    const title = ready ? "Votre commande est prête !" : order.status === "accepted" ? "Commande acceptée" : "Commande refusée";
    const body = ready
      ? (order.mode === "delivery" ? "Votre livreur arrive chez vous." : "Vous pouvez venir la récupérer au restaurant.")
      : order.status === "accepted" ? "Le restaurant prépare votre commande." : "Merci d’appeler le restaurant pour plus d’informations.";
    try {
      if (typeof navigator.vibrate === "function" && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
        navigator.vibrate(ready ? [300, 150, 300] : [200]);
      }
    } catch (e) { /* ignoré */ }
    if (document.hidden) document.title = "● " + title + " — Subito Pizza";
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body: body, tag: "subito-commande-" + orderId });
      }
    } catch (e) { /* non pris en charge */ }
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) document.title = baseTitle;
  });

  function render(order) {
    lastCustomerName = order.customer_name || null;
    currentOrder = order;
    canCancelFlag = !!order.can_cancel;
    canAddFlag = !!order.can_add_or_modify;
    const parsedCancel = order.cancel_eligible_until ? Date.parse(order.cancel_eligible_until) : NaN;
    cancelUntilMs = isNaN(parsedCancel) ? null : parsedCancel;
    const parsedAddendum = order.addendum_eligible_until ? Date.parse(order.addendum_eligible_until) : NaN;
    addendumUntilMs = isNaN(parsedAddendum) ? null : parsedAddendum;
    if (!canAddFlag) addPanelOpen = false;
    const parsedReady = order.status === "accepted" && order.ready_at ? Date.parse(order.ready_at) : NaN;
    readyAtMs = isNaN(parsedReady) ? null : parsedReady;

    if (readyAtMs !== null && (serverNow() - readyAtMs) > EXPIRE_AFTER_READY_MS) {
      renderExpired(order);
      return;
    }

    const preparedMs = order.status === "ready" && order.prepared_at ? Date.parse(order.prepared_at) : NaN;
    if (!isNaN(preparedMs) && (serverNow() - preparedMs) > EXPIRE_AFTER_READY_MS) {
      renderExpired(order);
      return;
    }

    const previousStatus = lastStatus;
    if (order.status !== lastStatus) { lastStatus = order.status; lastChangeAt = Date.now(); }

    // Sondage régulier : on ne reconstruit la page que si la commande a changé
    // (sinon le contenu serait remplacé sans cesse, y compris pour les lecteurs d'écran).
    const renderKey = JSON.stringify(order);
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;

    const body = qs("orderTrackBody");
    if (!body) return;
    const modeLabel = order.mode === "delivery" ? SubitoIcons.svg('bike') + " Livraison" : SubitoIcons.svg('shopping-bag') + " À emporter";
    const scheduledNote = order.scheduled_for
      ? '<p class="order-track-scheduled">' + SubitoIcons.svg('clock') + ' Commande programmée pour ' + esc(scheduledLabel(order.scheduled_for)) + '</p>'
      : "";
    let statusHtml = "";

    if (order.status === "new") {
      statusHtml =
        '<div class="order-track-status order-track-status--pending" role="status">' +
          '<span class="order-track-status__spinner" aria-hidden="true"></span>' +
          '<p>' + SubitoIcons.svg('hourglass') + (order.scheduled_for ? ' Commande programmée bien reçue — le restaurant la prépare au bon moment.' : ' En attente de confirmation du restaurant…') + '</p>' +
          '<p class="order-track-hint">Cette page se met à jour toute seule, inutile de recharger.</p>' +
        '</div>';
    } else if (order.status === "accepted" && order.delay_minutes === 0) {
      // Le restaurant a choisi « venir tout de suite » (ex. il va bientôt fermer) : pas de minuteur,
      // le message doit être vu dès l'acceptation.
      statusHtml =
        '<div class="order-track-status order-track-status--urgent" role="status">' +
          '<p class="order-track-status__title">' + SubitoIcons.svg('alarm-clock', '1em', 'subito-icon--ok') + ' Venez vite !</p>' +
          '<p class="order-track-hint">Merci de venir de suite au restaurant, car celui-ci va bientôt fermer.</p>' +
        '</div>';
    } else if (order.status === "accepted") {
      statusHtml =
        '<div class="order-track-status order-track-status--ok" role="status">' +
          '<p class="order-track-status__title">' + SubitoIcons.svg('circle-check', '1em', 'subito-icon--ok') + ' Commande acceptée !</p>' +
          '<p class="order-track-countdown" id="orderCountdown" aria-live="off">--:--</p>' +
          '<p class="order-track-hint">' + (order.mode === "delivery" ? "Votre livreur arrive dans ce délai." : "Votre commande sera prête dans ce délai.") + '</p>' +
          '<p class="order-track-sorry" id="orderSorry" hidden></p>' +
        '</div>';
    } else if (order.status === "ready") {
      statusHtml =
        '<div class="order-track-status order-track-status--ready" role="status">' +
          '<p class="order-track-status__title">' + SubitoIcons.svg('circle-check', '1em', 'subito-icon--ok') + ' Votre commande est prête !</p>' +
          '<p class="order-track-hint">' + (order.mode === "delivery" ? "Votre livreur arrive chez vous." : "Vous pouvez venir la récupérer au restaurant.") + '</p>' +
        '</div>';
    } else if (order.status === "refused") {
      statusHtml =
        '<div class="order-track-status order-track-status--error" role="status">' +
          '<p class="order-track-status__title">' + SubitoIcons.svg('frown', '1em', 'subito-icon--error') + ' Commande refusée par le restaurant.</p>' +
          '<p class="order-track-hint">Merci de nous appeler pour plus d’informations.</p>' +
          '<a class="btn-solid" href="tel:0321200033">' + SubitoIcons.svg('phone') + ' Appeler le restaurant</a>' +
        '</div>';
    }

    const addendaHtml = (order.addenda && order.addenda.length)
      ? '<div class="order-track-addenda"><p class="order-track-addenda__title">Ajouts à votre commande</p>' +
          order.addenda.map(function (a) { return renderAddendum(a, canAddFlag); }).join("") +
        '</div>'
      : "";

    // Demande d'annulation déposée, en attente de la décision du commerçant (décision du 22/11/2026) :
    // le client ne peut plus relancer une demande (bouton remplacé par un état "en cours", qui tourne).
    const cancelPending = !!order.cancel_requested_at && (order.status === "new" || order.status === "accepted");
    const actionsHtml = (canCancelFlag || cancelPending || canAddFlag)
      ? '<div class="order-track-actions">' +
          (cancelPending
            ? '<div class="order-track-action order-track-action--cancel">' +
                '<span class="order-track-pending" role="status">' +
                  '<span class="order-track-pending__spinner" aria-hidden="true"></span> Annulation demandée — en attente du restaurant' +
                '</span>' +
              '</div>'
            : canCancelFlag
            ? '<div class="order-track-action order-track-action--cancel">' +
                '<button type="button" class="btn-outline" data-action="cancel-order">Annuler ma commande</button>' +
                '<span class="order-track-action__timer" id="cancelCountdown" aria-live="off">--:--</span>' +
              '</div>'
            : "") +
          (canAddFlag
            ? '<div class="order-track-action order-track-action--add">' +
                '<button type="button" class="btn-outline" data-action="toggle-add-panel">' + (addPanelOpen ? "Fermer" : "Ajouter un article") + '</button>' +
                '<span class="order-track-action__timer" id="addendumCountdown" aria-live="off">--:--</span>' +
              '</div>'
            : "") +
        '</div>'
      : "";

    const addPanelHtml = addPanelOpen ? '<div class="order-track-add-panel" id="addPanel"><p class="account-hint">Chargement du menu…</p></div>' : "";

    body.innerHTML =
      '<p class="order-track-number">Commande de ' + esc(order.customer_name) + ' — ' + modeLabel + '</p>' +
      scheduledNote +
      statusHtml +
      '<div class="order-track-items">' + renderItems(order.items, canAddFlag) + '</div>' +
      (order.promo_cents > 0 ? '<div class="order-track-fee"><span>Promotion</span><span>− ' + formatCents(order.promo_cents) + '</span></div>' : "") +
      (order.delivery_fee_cents > 0 ? '<div class="order-track-fee"><span>Frais de livraison</span><span>' + formatCents(order.delivery_fee_cents) + '</span></div>' : "") +
      '<div class="order-track-total"><span>Total</span><strong>' + formatCents(order.total_cents) + '</strong></div>' +
      (order.mode === "delivery" && order.payment_methods && order.payment_methods.length ? '<p class="order-track-payment">' + paymentLabel(order.payment_methods, order.cash_change_for) + '</p>' : "") +
      addendaHtml + actionsHtml + addPanelHtml;

    if (readyAtMs !== null && order.delay_minutes !== 0) {
      startCountdown(order.mode);
    } else if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    startActionCountdowns();
    if (addPanelOpen) renderAddPanel();

    body.setAttribute("data-order-status", order.status);

    // Changement d'état pendant le suivi : signal en plus de la mise à jour de l'écran.
    if (previousStatus !== null && previousStatus !== order.status) signalChange(order);

    // Une fois prête ou refusée, le statut ne changera plus : inutile de continuer à solliciter l'API.
    // Tant qu'elle est « new » ou « accepted », le sondage continue. Le minuteur, lui, continue de
    // tourner localement jusqu'à l'expiration.
    if (order.status === "ready" || order.status === "refused") stopPolling();
  }

  /* ---------- Annulation (4 min) et ajout/modification (10 min) ---------- */

  function startActionCountdowns() {
    if (actionCountdownTimer) clearInterval(actionCountdownTimer);
    function tick() {
      const now = serverNow();
      let stillRunning = false;
      const cEl = qs("cancelCountdown");
      if (cEl) {
        const remaining = cancelUntilMs - now;
        if (remaining <= 0) {
          cEl.textContent = "Délai écoulé";
          const b = document.querySelector('[data-action="cancel-order"]');
          if (b) b.disabled = true;
        } else {
          cEl.textContent = "Encore " + formatCountdown(remaining);
          stillRunning = true;
        }
      }
      const aEl = qs("addendumCountdown");
      if (aEl) {
        const remaining = addendumUntilMs - now;
        if (remaining <= 0) {
          aEl.textContent = "Délai écoulé";
          const b = document.querySelector('[data-action="toggle-add-panel"]');
          if (b) b.disabled = true;
        } else {
          aEl.textContent = "Encore " + formatCountdown(remaining);
          stillRunning = true;
        }
      }
      if (!stillRunning && actionCountdownTimer) { clearInterval(actionCountdownTimer); actionCountdownTimer = null; }
    }
    tick();
    if (qs("cancelCountdown") || qs("addendumCountdown")) actionCountdownTimer = setInterval(tick, 1000);
  }

  function cancelOrder() {
    if (!orderId) return;
    if (!window.confirm("Confirmer la demande d’annulation ? Le restaurant doit encore l’accepter avant que la commande soit réellement annulée.")) return;
    const btn = document.querySelector('[data-action="cancel-order"]');
    if (btn) btn.disabled = true;
    fetch("/api/order_cancel.php", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(orderId) })
    })
      .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
      .then(function (r) {
        if (r.data && r.data.order) { lastRenderKey = null; render(r.data.order); }
        else window.alert((r.data && r.data.message) || "Impossible d’annuler pour le moment.");
      })
      .catch(function () { window.alert("Connexion perdue. Réessayez dans un instant."); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function toggleAddPanel() {
    addPanelOpen = !addPanelOpen;
    lastRenderKey = null;
    render(currentOrder);
  }

  // État effectif de toutes les lignes de la commande (même principe que effectiveOrderLines() côté
  // serveur, orders.js) : nécessaire pour ESTIMER le nouveau total avant envoi (le serveur reste la
  // seule source de vérité — voir submitAddendum, qui se resynchronise sur son total en cas d'écart).
  function effectiveLinesClientSide(order) {
    const out = [];
    (order.items || []).forEach(function (it) { out.push({ source: "item", id: it.id, unit: it.unit_price_cents, qty: it.qty, variant: it.variant }); });
    const latestModify = {};
    (order.addenda || []).forEach(function (a) {
      if (a.kind === "add") {
        (a.items || []).forEach(function (it) { out.push({ source: "addendum_item", id: it.id, unit: it.unit_price_cents, qty: it.qty, variant: it.variant }); });
      } else if (a.kind === "modify" && a.items && a.items[0]) {
        const key = (a.target_item_id != null ? "item:" + a.target_item_id : "addendum_item:" + a.target_addendum_item_id);
        latestModify[key] = a.items[0];
      }
    });
    return out.map(function (l) {
      const mod = latestModify[l.source + ":" + l.id];
      return mod ? { source: l.source, id: l.id, unit: mod.unit_price_cents, qty: mod.qty, variant: mod.variant } : l;
    });
  }

  function estimateTotal(order, lines) {
    let gross = 0;
    const pizzaUnits = [];
    lines.forEach(function (l) {
      gross += l.unit * l.qty;
      if (l.variant) for (let i = 0; i < l.qty; i++) pizzaUnits.push(l.unit);
    });
    pizzaUnits.sort(function (a, b) { return b - a; });
    let promo = 0;
    for (let i = 0; i + 1 < pizzaUnits.length; i += 2) {
      promo += order.mode === "delivery" ? Math.floor((pizzaUnits[i + 1] + 1) / 2) : pizzaUnits[i + 1];
    }
    const hasPizza = pizzaUnits.length > 0;
    const fee = (order.mode === "delivery" && !hasPizza) ? (order.delivery_fee_cents || 0) : 0;
    return gross - promo + fee;
  }

  // Convertit la ligne construite par le widget de personnalisation (cart.js, montants en EUROS) vers la
  // forme attendue par order_addendum_create.php (montants en centimes, suppléments {name,price_cents,qty}).
  function lineToAddendumItem(line) {
    const toCentsLocal = function (x) { return Math.round(x * 100); };
    const extras = (line.extras || []).map(function (e) { return { name: e.name, price_cents: toCentsLocal(e.price), qty: e.qty || 1 }; });
    const unit = toCentsLocal(line.basePrice) + extras.reduce(function (s, e) { return s + e.price_cents * e.qty; }, 0);
    return { name: line.name, variant: line.variant, qty: 1, unit_price_cents: unit, removed: line.removed || [], extras: extras, half: line.half || null, note: line.note || "" };
  }

  // Ajout d'un nouvel article à la commande (jamais une modification d'un article déjà envoyé, voir
  // order_addendum_create.js : kind='modify' n'est plus accepté).
  function submitAddendum(items) {
    if (addPanelBusy || !currentOrder) return;
    addPanelBusy = true;
    const newLines = items.map(function (it) { return { unit: it.unit_price_cents, qty: it.qty, variant: it.variant }; });
    const baseLines = effectiveLinesClientSide(currentOrder);
    const totalEstimate = estimateTotal(currentOrder, baseLines.concat(newLines));
    const key = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ("addendum-" + Date.now() + "-" + (++addendumKeySeq));

    function post(total) {
      const body = { order_id: Number(orderId), idempotency_key: key, kind: "add", items: items, total_cents: total };
      return fetch("/api/order_addendum_create.php", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      }).then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); });
    }

    post(totalEstimate)
      .then(function (r) {
        // Un seul nouvel essai, avec le total exact recalculé par le serveur (promo sur l'ensemble de
        // la commande) : jamais une boucle, jamais une 2e tentative sur une autre sorte d'erreur.
        if (r.status === 409 && r.data && r.data.error === "price_mismatch" && r.data.server_total_cents != null) {
          return post(r.data.server_total_cents);
        }
        return r;
      })
      .then(function (r) {
        if (r.data && r.data.order) {
          addPanelOpen = false;
          lastRenderKey = null;
          render(r.data.order);
        } else {
          window.alert((r.data && r.data.message) || "Impossible d’enregistrer cet ajout pour le moment.");
        }
      })
      .catch(function () { window.alert("Connexion perdue. Réessayez dans un instant."); })
      .then(function () { addPanelBusy = false; });
  }

  const ADD_PANEL_CATEGORY_TITLES = { boissons: "Boissons", desserts: "Desserts", "tex-mex": "Tex-Mex", pates: "Pâtes", subitowichs: "Subitowichs", salades: "Salades" };

  function renderAddPanel() {
    const panel = qs("addPanel");
    if (!panel) return;
    const W = window.SubitoPizzaWidget;
    if (!W) { panel.innerHTML = '<p class="account-error">Fonction indisponible pour le moment.</p>'; return; }

    panel.innerHTML = '<p class="account-hint">Chargement du menu…</p>';
    W.loadMenuCatalog().then(function (catalog) {
      if (addPanelBusy) { /* une soumission est déjà en cours : le panneau sera reconstruit juste après */ }
      panel.innerHTML = "";
      const byCategory = {};
      catalog.items.forEach(function (it) {
        if (it.kind !== "product") return;
        const cat = it.categoryId || "autres";
        (byCategory[cat] = byCategory[cat] || []).push(it);
      });
      Object.keys(byCategory).forEach(function (cat) {
        const title = document.createElement("p");
        title.className = "order-track-add-category";
        title.textContent = ADD_PANEL_CATEGORY_TITLES[cat] || cat;
        panel.appendChild(title);
        byCategory[cat].forEach(function (it) {
          // Choix obligatoire (base des subitowichs, crème fraîche ou tomate, décision du 22/11/2026) :
          // fait partie du nom envoyé, comme côté commande initiale (cart.js) — sinon le serveur refuse
          // l'ajout (unknown_item), le choix étant requis par le catalogue.
          const choice = it.choice && it.choice.options && it.choice.options.length ? it.choice : null;
          let chosen = "";
          const wrap = document.createElement("div");
          wrap.className = "order-track-add-item" + (choice ? " has-choice" : "");
          const row = document.createElement("div");
          row.className = "order-track-add-item__row";
          row.innerHTML = "<span>" + esc(it.name) + " — " + W.formatPrice(it.price) + "</span>";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "Ajouter";
          function effectiveName() { return choice && chosen ? it.name + " — " + (chosen.charAt(0).toUpperCase() + chosen.slice(1)) : it.name; }
          function sync() { btn.disabled = !!choice && !chosen; }
          btn.addEventListener("click", function () {
            if (choice && !chosen) return;
            submitAddendum([{ name: effectiveName(), variant: "", qty: 1, unit_price_cents: Math.round(it.price * 100), removed: [], extras: [], half: null, note: "" }]);
          });
          row.appendChild(btn);
          wrap.appendChild(row);
          if (choice) {
            const choiceWrap = document.createElement("div");
            choiceWrap.className = "order-track-add-choice";
            choice.options.forEach(function (opt) {
              const optBtn = document.createElement("button");
              optBtn.type = "button";
              optBtn.setAttribute("aria-pressed", "false");
              optBtn.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
              optBtn.addEventListener("click", function () {
                chosen = opt;
                Array.prototype.forEach.call(choiceWrap.children, function (c) { c.setAttribute("aria-pressed", "false"); });
                optBtn.setAttribute("aria-pressed", "true");
                sync();
              });
              choiceWrap.appendChild(optBtn);
            });
            wrap.appendChild(choiceWrap);
          }
          sync();
          panel.appendChild(wrap);
        });
      });
      if (catalog.sizeChart.length) {
        const pizzaTitle = document.createElement("p");
        pizzaTitle.className = "order-track-add-category";
        pizzaTitle.textContent = "Pizzas";
        panel.appendChild(pizzaTitle);
        catalog.items.filter(function (it) { return it.kind === "pizza"; }).forEach(function (it) {
          const wrap = document.createElement("div");
          wrap.className = "order-track-add-pizza";
          const label = document.createElement("p");
          label.textContent = it.name;
          wrap.appendChild(label);
          const widget = W.build(it.name, it.ingredients, catalog.sizeChart, catalog.pizzaCatalog, {
            allowHalf: it.allowHalf, choice: it.choice,
            onAdd: function (line) { submitAddendum([lineToAddendumItem(line)]); }
          });
          wrap.appendChild(widget);
          panel.appendChild(wrap);
        });
      }
    });
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
    // Informations venues de l'envoi (commande déjà enregistrée, articles restés dans le panier) : affichées
    // hors du conteneur du suivi, qui est réécrit à chaque état.
    const notes = [];
    if (params.get("deja") === "1") notes.push("Cette commande avait déjà été enregistrée : aucune nouvelle commande n’a été créée.");
    if (params.get("reste") === "1") notes.push("Des articles ajoutés pendant l’envoi restent dans votre panier : ils ne font pas partie de cette commande.");
    notes.forEach(function (texte) {
      if (!body || !body.parentNode) return;
      const p = document.createElement("p");
      p.className = "account-hint";
      p.setAttribute("role", "status");
      p.textContent = texte;
      body.parentNode.insertBefore(p, body);
    });
    polling = true;
    fetchStatus();
    // Sur mobile, l'onglet est souvent mis en veille : on revérifie dès
    // qu'il redevient visible plutôt que d'attendre le prochain sondage.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      // Le compte à rebours (annulation 4 min / ajout 10 min) reste basé sur l'horodatage absolu de la
      // commande (jamais mis en pause : la cuisine continue même onglet masqué) — mais l'intervalle qui
      // l'affiche est, lui, ralenti par le navigateur en arrière-plan. On force un recalcul immédiat dès
      // que l'onglet redevient visible pour ne pas laisser un chiffre figé à l'écran.
      if (currentOrder) startActionCountdowns();
      if (inFlight) return;
      if (lastStatus === "ready" || lastStatus === "refused") return;
      lastChangeAt = Date.now();
      polling = true;
      fetchStatus();
    });

    // Un seul écouteur délégué (le conteneur est réécrit à chaque rendu, les boutons qu'il contient non) :
    // annuler, ouvrir/fermer le panneau d'ajout, modifier une pizza précise.
    if (body) {
      body.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.getAttribute("data-action");
        if (action === "cancel-order") cancelOrder();
        else if (action === "toggle-add-panel") toggleAddPanel();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
