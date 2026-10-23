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

test('symptômes dits en fon', () => {
  const symptomes = (texte) => analyserSignalement(lexique, communes, texte).symptomes.map((s) => s.id);
  // Phrase réelle : « fyɔ́ » (se dessécher) transcrit « fí ɔ́ ».
  const reel = analyserSignalement(lexique, communes, 'Mɔ̌likún ce sín ama fí ɔ́.');
  assert.equal(reel.culture.id, 'riz');
  assert.deepEqual(reel.parties.map((p) => p.id), ['feuilles']);
  assert.deepEqual(reel.symptomes.map((s) => s.id), ['fletrissement']);
  assert.deepEqual(symptomes('gbàdé cé sín ama lɛ́ ɖò koklojonɔ cí wɛ'), ['jaunissement']);
  assert.deepEqual(symptomes('wànvú lɛ́ ɖù ama lɛ́'), ['ravageurs', 'feuilles_mangees']);
  assert.deepEqual(symptomes('tɛvi cé jɛ̀ vǎ'), ['pourriture']);
});

test('symptômes et parties : pas de détection sur un mot voisin ou deux mots recollés', () => {
  const a = analyserSignalement(lexique, communes, 'a ma fɔ́n ganji à, un yi wan nu wɛ, é ɖɔ tɔn');
  assert.deepEqual(a.parties, []);
  assert.deepEqual(a.symptomes, []);
  assert.deepEqual(analyserSignalement(lexique, communes, 'un ɖò fí ɔ́').symptomes, []);
});

test('striga reconnu seulement quand il est nommé', () => {
  const ids = (t) => analyserSignalement(lexique, communes, t).symptomes.map((s) => s.id);
  assert.deepEqual(ids('Mon maïs a du striga'), ['striga']);
  assert.deepEqual(ids('une plante parasite dans le sorgho'), ['striga']);
  assert.deepEqual(ids('Gbàdé ce ama jaunissent'), ['jaunissement']);
});

test('un mot fon court ne se confond pas avec un mot français sans lettre fon', () => {
  const ids = (t) => analyserSignalement(lexique, communes, t).symptomes.map((s) => s.id);
  // « ɖù » (manger) ne doit pas être trouvé dans l'article « du ».
  assert.deepEqual(ids('Les fruits du plant de tomate pourrissent'), ['pourriture']);
  assert.deepEqual(ids('Les feuilles du gboma ont des taches'), ['taches']);
  assert.deepEqual(ids('wànvú lɛ́ ɖù ama lɛ́'), ['ravageurs', 'feuilles_mangees']);
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
