// Client de l'API de reconnaissance vocale du fon (JaimeMaLangue).
// Les identifiants restent sur ce serveur : le navigateur n'appelle jamais l'API directement.

export const VERSION_APPLI = 'agrifon-1.0.0';

const EXTENSIONS = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

export function extensionAudio(typeMime) {
  return EXTENSIONS[String(typeMime ?? '').split(';')[0].trim().toLowerCase()] ?? 'webm';
}

export class ErreurAsr extends Error {
  constructor(message, { statut = 502, code = 'asr_indisponible' } = {}) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

// Traduit un code d'erreur de l'API en message pour l'utilisateur.
function erreurDepuisReponse(statut, detail) {
  switch (statut) {
    case 401:
      return new ErreurAsr("Le service de reconnaissance vocale refuse l'accès : identifiants du serveur absents ou faux.", { statut: 503, code: 'asr_identifiants' });
    case 413:
      return new ErreurAsr("L'enregistrement est trop long (60 secondes au plus).", { statut: 413, code: 'audio_trop_long' });
    case 415:
      return new ErreurAsr("Le format audio n'a pas pu être lu.", { statut: 415, code: 'audio_illisible' });
    case 422:
      return new ErreurAsr("L'enregistrement est trop court. Parlez au moins une seconde.", { statut: 422, code: 'audio_trop_court' });
    case 503:
      return new ErreurAsr('Le lexique du marché est momentanément indisponible. Réessayez dans une minute.', { statut: 503, code: 'asr_indisponible' });
    default:
      return new ErreurAsr(`Le service de reconnaissance vocale est momentanément indisponible${detail ? ` (${detail})` : ''}. Réessayez dans une minute.`, { statut: 503, code: 'asr_indisponible' });
  }
}

export function creerClientAsr({
  url = 'https://51-159-167-70.sslip.io',
  identifiant,
  motDePasse,
  simulation = false,
  delaiMs = 120_000,
  fetch = globalThis.fetch,
} = {}) {
  const configure = Boolean(identifiant && motDePasse);
  const auth = configure ? 'Basic ' + Buffer.from(`${identifiant}:${motDePasse}`).toString('base64') : null;

  // L'API traite une requête à la fois : on n'en envoie qu'une à la fois.
  let file = Promise.resolve();
  function enFile(tache) {
    const resultat = file.then(tache, tache);
    file = resultat.catch(() => {});
    return resultat;
  }

  async function appeler(chemin, audio, typeMime, parametres = {}) {
    if (simulation) return simuler(chemin);
    if (!configure) {
      throw new ErreurAsr("Le serveur n'a pas les identifiants de l'API de reconnaissance vocale (ASR_ID et ASR_MDP).", { statut: 503, code: 'asr_identifiants' });
    }
    const corps = new FormData();
    corps.append('file', new Blob([audio], { type: typeMime || 'application/octet-stream' }), `phrase.${extensionAudio(typeMime)}`);
    const requete = new URL(chemin, url);
    for (const [cle, valeur] of Object.entries(parametres)) {
      if (valeur !== undefined && valeur !== null && valeur !== '') requete.searchParams.set(cle, valeur);
    }
    return enFile(async () => {
      let reponse;
      try {
        reponse = await fetch(requete, {
          method: 'POST',
          headers: { Authorization: auth },
          body: corps,
          signal: AbortSignal.timeout(delaiMs),
        });
      } catch (e) {
        const message = e?.name === 'TimeoutError'
          ? 'Le service de reconnaissance vocale met trop de temps à répondre. Réessayez.'
          : 'Impossible de joindre le service de reconnaissance vocale. Réessayez dans une minute.';
        throw new ErreurAsr(message, { statut: 504, code: 'asr_injoignable' });
      }
      if (!reponse.ok) {
        let detail = '';
        try { detail = (await reponse.json()).detail ?? ''; } catch { /* corps non JSON */ }
        throw erreurDepuisReponse(reponse.status, typeof detail === 'string' ? detail : '');
      }
      return reponse.json();
    });
  }

  return {
    configure,
    simulation,
    // Modèle général : texte fon d'une phrase libre.
    transcrire: (audio, typeMime, { noms = [] } = {}) =>
      appeler('/transcribe', audio, typeMime, { app_version: VERSION_APPLI, noms: noms.slice(0, 50).join(',') }),
    // Mode marché : produits reconnus dans le lexique, avec catégorie et montant.
    marche: (audio, typeMime) => appeler('/marche', audio, typeMime),
  };
}

// Réponses factices au format de l'API, pour essayer l'interface sans identifiants
// (ASR_SIMULATION=1). L'interface affiche alors clairement « mode simulation ».
const EXEMPLES_MARCHE = [
  { transcription: 'gbàdé glazuwé', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé', categorie: 'alimentation', montant: null, montant_manquant: true }] },
  { transcription: 'mɔ̌likún', produits: [{ terme: 'mɔ̌likún', terme_canonique: 'mɔ̌likún', categorie: 'alimentation', montant: null, montant_manquant: true }] },
  { transcription: 'timáti dantɔkpa', produits: [{ terme: 'timáti', terme_canonique: 'timáti', categorie: 'alimentation', montant: null, montant_manquant: true }] },
];
const EXEMPLES_TRANSCRIPTION = ['gbàdé ama jaunissent', 'timáti ama taches'];
let compteurSimulation = 0;

function simuler(chemin) {
  const n = compteurSimulation++;
  const id = `simulation-${Date.now()}`;
  if (chemin === '/marche') {
    const ex = EXEMPLES_MARCHE[n % EXEMPLES_MARCHE.length];
    return Promise.resolve({ ...ex, montant_total: 0, montant_manquant: true, moteur: 'simulation', duree_audio_s: 3, id });
  }
  const texte = EXEMPLES_TRANSCRIPTION[n % EXEMPLES_TRANSCRIPTION.length];
  return Promise.resolve({
    texte,
    texte_sans_tons: texte.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC'),
    texte_ponctue: texte[0].toUpperCase() + texte.slice(1) + '.',
    moteur: 'simulation',
    duree_audio_s: 3,
    id,
  });
}
