// Relecture des solutions par un locuteur du fon.
//
//   node scripts/relecture-solutions.js exporter relecture.csv   fiche à ouvrir dans un tableur
//   node scripts/relecture-solutions.js importer relecture.csv   reprend les colonnes fon et voix
//
// Le locuteur corrige le fon affiché (doses en chiffres) et le texte dit par la
// voix (nombres en toutes lettres). L'import signale toute ligne où l'un des deux
// a changé sans l'autre. Il ne régénère pas l'audio : relancer ensuite
// scripts/voix/generer.js --point --refaire … pour les extraits corrigés.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exporterCsv, importerCsv } from './relecture/csv.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = path.join(RACINE, 'data', 'solutions.json');
const [action, fichier] = process.argv.slice(2);

if (!['exporter', 'importer'].includes(action) || !fichier) {
  console.error('Usage : node scripts/relecture-solutions.js exporter|importer <fichier.csv>');
  process.exit(1);
}

const donnees = JSON.parse(await readFile(DONNEES, 'utf8'));
if (action === 'exporter') {
  await writeFile(fichier, exporterCsv(donnees));
  console.log(`Fiche de relecture écrite : ${fichier}`);
} else {
  let resultat;
  try {
    resultat = importerCsv(await readFile(fichier, 'utf8'), donnees);
  } catch (e) {
    console.error(`Import refusé : ${e.message}`);
    process.exit(1);
  }
  const { donnees: corrigees, alertes } = resultat;
  await writeFile(DONNEES, `${JSON.stringify(corrigees, null, 2)}\n`);
  console.log(`Corrections reprises dans ${path.relative(RACINE, DONNEES)}.`);
  for (const a of alertes) console.log(`  attention : ${a}`);
}
