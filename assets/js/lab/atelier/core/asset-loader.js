/**
 * Chargement et contrôle des ressources photographiques.
 *
 * Trois responsabilités :
 *   1. charger une image et dire honnêtement si elle manque ;
 *   2. vérifier qu'elle respecte le contrat du manifeste (dimensions, alpha) ;
 *   3. découper les planches 4×3 en morceaux individuels réutilisables.
 *
 * Règle de conduite : quand un fichier manque, on le DIT. On ne substitue
 * jamais un dessin qui prétendrait au photoréalisme — c'est exactement ce que
 * le cahier des charges interdit (§04, §69).
 */

const cache = new Map();

/* ------------------------------------------------------------ chargement */

/**
 * @returns {Promise<{ok:boolean, image:HTMLImageElement|null, error:string|null,
 *                     width:number, height:number}>}
 */
export function loadImage(url) {
  if (cache.has(url)) return cache.get(url);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () =>
      resolve({ ok: true, image: img, error: null, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () =>
      resolve({ ok: false, image: null, error: 'introuvable', width: 0, height: 0 });
    img.src = url;
  });

  cache.set(url, promise);
  return promise;
}

/* --------------------------------------------------------------- contrôle */

/**
 * Vérifie une entrée du manifeste et renvoie un diagnostic lisible.
 * Les écarts ne bloquent pas le chargement : ils sont remontés pour que la
 * page de contrôle puisse les afficher.
 */
export async function checkAsset(asset, base = '') {
  const url = base + asset.path;
  const result = await loadImage(url);
  const issues = [];

  if (!result.ok) {
    return { asset, url, ok: false, missing: true, issues: ['fichier absent'], result };
  }

  const expect = asset.expect || {};
  if (expect.w && result.width !== expect.w) {
    issues.push(`largeur ${result.width}px au lieu de ${expect.w}px`);
  }
  if (expect.h && result.height !== expect.h) {
    issues.push(`hauteur ${result.height}px au lieu de ${expect.h}px`);
  }
  if (expect.minW && result.width < expect.minW) {
    issues.push(`largeur ${result.width}px, minimum ${expect.minW}px`);
  }
  if (expect.minH && result.height < expect.minH) {
    issues.push(`hauteur ${result.height}px, minimum ${expect.minH}px`);
  }
  if (expect.alpha === true) {
    const alpha = inspectAlpha(result.image);
    if (!alpha.hasTransparency) {
      issues.push('aucune transparence détectée — le fond n’a pas été détouré');
    } else if (alpha.fringe) {
      issues.push('liseré suspect sur les bords (pixels semi-transparents très clairs ou très sombres)');
    }
  }

  return { asset, url, ok: issues.length === 0, missing: false, issues, result };
}

/**
 * Analyse sommaire du canal alpha : y a-t-il de la transparence, et les pixels
 * semi-transparents trahissent-ils un détourage sale (halo blanc ou contour
 * noir, typiquement une erreur de prémultiplication — §48) ?
 */
function inspectAlpha(image) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, size);

  let data;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch (err) {
    // Canvas « tainted » : impossible en local, mais on ne casse pas pour ça.
    return { hasTransparency: true, fringe: false };
  }

  let transparent = 0;
  let semi = 0;
  let extreme = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 12) {
      transparent += 1;
    } else if (a < 240) {
      semi += 1;
      const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      if (luma > 242 || luma < 14) extreme += 1;
    }
  }

  const total = size * size;
  return {
    hasTransparency: transparent > total * 0.02,
    // Un détourage propre a des pixels de bord aux couleurs du sujet.
    // S'ils sont massivement blancs ou noirs, c'est un halo.
    fringe: semi > 40 && extreme / semi > 0.6
  };
}

/* ------------------------------------------------------ planches 4×3 */

/**
 * Découpe une planche en morceaux individuels, et recadre chaque morceau sur
 * son contenu réel (une cellule de 256px contenant une câpre de 40px laisserait
 * sinon une énorme marge vide qui fausserait toutes les échelles).
 *
 * @returns {Promise<Array<{canvas:HTMLCanvasElement, w:number, h:number}>>}
 */
export async function sliceSheet(asset, base = '') {
  const grid = asset.grid || { cols: 4, rows: 3, cell: 256 };
  const sheet = await loadImage(base + asset.path);

  if (sheet.ok) return cutGrid(sheet.image, grid);

  // Repli : douze fichiers séparés, si le générateur n'a pas tenu la grille.
  if (!asset.fallbackPieces) return [];
  const loaded = await Promise.all(asset.fallbackPieces.map((p) => loadImage(base + p)));
  return loaded
    .filter((r) => r.ok)
    .map((r) => {
      const canvas = document.createElement('canvas');
      canvas.width = r.width;
      canvas.height = r.height;
      canvas.getContext('2d').drawImage(r.image, 0, 0);
      return trim(canvas);
    })
    .filter(Boolean);
}

function cutGrid(image, grid) {
  // La planche peut avoir été exportée à une autre résolution que prévu :
  // on raisonne en proportions plutôt qu'en pixels absolus.
  const cellW = image.naturalWidth / grid.cols;
  const cellH = image.naturalHeight / grid.rows;
  const out = [];

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cellW);
      canvas.height = Math.round(cellH);
      canvas
        .getContext('2d')
        .drawImage(image, col * cellW, row * cellH, cellW, cellH, 0, 0, canvas.width, canvas.height);
      const trimmed = trim(canvas);
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

/** Recadre un canvas sur les pixels non transparents. */
function trim(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let data;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch (err) {
    return { canvas, w: canvas.width, h: canvas.height };
  }

  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Cellule vide : le générateur a sauté une case.
  if (maxX < 0) return null;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return { canvas: out, w, h };
}

/* --------------------------------------------------------- marque-place */

/**
 * Vignette « ASSET MANQUANT ». Volontairement laide et non alimentaire : elle
 * doit se voir immédiatement sur une capture d'écran et ne jamais être
 * confondue avec une intention graphique.
 */
export function missingPlaceholder(label) {
  const node = document.createElement('div');
  node.className = 'asset-missing';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', `Ressource manquante : ${label}`);
  node.innerHTML = `<span>ASSET<br>MANQUANT</span><small></small>`;
  node.querySelector('small').textContent = label;
  return node;
}
