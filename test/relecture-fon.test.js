import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { appliquerRelecture, formaterComme, textesARelire } from '../scripts/relecture-fon.js';
import { lignesSolutions } from '../scripts/relecture/csv.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const donnees = () => ({
  interface: lire('interface.json'),
  reponses: lire('reponses.json'),
  referentiel: lire('referentiel.json'),
  lexique: lire('lexique.json'),
  solutions: lire('solutions.json'),
});
const ligne = (lignes, id) => lignes.find((l) => l.id === id);
const corriger = (d, id, fon, voix) => appliquerRelecture(d, [{ id, fon, ...(voix !== undefined && { voix }) }]);

test('export : une ligne par texte, cinq parties, voix nulle quand elle répète le fon', () => {
  const d = donnees();
  const lignes = textesARelire(d);
  const attendu = Object.keys(d.interface.textes).length + Object.keys(d.reponses.phrases).length
    + Object.keys(d.reponses.unites).length + d.referentiel.produits.length + d.lexique.cultures.length
    + lignesSolutions(d.solutions).length;
  assert.equal(lignes.length, attendu);
  assert.equal(new Set(lignes.map((l) => l.id)).size, lignes.length);
  assert.deepEqual([...new Set(lignes.map((l) => l.partie))], ['Interface', 'Réponses', 'Produits', 'Cultures', 'Solutions']);
  assert.equal(ligne(lignes, 'solutions:gestes.fumure-organique').voix, null);
  assert.equal(ligne(lignes, 'reponses:phrases.prix_ici').voix, d.reponses.phrases.prix_ici.voix);
  assert.deepEqual(ligne(lignes, 'reponses:phrases.prix_ici').marques, ['{produit}', '{unite}', '{prix}', '{marche}']);
  assert.deepEqual(ligne(lignes, 'produits:mais'), { id: 'produits:mais', partie: 'Produits', fr: 'Maïs', fon: 'gbadé', voix: null, marques: [] });
  assert.equal(ligne(lignes, 'cultures:coton').fon, 'kanfun');
  assert.equal(ligne(lignes, 'interface:accueil').voix, null);
});

test('aller-retour sans changement : données identiques, aucune alerte', () => {
  const d = donnees();
  const lignes = textesARelire(d).map(({ id, fon, voix }) => ({ id, fon, voix }));
  const { donnees: apres, alertes } = appliquerRelecture(d, lignes);
  assert.deepEqual(alertes, []);
  assert.deepEqual(apres, donnees());
});

test('correction NFD enregistrée en NFC', () => {
  const nfd = 'Mi ɖɔ xó ɖo fɔ̀ngbè mɛ é'.normalize('NFD');
  const { donnees: apres } = corriger(donnees(), 'interface:accueil_titre', nfd);
  assert.equal(apres.interface.textes.accueil_titre.fon, nfd.normalize('NFC'));
});

test('marque perdue : ligne refusée, alerte, donnée inchangée', () => {
  const d = donnees();
  const { donnees: apres, alertes } = corriger(d, 'reponses:phrases.prix_ici', 'È nɔ sa {produit} yí {prix} F CFA ɖo {marche} axi mɛ.');
  assert.equal(alertes.length, 1);
  assert.match(alertes[0], /reponses:phrases\.prix_ici/);
  assert.match(alertes[0], /\{unite\}/);
  assert.equal(apres.reponses.phrases.prix_ici.fon, d.reponses.phrases.prix_ici.fon);
});

test('fon corrigé sans la voix : appliqué, alerte « voix à revoir »', () => {
  const d = donnees();
  const nouveau = d.reponses.phrases.prix_ici.fon.replace('axi mɛ', 'axi ɔ mɛ');
  const { donnees: apres, alertes } = corriger(d, 'reponses:phrases.prix_ici', nouveau, d.reponses.phrases.prix_ici.voix);
  assert.equal(apres.reponses.phrases.prix_ici.fon, nouveau);
  assert.deepEqual(alertes, ['voix à revoir : reponses:phrases.prix_ici']);
});

test('voix nulle à l’export : la voix suit le fon corrigé', () => {
  const { donnees: apres, alertes } = corriger(donnees(), 'solutions:gestes.fumure-organique', 'Mi kɔn kɔ́mpɔ́si dó atín lɛ́ sín afɔ kpá.');
  assert.deepEqual(alertes, []);
  assert.equal(apres.solutions.gestes['fumure-organique'].fon, 'Mi kɔn kɔ́mpɔ́si dó atín lɛ́ sín afɔ kpá.');
  assert.equal(apres.solutions.gestes['fumure-organique'].voix, 'Mi kɔn kɔ́mpɔ́si dó atín lɛ́ sín afɔ kpá.');
});

test('produit, culture et unité corrigés à leur place', () => {
  const { donnees: apres } = appliquerRelecture(donnees(), [
    { id: 'produits:mais', fon: 'gbàdé' },
    { id: 'cultures:anacarde', fon: 'kajútín' },
    { id: 'reponses:unites.kg', fon: 'kílò ɖokpó' },
  ]);
  assert.equal(apres.referentiel.produits.find((p) => p.id === 'mais').nom_fon, 'gbàdé');
  assert.equal(apres.lexique.cultures.find((c) => c.id === 'anacarde').nom_fon, 'kajútín');
  assert.equal(apres.reponses.unites.kg.fon, 'kílò ɖokpó');
});

test('identifiant inconnu : alerte', () => {
  const { alertes } = corriger(donnees(), 'interface:inexistant', 'xó');
  assert.deepEqual(alertes, ['identifiant inconnu : interface:inexistant']);
});

test('un fichier réécrit garde sa mise en forme', () => {
  for (const f of ['interface', 'reponses', 'referentiel', 'lexique', 'solutions']) {
    const texte = readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(formaterComme(texte, JSON.parse(texte)), texte, f);
  }
});

test('voix qui perd une marque : ligne refusée, donnée inchangée', () => {
  const d = donnees();
  const { fon, voix } = d.reponses.phrases.prix_ici;
  const { donnees: apres, alertes } = corriger(d, 'reponses:phrases.prix_ici', fon, voix.replace('{prix}', ''));
  assert.equal(alertes.length, 1);
  assert.match(alertes[0], /\{prix\}.*reponses:phrases\.prix_ici/);
  assert.equal(apres.reponses.phrases.prix_ici.voix, voix);
});

test('marque ajoutée ou mal tapée : ligne refusée', () => {
  const d = donnees();
  const { fon } = d.reponses.phrases.prix_ici;
  const { donnees: apres, alertes } = corriger(d, 'reponses:phrases.prix_ici', `${fon} {prixx}`);
  assert.equal(alertes.length, 1);
  assert.match(alertes[0], /\{prixx\}/);
  assert.equal(apres.reponses.phrases.prix_ici.fon, fon);
});
