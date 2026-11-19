// Pilote de base pour les tests : PGlite dans un thread, avec
//  - query / transaction asynchrones (utilisés par le serveur),
//  - querySync (utilisé par les tests pour inspecter ou préparer la base entre deux requêtes).
// Les requêtes sont sérialisées : une transaction garde la main jusqu'à COMMIT / ROLLBACK.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';

export function creerPiloteTest() {
  const worker = new Worker(new URL('./pglite-worker.mjs', import.meta.url));
  worker.unref();
  let seq = 0;
  const attente = new Map();
  worker.on('message', (m) => {
    const p = attente.get(m.id);
    if (!p) return;
    attente.delete(m.id);
    if (m.ok) p.resolve({ rows: m.rows, rowCount: m.rowCount });
    else p.reject(Object.assign(new Error(m.message), { code: m.code }));
  });

  function brut(message) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      attente.set(id, { resolve, reject });
      worker.postMessage({ id, ...message });
    });
  }

  let file = Promise.resolve();
  function exclusif(fn) {
    const p = file.then(fn, fn);
    file = p.then(() => {}, () => {});
    return p;
  }

  return {
    query: (sql, params = []) => exclusif(() => brut({ sql, params })),
    exec: (sql) => exclusif(() => brut({ exec: sql })),
    transaction: (fn) => exclusif(async () => {
      await brut({ sql: 'BEGIN', params: [] });
      try {
        const r = await fn((sql, params = []) => brut({ sql, params }));
        await brut({ sql: 'COMMIT', params: [] });
        return r;
      } catch (e) {
        try { await brut({ sql: 'ROLLBACK', params: [] }); } catch { /* ignoré */ }
        throw e;
      }
    }),
    /** Requête bloquante (le thread principal attend la réponse). Ne pas l'appeler pendant une transaction du serveur. */
    querySync(sql, params = []) {
      const sab = new SharedArrayBuffer(4);
      const drapeau = new Int32Array(sab);
      const { port1, port2 } = new MessageChannel();
      worker.postMessage({ sql, params, sab, port: port2 }, [port2]);
      Atomics.wait(drapeau, 0, 0);
      const recu = receiveMessageOnPort(port1);
      port1.close();
      const m = recu && recu.message;
      if (!m) throw new Error('Réponse de la base de test manquante.');
      if (!m.ok) throw Object.assign(new Error(m.message), { code: m.code });
      return { rows: m.rows, rowCount: m.rowCount };
    },
    execSync(sql) {
      const sab = new SharedArrayBuffer(4);
      const drapeau = new Int32Array(sab);
      const { port1, port2 } = new MessageChannel();
      worker.postMessage({ exec: sql, sab, port: port2 }, [port2]);
      Atomics.wait(drapeau, 0, 0);
      const recu = receiveMessageOnPort(port1);
      port1.close();
      const m = recu && recu.message;
      if (!m || !m.ok) throw Object.assign(new Error(m ? m.message : 'Base de test muette'), { code: m && m.code });
    },
    close() { return worker.terminate(); }
  };
}
