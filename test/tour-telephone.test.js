import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { appuiAutorise, premierAcces } from '../site/js/tour.js';

// Faux éléments : `dans` dit dans quel élément (cible, croix) se trouve l'appui.
const element = (dans = []) => ({ closest: (sel) => (dans.includes(sel) ? {} : null), dans });
const cible = { contains: (e) => e.dans.includes('cible') };

test('appuiAutorise : la croix et la cible passent, le reste est bloqué', () => {
  assert.equal(appuiAutorise(cible, true, element(['cible'])), true);
  assert.equal(appuiAutorise(cible, true, element(['[data-tour-fermer]'])), true);
  assert.equal(appuiAutorise(cible, true, element([])), false, 'ailleurs pendant le tour');
  assert.equal(appuiAutorise(null, true, element([])), false, 'écran normal pendant une lecture : seule la croix');
  assert.equal(appuiAutorise(null, false, element([])), true, 'sans tour, tout passe');
});

test('sans mémoire, le tour est proposé ; une fois vu, il ne l’est plus', () => {
  assert.equal(premierAcces(() => null), true);
  assert.equal(premierAcces(() => 'vu'), false);
  assert.equal(premierAcces((cle) => (cle === 'agrifon.tour' ? 'vu' : null)), false);
});

test('l’écran de démarrage porte la cible de l’étape 1', () => {
  const source = readFileSync(new URL('../site/js/tour.js', import.meta.url), 'utf8');
  assert.ok(source.includes('data-tour-demarrer'));
  assert.ok(source.includes('data-tour-fermer'));
});

test('le bouton d’aide est dans l’en-tête, avec son nom en fon', () => {
  const page = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const entete = page.slice(page.indexOf('<header'), page.indexOf('</header>'));
  assert.match(entete, /<button[^>]*data-aide[^>]*>/);
  assert.match(entete, /data-texte-aria-label="aide"/);
  const { textes } = JSON.parse(readFileSync(new URL('../data/interface.json', import.meta.url), 'utf8'));
  assert.ok(entete.includes(`aria-label="${textes.aide.fon}"`));
});

test('le cache hors ligne garde les modules du tour', () => {
  const sw = readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8');
  for (const f of ['js/tour.js', 'js/tour-moteur.js', 'js/tour-etapes.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.match(sw, /agrifon-v15/);
});
