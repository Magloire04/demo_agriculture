import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerApplication } from '../server/index.js';
import { creerProtection } from '../server/protection.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerSynthese } from '../server/synthese.js';
import { creerVoix } from '../server/voix.js';
import { ecrireWav } from '../server/wav.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const HEX = /^[0-9a-f]{16}$/;

const fausseAsr = {
  configure: true,
  simulation: false,
  marche: async () => ({ transcription: 'gbàdé glazuwe', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], id: 'r1' }),
  transcrire: async () => ({ texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', id: 'r2' }),
};

// Labo factice : note les textes reçus, peut attendre une promesse avant de répondre.
function labo(retenue = null) {
  const recus = [];
  return {
    recus,
    appeler: async (texte) => {
      recus.push(texte);
      if (retenue) await retenue;
      return ecrireWav({ frequence: 24000, echantillons: new Int16Array(2400) });
    },
  };
}

async function demarrer(t, { synthese = undefined, appeler = labo().appeler, attenteMs = 20_000, protection = null } = {}) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-voix-'));
  const gerer = creerApplication({
    asr: fausseAsr,
    base: lire('referentiel.json'),
    releves: { lire: () => JSON.parse(readFileSync(new URL('./fixtures/releves.json', import.meta.url), 'utf8')) },
    lexique: lire('lexique.json'),
    communes: lire('communes.json').communes,
    registre: await creerRegistre(dossier),
    textes: creerTextes(lire('reponses.json')),
    voix: creerVoix('/inexistant'),
    solutions: lire('solutions.json'),
    protection,
    synthese: synthese === undefined ? creerSynthese({ dossier: path.join(dossier, 'voix-phrases'), appeler, voix: 'homme2', attenteMs }) : synthese,
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(async () => {
    serveur.close();
    await rm(dossier, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${serveur.address().port}`;
}

const envoyer = (url) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: 'audio' });
// Requête au chemin brut, sans la normalisation que fait fetch (« .. »).
const brut = (url, chemin) => new Promise((ok, ko) => {
  get(`${url}${chemin}`, { path: chemin }, (res) => { res.resume(); ok(res.statusCode); }).on('error', ko);
});

test('prix : voix_phrase, et le labo reçoit le texte entier en minuscule au milieu', async (t) => {
  const l = labo();
  const url = await demarrer(t, { appeler: l.appeler });
  const corps = await (await envoyer(`${url}/api/prix`)).json();
  assert.match(corps.voix_phrase, HEX);
  assert.equal(corps.voix, null); // anciens extraits absents ici : inchangé
  assert.equal((await fetch(`${url}/api/voix/${corps.voix_phrase}.wav`)).status, 200);
  assert.deepEqual(l.recus, ['È nɔ sa gbadé kilo ɖokpó yí kpɔ́nwun atɔ̀n ɖɔ̌la atɔ̀n ɖo Glazoué axi mɛ.']);
});

test('son : 200 audio/wav immuable, en 16 kHz', async (t) => {
  const url = await demarrer(t);
  const { voix_phrase: id } = await (await envoyer(`${url}/api/prix`)).json();
  const rep = await fetch(`${url}/api/voix/${id}.wav`);
  assert.equal(rep.status, 200);
  assert.equal(rep.headers.get('content-type'), 'audio/wav');
  assert.equal(rep.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const son = Buffer.from(await rep.arrayBuffer());
  assert.equal(son.toString('latin1', 0, 4), 'RIFF');
  assert.equal(son.readUInt32LE(24), 16000);
});

test('son : 202 avec Retry-After 10 tant que le labo travaille, puis 200', async (t) => {
  let liberer;
  const l = labo(new Promise((r) => { liberer = r; }));
  const url = await demarrer(t, { appeler: l.appeler, attenteMs: 50 });
  const { voix_phrase: id } = await (await envoyer(`${url}/api/prix`)).json();
  const attente = await fetch(`${url}/api/voix/${id}.wav`);
  assert.equal(attente.status, 202);
  assert.equal(attente.headers.get('retry-after'), '10');
  assert.deepEqual(await attente.json(), { pret: false });
  liberer();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await fetch(`${url}/api/voix/${id}.wav`)).status, 200);
  assert.equal(l.recus.length, 1);
});

test('son : identifiant inconnu, chemins forgés, autre extension : 404', async (t) => {
  const url = await demarrer(t);
  for (const chemin of ['/api/voix/0123456789abcdef.wav', '/api/voix/XYZ.wav', '/api/voix/0123456789ABCDEF.wav', '/api/voix/0123456789abcdef.mp3']) {
    assert.equal((await fetch(`${url}${chemin}`)).status, 404, chemin);
  }
  assert.equal(await brut(url, '/api/voix/../index.html'), 404);
  assert.equal(await brut(url, '/api/voix/..%2f..%2fpackage.json'), 404);
});

test('signalement : voix_phrase de l’accusé, et solutions.voix_phrase quand des solutions sont proposées', async (t) => {
  const url = await demarrer(t);
  const r = await (await envoyer(`${url}/api/signalements?commune=Glazou%C3%A9`)).json();
  assert.match(r.voix_phrase, HEX);
  assert.ok(r.solutions.elements.length >= 2);
  assert.match(r.solutions.voix_phrase, HEX);
  assert.notEqual(r.solutions.voix_phrase, r.voix_phrase);
  const liste = await (await fetch(`${url}/api/signalements`)).json();
  assert.equal(liste.signalements.find((s) => s.reference === r.reference).solutions.voix_phrase, undefined);
});

test('sans synthèse : voix_phrase null et route du son en 404', async (t) => {
  const url = await demarrer(t, { synthese: null });
  const corps = await (await envoyer(`${url}/api/prix`)).json();
  assert.equal(corps.voix_phrase, null);
  assert.equal((await fetch(`${url}/api/voix/0123456789abcdef.wav`)).status, 404);
});

test('protection : un robot est refusé sur la route du son', async (t) => {
  const url = await demarrer(t, { protection: creerProtection() });
  const rep = await fetch(`${url}/api/voix/0123456789abcdef.wav`, { headers: { 'User-Agent': 'curl/8.4.0' } });
  assert.equal(rep.status, 403);
});
