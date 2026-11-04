// Importe les prix réels du PAM et écrit les relevés lus par le serveur.
//
//   node scripts/importer-prix.js                 lit les prix du Bénin sur HAPI (API de HDX)
//   node scripts/importer-prix.js --fichier x.csv utilise un CSV du PAM déjà téléchargé
//   node scripts/importer-prix.js --sortie y.json écrit ailleurs que dans le dossier de stockage
//
// Depuis novembre 2026, le téléchargement du fichier CSV sur HDX est protégé contre les
// robots (AWS WAF, « challenge ») : l'import passe par HAPI, l'API de HDX faite pour les
// programmes, qui sert les mêmes prix du PAM. HAPI demande un identifiant d'application :
// le nom d'AgriFon et l'adresse de contact de TECHNUM (HAPI_CONTACT dans .env pour une autre).
//
// En cas d'échec, le fichier précédent est conservé et le code de sortie vaut 1.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extraireReleves, lireCsv, SOURCE_PAM } from '../server/pam.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAPI_PRIX = 'https://hapi.humdata.org/api/v2/food-security-nutrition-poverty/food-prices-market-monitor';
const CONTACT_HAPI = 'technum.services@bytechnum.com';
const PAR_PAGE = 10_000; // le plus que HAPI rend en une fois
const HISTORIQUE_MOIS = 24; // assez pour le relevé précédent et la limite d'âge des relevés

function option(nom) {
  const i = process.argv.indexOf(nom);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function moisAvant(date, mois) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() - mois);
  return d.toISOString().slice(0, 10);
}

// Une ligne de HAPI, sous la forme des lignes du fichier CSV du PAM que lit server/pam.js.
export function versLignePam(l) {
  return {
    date: String(l.reference_period_start ?? '').slice(0, 10),
    market: l.market_name,
    commodity: l.commodity_name,
    unit: l.unit,
    currency: l.currency_code,
    pricetype: l.price_type,
    priceflag: l.price_flag,
    price: String(l.price),
  };
}

// Toutes les lignes du Bénin depuis `depuis`, page après page.
export async function lignesHapi({
  fetch = globalThis.fetch, contact = CONTACT_HAPI, depuis = moisAvant(Date.now(), HISTORIQUE_MOIS), parPage = PAR_PAGE,
} = {}) {
  const identifiant = Buffer.from(`AgriFon:${contact}`).toString('base64');
  const lignes = [];
  for (let offset = 0; ; offset += parPage) {
    const url = new URL(HAPI_PRIX);
    url.search = new URLSearchParams({
      app_identifier: identifiant, location_code: 'BEN', start_date: depuis, output_format: 'json', limit: String(parPage), offset: String(offset),
    });
    const reponse = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!reponse.ok) throw new Error(`HAPI : HTTP ${reponse.status}`);
    const { data = [] } = await reponse.json();
    lignes.push(...data.map(versLignePam));
    if (data.length < parPage) return lignes;
  }
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
  const lignes = fichier
    ? lireCsv(await readFile(fichier, 'utf8'))
    : await lignesHapi({ contact: process.env.HAPI_CONTACT || CONTACT_HAPI });
  const { derniere_date, prix, manquants } = extraireReleves(lignes, referentiel);
  const couverts = Object.values(prix).reduce((n, parMarche) => n + Object.keys(parMarche).length, 0);
  if (couverts === 0) throw new Error('aucun prix retenu : données vides ou format inattendu');

  const releves = { source: SOURCE_PAM, importe_le: new Date().toISOString(), derniere_date, prix };
  await mkdir(path.dirname(sortie), { recursive: true });
  await writeFile(`${sortie}.tmp`, `${JSON.stringify(releves, null, 1)}\n`);
  await rename(`${sortie}.tmp`, sortie);

  console.log(`Prix importés : ${couverts} couples produit × marché, relevé le plus récent du ${derniere_date}.`);
  if (manquants.length) console.log(`Sans prix récent (${manquants.length}) : ${manquants.join(', ')}`);
  console.log(`Écrit dans ${sortie}`);
}

// Lancé en ligne de commande seulement : les tests importent ses fonctions.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`Import des prix échoué : ${e.message}. Les prix précédents sont conservés.`);
    process.exit(1);
  });
}
