import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lignesHapi, versLignePam } from '../scripts/importer-prix.js';
import { extraireReleves, lireCsv } from '../server/pam.js';

// Depuis novembre 2026, le téléchargement du fichier du PAM sur HDX est protégé contre
// les robots ; l'import passe par HAPI, l'API de HDX faite pour les programmes.
const ligneHapi = (date, prix, { market = 'Malanville (CBM)', commodity = 'Maize' } = {}) => ({
  location_code: 'BEN', admin1_name: 'Alibori', admin2_name: 'Malanville', market_code: '1044', market_name: market,
  commodity_code: '51', commodity_name: commodity, commodity_category: 'cereals and tubers', currency_code: 'XOF',
  unit: 'KG', price_flag: 'actual', price_type: 'Retail', price: prix,
  reference_period_start: `${date}T00:00:00`, reference_period_end: `${date}T23:59:59`,
});

function fauxHapi(pages) {
  const appels = [];
  const fetch = async (url) => {
    appels.push(new URL(url));
    const page = pages.shift();
    if (page instanceof Response) return page;
    return Response.json({ data: page ?? [] });
  };
  return { fetch, appels };
}

test('HAPI : les pages sont lues jusqu’à la dernière, avec l’identifiant d’AgriFon', async () => {
  const hapi = fauxHapi([[ligneHapi('2026-08-15', 150), ligneHapi('2026-09-15', 145)], [ligneHapi('2026-09-15', 160, { commodity: 'Rice' })]]);
  const lignes = await lignesHapi({ fetch: hapi.fetch, parPage: 2, depuis: '2024-11-01' });
  assert.equal(lignes.length, 3);
  assert.deepEqual(hapi.appels.map((u) => u.searchParams.get('offset')), ['0', '2']);
  const premiere = hapi.appels[0];
  assert.equal(premiere.searchParams.get('location_code'), 'BEN');
  assert.equal(premiere.searchParams.get('start_date'), '2024-11-01');
  assert.equal(Buffer.from(premiere.searchParams.get('app_identifier'), 'base64').toString(), 'AgriFon:technum.services@bytechnum.com');
});

test('une ligne HAPI devient une ligne du fichier du PAM', () => {
  assert.deepEqual(versLignePam(ligneHapi('2026-09-15', 145)), {
    date: '2026-09-15', market: 'Malanville (CBM)', commodity: 'Maize', unit: 'KG',
    currency: 'XOF', pricetype: 'Retail', priceflag: 'actual', price: '145',
  });
});

test('les lignes HAPI donnent les mêmes relevés que le fichier du PAM', () => {
  const referentiel = {
    produits: [{ id: 'mais', unite: 'kg', pam: ['Maize'] }],
    marches: [{ id: 'malanville', pam: 'Malanville (CBM)' }],
  };
  const csv = lireCsv('date,market,commodity,unit,priceflag,pricetype,currency,price\n2026-08-15,Malanville (CBM),Maize,KG,actual,Retail,XOF,150\n2026-09-15,Malanville (CBM),Maize,KG,actual,Retail,XOF,145\n');
  const hapi = [ligneHapi('2026-08-15', 150), ligneHapi('2026-09-15', 145)].map(versLignePam);
  assert.deepEqual(extraireReleves(hapi, referentiel), extraireReleves(csv, referentiel));
  assert.equal(extraireReleves(hapi, referentiel).prix.mais.malanville.prix, 145);
});

test('erreur de HAPI : échec clair, sans prix à moitié lus', async () => {
  const hapi = fauxHapi([Response.json({ error: 'Invalid app identifier' }, { status: 403 })]);
  await assert.rejects(lignesHapi({ fetch: hapi.fetch, depuis: '2024-11-01' }), /HAPI : HTTP 403/);
});
