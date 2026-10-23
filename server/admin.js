// Administration d'AgriFon : un seul administrateur, un mot de passe dont le
// serveur ne garde qu'une empreinte (scrypt), des sessions de 10 minutes sans
// activité et un blocage après 3 essais faux. Routes sous /api/admin/.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ErreurHttp, envoyerJson, lireCorpsJson } from './http.js';
import { adresseClient, creerCompteur } from './protection.js';

const COOKIE = 'agrifon_admin';
const ATTRIBUTS_COOKIE = 'Path=/; HttpOnly; Secure; SameSite=Strict';

export function empreinteMotDePasse(mdp) {
  const sel = randomBytes(16);
  return `scrypt:${sel.toString('hex')}:${scryptSync(String(mdp), sel, 64).toString('hex')}`;
}

export function verifierMotDePasse(mdp, empreinte) {
  const m = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(String(empreinte ?? ''));
  if (!m) return false;
  const attendue = Buffer.from(m[2], 'hex');
  return timingSafeEqual(scryptSync(String(mdp ?? ''), Buffer.from(m[1], 'hex'), attendue.length), attendue);
}

// Sessions en mémoire : un redémarrage déconnecte. Seule une activité réelle
// (clic, frappe : en-tête X-Activite) prolonge une session ; les relèves
// automatiques de l'écran ne la prolongent pas.
export function creerSessions({ dureeMs = 600_000, maintenant = Date.now } = {}) {
  const sessions = new Map(); // jeton -> date de la dernière activité
  function nettoyer() {
    const t = maintenant();
    for (const [j, d] of sessions) if (t - d > dureeMs) sessions.delete(j);
  }
  return {
    ouvrir() {
      nettoyer();
      const jeton = randomBytes(32).toString('hex');
      sessions.set(jeton, maintenant());
      return jeton;
    },
    valider(jeton, { activite = false } = {}) {
      const derniere = sessions.get(jeton);
      if (derniere === undefined) return false;
      const t = maintenant();
      if (t - derniere > dureeMs) {
        sessions.delete(jeton);
        return false;
      }
      if (activite) sessions.set(jeton, t);
      return true;
    },
    fermer: (jeton) => sessions.delete(jeton),
  };
}

export function creerAdmin({
  empreinte, sessions, mesures = null, reglages = null, registre = null, releves = null, asr = null, version = null,
  dossierAudio = null, importerPrix = null, attendre = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  // 3 essais faux depuis une même adresse la bloquent 10 minutes. Sans adresse
  // connue, pas de blocage commun (il enfermerait l'administrateur dehors) :
  // chaque essai faux attend 2 secondes.
  const echecs = creerCompteur({ fenetreMs: 600_000, maximum: 3 });

  function jetonDe(req) {
    return String(req.headers.cookie ?? '').match(/(?:^|;\s*)agrifon_admin=([0-9a-f]{64})(?:;|$)/)?.[1] ?? null;
  }

  function exigerSession(req) {
    const jeton = jetonDe(req);
    if (!jeton || !sessions.valider(jeton, { activite: req.headers['x-activite'] === '1' })) {
      throw new ErreurHttp(401, 'Connectez-vous pour accéder au back office.', 'connexion_requise');
    }
  }

  async function connexion(req, res) {
    if (!empreinte) {
      throw new ErreurHttp(503, "Le mot de passe de l'administration n'est pas encore défini sur le serveur.", 'admin_non_configure');
    }
    const client = adresseClient(req);
    const bloque = client ? echecs.attente(client) : 0;
    if (bloque) {
      throw new ErreurHttp(429, 'Trop d’essais du mot de passe. Réessayez dans 10 minutes.', 'trop_de_demandes', Math.ceil(bloque / 1000));
    }
    const { mot_de_passe: mdp } = await lireCorpsJson(req);
    if (typeof mdp !== 'string' || !verifierMotDePasse(mdp, empreinte)) {
      mesures?.refus('mot_de_passe_admin');
      if (client) echecs.passer(client);
      else await attendre(2000);
      throw new ErreurHttp(401, 'Mot de passe incorrect.', 'mot_de_passe');
    }
    envoyerJson(res, 200, { connecte: true }, 0, { 'Set-Cookie': `${COOKIE}=${sessions.ouvrir()}; ${ATTRIBUTS_COOKIE}` });
  }

  return {
    // Traite /api/admin/* ; rend false pour toute autre adresse.
    async gerer(req, res, url) {
      const p = url.pathname;
      if (!p.startsWith('/api/admin/')) return false;
      const m = req.method;
      if (m === 'POST' && p === '/api/admin/connexion') {
        await connexion(req, res);
        return true;
      }
      if (m === 'POST' && p === '/api/admin/deconnexion') {
        const jeton = jetonDe(req);
        if (jeton) sessions.fermer(jeton);
        envoyerJson(res, 200, { connecte: false }, 0, { 'Set-Cookie': `${COOKIE}=; ${ATTRIBUTS_COOKIE}; Max-Age=0` });
        return true;
      }
      // Toute autre route exige la session, avant même de dire si elle existe.
      exigerSession(req);
      if (m === 'GET' && p === '/api/admin/session') {
        envoyerJson(res, 200, { connecte: true });
        return true;
      }
      throw new ErreurHttp(404, 'Adresse inconnue.', 'introuvable');
    },
  };
}
