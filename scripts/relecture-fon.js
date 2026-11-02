// Relecture de tout le fon que voit l'agriculteur, par Elisée, dans une page de
// relecture-validation provisoire. Outil à usage unique, retiré une fois la
// relecture reportée.
//
//   node scripts/relecture-fon.js exporter lignes.json   lignes à charger dans la page
//   node scripts/relecture-fon.js appliquer lignes.json  lignes validées : { id, fon, voix? }
//
// La voix (texte dit, en morceaux séparés par « | ») suit le fon corrigé quand elle le
// répétait ; sinon elle se corrige à part, et un fon corrigé sans sa voix est signalé.
// Une correction qui perd une marque ({produit}, {prix}…) est refusée.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cibleSolutions, lignesSolutions } from './relecture/csv.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FICHIERS = {
  interface: 'interface.json', reponses: 'reponses.json', referentiel: 'referentiel.json', lexique: 'lexique.json', solutions: 'solutions.json',
};

const marquesDe = (texte) => [...new Set(texte.match(/\{[a-z_]+\}/g) ?? [])];
const sansSeparateurs = (voix) => voix.replace(/\s*\|\s*/g, ' ').trim();

// Voix à relire à part : null quand elle ne fait que répéter le fon.
function voixARelire(texte) {
  if (typeof texte.voix !== 'string' || sansSeparateurs(texte.voix) === texte.fon) return null;
  return texte.voix;
}

// Les textes de chaque partie : { id, partie, fr, objet } où objet porte fon (ou nom_fon) et voix.
function entrees(donnees) {
  const liste = [];
  for (const [cle, t] of Object.entries(donnees.interface.textes)) liste.push({ id: `interface:${cle}`, partie: 'Interface', texte: t });
  for (const [cle, t] of Object.entries(donnees.reponses.phrases)) liste.push({ id: `reponses:phrases.${cle}`, partie: 'Réponses', texte: t });
  for (const [cle, t] of Object.entries(donnees.reponses.unites)) liste.push({ id: `reponses:unites.${cle}`, partie: 'Réponses', texte: t });
  for (const p of donnees.referentiel.produits) liste.push({ id: `produits:${p.id}`, partie: 'Produits', nom: p });
  for (const c of donnees.lexique.cultures) liste.push({ id: `cultures:${c.id}`, partie: 'Cultures', nom: c });
  for (const l of lignesSolutions(donnees.solutions)) liste.push({ id: `solutions:${l.cle}`, partie: 'Solutions', texte: l.texte });
  return liste;
}

export function textesARelire(donnees) {
  return entrees(donnees).map(({ id, partie, texte, nom }) => (nom
    ? { id, partie, fr: nom.nom, fon: nom.nom_fon, voix: null, marques: [] }
    : { id, partie, fr: texte.fr, fon: texte.fon, voix: voixARelire(texte), marques: marquesDe(texte.fon) }));
}

// L'objet à modifier dans la copie des données, d'après l'identifiant d'une ligne.
function cible(donnees, id) {
  const [partie, cle] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (partie === 'interface') return { texte: donnees.interface.textes[cle] };
  if (partie === 'reponses') {
    const [groupe, nom] = cle.split('.');
    return { texte: ['phrases', 'unites'].includes(groupe) ? donnees.reponses[groupe][nom] : undefined };
  }
  if (partie === 'produits') return { nom: donnees.referentiel.produits.find((p) => p.id === cle) };
  if (partie === 'cultures') return { nom: donnees.lexique.cultures.find((c) => c.id === cle) };
  if (partie === 'solutions') return { texte: cibleSolutions(donnees.solutions, cle) };
  return {};
}

export function appliquerRelecture(donnees, lignes) {
  const copie = structuredClone(donnees);
  const alertes = [];
  for (const { id, fon: fonRecu, voix: voixRecue } of lignes) {
    const { texte, nom } = cible(copie, id);
    if (!texte && !nom) { alertes.push(`identifiant inconnu : ${id}`); continue; }
    const fon = (fonRecu ?? '').normalize('NFC').trim();
    if (!fon) { alertes.push(`fon vide, valeur précédente gardée : ${id}`); continue; }
    if (nom) { nom.nom_fon = fon; continue; }
    const voixAPart = typeof texte.voix === 'string' && voixARelire(texte) !== null;
    const voix = voixAPart && typeof voixRecue === 'string' && voixRecue.trim() ? voixRecue.normalize('NFC').trim() : texte.voix;
    // Les marques doivent rester les mêmes, dans le fon comme dans la voix : une marque
    // perdue ou mal tapée ({prixx}) casserait la phrase que le serveur remplit.
    const ecarts = [[texte.fon, fon], ...(voixAPart ? [[texte.voix, voix]] : [])].flatMap(([avant, apres]) => [
      ...marquesDe(avant).filter((m) => !marquesDe(apres).includes(m)).map((m) => `marque perdue ${m}`),
      ...marquesDe(apres).filter((m) => !marquesDe(avant).includes(m)).map((m) => `marque inconnue ${m}`),
    ]);
    if (ecarts.length) { alertes.push(`${[...new Set(ecarts)].join(', ')}, ligne refusée : ${id}`); continue; }
    const fonChange = fon !== texte.fon;
    if (voixAPart) {
      if (fonChange && voix === texte.voix) alertes.push(`voix à revoir : ${id}`);
      texte.voix = voix;
    } else if (typeof texte.voix === 'string' && fonChange) {
      texte.voix = fon;
    }
    texte.fon = fon;
  }
  return { donnees: copie, alertes };
}

// Réécrit `valeur` dans la mise en forme du fichier d'origine : JSON.stringify à
// deux espaces, ou une entrée par ligne (data/interface.json, data/lexique.json).
const estFeuille = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'));

function compact(valeur, retrait) {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur);
  const enfants = Array.isArray(valeur) ? valeur : Object.values(valeur);
  if (Array.isArray(valeur) && enfants.every(estFeuille)) return `[${enfants.map((v) => compact(v, retrait)).join(', ')}]`;
  if (!Array.isArray(valeur) && enfants.every(estFeuille)) {
    return `{ ${Object.entries(valeur).map(([k, v]) => `${JSON.stringify(k)}: ${compact(v, retrait)}`).join(', ')} }`;
  }
  const dedans = `${retrait}  `;
  const lignes = Array.isArray(valeur)
    ? valeur.map((v) => `${dedans}${compact(v, dedans)}`)
    : Object.entries(valeur).map(([k, v]) => `${dedans}${JSON.stringify(k)}: ${compact(v, dedans)}`);
  const [ouvre, ferme] = Array.isArray(valeur) ? ['[', ']'] : ['{', '}'];
  return `${ouvre}\n${lignes.join(',\n')}\n${retrait}${ferme}`;
}

export function formaterComme(texteOriginal, valeur) {
  const original = texteOriginal.replace(/\r\n/g, '\n');
  const standard = (v) => `${JSON.stringify(v, null, 2)}\n`;
  return standard(JSON.parse(original)) === original ? standard(valeur) : `${compact(valeur, '')}\n`;
}

async function lireDonnees() {
  const entreesFichiers = await Promise.all(Object.entries(FICHIERS).map(async ([cle, f]) => [cle, JSON.parse(await readFile(path.join(RACINE, 'data', f), 'utf8'))]));
  return Object.fromEntries(entreesFichiers);
}

async function principal() {
  const [action, fichier] = process.argv.slice(2);
  if (!['exporter', 'appliquer'].includes(action) || !fichier) {
    console.error('Usage : node scripts/relecture-fon.js exporter|appliquer <lignes.json>');
    process.exit(1);
  }
  const donnees = await lireDonnees();
  if (action === 'exporter') {
    const lignes = textesARelire(donnees);
    await writeFile(fichier, `${JSON.stringify(lignes, null, 2)}\n`);
    console.log(`${lignes.length} lignes écrites dans ${fichier}`);
    return;
  }
  const { donnees: corrigees, alertes } = appliquerRelecture(donnees, JSON.parse(await readFile(fichier, 'utf8')));
  for (const [cle, f] of Object.entries(FICHIERS)) {
    if (JSON.stringify(corrigees[cle]) !== JSON.stringify(donnees[cle])) {
      const chemin = path.join(RACINE, 'data', f);
      await writeFile(chemin, formaterComme(await readFile(chemin, 'utf8'), corrigees[cle]));
      console.log(`data/${f} mis à jour`);
    }
  }
  for (const a of alertes) console.log(`ALERTE ${a}`);
  if (alertes.some((a) => a.includes('refusée') || a.startsWith('identifiant inconnu'))) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`Relecture : ${e.message}`);
    process.exit(1);
  });
}
