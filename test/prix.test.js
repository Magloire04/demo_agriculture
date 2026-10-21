import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { repondrePrix as repondre } from '../server/prix.js';
import { creerTextes } from '../server/reponses.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = lire('prix.json');
const textes = creerTextes(lire('reponses.json'));
const repondrePrix = (b, reponseApi) => repondre(b, textes, reponseApi);
const produit = (terme) => ({ terme, terme_canonique: terme, categorie: 'alimentation', montant: null, montant_manquant: true });

test('produit et marché : prix du marché demandé', () => {
  const r = repondrePrix(base, { transcription: 'gbàdé glazuwé', produits: [produit('gbàdé')], id: 'x' });
  assert.equal(r.statut, 'ok');
  assert.equal(r.marche.id, 'glazoue');
  assert.equal(r.reponses[0].produit.id, 'mais');
  assert.equal(r.reponses[0].ici.prix, base.produits.find((p) => p.id === 'mais').prix.glazoue.actuel);
  assert.equal(r.message, 'Au marché de Glazoué, le maïs coûte 250\u00a0F\u00a0CFA le kilo.');
  assert.equal(r.message_fon, 'È nɔ sa gbadé kilo ɖokpó yí 250\u00a0F\u00a0CFA ɖo Glazoué axi mɛ.');
  assert.equal(r.reponses[0].produit.nom_fon, 'gbadé');
  assert.equal(r.id_requete, 'x');
});

test('produit seul : fourchette et marché le moins cher', () => {
  const r = repondrePrix(base, { transcription: 'mɔ̌likún', produits: [produit('mɔ̌likún')] });
  assert.equal(r.marche, null);
  assert.equal(r.reponses[0].ici, null);
  assert.equal(r.reponses[0].lignes.length, base.marches.length);
  assert.equal(r.message, 'Le riz local coûte de 500 à 600\u00a0F\u00a0CFA le kilo selon les marchés. Le moins cher : Malanville.');
  assert.equal(r.message_fon, 'È nɔ sa mɔ̌likún kilo ɖokpó sín 500 sɔ́ yi 600\u00a0F\u00a0CFA ɖo axi vovo lɛ́ mɛ. Axi e mɛ é kpɔ hú bǐ é ɔ, Malanville wɛ.');
});

test('le nom du marché peut venir d’une transcription de diagnostic', () => {
  const r = repondrePrix(base, { transcription: 'timáti', transcription_vote: 'timáti tokpa', produits: [produit('timáti')] });
  assert.equal(r.marche.id, 'dantokpa');
});

test('sans produit reconnu par l’API, on cherche dans la transcription', () => {
  const r = repondrePrix(base, { transcription: 'gbadé parakú', produits: [] });
  assert.equal(r.reponses[0].produit.id, 'mais');
  assert.equal(r.marche.id, 'parakou');
});

test('marché seul : tous les prix de ce marché', () => {
  const r = repondrePrix(base, { transcription: 'axi glazuwe', produits: [] });
  assert.equal(r.statut, 'marche_seul');
  assert.equal(r.produits_du_marche.length, base.produits.length);
});

test('produit hors base et phrase incomprise', () => {
  assert.equal(repondrePrix(base, { transcription: 'azinkwín', produits: [produit('azinkwín')] }).statut, 'sans_prix');
  assert.equal(repondrePrix(base, { transcription: 'blabla', produits: [] }).statut, 'non_compris');
});

test('chaque réponse a sa version fongbé, y compris l’huile au litre', () => {
  const huile = repondrePrix(base, { transcription: 'amivɔvɔ dantɔkpa', produits: [produit('amivɔvɔ')] });
  assert.match(huile.message_fon, /^È nɔ sa amivɔvɔ lǐtli ɖokpó yí /);
  for (const transcription of ['axi glazuwe', 'blabla']) {
    assert.ok(repondrePrix(base, { transcription, produits: [] }).message_fon);
  }
  assert.ok(repondrePrix(base, { transcription: 'azinkwín', produits: [produit('azinkwín')] }).message_fon);
});

test('la base de démonstration est complète', () => {
  for (const p of base.produits) {
    assert.ok(p.nom_fon, `${p.id} sans nom fongbé`);
    for (const m of base.marches) {
      assert.ok(p.prix[m.id]?.actuel > 0, `${p.id} @ ${m.id}`);
    }
  }
});
