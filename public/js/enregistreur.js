// Enregistrement au micro (MediaRecorder). Le serveur de l'API convertit lui-même
// en mono 16 kHz ; on demande déjà du mono, avec réduction de bruit.

const FORMATS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
];

export function enregistrementPossible() {
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

// Démarre l'enregistrement. Rend { fin, arreter, annuler } :
// `fin` se résout avec { blob, duree } quand l'enregistrement s'arrête
// (appui sur arreter() ou durée maximale atteinte).
export async function demarrerEnregistrement({ dureeMax = 30, surProgression = () => {} } = {}) {
  const flux = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const format = FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
  const enregistreur = new MediaRecorder(flux, format ? { mimeType: format, audioBitsPerSecond: 48000 } : undefined);
  const morceaux = [];
  enregistreur.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) morceaux.push(e.data);
  });

  // Niveau sonore, pour montrer que le micro entend bien.
  let contexte = null;
  let analyseur = null;
  try {
    contexte = new AudioContext();
    await contexte.resume();
    analyseur = contexte.createAnalyser();
    analyseur.fftSize = 512;
    contexte.createMediaStreamSource(flux).connect(analyseur);
  } catch {
    analyseur = null;
  }
  const echantillons = new Uint8Array(512);

  const debut = performance.now();
  let animation = 0;
  let annule = false;
  function suivre() {
    const secondes = (performance.now() - debut) / 1000;
    let niveau = 0;
    if (analyseur) {
      analyseur.getByteTimeDomainData(echantillons);
      let somme = 0;
      for (const v of echantillons) somme += ((v - 128) / 128) ** 2;
      niveau = Math.min(1, Math.sqrt(somme / echantillons.length) * 4);
    }
    surProgression({ secondes, niveau });
    if (secondes >= dureeMax && enregistreur.state === 'recording') enregistreur.stop();
    else animation = requestAnimationFrame(suivre);
  }

  const fin = new Promise((resoudre, rejeter) => {
    enregistreur.addEventListener('stop', () => {
      cancelAnimationFrame(animation);
      flux.getTracks().forEach((piste) => piste.stop());
      contexte?.close().catch(() => {});
      if (annule) return rejeter(new DOMException('Enregistrement annulé', 'AbortError'));
      const type = enregistreur.mimeType || format || 'audio/webm';
      resoudre({ blob: new Blob(morceaux, { type }), duree: (performance.now() - debut) / 1000 });
    });
    enregistreur.addEventListener('error', (e) => rejeter(e.error ?? new Error("Erreur d'enregistrement")));
  });

  enregistreur.start();
  animation = requestAnimationFrame(suivre);

  return {
    fin,
    arreter() {
      if (enregistreur.state !== 'inactive') enregistreur.stop();
    },
    annuler() {
      annule = true;
      if (enregistreur.state !== 'inactive') enregistreur.stop();
    },
  };
}
