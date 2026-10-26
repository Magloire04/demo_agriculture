// Lecture à voix haute des réponses en fongbé. Deux voix :
// - la phrase entière (voix JML), demandée au serveur dès l'arrivée de la réponse et
//   gardée en mémoire (api/voix/<id>.wav) ;
// - en repli, les extraits audio préparés à l'avance (voix/), joués l'un après l'autre.
// Un seul élément <audio> sert aux deux : débloqué par l'appui, il continue de jouer
// après une attente, y compris sur iPhone en mode silencieux.

const PAUSE_MS = 80; // entre deux extraits
const ATTENTE_APPUI_MS = 5000; // attente de la phrase entière après l'appui, au plus
const ESSAIS_MAX = 12; // demandes de la phrase entière après « pas encore prête »
let lecteur = null;
let enCours = null; // lecture ou attente en cours : { arreter() }
let silence = null;

// Phrases entières : identifiant → { etat: 'demande' | 'attente' | 'pret' | 'abandon', url, abonnes }.
// « demande » : la première demande est en route ; « attente » : le serveur a répondu
// « pas encore prête », une nouvelle demande partira plus tard.
const phrases = new Map();

function changerEtat(suivi, etat) {
  suivi.etat = etat;
  for (const f of suivi.abonnes.splice(0)) f();
}

async function charger(id, suivi, essai) {
  let reponse;
  try {
    reponse = await fetch(`api/voix/${id}.wav`);
  } catch {
    return changerEtat(suivi, 'abandon');
  }
  if (reponse.status === 200) {
    const son = await reponse.blob().catch(() => null);
    if (!son) return changerEtat(suivi, 'abandon');
    suivi.url = URL.createObjectURL(son);
    return changerEtat(suivi, 'pret');
  }
  if (reponse.status === 202 && essai + 1 < ESSAIS_MAX) {
    const delai = Number(reponse.headers.get('Retry-After')) || 10;
    setTimeout(() => charger(id, suivi, essai + 1), delai * 1000);
    return changerEtat(suivi, 'attente');
  }
  changerEtat(suivi, 'abandon');
}

// Demande la phrase entière en arrière-plan, une seule fois par identifiant.
export function prechargerPhrase(id) {
  if (!id || phrases.has(id)) return;
  const suivi = { etat: 'demande', url: null, abonnes: [] };
  phrases.set(id, suivi);
  charger(id, suivi, 0);
}

// Rend true si la phrase est prête dans le délai, false sinon (ou si elle ne le sera pas).
function attendrePret(suivi, delaiMs) {
  return new Promise((ok) => {
    const minuterie = setTimeout(() => ok(false), delaiMs);
    const verifier = () => {
      if (suivi.etat === 'demande') return suivi.abonnes.push(verifier);
      clearTimeout(minuterie);
      ok(suivi.etat === 'pret');
    };
    verifier();
  });
}

// Court silence (50 ms) joué dans le geste de l'utilisateur pour débloquer le lecteur.
function wavSilence() {
  const n = 400; // 50 ms à 8 kHz
  const vue = new DataView(new ArrayBuffer(44 + 2 * n));
  const ecrire = (position, texte) => [...texte].forEach((c, i) => vue.setUint8(position + i, c.charCodeAt(0)));
  ecrire(0, 'RIFF');
  vue.setUint32(4, 36 + 2 * n, true);
  ecrire(8, 'WAVEfmt ');
  vue.setUint32(16, 16, true);
  vue.setUint16(20, 1, true);
  vue.setUint16(22, 1, true);
  vue.setUint32(24, 8000, true);
  vue.setUint32(28, 16000, true);
  vue.setUint16(32, 2, true);
  vue.setUint16(34, 16, true);
  ecrire(36, 'data');
  vue.setUint32(40, 2 * n, true);
  return new Blob([vue.buffer], { type: 'audio/wav' });
}

function debloquer() {
  lecteur ??= new Audio();
  silence ??= URL.createObjectURL(wavSilence());
  lecteur.src = silence;
  lecteur.play().catch(() => {});
}

export function arreterLecture() {
  enCours?.arreter();
  enCours = null;
}

// Joue les sons l'un après l'autre sur le lecteur ; la promesse se résout à la fin.
function jouerSons(urls) {
  arreterLecture();
  lecteur ??= new Audio();
  return new Promise((fin, echec) => {
    let rang = 0;
    let attente = 0;
    let fini = false;
    const terminer = (erreur) => {
      // Un play() interrompu échoue après coup : il ne doit pas toucher à la lecture suivante.
      if (fini) return;
      fini = true;
      clearTimeout(attente);
      lecteur.onended = null;
      lecteur.onerror = null;
      lecteur.pause();
      if (enCours === lecture) enCours = null;
      if (erreur) echec(erreur);
      else fin();
    };
    const jouer = () => {
      lecteur.src = urls[rang];
      lecteur.play().catch(terminer);
    };
    const lecture = { arreter: () => terminer() };
    lecteur.onended = () => {
      rang += 1;
      if (rang >= urls.length) return terminer();
      attente = setTimeout(jouer, PAUSE_MS);
    };
    lecteur.onerror = () => terminer(new Error(`Son illisible : ${urls[rang]}`));
    enCours = lecture;
    jouer();
  });
}

// À appeler depuis le geste de l'utilisateur, sans attente avant : le premier
// play() doit partir de l'appui.
export function lireExtraits(fichiers) {
  const urls = fichiers.map((f) => `voix/${f}`);
  // Les suivants se chargent pendant la lecture du premier (le service worker les garde).
  for (const url of urls.slice(1)) fetch(url).catch(() => {});
  return jouerSons(urls);
}

// À appeler depuis le geste de l'utilisateur. Phrase entière prête : elle est jouée.
// Première demande encore en route : attente de 5 s au plus. Sinon, les extraits.
// `surLecture` reçoit la voix choisie ('nouvelle' ou 'ancienne') au début de la lecture.
// Rend cette voix à la fin, ou null si l'utilisateur a arrêté pendant l'attente.
export async function lireReponse({ phrase = null, extraits = null }, { surAttente = () => {}, surLecture = () => {} } = {}) {
  arreterLecture();
  debloquer();
  const suivi = phrase ? phrases.get(phrase) : null;
  let pret = suivi?.etat === 'pret';
  if (!pret && suivi?.etat === 'demande') {
    let annuler;
    const attente = { arreter: () => annuler(false) };
    const annulation = new Promise((ok) => { annuler = ok; });
    enCours = attente;
    surAttente();
    pret = await Promise.race([attendrePret(suivi, ATTENTE_APPUI_MS), annulation.then(() => null)]);
    if (pret === null) return null;
    if (enCours === attente) enCours = null;
  }
  if (pret) {
    surLecture('nouvelle');
    await jouerSons([suivi.url]);
    return 'nouvelle';
  }
  if (!extraits) throw new Error('Aucune voix disponible pour cette réponse.');
  surLecture('ancienne');
  await lireExtraits(extraits);
  return 'ancienne';
}
