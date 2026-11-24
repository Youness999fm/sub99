/* ============================================================
   Subito Pizza — page "Mon compte" (compte.html)
   Utilise window.SubitoAccount (assets/js/account.js) pour parler
   à l'API. Si le client arrive ici parce qu'il voulait commander
   (bouton "Commander en ligne" du panier, voir cart.js), l'URL
   porte ?retour=<page> : une fois connecté, on le renvoie vers
   cette page avec ?subito_resume=1 pour que sa commande parte
   automatiquement — voir resumeOrderIfNeeded() dans cart.js.

   ?compte=creer (audit du 24/11/2026) : état d'URL explicite pour que les CTA
   "Créer mon compte" (accueil, pop-up, bandeau du menu) ouvrent directement
   l'onglet d'inscription, sans que le client doive encore cliquer "Créer un
   compte" après avoir atterri sur "Se connecter" par défaut. Simple lecture
   au chargement (survit à l'actualisation et au retour arrière, car c'est
   l'URL elle-même qui porte l'état) — jamais posé sur le lien générique "Mon
   compte" de la navigation, qui doit continuer à ouvrir "Se connecter".
   Un visiteur déjà connecté qui arrive avec ce paramètre n'a rien à créer :
   il est renvoyé vers le menu plutôt que de voir l'écran "Bonjour, ...".
   ============================================================ */

(function () {
  "use strict";

  function qs(id) { return document.getElementById(id); }

  function wantsSignupTab() {
    return new URLSearchParams(window.location.search).get("compte") === "creer";
  }

  function showTab(which) {
    const isLogin = which === "login";
    qs("tabLogin").classList.toggle("is-active", isLogin);
    qs("tabLogin").setAttribute("aria-selected", String(isLogin));
    qs("tabSignup").classList.toggle("is-active", !isLogin);
    qs("tabSignup").setAttribute("aria-selected", String(!isLogin));
    qs("loginForm").hidden = !isLogin;
    qs("signupForm").hidden = isLogin;
  }

  const FIELD_LABELS = { first_name: "prénom", last_name: "nom", email: "e-mail", phone: "téléphone", password: "mot de passe", street: "rue", city: "ville" };

  function waitMessage(err) {
    const minutes = Math.max(1, Math.ceil((err.retryAfter || 60) / 60));
    return "Trop de tentatives. Réessayez dans " + minutes + " minute" + (minutes > 1 ? "s" : "") + ".";
  }

  // Message du premier champ refusé par le serveur (ou un texte neutre s'il n'en dit rien).
  function validationMessage(err, fallback) {
    const fields = err.fields || {};
    const keys = Object.keys(fields);
    if (!keys.length) return fallback;
    const key = keys[0];
    const label = FIELD_LABELS[key] ? FIELD_LABELS[key].charAt(0).toUpperCase() + FIELD_LABELS[key].slice(1) : key;
    return label + " : " + fields[key];
  }

  const NETWORK_MESSAGE = "Connexion impossible pour l’instant — vérifiez votre réseau et réessayez dans un instant.";

  function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
    // Déplace le focus clavier sur le message (en plus du role="alert" déjà lu par les
    // lecteurs d'écran à l'affichage) : un utilisateur au clavier/zoom voit tout de suite
    // où regarder au lieu de devoir chercher le message dans le formulaire.
    el.focus();
  }

  function hideError(el) {
    el.hidden = true;
    el.textContent = "";
  }

  // Échappe une valeur avant de l'insérer dans du HTML (guillemets compris).
  function escText(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // La valeur « retour » vient de l'URL : on ne suit que les pages du même site.
  // Tout le reste (autre domaine, javascript:, //…) renvoie null.
  function safeReturnUrl(value) {
    if (!value || typeof value !== "string") return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.indexOf("//") === 0 || value.indexOf("\\") !== -1) return null;
    try {
      const url = new URL(value, window.location.origin + "/");
      if (url.origin !== window.location.origin) return null;
      // Un chemin qui commence par // (ex. /.//hote) devient une adresse d'un autre site à la redirection.
      if (url.pathname.indexOf("//") === 0) return null;
      return url.pathname + url.search + url.hash;
    } catch (e) {
      return null;
    }
  }

  // Ajoute un paramètre à une URL de retour sans jamais le placer après l'ancre
  // (#desserts) : après un # le navigateur ne le lit plus, et la reprise ne se fait pas.
  function withQuery(url, param) {
    const hashAt = url.indexOf("#");
    const base = hashAt === -1 ? url : url.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : url.slice(hashAt);
    return base + (base.indexOf("?") === -1 ? "?" : "&") + param + hash;
  }

  function redirectAfterAuth() {
    const params = new URLSearchParams(window.location.search);
    const retour = safeReturnUrl(params.get("retour"));
    // Retour vers la page de suivi (session expirée) : rien à reprendre, simple retour.
    if (retour && /^\/commande\.html(?:[?#]|$)/.test(retour)) {
      window.location.href = retour;
      return true;
    }
    // Intention de commande : horodatée au départ vers la connexion, valable 30 minutes seulement.
    const pendingRaw = sessionStorage.getItem("subito_pending_order_redirect");
    const pending = pendingRaw && Number(pendingRaw) > Date.now() - 30 * 60 * 1000 ? pendingRaw : null;
    if (pendingRaw && !pending) sessionStorage.removeItem("subito_pending_order_redirect");
    if (retour && pending) {
      sessionStorage.removeItem("subito_pending_order_redirect");
      // Seul ce retour légitime autorise la reprise automatique de la commande (voir resumeOrderIfNeeded dans cart.js).
      try { sessionStorage.setItem("subito_resume_ok", "1"); } catch (e) { /* stockage bloqué : la commande ne repart pas toute seule */ }
      window.location.href = withQuery(retour, "subito_resume=1");
      return true;
    }
    return false;
  }

  // Même principe que redirectAfterAuth(), mais pour le retour après avoir
  // renseigné son adresse (bouton "Ajouter mon adresse" du panier, voir
  // goAddAddress() dans cart.js) : clé et paramètre distincts, pour ne pas
  // déclencher un envoi automatique de commande (voir resumeAddressIfNeeded()
  // dans cart.js — contrairement à la connexion, ajouter une adresse ne doit
  // pas déclencher d'envoi tout seul).
  function redirectAfterAddress() {
    const params = new URLSearchParams(window.location.search);
    const retour = safeReturnUrl(params.get("retour"));
    const pending = sessionStorage.getItem("subito_pending_address_redirect");
    if (retour && pending) {
      sessionStorage.removeItem("subito_pending_address_redirect");
      window.location.href = withQuery(retour, "subito_resume_address=1");
      return true;
    }
    return false;
  }

  // Les villes et types de logement proposés viennent de window.SUBITO_DELIVERY_ZONES /
  // SUBITO_HOUSING_TYPES (définis dans cart.js, chargé avant ce fichier) : une seule liste
  // de chaque dans tout le site, jamais dupliquée ici.
  function populateCitySelects() {
    const zones = window.SUBITO_DELIVERY_ZONES || [];
    [qs("signupCity"), qs("addressCity")].forEach(function (select) {
      if (!select) return;
      select.innerHTML = '<option value="">— Sélectionner —</option>' + zones.map(function (z) {
        return '<option value="' + escText(z.city) + '">' + escText(z.city) + '</option>';
      }).join("");
    });
    const housingTypes = window.SUBITO_HOUSING_TYPES || [];
    [qs("signupHousingType"), qs("addressHousingType")].forEach(function (select) {
      if (!select) return;
      select.innerHTML = '<option value="">— Sélectionner —</option>' + housingTypes.map(function (h) {
        return '<option value="' + escText(h.value) + '">' + escText(h.label) + '</option>';
      }).join("");
    });
  }

  // « 12 rue de la Paix — Hénin-Beaumont (Maison) » pour le résumé replié ; rien si pas d'adresse.
  function addressSummary(session) {
    if (!session.city) return "";
    const housingLabel = (window.SUBITO_HOUSING_TYPES || []).find(function (h) { return h.value === session.housing_type; });
    const bits = [session.street, session.city].filter(Boolean).join(" — ");
    return bits + (housingLabel ? " (" + housingLabel.label + ")" : "");
  }

  // Pas de numéro de commande ici (le restaurant identifie par nom, pas par
  // numéro — voir commande.html) : sur sa propre liste, la date/heure de la
  // commande est plus utile au client que de répéter son propre nom.
  function formatOrderDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const day = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return day + " · " + time;
  }

  function formatCents(cents) {
    return (cents / 100).toFixed(2).replace(".", ",") + " €";
  }

  const STATUS_LABEL = { new: "En attente", accepted: "Acceptée", ready: "Prête", refused: "Refusée", cancelled: "Annulée" };
  // En cours : le client peut encore avoir besoin de suivre ou d'agir sur la commande (new/accepted), ou
  // une demande d'annulation est en attente de décision du restaurant. Précédentes : plus rien à suivre
  // (prête, refusée, ou annulation déjà tranchée) — l'historique, pas l'actualité.
  // Au-delà de 10h après created_at (décision du 24/11/2026), une commande ne compte plus comme « en
  // cours » même si son statut n'a pas bougé (ex. jamais décidée) : elle rejoint les précédentes, pour que
  // la liste "en cours" reste fiable au jour le jour plutôt que d'accumuler du très ancien. nowMs vient de
  // server_now (customer_orders.php) quand disponible, jamais l'horloge de l'appareil — potentiellement décalée.
  const ONGOING_MAX_MS = 10 * 60 * 60 * 1000;
  function isOngoing(o, nowMs) {
    const statusOngoing = o.status === "new" || o.status === "accepted" || !!o.cancel_requested_at;
    if (!statusOngoing) return false;
    const createdMs = new Date(o.created_at).getTime();
    if (isNaN(createdMs)) return true;
    return nowMs - createdMs < ONGOING_MAX_MS;
  }

  function orderCardHtml(o) {
    // Statut limité à une liste connue : il sert aussi de nom de classe CSS.
    // Lien vers la page de suivi (commande.html) : en attente, acceptée ou
    // terminée ; rien à suivre pour une commande refusée ou annulée.
    const status = Object.prototype.hasOwnProperty.call(STATUS_LABEL, o.status) ? o.status : "new";
    const id = Number(o.id);
    const tag = isFinite(id) && id > 0 && status !== "refused" && status !== "cancelled" ? "a" : "div";
    const href = tag === "a" ? ' href="commande.html?id=' + encodeURIComponent(id) + '"' : "";
    const total = Number(o.total_cents);
    const delay = Number(o.delay_minutes);
    const cancelPending = !!o.cancel_requested_at && (o.status === "new" || o.status === "accepted");
    const statusText = cancelPending ? "Annulation demandée" : STATUS_LABEL[status];
    const statusClass = cancelPending ? "pending-cancel" : status;
    return (
      '<' + tag + ' class="account-order"' + href + '>' +
        '<div class="account-order__head"><span>' + escText(formatOrderDate(o.created_at)) + '</span><span class="account-order__status account-order__status--' + statusClass + '">' + escText(statusText) + '</span></div>' +
        '<div>' + (isFinite(total) && total > 0 ? escText(formatCents(total)) : '') + (isFinite(delay) && delay === 0 ? ' — tout de suite' : isFinite(delay) && delay > 0 ? ' — prête dans ' + escText(delay) + ' min' : '') + '</div>' +
      '</' + tag + '>'
    );
  }

  function renderOrders(orders, serverNow) {
    const current = qs("accountOrdersCurrent");
    const past = qs("accountOrdersPast");
    const nowMs = serverNow ? new Date(serverNow).getTime() : Date.now();
    const ongoing = function (o) { return isOngoing(o, nowMs); };
    const currentOrders = orders.filter(ongoing);
    const pastOrders = orders.filter(function (o) { return !ongoing(o); });
    current.innerHTML = currentOrders.length
      ? currentOrders.map(orderCardHtml).join("")
      : '<p class="account-hint">Aucune commande en cours.</p>';
    past.innerHTML = pastOrders.length
      ? pastOrders.map(orderCardHtml).join("")
      : '<p class="account-hint">Aucune commande précédente.</p>';
  }

  function showLoggedIn(session) {
    qs("accountCreated").hidden = true;
    qs("accountGuest").hidden = true;
    qs("accountIntro").hidden = true;
    qs("logoutBtn").hidden = false;
    const loggedIn = qs("accountLoggedIn");
    loggedIn.hidden = false;
    qs("accountName").textContent = (session.first_name || "") + (session.last_name ? " " + session.last_name : "");
    qs("accountEmail").textContent = session.email || "";
    qs("profileFirstName").value = session.first_name || "";
    qs("profileLastName").value = session.last_name || "";
    qs("profilePhone").value = session.phone || "";
    qs("addressStreet").value = session.street || "";
    qs("addressCity").value = session.city || "";
    qs("addressHousingType").value = session.housing_type || "";
    qs("addressAptHint").hidden = session.housing_type !== "appartement";

    // Résumé replié (fermé par défaut, voir <details> dans compte.html) : juste de quoi se repérer
    // d'un coup d'œil, l'adresse n'apparaît que si elle est enregistrée. Le formulaire d'édition
    // reste fermé lui aussi (demande du 20/11 : "appuyer sur Modifier" pour le faire apparaître).
    qs("summaryFirstName").textContent = session.first_name || "";
    qs("summaryLastName").textContent = session.last_name || "";
    qs("summaryPhone").textContent = session.phone || "";
    qs("profileForm").hidden = true;
    const addrRow = qs("summaryAddressRow");
    if (session.city) {
      qs("summaryAddress").textContent = addressSummary(session);
      addrRow.hidden = false;
    } else {
      addrRow.hidden = true;
    }

    if (window.SubitoAccount) {
      window.SubitoAccount.myOrders().then(function (r) {
        renderOrders(r.orders, r.serverNow);
      }).catch(function () {
        const message = '<p class="account-hint">Historique indisponible pour l’instant.</p>';
        qs("accountOrdersCurrent").innerHTML = message;
        qs("accountOrdersPast").innerHTML = message;
      });
    }
  }

  function showGuest() {
    qs("accountCreated").hidden = true;
    qs("accountGuest").hidden = false;
    qs("accountLoggedIn").hidden = true;
    qs("accountIntro").hidden = false;
    qs("logoutBtn").hidden = true;
    if (wantsSignupTab()) showTab("signup");
  }

  // Écran dédié juste après la création du compte (demande du 20/11) : la page change complètement,
  // au lieu d'enchaîner directement sur l'écran "connecté" habituel comme après une simple reconnexion.
  let createdSession = null;
  function showAccountCreated(session) {
    createdSession = session;
    qs("accountGuest").hidden = true;
    qs("accountLoggedIn").hidden = true;
    qs("accountIntro").hidden = true;
    qs("logoutBtn").hidden = true;
    qs("accountCreated").hidden = false;
    qs("accountCreatedName").textContent = session.first_name || "";
  }

  function init() {
    if (!window.SubitoAccount) return;

    populateCitySelects();

    // "Appartement" sélectionné : rappelle d'indiquer le numéro d'appartement dans le champ rue
    // (pas de colonne dédiée — on reste au plus près du formulaire déjà existant).
    [["signupHousingType", "signupAptHint"], ["addressHousingType", "addressAptHint"]].forEach(function (pair) {
      const select = qs(pair[0]);
      const hint = qs(pair[1]);
      if (!select || !hint) return;
      select.addEventListener("change", function () { hint.hidden = select.value !== "appartement"; });
    });

    qs("profileEditToggle").addEventListener("click", function (e) {
      // Cliquer sur "Modifier" (élément interactif dans <summary>) ne fait PAS basculer le <details>
      // parent dans les navigateurs testés : il faut l'ouvrir explicitement pour que le formulaire,
      // démasqué juste après, soit réellement visible (un <details> fermé masque tout son contenu).
      // stopPropagation (audit perf/tactile du 24/11/2026) : avec la zone cliquable élargie par
      // CSS (marges négatives), un tap qui déborde légèrement reste capté par ce bouton plutôt que
      // de remonter vers le <summary> parent et ouvrir/fermer le <details> par erreur.
      e.stopPropagation();
      const form = qs("profileForm");
      form.hidden = !form.hidden;
      if (!form.hidden) qs("profileDetails").open = true;
    });

    qs("tabLogin").addEventListener("click", function () { showTab("login"); });
    qs("tabSignup").addEventListener("click", function () { showTab("signup"); });

    qs("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const errorEl = qs("loginError");
      hideError(errorEl);
      const email = qs("loginEmail").value.trim();
      const password = qs("loginPassword").value;
      const btn = qs("loginSubmit");
      btn.disabled = true;
      window.SubitoAccount.login(email, password).then(function (session) {
        btn.disabled = false;
        if (!redirectAfterAuth()) showLoggedIn(session);
      }).catch(function (err) {
        btn.disabled = false;
        if (err.code === "invalid_credentials") showError(errorEl, "E-mail ou mot de passe incorrect.");
        else if (err.code === "too_many_attempts") showError(errorEl, waitMessage(err));
        else if (err.code === "network") showError(errorEl, NETWORK_MESSAGE);
        else showError(errorEl, "Connexion impossible pour l’instant — réessayez dans un instant.");
      });
    });

    qs("signupForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const errorEl = qs("signupError");
      hideError(errorEl);
      const firstName = qs("signupFirstName").value.trim();
      const lastName = qs("signupLastName").value.trim();
      const email = qs("signupEmail").value.trim();
      if (!firstName || !lastName) {
        showError(errorEl, "Indiquez votre prénom et votre nom.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError(errorEl, "Adresse e-mail invalide : vérifiez-la (exemple : nom@domaine.fr).");
        return;
      }
      const password = qs("signupPassword").value;
      const confirm = qs("signupPasswordConfirm").value;
      if (password !== confirm) {
        showError(errorEl, "Les deux mots de passe ne correspondent pas.");
        return;
      }
      if (password.length < 8) {
        showError(errorEl, "Le mot de passe doit faire au moins 8 caractères.");
        return;
      }
      const fields = {
        first_name: qs("signupFirstName").value.trim(),
        last_name: qs("signupLastName").value.trim(),
        email: qs("signupEmail").value.trim(),
        phone: qs("signupPhone").value.trim(),
        street: qs("signupStreet").value.trim(),
        city: qs("signupCity").value,
        housing_type: qs("signupHousingType").value,
        password: password
      };
      // Le formulaire a `novalidate` (on gère nous-mêmes les messages
      // d'erreur, cohérents avec ceux des mots de passe ci-dessus) : le
      // téléphone est obligatoire pour commander, donc vérifié ici aussi,
      // pas seulement via l'attribut `required` du champ.
      if (!fields.phone) {
        showError(errorEl, "Le numéro de téléphone est obligatoire.");
        return;
      }
      const btn = qs("signupSubmit");
      btn.disabled = true;
      window.SubitoAccount.signup(fields).then(function (session) {
        btn.disabled = false;
        if (!redirectAfterAuth()) showAccountCreated(session);
      }).catch(function (err) {
        btn.disabled = false;
        if (err.code === "email_taken") showError(errorEl, "Un compte existe déjà avec cet e-mail — connectez-vous plutôt.");
        else if (err.code === "validation") showError(errorEl, validationMessage(err, "Certaines informations sont invalides : vérifiez le formulaire."));
        else if (err.code === "too_many_attempts") showError(errorEl, waitMessage(err));
        else if (err.code === "network") showError(errorEl, NETWORK_MESSAGE);
        else showError(errorEl, "Inscription impossible pour l’instant — réessayez dans un instant.");
      });
    });

    qs("logoutBtn").addEventListener("click", function () {
      // Une intention de commande en attente ne survit pas à une déconnexion, même si celle-ci échoue.
      function purgeOrderIntent() {
        ["subito_pending_order_redirect", "subito_pending_order_mode", "subito_pending_payment_methods", "subito_pending_cash_change", "subito_pending_cart", "subito_resume_ok"].forEach(function (k) {
          try { sessionStorage.removeItem(k); } catch (e) { /* stockage bloqué : rien à effacer */ }
        });
      }
      window.SubitoAccount.logout().then(function () {
        purgeOrderIntent();
        showGuest();
      }, function () {
        // Déconnexion non confirmée : la session peut encore être active, l'écran ne change pas.
        purgeOrderIntent();
      });
    });

    qs("accountCreatedContinue").addEventListener("click", function () {
      if (createdSession) showLoggedIn(createdSession);
    });

    qs("profileForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const errorEl = qs("profileError");
      const successEl = qs("profileSuccess");
      hideError(errorEl);
      successEl.hidden = true;
      const fields = {
        first_name: qs("profileFirstName").value.trim(),
        last_name: qs("profileLastName").value.trim(),
        phone: qs("profilePhone").value.trim()
      };
      if (!fields.first_name || !fields.last_name) {
        showError(errorEl, "Indiquez votre prénom et votre nom.");
        return;
      }
      if (!fields.phone) {
        showError(errorEl, "Le numéro de téléphone est obligatoire.");
        return;
      }
      const btn = qs("profileSubmit");
      btn.disabled = true;
      window.SubitoAccount.updateProfile(fields).then(function (session) {
        btn.disabled = false;
        qs("accountName").textContent = (session.first_name || "") + (session.last_name ? " " + session.last_name : "");
        qs("profileFirstName").value = session.first_name || "";
        qs("profileLastName").value = session.last_name || "";
        qs("profilePhone").value = session.phone || "";
        qs("summaryFirstName").textContent = session.first_name || "";
        qs("summaryLastName").textContent = session.last_name || "";
        qs("summaryPhone").textContent = session.phone || "";
        successEl.textContent = "Informations enregistrées";
        successEl.hidden = false;
        // Demande du 20/11 : une fois enregistré, tout se referme (formulaire + section) — après
        // un court délai, pour que le message de confirmation reste lisible une seconde.
        setTimeout(function () {
          qs("profileForm").hidden = true;
          qs("profileDetails").open = false;
        }, 1100);
      }).catch(function (err) {
        btn.disabled = false;
        if (err.code === "unauthorized") {
          window.location.href = "compte.html";
        } else if (err.code === "validation") {
          showError(errorEl, validationMessage(err, "Informations invalides : vérifiez le formulaire."));
        } else if (err.code === "network") {
          showError(errorEl, NETWORK_MESSAGE);
        } else {
          showError(errorEl, "Impossible d’enregistrer vos informations pour l’instant — réessayez dans un instant.");
        }
      });
    });

    qs("addressForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const errorEl = qs("addressError");
      const successEl = qs("addressSuccess");
      hideError(errorEl);
      successEl.hidden = true;
      const fields = {
        street: qs("addressStreet").value.trim(),
        city: qs("addressCity").value,
        housing_type: qs("addressHousingType").value
      };
      const btn = qs("addressSubmit");
      btn.disabled = true;
      window.SubitoAccount.updateAddress(fields).then(function (session) {
        btn.disabled = false;
        if (redirectAfterAddress()) return;
        const addrRow = qs("summaryAddressRow");
        if (session.city) {
          qs("summaryAddress").textContent = addressSummary(session);
          addrRow.hidden = false;
        } else {
          addrRow.hidden = true;
        }
        successEl.textContent = "Adresse enregistrée ✓";
        successEl.hidden = false;
        setTimeout(function () { qs("addressDetails").open = false; }, 1100);
      }).catch(function (err) {
        btn.disabled = false;
        if (err.code === "validation" && err.fields && err.fields.city) showError(errorEl, "Nous ne livrons pas dans cette ville : choisissez une ville de la liste.");
        else if (err.code === "validation" && err.fields && err.fields.housing_type) showError(errorEl, "Précisez le type de logement (maison ou appartement).");
        else if (err.code === "validation") showError(errorEl, validationMessage(err, "Adresse invalide : vérifiez la rue et la ville."));
        else if (err.code === "unauthorized") showError(errorEl, "Votre session a expiré : reconnectez-vous.");
        else if (err.code === "network") showError(errorEl, NETWORK_MESSAGE);
        else showError(errorEl, "Impossible d’enregistrer l’adresse pour l’instant — réessayez dans un instant.");
      });
    });

    window.SubitoAccount.me(true).then(function (session) {
      // Déjà connecté : rien à créer, direction la carte plutôt que l'écran "Bonjour, ..." (voir
      // commentaire d'en-tête, flux proposé lors de l'audit du 24/11/2026).
      if (session && wantsSignupTab()) { window.location.href = "menu.html"; return; }
      if (session) showLoggedIn(session); else showGuest();
    }).catch(function () {
      // Panne du service : on affiche le formulaire ; la connexion dira elle-même
      // si le service est indisponible, au lieu de laisser la page vide.
      showGuest();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
