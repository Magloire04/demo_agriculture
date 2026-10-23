import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerClientAsr, ErreurAsr } from '../server/asr.js';
import { creerApplication } from '../server/index.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerVoix, fichierVoix } from '../server/voix.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));

async function demarrer(t, { asr, codeConseiller = '', voix = creerVoix('/inexistant'), signalements = null }) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-'));
  if (signalements) await writeFile(path.join(dossier, 'signalements.json'), JSON.stringify(signalements));
  const registre = await creerRegistre(dossier);
  const gerer = creerApplication({
    asr,
    base: lire('referentiel.json'),
    releves: { lire: () => JSON.parse(readFileSync(new URL('./fixtures/releves.json', import.meta.url), 'utf8')) },
    lexique: lire('lexique.json'),
    communes: lire('communes.json').communes,
    registre,
    textes: creerTextes(lire('reponses.json')),
    codeConseiller,
    voix,
    solutions: lire('solutions.json'),
    protection: null, // la protection contre les robots est testée à part (protection.test.js)
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
    marche: async (audio, type, options) => {
      appels.push({ point: 'marche', type, taille: audio.length, noms: options.noms.length });
      return reponses.marche ?? { transcription: 'gbàdé glazuwe', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], id: 'r1' };
    },
    transcrire: async (audio, type, options) => {
      appels.push({ point: 'transcrire', type, options });
      if (reponses.erreur) throw reponses.erreur;
      const texte = reponses.texte ?? 'gbàdé ama jaunissent';
      return { texte, texte_ponctue: reponses.texte ? texte : 'Gbàdé ama jaunissent.', id: 'r2' };
    },
  };
}

test('POST /api/prix relaie l’audio et répond le prix', async (t) => {
  const asr = fausseAsr();
  const url = await demarrer(t, { asr });
  const rep = await envoyer(`${url}/api/prix`, 'abc', 'audio/webm;codecs=opus');
  assert.equal(rep.status, 200);
  const r = await rep.json();
  assert.equal(r.message, 'Au marché de Glazoué, le maïs coûte 90\u00a0F\u00a0CFA le kilo.');
  assert.equal(r.source.nom, 'PAM (Programme alimentaire mondial)');
  assert.deepEqual(asr.appels, [{ point: 'marche', type: 'audio/webm', taille: 3, noms: 19 }]);
});

test('POST /api/prix : la voix est donnée seulement si tous ses extraits existent', async (t) => {
  const sansExtraits = await (await envoyer(`${await demarrer(t, { asr: fausseAsr() })}/api/prix`)).json();
  assert.equal(sansExtraits.voix, null);

  const toutes = { fichiers: (morceaux) => morceaux.map(fichierVoix) };
  const r = await (await envoyer(`${await demarrer(t, { asr: fausseAsr(), voix: toutes })}/api/prix`)).json();
  const attendus = ['È nɔ sa gbadé kilo ɖokpó yí', 'kpɔ́nwun atɔ̀n', 'ɖɔ̌la atɔ̀n', 'ɖo Glazoué axi mɛ.'].map(fichierVoix);
  assert.deepEqual(r.voix, attendus);
});

test('fichiers statiques : revalidés par ETag, 304 s’ils n’ont pas changé', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr() });
  const premiere = await fetch(`${url}/js/voix.js`);
  assert.equal(premiere.status, 200);
  assert.equal(premiere.headers.get('cache-control'), 'no-cache');
  const etag = premiere.headers.get('etag');
  assert.ok(etag);
  const seconde = await fetch(`${url}/js/voix.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(seconde.status, 304);
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
  assert.equal(s.messages.recu.fr, 'Votre signalement a été reçu. Il est transmis au conseiller agricole de la commune de Glazoué.');
  assert.equal(s.messages.recu.fon, 'Mǐ se xó mitɔn. Mǐ sɛ́ ɛ dó glegán Glazoué tɔn.');
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

test('signalement : solutions jointes et enregistrées', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr() });
  const r = await (await envoyer(`${url}/api/signalements?commune=Glazou%C3%A9`)).json();
  assert.ok(r.solutions.elements.length >= 2);
  assert.equal(r.solutions.mention.fr, 'À confirmer avec un conseiller.');
  assert.equal(r.solutions.titre.fr, 'En attendant le conseiller, vous pouvez :');
  assert.equal(r.solutions.morceaux, undefined);
  const liste = await (await fetch(`${url}/api/signalements`)).json();
  const enregistre = liste.signalements.find((s) => s.reference === r.reference);
  assert.deepEqual(enregistre.solutions.elements, r.solutions.elements);
  assert.equal(enregistre.solutions.voix, undefined);
  assert.equal(enregistre.solutions.morceaux, undefined);
});

test('signalement : voix des solutions nulle s’il manque un extrait, section présente', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr(), voix: creerVoix('/inexistant') });
  const r = await (await envoyer(`${url}/api/signalements`)).json();
  assert.equal(r.solutions.voix, null);
  assert.ok(r.solutions.elements.length >= 2);

  const toutes = { fichiers: (morceaux) => morceaux.map(fichierVoix) };
  const avec = await (await envoyer(`${await demarrer(t, { asr: fausseAsr(), voix: toutes })}/api/signalements`)).json();
  assert.ok(avec.solutions.voix.length >= 3);
});

test('signalement localisé par GPS seulement : aucun geste de saison', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr() });
  const r = await (await envoyer(`${url}/api/signalements?lat=6.4&lon=2.3`)).json();
  assert.equal(r.localisation.commune, null);
  const ids = r.solutions.elements.map((e) => e.id);
  assert.ok(!ids.includes('arroser') && !ids.includes('drainer'), ids.join(', '));
});

test('signalement sans symptôme reconnu : solutions nulles', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr({ texte: 'blabla' }) });
  const r = await (await envoyer(`${url}/api/signalements`)).json();
  assert.equal(r.solutions, null);
});

test('ancien signalement sans solutions : liste conseiller intacte', async (t) => {
  const ancien = {
    reference: 'SIG-20261020-001', recu_le: '2026-10-20T20:47:03.549Z', statut: 'transmis', transcription: 'gbàdé',
    culture: null, parties: [], symptomes: [], localisation: { gps: null, commune: null },
    destinataire: 'Conseiller agricole le plus proche de votre position', id_requete: null, simulation: false, audio: null,
  };
  const url = await demarrer(t, { asr: fausseAsr(), signalements: [ancien] });
  const rep = await fetch(`${url}/api/signalements`);
  assert.equal(rep.status, 200);
  const [s] = (await rep.json()).signalements;
  assert.equal(s.reference, 'SIG-20261020-001');
  assert.equal(s.solutions ?? null, null);
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
  const corps = await rep.json();
  assert.equal(corps.erreur, erreur.message);
  assert.equal(corps.code, 'asr_indisponible');
  assert.equal(corps.erreur_fon, lire('reponses.json').phrases.erreur_reessayer.fon);
});

test('fichiers statiques, sans sortir du dossier site', async (t) => {
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

test('/admin sert la page d’administration, sans script ni style en ligne', async (t) => {
  const url = await demarrer(t, { asr: fausseAsr() });
  const rep = await fetch(`${url}/admin`);
  assert.equal(rep.status, 200);
  assert.match(rep.headers.get('content-type'), /^text\/html/);
  const page = await rep.text();
  assert.match(page, /<title>[^<]*Administration[^<]*<\/title>/);
  assert.match(page, /<script type="module" src="js\/admin\.js"><\/script>/);
  assert.ok(!/<style|style="|<script>/.test(page), 'aucun style ni script en ligne (CSP)');
  assert.equal((await fetch(`${url}/js/admin.js`)).status, 200);
  assert.equal((await fetch(`${url}/css/admin.css`)).status, 200);
});

test('client ASR : sante() en simulation, en réussite et en erreur réseau', async () => {
  assert.deepEqual(await creerClientAsr({ simulation: true }).sante(), { ok: true, modele: 'simulation', duree_ms: 0 });
  const requetes = [];
  const bon = creerClientAsr({
    identifiant: 'id',
    motDePasse: 'mdp',
    fetch: async (url, options) => {
      requetes.push({ url: String(url), options });
      return Response.json({ status: 'ok', modele: 'ROVER fonasr 0.9' });
    },
  });
  const r = await bon.sante();
  assert.deepEqual([r.ok, r.modele], [true, 'ROVER fonasr 0.9']);
  assert.ok(Number.isFinite(r.duree_ms));
  assert.equal(new URL(requetes[0].url).pathname, '/health');
  assert.equal(requetes[0].options.headers.Authorization, `Basic ${Buffer.from('id:mdp').toString('base64')}`);
  const panne = creerClientAsr({ identifiant: 'id', motDePasse: 'mdp', fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual(Object.entries(await panne.sante()).filter(([k]) => k !== 'duree_ms'), [['ok', false], ['modele', null]]);
  const refus = creerClientAsr({ identifiant: 'id', motDePasse: 'mdp', fetch: async () => Response.json({ detail: 'x' }, { status: 503 }) });
  assert.equal((await refus.sante()).ok, false);
});

test('aucun dossier public/ : Passenger le servirait sans passer par le serveur ni par sa protection', async (t) => {
  const racine = new URL('../', import.meta.url);
  assert.equal(existsSync(new URL('public', racine)), false);
  assert.equal(existsSync(new URL('site/index.html', racine)), true);
  const url = await demarrer(t, { asr: fausseAsr() });
  assert.equal((await fetch(`${url}/js/app.js`)).status, 200);
});
