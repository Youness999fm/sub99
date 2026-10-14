# Mission — Diagnostic : le son/la vibration de l'intro ne fonctionnent pas sur téléphone

## Demande initiale
L'utilisateur a testé le site réel sur son téléphone : ni le « ding » ni la vibration ne se déclenchent. Demande de trouver la cause réelle (pas juste re-vérifier le code), corriger si possible sans ajouter de bouton, ajouter des diagnostics, et tester aussi loin que l'environnement le permet.

## Analyse du code existant
`initIntroSplash()` (`assets/js/main.js`) ne tentait le son et la vibration **qu'une seule fois, automatiquement, à 250ms après le début de l'intro** — avant tout geste de l'utilisateur. Or la quasi-totalité des navigateurs mobiles (Chrome Android confirmé avec un message natif explicite, Safari iOS documenté) **bloquent `navigator.vibrate()` et appliquent une politique stricte sur `Audio.play()` tant qu'aucune interaction (tap, scroll...) n'a eu lieu sur la page**. Comme l'intro se joue automatiquement au chargement, cette unique tentative à 250ms tombe quasi systématiquement avant toute interaction → silence et absence de vibration sur un premier chargement, ce qui correspond exactement au symptôme décrit.

Confirmé noir sur blanc en local (voir Vérifications) : `navigator.vibrate(25)` appelé automatiquement déclenche littéralement un message Chrome *« Blocked call to navigator.vibrate because user hasn't tapped on the frame... »*.

## Correctif appliqué
Dans `initIntroSplash()` :
- La tentative automatique à 250ms est conservée (certains navigateurs/contextes l'autorisent, notamment si le site a déjà de l'engagement).
- **Nouveau** : si elle échoue, une unique tentative de rattrapage se déclenche exactement au moment du **premier geste réel de l'utilisateur** — le même tap/scroll/touche qui ferme déjà l'intro (`dismissFromGesture`). L'appel est synchrone dans la pile de l'évènement, ce qui satisfait la politique d'activation des navigateurs : c'est la seule façon fiable de jouer un son/une vibration sans ajouter de bouton. Rien n'est répété si la première tentative a déjà réussi (indicateurs `chimeStarted` / `vibrated`).
- La fermeture **automatique** après 1200ms (sans geste) ne retente rien — ce n'est pas un geste, ça ne débloquerait rien, et ça éviterait un déclenchement « en retard » hors de propos.
- **Diagnostics ajoutés** : `console.info`/`console.warn` préfixés `[intro-fx]` à chaque étape (son joué / refusé / fichier illisible avec code d'erreur explicite ; vibration déclenchée / refusée / API absente). Visibles via le débogage distant (voir section finale).
- Un écouteur `error` sur l'élément `Audio` journalise désormais le `MediaError.code` exact si le fichier ne charge pas (1 interrompu, 2 réseau, 3 décodage, 4 format non supporté), avec un rappel du point à vérifier côté FTP.

## Vérifications réellement effectuées
- `node --check assets/js/main.js` : syntaxe valide.
- **Fichier audio local** : rechargé isolément avec un élément `Audio`, événement `canplaythrough` obtenu, durée mesurée 0.68s conforme → le fichier `assets/audio/intro-chime.wav` lui-même est valide et bien formé, ce n'est pas un problème de génération.
- **Scénario « blocage puis rattrapage », viewport mobile (375×812, user-agent tactile), serveur local** :
  - Rechargement propre (stockage vidé) → la vibration automatique à 250ms est bien bloquée par le navigateur (message Chrome natif + notre diagnostic `vibration refusée`), le son, lui, a pu jouer automatiquement dans cet environnement de test précis (le comportement réel variera selon navigateur/appareil, c'est documenté comme tel).
  - Nouveau rechargement + **tap simulé avant 250ms** → le rattrapage se déclenche : `[intro-fx] vibration déclenchée (déclencheur : premier geste utilisateur)` **sans aucun message de blocage cette fois** — preuve que le correctif débloque réellement la vibration. Le son a également été confirmé joué par ce même déclencheur.
  - Capture d'écran après le tap : page d'accueil affichée normalement, aucune régression visuelle, aucune erreur console parasite.
- **Tentative de test sur le site réel en ligne** (`https://subito-pizza-heninbeaumont.fr`) : le code JS le plus récent (avec vibration) y est déjà présent — quelqu'un l'a donc déjà republié par FTP entre-temps. En revanche, en testant le fichier audio sur ce domaine réel, l'élément `Audio` a renvoyé une erreur **`MEDIA_ERR_SRC_NOT_SUPPORTED` (« Format error »)** — contrairement au fichier local qui se charge parfaitement. **Limite importante à signaler honnêtement** : mon outil de navigateur intégré a par ailleurs rencontré ses propres restrictions réseau sur ce domaine externe (`fetch`/`XMLHttpRequest` bloqués même pour des images déjà existantes sur le site comme `logo.jpg`, erreurs `SecurityError` en lisant les feuilles de style) — des limitations de mon environnement de test, pas forcément du site. Le test par élément `Audio` (qui passe par un circuit différent, non soumis aux mêmes blocages) est donc le seul signal que je considère fiable ici, mais je ne peux pas le confirmer à 100% indépendamment de ces limitations d'outil. **À vérifier côté humain.**

## Hypothèse la plus probable pour le site en ligne (à confirmer)
Un fichier `.wav` est binaire. Un classique très fréquent en FTP : si le transfert se fait en **mode ASCII/texte au lieu de mode binaire**, le fichier est corrompu à l'upload (silencieusement, sans erreur visible côté client FTP) et le navigateur le rejette ensuite comme « format non supporté » — exactement le symptôme observé. Autres causes possibles à écarter : fichier non uploadé du tout, mauvais chemin/casse (`assets/audio/` sensible à la casse sur un serveur Linux), ou upload partiel/interrompu.

## Ce qu'il reste à faire humainement
1. Confirmer : le fichier `assets/audio/intro-chime.wav` a-t-il bien été envoyé en ligne (en plus de `assets/js/main.js`, qui lui est visiblement déjà à jour) ?
2. Si oui, le ré-envoyer en **mode binaire explicite** (la plupart des clients FTP modernes le détectent automatiquement pour du `.wav`, mais pas tous) et vérifier sa taille une fois en ligne (doit faire **59 Ko**, pas 0 Ko ni une taille suspecte comme la taille d'une page d'erreur HTML).
3. Retester sur le téléphone après ce ré-upload, avec un vrai tap sur l'écran d'intro (le son/la vibration ne sont plus garantis instantanés sans geste, c'est voulu).

## Verdict
**Cause probable identifiée et corrigée côté code** (politique d'activation des navigateurs — correctif du rattrapage par geste, vérifié fonctionnel en local). **Cause probable côté serveur identifiée mais non confirmée à 100%** (fichier audio distant rejeté comme « format non supporté », cohérent avec une corruption FTP classique) — nécessite une vérification/ré-upload humain, pas quelque chose que je peux corriger ou confirmer moi-même sans accès FTP ni au téléphone réel de l'utilisateur.

## À republier
`assets/js/main.js` (mis à jour avec le rattrapage par geste + diagnostics) et **impérativement `assets/audio/intro-chime.wav` en mode binaire**, par FTP.
