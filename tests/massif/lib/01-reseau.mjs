// Batterie 01 : robustesse du client HTTP face à une machine partagée.
// Plusieurs dizaines de scripts de test tournent en même temps sur ce poste et se partagent les ports « éphémères » de Windows :
// après une rafale d'un autre script, un `connect` vers 127.0.0.1 peut échouer un moment (EADDRINUSE) alors que le serveur du
// test va très bien. On réessaie donc, de façon bornée, SEULEMENT ce qui est sans risque :
//  - échec avant tout envoi (EADDRINUSE, ECONNREFUSED…) : n'importe quelle requête ;
//  - coupure en cours d'échange : seulement les lectures (GET) et order_create (protégé par sa clé d'envoi : un rejeu répond 200).
// Chaque réponse porte `essais` (nombre de tentatives). Les réessais sont comptés et rapportés : rien n'est caché.
import { ClientIP } from './clients.mjs';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
export const reessais = { total: 0, parCode: {} };

const AVANT_ENVOI = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'ECONNREFUSED', 'ENETUNREACH', 'ENOBUFS', 'EMFILE', 'UND_ERR_CONNECT_TIMEOUT']);
const EN_COURS = new Set(['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE', 'UND_ERR_CLOSED', 'ETIMEDOUT']);

export function installerReessais({ delaiMax = 150000 } = {}) {
  const origine = ClientIP.prototype.request;
  if (origine.__reessais) return;
  const enveloppe = async function (method, route, opts) {
    const debut = Date.now();
    for (let essai = 1; ; essai++) {
      try {
        const rep = await origine.call(this, method, route, opts);
        rep.essais = essai;
        return rep;
      } catch (e) {
        const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
        const rejouable = AVANT_ENVOI.has(code) || (EN_COURS.has(code) && (method === 'GET' || /^order_create/.test(route)));
        if (!rejouable || Date.now() - debut > delaiMax) throw e;
        reessais.total++;
        reessais.parCode[code] = (reessais.parCode[code] || 0) + 1;
        await attendre(Math.min(3000, 150 * 2 ** Math.min(essai, 5)) + Math.floor(Math.random() * 300));
      }
    }
  };
  enveloppe.__reessais = true;
  ClientIP.prototype.request = enveloppe;
}
