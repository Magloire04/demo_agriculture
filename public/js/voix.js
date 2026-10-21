// Lecture à voix haute des réponses en fongbé : les extraits audio préparés à
// l'avance (public/voix) sont joués l'un après l'autre par un seul élément
// <audio>. Débloqué par le premier appui, il continue d'enchaîner les extraits,
// y compris sur iPhone en mode silencieux.

const PAUSE_MS = 80; // entre deux extraits
let lecteur = null;
let enCours = null; // lecture en cours : { arreter() }

export function arreterLecture() {
  enCours?.arreter();
  enCours = null;
}

// À appeler depuis le geste de l'utilisateur, sans attente avant : le premier
// play() doit partir de l'appui.
export function lireExtraits(fichiers) {
  arreterLecture();
  lecteur ??= new Audio();
  const urls = fichiers.map((f) => `voix/${f}`);
  // Les suivants se chargent pendant la lecture du premier (le service worker les garde).
  for (const url of urls.slice(1)) fetch(url).catch(() => {});

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
    lecteur.onerror = () => terminer(new Error(`Extrait illisible : ${urls[rang]}`));
    enCours = lecture;
    jouer();
  });
}
