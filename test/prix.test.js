import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { repondrePrix as repondre } from '../server/prix.js';
import { creerTextes } from '../server/reponses.js';

const lire = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const base = lire('../data/referentiel.json');
const releves = lire('./fixtures/releves.json');
const textes = creerTextes(lire('../data/reponses.json'));
const repondrePrix = (reponseApi) => repondre(base, releves, textes, reponseApi);
const produit = (terme) => ({ terme, terme_canonique: terme, categorie: 'alimentation', montant: null, montant_manquant: true });
const NB = ' ';

test('produit et marché : prix relevé dans ce marché, avec sa date et le relevé précédent', () => {
  const r = repondrePrix({ transcription: 'gbàdé glazuwé', produits: [produit('gbàdé')], id: 'x' });
  assert.equal(r.statut, 'ok');
  assert.equal(r.marche.id, 'glazoue');
  assert.equal(r.reponses[0].produit.id, 'mais');
  assert.deepEqual(
    { prix: r.reponses[0].ici.prix, date: r.reponses[0].ici.date, precedent: r.reponses[0].ici.precedent, date_precedente: r.reponses[0].ici.date_precedente },
    { prix: 90, date: '2026-09-15', precedent: 95, date_precedente: '2026-08-15' },
  );
  assert.equal(r.message, `Au marché de Glazoué, le maïs coûte 90${NB}F${NB}CFA le kilo.`);
  assert.equal(r.message_fon, `È nɔ sa gbadé kilo ɖokpó yí 90${NB}F${NB}CFA ɖo Glazoué axi mɛ.`);
  assert.equal(r.reponses[0].produit.nom_fon, 'gbadé');
  assert.equal(r.reponses[0].produit.pam, undefined);
  assert.equal(r.marche.pam, undefined);
  assert.equal(r.source.licence, 'CC BY-IGO');
  assert.equal(r.id_requete, 'x');
});

test('produit seul : fourchette et marché le moins cher', () => {
  const r = repondrePrix({ transcription: 'mɔ̌likún', produits: [produit('mɔ̌likún')] });
  assert.equal(r.marche, null);
  assert.equal(r.reponses[0].ici, null);
  assert.deepEqual(r.reponses[0].lignes.map((l) => l.marche.id), ['parakou', 'glazoue', 'dantokpa']);
  assert.equal(r.reponses[0].lignes[2].date, '2026-05-15');
  assert.equal(r.message, `Le riz local coûte de 344 à 650${NB}F${NB}CFA le kilo selon les marchés. Le moins cher : Arzèkè (Parakou).`);
  assert.equal(r.message_fon, `È nɔ sa mɔ̌likún kilo ɖokpó sín 344 sɔ́ yi 650${NB}F${NB}CFA ɖo axi vovo lɛ́ mɛ. Axi e mɛ é kpɔ hú bǐ é ɔ, Arzèkè wɛ.`);
});

test('même prix partout', () => {
  const r = repondrePrix({ transcription: 'soja', produits: [produit('sɔja')] });
  assert.equal(r.message, `Le soja coûte 268${NB}F${NB}CFA le kilo dans tous les marchés.`);
});

test('marché sans relevé (Lokossa) : on le dit, puis on donne les autres marchés', () => {
  const r = repondrePrix({ transcription: 'gbadé lokossa', produits: [produit('gbàdé')] });
  assert.equal(r.marche.id, 'lokossa');
  assert.equal(r.reponses[0].ici, null);
  assert.equal(r.message, `Pas de prix relevé pour le maïs au marché de Lokossa. Le maïs coûte de 90 à 160${NB}F${NB}CFA le kilo selon les marchés. Le moins cher : Glazoué.`);
  assert.ok(r.message_fon.startsWith('Mǐ ko tuun gbadé sín akwɛ́ ɖo Lokossa axi mɛ ǎ.'));
});

test('produit sans aucun relevé : pas de prix inventé', () => {
  const r = repondrePrix({ transcription: 'abɔ̀ glazuwé', produits: [produit('abɔ̀')] });
  assert.equal(r.reponses[0].produit.id, 'sorgho');
  assert.deepEqual(r.reponses[0].lignes, []);
  assert.equal(r.message, 'Pas encore de prix relevé pour le sorgho.');
  assert.equal(r.message_fon, 'Mǐ ko tuun abɔ̀ sín akwɛ́ ǎ.');
});

test('marché seul : les prix de ce marché, ou une nouvelle demande s’il n’en a aucun', () => {
  const glazoue = repondrePrix({ transcription: 'axi glazuwe', produits: [] });
  assert.equal(glazoue.statut, 'marche_seul');
  assert.deepEqual(glazoue.produits_du_marche.map((l) => l.produit.id), ['mais', 'riz', 'soja']);
  assert.equal(glazoue.produits_du_marche[0].prix, 90);
  const lokossa = repondrePrix({ transcription: 'axi lokossa', produits: [] });
  assert.equal(lokossa.statut, 'non_compris');
});

test('le nom du marché peut venir d’une transcription de diagnostic', () => {
  const r = repondrePrix({ transcription: 'timáti', transcription_vote: 'timáti tokpa', produits: [produit('timáti')] });
  assert.equal(r.marche.id, 'dantokpa');
  assert.equal(r.reponses[0].ici.prix, 482);
});

test('sans produit reconnu par l’API, on cherche dans la transcription', () => {
  const r = repondrePrix({ transcription: 'gbadé parakú', produits: [] });
  assert.equal(r.reponses[0].produit.id, 'mais');
  assert.equal(r.marche.id, 'parakou');
});

test('produit hors référentiel et phrase incomprise', () => {
  assert.equal(repondrePrix({ transcription: 'azinkwín', produits: [produit('azinkwín')] }).statut, 'sans_prix');
  assert.equal(repondrePrix({ transcription: 'blabla', produits: [] }).statut, 'non_compris');
});

test('chaque réponse a sa version fongbé, y compris l’huile au litre', () => {
  const huile = repondrePrix({ transcription: 'amivɔvɔ dantɔkpa', produits: [produit('amivɔvɔ')] });
  assert.equal(huile.message_fon, `È nɔ sa amivɔvɔ lǐtli ɖokpó yí 1${' '}000${NB}F${NB}CFA ɖo Dantokpa axi mɛ.`);
  for (const transcription of ['axi glazuwe', 'blabla']) {
    assert.ok(repondrePrix({ transcription, produits: [] }).message_fon);
  }
  assert.ok(repondrePrix({ transcription: 'azinkwín', produits: [produit('azinkwín')] }).message_fon);
});

test('référentiel : chaque produit a son nom fongbé et ses libellés PAM ; seul Lokossa n’a pas de source', () => {
  for (const p of base.produits) {
    assert.ok(p.nom_fon, `${p.id} sans nom fongbé`);
    assert.ok(p.pam?.length, `${p.id} sans libellé PAM`);
  }
  assert.deepEqual(base.marches.filter((m) => !m.pam).map((m) => m.id), ['lokossa']);
});

test('l’instantané livré avec le code est cohérent avec le référentiel', () => {
  const instantane = lire('../data/releves-prix.json');
  assert.equal(instantane.source.licence, 'CC BY-IGO');
  const produits = new Set(base.produits.map((p) => p.id));
  const marches = new Set(base.marches.map((m) => m.id));
  for (const [produitId, parMarche] of Object.entries(instantane.prix)) {
    assert.ok(produits.has(produitId), produitId);
    for (const [marcheId, r] of Object.entries(parMarche)) {
      assert.ok(marches.has(marcheId), marcheId);
      assert.ok(Number.isInteger(r.prix) && r.prix > 0, `${produitId} @ ${marcheId}`);
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});
