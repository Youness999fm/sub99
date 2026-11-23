/* ============================================================
   Subito Pizza — Compte client (petit client d'API partagé)
   Un seul endroit qui sait parler à l'API /api/customer_*.php,
   utilisé à la fois par le panier (cart.js, pour vérifier qu'on
   est connecté avant d'envoyer une commande) et par la page
   "Mon compte" (compte.html + compte.js) — pour ne pas dupliquer
   cette logique à deux endroits. Chargé sur toutes les pages,
   juste avant cart.js.

   Contrat : reports/2026-11-19-espace-commercant-contrat-api.md.
   SubitoAccount.me() renvoie null pour un invité (réponse 200 avec
   customer: null) ; une panne (réseau, erreur serveur) est signalée par
   une erreur. Toute erreur porte err.code (champ "error" de l'API, ou
   "network"), err.status, et si présents err.fields et err.retryAfter.
   Les textes affichés sont composés par les appelants.
   ============================================================ */

window.SubitoAccount = (function () {
  "use strict";

  const API_BASE = "/api/";

  // undefined = pas encore vérifié cette page ; null = invité ; objet = connecté
  let cachedSession;

  function request(path, options) {
    const opts = Object.assign({
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    }, options || {});
    // Délai maximal, corps de réponse compris : sans réponse au bout de 10 s, la requête est annulée et traitée comme une panne réseau.
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;
    if (controller) opts.signal = controller.signal;
    function networkError() {
      const err = new Error("network");
      err.code = "network";
      err.status = 0;
      return err;
    }
    return fetch(API_BASE + path, opts).then(function (res) {
      return res.json().then(function (parsed) {
        return { res: res, data: parsed };
      }, function (err) {
        // Coupure ou délai pendant la lecture du corps : panne réseau. Seul un corps illisible (JSON invalide)
        // est une réponse sans données.
        if (controller && controller.signal.aborted) throw networkError();
        if (err && err.name !== "SyntaxError") throw networkError();
        return { res: res, data: null };
      });
    }, function () {
      throw networkError();
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      const res = r.res;
      const data = r.data;
      // Réponse réussie mais sans JSON (page d'erreur, maintenance) : ce n'est pas un « invité ».
      if (res.ok && data === null) {
        const bad = new Error("bad_response");
        bad.code = "bad_response";
        bad.status = res.status;
        throw bad;
      }
      if (!res.ok || !data || data.ok === false) {
        const code = (data && data.error) || ("http_" + res.status);
        const err = new Error(code);
        err.code = code;
        err.status = res.status;
        if (data && data.fields && typeof data.fields === "object") err.fields = data.fields;
        if (data && data.retry_after_seconds != null) err.retryAfter = Number(data.retry_after_seconds);
        throw err;
      }
      return data;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  // Une réponse de connexion ou d'inscription doit désigner le client : sans lui, ce n'est pas une session valable.
  function sessionFrom(data) {
    if (!data || !data.customer) {
      const anomalie = new Error("bad_response");
      anomalie.code = "bad_response";
      anomalie.status = 200;
      throw anomalie;
    }
    return data.customer;
  }

  // Interroge la session actuelle. Mise en cache pour la durée de la page
  // (évite un appel réseau à chaque clic) ; passer force=true pour forcer
  // une nouvelle vérification (ex. juste après une connexion ailleurs).
  // Une panne (réseau, 5xx) n'est PAS un « invité » : elle est propagée à
  // l'appelant et n'est pas mise en cache, sinon un client connecté serait
  // envoyé vers la page de connexion alors que le service est indisponible.
  function me(force) {
    if (!force && cachedSession !== undefined) return Promise.resolve(cachedSession);
    return request("customer_me.php", { method: "GET" })
      .then(function (data) {
        // Un client absent doit être dit explicitement (customer: null) ; une réponse sans ce champ est une anomalie.
        if (!("customer" in data)) {
          const anomalie = new Error("bad_response");
          anomalie.code = "bad_response";
          anomalie.status = 200;
          throw anomalie;
        }
        cachedSession = data.customer || null;
        return cachedSession;
      });
  }

  function login(email, password) {
    return request("customer_login.php", {
      method: "POST",
      body: JSON.stringify({ email: email, password: password })
    }).then(function (data) {
      cachedSession = sessionFrom(data);
      return cachedSession;
    });
  }

  // fields : { first_name, last_name, email, phone, password, street, city }
  function signup(fields) {
    return request("customer_signup.php", {
      method: "POST",
      body: JSON.stringify(fields)
    }).then(function (data) {
      cachedSession = sessionFrom(data);
      return cachedSession;
    });
  }

  function logout() {
    return request("customer_logout.php", { method: "POST", body: "{}" }).then(function () {
      cachedSession = null;
    });
  }

  // Enregistre/modifie l'adresse de livraison du compte (rue + ville, voir
  // compte.html) — distinct de signup()/login() : peut être appelé à tout
  // moment une fois connecté, pas seulement à la création du compte.
  function updateAddress(fields) {
    return request("customer_update_address.php", {
      method: "POST",
      body: JSON.stringify(fields)
    }).then(function (data) {
      cachedSession = data.customer;
      return cachedSession;
    });
  }

  // Commandes de ce client seulement, plus récentes d'abord (ordre du serveur).
  // fields : { first_name, last_name, phone }
  function updateProfile(fields) {
    return request("customer_update_profile.php", {
      method: "POST",
      body: JSON.stringify(fields)
    }).then(function (data) {
      cachedSession = data.customer;
      return cachedSession;
    });
  }

  function myOrders() {
    return request("customer_orders.php", { method: "GET" }).then(function (data) {
      return { orders: (data && data.orders) || [], serverNow: data && data.server_now };
    });
  }

  return { me: me, login: login, signup: signup, logout: logout, myOrders: myOrders, updateAddress: updateAddress, updateProfile: updateProfile };
})();
