import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerClientAsr, ErreurAsr } from '../server/asr.js';
import { creerApplication } from '../server/index.js';
import { creerRegistre } from '../server/signalement.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));

async function demarrer(t, { asr, codeConseiller = '' }) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-'));
  const registre = await creerRegistre(dossier);
  const gerer = creerApplication({
    asr,
    base: lire('prix.json'),
    lexique: lire('lexique.json'),
    communes: lire('communes.json').communes,
    registre,
    codeConseiller,
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(async () => {
    serveur.close();
    await rm(dossier, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${serveur.address().port}`;
}

const envoyer = (url, corps = 'audio', type = 'audio/webm') =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: corps });

function fausseAsr(reponses = {}) {
  const appels = [];
  return {
    appels,
    configure: true,
    simulation: false,
    marche: async (audio, type) => {
      appels.push({ point: 'marche', type, taille: audio.length });
      return reponses.marche ?? { transcription: 'gbàdé glazuwe', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], id: 'r1' };
    },
    transcrire: async (audio, type, options) => {
      appels.push({ point: 'transcrire', type, options });
      if (reponses.erreur) throw reponses.erreur;
      return { texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', id: 'r2' };
    },
  };
}

test('POST /api/prix relaie l’audio et répond le prix', async (t) => {
  const asr = fausseAsr();
  const url = await demarrer(t, { asr });
  const rep = await envoyer(`${url}/api/prix`, 'abc', 'audio/webm;codecs=opus');
  assert.equal(rep.status, 200);
  const r = await rep.json();
  assert.equal(r.message, 'Au marché de Glazoué, le maïs coûte 250 F CFA le kilo.');
  assert.deepEqual(asr.appels, [{ point: 'marche', type: 'audio/webm', taille: 3 }]);
});

test('POST /api/prix refuse ce qui n’est pas de l’audio, et un corps vide', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr() });
  assert.equal((await envoyer(`${url}/api/prix`, 'x', 'text/plain')).status, 415);
  assert.equal((await envoyer(`${url}/api/prix`, '')).status, 422);
});

test('signalement : enregistré, suivi public, réservé au conseiller ensuite', async (t) => {
  const asr = fausseAsr();
  const url = await demarrer(t, { asr, codeConseiller: 'secret' });

  const rep = await envoyer(`${url}/api/signalements?lat=7.97&lon=2.24&precision=12&commune=Glazou%C3%A9`);
  assert.equal(rep.status, 201);
  const s = await rep.json();
  assert.equal(s.culture.id, 'mais');
  assert.deepEqual(s.symptomes.map((x) => x.id), ['jaunissement']);
  assert.deepEqual(s.localisation, { gps: { lat: 7.97, lon: 2.24, precision: 12 }, commune: { nom: 'Glazoué', departement: 'Collines', source: 'choisie' } });
  assert.equal(s.destinataire, 'Conseiller agricole de la commune de Glazoué (Collines)');
  assert.equal(s.audio, undefined);
  assert.equal(s.audio_disponible, true);
  // Les communes du département sont proposées à l'API comme noms attendus.
  assert.ok(asr.appels[0].options.noms.includes('Dassa-Zoumè'));

  const statut = await (await fetch(`${url}/api/signalements/${s.reference}`)).json();
  assert.deepEqual(Object.keys(statut).sort(), ['pris_en_charge_le', 'recu_le', 'reference', 'statut']);

  assert.equal((await fetch(`${url}/api/signalements`)).status, 401);
  assert.equal((await fetch(`${url}/api/signalements/${s.reference}/audio`)).status, 401);
  const avecCode = { headers: { 'X-Code-Conseiller': 'secret' } };
  const liste = await (await fetch(`${url}/api/signalements`, avecCode)).json();
  assert.equal(liste.signalements.length, 1);
  const audio = await fetch(`${url}/api/signalements/${s.reference}/audio?code=secret`);
  assert.equal(audio.headers.get('content-type'), 'audio/webm');
  assert.equal(await audio.text(), 'audio');

  const pris = await fetch(`${url}/api/signalements/${s.reference}/prise-en-charge`, { method: 'POST', ...avecCode });
  assert.equal((await pris.json()).statut, 'pris_en_charge');
});

test('paramètres de lieu invalides ignorés', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr() });
  const s = await (await envoyer(`${url}/api/signalements?lat=999&lon=2&commune=Atlantis`)).json();
  assert.deepEqual(s.localisation, { gps: null, commune: null });
});

test('une erreur de l’API devient un message lisible', async (t) => {
  const erreur = new ErreurAsr('Le service de reconnaissance vocale est momentanément indisponible.', { statut: 503, code: 'asr_indisponible' });
  const url = await demarrer(t, { asr: fausseAsr({ erreur }) });
  const rep = await envoyer(`${url}/api/signalements`);
  assert.equal(rep.status, 503);
  assert.deepEqual(await rep.json(), { erreur: erreur.message, code: 'asr_indisponible' });
});

test('fichiers statiques, sans sortir du dossier public', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr() });
  const accueil = await fetch(`${url}/`);
  assert.equal(accueil.status, 200);
  assert.match(accueil.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${url}/conseiller`)).status, 200);
  assert.equal((await fetch(`${url}/manifest.webmanifest`)).headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  assert.equal((await fetch(`${url}/%2e%2e/server/asr.js`)).status, 404);
  assert.equal((await fetch(`${url}/..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${url}/api/inconnu`)).status, 404);
});

test('client ASR : authentification Basic, nom de fichier, paramètres', async () => {
  const requetes = [];
  const asr = creerClientAsr({
    identifiant: 'id',
    motDePasse: 'mdp',
    fetch: async (url, options) => {
      requetes.push({ url: String(url), options });
      return Response.json({ texte: 'a', texte_ponctue: 'A.' });
    },
  });
  await asr.transcrire(Buffer.from('x'), 'audio/mp4', { noms: ['Glazoué', 'Savè'] });
  const { url, options } = requetes[0];
  assert.equal(options.headers.Authorization, `Basic ${Buffer.from('id:mdp').toString('base64')}`);
  assert.equal(new URL(url).pathname, '/transcribe');
  assert.equal(new URL(url).searchParams.get('noms'), 'Glazoué,Savè');
  assert.equal(new URL(url).searchParams.get('app_version'), 'agrifon-1.0.0');
  assert.equal(options.body.get('file').name, 'phrase.m4a');
});

test('client ASR : codes d’erreur traduits, sans identifiants refusé', async () => {
  const avec = (statut) => creerClientAsr({
    identifiant: 'id',
    motDePasse: 'mdp',
    fetch: async () => Response.json({ detail: 'x' }, { status: statut }),
  });
  await assert.rejects(avec(401).marche(Buffer.from('x'), 'audio/webm'), { code: 'asr_identifiants', statut: 503 });
  await assert.rejects(avec(413).marche(Buffer.from('x'), 'audio/webm'), { code: 'audio_trop_long', statut: 413 });
  await assert.rejects(avec(422).marche(Buffer.from('x'), 'audio/webm'), { code: 'audio_trop_court', statut: 422 });
  await assert.rejects(avec(502).marche(Buffer.from('x'), 'audio/webm'), { code: 'asr_indisponible', statut: 503 });
  await assert.rejects(creerClientAsr({}).marche(Buffer.from('x'), 'audio/webm'), { code: 'asr_identifiants' });
});

test('client ASR : une seule requête à la fois vers l’API', async () => {
  let enCours = 0;
  let maximum = 0;
  const asr = creerClientAsr({
    identifiant: 'id',
    motDePasse: 'mdp',
    fetch: async () => {
      enCours++;
      maximum = Math.max(maximum, enCours);
      await new Promise((r) => setTimeout(r, 20));
      enCours--;
      return Response.json({ produits: [] });
    },
  });
  await Promise.all([1, 2, 3].map(() => asr.marche(Buffer.from('x'), 'audio/webm')));
  assert.equal(maximum, 1);
});
