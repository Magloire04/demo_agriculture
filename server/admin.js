// Administration d'AgriFon : un seul administrateur, un mot de passe dont le
// serveur ne garde qu'une empreinte (scrypt), des sessions de 10 minutes sans
// activité et un blocage après 3 essais faux. Routes sous /api/admin/.

import { execFile } from 'node:child_process';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
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

// Version du code en ligne, lue dans .git au démarrage (sept premiers caractères du commit).
export function lireVersion(racine) {
  const lire = (relatif) => {
    try {
      return readFileSync(path.join(racine, '.git', relatif), 'utf8').trim();
    } catch {
      return null;
    }
  };
  let commit = null;
  const tete = lire('HEAD');
  if (tete?.startsWith('ref: ')) {
    const ref = tete.slice(5);
    commit = lire(ref) ?? lire('packed-refs')?.split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] ?? null;
  } else if (tete) {
    commit = tete;
  }
  return { commit: /^[0-9a-f]{7,40}$/.test(commit ?? '') ? commit.slice(0, 7) : null, demarre_le: new Date().toISOString() };
}

// Import des prix du PAM, tel que le lance la tâche planifiée.
export function lancerImportPrix(racine) {
  return new Promise((ok) => {
    execFile(process.execPath, [path.join('scripts', 'importer-prix.js')], { cwd: racine, timeout: 360_000 }, (erreur, sortie, sortieErreur) => {
      const lignes = (texte) => String(texte ?? '').trim().split('\n').filter(Boolean);
      if (erreur) return ok({ ok: false, message: lignes(sortieErreur).at(-1) ?? 'Import des prix échoué.' });
      return ok({ ok: true, message: lignes(sortie)[0] ?? 'Prix importés.' });
    });
  });
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
  verifier = verifierSansBloquer, synthese = null,
}) {
  // 3 essais faux depuis une même adresse (un même /64 en IPv6) la bloquent 10
  // minutes. Jamais de blocage commun, qui enfermerait l'administrateur dehors :
  // sans adresse connue, ou au-delà de 10 échecs en 10 minutes toutes adresses
  // confondues, chaque essai faux attend 2 secondes. Les vérifications passent
  // l'une après l'autre dans une file bornée, et le blocage y est relu : des
  // essais simultanés d'une même adresse ne dépassent pas les 3 permis. L'attente
  // de 2 secondes se fait hors de la file, pour ne retarder personne d'autre.
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

  let importEnCours = false;
  const repondre = (res, donnees) => {
    envoyerJson(res, 200, donnees);
    return true;
  };
  const nombreJours = (valeur, defaut) => {
    const n = Number.parseInt(valeur ?? '', 10);
    return Number.isFinite(n) ? Math.min(90, Math.max(1, n)) : defaut;
  };
  const etatSite = () => {
    const { actif, depuis } = reglages.lire().hors_service;
    return { hors_service: actif, depuis };
  };

  async function services() {
    const prix = releves.lire();
    let messages = 0;
    let octets = 0;
    try {
      for (const f of await readdir(dossierAudio)) {
        const infos = await stat(path.join(dossierAudio, f));
        if (!infos.isFile()) continue;
        messages++;
        octets += infos.size;
      }
    } catch {
      // dossier absent : aucun message vocal
    }
    return {
      api: await asr.sante(),
      prix: { importe_le: prix.importe_le ?? null, derniere_date: prix.derniere_date ?? null },
      stockage: { messages_vocaux: messages, octets },
      version,
      // Réserve de la voix des phrases entières ; null si elle est coupée.
      voix: synthese ? await synthese.etat() : null,
    };
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
    const refuserSiBloque = () => {
      const bloque = cle ? echecs.attente(cle) : 0;
      if (bloque) {
        throw new ErreurHttp(429, 'Trop d’essais du mot de passe. Réessayez dans 10 minutes.', 'trop_de_demandes', Math.ceil(bloque / 1000));
      }
    };
    refuserSiBloque();
    const { mot_de_passe: mdp } = await lireCorpsJson(req);
    let ralentir = false;
    const bon = await aSonTour(async () => {
      refuserSiBloque();
      if (typeof mdp === 'string' && await verifier(mdp, empreinte)) return true;
      mesures?.refus('mot_de_passe_admin');
      ralentir = !cle || echecsTous.attente('tous') > 0;
      echecsTous.passer('tous');
      if (cle) echecs.passer(cle);
      return false;
    });
    if (!bon) {
      if (ralentir) await attendre(2000);
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
      const route = `${m} ${p}`;
      const q = url.searchParams;
      if (route === 'GET /api/admin/session') return repondre(res, { connecte: true });
      if (route === 'GET /api/admin/tableau') {
        const statistiques = await mesures.statistiques({ jours: nombreJours(q.get('jours'), 7), signalements: registre.lister() });
        return repondre(res, { site: etatSite(), statistiques });
      }
      if (route === 'GET /api/admin/appels') {
        const curseur = (nom) => {
          const v = q.get(nom) ?? '';
          return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
        };
        return repondre(res, { appels: await mesures.lireJournal({ apres: curseur('apres'), avant: curseur('avant'), limite: 50 }) });
      }
      if (route === 'GET /api/admin/refus') return repondre(res, { refus: await mesures.refusParJour(nombreJours(q.get('jours'), 14)) });
      if (route === 'GET /api/admin/services') return repondre(res, await services());
      if (route === 'GET /api/admin/reglages') return repondre(res, reglages.lire());
      if (route === 'POST /api/admin/hors-service') {
        const { actif } = await lireCorpsJson(req);
        if (typeof actif !== 'boolean') throw new ErreurHttp(400, 'Indiquez actif : true ou false.');
        await (actif ? reglages.mettreHorsService() : reglages.remettreEnService());
        return repondre(res, { site: etatSite() });
      }
      if (route === 'POST /api/admin/solutions-brouillon') {
        const { actif } = await lireCorpsJson(req);
        if (typeof actif !== 'boolean') throw new ErreurHttp(400, 'Indiquez actif : true ou false.');
        await reglages.definirSolutionsBrouillon(actif);
        return repondre(res, { solutions_brouillon: reglages.lire().solutions_brouillon });
      }
      if (route === 'POST /api/admin/prix/importer') {
        if (importEnCours) throw new ErreurHttp(409, 'Un import des prix est déjà en cours.', 'import_en_cours');
        importEnCours = true;
        try {
          return repondre(res, await importerPrix());
        } finally {
          importEnCours = false;
        }
      }
      throw new ErreurHttp(404, 'Adresse inconnue.', 'introuvable');
    },
  };
}
