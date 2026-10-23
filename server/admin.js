// Administration d'AgriFon : un seul administrateur, un mot de passe dont le
// serveur ne garde qu'une empreinte (scrypt), des sessions de 10 minutes sans
// activité et un blocage après 3 essais faux. Routes sous /api/admin/.

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ErreurHttp, envoyerJson, lireCorpsJson } from './http.js';
import { adresseClient, creerCompteur } from './protection.js';

const COOKIE = 'agrifon_admin';
const ATTRIBUTS_COOKIE = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const EMPREINTE = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/;
const scryptAsync = promisify(scrypt);
const MAX_EN_FILE = 20; // vérifications en attente au-delà desquelles on refuse
const ECHECS_ALERTE = 10; // échecs en 10 minutes, toutes adresses confondues, avant le ralentissement général

export function empreinteMotDePasse(mdp) {
  const sel = randomBytes(16);
  return `scrypt:${sel.toString('hex')}:${scryptSync(String(mdp), sel, 64).toString('hex')}`;
}

export function verifierMotDePasse(mdp, empreinte) {
  const m = EMPREINTE.exec(String(empreinte ?? ''));
  if (!m) return false;
  const attendue = Buffer.from(m[2], 'hex');
  return timingSafeEqual(scryptSync(String(mdp ?? ''), Buffer.from(m[1], 'hex'), attendue.length), attendue);
}

// La même vérification sans bloquer le serveur pendant le calcul.
async function verifierSansBloquer(mdp, empreinte) {
  const m = EMPREINTE.exec(String(empreinte ?? ''));
  if (!m) return false;
  const attendue = Buffer.from(m[2], 'hex');
  return timingSafeEqual(await scryptAsync(String(mdp ?? ''), Buffer.from(m[1], 'hex'), attendue.length), attendue);
}

// Clé de blocage d'une adresse : l'IPv4 telle quelle, l'IPv6 ramenée à son /64,
// qu'un même abonné peut faire tourner à volonté.
export function cleAdresse(ip) {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [tete, queue = ''] = ip.toLowerCase().split('::');
  const debut = tete ? tete.split(':') : [];
  const fin = queue ? queue.split(':') : [];
  const groupes = ip.includes('::') ? [...debut, ...Array(Math.max(0, 8 - debut.length - fin.length)).fill('0'), ...fin] : debut;
  return `${groupes.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
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
  // 3 essais faux depuis une même adresse (un même /64 en IPv6) la bloquent 10
  // minutes. Jamais de blocage commun, qui enfermerait l'administrateur dehors :
  // sans adresse connue, ou au-delà de 10 échecs en 10 minutes toutes adresses
  // confondues, chaque essai faux attend 2 secondes. Les vérifications passent
  // l'une après l'autre, pour que des essais simultanés ne contournent pas
  // l'attente, et la file est bornée.
  const echecs = creerCompteur({ fenetreMs: 600_000, maximum: 3 });
  const echecsTous = creerCompteur({ fenetreMs: 600_000, maximum: ECHECS_ALERTE });
  let file = Promise.resolve();
  let enFile = 0;
  async function aSonTour(tache) {
    if (enFile >= MAX_EN_FILE) {
      throw new ErreurHttp(429, 'Trop de connexions en cours. Réessayez dans un moment.', 'trop_de_demandes', 30);
    }
    enFile++;
    const resultat = file.then(tache, tache);
    file = resultat.catch(() => {});
    try {
      return await resultat;
    } finally {
      enFile--;
    }
  }

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
    const adresse = adresseClient(req);
    const cle = adresse ? cleAdresse(adresse) : null;
    const bloque = cle ? echecs.attente(cle) : 0;
    if (bloque) {
      throw new ErreurHttp(429, 'Trop d’essais du mot de passe. Réessayez dans 10 minutes.', 'trop_de_demandes', Math.ceil(bloque / 1000));
    }
    const { mot_de_passe: mdp } = await lireCorpsJson(req);
    const bon = await aSonTour(async () => {
      if (typeof mdp === 'string' && await verifierSansBloquer(mdp, empreinte)) return true;
      mesures?.refus('mot_de_passe_admin');
      const alerte = echecsTous.attente('tous') > 0;
      echecsTous.passer('tous');
      if (cle) echecs.passer(cle);
      if (!cle || alerte) await attendre(2000);
      return false;
    });
    if (!bon) throw new ErreurHttp(401, 'Mot de passe incorrect.', 'mot_de_passe');
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
