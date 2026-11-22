/* ============================================================
   Subito Pizza — Panier de commande
   Vanilla JS, aucune dépendance. Chargé sur toutes les pages (même
   pattern que subito-popup.js : un script autonome, une IIFE).

   Le panier envoie une vraie commande en ligne au restaurant (voir
   submitOrder()/startOnlineOrder() plus bas), via l'API /api/ — il
   faut être connecté (voir account.js/compte.html) pour commander.
   L'appel téléphonique reste proposé en solution de repli, affiché
   à côté du bouton "Commander".

   Important, tant que le backend (/api/) n'est pas en ligne : l'envoi
   échoue proprement avec un message clair invitant à appeler à la
   place — voir orderSubmitError(). Rien ne doit jamais prétendre
   qu'une commande est partie si l'API n'a pas confirmé.

   Les prix viennent toujours du DOM de la page (prix affiché sur la
   fiche produit, note de prix de la catégorie, ou grille des tailles)
   — jamais d'une liste de prix dupliquée ici, pour que le panier ne
   puisse jamais afficher un prix différent de ce que le client a vu
   sur la carte.
   ============================================================ */

const SUBITO_CART_CONFIG = {
  storageKey: "subito_cart_v1",
  phone: "0321200033",
  phoneDisplay: "03 21 20 00 33",
  apiBase: "/api/",
  debug: false
};

(function () {
  "use strict";

  function log(message) {
    if (SUBITO_CART_CONFIG.debug) console.log("[Subito Cart] " + message);
  }

  /* ---------- Argent : parsing / formatage ---------- */

  // "11,00 €", "5 €", "Nos Tex-Mex à 5 €" → 11 / 5 / 5 (nombre, jamais une
  // chaîne) : toute la suite du panier raisonne en nombres, l'affichage
  // ne reformate qu'à la toute fin (formatPrice).
  function parsePrice(text) {
    if (!text) return null;
    const match = String(text).match(/(\d+)(?:[.,](\d{1,2}))?\s*€/);
    if (!match) return null;
    const cents = match[2] ? match[2].padEnd(2, "0") : "00";
    return parseInt(match[1], 10) + parseInt(cents, 10) / 100;
  }

  function formatPrice(amount) {
    return amount.toFixed(2).replace(".", ",") + " €";
  }

  /* ---------- Persistance (localStorage, source de vérité) ---------- */

  // Structure d'une ligne :
  //   { id, name, variant, basePrice, qty, removed, extras, half, note }
  // `variant` (ex. "Duo") distingue deux lignes du même nom avec des
  // tailles différentes. `removed` (ingrédients retirés), `extras`
  // (suppléments ajoutés, [{name, price, qty}]), `half` (moitié-moitié,
  // {flavor1, flavor2} ou null) et `note` (demande libre) font partie de la
  // signature de la ligne (voir buildLineId) : deux articles identiques en
  // tout point se regroupent, deux articles personnalisés différemment
  // restent deux lignes séparées — jamais fusionnés silencieusement.
  function readCart() {
    try {
      const raw = localStorage.getItem(SUBITO_CART_CONFIG.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Compatibilité avec un panier enregistré avant l'ajout des options
      // (champ `unitPrice` sans `basePrice`/`removed`/`extras`/`half`/`note`).
      return parsed.map(function (l) {
        return {
          id: l.id,
          name: l.name,
          variant: l.variant || "",
          basePrice: typeof l.basePrice === "number" ? l.basePrice : (l.unitPrice || 0),
          qty: Math.max(1, parseInt(l.qty, 10) || 1),
          removed: Array.isArray(l.removed) ? l.removed : [],
          extras: Array.isArray(l.extras) ? l.extras : [],
          half: l.half || null,
          note: l.note || ""
        };
      });
    } catch (e) {
      return [];
    }
  }

  // Renvoie false si le navigateur refuse l'écriture (stockage bloqué, quota
  // dépassé) : l'appelant ne doit alors rien annoncer comme « ajouté ».
  function saveCart(cart) {
    try {
      localStorage.setItem(SUBITO_CART_CONFIG.storageKey, JSON.stringify(cart));
      return true;
    } catch (e) {
      log("localStorage indisponible : le panier ne sera pas conservé.");
      return false;
    }
  }

  function writeCart(cart) {
    dropSettledAttempts();
    const saved = saveCart(cart);
    renderAll();
    return saved;
  }

  function extrasTotal(line) {
    return (line.extras || []).reduce(function (sum, ex) { return sum + ex.price * ex.qty; }, 0);
  }

  function lineUnitPrice(line) {
    return line.basePrice + extrasTotal(line);
  }

  function cartGrossTotal(cart) {
    return cart.reduce(function (sum, line) { return sum + lineUnitPrice(line) * line.qty; }, 0);
  }

  // "1 pizza achetée = 1 offerte" (à emporter, toutes tailles, cumulable
  // sans limite — texte déjà affiché sur le site, voir index.html/menu.html).
  // Calculée sur TOUTES les pizzas du panier (prix unitaire = taille +
  // suppléments réellement facturés), en appariant du prix le plus élevé au
  // plus bas : dans chaque paire, la moins chère est offerte. Un supplément
  // ajouté sur une pizza ne peut donc jamais réduire la remise, seulement
  // l'augmenter ou rester neutre — jamais de total modifié en défaveur du
  // client. La promo livraison (−50 % 2ᵉ pizza) n'est
  // pas calculée ici : elle a sa propre fonction, pizzaPromoDelivery(), plus bas.
  function pizzaUnitPrices(cart) {
    const prices = [];
    cart.forEach(function (line) {
      if (!line.variant) return; // pas de taille = pas une pizza, non concerné
      const price = lineUnitPrice(line);
      for (let i = 0; i < line.qty; i++) prices.push(price);
    });
    return prices;
  }

  function pizzaPromo(cart) {
    const prices = pizzaUnitPrices(cart).slice().sort(function (a, b) { return b - a; });
    let discount = 0;
    let freeCount = 0;
    for (let i = 0; i + 1 < prices.length; i += 2) {
      discount += prices[i + 1];
      freeCount++;
    }
    return { pizzaCount: prices.length, freeCount: freeCount, discount: discount, hasLeftover: prices.length % 2 === 1 };
  }

  // Pendant de pizzaPromo() pour la livraison : "1 pizza achetée, la 2ème à
  // −50 %" (pas offerte à 100 % comme à l'emporter — mention déjà publiée
  // sur index.html/menu.html). Même appariement (plus chère payée pleine,
  // moins chère de la paire à moitié prix) pour ne jamais pénaliser le
  // client sur un supplément ajouté.
  function pizzaPromoDelivery(cart) {
    const prices = pizzaUnitPrices(cart).slice().sort(function (a, b) { return b - a; });
    let discount = 0;
    let halfPriceCount = 0;
    for (let i = 0; i + 1 < prices.length; i += 2) {
      discount += prices[i + 1] * 0.5;
      halfPriceCount++;
    }
    return { pizzaCount: prices.length, halfPriceCount: halfPriceCount, discount: discount, hasLeftover: prices.length % 2 === 1 };
  }

  function cartTotalDelivery(cart) {
    return cartGrossTotal(cart) - pizzaPromoDelivery(cart).discount;
  }

  // Zones de livraison et minimum de commande par ville (mêmes données que
  // la section "Notre zone de livraison" d'index.html — source unique ici
  // pour que le panier et la fiche "Mon compte" lisent toujours le même
  // barème, jamais deux listes dupliquées qui pourraient diverger).
  // `fee` : frais de livraison facturés uniquement si la commande ne contient
  // aucune pizza — une pizza dans le panier rend la livraison offerte.
  const DELIVERY_ZONES = [
    { city: "Hénin-Beaumont", minimum: 10, fee: 5.5 },
    { city: "Montigny-en-Gohelle", minimum: 15, fee: 5.5 },
    { city: "Dourges", minimum: 15, fee: 5.5 },
    { city: "Noyelles-Godault", minimum: 15, fee: 5.5 },
    { city: "Courrières", minimum: 20, fee: 8 },
    { city: "Billy-Montigny", minimum: 20, fee: 8 },
    { city: "Fouquières-lès-Lens", minimum: 25, fee: 8 },
    { city: "Rouvroy", minimum: 25, fee: 8 }
  ];
  window.SUBITO_DELIVERY_ZONES = DELIVERY_ZONES;
  // Type de logement : obligatoire avec l'adresse (le livreur doit savoir à qui/quoi s'attendre) —
  // mêmes 3 valeurs que serveur/customers.js HOUSING_TYPES, une seule liste pour tout le site.
  // Seulement "maison"/"appartement" proposés à la saisie (demande du 20/11, pattern standard des
  // sites de livraison) ; "immeuble" reste accepté côté serveur pour les comptes qui l'avaient déjà choisi.
  window.SUBITO_HOUSING_TYPES = [
    { value: "maison", label: "Maison" },
    { value: "appartement", label: "Appartement" }
  ];

  function findDeliveryZone(city) {
    if (!city) return null;
    return DELIVERY_ZONES.find(function (z) { return z.city === city; }) || null;
  }

  // Mode de retrait sélectionné dans le tiroir du panier : "pickup" (par
  // défaut) ou "delivery". Remis à "pickup" à chaque chargement de page —
  // sauf aller-retour volontaire par compte.html (connexion ou ajout
  // d'adresse), où il est restauré via sessionStorage (voir plus bas).
  let orderMode = "pickup";
  // Le client doit choisir explicitement "À emporter" ou "Livraison" avant de pouvoir commander
  // (aucun des deux boutons n'est présélectionné) : évite qu'il envoie une commande dans le mauvais
  // mode sans s'en rendre compte. Vrai dès qu'un choix a été fait une fois (y compris restauré).
  let modeChosen = false;

  // Sauce piquante (livraison uniquement, SBT-009) : choix obligatoire avant de commander, comme modeChosen —
  // jamais de défaut silencieux. null = pas encore choisi ; true/false sinon. Sans effet et jamais affiché
  // à l'emporter (remis à null à chaque chargement de page, comme orderMode).
  let hotSauceChoice = null;

  // Commande planifiée (type Uber Eats) : "now" (dès que possible, par défaut) ou "later" (le client choisit
  // un jour + un créneau de 30 min parmi ceux renvoyés par schedule_slots.php). Remis à zéro à chaque
  // chargement de page, comme orderMode.
  const SCHEDULE_TZ = "Europe/Paris";
  let scheduleChoice = "now";
  let scheduledFor = null; // ISO UTC du créneau choisi, ou null tant que rien n'est sélectionné
  let scheduleData = null; // réponse mise en cache de schedule_slots.php ({ immediate_open, days: [...] })
  let scheduleLoading = false;
  let scheduleError = false;
  let scheduleActiveDate = null; // date (AAAA-MM-JJ) affichée dans les onglets jours

  function scheduleDayKey(d) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: SCHEDULE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  function scheduleDayLabel(dateStr) {
    if (dateStr === scheduleDayKey(new Date())) return "Aujourd’hui";
    if (dateStr === scheduleDayKey(new Date(Date.now() + 86400000))) return "Demain";
    // Midi UTC : la conversion vers l'heure de Paris ne peut jamais faire basculer sur un autre jour calendaire.
    return new Intl.DateTimeFormat("fr-FR", { timeZone: SCHEDULE_TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(dateStr + "T12:00:00Z"));
  }

  function loadScheduleSlots() {
    if (scheduleData || scheduleLoading) return;
    scheduleLoading = true;
    scheduleError = false;
    fetch(SUBITO_CART_CONFIG.apiBase + "schedule_slots.php", { credentials: "include", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        scheduleLoading = false;
        scheduleData = data && Array.isArray(data.days) ? data : { immediate_open: false, days: [] };
        scheduleActiveDate = scheduleData.days.length ? scheduleData.days[0].date : null;
        renderDrawerExtra(sortedCart());
      })
      .catch(function () {
        scheduleLoading = false;
        scheduleError = true;
        renderDrawerExtra(sortedCart());
      });
  }

  function scheduleLaterHtml() {
    if (scheduleLoading) return '<p class="schedule-status schedule-status--pending">Chargement des horaires…</p>';
    if (scheduleError) return '<p class="schedule-status schedule-status--error">Impossible de charger les horaires — réessayez dans un instant.</p>';
    if (!scheduleData || !scheduleData.days.length) {
      return '<p class="schedule-status schedule-status--warn">Aucun horaire disponible pour une commande programmée pour le moment.</p>';
    }
    const days = scheduleData.days;
    const activeDay = days.find(function (d) { return d.date === scheduleActiveDate; }) || days[0];
    const dayTabs = days.map(function (d) {
      return '<button type="button" class="schedule-day' + (d.date === activeDay.date ? " is-active" : "") + '" data-date="' + d.date + '">' + escapeHtml(scheduleDayLabel(d.date)) + '</button>';
    }).join("");
    const slotButtons = activeDay.slots.map(function (s) {
      return '<button type="button" class="schedule-slot' + (scheduledFor === s.iso ? " is-active" : "") + '" data-iso="' + s.iso + '">' + escapeHtml(s.time) + '</button>';
    }).join("");
    return (
      '<div class="schedule-picker">' +
        '<div class="schedule-days" role="tablist" aria-label="Jour">' + dayTabs + '</div>' +
        '<div class="schedule-slots" role="group" aria-label="Heure">' + slotButtons + '</div>' +
      '</div>'
    );
  }

  function activePromo(cart) {
    return orderMode === "delivery" ? pizzaPromoDelivery(cart) : pizzaPromo(cart);
  }

  function activeCartTotal(cart) {
    return cartGrossTotal(cart) - activePromo(cart).discount;
  }

  function hasPizza(cart) {
    return cart.some(function (line) { return sizeRank(line.variant) !== -1; });
  }

  // Ville du compte client, mise à jour par renderDeliveryStatus() : permet de
  // calculer les frais de livraison de façon synchrone (totaux, récapitulatifs,
  // payload) sans relancer une requête compte à chaque rendu.
  let deliveryCity = null;

  function deliveryFee(cart) {
    if (orderMode !== "delivery" || hasPizza(cart)) return 0;
    const zone = findDeliveryZone(deliveryCity);
    return zone ? zone.fee : 0;
  }

  // Total payé par le client : produits (après promo) + frais de livraison éventuels.
  // Le minimum de commande, lui, reste calculé sur activeCartTotal() seul.
  function activeGrandTotal(cart) {
    return activeCartTotal(cart) + deliveryFee(cart);
  }

  function renderBarTotal(cart) {
    const el = document.getElementById("cartBarTotal");
    if (el) el.textContent = formatPrice(activeGrandTotal(cart));
  }

  // Moyens de paiement à la livraison : mêmes 4 libellés/icônes que la
  // section "Moyens de paiement acceptés" d'index.html (carte bancaire,
  // espèces, ticket restaurant papier, carte ticket restaurant — bien deux
  // choses différentes, le resto accepte les deux). Demandé uniquement en
  // livraison : à emporter, le client paie sur place sans avoir besoin de
  // le préciser à l'avance.
  const PAYMENT_METHODS = [
    { id: "card", label: "Carte bancaire", icon: "credit-card" },
    { id: "cash", label: "Espèces", icon: "banknote" },
    { id: "ticket", label: "Ticket Restaurant", icon: "ticket" },
    { id: "ticket_card", label: "Carte Ticket Restaurant", icon: "wallet" }
  ];
  // Montants courants (ex. 3 billets de 20 = 60) : pour que le livreur sache combien de monnaie
  // préparer à l'avance — pour des raisons de sécurité, il ne part pas
  // avec des espèces sur lui et ne peut pas rendre la monnaie sur place.
  const CASH_NOTES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  let paymentMethods = []; // ex. ["cash", "ticket_card"] : plusieurs moyens possibles, dans l'ordre de PAYMENT_METHODS
  let cashChangeFor = null; // montant du billet (ex. 20) ; 0 = appoint exact ; null = pas encore choisi (seulement si "cash" est coché)

  function paymentMethodHtml() {
    const cashBlock = paymentMethods.indexOf("cash") !== -1
      ? '<div class="payment-method__sub">' +
          '<p class="payment-method__title">Vous réglez avec <span class="account-optional">(pour que le livreur prépare la monnaie — il ne garde pas d’espèces sur lui)</span></p>' +
          '<div class="payment-method__options">' +
            CASH_NOTES.map(function (note) {
              return '<button type="button" class="payment-method__btn' + (cashChangeFor === note ? " is-active" : "") + '" data-change="' + note + '">' + note + ' €</button>';
            }).join("") +
            '<button type="button" class="payment-method__btn' + (cashChangeFor === 0 ? " is-active" : "") + '" data-change="0">Appoint exact</button>' +
          '</div>' +
        '</div>'
      : "";
    return (
      '<div class="payment-method">' +
        '<p class="payment-method__title">' + SubitoIcons.svg("credit-card") + ' Moyens de paiement à la livraison</p>' +
        '<p class="payment-method__hint">Vous pouvez en choisir plusieurs, par exemple espèces et carte ticket restaurant.</p>' +
        '<div class="payment-method__options">' +
          PAYMENT_METHODS.map(function (m) {
            return '<button type="button" class="payment-method__btn' + (paymentMethods.indexOf(m.id) !== -1 ? " is-active" : "") + '" aria-pressed="' + (paymentMethods.indexOf(m.id) !== -1 ? "true" : "false") + '" data-method="' + m.id + '">' + SubitoIcons.svg(m.icon) + " " + m.label + '</button>';
          }).join("") +
        '</div>' +
        cashBlock +
      '</div>'
    );
  }

  // Coche ou décoche un moyen de paiement (plusieurs possibles). L'ordre reste
  // celui de PAYMENT_METHODS, pas celui des clics : affichage et envoi identiques.
  function togglePaymentMethod(id) {
    const selected = paymentMethods.indexOf(id) === -1
      ? paymentMethods.concat([id])
      : paymentMethods.filter(function (m) { return m !== id; });
    paymentMethods = PAYMENT_METHODS.map(function (m) { return m.id; }).filter(function (m) { return selected.indexOf(m) !== -1; });
    // Le montant du billet ne concerne que les espèces : sans elles, il est oublié.
    if (paymentMethods.indexOf("cash") === -1) cashChangeFor = null;
  }

  function wirePaymentMethodEvents() {
    const container = document.querySelector(".payment-method");
    if (!container) return;
    container.querySelectorAll("[data-method]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (cartLocked()) { showToast("Commande en cours d’envoi : changez le paiement après la réponse."); return; }
        togglePaymentMethod(btn.getAttribute("data-method"));
        renderDrawerExtra(sortedCart());
      });
    });
    container.querySelectorAll("[data-change]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (cartLocked()) { showToast("Commande en cours d’envoi : changez le billet après la réponse."); return; }
        cashChangeFor = parseInt(btn.getAttribute("data-change"), 10);
        renderDrawerExtra(sortedCart());
      });
    });
  }

  function cartCount(cart) {
    return cart.reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  // Signature complète d'une configuration de produit — sert à la fois d'id
  // de ligne et de clé de fusion. Triée pour être indépendante de l'ordre
  // dans lequel le client a coché ses options.
  function buildLineId(name, variant, removed, extras, half, note) {
    const sig = {
      n: (name || "").toLowerCase(),
      v: (variant || "").toLowerCase(),
      r: (removed || []).slice().map(function (s) { return s.toLowerCase(); }).sort(),
      e: (extras || []).slice().map(function (ex) { return ex.name.toLowerCase() + ":" + ex.qty; }).sort(),
      h: half ? (half.flavor1 + ">" + half.flavor2).toLowerCase() : "",
      note: (note || "").trim().toLowerCase()
    };
    return JSON.stringify(sig);
  }

  // Rangement du récapitulatif par taille (toutes les Solo ensemble, toutes
  // les Duo ensemble, etc.), peu importe l'ordre réel d'ajout au panier —
  // demande explicite : un client qui alterne les tailles doit quand même
  // retrouver un récap groupé proprement. Les articles sans taille (prix
  // fixe) passent avant, dans leur ordre d'ajout (tri stable).
  const SIZE_ORDER = ["Solo", "Duo", "Quatro", "XXL"];
  function sizeRank(variant) {
    const idx = SIZE_ORDER.indexOf(variant);
    return idx === -1 ? -1 : idx;
  }
  function sortedCart() {
    return readCart().slice().sort(function (a, b) { return sizeRank(a.variant) - sizeRank(b.variant); });
  }

  // Ajoute une configuration complète au panier. Deux ajouts avec exactement
  // la même configuration (nom, taille, retraits, suppléments, moitiés,
  // demande libre) se regroupent (qty++) ; la moindre différence reste deux
  // lignes séparées — voir buildLineId().
  function addLine(config) {
    // Pendant l'envoi, le panier est figé : un article ajouté maintenant ne serait ni commandé ni vidé proprement.
    if (cartLocked()) { showToast("Commande en cours d’envoi : ajoutez cet article après la réponse."); return; }
    const name = config.name;
    const basePrice = config.basePrice;
    if (!name || typeof basePrice !== "number" || isNaN(basePrice)) {
      log("Ajout refusé (prix introuvable) : " + name);
      return;
    }
    const variant = config.variant || "";
    const removed = config.removed || [];
    const extras = config.extras || [];
    const half = config.half || null;
    const note = config.note || "";
    const cart = readCart();
    const id = buildLineId(name, variant, removed, extras, half, note);
    const existing = cart.find(function (l) { return l.id === id; });
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id: id, name: name, variant: variant, basePrice: basePrice, qty: 1, removed: removed, extras: extras, half: half, note: note });
    }
    if (!writeCart(cart)) {
      showToast("Impossible d’ajouter cet article : votre navigateur bloque le panier. Appelez-nous au " + SUBITO_CART_CONFIG.phoneDisplay + ".");
      return;
    }
    showToast((variant ? name + " (" + variant + ")" : name) + " ajouté ✓");
    bumpBar();
  }

  // Remplace une ligne existante par une nouvelle configuration (édition
  // depuis le panier) — fusionne avec une autre ligne identique si elle
  // existe déjà, sans jamais dupliquer silencieusement.
  function replaceLine(oldId, config) {
    let cart = readCart().filter(function (l) { return l.id !== oldId; });
    const variant = config.variant || "";
    const removed = config.removed || [];
    const extras = config.extras || [];
    const half = config.half || null;
    const note = config.note || "";
    const id = buildLineId(config.name, variant, removed, extras, half, note);
    const existing = cart.find(function (l) { return l.id === id; });
    if (existing) {
      existing.qty += config.qty || 1;
    } else {
      cart.push({ id: id, name: config.name, variant: variant, basePrice: config.basePrice, qty: config.qty || 1, removed: removed, extras: extras, half: half, note: note });
    }
    writeCart(cart);
    showToast("Article modifié ✓");
  }

  // Compatibilité : ajout simple sans personnalisation (desserts, boissons,
  // tex-mex, salades — catégories non concernées par la personnalisation).
  function addItem(name, variant, unitPrice) {
    addLine({ name: name, variant: variant, basePrice: unitPrice });
  }

  function lineId(name, variant) {
    return buildLineId(name, variant, [], [], null, "");
  }

  // Changer juste la quantité (sans ajouter/retirer de ligne) ne doit
  // jamais reconstruire toute la liste du panier : ça faisait disparaître
  // puis réapparaître chaque article à chaque appui sur +/-, donnant une
  // impression de lag même quand tout fonctionnait. On met à jour le
  // stockage et seulement la ligne concernée + le pied (totaux/promo).
  function setQty(id, qty) {
    if (cartLocked()) { showToast("Commande en cours d’envoi : modifiez votre panier après la réponse."); return; }
    const cart = readCart();
    if (qty <= 0) {
      writeCart(cart.filter(function (l) { return l.id !== id; }));
      return;
    }
    const line = cart.find(function (l) { return l.id === id; });
    if (!line) return;
    line.qty = qty;
    saveCart(cart);
    patchQtyDisplay(id);
  }

  function removeItem(id) {
    if (cartLocked()) { showToast("Commande en cours d’envoi : modifiez votre panier après la réponse."); return; }
    const cart = readCart().filter(function (l) { return l.id !== id; });
    writeCart(cart);
  }

  function clearCart() {
    writeCart([]);
  }

  /* ---------- Toast d'ajout ---------- */

  let toastTimer = null;
  function showToast(message, isHtml) {
    let toast = document.getElementById("cartToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "cartToast";
      toast.className = "cart-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    if (isHtml) toast.innerHTML = message; else toast.textContent = message;
    toast.classList.remove("is-visible");
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("is-visible"); }, 1800);
  }

  function bumpBar() {
    const bar = document.getElementById("cartBar");
    if (!bar) return;
    bar.classList.remove("is-bumping");
    void bar.offsetWidth;
    bar.classList.add("is-bumping");
  }

  /* ---------- Détection des produits de la page + injection des boutons ----------
     Toute la carte reste dans le HTML existant : on lit les prix déjà
     affichés (fiche produit, note de prix de catégorie, grille des
     tailles) plutôt que de dupliquer une liste de produits ici. */

  // Plusieurs catégories donnent des noms courts (« Bolognaise », « Milano »,
  // « Kebab »...) qui n'ont de sens qu'avec leur catégorie — et certains se
  // retrouvent même en double d'une catégorie à l'autre (« Milano » et
  // « Kebab » existent à la fois en pizza et en Subitowich). Sans la
  // catégorie, le récapitulatif peut induire en erreur au téléphone : on la
  // préfixe donc systématiquement pour ces catégories.
  const CATEGORY_LABELS = {
    pates: "Pâtes",
    subitowichs: "Subitowich",
    "tex-mex": "Tex-Mex",
    salades: "Salade",
    desserts: "Dessert",
    boissons: "Boisson"
  };

  // data-ticket-name (sur le <h3 class="menu-item__name">) : libellé de ticket propre à l'article, prioritaire
  // sur la règle générique de préfixe de catégorie (ex. boissons : "Canette Coca-Cola" -> ticket "Canette Coca").
  // Doit rester synchronisé avec tools/build-catalogue.mjs (qualifiedName), seule source du line_name du catalogue.
  function qualifiedName(name, category, ticketOverride) {
    if (ticketOverride) return ticketOverride;
    if (!category) return name;
    const label = CATEGORY_LABELS[category.id];
    if (!label) return name;
    // Évite un doublon si le nom affiché commence déjà par le libellé
    // (ex. le produit "Boisson 33cl" ne doit pas devenir "Boisson Boisson 33cl").
    if (name.toLowerCase().indexOf(label.toLowerCase()) === 0) return name;
    return label + " " + name;
  }

  function priceFromCategoryNote(categorySection) {
    const note = categorySection.querySelector(".menu-category__price-note");
    if (note) {
      const p = parsePrice(note.textContent);
      if (p !== null) return p;
    }
    const title = categorySection.querySelector(".menu-category__title");
    if (title) {
      const p = parsePrice(title.textContent);
      if (p !== null) return p;
    }
    return null;
  }

  function readSizeChart(root) {
    const items = (root || document).querySelectorAll(".size-chart__item");
    const sizes = [];
    items.forEach(function (item) {
      const name = item.querySelector(".size-chart__name");
      const price = item.querySelector(".size-chart__price");
      if (!name || !price) return;
      const p = parsePrice(price.textContent);
      if (p !== null) sizes.push({ label: name.textContent.trim(), price: p });
    });
    return sizes;
  }

  // "Sauce tomate, fromage, jambon ou thon ou kebab" → chaque ingrédient
  // séparé par une virgule ET chaque alternative "X ou Y" devient une puce
  // "Sans" distincte — uniquement les ingrédients réellement écrits sur la
  // fiche, jamais une liste inventée.
  function parseIngredients(text) {
    if (!text) return [];
    const out = [];
    text.split(",").forEach(function (part) {
      part.split(/\s+ou\s+/i).forEach(function (tok) {
        const t = tok.trim();
        if (t && out.indexOf(t) === -1) out.push(t);
      });
    });
    return out;
  }

  // Garniture à choisir (calzone) : la fiche écrit "Garniture au choix : jambon,
  // thon… ou poulet" dans un span .menu-item__choice. Ce n'est PAS une liste
  // d'ingrédients à retirer, c'est le choix obligatoire du client : on le lit à
  // part, et seuls les ingrédients fixes restent dans "Sans".
  function readMenuItemIngredients(item) {
    const el = item.querySelector(".menu-item__ingredients");
    if (!el) return { ingredients: [], choice: null };
    const copy = el.cloneNode(true);
    const choiceEl = copy.querySelector(".menu-item__choice");
    let choice = null;
    if (choiceEl) {
      const raw = choiceEl.textContent;
      const colon = raw.indexOf(":");
      choice = {
        label: (colon === -1 ? raw : raw.slice(0, colon)).trim(),
        options: parseIngredients(colon === -1 ? "" : raw.slice(colon + 1))
      };
      choiceEl.remove();
    }
    return { ingredients: parseIngredients(copy.textContent), choice: choice };
  }

  function capitalizeFirst(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  // Liste des pizzas réellement présentes sur CETTE page (menu.html : tout
  // #pizzas ; vegetarien.html : pas de section #pizzas, mais la page entière
  // est une sélection de pizzas) — jamais une liste écrite en dur, pour que
  // le moitié-moitié ne propose jamais un parfum absent de la page.
  function readPizzaCatalog(root) {
    const doc = root || document;
    const scope = doc.getElementById("pizzas") || doc.querySelector("main") || doc;
    const catalog = [];
    scope.querySelectorAll(".menu-item").forEach(function (item) {
      const nameEl = item.querySelector(".menu-item__name");
      const ownPrice = item.querySelector(".menu-item__price");
      if (!nameEl || ownPrice) return; // un prix propre = pas une pizza (taille)
      if (item.hasAttribute("data-no-half")) return; // calzone : jamais un parfum de moitié-moitié
      catalog.push({ name: nameEl.textContent.trim(), ingredients: readMenuItemIngredients(item).ingredients });
    });
    return catalog;
  }

  // Suppléments : seule source de vérité = supplements.html (déjà dupliqué
  // avec composer.html sur le site existant, mais pas réécrit ici) — on va
  // le chercher une fois, jamais de prix recopié en dur dans ce fichier.
  let supplementGroupsPromise = null;
  function loadSupplementGroups() {
    if (supplementGroupsPromise) return supplementGroupsPromise;
    supplementGroupsPromise = fetch("supplements.html")
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)); })
      .then(function (html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const groups = [];
        doc.querySelectorAll(".compose-group").forEach(function (g) {
          const titleEl = g.querySelector(".compose-group__title");
          const listEl = g.querySelector(".compose-group__list");
          if (!titleEl || !listEl) return;
          const title = titleEl.textContent.replace(/^Prix par ingrédient supplémentaire\s*—\s*/i, "").trim();
          const names = listEl.textContent.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
          const pricesBySize = {};
          g.querySelectorAll(".compose-price-row__item").forEach(function (row) {
            const sizeEl = row.querySelector(".compose-price-row__name");
            const priceEl = row.querySelector(".compose-price-row__price");
            if (!sizeEl || !priceEl) return;
            const p = parsePrice(priceEl.textContent);
            if (p !== null) pricesBySize[sizeEl.textContent.trim()] = p;
          });
          groups.push({ title: title, names: names, pricesBySize: pricesBySize });
        });
        return groups;
      })
      .catch(function (e) {
        log("Suppléments indisponibles (" + e.message + ") : section masquée, aucun prix inventé.");
        return [];
      });
    return supplementGroupsPromise;
  }

  // Même principe que loadSupplementGroups() ci-dessus, pour le catalogue complet (pizzas, tailles,
  // produits à prix fixe) : utile sur une page qui n'a pas la grille du menu dans son propre HTML (ex.
  // commande.html, pour proposer un ajout à une commande déjà envoyée).
  let menuCatalogPromise = null;
  function loadMenuCatalog() {
    if (menuCatalogPromise) return menuCatalogPromise;
    menuCatalogPromise = fetch("menu.html")
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)); })
      .then(function (html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return scanMenuCatalog(doc);
      })
      .catch(function (e) {
        log("Catalogue indisponible (" + e.message + ") : aucun article inventé.");
        return { items: [], sizeChart: [], pizzaCatalog: [] };
      });
    return menuCatalogPromise;
  }

  /* ---------- Personnalisation (panneau dépliable sous le produit) ----------
     Toujours repliée par défaut, jamais dans le panier : le client choisit
     ses options directement sous la pizza/le plat, puis l'ajoute depuis ce
     panneau. Le panier, lui, ne fait qu'afficher le résultat (c'est un
     pense-bête, pas une étape de configuration). */

  let customizeIdCounter = 0; // identifiants uniques pour associer <label for>

  // Règle d'échange : retirer un ingrédient donne un crédit égal à SON PRIX (à la taille
  // choisie). Un supplément ajouté est gratuit si son prix est inférieur ou égal à un crédit
  // encore disponible (le plus petit crédit suffisant est consommé) ; sinon il reste payant.
  // Une viande (plus chère) retirée couvre donc un légume ou un œuf (moins chers) en plus
  // d'une autre viande ; un légume retiré ne couvre jamais une viande (plus chère), seulement
  // un légume ou un œuf. Chaque retrait ne couvre qu'un seul ajout, jamais plus.
  // Même pliage que normName() côté serveur (serveur/util.js) : un ingrédient fixe de fiche
  // s'écrit parfois différemment du supplément correspondant (ex. « oeuf » sur la fiche,
  // « Œuf » dans supplements.html) — nécessaire pour que le crédit d'un retrait le reconnaisse.
  function normalizeIngredientName(name) {
    return (name || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
      .replace(/\*$/, "").trim();
  }

  function applySwapDiscount(removedList, extrasList, groups, sizeLabel) {
    const plain = function (list) { return list.map(function (ex) { return { name: ex.name, price: ex.price, qty: ex.qty }; }); };
    if (!groups || !groups.length || !sizeLabel) return plain(extrasList);
    const priceOf = {};
    groups.forEach(function (g) {
      const price = g.pricesBySize[sizeLabel];
      if (price === undefined) return;
      g.names.forEach(function (n) { priceOf[normalizeIngredientName(n)] = price; });
    });
    const credits = [];
    (removedList || []).forEach(function (ing) {
      const price = priceOf[normalizeIngredientName(ing)];
      if (price !== undefined) credits.push(price);
    });
    credits.sort(function (a, b) { return a - b; }); // best-fit : le plus petit crédit suffisant d'abord
    return extrasList.map(function (ex) {
      let ci = -1;
      for (let i = 0; i < credits.length; i++) {
        if (credits[i] >= ex.price) { ci = i; break; }
      }
      if (ci !== -1) {
        credits.splice(ci, 1);
        return { name: ex.name, price: 0, qty: ex.qty, swapped: true };
      }
      return { name: ex.name, price: ex.price, qty: ex.qty };
    });
  }

  function chipRow(labelText, values, selected) {
    const row = document.createElement("div");
    row.className = "customize__chips";
    values.forEach(function (v) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "customize__chip";
      chip.textContent = "Sans " + v;
      chip.setAttribute("aria-pressed", selected.indexOf(v) !== -1 ? "true" : "false");
      if (selected.indexOf(v) !== -1) chip.classList.add("is-active");
      chip.addEventListener("click", function () {
        const i = selected.indexOf(v);
        if (i === -1) selected.push(v); else selected.splice(i, 1);
        chip.classList.toggle("is-active");
        chip.setAttribute("aria-pressed", chip.classList.contains("is-active") ? "true" : "false");
        row.dispatchEvent(new CustomEvent("customize:change"));
      });
      row.appendChild(chip);
    });
    return row;
  }

  // Widget complet pour une pizza : UNE SEULE rangée de tailles (servant à
  // la fois à l'ajout rapide et à la personnalisation — l'utilisateur a
  // signalé que la dupliquer entre le haut de la fiche et le panneau
  // "faisait bizarre"), moitié-moitié (Duo/Quatro/XXL uniquement, selon la
  // mention déjà présente sur le site — "À partir de la taille Duo,
  // possibilité de moitié-moitié"), retraits d'ingrédients, suppléments
  // (prix réels par taille), demande libre.
  function buildPizzaWidget(productName, ingredients, sizes, pizzaCatalog, options) {
    const wrap = document.createElement("div");
    wrap.className = "pizza-widget";

    // --- État partagé par tout le widget ---
    const opts = options || {};
    const allowHalf = opts.allowHalf !== false; // calzone : jamais de moitié-moitié
    const choice = opts.choice || null; // { label, options } : garniture obligatoire (calzone)
    let size = null; // {label, price}
    let halfOn = false;
    let half2 = "";
    let filler = ""; // garniture choisie ("" tant que rien n'est choisi)
    // Garniture obligatoire : tant qu'elle manque, rien ne part au panier.
    function missingFiller() { return !!choice && !filler; }
    // La garniture fait partie du nom de la ligne : deux garnitures = deux lignes
    // distinctes, visibles partout (panier, récap, commande, suivi) sans changer le format.
    function displayName() { return choice && filler ? productName + " — " + capitalizeFirst(filler) : productName; }
    const removed = [];
    const extras = []; // {name, price, qty, group}
    let loadedGroups = []; // suppléments résolus pour la taille affichée

    // --- Taille : unique rangée, sert à l'ajout rapide ET à la personnalisation ---
    const sizeRow = document.createElement("div");
    sizeRow.className = "pizza-widget__sizes";
    const sizeButtons = [];
    sizes.forEach(function (s) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pizza-widget__size";
      b.innerHTML = '<span class="pizza-widget__size-name">' + s.label + '</span><span class="pizza-widget__size-price">' + formatPrice(s.price) + "</span>";
      b.addEventListener("click", function () {
        size = s;
        sizeButtons.forEach(function (el) { el.classList.remove("is-active"); });
        b.classList.add("is-active");
        actionRow.hidden = false;
        quickAddBtn.textContent = "Ajouter telle quelle — " + formatPrice(s.price);
        refresh();
      });
      sizeButtons.push(b);
      sizeRow.appendChild(b);
    });

    // --- Garniture à choisir (calzone) : obligatoire, affichée dès qu'une taille est choisie ---
    let fillerRow = null;
    let fillerHint = null;
    const fillerButtons = [];
    if (choice) {
      fillerRow = document.createElement("div");
      fillerRow.className = "pizza-widget__filler";
      fillerRow.hidden = true;
      const fillerTitle = document.createElement("p");
      fillerTitle.className = "customize__title";
      fillerTitle.textContent = choice.label + " (obligatoire)";
      const fillerChips = document.createElement("div");
      fillerChips.className = "customize__chips";
      choice.options.forEach(function (opt) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pizza-widget__filler-btn";
        b.textContent = capitalizeFirst(opt);
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          filler = opt;
          fillerButtons.forEach(function (el) {
            el.classList.remove("is-active");
            el.setAttribute("aria-pressed", "false");
          });
          b.classList.add("is-active");
          b.setAttribute("aria-pressed", "true");
          refresh();
        });
        fillerButtons.push(b);
        fillerChips.appendChild(b);
      });
      fillerHint = document.createElement("p");
      fillerHint.className = "customize__hint";
      fillerHint.textContent = "Choisissez une garniture pour pouvoir l’ajouter au panier.";
      fillerRow.appendChild(fillerTitle);
      fillerRow.appendChild(fillerChips);
      fillerRow.appendChild(fillerHint);
    }

    // --- Barre d'action, visible une fois une taille choisie ---
    const actionRow = document.createElement("div");
    actionRow.className = "pizza-widget__actions";
    actionRow.hidden = true;

    const quickAddBtn = document.createElement("button");
    quickAddBtn.type = "button";
    quickAddBtn.className = "pizza-widget__quickadd";
    quickAddBtn.textContent = "Ajouter telle quelle";
    quickAddBtn.addEventListener("click", function () {
      if (!size || missingFiller()) return;
      // onAdd (facultatif) : réutilisation de ce widget hors du panier (ex. ajout à une commande déjà
      // envoyée depuis commande.html, voir order_addendum_create.php) — sinon comportement inchangé.
      if (opts.onAdd) {
        opts.onAdd({ name: displayName(), variant: size.label, basePrice: size.price, removed: [], extras: [], half: null, note: "" });
      } else {
        addItem(displayName(), size.label, size.price);
      }
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pizza-widget__toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h6M16 6h4M4 12h2M12 12h8M4 18h10M18 18h2"/><circle cx="12" cy="6" r="2.2"/><circle cx="8" cy="12" r="2.2"/><circle cx="14" cy="18" r="2.2"/></svg>' +
      "<span>Personnaliser</span>";

    actionRow.appendChild(quickAddBtn);
    actionRow.appendChild(toggle);

    const panel = document.createElement("div");
    panel.className = "customize__panel";
    panel.hidden = true;

    toggle.addEventListener("click", function () {
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
      toggle.classList.toggle("is-open", willOpen);
    });

    // Moitié-moitié
    const halfSection = document.createElement("div");
    halfSection.className = "customize__section";
    const halfLabel = document.createElement("label");
    halfLabel.className = "customize__half-toggle";
    const halfCheckbox = document.createElement("input");
    halfCheckbox.type = "checkbox";
    halfLabel.appendChild(halfCheckbox);
    halfLabel.insertAdjacentHTML("beforeend", " " + SubitoIcons.svg("pizza") + SubitoIcons.svg("pizza") + " Moitié-moitié (deux parfums différents)");
    const halfHint = document.createElement("p");
    halfHint.className = "customize__hint";
    halfHint.textContent = "Disponible à partir de la taille Duo.";
    const half1Row = document.createElement("p");
    half1Row.className = "customize__half-row";
    const half2Wrap = document.createElement("label");
    half2Wrap.className = "customize__half-row";
    half2Wrap.textContent = "Deuxième moitié : ";
    const half2Select = document.createElement("select");
    half2Select.innerHTML = '<option value="">— Choisir un parfum —</option>' + pizzaCatalog.map(function (p) {
      return '<option value="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + "</option>";
    }).join("");
    half2Wrap.appendChild(half2Select);
    half2Wrap.hidden = true;
    halfCheckbox.addEventListener("change", function () {
      halfOn = halfCheckbox.checked;
      half2Wrap.hidden = !halfOn;
      half1Row.hidden = !halfOn;
      if (!halfOn) { half2 = ""; half2Select.value = ""; }
      refresh();
    });
    half2Select.addEventListener("change", function () {
      half2 = half2Select.value;
      refresh();
    });
    half1Row.hidden = true;
    halfSection.appendChild(halfLabel);
    halfSection.appendChild(halfHint);
    halfSection.appendChild(half1Row);
    halfSection.appendChild(half2Wrap);

    // Sans ingrédients
    const removeSection = document.createElement("div");
    removeSection.className = "customize__section";
    const removeTitle = document.createElement("p");
    removeTitle.className = "customize__title";
    removeTitle.innerHTML = SubitoIcons.svg("scissors") + " Sans (retirer un ingrédient)";
    removeSection.appendChild(removeTitle);
    const removeChipsHolder = document.createElement("div");
    removeSection.appendChild(removeChipsHolder);

    // Ne reconstruit les puces (et ne réinitialise les cases cochées) que si
    // la liste d'ingrédients a réellement changé (ex. choix de la deuxième
    // moitié) — sinon refresh() (appelé à chaque clic) effacerait la case
    // qu'on vient tout juste de cocher.
    let removeChipsSignature = null;
    function rebuildRemoveChips() {
      let list = ingredients.slice();
      if (halfOn && half2) {
        const other = pizzaCatalog.find(function (p) { return p.name === half2; });
        if (other) {
          other.ingredients.forEach(function (ing) { if (list.indexOf(ing) === -1) list.push(ing); });
        }
      }
      // "Compose ta pizza" (base Marguerita) démarre sans aucun ingrédient
      // listé — rien à retirer. Sans ceci, la section "Sans" s'affichait
      // avec son titre mais aucune puce en dessous, comme un bloc vide
      // cassé plutôt qu'une section qui ne s'applique simplement pas ici.
      removeSection.hidden = list.length === 0;
      const sig = list.slice().sort().join("|");
      if (sig === removeChipsSignature) return;
      removeChipsSignature = sig;
      removed.length = 0;
      removeChipsHolder.innerHTML = "";
      const row = chipRow("Sans", list, removed);
      row.addEventListener("customize:change", refresh);
      removeChipsHolder.appendChild(row);
    }

    // Suppléments
    const extrasSection = document.createElement("div");
    extrasSection.className = "customize__section";
    extrasSection.hidden = true;
    const extrasTitle = document.createElement("p");
    extrasTitle.className = "customize__title";
    extrasTitle.innerHTML = SubitoIcons.svg("plus") + " Suppléments";
    extrasSection.appendChild(extrasTitle);
    const extrasHolder = document.createElement("div");
    extrasSection.appendChild(extrasHolder);

    // Même principe que rebuildRemoveChips() : ne reconstruit que si la
    // taille a changé (le prix des suppléments en dépend) — un clic sur un
    // supplément ne doit pas faire perdre l'état des autres.
    let extrasBuiltForSize; // undefined au départ, distinct de null ("pas de taille")
    function rebuildExtras() {
      const key = size ? size.label : null;
      if (key === extrasBuiltForSize) return;
      extrasBuiltForSize = key;
      extrasHolder.innerHTML = "";
      if (!size) {
        extrasHolder.innerHTML = '<p class="customize__hint">Choisissez une taille pour voir les suppléments et leur prix.</p>';
        return;
      }
      loadSupplementGroups().then(function (groups) {
        if (key !== extrasBuiltForSize) return; // la taille a encore changé entre-temps
        loadedGroups = groups;
        if (!groups.length) {
          extrasHolder.innerHTML = '<p class="customize__hint">Suppléments indisponibles pour le moment.</p>';
          return;
        }
        // Un supplément déjà coché garde le prix de l'ancienne taille si on change de taille :
        // on le recale sur la taille affichée, et on le retire s'il n'a pas de prix pour elle.
        for (let i = extras.length - 1; i >= 0; i--) {
          const owner = groups.find(function (g) { return g.names.indexOf(extras[i].name) !== -1; });
          const newPrice = owner ? owner.pricesBySize[size.label] : undefined;
          if (newPrice === undefined) extras.splice(i, 1);
          else extras[i].price = newPrice;
        }
        refresh();
        extrasHolder.innerHTML = "";
        groups.forEach(function (group) {
          const price = group.pricesBySize[size.label];
          const groupEl = document.createElement("div");
          groupEl.className = "customize__extra-group";
          groupEl.innerHTML = '<p class="customize__extra-group-title">' + escapeHtml(group.title) + (price !== undefined ? " — " + formatPrice(price) + " / ingrédient" : "") + "</p>";
          const list = document.createElement("div");
          list.className = "customize__chips";
          group.names.forEach(function (name) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "customize__chip customize__chip--extra";
            chip.textContent = "+ " + name;
            chip.disabled = price === undefined;
            const isActive = extras.some(function (e) { return e.name === name; });
            chip.classList.toggle("is-active", isActive);
            chip.setAttribute("aria-pressed", isActive ? "true" : "false");
            chip.addEventListener("click", function () {
              const existing = extras.find(function (e) { return e.name === name; });
              if (existing) {
                extras.splice(extras.indexOf(existing), 1);
                chip.classList.remove("is-active");
              } else {
                extras.push({ name: name, price: price, qty: 1, group: group.title });
                chip.classList.add("is-active");
              }
              chip.setAttribute("aria-pressed", chip.classList.contains("is-active") ? "true" : "false");
              refresh();
            });
            list.appendChild(chip);
          });
          groupEl.appendChild(list);
          extrasHolder.appendChild(groupEl);
        });
      });
    }

    // Autre demande
    const noteId = "customizeNote" + (++customizeIdCounter);
    const noteSection = document.createElement("div");
    noteSection.className = "customize__section";
    noteSection.innerHTML = '<label class="customize__title" for="' + noteId + '">' + SubitoIcons.svg("message-square") + ' Autre demande (facultatif)</label>';
    const noteInput = document.createElement("input");
    noteInput.id = noteId;
    noteInput.type = "text";
    noteInput.className = "customize__note";
    noteInput.maxLength = 140;
    noteInput.placeholder = "Ex. sauce à part";
    noteInput.addEventListener("input", refresh);
    const noteHint = document.createElement("p");
    noteHint.className = "customize__hint";
    noteHint.textContent = "Une indication pour le restaurant — non garantie, à confirmer par téléphone.";
    noteSection.appendChild(noteInput);
    noteSection.appendChild(noteHint);

    // Résumé + bouton d'ajout
    const summary = document.createElement("p");
    summary.className = "customize__summary";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-solid customize__add";
    addBtn.textContent = "Ajouter au panier";

    addBtn.addEventListener("click", function () {
      if (!size || missingFiller()) return;
      const line = {
        name: displayName(),
        variant: size.label,
        basePrice: size.price,
        removed: removed.slice(),
        extras: applySwapDiscount(removed, extras, loadedGroups, size.label),
        half: halfOn && half2 ? { flavor1: productName, flavor2: half2 } : null,
        note: noteInput.value.trim()
      };
      if (opts.onAdd) opts.onAdd(line); else addLine(line);
    });

    function refresh() {
      // Pas de catalogue de parfums sur cette page (ex. composer.html, qui ne
      // propose que la base Marguerita) : impossible de proposer une
      // deuxième moitié réelle, donc pas de section plutôt qu'une liste vide.
      if (!allowHalf || !pizzaCatalog.length) {
        halfSection.hidden = true;
      } else {
        // La section reste visible dès qu'une taille est choisie (même
        // Solo) : le client voit alors explicitement pourquoi l'option
        // n'est pas proposée, plutôt qu'une section qui disparaît sans
        // explication.
        const canHalf = !!size && SIZE_ORDER.indexOf(size.label) >= 1; // Duo, Quatro, XXL
        halfSection.hidden = !size;
        halfCheckbox.disabled = !canHalf;
        // La case à cocher seule ne se distinguait pas visuellement d'une
        // case active une fois désactivée (ex. taille Solo) : le client
        // tapait dessus, rien ne se passait, et pensait à un bug plutôt
        // qu'à une option indisponible pour cette taille.
        halfLabel.classList.toggle("is-disabled", !canHalf);
        halfHint.hidden = !size || canHalf;
        if (!canHalf && halfOn) {
          halfOn = false;
          halfCheckbox.checked = false;
          half2 = "";
          half2Select.value = "";
          half2Wrap.hidden = true;
          half1Row.hidden = true;
        }
        half1Row.textContent = halfOn ? "Première moitié : " + productName : "";
      }
      extrasSection.hidden = !size;
      rebuildRemoveChips();
      rebuildExtras();

      const parts = [];
      if (!size) {
        parts.push("Choisissez une taille pour continuer.");
      } else {
        let label = displayName() + " (" + size.label + ")";
        if (halfOn && half2) label = productName + " / " + half2 + " (" + size.label + ")";
        parts.push(label);
        if (missingFiller()) parts.push("Choisissez une garniture pour continuer.");
        if (removed.length) parts.push("Sans : " + removed.join(", "));
        const discountedExtras = applySwapDiscount(removed, extras, loadedGroups, size.label);
        if (discountedExtras.length) {
          parts.push("Suppléments : " + discountedExtras.map(function (e) {
            return e.name + (e.price === 0 ? " (échange offert)" : "");
          }).join(", "));
        }
        if (noteInput.value.trim()) parts.push("Autre demande : " + noteInput.value.trim());
        const unit = size.price + discountedExtras.reduce(function (s, e) { return s + e.price * e.qty; }, 0);
        parts.push("Prix : " + formatPrice(unit));
      }
      summary.textContent = parts.join(" — ");

      const blocked = !size || (halfOn && !half2) || missingFiller();
      addBtn.disabled = blocked;
      addBtn.title = !size ? "Choisissez une taille" : (halfOn && !half2 ? "Choisissez la deuxième moitié" : (missingFiller() ? "Choisissez une garniture" : ""));
      quickAddBtn.disabled = !size || missingFiller();
      if (fillerRow) {
        fillerRow.hidden = !size;
        fillerHint.hidden = !missingFiller();
      }
    }

    panel.appendChild(halfSection);
    panel.appendChild(removeSection);
    panel.appendChild(extrasSection);
    panel.appendChild(noteSection);
    panel.appendChild(summary);
    panel.appendChild(addBtn);

    refresh();

    wrap.appendChild(sizeRow);
    if (fillerRow) wrap.appendChild(fillerRow);
    wrap.appendChild(actionRow);
    wrap.appendChild(panel);
    return wrap;
  }

  // Panneau simple (pâtes, Subitowichs) : pas de taille, pas de suppléments
  // (aucun prix fiable de supplément n'existe pour ces catégories sur le
  // site — on ne l'invente pas), seulement retraits + demande libre.
  function buildSimpleCustomizePanel(productName, basePrice, ingredients) {
    const wrap = document.createElement("div");
    wrap.className = "customize";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pizza-widget__toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h6M16 6h4M4 12h2M12 12h8M4 18h10M18 18h2"/><circle cx="12" cy="6" r="2.2"/><circle cx="8" cy="12" r="2.2"/><circle cx="14" cy="18" r="2.2"/></svg>' +
      "<span>Personnaliser</span>";

    const panel = document.createElement("div");
    panel.className = "customize__panel";
    panel.hidden = true;

    toggle.addEventListener("click", function () {
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
      toggle.classList.toggle("is-open", willOpen);
    });

    const removed = [];
    const removeSection = document.createElement("div");
    removeSection.className = "customize__section";
    removeSection.innerHTML = '<p class="customize__title">' + SubitoIcons.svg("scissors") + ' Sans (retirer un ingrédient)</p>';
    const chips = chipRow("Sans", ingredients, removed);
    chips.addEventListener("customize:change", refresh);
    removeSection.appendChild(chips);

    const noteId2 = "customizeNote" + (++customizeIdCounter);
    const noteSection = document.createElement("div");
    noteSection.className = "customize__section";
    noteSection.innerHTML = '<label class="customize__title" for="' + noteId2 + '">' + SubitoIcons.svg("message-square") + ' Autre demande (facultatif)</label>';
    const noteInput = document.createElement("input");
    noteInput.id = noteId2;
    noteInput.type = "text";
    noteInput.className = "customize__note";
    noteInput.maxLength = 140;
    noteInput.placeholder = "Ex. sauce à part";
    noteInput.addEventListener("input", refresh);
    const noteHint = document.createElement("p");
    noteHint.className = "customize__hint";
    noteHint.textContent = "Une indication pour le restaurant — non garantie, à confirmer par téléphone.";
    noteSection.appendChild(noteInput);
    noteSection.appendChild(noteHint);

    const summary = document.createElement("p");
    summary.className = "customize__summary";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-solid customize__add";
    addBtn.textContent = "Ajouter au panier";
    addBtn.addEventListener("click", function () {
      addLine({ name: productName, variant: "", basePrice: basePrice, removed: removed.slice(), extras: [], half: null, note: noteInput.value.trim() });
    });

    function refresh() {
      const parts = [productName];
      if (removed.length) parts.push("Sans : " + removed.join(", "));
      if (noteInput.value.trim()) parts.push("Autre demande : " + noteInput.value.trim());
      summary.textContent = parts.join(" — ");
    }
    refresh();

    panel.appendChild(removeSection);
    panel.appendChild(noteSection);
    panel.appendChild(summary);
    panel.appendChild(addBtn);

    wrap.appendChild(toggle);
    wrap.appendChild(panel);
    return wrap;
  }

  function buildSimpleAdd(productName, price) {
    const wrap = document.createElement("div");
    wrap.className = "add-to-cart";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-to-cart__btn";
    btn.innerHTML = "Ajouter " + SubitoIcons.svg("shopping-cart");

    const stepper = document.createElement("div");
    stepper.className = "add-to-cart__stepper";
    stepper.hidden = true;
    stepper.innerHTML =
      '<button type="button" class="add-to-cart__dec" aria-label="Diminuer">−</button>' +
      '<span class="add-to-cart__qty">0</span>' +
      '<button type="button" class="add-to-cart__inc" aria-label="Augmenter">+</button>';

    function syncFromCart() {
      const cart = readCart();
      const line = cart.find(function (l) { return l.id === lineId(productName, ""); });
      const qty = line ? line.qty : 0;
      stepper.querySelector(".add-to-cart__qty").textContent = String(qty);
      stepper.hidden = qty === 0;
      btn.hidden = qty > 0;
    }

    btn.addEventListener("click", function () {
      addItem(productName, "", price);
      syncFromCart();
    });
    stepper.querySelector(".add-to-cart__inc").addEventListener("click", function () {
      addItem(productName, "", price);
      syncFromCart();
    });
    stepper.querySelector(".add-to-cart__dec").addEventListener("click", function () {
      const cart = readCart();
      const line = cart.find(function (l) { return l.id === lineId(productName, ""); });
      if (line) setQty(line.id, line.qty - 1);
      syncFromCart();
    });

    wrap.appendChild(btn);
    wrap.appendChild(stepper);
    syncFromCart();
    wrap.addEventListener("cart:sync", syncFromCart);
    return wrap;
  }

  const simpleAddWidgets = [];

  // Catégories couvertes par la personnalisation demandée : pizzas, pâtes et
  // Subitowichs (nos "paninis"). Tex-Mex, salades, desserts et boissons
  // gardent l'ajout simple existant, inchangé — hors périmètre de la demande.
  const CUSTOMIZABLE_CATEGORIES = { pates: true, subitowichs: true };

  function scanMenuItems() {
    const sizeChart = readSizeChart();
    const pizzaCatalog = sizeChart.length ? readPizzaCatalog() : [];

    document.querySelectorAll(".menu-item").forEach(function (item) {
      if (item.querySelector(".add-to-cart")) return; // déjà traité
      const nameEl = item.querySelector(".menu-item__name");
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      const body = item.querySelector(".menu-item__body") || item;
      const parsed = readMenuItemIngredients(item);
      const ingredients = parsed.ingredients;

      const ownPriceEl = item.querySelector(".menu-item__price");
      const category = item.closest(".menu-category");
      const displayName = qualifiedName(name, category, nameEl.getAttribute("data-ticket-name"));

      if (ownPriceEl) {
        const price = parsePrice(ownPriceEl.textContent);
        if (price !== null) {
          const widget = buildSimpleAdd(displayName, price);
          body.appendChild(widget);
          simpleAddWidgets.push(widget);
        }
        return;
      }

      if (category) {
        const price = priceFromCategoryNote(category);
        if (price !== null) {
          const widget = buildSimpleAdd(displayName, price);
          body.appendChild(widget);
          simpleAddWidgets.push(widget);
          if (CUSTOMIZABLE_CATEGORIES[category.id] && ingredients.length) {
            body.appendChild(buildSimpleCustomizePanel(displayName, price, ingredients));
          }
          return;
        }
      }

      if (sizeChart.length) {
        const choice = parsed.choice && parsed.choice.options.length ? parsed.choice : null;
        body.appendChild(buildPizzaWidget(name, ingredients, sizeChart, pizzaCatalog, { allowHalf: !item.hasAttribute("data-no-half"), choice: choice }));
        return;
      }

      log("Prix introuvable pour « " + name + " » : pas de bouton ajouté.");
    });
  }

  // Même lecture que scanMenuItems() ci-dessus, mais SANS jamais toucher au DOM (aucun bouton injecté) :
  // sert à lire le catalogue d'une page récupérée par fetch() + DOMParser (ex. commande.html qui n'a pas
  // la grille du menu dans sa propre page, voir loadMenuCatalog() plus bas, même principe que
  // loadSupplementGroups() pour supplements.html).
  function scanMenuCatalog(root) {
    const sizeChart = readSizeChart(root);
    const pizzaCatalog = sizeChart.length ? readPizzaCatalog(root) : [];
    const items = [];
    root.querySelectorAll(".menu-item").forEach(function (item) {
      const nameEl = item.querySelector(".menu-item__name");
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      const parsed = readMenuItemIngredients(item);
      const ingredients = parsed.ingredients;
      const ownPriceEl = item.querySelector(".menu-item__price");
      const category = item.closest(".menu-category");
      const displayName = qualifiedName(name, category, nameEl.getAttribute("data-ticket-name"));

      if (ownPriceEl) {
        const price = parsePrice(ownPriceEl.textContent);
        if (price !== null) items.push({ kind: "product", name: displayName, price: price, categoryId: category ? category.id : null });
        return;
      }
      if (category) {
        const price = priceFromCategoryNote(category);
        if (price !== null) {
          items.push({
            kind: "product", name: displayName, price: price, categoryId: category.id,
            ingredients: CUSTOMIZABLE_CATEGORIES[category.id] ? ingredients : []
          });
          return;
        }
      }
      if (sizeChart.length) {
        const choice = parsed.choice && parsed.choice.options.length ? parsed.choice : null;
        items.push({ kind: "pizza", name: name, ingredients: ingredients, choice: choice, allowHalf: !item.hasAttribute("data-no-half") });
      }
    });
    return { items: items, sizeChart: sizeChart, pizzaCatalog: pizzaCatalog };
  }

  // Page composer.html : pas de liste de produits, juste la grille des
  // tailles de la base Marguerita — on y accroche le même sélecteur de
  // taille que pour une pizza classique. Pas de liste d'ingrédients
  // structurée pour cette base (texte libre uniquement) : pas de puces
  // "Sans" ici, pour ne rien inventer ; suppléments et moitié-moitié restent
  // proposés (données réelles disponibles).
  function scanComposerBase() {
    const sizeChartEl = document.querySelector(".compose-pizza .size-chart");
    if (!sizeChartEl) return;
    if (sizeChartEl.parentElement.querySelector(".add-to-cart")) return;
    const sizeChart = readSizeChart();
    if (!sizeChart.length) return;
    const widget = buildPizzaWidget("Marguerita (base)", [], sizeChart, []);
    sizeChartEl.insertAdjacentElement("afterend", widget);
  }

  /* ---------- Barre flottante ---------- */

  function ensureBar() {
    if (document.getElementById("cartBar")) return;
    const bar = document.createElement("div");
    bar.id = "cartBar";
    bar.className = "cart-bar";
    bar.hidden = true;
    bar.innerHTML =
      '<button type="button" class="cart-bar__btn" id="cartBarOpen" aria-label="Voir mon panier">' +
        '<span class="cart-bar__icon" aria-hidden="true">' + SubitoIcons.svg("shopping-cart") + '</span>' +
        '<span class="cart-bar__info">' +
          '<span class="cart-bar__label">Mon panier · <span id="cartBarCount">0</span></span>' +
          '<span class="cart-bar__total" id="cartBarTotal">0,00 €</span>' +
        '</span>' +
        '<span class="cart-bar__cta" id="cartBarOrder">Commander</span>' +
      '</button>';
    document.body.appendChild(bar);

    document.getElementById("cartBarOpen").addEventListener("click", openDrawer);
  }

  /* ---------- Panier = récapitulatif (un seul panneau) ----------
     Pas d'étape intermédiaire "panier" puis "commande" : ouvrir le panier
     affiche directement le récapitulatif, modifiable (quantités, suppression)
     et prêt à être transmis (appel, ou « Envoyer à quelqu’un ») — demande explicite du client. */

  // div.innerHTML n'échappe que &/</> (jamais les guillemets, qui n'ont pas
  // besoin de l'être dans du contenu texte) — insuffisant pour une valeur
  // réinjectée dans un attribut HTML comme value="...". On échappe donc les
  // guillemets nous-mêmes en plus, par prudence partout où cette fonction
  // est utilisée.
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Détail de personnalisation d'une ligne, affiché sous son nom dans le
  // panier — reprend le format demandé (Moitié 1/2, Sans, Suppléments,
  // Autre demande), uniquement les lignes concernées sont affichées.
  function lineDetailRows(line) {
    const rows = [];
    if (line.half) {
      rows.push("Moitié 1 : " + line.half.flavor1);
      rows.push("Moitié 2 : " + line.half.flavor2);
    }
    if (line.removed && line.removed.length) {
      rows.push("Sans : " + line.removed.join(", "));
    }
    if (line.extras && line.extras.length) {
      rows.push("Suppléments : " + line.extras.map(function (ex) {
        return ex.name + (ex.qty > 1 ? " ×" + ex.qty : "") + (ex.price === 0 ? " (échange offert)" : "");
      }).join(", "));
    }
    if (line.note && line.note.trim()) {
      rows.push("Autre demande : " + line.note.trim());
    }
    return rows;
  }

  function renderLineDetails(line) {
    const rows = lineDetailRows(line);
    if (!rows.length) return "";
    return '<ul class="cart-line__details">' + rows.map(function (r) { return "<li>" + escapeHtml(r) + "</li>"; }).join("") + "</ul>";
  }

  function ensureDrawer() {
    if (document.getElementById("cartOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "cartOverlay";
    overlay.className = "cart-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cartDrawerTitle" tabindex="-1">' +
        '<div class="cart-drawer__header">' +
          '<h2 id="cartDrawerTitle">' + SubitoIcons.svg("shopping-cart") + ' Mon panier</h2>' +
          '<button type="button" class="cart-drawer__close" id="cartDrawerClose" aria-label="Fermer">✕</button>' +
        '</div>' +
        '<div class="cart-drawer__body" id="cartDrawerBody"></div>' +
        '<div class="cart-drawer__footer" id="cartDrawerFooter"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeDrawer(); });
    document.getElementById("cartDrawerClose").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", onDrawerKeydown, true);
  }

  function renderDrawer() {
    const body = document.getElementById("cartDrawerBody");
    const footer = document.getElementById("cartDrawerFooter");
    if (!body || !footer) return;
    const scrollBefore = body.scrollTop;
    const cart = sortedCart();

    if (!cart.length) {
      body.innerHTML = '<p class="cart-drawer__empty">Votre panier est vide pour le moment — parcourez la carte et ajoutez vos envies ' + SubitoIcons.svg("pizza") + '</p>';
      footer.innerHTML = "";
      return;
    }

    // L'identifiant de ligne (buildLineId) est un JSON complet — il contient
    // des guillemets. Inséré tel quel dans un attribut HTML, même échappé
    // pour &/</>, le premier guillemet referme l'attribut en avance et casse
    // la ligne (certains navigateurs récupèrent silencieusement, pas tous :
    // sur certains mobiles, les boutons +/- et supprimer ne retrouvaient
    // plus la bonne ligne et ne faisaient donc rien). On utilise à la place
    // un simple index de position, sans aucun caractère spécial possible.
    let lastGroup; // undefined au départ : distinct de null (= "sans taille")
    body.innerHTML = cart.map(function (line, index) {
      const group = sizeRank(line.variant) === -1 ? null : line.variant;
      const groupLabel = group !== null && group !== lastGroup ? '<p class="cart-group-label">' + escapeHtml(group) + '</p>' : "";
      lastGroup = group;
      const unit = lineUnitPrice(line);
      const sub = unit * line.qty;
      return (
        groupLabel +
        '<div class="cart-line" data-index="' + index + '">' +
          '<div class="cart-line__info">' +
            '<p class="cart-line__name">' + escapeHtml(line.name) + (line.variant ? ' <span class="cart-line__variant">(' + escapeHtml(line.variant) + ')</span>' : "") + '</p>' +
            renderLineDetails(line) +
            '<p class="cart-line__unit">' + formatPrice(unit) + ' / unité</p>' +
          '</div>' +
          '<div class="cart-line__qty">' +
            '<button type="button" class="cart-line__dec" aria-label="Diminuer la quantité">−</button>' +
            '<span class="cart-line__qty-value">' + line.qty + '</span>' +
            '<button type="button" class="cart-line__inc" aria-label="Augmenter la quantité">+</button>' +
          '</div>' +
          '<p class="cart-line__subtotal">' + formatPrice(sub) + '</p>' +
          '<button type="button" class="cart-line__remove" aria-label="Retirer cet article">' + SubitoIcons.svg("trash-2") + '</button>' +
        '</div>'
      );
    }).join("") + '<div class="cart-drawer__extra" id="cartDrawerExtra"></div>';

    body.querySelectorAll(".cart-line").forEach(function (row) {
      const index = parseInt(row.getAttribute("data-index"), 10);
      const line = cart[index];
      if (!line) return;
      const id = line.id;
      // Depuis que +/- ne reconstruit plus toute la liste (voir
      // patchQtyDisplay), ce gestionnaire reste attaché longtemps : il ne
      // doit jamais se fier à la quantité "figée" au moment du rendu, sinon
      // un deuxième appui recalcule à partir d'un chiffre périmé et reste
      // bloqué. On relit toujours la quantité actuelle avant de l'ajuster.
      row.querySelector(".cart-line__inc").addEventListener("click", function () {
        const current = readCart().find(function (l) { return l.id === id; });
        if (current) setQty(id, current.qty + 1);
      });
      row.querySelector(".cart-line__dec").addEventListener("click", function () {
        const current = readCart().find(function (l) { return l.id === id; });
        if (current) setQty(id, current.qty - 1);
      });
      row.querySelector(".cart-line__remove").addEventListener("click", function () { removeItem(id); });
    });
    body.scrollTop = scrollBefore;

    renderDrawerExtra(cart);
    renderStickyFooter(cart);
  }

  // Sauce piquante déjà choisie (SBT-009) : petit bandeau compact, modifiable à tout moment comme le mode
  // de retrait — jamais de nouveau prompt bloquant une fois le choix fait.
  function hotSauceToggleHtml() {
    return (
      '<div class="hot-sauce-toggle hot-sauce-toggle--compact" role="group" aria-label="Sauce piquante">' +
        '<span class="hot-sauce-toggle__label">' + SubitoIcons.svg("flame", "1em") + " Sauce piquante</span>" +
        '<button type="button" class="hot-sauce-toggle__btn' + (hotSauceChoice === true ? " is-active" : "") + '" data-hot-sauce="oui">Oui</button>' +
        '<button type="button" class="hot-sauce-toggle__btn' + (hotSauceChoice === false ? " is-active" : "") + '" data-hot-sauce="non">Non</button>' +
      "</div>"
    );
  }

  // Bloc secondaire (sous-total, promo, nudge, envoyer, mentions,
  // vider le panier) : affiché À LA SUITE de la liste des pizzas, à
  // l'intérieur de la zone qui défile. Avant, tout ça vivait dans un pied
  // fixe toujours affiché, qui prenait plus de la moitié de l'écran sur
  // téléphone et ne laissait presque plus de place pour voir/gérer les
  // pizzas elles-mêmes. Seuls le total et le bouton d'appel restent fixes
  // en bas (voir renderStickyFooter).
  function renderDrawerExtra(cart) {
    const extra = document.getElementById("cartDrawerExtra");
    if (!extra) return;

    const promo = activePromo(cart);
    const gross = cartGrossTotal(cart);
    const isDelivery = orderMode === "delivery";
    let promoHtml = "";
    if (promo.discount > 0) {
      promoHtml =
        '<div class="cart-drawer__subtotal"><span>Sous-total</span><span>' + formatPrice(gross) + '</span></div>' +
        '<div class="cart-drawer__promo"><span>' + (isDelivery ? SubitoIcons.svg("bike") + " 1 pizza achetée, la 2ème à −50 % (livraison)" : SubitoIcons.svg("gift") + " 1 pizza achetée = 1 offerte (à emporter)") + '</span><span>−' + formatPrice(promo.discount) + '</span></div>';
    }
    const nudgeHtml = promo.hasLeftover
      ? '<p class="cart-drawer__nudge">' + (isDelivery ? SubitoIcons.svg("bike") + " Ajoutez encore 1 pizza : la 2ème sera à −50 % (livraison) !" : SubitoIcons.svg("gift") + " Ajoutez encore 1 pizza : elle sera offerte (1 achetée = 1 offerte, à emporter) !") + '</p>'
      : "";
    const pickupDisclaimer = isDelivery ? "" : '<p class="checkout-disclaimer">' + SubitoIcons.svg("lightbulb") + ' Ce total correspond à une commande à emporter. Pour une livraison, choisissez "Livraison" ci-dessus.</p>';

    const modeToggleHtml =
      '<div class="order-mode-toggle" role="group" aria-label="Mode de retrait">' +
        '<button type="button" class="order-mode-toggle__btn' + (modeChosen && !isDelivery ? " is-active" : "") + '" data-mode="pickup">' + SubitoIcons.svg("shopping-bag") + ' À emporter</button>' +
        '<button type="button" class="order-mode-toggle__btn' + (modeChosen && isDelivery ? " is-active" : "") + '" data-mode="delivery">' + SubitoIcons.svg("bike") + ' Livraison</button>' +
      '</div>';

    if (!modeChosen) {
      // Choix obligatoire avant de voir le reste (horaire, paiement, total) : impossible de se tromper
      // de mode sans s'en rendre compte, et plus simple à comprendre pour le client.
      extra.innerHTML =
        '<p class="checkout-disclaimer checkout-disclaimer--prompt">' + SubitoIcons.svg("circle-alert", "1em") + ' Choisissez d’abord votre mode de commande.</p>' +
        modeToggleHtml;
      extra.querySelectorAll(".order-mode-toggle__btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          orderMode = btn.getAttribute("data-mode");
          modeChosen = true;
          const sorted = sortedCart();
          renderDrawerExtra(sorted);
          renderStickyFooter(sorted);
          renderBarTotal(sorted);
        });
      });
      return;
    }

    if (isDelivery && hotSauceChoice === null) {
      // Choix obligatoire avant de voir le reste (horaire, paiement, total), comme modeChosen ci-dessus —
      // jamais de défaut silencieux sur la sauce piquante.
      extra.innerHTML =
        modeToggleHtml +
        '<p class="checkout-disclaimer checkout-disclaimer--prompt">' + SubitoIcons.svg("flame", "1em") + ' Voulez-vous de la sauce piquante avec votre livraison ?</p>' +
        '<div class="hot-sauce-toggle" role="group" aria-label="Sauce piquante">' +
          '<button type="button" class="hot-sauce-toggle__btn" data-hot-sauce="oui">Oui</button>' +
          '<button type="button" class="hot-sauce-toggle__btn" data-hot-sauce="non">Non</button>' +
        '</div>';
      extra.querySelectorAll(".order-mode-toggle__btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          orderMode = btn.getAttribute("data-mode");
          const sorted = sortedCart();
          renderDrawerExtra(sorted);
          renderStickyFooter(sorted);
          renderBarTotal(sorted);
        });
      });
      extra.querySelectorAll(".hot-sauce-toggle__btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          hotSauceChoice = btn.getAttribute("data-hot-sauce") === "oui";
          renderDrawerExtra(sortedCart());
        });
      });
      return;
    }

    extra.innerHTML =
      modeToggleHtml +
      (isDelivery ? hotSauceToggleHtml() : "") +
      '<div class="schedule-toggle" role="group" aria-label="Horaire de la commande">' +
        '<button type="button" class="schedule-toggle__btn' + (scheduleChoice === "now" ? " is-active" : "") + '" data-when="now">' + SubitoIcons.svg("clock") + ' Dès que possible</button>' +
        '<button type="button" class="schedule-toggle__btn' + (scheduleChoice === "later" ? " is-active" : "") + '" data-when="later">' + SubitoIcons.svg("clock") + ' Plus tard</button>' +
      '</div>' +
      (scheduleChoice === "later" ? scheduleLaterHtml() : "") +
      '<div id="deliveryStatus" role="status"></div>' +
      (isDelivery ? paymentMethodHtml() : "") +
      promoHtml +
      nudgeHtml +
      (typeof navigator.share === "function"
        ? '<div class="checkout-actions"><div class="checkout-actions__row"><button type="button" class="btn-outline" id="checkoutShare">' + SubitoIcons.svg("share-2") + ' Envoyer à quelqu’un</button></div></div>'
        : "") +
      '<p class="checkout-disclaimer">' + SubitoIcons.svg("smile") + ' Le paiement se fait sur place' + (isDelivery ? ", à la livraison" : ", au retrait") + ' — rien à régler en ligne.</p>' +
      pickupDisclaimer +
      '<button type="button" class="cart-drawer__clear" id="cartDrawerClear">Vider le panier</button>';

    extra.querySelectorAll(".order-mode-toggle__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const mode = btn.getAttribute("data-mode");
        if (cartLocked()) { showToast("Commande en cours d’envoi : changez le mode après la réponse."); return; }
        if (mode === orderMode) return;
        orderMode = mode;
        const sorted = sortedCart();
        renderDrawerExtra(sorted);
        renderStickyFooter(sorted);
        renderBarTotal(sorted);
      });
    });

    extra.querySelectorAll(".hot-sauce-toggle__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (cartLocked()) { showToast("Commande en cours d’envoi : changez la sauce piquante après la réponse."); return; }
        const choice = btn.getAttribute("data-hot-sauce") === "oui";
        if (choice === hotSauceChoice) return;
        hotSauceChoice = choice;
        renderDrawerExtra(sortedCart());
      });
    });

    extra.querySelectorAll(".schedule-toggle__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const when = btn.getAttribute("data-when");
        if (cartLocked()) { showToast("Commande en cours d’envoi : changez l’horaire après la réponse."); return; }
        if (when === scheduleChoice) return;
        scheduleChoice = when;
        if (when === "now") {
          scheduledFor = null;
        } else {
          loadScheduleSlots(); // sans effet si déjà chargé ou en cours : un seul appel réseau par visite
        }
        renderDrawerExtra(sortedCart());
      });
    });

    extra.querySelectorAll(".schedule-day").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const date = btn.getAttribute("data-date");
        if (date === scheduleActiveDate) return;
        scheduleActiveDate = date;
        renderDrawerExtra(sortedCart());
      });
    });

    extra.querySelectorAll(".schedule-slot").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const iso = btn.getAttribute("data-iso");
        scheduledFor = scheduledFor === iso ? null : iso; // re-touiller le même créneau le désélectionne
        renderDrawerExtra(sortedCart());
      });
    });

    if (isDelivery) {
      renderDeliveryStatus(cart);
      wirePaymentMethodEvents();
    }

    const shareBtn = document.getElementById("checkoutShare");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        navigator.share({ text: buildSimpleRecapText() }).catch(function () {
          /* annulé par le client ou non disponible sur l'instant : rien à faire, pas une erreur */
        });
      });
    }
    document.getElementById("cartDrawerClear").addEventListener("click", function () {
      if (cartLocked()) { showToast("Commande en cours d’envoi : videz le panier après la réponse."); return; }
      if (window.confirm("Vider tout le panier ?")) clearCart();
    });
  }

  // Affiche, sous la bascule de mode, si la livraison est possible pour ce
  // client : pas connecté → invite à se connecter ; connecté sans adresse
  // → invite à l'ajouter ; adresse hors zone, ou minimum de sa ville pas
  // atteint → message clair ; sinon confirmation. Asynchrone (lit le
  // compte) donc affiché à part, sans bloquer le reste du rendu du tiroir.
  function renderDeliveryStatus(cart) {
    const el = document.getElementById("deliveryStatus");
    if (!el) return;
    if (!window.SubitoAccount) {
      el.innerHTML = '<p class="delivery-status delivery-status--error">Service de commande indisponible pour l’instant.</p>';
      return;
    }
    el.innerHTML = '<p class="delivery-status delivery-status--pending">Vérification de votre adresse…</p>';
    window.SubitoAccount.me().then(function (session) {
      // Le tiroir a pu se refermer, se re-rendre, ou repasser en "à
      // emporter" pendant l'attente : on revérifie avant de toucher au DOM.
      const current = document.getElementById("deliveryStatus");
      if (!current || orderMode !== "delivery") return;
      deliveryCity = session && session.city ? session.city : null;
      refreshTotals();
      if (!session) {
        current.innerHTML = '<p class="delivery-status delivery-status--info">Connectez-vous pour vérifier le minimum de votre ville.</p>';
        return;
      }
      const zone = findDeliveryZone(session.city);
      // Ville + zone valides mais pas de type de logement : arrive pour un compte créé avant
      // l'ajout de ce champ (voir order_create.js, 'housing_type_required') — sans ce test, le
      // panier afficherait "livraison disponible", puis bloquerait la commande sans aucun moyen
      // de corriger autrement qu'en quittant le panier pour Mon compte.
      if (!session.city || !zone || !session.housing_type) {
        current.innerHTML = cartAddressFormHtml(session);
        wireCartAddressForm(cart);
        return;
      }
      const cartNow = sortedCart();
      const productsTotal = activeCartTotal(cartNow);
      if (productsTotal < zone.minimum) {
        current.innerHTML = '<p class="delivery-status delivery-status--warn">' + SubitoIcons.svg("circle-alert", "1em", "subito-icon--warn") + ' Minimum pour ' + escapeHtml(zone.city) + " : " + formatPrice(zone.minimum) + " — il manque " + formatPrice(zone.minimum - productsTotal) + ".</p>";
      } else {
        current.innerHTML =
          '<p class="delivery-status delivery-status--ok">' + SubitoIcons.svg("circle-check", "1em", "subito-icon--ok") + ' Livraison disponible à ' + escapeHtml(zone.city) + " (minimum " + formatPrice(zone.minimum) + ").</p>" +
          (hasPizza(cartNow)
            ? '<p class="delivery-status delivery-status--ok">Pas de frais de livraison : votre commande contient des pizzas.</p>'
            : '<p class="delivery-status delivery-status--fee">' + SubitoIcons.svg("truck") + ' Frais de livraison : ' + formatPrice(zone.fee) + ' (commande sans pizza).</p>');
      }
    }).catch(function () {
      // Panne (réseau, serveur) : on le dit, au lieu de laisser « Vérification… » indéfiniment.
      const current = document.getElementById("deliveryStatus");
      if (current && orderMode === "delivery") {
        current.innerHTML = '<p class="delivery-status delivery-status--error">' + SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + ' Impossible de vérifier votre adresse pour l’instant — réessayez, ou appelez-nous.</p>';
      }
    });
  }

  // Met à jour seulement les montants (pied du tiroir et barre du bas), sans
  // reconstruire le pied : le message de statut ou de commande en cours ne doit
  // pas être effacé par un rafraîchissement déclenché par la vérification du compte.
  function refreshTotals() {
    const cart = sortedCart();
    const strong = document.querySelector("#cartDrawerFooter .cart-drawer__total strong");
    if (strong) strong.textContent = formatPrice(activeGrandTotal(cart));
    renderBarTotal(cart);
  }

  // Repère utilisé pour reprendre l'ajout d'adresse après un aller-retour
  // sur compte.html : au retour, le tiroir se rouvre en mode livraison
  // (mais n'envoie rien automatiquement — contrairement à la connexion,
  // ajouter une adresse mérite que le client revoie son panier avant de
  // valider).
  const PENDING_ADDRESS_KEY = "subito_pending_address_redirect";
  const RESUME_ADDRESS_PARAM = "subito_resume_address";

  // Formulaire d'adresse directement dans le tiroir (demande du 20/11) : plus besoin d'aller sur Mon
  // compte pour une première commande livraison — rempli ici, elle s'enregistre aussitôt sur le compte
  // (updateAddress), donc déjà là pour la commande en cours ET les suivantes.
  function cartAddressFormHtml(session) {
    session = session || {};
    const cityOptions = (window.SUBITO_DELIVERY_ZONES || []).map(function (z) {
      return '<option value="' + escapeHtml(z.city) + '"' + (z.city === session.city ? " selected" : "") + '>' + escapeHtml(z.city) + '</option>';
    }).join("");
    const housingOptions = (window.SUBITO_HOUSING_TYPES || []).map(function (h) {
      return '<option value="' + escapeHtml(h.value) + '"' + (h.value === session.housing_type ? " selected" : "") + '>' + escapeHtml(h.label) + '</option>';
    }).join("");
    // Ville déjà enregistrée et valide : il ne manque que le type de logement (compte créé avant
    // l'ajout de ce champ) — on préremplit le reste et on adapte le message, plutôt que de
    // reproposer une adresse déjà bonne comme si elle n'existait pas.
    const onlyHousingMissing = !!session.city && !!findDeliveryZone(session.city) && !session.housing_type;
    const intro = onlyHousingMissing
      ? 'Précisez le type de logement de votre adresse de livraison pour pouvoir commander.'
      : 'Ajoutez votre adresse pour commander en livraison — elle sera enregistrée sur votre compte.';
    return (
      '<p class="delivery-status delivery-status--warn">' + SubitoIcons.svg("map-pin") + ' ' + intro + '</p>' +
      '<form class="cart-address-form" id="cartAddressForm" novalidate>' +
        '<label class="review-form__field">Numéro et rue' +
          '<input type="text" id="cartAddressStreet" name="street" autocomplete="street-address" placeholder="Ex. 12 rue de la Paix" value="' + escapeHtml(session.street || "") + '">' +
        '</label>' +
        '<label class="review-form__field">Ville' +
          '<select id="cartAddressCity" name="city"><option value="">— Sélectionner —</option>' + cityOptions + '</select>' +
        '</label>' +
        '<label class="review-form__field">Type de logement' +
          '<select id="cartAddressHousingType" name="housing_type"><option value="">— Sélectionner —</option>' + housingOptions + '</select>' +
        '</label>' +
        '<p class="delivery-status delivery-status--info" id="cartAddressAptHint" hidden>Pensez à préciser le numéro d’appartement dans le champ « Numéro et rue » ci-dessus (ex. « 12 rue de la Paix, Appt 4 »).</p>' +
        '<p class="delivery-status delivery-status--error" id="cartAddressError" role="alert" hidden></p>' +
        '<button type="submit" class="btn-outline delivery-status__link" id="cartAddressSubmit">Enregistrer mon adresse</button>' +
      '</form>'
    );
  }

  function wireCartAddressForm(cart) {
    const form = document.getElementById("cartAddressForm");
    if (!form) return;
    const housingSelect = document.getElementById("cartAddressHousingType");
    const aptHint = document.getElementById("cartAddressAptHint");
    if (housingSelect && aptHint) {
      aptHint.hidden = housingSelect.value !== "appartement";
      housingSelect.addEventListener("change", function () {
        aptHint.hidden = housingSelect.value !== "appartement";
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const errEl = document.getElementById("cartAddressError");
      const btn = document.getElementById("cartAddressSubmit");
      const city = document.getElementById("cartAddressCity").value;
      const street = document.getElementById("cartAddressStreet").value.trim();
      const housingType = document.getElementById("cartAddressHousingType").value;
      if (!city) {
        errEl.textContent = "Choisissez votre ville.";
        errEl.hidden = false;
        return;
      }
      if (!housingType) {
        errEl.textContent = "Précisez le type de logement (maison ou appartement).";
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;
      btn.disabled = true;
      window.SubitoAccount.updateAddress({ street: street, city: city, housing_type: housingType }).then(function () {
        if (orderMode === "delivery") renderDeliveryStatus(sortedCart());
      }).catch(function (err) {
        btn.disabled = false;
        const fieldMsg = err && err.code === "validation" && err.fields && (err.fields.city || err.fields.housing_type || err.fields.street);
        errEl.textContent = fieldMsg ? fieldMsg
          : (err && err.code === "network") ? "Connexion impossible — réessayez."
          : "Adresse invalide — vérifiez les champs.";
        errEl.hidden = false;
      });
    });
  }

  // Pied fixe, toujours visible : le total, le bouton "Commander en ligne"
  // (nécessite d'être connecté, voir startOnlineOrder()) et l'appel
  // téléphonique en solution de repli — volontairement minimal pour
  // laisser un maximum de hauteur d'écran à la liste des pizzas au-dessus.
  function renderStickyFooter(cart) {
    const footer = document.getElementById("cartDrawerFooter");
    if (!footer) return;
    if (!cart.length) { footer.innerHTML = ""; return; }

    footer.innerHTML =
      (modeChosen
        ? '<div class="cart-drawer__total"><span>Total ' + (orderMode === "delivery" ? "livraison" : "à emporter") + '</span><strong>' + formatPrice(activeGrandTotal(cart)) + '</strong></div>'
        : '<p class="checkout-disclaimer checkout-disclaimer--prompt">' + SubitoIcons.svg("circle-alert", "1em") + ' Choisissez « À emporter » ou « Livraison » ci-dessus pour voir le total.</p>') +
      '<button type="button" class="btn-solid checkout-order" id="checkoutOrder"' + (modeChosen ? "" : " disabled") + '>' + SubitoIcons.svg("shopping-cart") + ' Commander en ligne</button>' +
      '<p class="checkout-order-status" id="checkoutOrderStatus" role="alert" hidden></p>' +
      '<a class="checkout-call-fallback" id="checkoutCall" href="tel:' + SUBITO_CART_CONFIG.phone + '">ou appelez-nous · ' + SubitoIcons.svg("phone") + ' ' + SUBITO_CART_CONFIG.phoneDisplay + '</a>';

    document.getElementById("checkoutOrder").addEventListener("click", startOnlineOrder);
    document.getElementById("checkoutCall").addEventListener("click", function () {
      showToast("On vous laisse composer le " + SubitoIcons.svg("phone") + " — à tout de suite !", true);
      try { localStorage.setItem(CALL_PENDING_KEY, String(Date.now())); } catch (e) { /* stockage bloqué : pas de relance après l'appel, tant pis */ }
    });
    // Un rendu pendant l'envoi (modification du panier, autre onglet) ne doit ni
    // effacer le message « Envoi de votre commande… » ni réactiver le bouton.
    if (orderBusy) {
      const busyBtn = document.getElementById("checkoutOrder");
      if (busyBtn) busyBtn.disabled = true;
      if (lastOrderStatus) setOrderStatus(lastOrderStatus.message, lastOrderStatus.kind);
    }
  }

  // Repère utilisé pour reprendre l'envoi de la commande après un aller-
  // retour sur compte.html (connexion/inscription) : le client n'a pas à
  // recommencer, sa commande part automatiquement une fois connecté. Le
  // mode (à emporter/livraison) choisi avant le départ est sauvegardé pour
  // ne pas revenir sur "à emporter" par défaut après une connexion.
  const PENDING_ORDER_KEY = "subito_pending_order_redirect";
  const PENDING_ORDER_MODE_KEY = "subito_pending_order_mode";
  const PENDING_PAYMENT_KEY = "subito_pending_payment_methods";
  const PENDING_CASH_KEY = "subito_pending_cash_change";
  const PENDING_HOT_SAUCE_KEY = "subito_pending_hot_sauce";
  const RESUME_PARAM = "subito_resume";
  // Posé par compte.js uniquement au retour légitime d'une connexion : sans lui, un lien ?subito_resume=1 n'envoie rien.
  const RESUME_OK_KEY = "subito_resume_ok";
  // Panier tel qu'il était à la demande de connexion (valeur brute du stockage) : la reprise ne l'envoie que s'il n'a pas changé.
  const PENDING_CART_KEY = "subito_pending_cart";
  // Verrou : une seule commande à la fois (un second appui pendant la vérification du compte ne doit rien envoyer).
  let orderBusy = false;
  // Dernier message affiché sous le bouton (restauré si le pied est reconstruit pendant l'envoi).
  let lastOrderStatus = null;

  // Point d'entrée unique du bouton "Commander en ligne" : vérifie la
  // connexion, puis (en mode livraison) l'adresse et le minimum de la
  // ville, avant d'envoyer. resumeOrderIfNeeded() repasse aussi par ici
  // après une connexion, pour ne jamais dupliquer ces vérifications.
  // Une calzone doit porter sa garniture et ne jamais être en moitié-moitié :
  // une ligne ancienne (panier enregistré avant ce changement) ne doit pas partir.
  function calzoneLineIncomplete(line) {
    return /^Calzone \(soufflée\)/.test(line.name) && (line.name.indexOf(" — ") === -1 || !!line.half);
  }

  // Efface les moyens de paiement et le billet d'une tentative précédente.
  function clearPendingPaymentState() {
    sessionStorage.removeItem(PENDING_PAYMENT_KEY);
    sessionStorage.removeItem(PENDING_CASH_KEY);
    sessionStorage.removeItem(PENDING_HOT_SAUCE_KEY);
  }

  // Vérifications avant envoi : renvoie le message à afficher, ou null si la commande peut partir.
  function orderProblem(session) {
    if (!modeChosen) {
      return SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Choisissez « À emporter » ou « Livraison » avant de commander.";
    }
    if (sortedCart().some(calzoneLineIncomplete)) {
      return SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Une de vos calzones n’a pas de garniture choisie : retirez-la du panier et ajoutez-la de nouveau avec sa garniture.";
    }
    if (scheduleChoice === "later" && !scheduledFor) {
      return SubitoIcons.svg("clock") + " Choisissez un jour et une heure pour votre commande programmée.";
    }
    if (orderMode !== "delivery") return null;
    if (hotSauceChoice === null) {
      return SubitoIcons.svg("flame", "1em") + " Précisez si vous voulez de la sauce piquante.";
    }
    const zone = findDeliveryZone(session.city);
    if (!session.city || !zone) {
      return SubitoIcons.svg("map-pin") + " Ajoutez votre adresse dans Mon compte pour commander en livraison.";
    }
    if (!session.housing_type) {
      return SubitoIcons.svg("map-pin") + " Précisez le type de logement (maison, appartement, immeuble) dans Mon compte.";
    }
    const productsTotal = activeCartTotal(sortedCart());
    if (productsTotal < zone.minimum) {
      return SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Minimum pour " + escapeHtml(zone.city) + " : " + formatPrice(zone.minimum) + " — il manque " + formatPrice(zone.minimum - productsTotal) + ".";
    }
    if (!paymentMethods.length) {
      return SubitoIcons.svg("credit-card") + " Choisissez au moins un moyen de paiement pour la livraison.";
    }
    if (paymentMethods.indexOf("cash") !== -1 && cashChangeFor === null) {
      return SubitoIcons.svg("banknote") + " Précisez avec quel billet vous réglez, pour que le livreur prépare la monnaie.";
    }
    return null;
  }

  // Départ vers compte.html avec de quoi reprendre l'envoi après connexion.
  function redirectToLogin() {
    // Tentative invitée : rien d'une tentative précédente ne doit survivre
    // (sinon une reprise après connexion pourrait envoyer un moyen de paiement non coché).
    clearPendingPaymentState();
    sessionStorage.setItem(PENDING_ORDER_KEY, String(Date.now()));
    sessionStorage.setItem(PENDING_ORDER_MODE_KEY, orderMode);
    // Le panier tel qu'il est au moment de la demande : la reprise après connexion ne l'envoie que s'il n'a pas changé.
    sessionStorage.setItem(PENDING_CART_KEY, localStorage.getItem(SUBITO_CART_CONFIG.storageKey) || "");
    if (orderMode === "delivery" && paymentMethods.length) sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(paymentMethods));
    if (orderMode === "delivery" && paymentMethods.indexOf("cash") !== -1 && cashChangeFor !== null) sessionStorage.setItem(PENDING_CASH_KEY, String(cashChangeFor));
    if (orderMode === "delivery" && hotSauceChoice !== null) sessionStorage.setItem(PENDING_HOT_SAUCE_KEY, hotSauceChoice ? "1" : "0");
    const here = window.location.pathname + window.location.hash;
    window.location.href = "compte.html?retour=" + encodeURIComponent(here);
  }

  function startOnlineOrder() {
    if (orderBusy) return; // un second appui pendant la vérification ne doit jamais envoyer une seconde commande
    if (sendingElsewhere()) { setOrderStatus(SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Une commande est en cours d’envoi dans un autre onglet : patientez quelques secondes.", "error"); return; }
    if (!window.SubitoAccount) { setOrderStatus(SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Service de commande indisponible pour l'instant — merci d'appeler directement.", "error"); return; }
    orderBusy = true;
    setOrderStatus("Vérification de votre compte…", "pending");
    window.SubitoAccount.me().then(function (session) {
      if (!session) {
        redirectToLogin();
        return;
      }
      deliveryCity = session.city || null;
      const problem = orderProblem(session);
      if (problem) {
        orderBusy = false;
        setOrderStatus(problem, "error");
        return;
      }
      submitOrder();
    }).catch(function () {
      orderBusy = false;
      setOrderStatus(SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Impossible de vérifier votre compte pour l’instant — réessayez, ou appelez-nous.", "error");
    });
  }

  function setOrderStatus(message, kind) {
    lastOrderStatus = message ? { message: message, kind: kind } : null;
    const el = document.getElementById("checkoutOrderStatus");
    if (!el) return;
    // Le conteneur porte role="alert" en permanence : le texte est injecté après, pour être annoncé.
    el.hidden = !message;
    el.className = "checkout-order-status" + (kind ? " checkout-order-status--" + kind : "");
    el.innerHTML = message || "";
  }

  // Tentatives d'envoi : une entrée par contenu envoyé (clé d'idempotence + empreinte du contenu), gardées en
  // localStorage pour être partagées entre les onglets. Une entrée est marquée « inconnue » dès le départ de la
  // requête et ne quitte la liste qu'à une réponse définitive : un changement de panier (autre onglet compris)
  // n'efface jamais une entrée inconnue, et un succès ne retire que sa propre clé. Le serveur dédoublonne par
  // client et clé : un même contenu renvoie la même clé. La clé expire après 24 h.
  const ORDER_ATTEMPT_KEY = "subito_order_attempt";
  const ORDER_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
  const ORDER_ATTEMPT_MAX = 5;
  // Une issue inconnue reste connue (et dédoublonnée) bien plus longtemps qu'un envoi réglé.
  const ORDER_UNKNOWN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  // Envoi en vol : repère partagé entre les onglets. Pendant le vol (délai de 10 s), les autres onglets ne
  // modifient pas le panier et n'envoient rien. Le repère expire seul au bout de 15 s.
  const ORDER_FLIGHT_KEY = "subito_order_flight";
  const ORDER_FLIGHT_MS = 15000;

  function setFlight(key) {
    try { localStorage.setItem(ORDER_FLIGHT_KEY, JSON.stringify({ key: key, at: Date.now() })); } catch (e) { /* stockage bloqué : pas de verrou entre onglets */ }
  }

  function clearFlight(key) {
    try {
      const f = JSON.parse(localStorage.getItem(ORDER_FLIGHT_KEY) || "null");
      if (f && f.key === key) localStorage.removeItem(ORDER_FLIGHT_KEY);
    } catch (e) { /* rien à effacer */ }
  }

  // Vrai si un envoi est en vol, dans cet onglet ou dans un autre.
  function sendingElsewhere() {
    try {
      const f = JSON.parse(localStorage.getItem(ORDER_FLIGHT_KEY) || "null");
      return !!(f && Date.now() - Number(f.at) < ORDER_FLIGHT_MS);
    } catch (e) { return false; }
  }

  // Panier figé : un envoi est en cours dans cet onglet ou dans un autre.
  function cartLocked() {
    return orderBusy || sendingElsewhere();
  }

  function attemptStored(key) {
    return readAttempts().some(function (a) { return a.key === key; });
  }

  function saveAttempts(list) {
    try {
      if (list.length) localStorage.setItem(ORDER_ATTEMPT_KEY, JSON.stringify(list));
      else localStorage.removeItem(ORDER_ATTEMPT_KEY);
    } catch (e) { /* stockage bloqué : la protection entre deux essais ne pourra pas tenir */ }
  }

  // Tentatives encore valables. Une valeur enregistrée à l'ancien format (une seule tentative) reste lue.
  function readAttempts() {
    let list = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(ORDER_ATTEMPT_KEY) || "null");
      if (Array.isArray(parsed)) list = parsed;
      else if (parsed && typeof parsed === "object") list = [parsed];
    } catch (e) { list = []; }
    const now = Date.now();
    const alive = list.filter(function (a) {
      if (!a || !a.key) return false;
      return Number(a.at) > now - (a.unknown ? ORDER_UNKNOWN_TTL_MS : ORDER_ATTEMPT_TTL_MS);
    });
    if (alive.length !== list.length) saveAttempts(alive);
    return alive;
  }

  // Panier modifié ou vidé : on retire les tentatives terminées, jamais celles dont l'issue est inconnue.
  function dropSettledAttempts() {
    const list = readAttempts();
    const kept = list.filter(function (a) { return a.unknown; });
    if (kept.length !== list.length) saveAttempts(kept);
  }

  // Retire la tentative d'une seule clé : celle d'un autre envoi reste en place.
  function removeAttempt(key) {
    const list = readAttempts();
    const kept = list.filter(function (a) { return a.key !== key; });
    if (kept.length !== list.length) saveAttempts(kept);
  }

  function setAttemptUnknown(key, unknown) {
    const list = readAttempts();
    list.forEach(function (a) { if (a.key === key) a.unknown = unknown; });
    saveAttempts(list);
  }

  function randomKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }

  function fingerprint(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(16) + ":" + text.length;
  }

  // Clé de l'envoi. Un même contenu reprend toujours sa clé : après une coupure, le serveur renvoie alors la
  // commande déjà créée au lieu d'en créer une seconde. Quand le contenu change alors qu'une issue est
  // inconnue, un seul avertissement (null) couvre les issues inconnues non encore signalées ; le client peut
  // ensuite renvoyer en connaissance de cause. La nouvelle tentative est créée « inconnue » : elle n'est
  // jamais évincée avant sa réponse.
  function idempotencyKeyFor(content) {
    const fp = fingerprint(JSON.stringify(content));
    const list = readAttempts();
    const same = list.filter(function (a) { return a.fp === fp; })[0];
    if (same) return same.key;
    const unwarned = list.filter(function (a) { return a.unknown && !a.warned; });
    if (unwarned.length) {
      unwarned.forEach(function (a) { a.warned = true; });
      saveAttempts(list);
      return null;
    }
    const key = randomKey();
    list.push({ key: key, fp: fp, at: Date.now(), unknown: true, warned: false });
    while (list.length > ORDER_ATTEMPT_MAX) {
      const settled = list.filter(function (a) { return !a.unknown; })[0];
      if (!settled) break;
      list.splice(list.indexOf(settled), 1);
    }
    saveAttempts(list);
    return key;
  }

  function toCents(euros) {
    return Math.round(euros * 100);
  }

  // Montants envoyés au serveur : tout en centimes entiers, mêmes règles que le
  // serveur (contrat §5). L'affichage à l'écran garde ses propres calculs.
  function orderTotalsCents(cart) {
    let gross = 0;
    const pizzaUnits = [];
    cart.forEach(function (line) {
      const unit = toCents(lineUnitPrice(line));
      gross += unit * line.qty;
      if (line.variant) for (let i = 0; i < line.qty; i++) pizzaUnits.push(unit);
    });
    pizzaUnits.sort(function (a, b) { return b - a; });
    let promo = 0;
    for (let i = 0; i + 1 < pizzaUnits.length; i += 2) {
      promo += orderMode === "delivery" ? Math.floor((pizzaUnits[i + 1] + 1) / 2) : pizzaUnits[i + 1];
    }
    const zone = findDeliveryZone(deliveryCity);
    const fee = (orderMode === "delivery" && !hasPizza(cart) && zone) ? toCents(zone.fee) : 0;
    return { delivery_fee_cents: fee, total_cents: gross - promo + fee };
  }

  function orderErrorMessage(err) {
    const data = err.data || {};
    const alertIcon = SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " ";
    switch (err.code) {
      case "minimum_not_reached": {
        const min = Number(data.minimum_cents) / 100;
        const missing = (Number(data.minimum_cents) - Number(data.products_after_promo_cents)) / 100;
        if (isFinite(min) && isFinite(missing) && missing > 0) return alertIcon + "Minimum de commande : " + formatPrice(min) + " — il manque " + formatPrice(missing) + ".";
        return alertIcon + "Le minimum de commande pour votre ville n’est pas atteint.";
      }
      case "price_mismatch": {
        const total = Number(data.server_total_cents);
        return alertIcon + "Le prix a changé : vérifiez votre panier." + (data.server_total_cents != null && isFinite(total) ? " Total calculé par le restaurant : " + formatPrice(total / 100) + "." : "");
      }
      case "unavailable_items": {
        const names = Array.isArray(data.unavailable) ? data.unavailable.map(escapeHtml).join(", ") : "";
        const ingredients = Array.isArray(data.unavailable_ingredients) ? data.unavailable_ingredients.map(escapeHtml).join(", ") : "";
        if (ingredients) return alertIcon + "Plus disponible aujourd’hui : " + (names || "article de votre panier") + ". Ingrédient en rupture : " + ingredients + ". Retirez-le de votre panier ou modifiez-le pour continuer.";
        return alertIcon + (names ? "Plus disponible aujourd’hui : " + names + ". Retirez-le de votre panier ou modifiez-le pour continuer." : "Un article de votre panier n’est plus disponible aujourd’hui.");
      }
      case "unknown_item":
      case "unpriced_item":
        return alertIcon + "« " + escapeHtml(data.name || "Un article") + " » n’est pas commandable en ligne. Retirez-le du panier.";
      case "price_mismatch_line":
        return alertIcon + "Le prix de « " + escapeHtml(data.name || "un article") + " » a changé : rechargez la page avant de commander.";
      case "address_required":
        return SubitoIcons.svg("map-pin") + ' Ajoutez une adresse dans une ville livrée pour commander en livraison : <a href="compte.html">Mon compte</a>.';
      case "housing_type_required":
        return SubitoIcons.svg("map-pin") + ' Précisez le type de logement (maison, appartement, immeuble) : <a href="compte.html">Mon compte</a>.';
      case "profile_incomplete":
        return alertIcon + 'Il manque votre numéro de téléphone pour commander : <a href="compte.html">Mon compte</a>.';
      case "idempotency_conflict":
        return alertIcon + "Un incident est survenu pendant l’envoi. Appuyez de nouveau sur « Commander en ligne » pour renvoyer votre commande.";
      case "closed": {
        const opens = typeof data.opens_at === "string" ? escapeHtml(data.opens_at) : "";
        const closes = typeof data.closes_at === "string" ? escapeHtml(data.closes_at) : "";
        return alertIcon + "Les commandes en ligne sont fermées pour le moment." + (opens && closes ? " Elles sont ouvertes tous les jours de " + opens + " à " + closes + "." : "") + " Votre panier reste enregistré.";
      }
      case "empty_cart":
        return alertIcon + "Votre panier est vide.";
      case "validation":
        return alertIcon + "Votre commande contient une information invalide : vérifiez votre panier, ou appelez-nous.";
      case "too_many_attempts": {
        const minutes = Math.max(1, Math.ceil((Number(data.retry_after_seconds) || 60) / 60));
        return alertIcon + "Trop de tentatives. Réessayez dans " + minutes + " minute" + (minutes > 1 ? "s" : "") + ".";
      }
      case "network":
        return alertIcon + "Connexion interrompue : votre commande n’a peut-être pas été reçue. Vous pouvez réessayer sans risque.";
      default:
        return alertIcon + "L’envoi en ligne n’a pas fonctionné pour l’instant — merci d’appeler directement, juste en dessous.";
    }
  }

  // Construit la commande à partir du panier déjà affiché (mêmes lignes,
  // mêmes prix que ce que le client a vu) et l'envoie à l'API. Les montants
  // partent en centimes ; le serveur les compare à son propre calcul.
  // Le bouton « Commander » peut avoir été reconstruit pendant l'envoi : on le retrouve au moment d'agir,
  // au lieu de garder une référence qui n'est plus dans la page.
  function setCheckoutDisabled(disabled) {
    const current = document.getElementById("checkoutOrder");
    if (current) current.disabled = disabled;
  }

  // Unités du panier qui ne font pas partie de l'envoi : pour chaque ligne, quantité actuelle moins quantité
  // envoyée (par identifiant de ligne). Seules les unités réellement envoyées sont retirées.
  function unsentLines(sent, current) {
    const sentQty = {};
    sent.forEach(function (l) { sentQty[l.id] = (sentQty[l.id] || 0) + l.qty; });
    const rest = [];
    current.forEach(function (l) {
      const left = l.qty - (sentQty[l.id] || 0);
      if (left > 0) rest.push(Object.assign({}, l, { qty: left }));
    });
    return rest;
  }

  // Commande enregistrée : on retire sa seule clé, puis les unités envoyées du panier. Ce qui a été ajouté
  // pendant l'envoi reste dans le panier. Le client est conduit au suivi, où il voit ce qui s'est passé
  // (commande déjà enregistrée, articles restants) : le message ne dépend pas du tiroir.
  function finishOrder(key, sentLines, orderId, replayed) {
    let leftover = [];
    try { removeAttempt(key); } catch (e) { /* stockage bloqué : la commande existe */ }
    try {
      // Aucune intention de commande ne doit survivre à une commande enregistrée.
      clearPendingPaymentState();
      sessionStorage.removeItem(PENDING_ORDER_KEY);
      sessionStorage.removeItem(PENDING_ORDER_MODE_KEY);
      sessionStorage.removeItem(PENDING_CART_KEY);
    } catch (e) { /* stockage bloqué : rien à effacer */ }
    try {
      leftover = unsentLines(sentLines, readCart());
      if (leftover.length) writeCart(leftover);
      else clearCart();
    } catch (e) {
      // Stockage bloqué après l'enregistrement : la commande existe, la suite ne doit pas être bloquée.
      leftover = [];
    }
    clearFlight(key);
    window.location.href = "commande.html?id=" + encodeURIComponent(orderId) + (replayed ? "&deja=1" : "") + (leftover.length ? "&reste=1" : "");
    // Filet de sécurité : si la navigation tarde, le bouton redevient utilisable (le panier est déjà à jour).
    setTimeout(function () { orderBusy = false; setCheckoutDisabled(false); }, 8000);
  }

  function submitOrder() {
    const cart = sortedCart();
    if (!cart.length) { orderBusy = false; setOrderStatus("", ""); return; }

    const totals = orderTotalsCents(cart);
    const content = {
      mode: orderMode,
      payment_methods: orderMode === "delivery" ? paymentMethods.slice() : [],
      cash_change_for: (orderMode === "delivery" && paymentMethods.indexOf("cash") !== -1) ? cashChangeFor : null,
      hot_sauce: orderMode === "delivery" ? hotSauceChoice : null,
      items: cart.map(function (line) {
        return {
          name: line.name,
          variant: line.variant,
          qty: line.qty,
          unit_price_cents: toCents(lineUnitPrice(line)),
          removed: line.removed,
          extras: line.extras.map(function (ex) { return { name: ex.name, price_cents: toCents(ex.price), qty: ex.qty }; }),
          half: line.half,
          note: line.note
        };
      }),
      delivery_fee_cents: totals.delivery_fee_cents,
      total_cents: totals.total_cents,
      scheduled_for: scheduleChoice === "later" ? scheduledFor : null
    };
    const key = idempotencyKeyFor(content);
    if (key === null) {
      orderBusy = false;
      setCheckoutDisabled(false);
      setOrderStatus(SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + ' Votre commande précédente n’est peut-être pas partie : vérifiez <a href="compte.html">Mon compte</a> avant de la renvoyer. Si elle n’y figure pas, appuyez de nouveau sur « Commander en ligne ».', "error");
      return;
    }
    // Sans enregistrement de la tentative, un renvoi ne pourrait pas être dédoublonné : on n'envoie pas.
    if (!attemptStored(key)) {
      orderBusy = false;
      setCheckoutDisabled(false);
      setOrderStatus(SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Commande non envoyée : votre navigateur n’enregistre pas les données qui évitent un doublon. Appelez-nous au 03 21 20 00 33.", "error");
      return;
    }
    // Avant le départ, la tentative est marquée « inconnue » et l'envoi est signalé aux autres onglets : une
    // coupure, ou un changement de panier ailleurs, ne peut plus faire perdre la clé.
    setAttemptUnknown(key, true);
    setFlight(key);
    // Lignes envoyées, telles qu'elles étaient dans le panier au départ (voir finishOrder).
    const sentLines = readCart();
    setCheckoutDisabled(true);
    setOrderStatus("Envoi de votre commande…", "pending");
    const payload = Object.assign({ idempotency_key: key }, content);

    function fail(err) {
      // La requête est terminée : l'envoi n'est plus en vol.
      clearFlight(key);
      if (err.code === "unauthorized") {
        // Refus avant toute création de commande : la tentative est terminée.
        setAttemptUnknown(key, false);
        orderBusy = false;
        setCheckoutDisabled(false);
        redirectToLogin();
        return;
      }
      // Coupure ou panne serveur : l'issue reste inconnue, la clé est gardée même si le panier change.
      if (err.code === "idempotency_conflict") removeAttempt(key);
      else setAttemptUnknown(key, err.code === "network");
      orderBusy = false;
      setCheckoutDisabled(false);
      setOrderStatus(orderErrorMessage(err), "error");
    }

    // Au-delà de 10 s sans réponse : traité comme une coupure (la clé reste, un renvoi est sans risque).
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = setTimeout(function () { if (controller) controller.abort(); }, 10000);

    fetch(SUBITO_CART_CONFIG.apiBase + "order_create.php", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        clearTimeout(timeout);
        if (res.status === 200 || res.status === 201) {
          // Le panier n'est vidé qu'avec une confirmation réelle (commande enregistrée).
          if (!data || !data.order || data.order.id == null) { fail({ code: "network" }); return; }
          finishOrder(key, sentLines, data.order.id, data.replayed === true);
          return;
        }
        const code = res.status >= 500 ? "network" : ((data && data.error) || ("http_" + res.status));
        fail({ code: code, status: res.status, data: data || {} });
      });
    }, function () {
      clearTimeout(timeout);
      fail({ code: "network" });
    });
  }

  // Après connexion/inscription sur compte.html, le client est renvoyé ici
  // avec ?subito_resume=1 : on relance l'envoi automatiquement (en repassant
  // par startOnlineOrder(), pas directement submitOrder(), pour que la
  // vérification livraison/adresse s'applique aussi à ce retour), sans
  // qu'il ait à retoucher à son panier.
  function resumeOrderIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    if (params.get(RESUME_PARAM) !== "1") return;
    params.delete(RESUME_PARAM);
    const clean = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
    window.history.replaceState(null, "", clean);
    // Reprise seulement après le retour légitime de compte.html. Un lien arrivé d'ailleurs ne reprend rien :
    // la commande n'est jamais envoyée toute seule.
    // Le panier au moment de la demande (posé par redirectToLogin) : la reprise ne l'envoie que s'il n'a pas changé.
    const expectedCart = sessionStorage.getItem(PENDING_CART_KEY);
    sessionStorage.removeItem(PENDING_CART_KEY);
    let authorized = false;
    try {
      authorized = sessionStorage.getItem(RESUME_OK_KEY) === "1";
      sessionStorage.removeItem(RESUME_OK_KEY);
    } catch (e) { authorized = false; }
    if (!authorized) {
      sessionStorage.removeItem(PENDING_ORDER_MODE_KEY);
      sessionStorage.removeItem(PENDING_ORDER_KEY);
      clearPendingPaymentState();
      return;
    }
    const savedMode = sessionStorage.getItem(PENDING_ORDER_MODE_KEY);
    if (savedMode) { orderMode = savedMode; modeChosen = true; sessionStorage.removeItem(PENDING_ORDER_MODE_KEY); }
    const savedPayment = sessionStorage.getItem(PENDING_PAYMENT_KEY);
    if (savedPayment !== null) {
      // Liste JSON (voir startOnlineOrder) ; une valeur illisible est simplement ignorée.
      try {
        const list = JSON.parse(savedPayment);
        if (Array.isArray(list)) paymentMethods = PAYMENT_METHODS.map(function (m) { return m.id; }).filter(function (id) { return list.indexOf(id) !== -1; });
      } catch (e) { /* valeur illisible : ignorée */ }
    }
    // Le billet ne se restaure que si les espèces font partie des moyens restaurés.
    const savedCash = sessionStorage.getItem(PENDING_CASH_KEY);
    cashChangeFor = null;
    if (savedCash !== null && paymentMethods.indexOf("cash") !== -1) {
      const note = parseInt(savedCash, 10);
      if (!isNaN(note)) cashChangeFor = note;
    }
    // La sauce piquante ne se restaure qu'en livraison (sans effet et jamais affichée à l'emporter).
    const savedHotSauce = sessionStorage.getItem(PENDING_HOT_SAUCE_KEY);
    hotSauceChoice = (savedHotSauce !== null && orderMode === "delivery") ? savedHotSauce === "1" : null;
    clearPendingPaymentState();
    if (!readCart().length) return;
    openDrawer();
    // Panier modifié depuis la demande (autre onglet, ajout pendant la connexion) : on ne l'envoie pas à la place du client.
    if (expectedCart === null || expectedCart !== (localStorage.getItem(SUBITO_CART_CONFIG.storageKey) || "")) {
      setOrderStatus(SubitoIcons.svg("circle-alert", "1em", "subito-icon--error") + " Votre panier a changé depuis votre demande de commande : vérifiez-le, puis appuyez sur « Commander en ligne ».", "error");
      return;
    }
    startOnlineOrder();
  }

  // Après avoir ajouté son adresse sur compte.html (depuis le bouton
  // "Ajouter mon adresse" du statut livraison), le client est renvoyé ici
  // avec ?subito_resume_address=1 : on rouvre le tiroir en mode livraison
  // pour qu'il voie tout de suite si le minimum est atteint — mais on
  // n'envoie rien tout seul, contrairement à resumeOrderIfNeeded() : ajouter
  // une adresse n'est pas la même décision que simplement se connecter.
  function resumeAddressIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    if (params.get(RESUME_ADDRESS_PARAM) !== "1") return;
    params.delete(RESUME_ADDRESS_PARAM);
    const clean = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
    window.history.replaceState(null, "", clean);
    if (!readCart().length) return;
    orderMode = "delivery";
    modeChosen = true;
    openDrawer();
  }

  // Mise à jour "légère" après un simple changement de quantité (+/-) :
  // on touche uniquement le nombre et le sous-total de LA ligne concernée,
  // jamais la liste entière — plus de flash, le défilement reste en place.
  // Le total/promo peuvent changer (ex: franchir le seuil de la promo), donc
  // le pied fixe et le bloc secondaire sont régénérés, mais ça reste léger :
  // ce ne sont que quelques lignes de texte, pas toute la liste de pizzas.
  function patchQtyDisplay(id) {
    const cart = readCart();
    const bar = document.getElementById("cartBar");
    if (bar) {
      document.getElementById("cartBarCount").textContent = String(cartCount(cart));
      renderBarTotal(cart);
    }

    const overlay = document.getElementById("cartOverlay");
    if (!overlay || overlay.hidden) return;

    const sorted = sortedCart();
    const index = sorted.findIndex(function (l) { return l.id === id; });
    if (index === -1) return;
    const line = sorted[index];
    const row = overlay.querySelector('.cart-line[data-index="' + index + '"]');
    if (row) {
      const unit = lineUnitPrice(line);
      const qtyEl = row.querySelector(".cart-line__qty-value");
      const subEl = row.querySelector(".cart-line__subtotal");
      if (qtyEl) qtyEl.textContent = line.qty;
      if (subEl) subEl.textContent = formatPrice(unit * line.qty);
    }
    renderDrawerExtra(sorted);
    renderStickyFooter(sorted);
  }

  // Posé dans localStorage juste après un appui sur "Appeler pour
  // commander" (horodatage), pour proposer de vider le panier la prochaine
  // fois que le client rouvre son récapitulatif. Un site ne peut pas savoir
  // si l'appel a réellement abouti — on se contente du signal le plus
  // proche possible. Stocké en localStorage (pas une simple variable) et
  // vérifié uniquement au moment où le client rouvre lui-même son panier
  // (un vrai clic) plutôt que sur un événement automatique de retour sur
  // l'onglet : ce deuxième choix, testé en premier, posait problème sur
  // téléphone réel — les navigateurs mobiles n'affichent pas toujours
  // correctement une boîte de dialogue déclenchée hors d'un geste direct du
  // client (pas un vrai clic), contrairement à l'ouverture du panier.
  const CALL_PENDING_KEY = SUBITO_CART_CONFIG.storageKey + "_appel_en_cours";

  function checkCallFollowup() {
    let raw = null;
    try { raw = localStorage.getItem(CALL_PENDING_KEY); } catch (e) { return; }
    if (!raw) return;
    const elapsed = Date.now() - parseInt(raw, 10);
    if (elapsed < 3000) return; // probablement un double-tap, pas un vrai aller-retour : on retentera au prochain coup
    localStorage.removeItem(CALL_PENDING_KEY);
    if (!readCart().length) return;
    if (!orderBusy && window.confirm("Avez-vous passé votre commande au téléphone tout à l’heure ? On vide votre panier pour la prochaine fois.")) {
      clearCart();
    }
  }

  let drawerLastFocused = null;
  function openDrawer() {
    checkCallFollowup();
    ensureDrawer();
    renderDrawer();
    const overlay = document.getElementById("cartOverlay");
    drawerLastFocused = document.activeElement;
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");
    document.documentElement.style.overflow = "hidden";
    overlay.querySelector(".cart-drawer").focus();
  }

  function closeDrawer() {
    const overlay = document.getElementById("cartOverlay");
    if (!overlay) return;
    overlay.classList.remove("is-visible");
    document.documentElement.style.overflow = "";
    setTimeout(function () { overlay.hidden = true; }, 280);
    if (drawerLastFocused && typeof drawerLastFocused.focus === "function") drawerLastFocused.focus();
  }

  function onDrawerKeydown(e) {
    const overlay = document.getElementById("cartOverlay");
    if (e.key === "Escape" && overlay && !overlay.hidden) closeDrawer();
  }

  // Version simplifiée, pensée pour être partagée à quelqu'un d'autre (qui
  // appelle à la place du client) : juste de quoi comprendre la commande en
  // un coup d'oeil — pizza/taille, suppléments, retraits, moitié-moitié, et
  // le total — sans le détail des prix ni la demande libre, demande
  // explicite pour que ça reste rapide à lire pour un tiers.
  function buildSimpleRecapText() {
    const cart = sortedCart();
    const lines = [];
    lines.push("Commande Subito Pizza");
    lines.push("");
    cart.forEach(function (line) {
      const label = line.name + (line.variant ? " (" + line.variant + ")" : "");
      lines.push(line.qty + " × " + label);
      if (line.half) {
        lines.push("   - Moitié 1 : " + line.half.flavor1);
        lines.push("   - Moitié 2 : " + line.half.flavor2);
      }
      if (line.removed && line.removed.length) {
        lines.push("   - Sans : " + line.removed.join(", "));
      }
      if (line.extras && line.extras.length) {
        lines.push("   - Suppléments : " + line.extras.map(function (ex) { return ex.name; }).join(", "));
      }
    });
    lines.push("");
    const simpleFee = deliveryFee(cart);
    if (simpleFee > 0) lines.push("Frais de livraison : " + formatPrice(simpleFee));
    lines.push((orderMode === "delivery" ? "Total livraison : " : "Total : ") + formatPrice(activeGrandTotal(cart)));
    lines.push("");
    lines.push("En cas de besoin : Subito Pizza au " + SUBITO_CART_CONFIG.phoneDisplay + ".");
    return lines.join("\n");
  }

  /* ---------- Rendu global (barre + sync des widgets produits) ---------- */

  function renderAll() {
    const cart = readCart();
    const count = cartCount(cart);

    ensureBar();
    const bar = document.getElementById("cartBar");
    bar.hidden = count === 0;
    document.getElementById("cartBarCount").textContent = String(count);
    renderBarTotal(cart);

    if (document.getElementById("cartOverlay") && !document.getElementById("cartOverlay").hidden) {
      renderDrawer();
    }

    simpleAddWidgets.forEach(function (widget) {
      widget.dispatchEvent(new Event("cart:sync"));
    });
  }

  // Le bandeau « Nouveau : commandez en ligne » n'a de sens que pour un visiteur qui
  // ne sait pas encore qu'on peut commander depuis le site. Un client déjà connecté
  // le sait déjà (code 2026-11-20). Visible par défaut (cas du simple visiteur) : masqué
  // seulement une fois la session confirmée, pas d'attente côté guest.
  function hideCartAnnounceIfLoggedIn() {
    const announce = document.getElementById("cartAnnounce");
    if (!announce || !window.SubitoAccount) return;
    window.SubitoAccount.me().then(function (session) {
      if (session) announce.hidden = true;
    }).catch(function () { /* panne du service de session : on laisse le bandeau visible */ });
  }

  function init() {
    scanMenuItems();
    scanComposerBase();
    ensureBar();
    renderAll();
    if (document.querySelector(".size-chart")) loadSupplementGroups(); // préchargement discret
    resumeOrderIfNeeded();
    resumeAddressIfNeeded();
    hideCartAnnounceIfLoggedIn();
  }

  // Retour arrière depuis la page de connexion : le navigateur peut restaurer la page
  // telle quelle depuis son cache, verrou de commande compris. On le relâche pour que
  // « Commander en ligne » reste utilisable sans rechargement.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) { orderBusy = false; setCheckoutDisabled(false); setOrderStatus("", ""); }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Un autre onglet a modifié le panier : on reste cohérent partout.
  window.addEventListener("storage", function (e) {
    if (e.key === SUBITO_CART_CONFIG.storageKey) renderAll();
  });

  // Réutilisé hors du panier (commande.html : ajouter/modifier une commande déjà envoyée, voir
  // order_addendum_create.php) — jamais par les pages menu.html/composer.html elles-mêmes, qui
  // continuent d'utiliser ces fonctions directement en interne comme avant.
  window.SubitoPizzaWidget = {
    build: buildPizzaWidget,
    loadSupplementGroups: loadSupplementGroups,
    loadMenuCatalog: loadMenuCatalog,
    applySwapDiscount: applySwapDiscount,
    formatPrice: formatPrice,
    parsePrice: parsePrice
  };

})();
