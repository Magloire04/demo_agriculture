// Liste les extraits audio que les réponses peuvent dire, avec le nom de fichier
// attendu dans public/voix, et signale ceux qui manquent.
//
//   node scripts/lister-voix.js                  résumé : extraits présents et manquants
//   node scripts/lister-voix.js --json liste.json écrit la liste complète [{ fichier, texte }]
//
// La liste sert à générer les extraits manquants (scripts/voix/generer.py) ou à
// préparer une séance d'enregistrement avec un locuteur.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fichierVoix, listerMorceaux } from '../server/voix.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = async (relatif) => JSON.parse(await readFile(path.join(RACINE, relatif), 'utf8'));

const [reponses, base, { communes }] = await Promise.all([
  lire('data/reponses.json'), lire('data/referentiel.json'), lire('data/communes.json'),
]);
const liste = listerMorceaux(reponses, base, communes).map((texte) => ({ fichier: fichierVoix(texte), texte }));
const manquants = liste.filter((x) => !existsSync(path.join(RACINE, 'public', 'voix', x.fichier)));

const i = process.argv.indexOf('--json');
if (i > 0) {
  const sortie = process.argv[i + 1];
  if (!sortie || sortie.startsWith('--')) {
    console.error('Usage : node scripts/lister-voix.js [--json liste.json]');
    process.exit(1);
  }
  await writeFile(sortie, `${JSON.stringify(liste, null, 1)}\n`);
}
console.log(`${liste.length} extraits, ${manquants.length} manquants dans public/voix.`);
for (const x of manquants.slice(0, 20)) console.log(`  ${x.fichier}  ${x.texte}`);
if (manquants.length > 20) console.log(`  … et ${manquants.length - 20} autres`);
