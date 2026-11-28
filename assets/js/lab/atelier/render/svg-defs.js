/**
 * Planche de formes SVG — dégradés, filtres et dessin de chaque ingrédient.
 *
 * Tout est procédural : aucune image, donc net à toutes les tailles et aucun
 * asset à produire. Les formes vivent dans un <svg> caché unique (« sprite »)
 * injecté une fois dans le document ; la pizza comme les bacs les réutilisent
 * via <use href="#atl-...">, ce qui évite de dupliquer les dégradés.
 *
 * Repère de dessin : chaque forme est centrée sur (0,0) et dimensionnée pour un
 * canvas où la pizza de référence a un rayon de 420 unités.
 */

import { createRng, range, intRange } from '../core/random.js';

const SPRITE_ID = 'atelier-sprite';

/* ------------------------------------------------------------- utilitaires */

/** Mouchetures/éclats répartis dans une ellipse, de façon déterministe. */
function speckles(seed, count, rx, ry, rMin, rMax, fill, opacity) {
  const rng = createRng(seed);
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng());
    const x = Math.cos(a) * rx * d;
    const y = Math.sin(a) * ry * d;
    const r = range(rng, rMin, rMax);
    out += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * range(rng, 0.7, 1))}" fill="${fill}" opacity="${opacity}"/>`;
  }
  return out;
}

/** Contour fermé légèrement irrégulier — une pizza n'est jamais un cercle. */
export function wobblyCircle(radius, amplitude, seed, points = 84) {
  const rng = createRng(seed);
  const offsets = [];
  for (let i = 0; i < points; i += 1) offsets.push(range(rng, -1, 1));
  let d = '';
  for (let i = 0; i < points; i += 1) {
    // Moyenne glissante : supprime les dents de scie, garde les ondulations.
    const smooth = (offsets[(i - 1 + points) % points] + offsets[i] * 2 + offsets[(i + 1) % points]) / 4;
    const r = radius * (1 + smooth * amplitude);
    const a = (i / points) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    d += `${i === 0 ? 'M' : 'L'}${f(x)},${f(y)}`;
  }
  return d + 'Z';
}

/** Spirale d'Archimède : support du masque d'étalage de la sauce. */
export function spiralPath(maxRadius, turns = 4.6, step = 5) {
  const total = turns * 360;
  const a = maxRadius / (turns * Math.PI * 2);
  let d = '';
  for (let deg = 0; deg <= total; deg += step) {
    const t = (deg * Math.PI) / 180;
    const r = a * t;
    const x = Math.cos(t) * r;
    const y = Math.sin(t) * r;
    d += `${deg === 0 ? 'M' : 'L'}${f(x)},${f(y)}`;
  }
  return d;
}

function f(n) {
  return Math.round(n * 100) / 100;
}

/* ---------------------------------------------------------------- dégradés */

function gradients() {
  return `
  <radialGradient id="atg-dough" cx="42%" cy="34%" r="78%">
    <stop offset="0%" stop-color="#F3D7A4"/>
    <stop offset="52%" stop-color="#E7C089"/>
    <stop offset="100%" stop-color="#CC9C5A"/>
  </radialGradient>
  <radialGradient id="atg-crust" cx="40%" cy="30%" r="75%">
    <stop offset="0%" stop-color="#F6D9A4"/>
    <stop offset="60%" stop-color="#E2B06B"/>
    <stop offset="100%" stop-color="#C08647"/>
  </radialGradient>
  <radialGradient id="atg-crust-ring" cx="44%" cy="36%" r="74%">
    <stop offset="0%" stop-color="#E9BE7E"/>
    <stop offset="72%" stop-color="#D8A05A"/>
    <stop offset="88%" stop-color="#C0813D"/>
    <stop offset="100%" stop-color="#9E6128"/>
  </radialGradient>

  <radialGradient id="atg-sauce-tomate" cx="42%" cy="36%" r="76%">
    <stop offset="0%" stop-color="#DE4A2E"/>
    <stop offset="55%" stop-color="#C13119"/>
    <stop offset="100%" stop-color="#96200F"/>
  </radialGradient>
  <radialGradient id="atg-sauce-creme" cx="42%" cy="36%" r="76%">
    <stop offset="0%" stop-color="#FFFDF5"/>
    <stop offset="55%" stop-color="#F7EFD9"/>
    <stop offset="100%" stop-color="#E6D9B8"/>
  </radialGradient>
  <radialGradient id="atg-sauce-curry" cx="42%" cy="36%" r="76%">
    <stop offset="0%" stop-color="#F2B637"/>
    <stop offset="55%" stop-color="#DC9212"/>
    <stop offset="100%" stop-color="#A96506"/>
  </radialGradient>
  <radialGradient id="atg-sauce-bbq" cx="42%" cy="36%" r="76%">
    <stop offset="0%" stop-color="#D9762A"/>
    <stop offset="55%" stop-color="#B2500F"/>
    <stop offset="100%" stop-color="#782F06"/>
  </radialGradient>

  <linearGradient id="atg-pool-tomate" x1="0%" y1="0%" x2="30%" y2="100%">
    <stop offset="0%" stop-color="#E05232"/><stop offset="100%" stop-color="#A5250F"/>
  </linearGradient>
  <linearGradient id="atg-pool-creme" x1="0%" y1="0%" x2="30%" y2="100%">
    <stop offset="0%" stop-color="#FFFEF8"/><stop offset="100%" stop-color="#EADCB9"/>
  </linearGradient>
  <linearGradient id="atg-pool-curry" x1="0%" y1="0%" x2="30%" y2="100%">
    <stop offset="0%" stop-color="#F5BC3C"/><stop offset="100%" stop-color="#B06C06"/>
  </linearGradient>
  <linearGradient id="atg-pool-bbq" x1="0%" y1="0%" x2="30%" y2="100%">
    <stop offset="0%" stop-color="#DD7B2C"/><stop offset="100%" stop-color="#7C3106"/>
  </linearGradient>

  <linearGradient id="atg-julienne" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#FDF6DD"/>
    <stop offset="48%" stop-color="#F6E9BE"/>
    <stop offset="100%" stop-color="#DFC487"/>
  </linearGradient>

  <radialGradient id="atg-mozza" cx="38%" cy="32%" r="72%">
    <stop offset="0%" stop-color="#FAEBBE"/>
    <stop offset="52%" stop-color="#F0D796"/>
    <stop offset="100%" stop-color="#DDB362"/>
  </radialGradient>

  <radialGradient id="atg-chorizo" cx="38%" cy="32%" r="74%">
    <stop offset="0%" stop-color="#CA4330"/><stop offset="62%" stop-color="#A52D1C"/><stop offset="100%" stop-color="#7C1C0F"/>
  </radialGradient>
  <radialGradient id="atg-mortadelle" cx="38%" cy="32%" r="74%">
    <stop offset="0%" stop-color="#F7CEC9"/><stop offset="65%" stop-color="#EDB2AC"/><stop offset="100%" stop-color="#D9918B"/>
  </radialGradient>
  <radialGradient id="atg-merguez" cx="36%" cy="30%" r="76%">
    <stop offset="0%" stop-color="#C45235"/><stop offset="60%" stop-color="#9C3620"/><stop offset="100%" stop-color="#70210F"/>
  </radialGradient>
  <linearGradient id="atg-jambon" x1="10%" y1="0%" x2="80%" y2="100%">
    <stop offset="0%" stop-color="#FAC6C1"/><stop offset="55%" stop-color="#F0A8A2"/><stop offset="100%" stop-color="#DE8982"/>
  </linearGradient>
  <linearGradient id="atg-lardon" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#E89C90"/><stop offset="100%" stop-color="#C96F61"/>
  </linearGradient>
  <!-- Plus doré que la mozzarella, sinon les morceaux de poulet disparaissent
       dans la nappe de fromage. -->
  <linearGradient id="atg-poulet" x1="15%" y1="0%" x2="85%" y2="100%">
    <stop offset="0%" stop-color="#E7BE78"/><stop offset="55%" stop-color="#CE9A49"/><stop offset="100%" stop-color="#A97327"/>
  </linearGradient>
  <linearGradient id="atg-kebab" x1="10%" y1="0%" x2="90%" y2="100%">
    <stop offset="0%" stop-color="#D4974B"/><stop offset="55%" stop-color="#B2712D"/><stop offset="100%" stop-color="#8C521C"/>
  </linearGradient>
  <linearGradient id="atg-hachee" x1="20%" y1="0%" x2="80%" y2="100%">
    <stop offset="0%" stop-color="#99603A"/><stop offset="60%" stop-color="#7B4826"/><stop offset="100%" stop-color="#5C3119"/>
  </linearGradient>

  <linearGradient id="atg-champignon" x1="20%" y1="0%" x2="70%" y2="100%">
    <stop offset="0%" stop-color="#F6EEDE"/><stop offset="60%" stop-color="#E7D9BF"/><stop offset="100%" stop-color="#CFBC9B"/>
  </linearGradient>
  <linearGradient id="atg-artichaut" x1="25%" y1="0%" x2="75%" y2="100%">
    <stop offset="0%" stop-color="#D5E0B4"/><stop offset="55%" stop-color="#B2C389"/><stop offset="100%" stop-color="#8A9C61"/>
  </linearGradient>
  <linearGradient id="atg-poivron-r" x1="10%" y1="0%" x2="80%" y2="100%">
    <stop offset="0%" stop-color="#E04B33"/><stop offset="60%" stop-color="#BE2A18"/><stop offset="100%" stop-color="#8F1A0C"/>
  </linearGradient>
  <linearGradient id="atg-poivron-v" x1="10%" y1="0%" x2="80%" y2="100%">
    <stop offset="0%" stop-color="#63A24A"/><stop offset="60%" stop-color="#417F30"/><stop offset="100%" stop-color="#2C5B20"/>
  </linearGradient>
  <linearGradient id="atg-oignon" x1="0%" y1="0%" x2="40%" y2="100%">
    <stop offset="0%" stop-color="#FFFDFE"/><stop offset="55%" stop-color="#F3EAF1"/><stop offset="100%" stop-color="#DCCBD9"/>
  </linearGradient>
  <radialGradient id="atg-capre" cx="34%" cy="30%" r="76%">
    <stop offset="0%" stop-color="#90A058"/><stop offset="62%" stop-color="#6B7C3A"/><stop offset="100%" stop-color="#475523"/>
  </radialGradient>
  <radialGradient id="atg-olive" cx="34%" cy="28%" r="78%">
    <stop offset="0%" stop-color="#574160"/><stop offset="58%" stop-color="#3A2A42"/><stop offset="100%" stop-color="#1F1626"/>
  </radialGradient>

  <linearGradient id="atg-parmesan" x1="0%" y1="0%" x2="60%" y2="100%">
    <stop offset="0%" stop-color="#FBF3D8"/><stop offset="100%" stop-color="#E9D9A9"/>
  </linearGradient>
  <linearGradient id="atg-brie" x1="25%" y1="0%" x2="75%" y2="100%">
    <stop offset="0%" stop-color="#FDF8E6"/><stop offset="60%" stop-color="#F4E9C4"/><stop offset="100%" stop-color="#E3D29C"/>
  </linearGradient>
  <radialGradient id="atg-chevre" cx="38%" cy="32%" r="74%">
    <stop offset="0%" stop-color="#FFFDF6"/><stop offset="62%" stop-color="#F6EFDE"/><stop offset="100%" stop-color="#E2D7BF"/>
  </radialGradient>
  <linearGradient id="atg-bleu" x1="20%" y1="0%" x2="80%" y2="100%">
    <stop offset="0%" stop-color="#F7F5E9"/><stop offset="60%" stop-color="#E8E5D2"/><stop offset="100%" stop-color="#D2CFB8"/>
  </linearGradient>
  <linearGradient id="atg-reblochon" x1="20%" y1="0%" x2="80%" y2="100%">
    <stop offset="0%" stop-color="#FAF3DD"/><stop offset="60%" stop-color="#F0E3BC"/><stop offset="100%" stop-color="#DFCB98"/>
  </linearGradient>

  <radialGradient id="atg-shadow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#0B0F12" stop-opacity="0.5"/>
    <stop offset="62%" stop-color="#0B0F12" stop-opacity="0.34"/>
    <stop offset="86%" stop-color="#0B0F12" stop-opacity="0.1"/>
    <stop offset="100%" stop-color="#0B0F12" stop-opacity="0"/>
  </radialGradient>

  <!-- Bacs gastronormes : la lumière vient toujours du haut-gauche. -->

  <!-- Bord roulé : vif sur l'arête haut-gauche, éteint en bas à droite. -->
  <linearGradient id="atg-pan-rim" x1="8%" y1="0%" x2="88%" y2="100%">
    <stop offset="0%" stop-color="#E4E9ED"/>
    <stop offset="18%" stop-color="#B9C1C7"/>
    <stop offset="46%" stop-color="#8E979E"/>
    <stop offset="72%" stop-color="#AEB7BD"/>
    <stop offset="100%" stop-color="#5E676D"/>
  </linearGradient>

  <!-- Paroi intérieure : la paroi proche (haut-gauche) est dans son ombre,
       la paroi opposée reçoit la lumière. -->
  <linearGradient id="atg-pan-wall" x1="10%" y1="0%" x2="80%" y2="100%">
    <stop offset="0%" stop-color="#363D43"/>
    <stop offset="40%" stop-color="#4E575E"/>
    <stop offset="100%" stop-color="#7C868D"/>
  </linearGradient>

  <linearGradient id="atg-pan-floor" x1="12%" y1="0%" x2="78%" y2="100%">
    <stop offset="0%" stop-color="#2C3338"/>
    <stop offset="100%" stop-color="#4A535A"/>
  </linearGradient>

  <!-- Posé en multiply sur le contenu : ombre portée des parois. -->
  <radialGradient id="atg-pan-occlusion" cx="52%" cy="48%" r="62%">
    <stop offset="0%" stop-color="#FFFFFF"/>
    <stop offset="62%" stop-color="#D8DDE1"/>
    <stop offset="88%" stop-color="#8A929A"/>
    <stop offset="100%" stop-color="#5A6269"/>
  </radialGradient>

  <!-- Posé en screen : la lampe qui frappe le haut du tas. -->
  <radialGradient id="atg-pan-lift" cx="34%" cy="28%" r="52%">
    <stop offset="0%" stop-color="#3A3A32" stop-opacity="0.75"/>
    <stop offset="55%" stop-color="#15150F" stop-opacity="0.3"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>

  <!-- Plan de travail. -->
  <radialGradient id="atg-worktop" cx="26%" cy="-14%" r="124%">
    <stop offset="0%" stop-color="#D2D9DE"/>
    <stop offset="24%" stop-color="#B7C0C6"/>
    <stop offset="52%" stop-color="#99A2A9"/>
    <stop offset="78%" stop-color="#7A848B"/>
    <stop offset="100%" stop-color="#5C656C"/>
  </radialGradient>

  <!-- La saladette : de l'inox, pas une bande noire. Sombre en haut (le fond
       de la cuve, loin de la lampe), elle remonte vers la lèvre. -->
  <linearGradient id="atg-rail" x1="14%" y1="0%" x2="72%" y2="100%">
    <stop offset="0%" stop-color="#424C54"/>
    <stop offset="26%" stop-color="#5A656E"/>
    <stop offset="62%" stop-color="#4C565E"/>
    <stop offset="100%" stop-color="#333B42"/>
  </linearGradient>

  <!-- Lèvre du rail : le métal remonte vers l'arête, donc il s'éclaircit. -->
  <linearGradient id="atg-rail-lip" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#2B3339" stop-opacity="0"/>
    <stop offset="60%" stop-color="#6E7982" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#AEB8BF" stop-opacity="0.9"/>
  </linearGradient>

  <!-- Ombre portée du rail sur la zone de travail. -->
  <linearGradient id="atg-rail-shadow" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#0A0E11" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="#0A0E11" stop-opacity="0"/>
  </linearGradient>

  <!-- Halo de la lampe du passe, en haut à gauche. -->
  <radialGradient id="atg-lamp" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#FFF6E2" stop-opacity="0.3"/>
    <stop offset="45%" stop-color="#E8EEF4" stop-opacity="0.13"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>

  <!-- Assombrissement des angles : sans lui la tôle reste plate. -->
  <radialGradient id="atg-corners" cx="34%" cy="18%" r="96%">
    <stop offset="0%" stop-color="#FFFFFF"/>
    <stop offset="58%" stop-color="#EDF0F2"/>
    <stop offset="85%" stop-color="#B4BCC2"/>
    <stop offset="100%" stop-color="#8D959C"/>
  </radialGradient>

  <linearGradient id="atg-inox" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#C9CFD4"/><stop offset="38%" stop-color="#9BA4AB"/>
    <stop offset="62%" stop-color="#B8C0C6"/><stop offset="100%" stop-color="#848D94"/>
  </linearGradient>
  <linearGradient id="atg-inox-dark" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#6E767D"/><stop offset="100%" stop-color="#3E464C"/>
  </linearGradient>`;
}

/* ----------------------------------------------------------------- filtres */

function filters() {
  return `
  <filter id="atf-crust" x="-12%" y="-12%" width="124%" height="124%">
    <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="4" seed="17" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="atf-sauce" x="-12%" y="-12%" width="124%" height="124%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="41" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="13" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <!-- « Gooey » : flou puis seuil d'alpha. Les taches de mozzarella fusionnent
       en une nappe continue au lieu de rester un patchwork d'ellipses. Seuil
       serré (26 / -11) pour garder un bord net : trop mou, ça fait de la purée. -->
  <filter id="atf-melt" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="7.5" result="b"/>
    <feColorMatrix in="b" mode="matrix"
      values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="goo"/>
    <feGaussianBlur in="goo" stdDeviation="0.8"/>
  </filter>
  <filter id="atf-piece" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="1.5" dy="3" stdDeviation="2.4" flood-color="#3A2208" flood-opacity="0.42"/>
  </filter>
  <filter id="atf-grain" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="5" result="n"/>
    <feColorMatrix in="n" type="saturate" values="0" result="g"/>
    <feComponentTransfer in="g">
      <feFuncA type="linear" slope="0.5" intercept="0"/>
    </feComponentTransfer>
  </filter>
  <!-- Contenu d'un bac : ombre plus courte et plus dure que sur la pizza —
       les morceaux sont tassés les uns contre les autres, pas posés à plat. -->
  <filter id="atf-heap" x="-25%" y="-25%" width="150%" height="150%">
    <feDropShadow dx="1" dy="2" stdDeviation="1.6" flood-color="#0B0F12" flood-opacity="0.55"/>
  </filter>

  <!-- Inox brossé : un bruit très étiré horizontalement donne le grain
       anisotrope du métal poli. Appliqué en surimpression, jamais seul. -->
  <filter id="atf-brushed" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 2.4" numOctaves="4" seed="21" result="n"/>
    <feColorMatrix in="n" type="saturate" values="0" result="g"/>
    <feComponentTransfer in="g">
      <feFuncA type="linear" slope="0.6" intercept="0"/>
    </feComponentTransfer>
  </filter>

  <!-- Rayures d'usage : même principe, fréquence plus basse, traits plus longs. -->
  <filter id="atf-scratches" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.0012 0.9" numOctaves="2" seed="9" result="n"/>
    <feColorMatrix in="n" type="saturate" values="0" result="g"/>
    <feComponentTransfer in="g">
      <feFuncA type="discrete" tableValues="0 0 0 0 0 0 0.35 0 0 0.6 0 0 0 0.25 0"/>
    </feComponentTransfer>
  </filter>

  <filter id="atf-soft" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="7"/>
  </filter>

  <filter id="atf-tool" x="-25%" y="-25%" width="150%" height="150%">
    <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#10151A" flood-opacity="0.45"/>
  </filter>`;
}

/* ------------------------------------------------------------- ingrédients */

function shapes() {
  return [
    /* ---- viandes ------------------------------------------------------- */
    shape('atl-chorizo', `
      <circle r="26" fill="url(#atg-chorizo)"/>
      ${speckles('chorizo-fat', 16, 20, 20, 1.5, 3.2, '#F6E6D4', 0.82)}
      ${speckles('chorizo-pep', 7, 19, 19, 0.7, 1.2, '#4A1208', 0.7)}
      <path d="M-26,0 A26,26 0 0 1 4,-25.7" fill="none" stroke="#6B1708" stroke-width="2.4" opacity="0.5"/>
      <ellipse cx="-7" cy="-9" rx="10" ry="6.5" fill="#FFF" opacity="0.1"/>
      <circle r="26" fill="none" stroke="#6E1C0E" stroke-width="1.5" opacity="0.8"/>`),

    shape('atl-mortadelle', `
      <circle r="29" fill="url(#atg-mortadelle)"/>
      <ellipse cx="-9" cy="-6" rx="6" ry="5" fill="#FDF6EE" opacity="0.95"/>
      <ellipse cx="9" cy="5" rx="5.2" ry="4.4" fill="#FDF6EE" opacity="0.95"/>
      <ellipse cx="4" cy="-13" rx="4" ry="3.4" fill="#FDF6EE" opacity="0.9"/>
      <ellipse cx="-13" cy="10" rx="4.4" ry="3.6" fill="#FDF6EE" opacity="0.9"/>
      <ellipse cx="14" cy="-12" rx="3.2" ry="2.8" fill="#FDF6EE" opacity="0.85"/>
      ${speckles('morta-pep', 9, 22, 22, 0.6, 1.1, '#54392E', 0.65)}
      <ellipse cx="-8" cy="-10" rx="11" ry="7" fill="#FFF" opacity="0.14"/>
      <circle r="29" fill="none" stroke="#CE8A84" stroke-width="1.4"/>`),

    shape('atl-merguez', `
      <ellipse rx="24" ry="17" fill="url(#atg-merguez)"/>
      ${speckles('merg-a', 13, 18, 12, 1, 2.2, '#D97048', 0.6)}
      ${speckles('merg-b', 9, 17, 11, 0.8, 1.6, '#55180C', 0.6)}
      <ellipse rx="19.5" ry="12.5" fill="none" stroke="#631A0C" stroke-width="1.1" opacity="0.45"/>
      <ellipse cx="-6" cy="-6" rx="9" ry="5" fill="#FFF" opacity="0.12"/>
      <ellipse rx="24" ry="17" fill="none" stroke="#7E2B16" stroke-width="1.8" opacity="0.85"/>`),

    shape('atl-jambon', `
      <path d="M-46,-5 C-30,-9 -12,-2 4,-7 C20,-12 34,-6 46,-9 L46,0 C34,3 20,-3 4,2
               C-12,7 -30,0 -46,4 Z" fill="url(#atg-jambon)"/>
      <path d="M-42,-3 C-26,-6 -10,0 6,-5 C22,-9 34,-4 44,-6"
            fill="none" stroke="#D88B84" stroke-width="1.2" opacity="0.6"/>
      <path d="M-40,1 C-24,-2 -8,4 8,-1 C24,-5 34,0 42,-2"
            fill="none" stroke="#FFF" stroke-width="1" opacity="0.3"/>`),

    shape('atl-lardon', `
      <rect x="-13" y="-6.5" width="26" height="13" rx="4.5" fill="url(#atg-lardon)"/>
      <rect x="-12" y="-2.6" width="24" height="4.6" rx="2.3" fill="#FCEDE2" opacity="0.92"/>
      <rect x="-12" y="3.4" width="24" height="2.4" rx="1.2" fill="#B35E4E" opacity="0.55"/>
      <rect x="-9" y="-5.4" width="12" height="2" rx="1" fill="#FFF" opacity="0.28"/>`),

    shape('atl-poulet-a', `
      <path d="M-17,-2 C-16,-11 -7,-14 2,-12 C12,-10 18,-4 16,5 C14,13 3,15 -5,13 C-13,11 -18,6 -17,-2 Z"
            fill="url(#atg-poulet)"/>
      <path d="M-11,-7 C-5,-1 3,2 13,1" fill="none" stroke="#AC7C3E" stroke-width="2.2" opacity="0.5" stroke-linecap="round"/>
      <path d="M-12,2 C-6,7 2,10 11,8" fill="none" stroke="#AC7C3E" stroke-width="1.8" opacity="0.4" stroke-linecap="round"/>
      <ellipse cx="-6" cy="-7" rx="8" ry="4" fill="#FFF" opacity="0.22" transform="rotate(-12)"/>`),

    shape('atl-poulet-b', `
      <path d="M-14,2 C-17,-7 -9,-13 0,-13 C11,-13 17,-6 15,3 C13,11 2,14 -5,12 C-11,10 -13,7 -14,2 Z"
            fill="url(#atg-poulet)" transform="rotate(24)"/>
      <path d="M-9,-5 C-2,0 5,2 12,0" fill="none" stroke="#AC7C3E" stroke-width="2" opacity="0.45" stroke-linecap="round" transform="rotate(24)"/>
      <ellipse cx="-4" cy="-6" rx="7" ry="3.4" fill="#FFF" opacity="0.2"/>`),

    shape('atl-kebab-a', `
      <path d="M-21,3 C-14,-6 -6,6 2,-2 C10,-10 16,4 21,-4 L20,5 C14,12 7,2 0,8 C-7,13 -14,4 -20,9 Z"
            fill="url(#atg-kebab)"/>
      <path d="M-19,4 C-12,-4 -5,7 3,-1 C11,-8 16,5 20,-2" fill="none" stroke="#6F3F14" stroke-width="1.1" opacity="0.55"/>
      <path d="M-16,1 C-10,-4 -4,4 3,-3" fill="none" stroke="#F0C98E" stroke-width="1" opacity="0.4"/>`),

    shape('atl-kebab-b', `
      <path d="M-19,-3 C-12,4 -4,-7 4,1 C11,8 16,-4 19,4 L17,10 C12,4 6,13 -1,7 C-8,1 -14,9 -18,4 Z"
            fill="url(#atg-kebab)"/>
      <path d="M-17,-2 C-10,4 -3,-6 5,2 C12,9 15,-2 18,5" fill="none" stroke="#6F3F14" stroke-width="1.1" opacity="0.5"/>`),

    shape('atl-hachee-a', `
      <g fill="url(#atg-hachee)">
        <path d="M-14,-5 C-12,-11 -5,-12 -1,-8 C3,-4 1,3 -4,4 C-10,5 -15,1 -14,-5 Z"/>
        <path d="M2,-10 C7,-13 13,-9 13,-4 C13,1 7,3 3,0 C-1,-3 -2,-8 2,-10 Z"/>
        <path d="M-7,5 C-3,3 3,5 4,9 C5,13 0,15 -5,13 C-9,11 -10,7 -7,5 Z"/>
        <path d="M7,4 C11,3 15,6 14,10 C13,13 8,13 6,10 C4,7 4,5 7,4 Z"/>
      </g>
      <circle cx="-9" cy="-7" r="1.8" fill="#C08A5C" opacity="0.55"/>
      <circle cx="7" cy="-6" r="1.5" fill="#C08A5C" opacity="0.5"/>
      <circle cx="-2" cy="10" r="1.4" fill="#C08A5C" opacity="0.45"/>`),

    shape('atl-hachee-b', `
      <g fill="url(#atg-hachee)" transform="rotate(42)">
        <path d="M-13,-3 C-11,-10 -3,-11 1,-6 C4,-1 1,4 -4,5 C-9,6 -14,2 -13,-3 Z"/>
        <path d="M4,-9 C9,-12 14,-7 13,-2 C12,2 6,3 3,0 C0,-3 0,-7 4,-9 Z"/>
        <path d="M-5,6 C-1,4 5,7 5,11 C5,14 -1,15 -5,12 C-8,10 -8,7 -5,6 Z"/>
      </g>
      <circle cx="-7" cy="-5" r="1.6" fill="#C08A5C" opacity="0.5"/>
      <circle cx="5" cy="6" r="1.3" fill="#C08A5C" opacity="0.45"/>`),

    /* ---- légumes ------------------------------------------------------- */
    shape('atl-champignon-a', `
      <path d="M-16,3 C-16,-8 -9,-14 0,-14 C9,-14 16,-8 16,3 L16,6 C16,8 14.5,9.5 12.5,9.5 L5,9.5 L5,5.5
               C5,2.2 2.8,0.4 0,0.4 C-2.8,0.4 -5,2.2 -5,5.5 L-5,9.5 L-12.5,9.5 C-14.5,9.5 -16,8 -16,6 Z"
            fill="url(#atg-champignon)"/>
      <path d="M-13,2.5 L-13,6 M-8,1.6 L-8,6 M8,1.6 L8,6 M13,2.5 L13,6"
            stroke="#C2AE8E" stroke-width="1.2" opacity="0.8" stroke-linecap="round"/>
      <path d="M-14,-3 C-11,-9 -5,-11.5 0,-11.5 C6,-11.5 11,-9 14,-3"
            fill="none" stroke="#FFFBF1" stroke-width="2" opacity="0.5"/>
      <path d="M-5,5.5 C-5,2.4 -2.8,0.6 0,0.6 C2.8,0.6 5,2.4 5,5.5"
            fill="none" stroke="#D3C0A0" stroke-width="1.1" opacity="0.8"/>
      <path d="M-16,3 C-16,-8 -9,-14 0,-14 C9,-14 16,-8 16,3" fill="none" stroke="#BCA786" stroke-width="1.1" opacity="0.7"/>`),

    shape('atl-champignon-b', `
      <g transform="rotate(-28) scale(0.88)">
        <path d="M-16,3 C-16,-8 -9,-14 0,-14 C9,-14 16,-8 16,3 L16,6 C16,8 14.5,9.5 12.5,9.5 L5,9.5 L5,5.5
                 C5,2.2 2.8,0.4 0,0.4 C-2.8,0.4 -5,2.2 -5,5.5 L-5,9.5 L-12.5,9.5 C-14.5,9.5 -16,8 -16,6 Z"
              fill="url(#atg-champignon)"/>
        <path d="M-12,2 L-12,6 M-6,1.4 L-6,6 M6,1.4 L6,6 M12,2 L12,6"
              stroke="#C2AE8E" stroke-width="1.2" opacity="0.75" stroke-linecap="round"/>
        <path d="M-14,-3 C-11,-9 -5,-11.5 0,-11.5 C6,-11.5 11,-9 14,-3" fill="none" stroke="#FFFBF1" stroke-width="2" opacity="0.45"/>
      </g>`),

    shape('atl-artichaut', `
      <path d="M0,-15 C10,-13 17,-3 15,9 C9,15 -9,15 -15,9 C-17,-3 -10,-13 0,-15 Z"
            fill="url(#atg-artichaut)"/>
      <path d="M0,-14 L0,13" stroke="#7B8F57" stroke-width="1.3" opacity="0.65"/>
      <path d="M-11,-7 C-6,-1 -4,6 -5,12" fill="none" stroke="#7B8F57" stroke-width="1.2" opacity="0.6"/>
      <path d="M11,-7 C6,-1 4,6 5,12" fill="none" stroke="#7B8F57" stroke-width="1.2" opacity="0.6"/>
      <path d="M-15,2 C-8,4 8,4 15,2" fill="none" stroke="#7B8F57" stroke-width="1" opacity="0.45"/>
      <path d="M0,-15 C8,-13 13,-7 14,-1 C8,-4 -8,-4 -14,-1 C-13,-7 -8,-13 0,-15 Z" fill="#E3EDC8" opacity="0.4"/>`),

    shape('atl-poivron-rouge', `
      <path d="M-18,7 C-13,-8 13,-8 18,7 L11.5,9 C8,-0.5 -8,-0.5 -11.5,9 Z" fill="url(#atg-poivron-r)"/>
      <path d="M-15.5,5 C-11,-5 11,-5 15.5,5" fill="none" stroke="#FF9480" stroke-width="1.7" opacity="0.5" stroke-linecap="round"/>
      <path d="M-18,7 C-13,-8 13,-8 18,7" fill="none" stroke="#7C1608" stroke-width="1" opacity="0.5"/>`),

    shape('atl-poivron-vert', `
      <path d="M-18,7 C-13,-8 13,-8 18,7 L11.5,9 C8,-0.5 -8,-0.5 -11.5,9 Z" fill="url(#atg-poivron-v)"/>
      <path d="M-15.5,5 C-11,-5 11,-5 15.5,5" fill="none" stroke="#A8DC8C" stroke-width="1.7" opacity="0.45" stroke-linecap="round"/>
      <path d="M-18,7 C-13,-8 13,-8 18,7" fill="none" stroke="#224B18" stroke-width="1" opacity="0.5"/>`),

    shape('atl-oignon', `
      <path d="M-20,5 C-15,-9 15,-9 20,5 L15.5,7 C11,-3 -11,-3 -15.5,7 Z" fill="url(#atg-oignon)" opacity="0.96"/>
      <path d="M-17.5,3.4 C-13,-5.4 13,-5.4 17.5,3.4" fill="none" stroke="#C7B3C4" stroke-width="0.9" opacity="0.8"/>
      <path d="M-20,5 C-15,-9 15,-9 20,5" fill="none" stroke="#B9A4B6" stroke-width="0.9" opacity="0.7"/>
      <path d="M-12,-2 C-6,-6 6,-6 12,-2" fill="none" stroke="#FFF" stroke-width="1.4" opacity="0.6"/>`),

    shape('atl-capre', `
      <circle r="7.6" fill="url(#atg-capre)"/>
      <path d="M-1.6,-7.4 C-1,-9.6 1.4,-9.8 2,-7.6" fill="none" stroke="#5C6B30" stroke-width="1.6" stroke-linecap="round"/>
      <ellipse cx="-2.2" cy="-2.4" rx="2.6" ry="1.8" fill="#FFF" opacity="0.38"/>
      <circle r="7.6" fill="none" stroke="#3E4A1D" stroke-width="0.7" opacity="0.7"/>`),

    shape('atl-olive', `
      <ellipse rx="15" ry="12.5" fill="url(#atg-olive)"/>
      <path d="M-11,-6 C-6,-11 7,-11 12,-4" fill="none" stroke="#9A86A2" stroke-width="2.6"
            opacity="0.35" stroke-linecap="round"/>
      <ellipse cx="-4.5" cy="-4.5" rx="4.4" ry="2.8" fill="#FFF" opacity="0.2"/>
      <ellipse cx="7" cy="3" rx="3.4" ry="2.6" fill="#140E18" opacity="0.6"/>
      <path d="M-13,3 C-8,6 6,7 13,2" fill="none" stroke="#120C17" stroke-width="1.4" opacity="0.3"/>
      <ellipse rx="15" ry="12.5" fill="none" stroke="#120C17" stroke-width="0.9" opacity="0.65"/>`),

    /* ---- fromages ------------------------------------------------------ */
    shape('atl-parmesan-a', `
      <path d="M-5,-1.4 L3.4,-2.4 L5,0.8 L-3.6,1.8 Z" fill="url(#atg-parmesan)"/>
      <path d="M-5,-1.4 L3.4,-2.4" fill="none" stroke="#FFFDF2" stroke-width="0.6" opacity="0.9"/>`),

    shape('atl-parmesan-b', `
      <path d="M-4,1 L2.4,-2.4 L4.4,-0.4 L-2,2.6 Z" fill="url(#atg-parmesan)"/>
      <circle cx="3.6" cy="1.6" r="1" fill="url(#atg-parmesan)"/>`),

    shape('atl-brie', `
      <path d="M-1.6,-13 C0.4,-14.4 2.6,-13.6 3.4,-11.6 L16,9 C17.2,11.2 15.6,13.6 13,13.6 L-13,13.6
               C-15.6,13.6 -17.2,11.2 -16,9 Z" fill="url(#atg-brie)"/>
      <path d="M-13,13.6 L13,13.6" fill="none" stroke="#FFFCF0" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M-1.6,-13 C0.4,-14.4 2.6,-13.6 3.4,-11.6 L16,9 C17.2,11.2 15.6,13.6 13,13.6 L-13,13.6
               C-15.6,13.6 -17.2,11.2 -16,9 Z" fill="none" stroke="#DFCD9A" stroke-width="1" opacity="0.8"/>
      <path d="M-9,6 C-3,3 4,3 10,6" fill="none" stroke="#E8DAAE" stroke-width="1.2" opacity="0.7"/>
      <path d="M-7,-4 C-3,-7 1,-7 4,-4" fill="none" stroke="#FFF" stroke-width="1.6" opacity="0.45"/>`),

    shape('atl-chevre', `
      <circle r="19" fill="url(#atg-chevre)"/>
      <circle r="19" fill="none" stroke="#DCD0B6" stroke-width="2.6"/>
      <circle r="13" fill="none" stroke="#EBE2CD" stroke-width="1.4" opacity="0.9"/>
      ${speckles('chevre-holes', 7, 11, 11, 0.9, 1.7, '#DED3B9', 0.75)}
      <ellipse cx="-5" cy="-6" rx="7.5" ry="5" fill="#FFF" opacity="0.4"/>
      <circle r="19" fill="none" stroke="#C9BC9F" stroke-width="0.8" opacity="0.7"/>`),

    shape('atl-bleu-a', `
      <path d="M-13,-4 C-12,-11 -4,-14 3,-12 C11,-10 15,-3 13,5 C11,12 2,15 -5,13 C-12,11 -14,3 -13,-4 Z"
            fill="url(#atg-bleu)"/>
      <path d="M-8,-6 C-4,-2 -5,4 -2,8" fill="none" stroke="#4E6377" stroke-width="1.6" opacity="0.7" stroke-linecap="round"/>
      <path d="M3,-8 C6,-3 4,3 7,7" fill="none" stroke="#4E6377" stroke-width="1.4" opacity="0.6" stroke-linecap="round"/>
      <circle cx="-2" cy="-8" r="1.5" fill="#54697D" opacity="0.7"/>
      <circle cx="8" cy="0" r="1.2" fill="#54697D" opacity="0.6"/>
      <circle cx="-9" cy="6" r="1.3" fill="#54697D" opacity="0.6"/>
      <ellipse cx="-4" cy="-6" rx="6" ry="3.6" fill="#FFF" opacity="0.35"/>`),

    shape('atl-bleu-b', `
      <g transform="rotate(118) scale(0.86)">
        <path d="M-13,-4 C-12,-11 -4,-14 3,-12 C11,-10 15,-3 13,5 C11,12 2,15 -5,13 C-12,11 -14,3 -13,-4 Z"
              fill="url(#atg-bleu)"/>
        <path d="M-7,-5 C-3,-1 -4,5 -1,9" fill="none" stroke="#4E6377" stroke-width="1.6" opacity="0.65" stroke-linecap="round"/>
        <circle cx="5" cy="-5" r="1.4" fill="#54697D" opacity="0.65"/>
        <circle cx="-8" cy="4" r="1.2" fill="#54697D" opacity="0.6"/>
      </g>`),

    shape('atl-reblochon', `
      <path d="M-14,-10 C-9,-13.4 9,-13.4 14,-10 C17,-7.6 17,8 14,10.8 C9,14 -9,14 -14,10.8
               C-17,8 -17,-7.6 -14,-10 Z" fill="url(#atg-reblochon)"/>
      <path d="M-14,-10 C-9,-13.4 9,-13.4 14,-10 C15.6,-8.6 16.4,-5.6 16.6,-2 C9,-4.6 -9,-4.6 -16.6,-2
               C-16.4,-5.6 -15.6,-8.6 -14,-10 Z" fill="#DB9A4E" opacity="0.88"/>
      <path d="M-13,4 C-6,1.6 6,1.6 13,4" fill="none" stroke="#E7D5A6" stroke-width="1.4" opacity="0.75"/>
      <ellipse cx="-5" cy="2" rx="7" ry="4" fill="#FFF" opacity="0.3"/>
      <path d="M-14,-10 C-9,-13.4 9,-13.4 14,-10 C17,-7.6 17,8 14,10.8 C9,14 -9,14 -14,10.8
               C-17,8 -17,-7.6 -14,-10 Z" fill="none" stroke="#C9B183" stroke-width="0.9" opacity="0.7"/>`),

    // Fromage de base : julienne crue. Des bâtonnets longs et droits, pas du
    // râpé frisé et surtout pas une nappe fondue — la pizza n'est pas encore
    // cuite à ce stade (§39).
    shape('atl-julienne-a', `
      <rect x="-33" y="-4.8" width="66" height="9.6" rx="3.8" fill="url(#atg-julienne)"/>`),

    shape('atl-julienne-b', `
      <path d="M-31,-3.2 C-14,-6.8 10,-1 31,-4.8 L31,4.8 C10,8.4 -14,2.6 -31,6.2 Z"
            fill="url(#atg-julienne)"/>`),

    shape('atl-julienne-c', `
      <rect x="-21" y="-4.4" width="42" height="8.8" rx="3.6" fill="url(#atg-julienne)"/>`),

    /* ---- ustensiles ---------------------------------------------------- */
    // Louche : manche + cuillère vues de trois-quarts. Le contenu (#atl-ladle-fill)
    // est un calque séparé pour qu'on puisse le faire apparaître au puisage.
    shape('atl-ladle', `
      <path d="M6,-52 L6,-14 C6,-10 10,-8 14,-8" fill="none" stroke="url(#atg-inox-dark)"
            stroke-width="7" stroke-linecap="round"/>
      <path d="M6,-52 L6,-40" fill="none" stroke="#2A3035" stroke-width="9" stroke-linecap="round"/>
      <ellipse cx="0" cy="0" rx="26" ry="20" fill="url(#atg-inox)"/>
      <ellipse cx="0" cy="0" rx="26" ry="20" fill="none" stroke="#6B747B" stroke-width="2.2"/>
      <ellipse cx="0" cy="-1.5" rx="21" ry="15.5" fill="#7E878E"/>
      <path d="M-18,-6 C-12,-13 10,-14 17,-7" fill="none" stroke="#FFF" stroke-width="2.4" opacity="0.45" stroke-linecap="round"/>`),

    shape('atl-ladle-fill', `
      <ellipse cx="0" cy="-1" rx="20" ry="14.5" fill="currentColor"/>
      <ellipse cx="-5" cy="-5" rx="8" ry="4" fill="#FFF" opacity="0.22"/>`),

    // Râpe à fromage, pour le parmesan.
    shape('atl-grater', `
      <rect x="-20" y="-56" width="40" height="18" rx="7" fill="#2A3035"/>
      <rect x="-15" y="-52" width="30" height="4" rx="2" fill="#FFF" opacity="0.18"/>
      <path d="M-22,-40 L22,-40 L26,34 L-26,34 Z" fill="url(#atg-inox)"/>
      <path d="M-22,-40 L22,-40 L26,34 L-26,34 Z" fill="none" stroke="#6B747B" stroke-width="2"/>
      <g fill="#5E676E" opacity="0.9">
        ${graterHoles()}
      </g>
      <path d="M-20,-36 L-16,30" fill="none" stroke="#FFF" stroke-width="2.6" opacity="0.3"/>`)
  ].join('\n');
}

function graterHoles() {
  let out = '';
  for (let row = 0; row < 8; row += 1) {
    const y = -32 + row * 8.6;
    const halfWidth = 18 + row * 0.9;
    const cols = 5;
    for (let col = 0; col < cols; col += 1) {
      const x = -halfWidth + ((col + (row % 2 ? 0.5 : 0)) * (halfWidth * 2)) / (cols - 0.5);
      out += `<path d="M${f(x)},${f(y)} l4.2,0 l-2.1,3.4 Z"/>`;
    }
  }
  return out;
}

function shape(id, body) {
  return `<g id="${id}">${body}</g>`;
}

/* ------------------------------------------------- bacs (vue en plongée) */

/**
 * Géométrie d'un bac gastronorme, repère 240 × 180.
 *
 * Trois anneaux concentriques : le bord roulé, la paroi, puis le fond. C'est
 * cette superposition qui donne la profondeur — un simple rectangle inséré
 * dans un autre lit comme une étiquette, pas comme un récipient.
 */
export const PAN = {
  box: { w: 240, h: 180 },
  outer: { x: 7, y: 11, w: 226, h: 158, r: 16 },
  cavity: { x: 22, y: 26, w: 196, h: 128, r: 11 },
  floor: { x: 31, y: 35, w: 178, h: 110, r: 8 }
};

export function panRect(part, attrs = '') {
  const r = PAN[part];
  return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.r}" ${attrs}/>`;
}

/**
 * Remplissage d'un bac.
 *
 * Un bac de service n'est pas un étalage régulier : le contenu est entassé,
 * plus haut au milieu, les morceaux se chevauchent et retombent vers les
 * parois. On reproduit ce tas en trois temps — densité biaisée vers le centre,
 * morceaux un peu plus gros au sommet du tas (ils sont plus près de
 * l'objectif), et tri par profondeur pour que l'empilement soit cohérent.
 * Déterministe : un bac donné a toujours exactement le même aspect.
 */
export function trayFill(ingredient) {
  const art = ingredient.art || {};
  if (art.tray === 'pool') return saucePool(ingredient);

  const shapesList = art.shapes || [];
  if (!shapesList.length) return '';

  const count = Math.round((art.trayCount || 7) * 2.7);
  const scale = art.trayScale || 0.5;
  const rng = createRng('tray-' + ingredient.id);
  const cx = PAN.floor.x + PAN.floor.w / 2;
  const cy = PAN.floor.y + PAN.floor.h / 2;
  const spreadX = PAN.floor.w / 2 - 6;
  const spreadY = PAN.floor.h / 2 - 6;

  const pieces = [];
  for (let i = 0; i < count; i += 1) {
    // Deux tirages moyennés : concentre naturellement vers le centre du bac
    // sans laisser les bords vides.
    const ux = (rng() + rng() + rng()) / 3;
    const uy = (rng() + rng() + rng()) / 3;
    const x = cx + (ux * 2 - 1) * spreadX * 1.1;
    const y = cy + (uy * 2 - 1) * spreadY * 1.1;
    if (Math.abs(x - cx) > spreadX || Math.abs(y - cy) > spreadY) continue;
    // Hauteur du tas : maximale au centre, nulle contre les parois.
    const heap =
      1 - Math.min(1, Math.hypot((x - cx) / spreadX, (y - cy) / spreadY));
    pieces.push({
      x,
      y,
      heap,
      id: shapesList[intRange(rng, 0, shapesList.length - 1)],
      rot: range(rng, -180, 180),
      s: scale * range(rng, 0.86, 1.1) * (0.92 + heap * 0.22)
    });
  }

  // Les morceaux du bas du cadre passent devant : lecture en profondeur.
  pieces.sort((a, b) => a.y - b.y);

  const body = pieces
    .map(
      (p) =>
        `<use href="#${p.id}" transform="translate(${f(p.x)},${f(p.y)}) rotate(${f(p.rot)}) scale(${f(p.s)})"/>`
    )
    .join('');

  return `
    <g filter="url(#atf-heap)">${body}</g>
    ${panShading()}`;
}

/** Sauce : une nappe, avec ménisque contre la paroi et reflet de la lampe. */
function saucePool(ingredient) {
  const grad = ingredient.sauce ? ingredient.sauce.pool : 'atg-pool-tomate';
  const ink = ingredient.sauce ? ingredient.sauce.ink : '#9E2214';
  const rng = createRng('pool-' + ingredient.id);
  let ripples = '';
  for (let i = 0; i < 5; i += 1) {
    const y = 48 + i * 19 + range(rng, -5, 5);
    ripples += `<path d="M38,${f(y)} C${f(range(rng, 70, 95))},${f(y - range(rng, 4, 10))} ${f(range(rng, 140, 170))},${f(y + range(rng, 3, 9))} 202,${f(y - range(rng, 0, 6))}"
      fill="none" stroke="${ink}" stroke-opacity="${f(range(rng, 0.1, 0.22))}" stroke-width="${f(range(rng, 3, 7))}" stroke-linecap="round"/>`;
  }
  return `
    ${panRect('cavity', `fill="url(#${grad})"`)}
    ${ripples}
    <ellipse cx="86" cy="56" rx="42" ry="15" fill="#FFF" opacity="0.17"/>
    <ellipse cx="78" cy="52" rx="22" ry="7" fill="#FFF" opacity="0.2"/>
    <ellipse cx="156" cy="112" rx="24" ry="9" fill="#FFF" opacity="0.08"/>
    ${panRect('cavity', 'fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="7"')}
    ${panShading()}`;
}

/**
 * Occlusion du contenu contre les parois. La lumière vient du haut-gauche :
 * l'intérieur du bac est donc le plus sombre en haut à gauche, où la paroi
 * proche projette son ombre.
 */
function panShading() {
  return `
    ${panRect('cavity', 'fill="url(#atg-pan-occlusion)" style="mix-blend-mode:multiply"')}
    ${panRect('cavity', 'fill="url(#atg-pan-lift)" style="mix-blend-mode:screen"')}`;
}

/* ---------------------------------------------------------------- montage */

/**
 * La planche complète, sous forme de chaîne. Utilisée par le montage dans le
 * document, et par l'export d'un aperçu autonome (voir renderStaticSvg).
 */
export function spriteMarkup() {
  return `<defs>${gradients()}${filters()}${shapes()}</defs>`;
}

/** Injecte (une seule fois) la planche de formes dans le document. */
export function mountSprite() {
  if (document.getElementById(SPRITE_ID)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', SPRITE_ID);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  // Formes placées dans <defs> : rien ne s'affiche tant qu'on ne les
  // réutilise pas via <use>, et les dégradés/filtres restent résolvables
  // depuis n'importe quel autre <svg> du document (patron « sprite »).
  svg.innerHTML = `<defs>${gradients()}${filters()}${shapes()}</defs>`;
  document.body.appendChild(svg);
}
