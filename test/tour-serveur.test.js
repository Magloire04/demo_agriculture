import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerApplication } from '../server/index.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerSynthese } from '../server/synthese.js';
import { creerVoix } from '../server/voix.js';
import { ecrireWav } from '../server/wav.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const HEX = /^[0-9a-f]{16}$/;

// Serveur réel, labo de synthèse factice : les phrases du tour et leurs voix.
async function demarrer(t, { tour = lire('tour.json'), avecSynthese = true } = {}) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-tour-'));
  const appeler = async () => ecrireWav({ frequence: 24000, echantillons: new Int16Array(2400) });
  const gerer = creerApplication({
    asr: { configure: true, simulation: false },
    base: lire('referentiel.json'),
    releves: { lire: () => JSON.parse(readFileSync(new URL('./fixtures/releves.json', import.meta.url), 'utf8')) },
    lexique: lire('lexique.json'),
    communes: lire('communes.json').communes,
    registre: await creerRegistre(dossier),
    textes: creerTextes(lire('reponses.json')),
    voix: creerVoix('/inexistant'),
    protection: null,
    tour,
    synthese: avecSynthese ? creerSynthese({ dossier: path.join(dossier, 'voix-phrases'), appeler, voix: 'homme2' }) : null,
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(async () => {
    serveur.close();
    await rm(dossier, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${serveur.address().port}`;
}

test('GET /api/tour : chaque phrase avec son fon et un identifiant de voix', async (t) => {
  const url = await demarrer(t);
  const rep = await fetch(`${url}/api/tour`);
  assert.equal(rep.status, 200);
  const { phrases } = await rep.json();
  const attendues = lire('tour.json').phrases;
  assert.equal(Object.keys(phrases).length, 15);
  assert.deepEqual(Object.keys(phrases).sort(), Object.keys(attendues).sort());
  for (const [cle, p] of Object.entries(phrases)) {
    assert.equal(p.fon, attendues[cle].fon, cle);
    assert.match(p.voix_phrase, HEX, cle);
    assert.equal(p.fr, undefined, `${cle} : le français reste sur le serveur`);
  }
  // Identifiant émis par AgriFon : le son est préparé ou en préparation, jamais inconnu.
  const son = await fetch(`${url}/api/voix/${phrases.tour_bienvenue.voix_phrase}.wav`);
  assert.notEqual(son.status, 404);
});

test('GET /api/tour sans synthèse : voix_phrase null', async (t) => {
  const url = await demarrer(t, { avecSynthese: false });
  const { phrases } = await (await fetch(`${url}/api/tour`)).json();
  assert.ok(Object.values(phrases).every((p) => p.voix_phrase === null && p.fon));
});

test('GET /api/tour sans phrases du tour : aucune phrase', async (t) => {
  const url = await demarrer(t, { tour: null });
  assert.deepEqual(await (await fetch(`${url}/api/tour`)).json(), { phrases: {} });
});
