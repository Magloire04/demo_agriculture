// « Signalement d'une maladie des cultures » : repère la culture, la partie touchée
// et le symptôme dans la transcription, puis enregistre le signalement pour le
// conseiller agricole.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mots, normaliser, reperer } from './texte.js';

const termesLexique = (e) => [...e.fon, ...e.fr];
const LETTRE_FON = /[ɔɛɖŋƒʋɣɑ]/;

// Comme mots(), mais en gardant les lettres fon : « ɖù » reste « ɖu », distinct de « du ».
function motsAvecLettresFon(texte) {
  return String(texte ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/[^a-z0-9ɔɛɖŋƒʋɣɑ]+/g, ' ').trim().split(' ').filter(Boolean);
}

// Un terme fon court qui porte une lettre fon doit être entendu avec cette lettre :
// sans elle, « ɖù » (manger) se confondrait avec l'article français « du ».
function termesSurs(texte) {
  const motsFon = motsAvecLettresFon(texte);
  const entendu = (terme) => {
    const cible = motsAvecLettresFon(terme);
    return motsFon.some((_, i) => cible.every((m, k) => motsFon[i + k] === m));
  };
  return (e) => termesLexique(e).filter((t) => !LETTRE_FON.test(t) || mots(t).join('').length > 3 || entendu(t));
}

export function analyserSignalement(lexique, communes, texte) {
  const motsTexte = mots(texte);
  const culture = reperer(motsTexte, lexique.cultures, termesLexique)[0];
  // Beaucoup de mots de symptômes sont courts ou courants en fon : on les veut exacts.
  const termes = termesSurs(texte);
  const parties = reperer(motsTexte, lexique.parties, termes, { exact: true });
  const symptomes = reperer(motsTexte, lexique.symptomes, termes, { exact: true });
  // Les noms de commune très courts (« Zè ») se confondraient avec des mots fon.
  const commune = reperer(motsTexte, communes.filter((c) => normaliser(c.nom).replace(/ /g, '').length >= 4), (c) => c.termes)[0];
  return {
    culture: culture ? { id: culture.entree.id, nom: culture.entree.nom, entendu: culture.terme } : null,
    parties: parties.sort((a, b) => a.position - b.position).map((p) => ({ id: p.entree.id, libelle: p.entree.libelle })),
    symptomes: symptomes.sort((a, b) => a.position - b.position).map((s) => ({ id: s.entree.id, libelle: s.entree.libelle })),
    commune: commune ? { nom: commune.entree.nom, departement: commune.entree.departement } : null,
  };
}

export function destinataire(commune) {
  return commune
    ? `Conseiller agricole de la commune de ${commune.nom} (${commune.departement})`
    : 'Conseiller agricole le plus proche de votre position';
}

// Registre des signalements, gardé dans un fichier JSON (et les audios à côté).
export async function creerRegistre(dossier) {
  const fichier = path.join(dossier, 'signalements.json');
  const dossierAudio = path.join(dossier, 'audio');
  await mkdir(dossierAudio, { recursive: true });
  let signalements = [];
  try {
    signalements = JSON.parse(await readFile(fichier, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  let ecriture = Promise.resolve();
  function sauver() {
    const contenu = JSON.stringify(signalements, null, 1);
    ecriture = ecriture.then(async () => {
      await writeFile(`${fichier}.tmp`, contenu);
      await rename(`${fichier}.tmp`, fichier);
    });
    return ecriture;
  }

  function nouvelleReference(date) {
    const jour = date.toISOString().slice(0, 10).replace(/-/g, '');
    const prefixe = `SIG-${jour}-`;
    const rang = signalements.filter((s) => s.reference.startsWith(prefixe)).length + 1;
    return prefixe + String(rang).padStart(3, '0');
  }

  return {
    lister: () => [...signalements].reverse(),
    trouver: (reference) => signalements.find((s) => s.reference === reference) ?? null,
    cheminAudio: (s) => (s.audio ? path.join(dossierAudio, s.audio) : null),

    async ajouter({ audio, extension, ...donnees }) {
      const maintenant = new Date();
      const reference = nouvelleReference(maintenant);
      const signalement = {
        reference,
        recu_le: maintenant.toISOString(),
        statut: 'transmis',
        ...donnees,
        audio: audio ? `${reference}.${extension}` : null,
      };
      signalements.push(signalement);
      if (audio) await writeFile(path.join(dossierAudio, signalement.audio), audio);
      await sauver();
      return signalement;
    },

    async prendreEnCharge(reference) {
      const s = signalements.find((x) => x.reference === reference);
      if (!s) return null;
      if (s.statut !== 'pris_en_charge') {
        s.statut = 'pris_en_charge';
        s.pris_en_charge_le = new Date().toISOString();
        await sauver();
      }
      return s;
    },
  };
}
