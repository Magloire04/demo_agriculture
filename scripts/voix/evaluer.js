// Fait relire les extraits audio par la reconnaissance vocale JaimeMaLangue et
// mesure l'écart entre ce qu'elle entend et le texte attendu : distance d'édition
// sur les lettres, sans tons ni accents, rapportée à la longueur du texte (0 : relu
// à l'identique, 1 : rien de commun). Sert à comparer deux voix de synthèse et à
// repérer les extraits à regénérer avec une autre graine.
//
//   node scripts/voix/evaluer.js                              extraits de public/voix
//   node scripts/voix/evaluer.js --dossier essai --json r.json  autre dossier, détail en JSON
//   node scripts/voix/evaluer.js --fichiers 1a2b….mp3 …          ces extraits seulement
//
// Identifiants de l'API dans .env : ASR_ID, ASR_MDP. Une requête à la fois, comme
// l'exige l'API : compter une à deux secondes par extrait.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerClientAsr } from '../../server/asr.js';
import { morceauxDeMontants } from '../../server/nombres-fon.js';
import { distance, normaliser } from '../../server/texte.js';
import { fichierVoix, listerMorceaux, texteVoix } from '../../server/voix.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function options() {
  const args = process.argv.slice(2);
  const valeur = (nom, defaut) => (args.includes(nom) ? args[args.indexOf(nom) + 1] : defaut);
  const i = args.indexOf('--fichiers');
  const fichiers = i < 0 ? [] : args.slice(i + 1).filter((a) => !a.startsWith('--'))
    .map((a) => path.basename(a).replace(/(\.mp3)?$/, '.mp3'));
  return {
    dossier: path.resolve(RACINE, valeur('--dossier', path.join('public', 'voix'))),
    json: valeur('--json', null),
    fichiers,
  };
}

// La voix de synthèse dit « l » pour « r » : c'est ce qu'elle doit faire entendre.
function ecart(attendu, entendu) {
  const a = normaliser(attendu.replace(/r/gi, 'l'));
  const b = normaliser(entendu);
  return a ? Math.min(1, distance(a, b) / a.length) : 0;
}

const moyenne = (valeurs) => (valeurs.length ? valeurs.reduce((s, v) => s + v, 0) / valeurs.length : 0);
const pourcent = (v) => `${(100 * v).toFixed(1)} %`;

async function principal() {
  try {
    process.loadEnvFile(path.join(RACINE, '.env'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const asr = creerClientAsr({ url: process.env.ASR_URL || undefined, identifiant: process.env.ASR_ID, motDePasse: process.env.ASR_MDP });
  if (!asr.configure) throw new Error('ASR_ID et ASR_MDP sont à renseigner dans .env');
  const opts = options();

  const lire = async (relatif) => JSON.parse(await readFile(path.join(RACINE, relatif), 'utf8'));
  const [reponses, base, { communes }] = await Promise.all([
    lire('data/reponses.json'), lire('data/referentiel.json'), lire('data/communes.json'),
  ]);
  const montants = new Set(morceauxDeMontants().map(texteVoix));
  const liste = listerMorceaux(reponses, base, communes)
    .map((texte) => ({ texte, fichier: fichierVoix(texte), montant: montants.has(texte) }))
    .filter((x) => (opts.fichiers.length ? opts.fichiers.includes(x.fichier) : true))
    .filter((x) => existsSync(path.join(opts.dossier, x.fichier)));
  console.log(`${liste.length} extraits à relire dans ${opts.dossier}.`);

  const resultats = [];
  for (const [i, x] of liste.entries()) {
    const audio = await readFile(path.join(opts.dossier, x.fichier));
    const reponse = await asr.transcrire(audio, 'audio/mpeg');
    const entendu = reponse.texte ?? '';
    resultats.push({ ...x, entendu, ecart: ecart(x.texte, entendu) });
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${liste.length}`);
  }

  const montantsRelus = resultats.filter((r) => r.montant).map((r) => r.ecart);
  const phrasesRelues = resultats.filter((r) => !r.montant).map((r) => r.ecart);
  console.log(`Écart moyen : montants ${pourcent(moyenne(montantsRelus))} (${montantsRelus.length}), `
    + `phrases ${pourcent(moyenne(phrasesRelues))} (${phrasesRelues.length}), `
    + `ensemble ${pourcent(moyenne(resultats.map((r) => r.ecart)))}.`);
  console.log(`Relus à l'identique : ${resultats.filter((r) => r.ecart === 0).length} sur ${resultats.length}.`);
  console.log('Les plus mal relus :');
  for (const r of [...resultats].sort((a, b) => b.ecart - a.ecart).slice(0, 10)) {
    console.log(`  ${pourcent(r.ecart).padStart(7)}  ${r.fichier}  « ${r.texte} » entendu « ${r.entendu} »`);
  }
  if (opts.json) await writeFile(path.resolve(opts.json), `${JSON.stringify(resultats, null, 2)}\n`);
}

principal().catch((e) => {
  console.error(`Relecture interrompue : ${e.message}`);
  process.exit(1);
});
