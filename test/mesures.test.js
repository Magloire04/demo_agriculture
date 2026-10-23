import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerMesures, jourLocal } from '../server/mesures.js';

const ID_A = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';
const ID_B = '7d6c5b4a-3f2e-4d1c-9b0a-8f7e6d5c4b3a';

async function preparer(t, depart) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-mesures-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  let instant = new Date(depart).getTime();
  const horloge = { aller: (iso) => { instant = new Date(iso).getTime(); } };
  const mesures = creerMesures(dossier, { maintenant: () => new Date(instant) });
  return { dossier, mesures, horloge };
}

function appel(date, resultat, extra = {}) {
  return {
    date, service: 'prix', resultat, code: resultat === 'erreur' ? 'asr_indisponible' : null,
    duree_ms: 2500, duree_api_ms: 2100, duree_audio_s: 3, transcription: 'gbàdé',
    reconnu: { produits: ['Maïs'], marche: null }, reference: null, ...extra,
  };
}

test('jourLocal : Porto-Novo est à UTC+1', () => {
  assert.equal(jourLocal(new Date('2026-10-22T22:59:59Z')), '2026-10-22');
  assert.equal(jourLocal(new Date('2026-10-22T23:00:00Z')), '2026-10-23');
});

test('une personne est comptée une fois par jour, et revenue si vue deux jours', async (t) => {
  const { mesures, horloge } = await preparer(t, '2026-10-20T09:00:00Z');
  mesures.visite(ID_A);
  mesures.visite(ID_A);
  mesures.visite(ID_B);
  horloge.aller('2026-10-22T09:00:00Z');
  mesures.visite(ID_A);
  await mesures.vider();
  horloge.aller('2026-10-23T09:00:00Z');
  const s = await mesures.statistiques({ jours: 7, signalements: [] });
  assert.deepEqual(s.periode, { du: '2026-10-17', au: '2026-10-23' });
  assert.deepEqual(s.personnes, { total: 2, revenues: 1 });
  assert.equal(s.parJour.length, 14);
  assert.deepEqual(s.parJour.find((j) => j.jour === '2026-10-20'), { jour: '2026-10-20', personnes: 2 });
  assert.deepEqual(s.parJour.find((j) => j.jour === '2026-10-22'), { jour: '2026-10-22', personnes: 1 });
  assert.equal(s.parJour.at(-1).jour, '2026-10-23');
});

test('identifiant forgé ignoré', async (t) => {
  const { dossier, mesures } = await preparer(t, '2026-10-23T09:00:00Z');
  mesures.visite('x'.repeat(5000));
  mesures.visite('123');
  mesures.visite(undefined);
  await mesures.vider();
  const fichiers = existsSync(dossier) ? await readdir(dossier) : [];
  assert.deepEqual(fichiers.filter((f) => f.startsWith('visiteurs-')), []);
});

test('limite de jour à Porto-Novo', async (t) => {
  const { dossier, mesures } = await preparer(t, '2026-10-22T23:30:00Z');
  mesures.visite(ID_A);
  await mesures.vider();
  assert.deepEqual((await readdir(dossier)).filter((f) => f.startsWith('visiteurs-')), ['visiteurs-2026-10-23.txt']);
});

test('taux sans les erreurs', async (t) => {
  const { mesures } = await preparer(t, '2026-10-23T09:00:00Z');
  for (const r of ['compris', 'compris', 'compris', 'non_compris', 'erreur', 'erreur']) mesures.appel(appel('2026-10-23T08:00:00Z', r));
  mesures.appel(appel('2026-10-01T08:00:00Z', 'compris')); // hors période
  await mesures.vider();
  const s = await mesures.statistiques({ jours: 7, signalements: [] });
  assert.deepEqual(s.demandes, { comprises: 3, non_comprises: 1, erreurs: 2 });
  assert.equal(s.heures.length, 24);
  assert.equal(s.heures[9], 6); // 08:00 UTC = 09:00 à Porto-Novo
});

test('classements : produits et marchés comptés, triés, 5 au plus', async (t) => {
  const { mesures } = await preparer(t, '2026-10-23T09:00:00Z');
  const produits = [['Maïs'], ['Maïs'], ['Maïs', 'Riz local'], ['Riz local'], ['Tomate'], ['Gari'], ['Igname'], ['Oignon']];
  for (const p of produits) mesures.appel(appel('2026-10-23T08:00:00Z', 'compris', { reconnu: { produits: p, marche: 'Glazoué' } }));
  await mesures.vider();
  const s = await mesures.statistiques({ jours: 7, signalements: [] });
  assert.deepEqual(s.produits.slice(0, 2), [{ nom: 'Maïs', n: 3 }, { nom: 'Riz local', n: 2 }]);
  assert.equal(s.produits.length, 5);
  assert.deepEqual(s.marches, [{ nom: 'Glazoué', n: 8 }]);
});

test('signalements pris en charge et délai', async (t) => {
  const { mesures } = await preparer(t, '2026-10-23T12:00:00Z');
  const signalements = [
    { reference: 'SIG-20261023-001', recu_le: '2026-10-23T08:00:00.000Z', statut: 'pris_en_charge', pris_en_charge_le: '2026-10-23T10:00:00.000Z', simulation: false, localisation: { gps: null, commune: { nom: 'Cotonou', departement: 'Littoral' } } },
    { reference: 'SIG-20261023-002', recu_le: '2026-10-23T09:00:00.000Z', statut: 'transmis', simulation: false, localisation: { gps: null, commune: { nom: 'Cotonou', departement: 'Littoral' } } },
    { reference: 'SIG-20261023-003', recu_le: '2026-10-23T09:30:00.000Z', statut: 'pris_en_charge', pris_en_charge_le: '2026-10-23T09:31:00.000Z', simulation: true, localisation: { gps: null, commune: { nom: 'Glazoué', departement: 'Collines' } } },
    { reference: 'SIG-20261001-001', recu_le: '2026-10-01T09:00:00.000Z', statut: 'transmis', simulation: false, localisation: { gps: null, commune: null } },
  ];
  const s = await mesures.statistiques({ jours: 7, signalements });
  assert.deepEqual(s.signalements, { total: 2, pris: 1, delai_moyen_ms: 7_200_000 });
  assert.deepEqual(s.communes, [{ nom: 'Cotonou', n: 2 }]);
  const vide = await mesures.statistiques({ jours: 7, signalements: [] });
  assert.deepEqual(vide.signalements, { total: 0, pris: 0, delai_moyen_ms: null });
});

test('le journal ne garde ni identifiant, ni IP, ni GPS', async (t) => {
  const { dossier, mesures } = await preparer(t, '2026-10-23T09:00:00Z');
  mesures.appel({ ...appel('2026-10-23T08:00:00Z', 'compris'), visiteur: ID_A, ip: '41.85.160.12', gps: { lat: 6.37, lon: 2.43 } });
  await mesures.vider();
  const [ligne] = (await readFile(path.join(dossier, 'journal-2026-10-23.jsonl'), 'utf8')).trim().split('\n');
  assert.deepEqual(Object.keys(JSON.parse(ligne)).sort(),
    ['code', 'date', 'duree_api_ms', 'duree_audio_s', 'duree_ms', 'reconnu', 'reference', 'resultat', 'service', 'transcription']);
});

test('lireJournal après une date, du plus récent au plus ancien', async (t) => {
  const { mesures } = await preparer(t, '2026-10-23T09:00:00Z');
  mesures.appel(appel('2026-10-22T10:00:00.000Z', 'compris', { transcription: 'un' }));
  mesures.appel(appel('2026-10-23T08:00:00.000Z', 'compris', { transcription: 'deux' }));
  mesures.appel(appel('2026-10-23T08:05:00.000Z', 'non_compris', { transcription: 'trois' }));
  await mesures.vider();
  assert.deepEqual((await mesures.lireJournal({})).map((a) => a.transcription), ['trois', 'deux', 'un']);
  assert.deepEqual((await mesures.lireJournal({ apres: '2026-10-23T08:00:00.000Z' })).map((a) => a.transcription), ['trois']);
  assert.deepEqual((await mesures.lireJournal({ limite: 2 })).map((a) => a.transcription), ['trois', 'deux']);
});

test('refus comptés par jour et par motif, avant comme après l’écriture', async (t) => {
  const { dossier, mesures, horloge } = await preparer(t, '2026-10-22T09:00:00Z');
  mesures.refus('robot');
  await mesures.vider();
  horloge.aller('2026-10-23T09:00:00Z');
  mesures.refus('robot');
  mesures.refus('robot');
  mesures.refus('trop_de_demandes');
  const jours = await mesures.refusParJour(2); // sans vider : les refus en mémoire comptent aussi
  assert.deepEqual(jours, [
    { jour: '2026-10-23', motifs: { robot: 2, trop_de_demandes: 1 } },
    { jour: '2026-10-22', motifs: { robot: 1 } },
  ]);
  await mesures.vider();
  const relus = creerMesures(dossier, { maintenant: () => new Date('2026-10-23T10:00:00Z') });
  assert.deepEqual((await relus.refusParJour(1))[0], { jour: '2026-10-23', motifs: { robot: 2, trop_de_demandes: 1 } });
});

test('purge à 90 jours', async (t) => {
  const { dossier, mesures } = await preparer(t, '2026-10-23T09:00:00Z');
  await mesures.vider();
  await writeFile(path.join(dossier, 'journal-2026-07-24.jsonl'), '{}\n'); // 91 jours
  await writeFile(path.join(dossier, 'visiteurs-2026-07-24.txt'), `${ID_A}\n`);
  await writeFile(path.join(dossier, 'journal-2026-07-26.jsonl'), '{}\n'); // 89 jours
  await mesures.purger();
  const restants = await readdir(dossier);
  assert.ok(!restants.includes('journal-2026-07-24.jsonl'));
  assert.ok(!restants.includes('visiteurs-2026-07-24.txt'));
  assert.ok(restants.includes('journal-2026-07-26.jsonl'));
});
