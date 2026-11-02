import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Petits mots qui trahissent une phrase française. Pas « un » : « Un » est aussi du fon.
const MARQUEURS = new Set('le la les de du des une et pour avec votre vous est pas au aux dans sur par ou ce cette son vos'.split(' '));
const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const mots = (texte) => texte.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
const francais = (texte) => mots(texte).filter((m) => MARQUEURS.has(m));

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

test('aucune chaîne française affichée par app.js', () => {
  const fautives = chainesDe(lire('site/js/app.js')).filter(({ valeur }) => francais(valeur).length > 0);
  assert.deepEqual(fautives.map(({ ligne, valeur }) => `ligne ${ligne} : ${valeur}`), []);
});

test('le contrôle repère bien une phrase française', () => {
  assert.deepEqual(francais('Appuyez pour parler'), ['pour']);
  assert.deepEqual(francais('Un ma se nǔ ɔ sín nyǐkɔ ǎ.'), []);
  assert.deepEqual(chainesDe("const a = 'Comparer avec les autres'; // un commentaire avec le mot de\nconst b = `x ${'pour'} y`;").map((c) => c.valeur), ['Comparer avec les autres', 'pour', 'x  y']);
});
