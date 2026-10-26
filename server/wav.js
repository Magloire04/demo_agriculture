// Sons WAV PCM 16 bits mono : lecture, écriture, changement de fréquence et
// assemblage. Sert à ramener la voix du labo (24 kHz) à 16 kHz, plus légère, sans
// outil extérieur (pas de ffmpeg sur l'hébergement).

const nonPrisEnCharge = (raison) => new Error(`WAV non pris en charge : ${raison}`);

export function lireWav(tampon) {
  if (tampon.length < 12 || tampon.toString('latin1', 0, 4) !== 'RIFF' || tampon.toString('latin1', 8, 12) !== 'WAVE') {
    throw nonPrisEnCharge('ce n’est pas un fichier WAV');
  }
  let format = null;
  for (let i = 12; i + 8 <= tampon.length;) {
    const id = tampon.toString('latin1', i, i + 4);
    const taille = tampon.readUInt32LE(i + 4);
    const debut = i + 8;
    if (debut + taille > tampon.length) throw nonPrisEnCharge(`bloc « ${id} » tronqué`);
    if (id === 'fmt ') {
      format = {
        codage: tampon.readUInt16LE(debut),
        canaux: tampon.readUInt16LE(debut + 2),
        frequence: tampon.readUInt32LE(debut + 4),
        bits: tampon.readUInt16LE(debut + 14),
      };
    } else if (id === 'data') {
      if (!format) throw nonPrisEnCharge('bloc « data » avant le format');
      if (format.codage !== 1 || format.canaux !== 1 || format.bits !== 16) {
        throw nonPrisEnCharge(`codage ${format.codage}, ${format.canaux} canaux, ${format.bits} bits (attendu : PCM 16 bits mono)`);
      }
      const echantillons = new Int16Array(Math.floor(taille / 2));
      for (let k = 0; k < echantillons.length; k++) echantillons[k] = tampon.readInt16LE(debut + 2 * k);
      return { frequence: format.frequence, echantillons };
    }
    i = debut + taille + (taille % 2);
  }
  throw nonPrisEnCharge('pas de bloc « data »');
}

export function ecrireWav({ frequence, echantillons }) {
  const octets = echantillons.length * 2;
  const tampon = Buffer.alloc(44 + octets);
  tampon.write('RIFF', 0, 'latin1');
  tampon.writeUInt32LE(36 + octets, 4);
  tampon.write('WAVEfmt ', 8, 'latin1');
  tampon.writeUInt32LE(16, 16);
  tampon.writeUInt16LE(1, 20); // PCM
  tampon.writeUInt16LE(1, 22); // mono
  tampon.writeUInt32LE(frequence, 24);
  tampon.writeUInt32LE(frequence * 2, 28);
  tampon.writeUInt16LE(2, 32);
  tampon.writeUInt16LE(16, 34);
  tampon.write('data', 36, 'latin1');
  tampon.writeUInt32LE(octets, 40);
  for (let k = 0; k < echantillons.length; k++) tampon.writeInt16LE(echantillons[k], 44 + 2 * k);
  return tampon;
}

// Interpolation par sinus cardinal fenêtré (Blackman), 16 échantillons d'entrée de
// part et d'autre. Coupure à 0,45 fois la plus petite des deux fréquences : en
// descendant de 24 à 16 kHz, rien au-dessus de 7,2 kHz ne se replie dans le son.
const DEMI_LARGEUR = 16;

export function reechantillonner(echantillons, de, vers) {
  if (de === vers) return Int16Array.from(echantillons);
  const coupure = (0.45 * Math.min(de, vers)) / de; // en cycles par échantillon d'entrée
  const noyau = (d) => {
    if (Math.abs(d) >= DEMI_LARGEUR) return 0;
    const x = 2 * coupure * d;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const fenetre = 0.42 + 0.5 * Math.cos((Math.PI * d) / DEMI_LARGEUR) + 0.08 * Math.cos((2 * Math.PI * d) / DEMI_LARGEUR);
    return sinc * fenetre;
  };
  // Les poids ne dépendent que du décalage fractionnaire (n·de mod vers) : calculés
  // une fois par décalage (2 seulement de 24 à 16 kHz), puis réutilisés. Sans cela, le
  // calcul figeait le serveur près d'une seconde pour 30 s de son.
  const poidsParDecalage = new Map();
  const poidsDe = (reste) => {
    let poids = poidsParDecalage.get(reste);
    if (!poids) {
      poids = new Float64Array(2 * DEMI_LARGEUR);
      let total = 0;
      for (let j = 0; j < poids.length; j++) {
        poids[j] = noyau(reste / vers - (j - DEMI_LARGEUR + 1));
        total += poids[j];
      }
      // Les poids sont ramenés à 1 : un son constant garde son niveau.
      for (let j = 0; j < poids.length; j++) poids[j] /= total;
      poidsParDecalage.set(reste, poids);
    }
    return poids;
  };
  const sortie = new Int16Array(Math.round((echantillons.length * vers) / de));
  for (let n = 0; n < sortie.length; n++) {
    const centre = Math.floor((n * de) / vers);
    const poids = poidsDe((n * de) % vers);
    const premier = centre - DEMI_LARGEUR + 1;
    let somme = 0;
    for (let j = 0; j < poids.length; j++) {
      const k = premier + j;
      if (k >= 0 && k < echantillons.length) somme += echantillons[k] * poids[j];
    }
    sortie[n] = Math.max(-32768, Math.min(32767, Math.round(somme)));
  }
  return sortie;
}

export function assembler(sons, frequence, silenceMs) {
  const silence = Math.round((frequence * silenceMs) / 1000);
  const total = sons.reduce((s, son) => s + son.length, 0) + silence * Math.max(0, sons.length - 1);
  const sortie = new Int16Array(total);
  let position = 0;
  sons.forEach((son, i) => {
    if (i > 0) position += silence;
    sortie.set(son, position);
    position += son.length;
  });
  return sortie;
}
