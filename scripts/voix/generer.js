// Génère les extraits audio de public/voix avec l'API de synthèse fon FongLab
// (https://tts.princespecial.me). L'API sert une seule voix, A1, apprise sur une
// lecture de la Bible, sous licence CC BY-NC 4.0. Quota du compte : 50 000
// caractères par mois ; la liste complète des extraits en compte environ 12 000.
//
//   node scripts/voix/generer.js                         extraits manquants
//   node scripts/voix/generer.js --tout                  tous les extraits
//   node scripts/voix/generer.js --refaire 1a2b….mp3     ces extraits seulement
//   node scripts/voix/generer.js --graine 2 --refaire …  autre rendu des mêmes textes
//   node scripts/voix/generer.js --tout --dossier essai  ailleurs que dans public/voix
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

function options() {
  const args = process.argv.slice(2);
  const valeur = (nom, defaut) => (args.includes(nom) ? args[args.indexOf(nom) + 1] : defaut);
  const i = args.indexOf('--refaire');
  const refaire = i < 0 ? [] : args.slice(i + 1).filter((a) => !a.startsWith('--'))
    .map((a) => path.basename(a).replace(/(\.mp3)?$/, '.mp3'));
  const graine = Number(valeur('--graine', 0));
  if (!Number.isInteger(graine)) throw new Error('--graine attend un nombre entier');
  return {
    tout: args.includes('--tout'),
    refaire,
    graine,
    dossier: path.resolve(RACINE, valeur('--dossier', path.join('public', 'voix'))),
  };
}

// Le modèle n'a pas de « r » : on le dit « l », comme en fon (« lǐtli » pour litre).
const aDire = (texte) => texte.replace(/r/g, 'l').replace(/R/g, 'L');

async function synthetiser(url, cle, texte, graine) {
  for (let essai = 1; ; essai++) {
    try {
      const reponse = await fetch(`${url}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': cle },
        body: JSON.stringify({ text: aDire(texte), seed: graine }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!reponse.ok) {
        const erreur = new Error(`HTTP ${reponse.status} : ${(await reponse.text()).slice(0, 200)}`);
        // Clé refusée, texte rejeté, quota épuisé : inutile de réessayer.
        erreur.definitive = reponse.status < 500 && reponse.status !== 429;
        throw erreur;
      }
      return Buffer.from(await reponse.arrayBuffer());
    } catch (e) {
      // Le moteur peut mettre une minute à redémarrer (503) : on attend de plus en plus.
      if (e.definitive || essai === 5) throw e;
      await new Promise((ok) => setTimeout(ok, 15_000 * essai));
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
    || (!opts.refaire.length && !existsSync(path.join(opts.dossier, x.fichier))));
  const caracteres = aFaire.reduce((n, x) => n + [...aDire(x.texte)].length, 0);
  console.log(`${aFaire.length} extraits à générer sur ${liste.length} (graine ${opts.graine}, ${caracteres} caractères).`);

  await mkdir(opts.dossier, { recursive: true });
  for (const [i, x] of aFaire.entries()) {
    const wav = await synthetiser(url, cle, x.texte, opts.graine);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-ac', '1', '-b:a', '40k', path.join(opts.dossier, x.fichier)], { input: wav });
    console.log(`${i + 1}/${aFaire.length}  ${x.fichier}  ${x.texte}`);
  }
}

principal().catch((e) => {
  console.error(`Génération interrompue : ${e.message}`);
  process.exit(1);
});
