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
          qty: l.qty || 1,
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

  function writeCart(cart) {
    try {
      localStorage.setItem(SUBITO_CART_CONFIG.storageKey, JSON.stringify(cart));
    } catch (e) {
      log("localStorage indisponible : le panier ne sera pas conservé.");
    }
    renderAll();
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
  // client. Hors périmètre volontaire : la livraison (−50 % 2ᵉ pizza) n'est
  // pas calculée ici, demande explicite de l'utilisateur ("on le travaille
  // après").
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

  function cartTotal(cart) {
    return cartGrossTotal(cart) - pizzaPromo(cart).discount;
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
    writeCart(cart);
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

  function qualifiedName(name, category) {
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

  // Liste des pizzas réellement présentes sur CETTE page (menu.html : tout
  // #pizzas ; vegetarien.html : pas de section #pizzas, mais la page entière
  // est une sélection de pizzas) — jamais une liste écrite en dur, pour que
  // le moitié-moitié ne propose jamais un parfum absent de la page.
  function readPizzaCatalog() {
    const scope = document.getElementById("pizzas") || document.querySelector("main") || document;
    const catalog = [];
    scope.querySelectorAll(".menu-item").forEach(function (item) {
      const nameEl = item.querySelector(".menu-item__name");
      const ownPrice = item.querySelector(".menu-item__price");
      if (!nameEl || ownPrice) return; // un prix propre = pas une pizza (taille)
      const ingredientsEl = item.querySelector(".menu-item__ingredients");
      catalog.push({ name: nameEl.textContent.trim(), ingredients: parseIngredients(ingredientsEl ? ingredientsEl.textContent : "") });
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

  /* ---------- Personnalisation (panneau dépliable sous le produit) ----------
     Toujours repliée par défaut, jamais dans le panier : le client choisit
     ses options directement sous la pizza/le plat, puis l'ajoute depuis ce
     panneau. Le panier, lui, ne fait qu'afficher le résultat (c'est un
     pense-bête, pas une étape de configuration). */

  let customizeIdCounter = 0; // identifiants uniques pour associer <label for>

  // Règle d'échange : retirer un ingrédient d'un groupe (légumes/sauces, ou
  // viandes/poissons/fromages — les deux groupes de supplements.html, chacun
  // à prix unique au sein du groupe) "paie" l'ajout d'un supplément du même
  // groupe, qui devient alors gratuit — une viande contre une viande ou un
  // fromage, un légume contre un légume, jamais entre les deux groupes.
  // Chaque retrait ne couvre qu'un seul ajout, jamais plus.
  function normalizeIngredientName(name) {
    return (name || "").toLowerCase().replace(/\*$/, "").trim();
  }

  function applySwapDiscount(removedList, extrasList, groups) {
    const plain = function (list) { return list.map(function (ex) { return { name: ex.name, price: ex.price, qty: ex.qty }; }); };
    if (!groups || !groups.length) return plain(extrasList);
    const groupOf = {};
    groups.forEach(function (g, gi) {
      g.names.forEach(function (n) { groupOf[normalizeIngredientName(n)] = gi; });
    });
    const credits = groups.map(function () { return 0; });
    (removedList || []).forEach(function (ing) {
      const gi = groupOf[normalizeIngredientName(ing)];
      if (gi !== undefined) credits[gi]++;
    });
    return extrasList.map(function (ex) {
      const gi = groupOf[normalizeIngredientName(ex.name)];
      if (gi !== undefined && credits[gi] > 0) {
        credits[gi]--;
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
  function buildPizzaWidget(productName, ingredients, sizes, pizzaCatalog) {
    const wrap = document.createElement("div");
    wrap.className = "pizza-widget";

    // --- État partagé par tout le widget ---
    let size = null; // {label, price}
    let halfOn = false;
    let half2 = "";
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

    // --- Barre d'action, visible une fois une taille choisie ---
    const actionRow = document.createElement("div");
    actionRow.className = "pizza-widget__actions";
    actionRow.hidden = true;

    const quickAddBtn = document.createElement("button");
    quickAddBtn.type = "button";
    quickAddBtn.className = "pizza-widget__quickadd";
    quickAddBtn.textContent = "Ajouter telle quelle";
    quickAddBtn.addEventListener("click", function () {
      if (!size) return;
      addItem(productName, size.label, size.price);
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
    halfLabel.appendChild(document.createTextNode(" 🍕🍕 Moitié-moitié (deux parfums différents)"));
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
    removeTitle.textContent = "✂️ Sans (retirer un ingrédient)";
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
    extrasTitle.textContent = "➕ Suppléments";
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
    noteSection.innerHTML = '<label class="customize__title" for="' + noteId + '">💬 Autre demande (facultatif)</label>';
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
      addLine({
        name: productName,
        variant: size.label,
        basePrice: size.price,
        removed: removed.slice(),
        extras: applySwapDiscount(removed, extras, loadedGroups),
        half: halfOn && half2 ? { flavor1: productName, flavor2: half2 } : null,
        note: noteInput.value.trim()
      });
    });

    function refresh() {
      // Pas de catalogue de parfums sur cette page (ex. composer.html, qui ne
      // propose que la base Marguerita) : impossible de proposer une
      // deuxième moitié réelle, donc pas de section plutôt qu'une liste vide.
      if (!pizzaCatalog.length) {
        halfSection.hidden = true;
      } else {
        // La section reste visible dès qu'une taille est choisie (même
        // Solo) : le client voit alors explicitement pourquoi l'option
        // n'est pas proposée, plutôt qu'une section qui disparaît sans
        // explication.
        const canHalf = !!size && SIZE_ORDER.indexOf(size.label) >= 1; // Duo, Quatro, XXL
        halfSection.hidden = !size;
        halfCheckbox.disabled = !canHalf;
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
        let label = productName + " (" + size.label + ")";
        if (halfOn && half2) label = productName + " / " + half2 + " (" + size.label + ")";
        parts.push(label);
        if (removed.length) parts.push("Sans : " + removed.join(", "));
        const discountedExtras = applySwapDiscount(removed, extras, loadedGroups);
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

      const blocked = !size || (halfOn && !half2);
      addBtn.disabled = blocked;
      addBtn.title = !size ? "Choisissez une taille" : (halfOn && !half2 ? "Choisissez la deuxième moitié" : "");
    }

    panel.appendChild(halfSection);
    panel.appendChild(removeSection);
    panel.appendChild(extrasSection);
    panel.appendChild(noteSection);
    panel.appendChild(summary);
    panel.appendChild(addBtn);

    refresh();

    wrap.appendChild(sizeRow);
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
    removeSection.innerHTML = '<p class="customize__title">✂️ Sans (retirer un ingrédient)</p>';
    const chips = chipRow("Sans", ingredients, removed);
    chips.addEventListener("customize:change", refresh);
    removeSection.appendChild(chips);

    const noteSection = document.createElement("div");
    noteSection.className = "customize__section";
    noteSection.innerHTML = '<p class="customize__title">💬 Autre demande (facultatif)</p>';
    const noteInput = document.createElement("input");
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
      const ingredientsEl = item.querySelector(".menu-item__ingredients");
      const ingredients = parseIngredients(ingredientsEl ? ingredientsEl.textContent : "");

      const ownPriceEl = item.querySelector(".menu-item__price");
      const category = item.closest(".menu-category");
      const displayName = qualifiedName(name, category);

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
        body.appendChild(buildPizzaWidget(name, ingredients, sizeChart, pizzaCatalog));
        return;
      }

      log("Prix introuvable pour « " + name + " » : pas de bouton ajouté.");
    });
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
        '<span class="cart-bar__icon" aria-hidden="true">🛒</span>' +
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
     et prêt à transmettre (appel / copie) — demande explicite du client. */

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
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
          '<h2 id="cartDrawerTitle">🛒 Mon récapitulatif</h2>' +
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
    const cart = sortedCart();

    if (!cart.length) {
      body.innerHTML = '<p class="cart-drawer__empty">Votre panier est vide pour le moment — parcourez la carte et ajoutez vos envies 🍕</p>';
      footer.innerHTML = "";
      return;
    }

    let lastGroup; // undefined au départ : distinct de null (= "sans taille")
    body.innerHTML = cart.map(function (line) {
      const group = sizeRank(line.variant) === -1 ? null : line.variant;
      const groupLabel = group !== null && group !== lastGroup ? '<p class="cart-group-label">' + escapeHtml(group) + '</p>' : "";
      lastGroup = group;
      const unit = lineUnitPrice(line);
      const sub = unit * line.qty;
      return (
        groupLabel +
        '<div class="cart-line" data-id="' + escapeHtml(line.id) + '">' +
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
          '<button type="button" class="cart-line__remove" aria-label="Retirer cet article">🗑</button>' +
        '</div>'
      );
    }).join("");

    body.querySelectorAll(".cart-line").forEach(function (row) {
      const id = row.getAttribute("data-id");
      const line = cart.find(function (l) { return l.id === id; });
      if (!line) return;
      row.querySelector(".cart-line__inc").addEventListener("click", function () { setQty(id, line.qty + 1); });
      row.querySelector(".cart-line__dec").addEventListener("click", function () { setQty(id, line.qty - 1); });
      row.querySelector(".cart-line__remove").addEventListener("click", function () { removeItem(id); });
    });

    const promo = pizzaPromo(cart);
    const gross = cartGrossTotal(cart);
    let promoHtml = "";
    if (promo.discount > 0) {
      promoHtml =
        '<div class="cart-drawer__subtotal"><span>Sous-total</span><span>' + formatPrice(gross) + '</span></div>' +
        '<div class="cart-drawer__promo"><span>🎁 1 pizza achetée = 1 offerte (à emporter)</span><span>−' + formatPrice(promo.discount) + '</span></div>';
    }
    const nudgeHtml = promo.hasLeftover
      ? '<p class="cart-drawer__nudge">🎁 Ajoutez encore 1 pizza : elle sera offerte (1 achetée = 1 offerte, à emporter) !</p>'
      : "";

    footer.innerHTML =
      promoHtml +
      '<div class="cart-drawer__total"><span>Total à emporter</span><strong>' + formatPrice(cartTotal(cart)) + '</strong></div>' +
      nudgeHtml +
      '<div class="checkout-actions">' +
        '<a class="btn-solid checkout-call" id="checkoutCall" href="tel:' + SUBITO_CART_CONFIG.phone + '">📞 Appeler pour commander · ' + SUBITO_CART_CONFIG.phoneDisplay + '</a>' +
        '<button type="button" class="btn-outline" id="checkoutCopy">📋 Copier le récapitulatif</button>' +
      '</div>' +
      '<p class="checkout-disclaimer">😄 Petite précision utile : ce bouton n’envoie rien tout seul, ce n’est pas une commande en ligne. C’est juste votre antisèche pour ne rien oublier au téléphone — à vous de jouer, le resto est au bout du fil !</p>' +
      '<p class="checkout-disclaimer">💡 Ce total correspond à une commande à emporter. Pour une livraison, appelez-nous directement : le tarif est différent.</p>' +
      '<button type="button" class="cart-drawer__clear" id="cartDrawerClear">Vider le panier</button>';

    document.getElementById("checkoutCall").addEventListener("click", function () {
      showToast("On vous laisse composer le 📞 — à tout de suite !");
    });
    document.getElementById("checkoutCopy").addEventListener("click", function () {
      copyToClipboard(buildRecapText());
    });
    document.getElementById("cartDrawerClear").addEventListener("click", function () {
      if (window.confirm("Vider tout le panier ?")) clearCart();
    });
  }

  let drawerLastFocused = null;
  function openDrawer() {
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

  /* ---------- Récapitulatif texte (pour la copie presse-papiers) ----------
     Même tri par taille que l'affichage, pour que le texte copié corresponde
     exactement à ce que le client voit à l'écran. */

  function buildRecapText() {
    const cart = sortedCart();
    const lines = [];
    lines.push("Ma commande — Subito Pizza");
    lines.push("");
    cart.forEach(function (line) {
      const label = line.name + (line.variant ? " (" + line.variant + ")" : "");
      lines.push(line.qty + " × " + label + " — " + formatPrice(lineUnitPrice(line) * line.qty));
      lineDetailRows(line).forEach(function (row) { lines.push("   - " + row); });
    });
    const promo = pizzaPromo(cart);
    lines.push("");
    if (promo.discount > 0) {
      lines.push("Sous-total : " + formatPrice(cartGrossTotal(cart)));
      lines.push("🎁 1 pizza achetée = 1 offerte (à emporter) : −" + formatPrice(promo.discount));
    }
    lines.push("Total à emporter : " + formatPrice(cartTotal(cart)));
    if (promo.hasLeftover) {
      lines.push("");
      lines.push("🎁 Ajoutez encore 1 pizza : elle sera offerte !");
    }
    lines.push("");
    lines.push("(Pour une livraison, appelez directement : tarif différent.)");
    return lines.join("\n");
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
    checkout: openDrawer
  };

  function init() {
    scanMenuItems();
    scanComposerBase();
    ensureBar();
    renderAll();
    if (document.querySelector(".size-chart")) loadSupplementGroups(); // préchargement discret
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
