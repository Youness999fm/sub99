/* ============================================================
   Subito Pizza — Panier de commande
   Vanilla JS, aucune dépendance. Chargé sur toutes les pages (même
   pattern que subito-popup.js : un script autonome, une IIFE).

   Important : ceci N'EST PAS une commande en ligne. Le panier sert
   uniquement à préparer un récapitulatif que le client transmet
   lui-même par téléphone (ou en le copiant). Rien n'est envoyé au
   restaurant automatiquement — voir le bandeau dans le récapitulatif.

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

  // Structure d'une ligne : { id, name, variant, unitPrice, qty }
  // `variant` (ex. "Duo") distingue deux lignes du même nom avec des
  // options différentes — voir addItem().
  function readCart() {
    try {
      const raw = localStorage.getItem(SUBITO_CART_CONFIG.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeCart(cart) {
    try {
      localStorage.setItem(SUBITO_CART_CONFIG.storageKey, JSON.stringify(cart));
    } catch (e) {
      log("localStorage indisponible : le panier ne sera pas conservé.");
    }
    renderAll();
  }

  function cartTotal(cart) {
    return cart.reduce(function (sum, line) { return sum + line.unitPrice * line.qty; }, 0);
  }

  function cartCount(cart) {
    return cart.reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function lineId(name, variant) {
    return (name + "|" + (variant || "")).toLowerCase();
  }

  // Deux ajouts avec le même nom ET la même option se regroupent (qty++) ;
  // des options différentes (ex. tailles différentes) restent deux lignes
  // séparées, conformément à la demande.
  function addItem(name, variant, unitPrice) {
    if (!name || typeof unitPrice !== "number" || isNaN(unitPrice)) {
      log("Ajout refusé (prix introuvable) : " + name);
      return;
    }
    const cart = readCart();
    const id = lineId(name, variant);
    const existing = cart.find(function (l) { return l.id === id; });
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id: id, name: name, variant: variant || "", unitPrice: unitPrice, qty: 1 });
    }
    writeCart(cart);
    showToast((variant ? name + " (" + variant + ")" : name) + " ajouté ✓");
    bumpBar();
  }

  function setQty(id, qty) {
    let cart = readCart();
    if (qty <= 0) {
      cart = cart.filter(function (l) { return l.id !== id; });
    } else {
      const line = cart.find(function (l) { return l.id === id; });
      if (line) line.qty = qty;
    }
    writeCart(cart);
  }

  function removeItem(id) {
    const cart = readCart().filter(function (l) { return l.id !== id; });
    writeCart(cart);
  }

  function clearCart() {
    writeCart([]);
  }

  /* ---------- Toast d'ajout ---------- */

  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById("cartToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "cartToast";
      toast.className = "cart-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
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

  function readSizeChart() {
    const items = document.querySelectorAll(".size-chart__item");
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

  function buildSizePicker(productName, sizes) {
    const wrap = document.createElement("div");
    wrap.className = "add-to-cart add-to-cart--sizes";
    sizes.forEach(function (size) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "add-to-cart__size";
      btn.innerHTML = '<span class="add-to-cart__size-name">' + size.label + '</span><span class="add-to-cart__size-price">' + formatPrice(size.price) + "</span>";
      btn.addEventListener("click", function () {
        addItem(productName, size.label, size.price);
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function buildSimpleAdd(productName, price) {
    const wrap = document.createElement("div");
    wrap.className = "add-to-cart";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-to-cart__btn";
    btn.textContent = "Ajouter 🛒";

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

  function scanMenuItems() {
    const sizeChart = readSizeChart();

    document.querySelectorAll(".menu-item").forEach(function (item) {
      if (item.querySelector(".add-to-cart")) return; // déjà traité
      const nameEl = item.querySelector(".menu-item__name");
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      const body = item.querySelector(".menu-item__body") || item;

      const ownPriceEl = item.querySelector(".menu-item__price");
      const category = item.closest(".menu-category");

      if (ownPriceEl) {
        const price = parsePrice(ownPriceEl.textContent);
        if (price !== null) {
          const widget = buildSimpleAdd(name, price);
          body.appendChild(widget);
          simpleAddWidgets.push(widget);
        }
        return;
      }

      if (category) {
        const price = priceFromCategoryNote(category);
        if (price !== null) {
          const widget = buildSimpleAdd(name, price);
          body.appendChild(widget);
          simpleAddWidgets.push(widget);
          return;
        }
      }

      if (sizeChart.length) {
        body.appendChild(buildSizePicker(name, sizeChart));
        return;
      }

      log("Prix introuvable pour « " + name + " » : pas de bouton ajouté.");
    });
  }

  // Page composer.html : pas de liste de produits, juste la grille des
  // tailles de la base Marguerita — on y accroche le même sélecteur de
  // taille que pour une pizza classique.
  function scanComposerBase() {
    const sizeChartEl = document.querySelector(".compose-pizza .size-chart");
    if (!sizeChartEl) return;
    if (sizeChartEl.parentElement.querySelector(".add-to-cart")) return;
    const sizeChart = readSizeChart();
    if (!sizeChart.length) return;
    const widget = buildSizePicker("Marguerita (base)", sizeChart);
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
        '<span class="cart-bar__icon" aria-hidden="true">🛒</span>' +
        '<span class="cart-bar__info">' +
          '<span class="cart-bar__label">Mon panier · <span id="cartBarCount">0</span></span>' +
          '<span class="cart-bar__total" id="cartBarTotal">0,00 €</span>' +
        '</span>' +
        '<span class="cart-bar__cta" id="cartBarOrder">Commander</span>' +
      '</button>';
    document.body.appendChild(bar);

    document.getElementById("cartBarOpen").addEventListener("click", function (e) {
      if (e.target.closest("#cartBarOrder")) {
        openCheckout();
      } else {
        openDrawer();
      }
    });
  }

  /* ---------- Panier détaillé (drawer) ---------- */

  function ensureDrawer() {
    if (document.getElementById("cartOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "cartOverlay";
    overlay.className = "cart-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cartDrawerTitle" tabindex="-1">' +
        '<div class="cart-drawer__header">' +
          '<h2 id="cartDrawerTitle">🛒 Mon panier</h2>' +
          '<button type="button" class="cart-drawer__close" id="cartDrawerClose" aria-label="Fermer le panier">✕</button>' +
        '</div>' +
        '<div class="cart-drawer__body" id="cartDrawerBody"></div>' +
        '<div class="cart-drawer__footer">' +
          '<div class="cart-drawer__total"><span>Total</span><strong id="cartDrawerTotal">0,00 €</strong></div>' +
          '<button type="button" class="btn-solid cart-drawer__checkout" id="cartDrawerCheckout">Commander</button>' +
          '<button type="button" class="cart-drawer__clear" id="cartDrawerClear">Vider le panier</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeDrawer(); });
    document.getElementById("cartDrawerClose").addEventListener("click", closeDrawer);
    document.getElementById("cartDrawerCheckout").addEventListener("click", function () {
      closeDrawer();
      openCheckout();
    });
    document.getElementById("cartDrawerClear").addEventListener("click", function () {
      if (window.confirm("Vider tout le panier ?")) clearCart();
    });
  }

  function renderDrawer() {
    const body = document.getElementById("cartDrawerBody");
    if (!body) return;
    const cart = readCart();

    if (!cart.length) {
      body.innerHTML = '<p class="cart-drawer__empty">Votre panier est vide pour le moment — parcourez la carte et ajoutez vos envies 🍕</p>';
    } else {
      body.innerHTML = cart.map(function (line) {
        const sub = line.unitPrice * line.qty;
        return (
          '<div class="cart-line" data-id="' + line.id + '">' +
            '<div class="cart-line__info">' +
              '<p class="cart-line__name">' + escapeHtml(line.name) + (line.variant ? ' <span class="cart-line__variant">(' + escapeHtml(line.variant) + ')</span>' : "") + '</p>' +
              '<p class="cart-line__unit">' + formatPrice(line.unitPrice) + ' / unité</p>' +
            '</div>' +
            '<div class="cart-line__qty">' +
              '<button type="button" class="cart-line__dec" aria-label="Diminuer la quantité">−</button>' +
              '<span class="cart-line__qty-value">' + line.qty + '</span>' +
              '<button type="button" class="cart-line__inc" aria-label="Augmenter la quantité">+</button>' +
            '</div>' +
            '<p class="cart-line__subtotal">' + formatPrice(sub) + '</p>' +
            '<button type="button" class="cart-line__remove" aria-label="Retirer cet article">🗑</button>' +
          '</div>'
        );
      }).join("");
    }

    document.getElementById("cartDrawerTotal").textContent = formatPrice(cartTotal(cart));

    body.querySelectorAll(".cart-line").forEach(function (row) {
      const id = row.getAttribute("data-id");
      const line = cart.find(function (l) { return l.id === id; });
      if (!line) return;
      row.querySelector(".cart-line__inc").addEventListener("click", function () { setQty(id, line.qty + 1); });
      row.querySelector(".cart-line__dec").addEventListener("click", function () { setQty(id, line.qty - 1); });
      row.querySelector(".cart-line__remove").addEventListener("click", function () { removeItem(id); });
    });
  }

  // Les deux panneaux (panier détaillé / commande) ne doivent jamais être
  // ouverts en même temps — fermeture immédiate et sans animation de
  // l'autre avant d'en ouvrir un, quel que soit le chemin emprunté.
  function hideImmediately(id) {
    const overlay = document.getElementById(id);
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove("is-visible");
    overlay.hidden = true;
  }

  let drawerLastFocused = null;
  function openDrawer() {
    hideImmediately("checkoutOverlay");
    ensureDrawer();
    renderDrawer();
    const overlay = document.getElementById("cartOverlay");
    drawerLastFocused = document.activeElement;
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");
    document.documentElement.style.overflow = "hidden";
    overlay.querySelector(".cart-drawer").focus();
    document.addEventListener("keydown", onDrawerKeydown, true);
  }

  function closeDrawer() {
    const overlay = document.getElementById("cartOverlay");
    if (!overlay) return;
    overlay.classList.remove("is-visible");
    document.documentElement.style.overflow = "";
    document.removeEventListener("keydown", onDrawerKeydown, true);
    setTimeout(function () { overlay.hidden = true; }, 280);
    if (drawerLastFocused && typeof drawerLastFocused.focus === "function") drawerLastFocused.focus();
  }

  function onDrawerKeydown(e) {
    if (e.key === "Escape") closeDrawer();
  }

  /* ---------- Commande (récapitulatif + transmission) ---------- */

  function ensureCheckout() {
    if (document.getElementById("checkoutOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "checkoutOverlay";
    overlay.className = "checkout-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkoutTitle" tabindex="-1">' +
        '<button type="button" class="checkout-modal__close" id="checkoutClose" aria-label="Fermer">✕</button>' +
        '<h2 id="checkoutTitle">🛒 Mon récapitulatif</h2>' +
        '<div class="checkout-recap" id="checkoutRecap" aria-live="polite"></div>' +
        '<div class="checkout-actions">' +
          '<a class="btn-solid checkout-call" id="checkoutCall" href="tel:' + SUBITO_CART_CONFIG.phone + '">📞 Appeler pour commander · ' + SUBITO_CART_CONFIG.phoneDisplay + '</a>' +
          '<button type="button" class="btn-outline" id="checkoutCopy">📋 Copier le récapitulatif</button>' +
        '</div>' +
        '<p class="checkout-disclaimer">😄 Petite précision utile : ce bouton n’envoie rien tout seul, ce n’est pas une commande en ligne. C’est juste votre antisèche pour ne rien oublier au téléphone — à vous de jouer, le resto est au bout du fil !</p>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeCheckout(); });
    document.getElementById("checkoutClose").addEventListener("click", closeCheckout);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeCheckout();
    });

    document.getElementById("checkoutCall").addEventListener("click", function () {
      showToast("On vous laisse composer le 📞 — à tout de suite !");
    });

    document.getElementById("checkoutCopy").addEventListener("click", function () {
      const text = buildRecapText();
      copyToClipboard(text);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function buildRecapText() {
    const cart = readCart();
    const lines = [];
    lines.push("Ma commande — Subito Pizza");
    lines.push("");
    cart.forEach(function (line) {
      const label = line.name + (line.variant ? " (" + line.variant + ")" : "");
      lines.push(line.qty + " × " + label + " — " + formatPrice(line.unitPrice * line.qty));
    });
    lines.push("");
    lines.push("Total : " + formatPrice(cartTotal(cart)));
    return lines.join("\n");
  }

  function updateRecap() {
    const recapEl = document.getElementById("checkoutRecap");
    if (!recapEl) return;
    recapEl.textContent = buildRecapText();
  }

  function copyToClipboard(text) {
    const done = function (ok) {
      showToast(ok ? "Récapitulatif copié ✓" : "Impossible de copier — sélectionnez et copiez manuellement.");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { done(false); });
      return;
    }
    try {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(temp);
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  let checkoutLastFocused = null;
  function openCheckout() {
    if (!readCart().length) {
      showToast("Votre panier est vide — ajoutez d’abord un produit.");
      return;
    }
    hideImmediately("cartOverlay");
    ensureCheckout();
    updateRecap();
    const overlay = document.getElementById("checkoutOverlay");
    checkoutLastFocused = document.activeElement;
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");
    document.documentElement.style.overflow = "hidden";
    overlay.querySelector(".checkout-modal").focus();
  }

  function closeCheckout() {
    const overlay = document.getElementById("checkoutOverlay");
    if (!overlay) return;
    overlay.classList.remove("is-visible");
    document.documentElement.style.overflow = "";
    setTimeout(function () { overlay.hidden = true; }, 280);
    if (checkoutLastFocused && typeof checkoutLastFocused.focus === "function") checkoutLastFocused.focus();
  }

  /* ---------- Rendu global (barre + sync des widgets produits) ---------- */

  function renderAll() {
    const cart = readCart();
    const count = cartCount(cart);

    ensureBar();
    const bar = document.getElementById("cartBar");
    bar.hidden = count === 0;
    document.getElementById("cartBarCount").textContent = String(count);
    document.getElementById("cartBarTotal").textContent = formatPrice(cartTotal(cart));

    if (document.getElementById("cartOverlay") && !document.getElementById("cartOverlay").hidden) {
      renderDrawer();
    }
    if (document.getElementById("checkoutOverlay") && !document.getElementById("checkoutOverlay").hidden) {
      updateRecap();
    }

    simpleAddWidgets.forEach(function (widget) {
      widget.dispatchEvent(new Event("cart:sync"));
    });
  }

  /* ---------- API publique (debug/tests) ---------- */

  window.SubitoCart = {
    add: addItem,
    clear: clearCart,
    get: readCart,
    open: openDrawer,
    checkout: openCheckout
  };

  function init() {
    scanMenuItems();
    scanComposerBase();
    ensureBar();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Un autre onglet a modifié le panier : on reste cohérent partout.
  window.addEventListener("storage", function (e) {
    if (e.key === SUBITO_CART_CONFIG.storageKey) renderAll();
  });
})();
