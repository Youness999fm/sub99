/* Disponibilité des pizzas, côté client (menu.html).
 *
 * Source : l'API (api/availability.php), alimentée par le commerçant. Secours : le fichier
 * assets/data/disponibilite.json, si le serveur ne répond pas (valeurs saisies à la main, non à jour).
 * Le serveur refuse de toute façon une pizza en rupture à la commande.
 * Règles (cadrage du 19/11/2026, sub99/reports/2026-11-19-reprise-site-cadrage.md) :
 *  - une pizza est indisponible si elle figure dans « pizzasIndisponibles », ou si un de
 *    ses ingrédients fixes figure dans « ingredientsIndisponibles » ;
 *  - elle reste visible, grisée, avec un bandeau rouge « Victime de son succès » ;
 *    elle n'est plus commandable, ni directement, ni comme deuxième moitié ;
 *  - garniture au choix (Calzone) : seule la garniture indisponible disparaît du choix ;
 *    la pizza ne disparaît entièrement que si toutes ses garnitures le sont ;
 *  - le mot « rupture » n'est jamais affiché côté client ;
 *  - noms tolérants : casse, accents, apostrophes typographiques et « œ » ne comptent pas,
 *    et « Calzone » vaut pour « Calzone (soufflée) ».
 *
 * Ordre de chargement : ce script vient APRÈS cart.js, qui construit les boutons de
 * commande et le catalogue de moitié-moitié. Il retire ou ajuste ce que cart.js a construit.
 * Tant que la disponibilité n'est pas lue, les boutons pizza restent cachés (disponibilite.css).
 */
(function () {
  'use strict';

  const SOURCE = 'api/availability.php';
  const SECOURS = 'assets/data/disponibilite.json';

  // Forme de comparaison : casse, accents, apostrophes et « œ » sans importance, espaces réduits.
  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/œ/g, 'oe')
      .replace(/[’‘`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Une pizza est reconnue avec sa parenthèse finale ou sans (« Calzone » pour « Calzone (soufflée) »).
  function nameKeys(name) {
    const full = norm(name);
    const core = norm(String(name || '').replace(/\s*\([^()]*\)\s*$/, ''));
    return core && core !== full ? [full, core] : [full];
  }

  // Une liste attendue : un tableau. Autre chose = avertissement, et rien n'est retiré.
  function asList(value, field) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      console.warn('Disponibilité : « ' + field + ' » doit être une liste entre crochets, par exemple ["Régina"].');
      return [];
    }
    return value.map(function (v) { return String(v); });
  }

  // Même découpage que cart.js : virgules, puis « ou ».
  function splitList(text) {
    const out = [];
    String(text || '').split(',').forEach(function (part) {
      part.split(/\s+ou\s+/i).forEach(function (tok) {
        const t = tok.trim();
        if (t && out.indexOf(t) === -1) out.push(t);
      });
    });
    return out;
  }

  // ["a", "b", "c"] -> "a, b ou c"
  function joinFr(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' ou ' + list[list.length - 1];
  }

  // Seules les pizzas ont un bouton de commande « pizza-widget » (cart.js).
  function pizzaCards() {
    return Array.prototype.filter.call(document.querySelectorAll('.menu-item'), function (card) {
      return card.querySelector('.pizza-widget');
    });
  }

  // Nom, ingrédients fixes, et garniture au choix (span .menu-item__choice).
  function readCard(card) {
    const nameEl = card.querySelector('.menu-item__name');
    const ingEl = card.querySelector('.menu-item__ingredients');
    let fixed = [];
    let choice = null;
    if (ingEl) {
      const copy = ingEl.cloneNode(true);
      const copyChoice = copy.querySelector('.menu-item__choice');
      if (copyChoice) copyChoice.remove();
      fixed = splitList(copy.textContent);
      const choiceEl = ingEl.querySelector('.menu-item__choice');
      if (choiceEl) {
        const raw = choiceEl.textContent;
        const colon = raw.indexOf(':');
        if (colon !== -1) {
          choice = {
            el: choiceEl,
            label: raw.slice(0, colon + 1),
            options: splitList(raw.slice(colon + 1))
          };
        }
      }
    }
    return { name: nameEl ? nameEl.textContent.trim() : '', fixed: fixed, choice: choice };
  }

  // Pizza indisponible : on retire son bouton de commande, on la grise, on pose le bandeau.
  function markOff(card) {
    const widget = card.querySelector('.pizza-widget');
    if (widget) widget.remove();
    card.classList.add('is-off');
    card.setAttribute('data-indisponible', '');

    // Calque sur la photo : bandeau rouge « Victime de son succès ».
    const visual = document.createElement('div');
    visual.className = 'dispo-visuel';
    const sticker = document.createElement('span');
    sticker.className = 'dispo-sticker';
    sticker.textContent = 'Victime de son succès';
    visual.appendChild(sticker);

    const body = card.querySelector('.menu-item__body');
    if (body) card.insertBefore(visual, body); else card.appendChild(visual);

    const rest = document.createElement('p');
    rest.className = 'dispo-rest';
    rest.textContent = 'Elle se repose un moment. Revenez très vite.';
    (body || card).appendChild(rest);
  }

  // Calzone : seule la garniture indisponible disparaît (bouton du widget et texte de la fiche).
  function trimChoice(card, info, left) {
    const removed = info.choice.options
      .filter(function (o) { return left.indexOf(o) === -1; })
      .map(norm);
    card.querySelectorAll('.pizza-widget__filler-btn').forEach(function (btn) {
      if (removed.indexOf(norm(btn.textContent)) !== -1) btn.remove();
    });
    info.choice.el.textContent = info.choice.label + ' ' + joinFr(left);
  }

  // Clés attendues dans le fichier : une autre clé est signalée (faute de frappe probable).
  const KEYS = ['commentaire', 'misAJourLe', 'pizzasIndisponibles', 'ingredientsIndisponibles'];

  function apply(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      console.warn('Disponibilité : le fichier doit être un objet { "pizzasIndisponibles": [...], "ingredientsIndisponibles": [...] }. Rien n\'est retiré.');
      return;
    }
    Object.keys(data).forEach(function (k) {
      if (KEYS.indexOf(k) === -1) console.warn('Disponibilité : clé inconnue « ' + k + ' » (ignorée).');
    });
    const listedPizzas = asList(data.pizzasIndisponibles, 'pizzasIndisponibles');
    const listedIngredients = asList(data.ingredientsIndisponibles, 'ingredientsIndisponibles');
    const outPizzas = listedPizzas.map(norm);
    const outIngredients = listedIngredients.map(norm);
    const knownPizzas = [];      // noms reconnus sur la carte (forme complète et forme courte)
    const knownIngredients = []; // ingrédients fixes ou au choix des pizzas de la carte

    // 1. On lit toutes les cartes avant de modifier quoi que ce soit.
    const plan = pizzaCards().map(function (card) {
      const info = readCard(card);
      const keys = nameKeys(info.name);
      keys.forEach(function (k) { knownPizzas.push(k); });
      info.fixed.forEach(function (t) { knownIngredients.push(norm(t)); });
      const options = info.choice ? info.choice.options : [];
      options.forEach(function (t) { knownIngredients.push(norm(t)); });

      const left = options.filter(function (o) { return outIngredients.indexOf(norm(o)) === -1; });
      const blocked =
        keys.some(function (k) { return outPizzas.indexOf(k) !== -1; }) ||
        info.fixed.some(function (t) { return outIngredients.indexOf(norm(t)) !== -1; }) ||
        (options.length > 0 && left.length === 0);
      return { card: card, info: info, options: options, left: left, blocked: blocked };
    });

    // 2. Puis on modifie les cartes.
    const off = [];  // noms complets des pizzas retirées (pour la moitié-moitié)
    plan.forEach(function (p) {
      if (p.blocked) {
        markOff(p.card);
        off.push(norm(p.info.name));
      } else if (p.left.length < p.options.length) {
        trimChoice(p.card, p.info, p.left);
      }
    });

    // Moitié-moitié : une pizza retirée n'est plus proposée en deuxième moitié.
    document.querySelectorAll('.pizza-widget option').forEach(function (opt) {
      if (off.indexOf(norm(opt.value)) !== -1) opt.remove();
    });

    const unknownPizzas = listedPizzas.filter(function (p) { return knownPizzas.indexOf(norm(p)) === -1; });
    const unknownIngredients = listedIngredients.filter(function (i) { return knownIngredients.indexOf(norm(i)) === -1; });
    if (unknownPizzas.length) console.warn('Disponibilité : pizza introuvable sur cette page ->', unknownPizzas.join(', '));
    if (unknownIngredients.length) console.warn('Disponibilité : ingrédient absent des pizzas ->', unknownIngredients.join(', '));
  }

  // Une réponse n'est acceptée que si elle contient les deux listes : sinon, repli sur le fichier.
  function lire(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.pizzasIndisponibles) || !Array.isArray(data.ingredientsIndisponibles)) {
        throw new Error('réponse sans listes de disponibilité');
      }
      return data;
    });
  }

  // Le serveur d'abord ; le fichier de secours seulement si le serveur ne répond pas
  // (réseau, erreur, réponse qui n'est pas du JSON, comme sur un aperçu statique).
  function load() {
    return lire(SOURCE)
      .catch(function (error) {
        console.warn('Disponibilité : serveur indisponible (' + error.message + ') : lecture du fichier de secours.');
        return lire(SECOURS);
      })
      .then(apply)
      .catch(function (error) {
        console.warn('Disponibilité non lue (' + error.message + ') : aucune pizza n\'est retirée.');
      })
      .then(function () {
        document.documentElement.classList.add('dispo-pret');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
