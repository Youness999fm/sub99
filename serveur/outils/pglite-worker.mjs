// Thread qui héberge une base PGlite (vrai moteur Postgres en mémoire). Tests uniquement.
import { parentPort } from 'node:worker_threads';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

function normaliser(rows) {
  return rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'bigint' ? Number(v) : v;
    return o;
  });
}

parentPort.on('message', async (m) => {
  let res;
  try {
    if (m.exec !== undefined) {
      await db.exec(m.exec);
      res = { ok: true, rows: [], rowCount: 0 };
    } else {
      const r = await db.query(m.sql, m.params || []);
      res = { ok: true, rows: normaliser(r.rows), rowCount: r.affectedRows !== undefined ? r.affectedRows : r.rows.length };
    }
  } catch (e) {
    res = { ok: false, code: e && e.code, message: String(e && e.message) };
  }
  if (m.port) {
    // Appel synchrone : réponse sur le port, puis réveil du thread principal bloqué sur Atomics.wait.
    m.port.postMessage(res);
    const drapeau = new Int32Array(m.sab);
    Atomics.store(drapeau, 0, 1);
    Atomics.notify(drapeau, 0);
  } else {
    parentPort.postMessage({ id: m.id, ...res });
  }
});
