// Serveur de développement local : site statique + API JavaScript sur une base Postgres EN MÉMOIRE (PGlite).
// Les données disparaissent à l'arrêt. Jamais relié à Supabase. Usage : node serveur/outils/dev.mjs  (PORT=8095 par défaut)
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { creerPiloteTest } from './pglite-driver.mjs';
import { servirStatique } from './statique.mjs';
import { utiliserPilote } from '../db.js';
import { traiter } from '../router.js';
import { schemaSql } from '../schema.js';

const PORT = Number(process.env.PORT || 8095);

// Code patron de démonstration, propre à cette exécution (affiché une fois, jamais écrit dans un fichier).
const CODE = process.env.DEV_OWNER_CODE || 'demo-' + crypto.randomBytes(4).toString('hex');
process.env.OWNER_CODE_HASH = bcrypt.hashSync(CODE, 4);
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
});
