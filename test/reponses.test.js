import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { creerTextes } from '../server/reponses.js';

const donnees = {
  unites: { kg: { fr: 'le kilo', fon: 'kílò' } },
  phrases: {
    deux_langues: { fr: '{au_marche}, {produit} coûte {prix} F.', fon: '{produit} {prix} F ɖò {marche}.' },
    francais_seul: { fr: 'Bonjour.', fon: null },
  },
};

test('une phrase est remplie dans les deux langues, avec majuscule initiale', () => {
  const textes = creerTextes(donnees);
  const p = textes.phrase('deux_langues', { au_marche: 'au marché de Glazoué', marche: 'Glazoué', produit: { fr: 'le maïs', fon: 'gbàdé' }, prix: '250' });
  assert.deepEqual(p, { fr: 'Au marché de Glazoué, le maïs coûte 250 F.', fon: 'Gbàdé 250 F ɖò Glazoué.' });
});

test('le fongbé manque si le modèle ou une valeur fongbé manque', () => {
  const textes = creerTextes(donnees);
  assert.equal(textes.phrase('francais_seul').fon, null);
  const p = textes.phrase('deux_langues', { au_marche: 'au marché X', marche: 'X', produit: { fr: 'le manioc', fon: null }, prix: '1' });
  assert.equal(p.fr, 'Au marché X, le manioc coûte 1 F.');
  assert.equal(p.fon, null);
});

test('joindre ne rend le fongbé que si toutes les phrases l’ont', () => {
  const textes = creerTextes(donnees);
  const a = { fr: 'A.', fon: 'a.' };
  assert.deepEqual(textes.joindre([a, { fr: 'B.', fon: 'b.' }]), { fr: 'A. B.', fon: 'a. b.' });
  assert.deepEqual(textes.joindre([a, { fr: 'B.', fon: null }]), { fr: 'A. B.', fon: null });
});

test('modèle inconnu ou français incomplet : erreur de programmation', () => {
  const textes = creerTextes(donnees);
  assert.throws(() => textes.phrase('absent'), /inconnue/);
  assert.throws(() => textes.phrase('deux_langues', {}), /incomplète/);
});

test('data/reponses.json : mêmes emplacements en français et en fongbé', () => {
  const reponses = JSON.parse(readFileSync(new URL('../data/reponses.json', import.meta.url), 'utf8'));
  const emplacements = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== 'au_marche' && n !== 'marche').sort();
  for (const [id, { fr, fon }] of Object.entries(reponses.phrases)) {
    if (fon === null) continue;
    assert.deepEqual(emplacements(fon), emplacements(fr), id);
    assert.equal(fon, fon.normalize('NFC'), `${id} doit être en Unicode NFC`);
  }
});
