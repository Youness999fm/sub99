// Charges d'attaque de la batterie 09 (valeurs fabriquées pour les tests, aucune donnée réelle) et oracles de normalisation.
// Les oracles reproduisent les règles DOCUMENTÉES du produit (espaces réduits, caractères de format retirés des noms, etc.) :
// ils ne sont pas importés du produit, pour que le test reste indépendant du code vérifié.

export const nbCar = (s) => Array.from(String(s)).length;
// UTF-8 ne peut pas porter un substitut UTF-16 isolé : il devient U+FFFD (toWellFormed) à l'arrivée sur le serveur.
const bienForme = (s) => String(s).toWellFormed();
/** Prénom / nom : caractères de format retirés, contrôle -> espace, espaces réduits et coupés. */
export const nettoyerNom = (s) => bienForme(s).replace(/\p{Cf}+/gu, '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/gu, ' ').trim();
/** Rue : espaces réduits et coupés. */
export const nettoyerRue = (s) => bienForme(s).replace(/\s+/gu, ' ').trim();
/** Remarque : espace, tabulation, saut de ligne, retour chariot, NUL, tabulation verticale retirés aux extrémités (trim PHP). */
export const nettoyerNote = (s) => bienForme(s).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
/** trim() de JavaScript (celui de l'interface de la tablette). */
export const trimJs = (s) => String(s).trim();

/** Chaînes d'injection SQL classiques (tailles <= 60 caractères : elles tiennent dans un prénom). */
export const SQLI = [
  "'; DROP TABLE orders;--",
  "\\' OR 1=1--",
  "' OR 1=1--",
  "' OR '1'='1",
  "' UNION SELECT * FROM customers--",
  "' UNION SELECT password_hash,2,3,4 FROM customers--",
  '%',
  '_',
  '\\',
  "%' OR '%'='",
  '"; DROP TABLE customers; --',
  "'||(SELECT password_hash FROM customers LIMIT 1)||'",
  '$$; DROP TABLE sessions; $$',
  "')); DELETE FROM orders; --",
  "' OR 1=1 LIMIT 1 OFFSET 1 --",
  "Robert'); DROP TABLE students;--",
  "'; UPDATE customers SET email='pwn@evil.test' WHERE 1=1;--",
  '/*!50000 UNION*/ SELECT 1',
  '\\x27 OR 1=1',
  '1) OR (1=1',
  "x' AND SLEEP(5)--",
  '$1',
  'E\'\\\\\'; DROP TABLE orders;--'
];

/** Injection temporelle : si le paramètre était interprété comme du SQL, la réponse mettrait plus de 6 secondes. */
export const SQLI_TEMPS = ["'; SELECT pg_sleep(6);--", '1) OR pg_sleep(6) IS NULL --', "' || pg_sleep(6) || '"];

/** E-mails valides pour le serveur (caractères permis) mais piégés pour du SQL ou du HTML. */
export const EMAILS_PIEGES = [
  "o'brien@example.test",
  "a'or'1'='1@example.test",
  'x%@example.test',
  '_x@example.test',
  'a_b%c@example.test',
  "x'--y@example.test",
  "a'||'b@example.test",
  "x'/**/or/**/1=1--@example.test",
  'x$1@example.test',
  "x'onmouseover='window.__pwn=1@example.test",
  "x'/onfocus='window.__pwn=1'/autofocus='@example.test",
  'x`onmouseover=`window.__pwn=1@example.test',
  'a&ltb@example.test',
  '&#60img@example.test'
];

/**
 * Clients d'attaque XSS : prénom et nom (<= 60 caractères), rue (<= 150), remarque (<= 300).
 * Chaque charge tente d'exécuter window.__pwn=1 si elle est un jour interprétée comme du HTML ou du script.
 */
export const XSS_CLIENTS = [
  { id: 'img', prenom: '<img src=x onerror="window.__pwn=1">', nom: '"><svg onload=window.__pwn=1>', rue: '"><img src=x onerror=window.__pwn=1> 12 rue X', note: '<script>window.__pwn=1</script>' },
  { id: 'script', prenom: '<script>window.__pwn=1</script>', nom: '&lt;b&gt;gras&lt;/b&gt; &amp; &quot;', rue: '<script>window.__pwn=1</script>', note: '"><svg onload=window.__pwn=1>' },
  { id: 'svg', prenom: '"><svg onload=window.__pwn=1>', nom: "'><img src=x onerror=window.__pwn=1>", rue: "'><svg onload=window.__pwn=1>", note: '<img src=x onerror="window.__pwn=1">' },
  { id: 'js', prenom: 'javascript:window.__pwn=1', nom: 'javascript:alert(document.cookie)//', rue: 'javascript:window.__pwn=1', note: 'javascript:window.__pwn=1' },
  { id: 'entites', prenom: '&lt;', nom: '&amp;lt;', rue: '&lt;script&gt;window.__pwn=1&lt;/script&gt; &#60;b&#62;', note: '&lt;img src=x onerror=window.__pwn=1&gt; &amp;amp; &#x3C;' },
  { id: 'iframe', prenom: `'><iframe srcdoc="<script>parent.__pwn=1</script>">`, nom: '<iframe src="javascript:parent.__pwn=1">', rue: '<iframe srcdoc="<script>parent.__pwn=1</script>">', note: '<object data="javascript:window.__pwn=1"></object>' },
  { id: 'details', prenom: '<details open ontoggle=window.__pwn=1>', nom: '<body onload=window.__pwn=1>', rue: '<details open ontoggle=window.__pwn=1>x', note: '<input autofocus onfocus=window.__pwn=1>' },
  { id: 'attribut', prenom: '" onmouseover="window.__pwn=1" x="', nom: "' onfocus='window.__pwn=1' autofocus='", rue: '" autofocus onfocus="window.__pwn=1', note: "' onclick='window.__pwn=1' a='" },
  { id: 'gabarit', prenom: '${window.__pwn=1}', nom: '{{constructor.constructor("window.__pwn=1")()}}', rue: '`${window.__pwn=1}` #{window.__pwn=1}', note: '#{window.__pwn=1} <%= window.__pwn=1 %> {{7*7}}' },
  { id: 'fermeture', prenom: '</span></strong><img src=x onerror=window.__pwn=1>', nom: '</li></ul></div><script>window.__pwn=1</script>', rue: '</small></span></button><img src=x onerror=window.__pwn=1>', note: '</textarea></dialog></div><img src=x onerror=window.__pwn=1>' },
  { id: 'mxss', prenom: '<svg></p><style><a id="</style><img src=1', nom: 'onerror=window.__pwn=1>">', rue: '<svg></p><style><a id="</style><img src=1 onerror=window.__pwn=1>">', note: '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=window.__pwn=1&gt;">' },
  { id: 'style', prenom: '<style>*{display:none!important}</style>', nom: '<link rel=stylesheet href=//evil.example/x.css>', rue: '<meta http-equiv=refresh content="0;url=javascript:window.__pwn=1">', note: '<base href="//evil.example/"><img src=//evil.example/p.png>' },
  { id: 'ancre', prenom: '<a href="javascript:window.__pwn=1">clic</a>', nom: '<a href=//evil.example/>x</a>', rue: '<a href="javascript:window.__pwn=1">x</a>', note: '<a href="javascript:window.__pwn=1">x</a> <form action="//evil.example/"><button>ok</button></form>' }
];

for (const c of XSS_CLIENTS) {
  for (const [champ, max] of [['prenom', 60], ['nom', 60], ['rue', 150], ['note', 300]]) {
    if (nbCar(c[champ]) > max) throw new Error(`Charge XSS « ${c.id} » : ${champ} trop long (${nbCar(c[champ])} > ${max})`);
  }
}

/** Textes Unicode légitimes ou inhabituels : emoji, droite à gauche, caractères combinants, astraux. */
export const TEXTES_UNICODE = [
  'Zoé 🍕🔥', "D'Artagnan", 'Müller-Łukasz', '王小明', 'عمر', 'שלום', '𝒳𝒴𝒵', 'Åsa', 'été', 'Ça va ?',
  '\u202eelcaro', 'a\u200bb', 'a\u200eb\u200fc', '\u2066x\u2069', '  a   b  ', 'a\tb', 'a\nb', 'a\u0007b', 'a\u00a0b', 'a\u2028b',
  '\u202e\u200b', '\ufeffx', 'x\ud83dy' // la dernière : substitut isolé (UTF-16 invalide)
];

/** Corps JSON de taille exacte (octets) : { ...base, pad: 'ppp…' }. */
export function jsonDeTaille(octets, base = {}) {
  const vide = JSON.stringify({ ...base, pad: '' });
  const n = octets - Buffer.byteLength(vide);
  if (n < 0) throw new Error('Corps de base trop grand pour ' + octets + ' octets');
  return JSON.stringify({ ...base, pad: 'p'.repeat(n) });
}

/** Objet JSON dont le champ d contient n tableaux imbriqués (construit par texte : pas de récursion). */
export const profond = (n, base = '') => '{' + base + '"d":' + '['.repeat(n) + ']'.repeat(n) + '}';
/** Idem avec des objets imbriqués : { "d": { "a": { "a": … } } }. */
export const profondObjets = (n, base = '') => '{' + base + '"d":' + '{"a":'.repeat(n) + '1' + '}'.repeat(n) + '}';

export const JSON_INVALIDES = [
  '{', '}', '{"a":', '{"a":1,}', "{'a':1}", '{a:1}', '{"a":undefined}', '{"a":NaN}', '{"a":Infinity}', '{"a":1}}', '{"a":1} x',
  '{"a":"\\x"}', '{"a":"\\u12"}', '\ufeff{}', '{"a":01}', '{"a":.5}', '{"a":0x10}', '{"":}', '{"a" 1}', '{"a":1 "b":2}',
  '{"a":[1,2}', '{"a":"non terminé}', '{,}', '{"a":1;}', '{"a":"\u0001"}', '{"a":"\u0000"}', "{\"a\":'x'}", '/*c*/{}', '{"a":1}//c',
  '{"__proto__":}', '{"a":True}', '{"a":nul}', '{"a":[,]}', '{"a":"\\uD800\\u"}'
];

export const CORPS_VIDES = ['', ' ', '\n', '\t\t\r\n', '\u00a0', '   \n   '];

export const JSON_NON_OBJETS = ['[]', '[1,2,3]', '[{}]', '[[]]', 'null', 'true', 'false', '0', '-1', '1e999', '"abc"', '""', '"{}"', '12345678901234567890', '[{"a":1}]'];

export const TYPES_MIME_REFUSES = [
  null, 'text/plain', 'text/plain; charset=utf-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/xml',
  'text/json', 'application/jsonx', 'application/json-patch+json', 'application/vnd.api+json', 'text/html', '', 'json', 'application/', '*/*',
  'application/json, text/plain'
];
export const TYPES_MIME_ACCEPTES = ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON', 'application/json ;charset=utf-8', 'application/json;', 'application/json;charset=latin1'];

export const CORPS_POLLUTION = [
  '{"__proto__":{"polluted":"oui"}}',
  '{"constructor":{"prototype":{"polluted":"oui"}}}',
  '{"a":{"__proto__":{"polluted":"oui"}}}',
  '{"__proto__":[]}',
  '{"toString":1,"valueOf":2,"hasOwnProperty":3,"constructor":4}'
];

export const ORIGINES_FAUSSES = (origine) => ['null', 'https://evil.example', 'http://localhost:1', origine + '.evil.example', origine + '/', origine.toUpperCase(), '', ' ', 'null null', 'file://', 'chrome-extension://abcdef'];
