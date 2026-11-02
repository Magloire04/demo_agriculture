// Textes de l'interface de l'agriculteur, en fon, depuis data/interface.json (et les
// messages d'erreur de data/reponses.json). Écrit site/js/textes.js et remplit les
// éléments marqués des pages, pour qu'aucun texte français ne s'affiche, même au
// chargement :
//
//   node scripts/textes-interface.js
//
// Dans une page, `data-texte="cle"` remplace le texte de l'élément (qui ne contient
// que du texte) et `data-texte-aria-label="cle"` (ou -alt, -title, -content) remplit
// cet attribut.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DES_REPONSES = ['erreur_reessayer', 'erreur_trop_court', 'hors_service'];
const ATTRIBUTS = ['aria-label', 'alt', 'title', 'content'];

export function textesInterface({ interface: donnees, reponses }) {
  const textes = Object.fromEntries(Object.entries(donnees.textes).map(([cle, t]) => [cle, t.fon]));
  for (const cle of DES_REPONSES) {
    if (cle in textes) throw new Error(`clé en double : ${cle}`);
    textes[cle] = reponses.phrases[cle].fon;
  }
  return textes;
}

export function moduleTextes(textes) {
  const lignes = Object.keys(textes).sort().map((cle) => `  ${cle}: ${JSON.stringify(textes[cle])},`);
  return `// Généré par scripts/textes-interface.js depuis data/interface.json : ne pas modifier à la main.\n\nexport const T = Object.freeze({\n${lignes.join('\n')}\n});\n`;
}

const echapper = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function texte(textes, cle) {
  if (!(cle in textes)) throw new Error(`clé inconnue : ${cle}`);
  return echapper(textes[cle]);
}

export function remplirPage(html, textes) {
  const marques = (html.match(/\sdata-texte="/g) ?? []).length;
  let remplis = 0;
  let resultat = html.replace(/(<([a-z0-9]+)\b[^>]*?\sdata-texte="([a-z_]+)"[^>]*>)([^<]*)(<\/\2>)/g, (_, ouvrante, _balise, cle, _ancien, fermante) => {
    remplis++;
    return `${ouvrante}${texte(textes, cle)}${fermante}`;
  });
  if (remplis !== marques) {
    const cle = [...html.matchAll(/\sdata-texte="([a-z_]+)"/g)].map((m) => m[1]).find((c) => !(c in textes));
    if (cle) throw new Error(`clé inconnue : ${cle}`);
    throw new Error('un élément marqué data-texte ne doit contenir que du texte');
  }
  resultat = resultat.replace(/<[a-z0-9]+\b[^>]*\sdata-texte-(?:aria-label|alt|title|content)="[^>]*>/g, (balise) => {
    let b = balise;
    for (const attr of ATTRIBUTS) {
      const m = b.match(new RegExp(`\\sdata-texte-${attr}="([a-z_]+)"`));
      if (!m) continue;
      const valeur = texte(textes, m[1]);
      const existant = new RegExp(`(\\s${attr}=")[^"]*(")`);
      b = existant.test(b) ? b.replace(existant, `$1${valeur}$2`) : b.replace(/\s*(\/?)>$/, ` ${attr}="${valeur}"$1>`);
    }
    return b;
  });
  return resultat;
}

// Le manifeste garde sa mise en forme : seules ces valeurs changent.
export function remplirManifeste(texteManifeste, textes) {
  const valeur = (cle) => JSON.stringify(texte(textes, cle).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  return texteManifeste
    .replace(/^( {2}"name": ).*,$/m, '$1"AgriFon",')
    .replace(/^( {2}"description": ).*,$/m, `$1${valeur('accueil_titre')},`)
    .replace(/^( {2}"lang": ).*,$/m, '$1"fon",')
    .replace(/(\{ "name": )"[^"]*"(, "url": "\.\/#\/prix")/, `$1${valeur('prix')}$2`)
    .replace(/(\{ "name": )"[^"]*"(, "url": "\.\/#\/signalement")/, `$1${valeur('signaler')}$2`);
}

async function principal() {
  const lireJson = async (f) => JSON.parse(await readFile(path.join(RACINE, f), 'utf8'));
  const textes = textesInterface({ interface: await lireJson('data/interface.json'), reponses: await lireJson('data/reponses.json') });
  const ecrire = async (f, contenu) => writeFile(path.join(RACINE, f), contenu);
  const lire = async (f) => (await readFile(path.join(RACINE, f), 'utf8')).replace(/\r\n/g, '\n');
  await ecrire('site/js/textes.js', moduleTextes(textes));
  for (const page of ['site/index.html', 'site/hors-service.html']) await ecrire(page, remplirPage(await lire(page), textes));
  await ecrire('site/manifest.webmanifest', remplirManifeste(await lire('site/manifest.webmanifest'), textes));
  console.log(`${Object.keys(textes).length} textes écrits dans site/js/textes.js, les pages et le manifeste.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`Textes de l'interface : ${e.message}`);
    process.exit(1);
  });
}
