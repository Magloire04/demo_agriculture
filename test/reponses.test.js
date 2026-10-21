import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { montantFon, morceauxDeMontants } from '../server/nombres-fon.js';
import { creerTextes } from '../server/reponses.js';

const donnees = {
  unites: { kg: { fr: 'le kilo', fon: 'kílò' } },
  phrases: {
    deux_langues: { fr: '{au_marche}, {produit} coûte {prix} F.', fon: '{produit} {prix} F ɖò {marche}.', voix: '{produit} | {prix} | ɖò {marche}.' },
    francais_seul: { fr: 'Bonjour.', fon: null },
  },
};

test('une phrase est remplie dans les deux langues, avec majuscule initiale', () => {
  const textes = creerTextes(donnees);
  const p = textes.phrase('deux_langues', { au_marche: 'au marché de Glazoué', marche: 'Glazoué', produit: { fr: 'le maïs', fon: 'gbàdé' }, prix: '250' });
  assert.deepEqual(p, { fr: 'Au marché de Glazoué, le maïs coûte 250 F.', fon: 'Gbàdé 250 F ɖò Glazoué.', voix: ['Gbàdé', '250', 'Ɖò Glazoué.'] });
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
  assert.deepEqual(textes.joindre([a, { fr: 'B.', fon: 'b.' }]), { fr: 'A. B.', fon: 'a. b.', voix: null });
  assert.deepEqual(textes.joindre([a, { fr: 'B.', fon: null }]), { fr: 'A. B.', fon: null, voix: null });
  assert.deepEqual(textes.joindre([{ ...a, voix: ['a'] }, { fr: 'B.', fon: 'b.', voix: ['b'] }]).voix, ['a', 'b']);
});

test('voix : un nombre seul dans son morceau est dit en unités du marché', () => {
  const textes = creerTextes(donnees);
  const p = textes.phrase('deux_langues', { au_marche: 'au marché de Glazoué', marche: 'Glazoué', produit: { fr: 'le maïs', fon: 'gbàdé' }, prix: 90 });
  assert.equal(p.fon, 'Gbàdé 90 F ɖò Glazoué.');
  assert.deepEqual(p.voix, ['Gbàdé', 'kpɔ́nwun atɔ̀n', 'ɖɔ̌la atɔ̀n', 'Ɖò Glazoué.']);
  assert.equal(textes.phrase('deux_langues', { au_marche: 'à X', marche: 'X', produit: 'x', prix: 1000 }).fon, `X 1${'\u202f'}000 F ɖò X.`);
});

test('montants en fon : exemples des sources', () => {
  const dits = (prix) => montantFon(prix).join(' ');
  assert.equal(dits(90), 'kpɔ́nwun atɔ̀n ɖɔ̌la atɔ̀n'); // règle du guide Corps de la Paix
  assert.equal(dits(130), 'kpɔ́nwun atɔ́ɔ́n ɖɔ̌la ɖokpó'); // guide, p. 51
  assert.equal(dits(60), 'ɖɔ̌la wěwè'); // guide, p. 51
  assert.equal(dits(185), 'kpɔ́nwun tɛ́nwe ɖɔ̌la wè'); // fongbebenin
  assert.equal(dits(400), 'kpɔ́nwun afɔ́tɔn nukún ɖokpó'); // fongbebenin
  assert.equal(dits(500), 'kpɔ́nwun kó');
  assert.equal(dits(975), 'kpɔ́nwun gbàn atɔ́ɔ́n nukún ɛnɛ̀'); // guide, p. 51
  assert.equal(dits(1200), 'caki ɖokpó kpɔ́nwun tántɔn');
  assert.equal(dits(1500), 'caki ɖokpó adaɖé'); // fongbebenin
  assert.equal(dits(139), 'kpɔ́nwun atɔ́ɔ́n ɖɔ̌la atɔ̀n mɔ̌'); // arrondi à 140 F, « environ »
  assert.equal(montantFon(0), null);
  assert.equal(montantFon(40_000), null);
});

test('montants en fon : chaque morceau possible figure dans la liste des extraits', () => {
  const liste = new Set(morceauxDeMontants());
  for (let prix = 3; prix < 40_000; prix += 7) {
    for (const morceau of montantFon(prix)) assert.ok(liste.has(morceau), `${prix} : ${morceau}`);
  }
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

test('data/reponses.json : « voix » reprend la phrase fon, sans « F CFA »', () => {
  const reponses = JSON.parse(readFileSync(new URL('../data/reponses.json', import.meta.url), 'utf8'));
  for (const [id, { fon, voix }] of Object.entries(reponses.phrases)) {
    if (!voix) continue;
    assert.equal(voix.split('|').map((m) => m.trim()).join(' '), fon.replace(/\sF\sCFA/g, ''), id);
  }
});
