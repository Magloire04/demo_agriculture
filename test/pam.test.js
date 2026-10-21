import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extraireReleves, lireCsv } from '../server/pam.js';

const ENTETE = 'date,admin1,admin2,market,market_id,latitude,longitude,category,commodity,commodity_id,unit,priceflag,pricetype,currency,price,usdprice';
const ligne = (date, marche, produit, prix, { unite = 'KG', flag = 'actual', type = 'Retail', monnaie = 'XOF' } = {}) =>
  `${date},X,Y,${marche},1,0,0,c,${produit.includes(',') ? `"${produit}"` : produit},1,${unite},${flag},${type},${monnaie},${prix},0`;

const referentiel = {
  marches: [
    { id: 'glazoue', pam: 'Glazoué' },
    { id: 'dantokpa', pam: 'Dantokpa' },
    { id: 'malanville', pam: 'Malanville (CBM)' },
    { id: 'lokossa', pam: null },
  ],
  produits: [
    { id: 'mais', unite: 'kg', pam: ['Maize (white)'] },
    { id: 'riz', unite: 'kg', pam: ['Rice (local)', 'Rice (milled, local)'] },
    { id: 'arachide', unite: 'kg', pam: ['Groundnuts (small, unshelled)'] },
    { id: 'huile_palme', unite: 'litre', pam: ['Oil (palm)'] },
  ],
};

const CSV = [
  ENTETE,
  '#date,#adm1+name,#adm2+name,#loc+market+name,#loc+market+code,#geo+lat,#geo+lon,#item+type,#item+name,#item+code,#item+unit,#item+price+flag,#item+price+type,#currency,#value,#value+usd',
  ligne('2026-08-15', 'Glazoué', 'Maize (white)', 95),
  ligne('2026-09-15', 'Glazoué', 'Maize (white)', 90),
  ligne('2026-09-15', 'Glazoué', 'Maize (white)', 999, { flag: 'forecast' }),
  ligne('2026-09-15', 'Glazoué', 'Maize (white)', 50, { type: 'Wholesale' }),
  ligne('2026-09-15', 'Glazoué', 'Maize (white)', 1, { monnaie: 'USD' }),
  ligne('2026-09-15', 'Glazoué', 'Groundnuts (small, unshelled)', 719),
  ligne('2026-09-15', 'Dantokpa', 'Maize (white)', 160),
  ligne('2026-09-15', 'Dantokpa', 'Maize (white)', 161),
  ligne('2025-01-15', 'Dantokpa', 'Rice (local)', 600),
  ligne('2026-09-15', 'Dantokpa', 'Rice (milled, local)', 520),
  ligne('2026-09-15', 'Dantokpa', 'Oil (palm)', 1000, { unite: 'L' }),
  ligne('2026-09-15', 'Dantokpa', 'Oil (palm)', 700, { unite: 'KG' }),
  ligne('2025-12-15', 'Malanville (CBM)', 'Maize (white)', 140),
  ligne('2026-09-15', 'Lokossa', 'Maize (white)', 100),
].join('\r\n');

test('lireCsv : guillemets, CRLF, ligne d’étiquettes HXL ignorée', () => {
  const lignes = lireCsv(CSV);
  assert.equal(lignes.length, 14);
  assert.equal(lignes[5].commodity, 'Groundnuts (small, unshelled)');
  assert.equal(lignes[0].market, 'Glazoué');
  assert.deepEqual(lireCsv('a,b\n"x ""y""",2\n'), [{ a: 'x "y"', b: '2' }]);
});

test('extraireReleves : dernier et avant-dernier relevé de détail en F CFA', () => {
  const { prix, derniere_date: derniere } = extraireReleves(lireCsv(CSV), referentiel);
  assert.equal(derniere, '2026-09-15');
  assert.deepEqual(prix.mais.glazoue, { date: '2026-09-15', prix: 90, libelle: 'Maize (white)', precedent: { date: '2026-08-15', prix: 95 } });
  assert.deepEqual(prix.arachide.glazoue, { date: '2026-09-15', prix: 719, libelle: 'Groundnuts (small, unshelled)', precedent: null });
});

test('extraireReleves : relevés du même jour moyennés puis arrondis', () => {
  const { prix } = extraireReleves(lireCsv(CSV), referentiel);
  assert.equal(prix.mais.dantokpa.prix, 161); // (160 + 161) / 2 = 160,5
});

test('extraireReleves : libellé de repli si le premier est trop ancien, unité respectée', () => {
  const { prix } = extraireReleves(lireCsv(CSV), referentiel);
  assert.equal(prix.riz.dantokpa.libelle, 'Rice (milled, local)');
  assert.equal(prix.riz.dantokpa.prix, 520);
  assert.equal(prix.huile_palme.dantokpa.prix, 1000);
});

test('extraireReleves : relevés trop anciens et marchés sans source écartés', () => {
  const { prix, manquants } = extraireReleves(lireCsv(CSV), referentiel);
  assert.equal(prix.mais.malanville, undefined);
  assert.equal(prix.mais.lokossa, undefined);
  assert.ok(manquants.includes('mais @ malanville'));
  assert.ok(!manquants.some((m) => m.endsWith('@ lokossa')));
  assert.ok(manquants.includes('riz @ glazoue'));
});

test('extraireReleves : fichier vide', () => {
  const { prix, derniere_date: derniere } = extraireReleves(lireCsv(`${ENTETE}\n`), referentiel);
  assert.deepEqual(prix, {});
  assert.equal(derniere, null);
});
