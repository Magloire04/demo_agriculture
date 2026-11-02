import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { moduleTextes, remplirManifeste, remplirPage, textesInterface } from '../scripts/textes-interface.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const textes = () => textesInterface({ interface: JSON.parse(lire('data/interface.json')), reponses: JSON.parse(lire('data/reponses.json')) });

test('les textes réunissent l’interface et les messages d’erreur des réponses', () => {
  const t = textes();
  assert.equal(t.accueil, JSON.parse(lire('data/interface.json')).textes.accueil.fon);
  assert.equal(t.erreur_reessayer, JSON.parse(lire('data/reponses.json')).phrases.erreur_reessayer.fon);
  assert.ok(t.erreur_trop_court && t.hors_service);
});

test('le module des textes est à jour avec data/interface.json', () => {
  assert.equal(moduleTextes(textes()), lire('site/js/textes.js'));
});

test('les pages et le manifeste sont à jour', () => {
  const t = textes();
  for (const page of ['site/index.html', 'site/hors-service.html']) assert.equal(remplirPage(lire(page), t), lire(page), page);
  assert.equal(remplirManifeste(lire('site/manifest.webmanifest'), t), lire('site/manifest.webmanifest'));
});

test('remplirPage ne touche que les éléments marqués', () => {
  const avant = '<p>garde</p><span class="x" data-texte="a">vieux</span><button data-texte-aria-label="b" aria-label="ancien">x</button><a data-texte-title="a">y</a>';
  assert.equal(remplirPage(avant, { a: 'Ɖé & <ò>', b: 'Gbɔ' }),
    '<p>garde</p><span class="x" data-texte="a">Ɖé &amp; &lt;ò&gt;</span><button data-texte-aria-label="b" aria-label="Gbɔ">x</button><a data-texte-title="a" title="Ɖé &amp; &lt;ò&gt;">y</a>');
});

test('clé inconnue ou élément marqué qui contient des balises : erreur', () => {
  assert.throws(() => remplirPage('<p data-texte="inconnue">x</p>', {}), /clé inconnue : inconnue/);
  assert.throws(() => remplirPage('<p data-texte="a">x <b>y</b></p>', { a: 'z' }), /que du texte/);
});
