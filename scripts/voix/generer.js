// Génère les extraits audio de public/voix avec l'API de synthèse fon FongLab.
// Voix par défaut : A1 (lecture de la Bible), la plus intelligible des voix de
// l'API (29,8 % de mots mal reconnus, contre 54 à 81 % pour les voix M3).
//
//   node scripts/voix/generer.js                      extraits manquants
//   node scripts/voix/generer.js --tout               tous les extraits
//   node scripts/voix/generer.js --refaire 1a2b….mp3  ces extraits seulement
//   node scripts/voix/generer.js --modele m3 --voix 12
//
// Adresse et clé de l'API dans .env : FONGLAB_TTS_URL, FONGLAB_TTS_API_KEY. À
// lancer sur un poste où ffmpeg est installé (conversion du WAV en MP3). Sans
// --tout ni --refaire, un extrait présent est gardé : un enregistrement humain
// déposé sous le même nom n'est jamais écrasé.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fichierVoix, listerMorceaux } from '../../server/voix.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOSSIER = path.join(RACINE, 'public', 'voix');

function options() {
  const args = process.argv.slice(2);
  const valeur = (nom, defaut) => (args.includes(nom) ? args[args.indexOf(nom) + 1] : defaut);
  const i = args.indexOf('--refaire');
  const refaire = i < 0 ? [] : args.slice(i + 1).filter((a) => !a.startsWith('--'))
    .map((a) => path.basename(a).replace(/(\.mp3)?$/, '.mp3'));
  return { tout: args.includes('--tout'), refaire, modele: valeur('--modele', 'a1'), voix: Number(valeur('--voix', 0)) };
}

// Le modèle n'a pas de « r » : on le dit « l », comme en fon (« lǐtli » pour litre).
const aDire = (texte) => texte.replace(/r/g, 'l').replace(/R/g, 'L');

async function synthetiser(url, cle, texte, { modele, voix }) {
  for (let essai = 1; ; essai++) {
    try {
      const reponse = await fetch(`${url}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': cle },
        body: JSON.stringify({ texte: aDire(texte), modele, voix, verbalize: false }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!reponse.ok) {
        const erreur = new Error(`HTTP ${reponse.status} : ${(await reponse.text()).slice(0, 200)}`);
        erreur.definitive = reponse.status < 500; // clé refusée, texte rejeté : inutile de réessayer
        throw erreur;
      }
      return Buffer.from(await reponse.arrayBuffer());
    } catch (e) {
      if (e.definitive || essai === 3) throw e;
      await new Promise((ok) => setTimeout(ok, 5000 * essai));
    }
  }
}

async function principal() {
  try {
    process.loadEnvFile(path.join(RACINE, '.env'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const url = (process.env.FONGLAB_TTS_URL ?? '').replace(/\/$/, '');
  const cle = process.env.FONGLAB_TTS_API_KEY;
  if (!url || !cle) throw new Error('FONGLAB_TTS_URL et FONGLAB_TTS_API_KEY sont à renseigner dans .env');
  const opts = options();

  const lire = async (relatif) => JSON.parse(await readFile(path.join(RACINE, relatif), 'utf8'));
  const [reponses, base, { communes }] = await Promise.all([
    lire('data/reponses.json'), lire('data/referentiel.json'), lire('data/communes.json'),
  ]);
  const liste = listerMorceaux(reponses, base, communes).map((texte) => ({ texte, fichier: fichierVoix(texte) }));
  const inconnus = opts.refaire.filter((f) => !liste.some((x) => x.fichier === f));
  if (inconnus.length) throw new Error(`Absents de la liste des extraits : ${inconnus.join(', ')}`);
  const aFaire = liste.filter((x) => opts.tout || opts.refaire.includes(x.fichier)
    || (!opts.refaire.length && !existsSync(path.join(DOSSIER, x.fichier))));
  console.log(`${aFaire.length} extraits à générer sur ${liste.length} (modèle ${opts.modele}, voix ${opts.voix}).`);

  await mkdir(DOSSIER, { recursive: true });
  for (const [i, x] of aFaire.entries()) {
    const wav = await synthetiser(url, cle, x.texte, opts);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-ac', '1', '-b:a', '40k', path.join(DOSSIER, x.fichier)], { input: wav });
    console.log(`${i + 1}/${aFaire.length}  ${x.fichier}  ${x.texte}`);
  }
}

principal().catch((e) => {
  console.error(`Génération interrompue : ${e.message}`);
  process.exit(1);
});
