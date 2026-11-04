import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const mots = (texte) => texte.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

// Mots qui trahissent du français : les petits mots d'une phrase (pas « un », qui est
// aussi du fon), les mots de 4 lettres ou plus du français de l'interface et des
// réponses, sauf ceux que le fon emploie aussi (« kilo »), et quelques mots des
// anciens libellés. Un nom propre (AgriFon) n'est pas un mot français.
function marqueurs() {
  const { textes } = JSON.parse(lire('data/interface.json'));
  const { phrases, unites } = JSON.parse(lire('data/reponses.json'));
  const tour = JSON.parse(lire('data/tour.json')).phrases;
  const tous = [...Object.values(textes), ...Object.values(phrases), ...Object.values(unites), ...Object.values(tour)];
  const sansMarques = (t) => (t ?? '').replace(/\{[a-z_]+\}/g, ' '); // {commune} n'est pas un mot fon
  const enFon = new Set(tous.flatMap((t) => mots(sansMarques(t.fon))));
  const longs = tous.flatMap((t) => mots(sansMarques(t.fr))).filter((m) => m.length >= 4 && !enFon.has(m));
  const petits = 'le la les de du des une et pour avec votre vous est pas au aux dans sur par ou ce cette son vos'.split(' ');
  const nomsPropres = new Set(['agrifon']);
  return new Set([...petits, ...longs.filter((m) => !nomsPropres.has(m)), 'stable', 'depuis', 'source', 'relevé', 'lieu']);
}
const MARQUEURS = marqueurs();
const francais = (texte) => mots(texte).filter((m) => MARQUEURS.has(m));
// Une chaîne de code n'est pas un texte affiché : un seul mot en minuscules sans accent
// (clé, sélecteur), des noms de classes à tiret séparés par des espaces, ou un sélecteur
// CSS : « . », « # » ou « [ » en tête, et chaque morceau une classe, un attribut ou une
// balise (jamais un mot de phrase).
const BALISES = new Set(['a', 'i', 'p', 'li', 'div', 'span', 'svg', 'path', 'button', 'select', 'option', 'input']);
const estSelecteur = (valeur) => /^[.#[][a-z0-9_\-.:#()[\]=,*>"'/ ]*$/.test(valeur)
  && valeur.split(/[\s,>]+/).filter(Boolean).every((m) => /^[.#[:]/.test(m) || BALISES.has(m));
const estDuCode = (valeur) => /^[a-z0-9_\-.:#[\]=/*]*$/.test(valeur)
  || valeur.trim().split(/\s+/).every((m) => /^[a-z0-9_]+(-[a-z0-9_]+)+$/.test(m))
  || estSelecteur(valeur);

// Textes vus par l'agriculteur dans une page : texte des éléments et étiquettes.
function textesDePage(html) {
  const sans = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  const entreBalises = [...sans.matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  const attributs = [...sans.matchAll(/\s(?:aria-label|alt|title|placeholder|content)="([^"]*)"/g)].map((m) => m[1]);
  return [...entreBalises, ...attributs];
}

// Chaînes d'un fichier JavaScript, commentaires exclus. Un gabarit `…${…}…` donne sa
// partie fixe, et les chaînes de ses expressions sont lues aussi. Une ligne qui porte
// « français admis » est ignorée.
function chainesDe(source) {
  const chaines = [];
  const lignes = source.split('\n');
  const pile = []; // gabarits dont on lit une expression : { valeur, ligne, accolades }
  let i = 0;
  let ligne = 1;
  const garder = (debut, valeur) => { if (!lignes[debut - 1].includes('français admis')) chaines.push({ ligne: debut, valeur }); };
  // Lit la partie fixe d'un gabarit jusqu'à « ` » (fin) ou « ${ » (expression).
  const lireGabarit = (cadre) => {
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') { cadre.valeur += source[i + 1]; i += 2; continue; }
      if (c === '`') { i++; garder(cadre.ligne, cadre.valeur); return; }
      if (c === '$' && source[i + 1] === '{') { i += 2; pile.push(cadre); return; }
      if (c === '\n') ligne++;
      cadre.valeur += c;
      i++;
    }
  };
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') { ligne++; i++; continue; }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i + 1] === '*') { const fin = source.indexOf('*/', i + 2); ligne += source.slice(i, fin).split('\n').length - 1; i = fin + 2; continue; }
    if (c === '\'' || c === '"') {
      const debut = ligne;
      let valeur = '';
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') { valeur += source[i + 1]; i += 2; continue; }
        valeur += source[i];
        i++;
      }
      garder(debut, valeur);
      i++;
      continue;
    }
    if (c === '`') { i++; lireGabarit({ valeur: '', ligne, accolades: 0 }); continue; }
    if (pile.length && c === '{') { pile.at(-1).accolades++; i++; continue; }
    if (pile.length && c === '}') {
      const cadre = pile.at(-1);
      i++;
      if (cadre.accolades > 0) { cadre.accolades--; continue; }
      pile.pop();
      lireGabarit(cadre);
      continue;
    }
    i++;
  }
  return chaines;
}

test('aucun mot français dans les pages de l’agriculteur', () => {
  for (const page of ['site/index.html', 'site/hors-service.html']) {
    for (const t of textesDePage(lire(page))) assert.deepEqual(francais(t), [], `${page} : « ${t} »`);
  }
  const manifeste = JSON.parse(lire('site/manifest.webmanifest'));
  for (const t of [manifeste.name, manifeste.short_name, manifeste.description, ...manifeste.shortcuts.map((s) => s.name)]) {
    assert.deepEqual(francais(t), [], `manifeste : « ${t} »`);
  }
  assert.equal(manifeste.lang, 'fon');
});

test('aucune chaîne française affichée par le tour de présentation', () => {
  for (const f of ['site/js/tour.js', 'site/js/tour-moteur.js', 'site/js/tour-etapes.js']) {
    const fautives = chainesDe(lire(f)).filter(({ valeur }) => !estDuCode(valeur) && francais(valeur).length > 0);
    assert.deepEqual(fautives.map(({ ligne, valeur }) => `${f} ligne ${ligne} : ${valeur}`), []);
  }
});

test('aucune chaîne française affichée par app.js', () => {
  const fautives = chainesDe(lire('site/js/app.js')).filter(({ valeur }) => !estDuCode(valeur) && francais(valeur).length > 0);
  assert.deepEqual(fautives.map(({ ligne, valeur }) => `ligne ${ligne} : ${valeur}`), []);
});

test('le contrôle repère aussi les libellés français courts, jamais le fon de l’interface', () => {
  for (const libelle of ['Réécouter', 'Arrêter', 'Lecture impossible', 'Écouter en fongbé', 'Terminer', 'Actualiser', 'Analyse en cours',
    'Stable depuis août 2026', 'Marché Dantokpa', 'Commune non précisée', 'Traitement documenté', 'Solutions proposées', 'Référence : ',
    'Culture', 'Lieu', 'Faire un autre signalement', 'F CFA / litre']) {
    assert.notDeepEqual(francais(libelle), [], libelle);
  }
  for (const { fon } of Object.values(JSON.parse(lire('data/interface.json')).textes)) assert.deepEqual(francais(fon), [], fon);
});

test('le contrôle repère bien une phrase française', () => {
  assert.ok(francais('Appuyez pour parler').includes('pour'));
  assert.deepEqual(francais('Un ma se nǔ ɔ sín nyǐkɔ ǎ.'), []);
  assert.deepEqual(chainesDe("const a = 'Comparer avec les autres'; // un commentaire avec le mot de\nconst b = `x ${'pour'} y`;").map((c) => c.valeur), ['Comparer avec les autres', 'pour', 'x  y']);
  // Un sélecteur CSS est du code ; une phrase qui commence par « [ » ou « . » n'en est pas.
  for (const s of ['.tour-points i', '.bouton-micro, [data-aide]', '.carte-choix[href="#/prix"]', '.tour-main:not(.tour-main-demarrage)']) assert.equal(estDuCode(s), true, s);
  for (const s of ['[aide] appuyez ici pour la suite', '. pas de prix pour le mil']) assert.equal(estDuCode(s), false, s);
});

test('données affichées sous les conseils : chaque source a un sigle, sans français', () => {
  const { sources } = JSON.parse(lire('data/solutions.json'));
  for (const [id, s] of Object.entries(sources)) {
    assert.ok(typeof s.sigle === 'string' && s.sigle.trim(), `${id} : sigle manquant`);
    assert.deepEqual(francais(s.sigle), [], `${id} : « ${s.sigle} »`);
  }
});

test('aucun mot français dans le fon du tour de présentation', () => {
  for (const [cle, { fon }] of Object.entries(JSON.parse(lire('data/tour.json')).phrases)) assert.deepEqual(francais(fon), [], `${cle} : ${fon}`);
});
