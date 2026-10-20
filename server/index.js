// Serveur de la démo : sert la PWA (dossier public/) et relaie les enregistrements
// vers l'API de reconnaissance vocale, dont les identifiants ne quittent pas le serveur.

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerClientAsr, ErreurAsr, extensionAudio } from './asr.js';
import { repondrePrix, resumerBase } from './prix.js';
import { analyserSignalement, creerRegistre, destinataire } from './signalement.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAILLE_MAX_AUDIO = 25 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

const ENTETES_SECURITE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'microphone=(self), geolocation=(self), camera=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

class ErreurHttp extends Error {
  constructor(statut, message, code = 'requete_invalide') {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

function envoyerJson(res, statut, donnees) {
  const corps = JSON.stringify(donnees);
  res.writeHead(statut, { ...ENTETES_SECURITE, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(corps);
}

async function lireAudio(req) {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!/^(audio\/|video\/webm|application\/octet-stream)/.test(type)) {
    throw new ErreurHttp(415, "Envoyez l'enregistrement audio tel quel (Content-Type audio/…).", 'audio_illisible');
  }
  const morceaux = [];
  let taille = 0;
  for await (const morceau of req) {
    taille += morceau.length;
    if (taille > TAILLE_MAX_AUDIO) throw new ErreurHttp(413, "L'enregistrement est trop lourd (25 Mo au plus).", 'audio_trop_long');
    morceaux.push(morceau);
  }
  if (taille === 0) throw new ErreurHttp(422, "Aucun son n'a été reçu.", 'audio_trop_court');
  return { audio: Buffer.concat(morceaux), type: type.split(';')[0].trim() };
}

function nombre(valeur, min, max) {
  if (valeur === null || valeur === '') return null;
  const n = Number(valeur);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function memeCode(fourni, attendu) {
  const a = Buffer.from(String(fourni ?? ''));
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function creerApplication({ asr, base, lexique, communes, registre, codeConseiller = '', dossierPublic = path.join(RACINE, 'public') }) {
  function verifierConseiller(req, url) {
    if (!codeConseiller) return;
    const fourni = req.headers['x-code-conseiller'] ?? url.searchParams.get('code');
    if (!memeCode(fourni, codeConseiller)) throw new ErreurHttp(401, 'Code conseiller requis.', 'code_conseiller');
  }

  function vuePublique(s) {
    const { audio, ...reste } = s;
    return { ...reste, audio_disponible: Boolean(audio) };
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    if (m === 'GET' && p === '/api/etat') {
      return envoyerJson(res, 200, {
        asr: { configure: asr.configure, simulation: asr.simulation },
        conseiller_protege: Boolean(codeConseiller),
      });
    }
    if (m === 'GET' && p === '/api/prix/base') return envoyerJson(res, 200, resumerBase(base));
    if (m === 'GET' && p === '/api/communes') {
      return envoyerJson(res, 200, { communes: communes.map(({ nom, departement }) => ({ nom, departement })) });
    }

    if (m === 'POST' && p === '/api/prix') {
      const { audio, type } = await lireAudio(req);
      const reponseApi = await asr.marche(audio, type);
      return envoyerJson(res, 200, { ...repondrePrix(base, reponseApi), simulation: asr.simulation });
    }

    if (m === 'POST' && p === '/api/signalements') {
      const { audio, type } = await lireAudio(req);
      const lat = nombre(url.searchParams.get('lat'), -90, 90);
      const lon = nombre(url.searchParams.get('lon'), -180, 180);
      const gps = lat !== null && lon !== null
        ? { lat, lon, precision: nombre(url.searchParams.get('precision'), 0, 1e6) }
        : null;
      const communeChoisie = communes.find((c) => c.nom === url.searchParams.get('commune')) ?? null;
      // Les communes du département aident l'API à reconnaître un nom de lieu.
      const noms = communeChoisie ? communes.filter((c) => c.departement === communeChoisie.departement).map((c) => c.nom) : [];

      const reponseApi = await asr.transcrire(audio, type, { noms });
      const texte = reponseApi.texte_ponctue ?? reponseApi.texte ?? '';
      const analyse = analyserSignalement(lexique, communes, texte);
      const commune = communeChoisie
        ? { nom: communeChoisie.nom, departement: communeChoisie.departement, source: 'choisie' }
        : analyse.commune ? { ...analyse.commune, source: 'entendue' } : null;

      const signalement = await registre.ajouter({
        audio,
        extension: extensionAudio(type),
        transcription: texte,
        culture: analyse.culture,
        parties: analyse.parties,
        symptomes: analyse.symptomes,
        localisation: { gps, commune },
        destinataire: destinataire(commune),
        id_requete: reponseApi.id ?? null,
        simulation: asr.simulation,
      });
      return envoyerJson(res, 201, vuePublique(signalement));
    }

    if (m === 'GET' && p === '/api/signalements') {
      verifierConseiller(req, url);
      return envoyerJson(res, 200, { signalements: registre.lister().map(vuePublique) });
    }

    const route = p.match(/^\/api\/signalements\/(SIG-\d{8}-\d{3,})(\/audio|\/prise-en-charge)?$/);
    if (route) {
      const [, reference, suite] = route;
      if (m === 'GET' && !suite) {
        const s = registre.trouver(reference);
        if (!s) throw new ErreurHttp(404, 'Signalement introuvable.', 'introuvable');
        const { statut, recu_le, pris_en_charge_le = null } = s;
        return envoyerJson(res, 200, { reference, statut, recu_le, pris_en_charge_le });
      }
      if (m === 'POST' && suite === '/prise-en-charge') {
        verifierConseiller(req, url);
        const s = await registre.prendreEnCharge(reference);
        if (!s) throw new ErreurHttp(404, 'Signalement introuvable.', 'introuvable');
        return envoyerJson(res, 200, vuePublique(s));
      }
      if (m === 'GET' && suite === '/audio') {
        verifierConseiller(req, url);
        const s = registre.trouver(reference);
        const chemin = s && registre.cheminAudio(s);
        if (!chemin) throw new ErreurHttp(404, 'Audio introuvable.', 'introuvable');
        return envoyerFichier(req, res, chemin, 'private, no-store');
      }
    }

    throw new ErreurHttp(404, 'Adresse inconnue.', 'introuvable');
  }

  async function envoyerFichier(req, res, chemin, cache) {
    let infos;
    try {
      infos = await stat(chemin);
    } catch {
      throw new ErreurHttp(404, 'Fichier introuvable.', 'introuvable');
    }
    if (!infos.isFile()) throw new ErreurHttp(404, 'Fichier introuvable.', 'introuvable');
    res.writeHead(200, {
      ...ENTETES_SECURITE,
      'Content-Type': TYPES[path.extname(chemin)] ?? 'application/octet-stream',
      'Content-Length': infos.size,
      'Cache-Control': cache,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(chemin).pipe(res);
  }

  async function statique(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErreurHttp(405, 'Méthode non permise.');
    let relatif;
    try {
      relatif = decodeURIComponent(url.pathname);
    } catch {
      throw new ErreurHttp(400, 'Adresse invalide.');
    }
    if (relatif === '/') relatif = '/index.html';
    if (relatif === '/conseiller') relatif = '/conseiller.html';
    const chemin = path.join(dossierPublic, path.normalize(relatif));
    if (!chemin.startsWith(dossierPublic + path.sep)) throw new ErreurHttp(404, 'Fichier introuvable.', 'introuvable');
    const ext = path.extname(chemin);
    const cache = ['.woff2', '.png'].includes(ext) ? 'public, max-age=604800' : 'no-cache';
    return envoyerFichier(req, res, chemin, cache);
  }

  return async function gerer(req, res) {
    const debut = Date.now();
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.once('finish', () => console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - debut} ms`));
    }
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await statique(req, res, url);
    } catch (e) {
      const connue = e instanceof ErreurHttp || e instanceof ErreurAsr;
      if (!connue) console.error(e);
      if (res.headersSent) return res.destroy();
      if (e instanceof ErreurHttp && e.statut === 413) res.setHeader('Connection', 'close');
      envoyerJson(res, connue ? e.statut : 500, {
        erreur: connue ? e.message : 'Erreur interne du serveur.',
        code: connue ? e.code : 'erreur_interne',
      });
    }
  };
}

async function lireJson(relatif) {
  return JSON.parse(await readFile(path.join(RACINE, relatif), 'utf8'));
}

export async function demarrer() {
  try {
    process.loadEnvFile(path.join(RACINE, '.env'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const env = process.env;
  const asr = creerClientAsr({
    url: env.ASR_URL || undefined,
    identifiant: env.ASR_ID,
    motDePasse: env.ASR_MDP,
    simulation: env.ASR_SIMULATION === '1' || process.argv.includes('--simulation'),
  });
  const [base, lexique, { communes }] = await Promise.all([
    lireJson('data/prix.json'),
    lireJson('data/lexique.json'),
    lireJson('data/communes.json'),
  ]);
  const registre = await creerRegistre(path.resolve(RACINE, env.DOSSIER_DONNEES || 'stockage'));
  const gerer = creerApplication({ asr, base, lexique, communes, registre, codeConseiller: env.CODE_CONSEILLER || '' });

  // Un hébergeur peut fournir un socket (chemin) au lieu d'un numéro de port.
  const port = /^\d+$/.test(env.PORT ?? '') ? Number(env.PORT) : env.PORT || 3000;
  const hote = env.HOST || '0.0.0.0';
  // L'API peut mettre jusqu'à 90 s à répondre : on laisse le temps aux requêtes.
  const serveur = createServer({ requestTimeout: 180_000 }, gerer);
  const pret = () => {
    console.log(`AgriFon : à l'écoute sur ${typeof port === 'number' ? `http://localhost:${port}` : port}`);
    if (asr.simulation) console.log('Mode SIMULATION : aucune requête envoyée à l’API, réponses factices.');
    else if (!asr.configure) console.warn('ASR_ID / ASR_MDP absents : la reconnaissance vocale renverra une erreur (voir .env.example).');
  };
  if (typeof port === 'number') serveur.listen(port, hote, pret);
  else serveur.listen(port, pret);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  demarrer();
}
