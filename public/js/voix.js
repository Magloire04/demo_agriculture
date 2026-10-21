// Lecture à voix haute des réponses. Le fongbé est dit par les extraits audio
// préparés à l'avance (public/voix), enchaînés avec Web Audio ; le français, s'il
// est demandé, par la voix du téléphone.

const PAUSE = 0.08; // secondes entre deux extraits
let contexte = null;
let enCours = null; // { arreter() } de la lecture en cours

export function arreterLecture() {
  enCours?.arreter();
  enCours = null;
}

export async function lireExtraits(fichiers) {
  arreterLecture();
  contexte ??= new AudioContext();
  await contexte.resume();
  const tampons = await Promise.all(fichiers.map(async (fichier) => {
    const reponse = await fetch(`voix/${fichier}`);
    if (!reponse.ok) throw new Error(`Extrait introuvable : ${fichier}`);
    return contexte.decodeAudioData(await reponse.arrayBuffer());
  }));
  let debut = contexte.currentTime + 0.05;
  const sources = tampons.map((tampon) => {
    const source = contexte.createBufferSource();
    source.buffer = tampon;
    source.connect(contexte.destination);
    source.start(debut);
    debut += tampon.duration + PAUSE;
    return source;
  });
  return new Promise((fin) => {
    const lecture = {
      arreter() {
        for (const s of sources) {
          s.onended = null;
          s.stop();
        }
        fin();
      },
    };
    sources.at(-1).onended = () => {
      if (enCours === lecture) enCours = null;
      fin();
    };
    enCours = lecture;
  });
}

export function lireFrancais(texte) {
  arreterLecture();
  return new Promise((fin, echec) => {
    const enonce = new SpeechSynthesisUtterance(texte.replace(/F\sCFA/g, 'francs CFA'));
    enonce.lang = 'fr-FR';
    const voix = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('fr'));
    if (voix) enonce.voice = voix;
    enonce.onend = () => fin();
    enonce.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? fin() : echec(new Error(e.error)));
    enCours = { arreter: () => speechSynthesis.cancel() };
    speechSynthesis.speak(enonce);
  });
}
