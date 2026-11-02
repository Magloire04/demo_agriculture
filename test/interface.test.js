import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const marques = (texte) => new Set(texte.match(/\{[a-z_]+\}/g) ?? []);

test('chaque texte d’interface a un français et un fon non vides, en NFC', () => {
  const { textes } = lire('interface.json');
  assert.ok(Object.keys(textes).length > 50);
  for (const [cle, { fr, fon }] of Object.entries(textes)) {
    assert.ok(typeof fr === 'string' && fr.trim(), `${cle} : français vide`);
    assert.ok(typeof fon === 'string' && fon.trim(), `${cle} : fon vide`);
    assert.equal(fon, fon.normalize('NFC'), `${cle} : fon pas en NFC`);
  }
});

test('les marques du français se retrouvent dans le fon', () => {
  for (const [cle, { fr, fon }] of Object.entries(lire('interface.json').textes)) {
    assert.deepEqual(marques(fon), marques(fr), cle);
  }
});

test('chaque culture du lexique a un nom fon', () => {
  for (const c of lire('lexique.json').cultures) {
    assert.ok(typeof c.nom_fon === 'string' && c.nom_fon.trim(), `${c.id} : nom fon manquant`);
    assert.equal(c.nom_fon, c.nom_fon.normalize('NFC'), c.id);
  }
});
