// Définit le mot de passe du back office, sur le serveur :
//
//   node scripts/admin-mot-de-passe.js               dans le .env de l'application
//   node scripts/admin-mot-de-passe.js --env x/.env  dans un autre fichier
//
// Le mot de passe est demandé deux fois sans être affiché. Seule son empreinte
// (scrypt) est écrite dans la ligne ADMIN_MDP_EMPREINTE du .env, lisible par le
// seul compte. Redémarrer ensuite l'application pour qu'elle la prenne en compte.

import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { empreinteMotDePasse } from '../server/admin.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LONGUEUR_MIN = 12;

function cheminEnv() {
  const i = process.argv.indexOf('--env');
  return path.resolve(i > 0 ? process.argv[i + 1] : path.join(RACINE, '.env'));
}

// Saisie masquée au clavier : rien n'est affiché pendant la frappe.
function demanderCache(question) {
  return new Promise((ok) => {
    const entree = process.stdin;
    process.stdout.write(question);
    entree.setRawMode(true);
    entree.setEncoding('utf8');
    entree.resume();
    let saisi = '';
    const lire = (texte) => {
      for (const c of texte) {
        if (c === '\r' || c === '\n') {
          entree.setRawMode(false);
          entree.pause();
          entree.off('data', lire);
          process.stdout.write('\n');
          return ok(saisi);
        }
        if (c === '\u0003') process.exit(130); // Ctrl+C
        if (c === '\u007f' || c === '\b') saisi = saisi.slice(0, -1);
        else saisi += c;
      }
    };
    entree.on('data', lire);
  });
}

async function lireMotsDePasse() {
  if (process.stdin.isTTY) {
    return [await demanderCache(`Mot de passe (${LONGUEUR_MIN} caractères au moins) : `), await demanderCache('Le même, une seconde fois : ')];
  }
  const lignes = [];
  for await (const ligne of readline.createInterface({ input: process.stdin })) {
    lignes.push(ligne);
    if (lignes.length === 2) break;
  }
  return lignes;
}

async function principal() {
  const env = cheminEnv();
  const [premier = '', second = ''] = await lireMotsDePasse();
  if (premier !== second) throw new Error('les deux saisies diffèrent');
  if ([...premier].length < LONGUEUR_MIN) throw new Error(`le mot de passe doit compter ${LONGUEUR_MIN} caractères au moins`);

  let contenu = '';
  try {
    contenu = await readFile(env, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const ligne = `ADMIN_MDP_EMPREINTE=${empreinteMotDePasse(premier)}`;
  const lignes = contenu.split('\n').filter((l) => !l.startsWith('ADMIN_MDP_EMPREINTE='));
  while (lignes.length && lignes.at(-1) === '') lignes.pop();
  lignes.push(ligne, '');
  await writeFile(env, lignes.join('\n'), { mode: 0o600 });
  await chmod(env, 0o600);
  console.log(`Empreinte du mot de passe enregistrée dans ${env}. Redémarrez l'application pour l'appliquer.`);
}

principal().catch((e) => {
  console.error(`Mot de passe non enregistré : ${e.message}.`);
  process.exit(1);
});
