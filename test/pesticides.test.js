import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { verifierTraitement } from '../server/pesticides.js';

const pesticides = JSON.parse(readFileSync(new URL('./fixtures/pesticides.json', import.meta.url), 'utf8'));
const produit = (nom, concentration, cible) => ({ type: 'produit', matieres: [{ nom, concentration }], cible });

const refuse = (r) => {
  assert.equal(r.autorise, false);
  assert.ok(r.raisons.length > 0);
};

test('autorisé : même matière et concentration, culture et cible couvertes', () => {
  const r = verifierTraitement(produit('spinosad', '480 g/l', 'Helicoverpa armigera'), 'tomate', pesticides);
  assert.deepEqual(r, { autorise: true, raisons: [] });
});

test('refusé : autre concentration', () => {
  refuse(verifierTraitement(produit('spinosad', '240 g/l', 'Helicoverpa armigera'), 'tomate', pesticides));
});

test('refusé : culture absente', () => {
  refuse(verifierTraitement(produit('spinosad', '480 g/l', 'Helicoverpa armigera'), 'mais', pesticides));
});

test('refusé : culture couverte par un groupe seulement si le groupe la contient', () => {
  const t = produit('lambda-cyhalothrine', '15 g/l', 'Helicoverpa armigera');
  assert.equal(verifierTraitement(t, 'amarante', pesticides).autorise, true);
  refuse(verifierTraitement(t, 'coton', pesticides));
});

test('un usage peut nommer plusieurs groupes de cultures', () => {
  const liste = {
    ...pesticides,
    produits: [{
      nom: 'PRODUIT E', matieres: [{ nom: 'Azadirachtine', concentration: '10 g/L' }],
      usages: [{ texte: 'Insecticide contre Helicoverpa armigera en vergers et cultures maraîchères', cultures: [], groupes: ['vergers', 'cultures maraîchères'] }],
      autorisation: { type: 'homologation', fin: null },
    }],
  };
  assert.equal(verifierTraitement(produit('azadirachtine', '10 g/l', 'Helicoverpa armigera'), 'gombo', liste).autorise, true);
  refuse(verifierTraitement(produit('azadirachtine', '10 g/l', 'Helicoverpa armigera'), 'mais', liste));
});

test('refusé : cible différente', () => {
  refuse(verifierTraitement(produit('spinosad', '480 g/l', 'Tuta absoluta'), 'tomate', pesticides));
});

test('refusé : autorisation expirée à la date de la liste', () => {
  refuse(verifierTraitement(produit('émamectine benzoate', '19.2 g/l', 'Helicoverpa armigera'), 'tomate', pesticides));
});

test('refusé : matière interdite au Bénin', () => {
  const r = verifierTraitement(produit('dichlorvos', '1000 g/l', 'Aphis gossypii'), 'tomate', pesticides);
  refuse(r);
  assert.ok(r.raisons.some((x) => x.includes('interdit')), r.raisons.join(' ; '));
});
