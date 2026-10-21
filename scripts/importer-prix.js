// Importe les prix réels du PAM et écrit les relevés lus par le serveur.
//
//   node scripts/importer-prix.js                 télécharge le CSV le plus récent sur HDX
//   node scripts/importer-prix.js --fichier x.csv utilise un CSV déjà téléchargé
//   node scripts/importer-prix.js --sortie y.json écrit ailleurs que dans le dossier de stockage
//
// En cas d'échec, le fichier précédent est conservé et le code de sortie vaut 1.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extraireReleves, lireCsv, SOURCE_PAM } from '../server/pam.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAQUET_HDX = 'https://data.humdata.org/api/3/action/package_show?id=wfp-food-prices-for-benin';

function option(nom) {
  const i = process.argv.indexOf(nom);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// L'adresse du CSV est lue dans les métadonnées du jeu, pour suivre un éventuel changement.
async function telechargerCsv() {
  const reponse = await fetch(PAQUET_HDX, { signal: AbortSignal.timeout(60_000) });
  if (!reponse.ok) throw new Error(`métadonnées HDX : HTTP ${reponse.status}`);
  const { result } = await reponse.json();
  const ressource = result.resources.find((r) => r.format === 'CSV' && /food prices/i.test(r.name));
  if (!ressource) throw new Error('fichier CSV des prix introuvable dans le jeu HDX');
  const csv = await fetch(ressource.url, { signal: AbortSignal.timeout(300_000) });
  if (!csv.ok) throw new Error(`CSV des prix : HTTP ${csv.status}`);
  return csv.text();
}

async function principal() {
  try {
    process.loadEnvFile(path.join(RACINE, '.env'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const sortie = path.resolve(option('--sortie') ?? path.resolve(RACINE, process.env.DOSSIER_DONNEES || 'stockage', 'releves-prix.json'));
  const referentiel = JSON.parse(await readFile(path.join(RACINE, 'data', 'referentiel.json'), 'utf8'));

  const fichier = option('--fichier');
  const texte = fichier ? await readFile(fichier, 'utf8') : await telechargerCsv();
  const { derniere_date, prix, manquants } = extraireReleves(lireCsv(texte), referentiel);
  const couverts = Object.values(prix).reduce((n, parMarche) => n + Object.keys(parMarche).length, 0);
  if (couverts === 0) throw new Error('aucun prix retenu : fichier vide ou format inattendu');

  const releves = { source: SOURCE_PAM, importe_le: new Date().toISOString(), derniere_date, prix };
  await mkdir(path.dirname(sortie), { recursive: true });
  await writeFile(`${sortie}.tmp`, `${JSON.stringify(releves, null, 1)}\n`);
  await rename(`${sortie}.tmp`, sortie);

  console.log(`Prix importés : ${couverts} couples produit × marché, relevé le plus récent du ${derniere_date}.`);
  if (manquants.length) console.log(`Sans prix récent (${manquants.length}) : ${manquants.join(', ')}`);
  console.log(`Écrit dans ${sortie}`);
}

principal().catch((e) => {
  console.error(`Import des prix échoué : ${e.message}. Les prix précédents sont conservés.`);
  process.exit(1);
});
