import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chercher, mots, normaliser, reperer } from '../server/texte.js';

test('normaliser retire tons, accents et lettres fon', () => {
  assert.equal(normaliser('Mɔ̌likún'), 'molikun');
  assert.equal(normaliser('Gbàdé ɖò Glazoué ?'), 'gbade do glazoue');
  assert.equal(normaliser('Porto-Novo'), 'porto novo');
  assert.equal(normaliser("n'i"), 'n i');
});

test('chercher tolère une lettre sur les mots moyens, aucune sur les mots courts', () => {
  assert.ok(chercher(mots('gbàdé glazue'), 'Glazoué'));
  assert.equal(chercher(mots('gbàdé glazuwe'), 'Glazoué'), null); // d'où les variantes listées dans data/
  assert.ok(chercher(mots('mɔlikun'), 'mɔ̌likún'));
  assert.equal(chercher(mots('ris'), 'riz'), null);
  assert.equal(chercher(mots('azinkwín'), 'azin'), null);
});

test('chercher recolle les mots coupés', () => {
  assert.deepEqual(chercher(mots('xwe gla zoue'), 'Glazoué'), { position: 1, ecart: 0 });
  assert.ok(chercher(mots('portonovo'), 'Porto-Novo'));
});

test('reperer classe par sûreté puis par position', () => {
  const entrees = [{ id: 'a', t: ['dassa'] }, { id: 'b', t: ['bohicon'] }];
  const r = reperer('bohikon dassa', entrees, (e) => e.t);
  assert.deepEqual(r.map((x) => x.entree.id), ['a', 'b']);
});
