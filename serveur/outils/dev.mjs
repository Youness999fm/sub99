// Serveur de développement local : site statique + API JavaScript sur une base Postgres EN MÉMOIRE (PGlite).
// Les données disparaissent à l'arrêt. Jamais relié à Supabase. Usage : node serveur/outils/dev.mjs  (PORT=8095 par défaut)
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { creerPiloteTest } from './pglite-driver.mjs';
import { servirStatique } from './statique.mjs';
import { utiliserPilote } from '../db.js';
import { traiter } from '../router.js';
import { schemaSql } from '../schema.js';

const PORT = Number(process.env.PORT || 8095);

// Code patron de TEST, valable seulement sur ce serveur local (base en mémoire, écoute sur 127.0.0.1).
// Par défaut 654321 pour tester l'espace commerçant sans rien configurer ; DEV_OWNER_CODE le remplace.
// Ce code ne sert jamais en ligne : sur Vercel, seul le hash de OWNER_CODE_HASH compte.
const CODE = process.env.DEV_OWNER_CODE || '654321';
process.env.OWNER_CODE_HASH = bcrypt.hashSync(CODE, 4);

// Code « accès supérieur » de TEST (espace patron : fiches clients, suppression de la recette).
// Par défaut 1109 ; DEV_SUPER_CODE le remplace. Même principe : seul SUPER_CODE_HASH compte en ligne.
const SUPER_CODE = process.env.DEV_SUPER_CODE || '1109';
process.env.SUPER_CODE_HASH = bcrypt.hashSync(SUPER_CODE, 4);
process.env.SUBITO_COOKIE_SECURE = '0';
process.env.APP_ORIGINS = `http://localhost:${PORT},http://127.0.0.1:${PORT}`;

const pilote = creerPiloteTest();
for (const sql of schemaSql()) await pilote.exec(sql);
utiliserPilote(pilote);

const serveur = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/')) traiter(req, res);
  else servirStatique(req, res);
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`Site local : http://localhost:${PORT}/  (base en mémoire)`);
  console.log(`Espace commerçant : http://localhost:${PORT}/commercant/  — code de démonstration : ${CODE}`);
  console.log(`Accès supérieur (espace patron) : code de démonstration : ${SUPER_CODE}`);
});
