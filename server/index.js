// Serveur de la démo : sert la PWA (dossier site/) et relaie les enregistrements
// vers l'API de reconnaissance vocale, dont les identifiants ne quittent pas le serveur.

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerAdmin, creerSessions, lancerImportPrix, lireVersion } from './admin.js';
import { creerClientAsr, ErreurAsr, extensionAudio } from './asr.js';
import { ENTETES_SECURITE, ErreurHttp, envoyerJson } from './http.js';
import { repondrePrix, resumerBase } from './prix.js';
import { adresseClient, creerCompteur, creerProtection, estRobot } from './protection.js';
import { creerMesures } from './mesures.js';
import { creerReleves } from './releves.js';
import { creerReglages } from './reglages.js';
import { creerTextes } from './reponses.js';
import { analyserSignalement, creerRegistre, destinataire } from './signalement.js';
import { choisirSolutions, solutionsPubliables } from './solutions.js';
import { creerSyntheseDepuisEnv, texteADire } from './synthese.js';
import { creerVoix } from './voix.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 60 secondes de WAV mono à 48 kHz pèsent 5,8 Mo : l'API n'accepte pas plus long.
const TAILLE_MAX_AUDIO = 8 * 1024 * 1024;

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

async function lireAudio(req) {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!/^(audio\/|video\/webm|application\/octet-stream)/.test(type)) {
    throw new ErreurHttp(415, "Envoyez l'enregistrement audio tel quel (Content-Type audio/…).", 'audio_illisible');
  }
  const morceaux = [];
  let taille = 0;
  for await (const morceau of req) {
    taille += morceau.length;
    if (taille > TAILLE_MAX_AUDIO) throw new ErreurHttp(413, "L'enregistrement est trop lourd (8 Mo au plus).", 'audio_trop_long');
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

// Erreurs pour lesquelles une phrase existe aussi en fongbé.
const PHRASES_ERREUR = {
  asr_indisponible: 'erreur_reessayer',
  asr_injoignable: 'erreur_reessayer',
  audio_trop_court: 'erreur_trop_court',
  trop_de_demandes: 'erreur_reessayer',
  service_sature: 'erreur_reessayer',
  hors_service: 'hors_service',
};

const PRIX_COMPRIS = new Set(['ok', 'sans_prix', 'marche_seul']);

// `protection` : null la désactive (tests qui ne portent pas sur elle).
// `maxEnAttente` : demandes vocales en attente de l'API au-delà desquelles on refuse,
// dont `maxEnAttenteParVisiteur` au plus pour un même visiteur.
// `mesures` : visites, journal des demandes vocales et refus (server/mesures.js).
// `reglages` : site hors service, solutions en brouillon (server/reglages.js) ; sans
// eux, le site est toujours en service et `solutions` est servi tel quel.
// `synthese` : voix des réponses en phrases entières (server/synthese.js) ; sans elle,
// seuls les anciens extraits sont proposés.
export function creerApplication({
  asr, base, releves, lexique, communes, registre, textes, codeConseiller = '', dossierSite = path.join(RACINE, 'site'),
  voix = creerVoix(path.join(dossierSite, 'voix')), solutions = null, protection = creerProtection(), maxEnAttente = 8,
  maxEnAttenteParVisiteur = 4, mesures = null, reglages = null, maxVisitesParAdresse = 200, admin = null, synthese = null,
}) {
  // Identifiant de la phrase entière à dire, à côté des anciens extraits.
  const voixPhrase = (morceaux) => (synthese && morceaux?.length ? synthese.enregistrer(texteADire(morceaux)) : null);
  // Nouveaux visiteurs comptés par adresse sur 24 heures : de faux identifiants
  // envoyés en masse depuis une adresse ne gonflent pas les chiffres.
  const visitesParAdresse = creerCompteur({ fenetreMs: 86_400_000, maximum: maxVisitesParAdresse });
  // Noms de marchés transmis à l'API pour l'aider à les reconnaître (50 au plus).
  const nomsMarches = [...new Set(base.marches.flatMap((m) => [m.nom, m.ville]))].slice(0, 50);

  // Le réglage du back office l'emporte sur SOLUTIONS_BROUILLON, relu à chaque signalement.
  const solutionsActives = () => (reglages
    ? solutionsPubliables(solutions, { SOLUTIONS_BROUILLON: reglages.lire().solutions_brouillon ? '1' : '0' })
    : solutions);

  // Site coupé : la page d'attente remplace l'accueil, les demandes vocales sont
  // refusées ; le reste (conseiller, administration, fichiers) répond normalement.
  let pageAttente = null;
  async function envoyerPageAttente(res) {
    pageAttente ??= await readFile(path.join(dossierSite, 'hors-service.html'));
    res.writeHead(503, {
      ...ENTETES_SECURITE,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '300',
    });
    res.end(pageAttente);
  }

  function verifierConseiller(req, url) {
    if (!codeConseiller) return;
    const bloque = protection?.codeBloque(req) ?? 0;
    if (bloque) {
      mesures?.refus('trop_de_demandes');
      throw new ErreurHttp(429, 'Trop d’essais du code conseiller. Réessayez dans un quart d’heure.', 'trop_de_demandes', Math.ceil(bloque / 1000));
    }
    const fourni = req.headers['x-code-conseiller'] ?? url.searchParams.get('code');
    if (!memeCode(fourni, codeConseiller)) {
      protection?.echecCode(req);
      // Une page conseiller ouverte sans code demande d'abord la liste : ce n'est pas un essai faux.
      if (fourni !== undefined && fourni !== null) mesures?.refus('code_conseiller');
      throw new ErreurHttp(401, 'Code conseiller requis.', 'code_conseiller');
    }
  }

  // L'API traite une demande à la fois : au-delà de maxEnAttente demandes en file,
  // la suivante est refusée tout de suite plutôt que d'attendre de longues minutes.
  // La place n'est prise qu'une fois l'audio reçu, pour l'appel à l'API seulement.
  let enAttente = 0;
  const enAttenteDe = new Map(); // visiteur -> demandes en file
  async function avecPlace(req, tache) {
    const client = adresseClient(req);
    const siens = client ? enAttenteDe.get(client) ?? 0 : 0;
    if (enAttente >= maxEnAttente || siens >= maxEnAttenteParVisiteur) {
      mesures?.refus('service_sature');
      throw new ErreurHttp(503, 'Le service reçoit trop de demandes en même temps. Réessayez dans une minute.', 'service_sature', 60);
    }
    enAttente++;
    if (client) enAttenteDe.set(client, siens + 1);
    try {
      return await tache();
    } finally {
      enAttente--;
      if (client) {
        const reste = enAttenteDe.get(client) - 1;
        if (reste > 0) enAttenteDe.set(client, reste);
        else enAttenteDe.delete(client);
      }
    }
  }

  function vuePublique(s) {
    const { audio, ...reste } = s;
    return { ...reste, audio_disponible: Boolean(audio) };
  }

  // Une entrée de journal par demande vocale, en succès comme en erreur. Le
  // traitement remplit `note` (durée de l'API, transcription, ce qui a été
  // reconnu) ; la mesure ne fait jamais échouer la demande.
  async function journaliser(service, traitement) {
    const debut = Date.now();
    const note = { duree_api_ms: null, duree_audio_s: null, transcription: '', reconnu: null, resultat: 'erreur', reference: null };
    let code = null;
    try {
      return await traitement(note);
    } catch (e) {
      note.resultat = 'erreur';
      code = e?.code ?? 'erreur_interne';
      throw e;
    } finally {
      mesures?.appel({ date: new Date(debut).toISOString(), service, ...note, code, duree_ms: Date.now() - debut });
    }
  }

  // Appel à l'API, chronométré pour le journal.
  async function appelChronometre(req, note, tache) {
    const debut = Date.now();
    try {
      const reponse = await avecPlace(req, tache);
      note.duree_audio_s = Number.isFinite(reponse?.duree_audio_s) ? reponse.duree_audio_s : null;
      return reponse;
    } finally {
      note.duree_api_ms = Date.now() - debut;
    }
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    if (m === 'GET' && p === '/api/etat') {
      // L'application du téléphone envoie son identifiant anonyme à l'ouverture.
      // Cette route reste ouverte aux outils (déploiement) : un robot n'est pas compté.
      const visiteur = req.headers['x-visiteur'];
      if (mesures && visiteur && !estRobot(req.headers['user-agent'])) {
        // Sans adresse connue, tous partagent une même limite.
        const adresse = adresseClient(req) ?? 'inconnue';
        if (!visitesParAdresse.attente(adresse) && mesures.visite(String(visiteur))) visitesParAdresse.passer(adresse);
      }
      return envoyerJson(res, 200, {
        asr: { configure: asr.configure, simulation: asr.simulation },
        conseiller_protege: Boolean(codeConseiller),
        // Le serveur connaît-il l'adresse du visiteur (limites par visiteur actives) ?
        client_identifie: Boolean(adresseClient(req)),
        hors_service: Boolean(reglages?.horsService()),
      });
    }
    if (m === 'GET' && p === '/api/prix/base') return envoyerJson(res, 200, resumerBase(base, releves.lire()));
    if (m === 'GET' && p === '/api/communes') {
      return envoyerJson(res, 200, { communes: communes.map(({ nom, departement }) => ({ nom, departement })) });
    }

    if (m === 'POST' && p === '/api/prix') return journaliser('prix', async (note) => {
      const { audio, type } = await lireAudio(req);
      const reponseApi = await appelChronometre(req, note, () => asr.marche(audio, type, { noms: nomsMarches }));
      const reponse = repondrePrix(base, releves.lire(), textes, reponseApi);
      Object.assign(note, {
        transcription: reponse.transcription,
        reconnu: { produits: reponse.reponses.map((r) => r.produit.nom), marche: reponse.marche?.nom ?? null },
        resultat: PRIX_COMPRIS.has(reponse.statut) ? 'compris' : 'non_compris',
      });
      return envoyerJson(res, 200, {
        ...reponse, voix: voix.fichiers(reponse.voix), voix_phrase: voixPhrase(reponse.voix), simulation: asr.simulation,
      });
    });

    if (m === 'POST' && p === '/api/signalements') return journaliser('signalement', async (note) => {
      const { audio, type } = await lireAudio(req);
      const lat = nombre(url.searchParams.get('lat'), -90, 90);
      const lon = nombre(url.searchParams.get('lon'), -180, 180);
      const gps = lat !== null && lon !== null
        ? { lat, lon, precision: nombre(url.searchParams.get('precision'), 0, 1e6) }
        : null;
      const communeChoisie = communes.find((c) => c.nom === url.searchParams.get('commune')) ?? null;
      // Les communes du département aident l'API à reconnaître un nom de lieu.
      const noms = communeChoisie ? communes.filter((c) => c.departement === communeChoisie.departement).map((c) => c.nom) : [];

      const reponseApi = await appelChronometre(req, note, () => asr.transcrire(audio, type, { noms }));
      const texte = reponseApi.texte_ponctue ?? reponseApi.texte ?? '';
      const analyse = analyserSignalement(lexique, communes, texte);
      const commune = communeChoisie
        ? { nom: communeChoisie.nom, departement: communeChoisie.departement, source: 'choisie' }
        : analyse.commune ? { ...analyse.commune, source: 'entendue' } : null;
      Object.assign(note, {
        transcription: texte,
        reconnu: {
          culture: analyse.culture?.nom ?? null,
          parties: analyse.parties.map((x) => x.libelle),
          symptomes: analyse.symptomes.map((x) => x.libelle),
          commune: commune?.nom ?? null,
        },
        resultat: analyse.culture && analyse.symptomes.length ? 'compris' : 'non_compris',
      });
      // Le registre garde les solutions telles qu'elles ont été proposées, sans la voix.
      const choisies = choisirSolutions(solutionsActives(), analyse, { departement: commune?.departement ?? null, date: new Date(), transcription: texte });
      const { morceaux = [], ...proposees } = choisies ?? {};

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
        solutions: choisies ? proposees : null,
      });
      protection?.signalementAccepte(req);
      note.reference = signalement.reference;
      const titre = textes.phrase('signalement_transmis');
      const recu = commune
        ? textes.phrase('signalement_recu_commune', { commune: commune.nom })
        : textes.phrase('signalement_recu_gps');
      const sansVoix = ({ fr, fon }) => ({ fr, fon });
      const voixAccuse = textes.joindre([titre, recu]).voix;
      return envoyerJson(res, 201, {
        ...vuePublique(signalement),
        messages: {
          titre: sansVoix(titre),
          recu: sansVoix(recu),
          attente: sansVoix(textes.phrase('signalement_attente')),
          pris: sansVoix(textes.phrase('signalement_pris')),
        },
        voix: voix.fichiers(voixAccuse),
        voix_phrase: voixPhrase(voixAccuse),
        solutions: choisies ? { ...proposees, voix: voix.fichiers(morceaux), voix_phrase: voixPhrase(morceaux) } : null,
      });
    });

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

    // Voix d'une phrase entière : seulement pour un identifiant émis par AgriFon.
    const son = p.match(/^\/api\/voix\/([0-9a-f]{16})\.wav$/);
    if (son && (m === 'GET' || m === 'HEAD')) {
      const resultat = synthese ? await synthese.obtenir(son[1]) : { etat: 'inconnu' };
      if (resultat.etat === 'pret') return envoyerFichier(req, res, resultat.chemin, 'public, max-age=31536000, immutable');
      if (resultat.etat === 'en_cours') return envoyerJson(res, 202, { pret: false }, 10);
      throw new ErreurHttp(404, 'Voix introuvable.', 'introuvable');
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
    // Un fichier remplacé sous le même nom (extrait de voix) est revu dès la requête suivante.
    const etag = `"${infos.size.toString(36)}-${Math.floor(infos.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...ENTETES_SECURITE, ETag: etag, 'Cache-Control': cache });
      return res.end();
    }
    res.writeHead(200, {
      ...ENTETES_SECURITE,
      'Content-Type': TYPES[path.extname(chemin)] ?? 'application/octet-stream',
      'Content-Length': infos.size,
      'Cache-Control': cache,
      ETag: etag,
      'Last-Modified': infos.mtime.toUTCString(),
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
    if (relatif === '/admin') relatif = '/admin.html';
    const chemin = path.join(dossierSite, path.normalize(relatif));
    if (!chemin.startsWith(dossierSite + path.sep)) throw new ErreurHttp(404, 'Fichier introuvable.', 'introuvable');
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
      const refus = protection?.verifier(req, url);
      if (refus) {
        mesures?.refus(refus.code);
        throw new ErreurHttp(refus.statut, refus.message, refus.code, refus.attente);
      }
      // L'administration passe avant le mode hors service, pour pouvoir le lever.
      if (admin && url.pathname.startsWith('/api/admin/') && await admin.gerer(req, res, url)) return;
      if (reglages?.horsService()) {
        const p = url.pathname;
        if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/' || p === '/index.html')) return await envoyerPageAttente(res);
        if (req.method === 'POST' && (p === '/api/prix' || p === '/api/signalements')) {
          throw new ErreurHttp(503, textes.phrase('hors_service').fr, 'hors_service', 300);
        }
      }
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await statique(req, res, url);
    } catch (e) {
      const connue = e instanceof ErreurHttp || e instanceof ErreurAsr;
      if (!connue) console.error(e);
      if (res.headersSent) return res.destroy();
      if (e instanceof ErreurHttp && e.statut === 413) res.setHeader('Connection', 'close');
      envoyerJson(res, connue ? e.statut : 500, {
        erreur: connue ? e.message : 'Erreur interne du serveur.',
        erreur_fon: connue && PHRASES_ERREUR[e.code] ? textes.phrase(PHRASES_ERREUR[e.code]).fon : null,
        code: connue ? e.code : 'erreur_interne',
      }, e.attente ?? 0);
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
  const [base, lexique, { communes }, reponses, solutions] = await Promise.all([
    lireJson('data/referentiel.json'),
    lireJson('data/lexique.json'),
    lireJson('data/communes.json'),
    lireJson('data/reponses.json'),
    lireJson('data/solutions.json'),
  ]);
  const dossierDonnees = path.resolve(RACINE, env.DOSSIER_DONNEES || 'stockage');
  const registre = await creerRegistre(dossierDonnees);
  // Prix importés par scripts/importer-prix.js, sinon l'instantané livré avec le code.
  const releves = creerReleves([path.join(dossierDonnees, 'releves-prix.json'), path.join(RACINE, 'data', 'releves-prix.json')]);
  // Réglages du back office : SOLUTIONS_BROUILLON n'en est que la valeur de départ.
  const reglages = await creerReglages(path.join(dossierDonnees, 'reglages.json'), { solutionsBrouillon: env.SOLUTIONS_BROUILLON === '1' });
  const mesures = creerMesures(path.join(dossierDonnees, 'mesures'));
  const admin = creerAdmin({
    empreinte: env.ADMIN_MDP_EMPREINTE || '',
    sessions: creerSessions(),
    mesures, reglages, registre, releves, asr,
    version: lireVersion(RACINE),
    dossierAudio: path.join(dossierDonnees, 'audio'),
    importerPrix: () => lancerImportPrix(RACINE),
  });
  // Voix en phrases entières : coupée en simulation, avec VOIX_PHRASES=0 ou sans identifiants.
  const synthese = creerSyntheseDepuisEnv(env, dossierDonnees, { simulation: asr.simulation });
  if (synthese) {
    const purger = () => synthese.purger().catch((e) => console.error(`Réserve de voix : ${e.message}`));
    purger();
    setInterval(purger, 86_400_000).unref();
  }
  const gerer = creerApplication({
    asr, base, releves, lexique, communes, registre, textes: creerTextes(reponses), codeConseiller: env.CODE_CONSEILLER || '',
    solutions, mesures, reglages, admin, synthese,
  });

  // Un hébergeur peut fournir un socket (chemin) au lieu d'un numéro de port.
  const port = /^\d+$/.test(env.PORT ?? '') ? Number(env.PORT) : env.PORT || 3000;
  const hote = env.HOST || '0.0.0.0';
  // L'API peut mettre jusqu'à 90 s à répondre : on laisse le temps aux requêtes.
  const serveur = createServer({ requestTimeout: 180_000 }, gerer);
  const pret = () => {
    console.log(`AgriFon : à l'écoute sur ${typeof port === 'number' ? `http://localhost:${port}` : port}`);
    if (asr.simulation) console.log('Mode SIMULATION : aucune requête envoyée à l’API, réponses factices.');
    else if (!asr.configure) console.warn('ASR_ID / ASR_MDP absents : la reconnaissance vocale renverra une erreur (voir .env.example).');
    console.log(synthese
      ? `Voix des réponses en phrases entières : voix ${synthese.voix}, anciens extraits en repli.`
      : 'Voix des réponses : anciens extraits seulement (phrases entières coupées).');
    if (!solutionsPubliables(solutions, { SOLUTIONS_BROUILLON: reglages.lire().solutions_brouillon ? '1' : '0' })) {
      console.warn('Solutions après signalement non proposées : leur fon attend la relecture d’un locuteur (data/solutions.json, fon_a_relire). Pour une démonstration, activer les solutions en brouillon dans le back office.');
    }
    if (!env.ADMIN_MDP_EMPREINTE) console.warn('ADMIN_MDP_EMPREINTE absent : le back office restera fermé (node scripts/admin-mot-de-passe.js).');
  };
  if (typeof port === 'number') serveur.listen(port, hote, pret);
  else serveur.listen(port, pret);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  demarrer();
}
