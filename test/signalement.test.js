import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyserSignalement, creerRegistre } from '../server/signalement.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const lexique = lire('lexique.json');
const { communes } = lire('communes.json');

test('culture, partie, symptôme et commune', () => {
  const a = analyserSignalement(lexique, communes, 'Gbàdé ce ama jaunissent ɖo Djougou.');
  assert.equal(a.culture.id, 'mais');
  assert.deepEqual(a.parties.map((p) => p.id), ['feuilles']);
  assert.deepEqual(a.symptomes.map((s) => s.id), ['jaunissement']);
  assert.deepEqual(a.commune, { nom: 'Djougou', departement: 'Donga' });
});

test('rien de reconnu', () => {
  const a = analyserSignalement(lexique, communes, 'xxx yyy');
  assert.equal(a.culture, null);
  assert.deepEqual(a.symptomes, []);
  assert.equal(a.commune, null);
});

test('les noms de commune trop courts ne sont pas cherchés', () => {
  assert.equal(analyserSignalement(lexique, communes, 'é zé gbàdé').commune, null);
});

test('77 communes, 12 départements', () => {
  assert.equal(communes.length, 77);
  assert.equal(new Set(communes.map((c) => c.departement)).size, 12);
});

test('registre : références du jour, audio, prise en charge, relecture', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const registre = await creerRegistre(dossier);

  const s1 = await registre.ajouter({ audio: Buffer.from('son'), extension: 'webm', transcription: 'a' });
  const s2 = await registre.ajouter({ audio: null, extension: 'webm', transcription: 'b' });
  assert.match(s1.reference, /^SIG-\d{8}-001$/);
  assert.match(s2.reference, /^SIG-\d{8}-002$/);
  assert.equal(s1.statut, 'transmis');
  assert.equal(await readFile(registre.cheminAudio(s1), 'utf8'), 'son');
  assert.equal(registre.cheminAudio(s2), null);
  assert.deepEqual(registre.lister().map((s) => s.reference), [s2.reference, s1.reference]);

  await registre.prendreEnCharge(s1.reference);
  const relu = await creerRegistre(dossier);
  assert.equal(relu.trouver(s1.reference).statut, 'pris_en_charge');
  assert.ok(relu.trouver(s1.reference).pris_en_charge_le);
  assert.equal(await relu.prendreEnCharge('SIG-00000000-999'), null);
});
