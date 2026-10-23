import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ErreurAsr } from '../server/asr.js';
import { creerApplication } from '../server/index.js';
import { creerMesures } from '../server/mesures.js';
import { creerProtection } from '../server/protection.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerVoix } from '../server/voix.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const VISITEUR = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';
// L'application du téléphone tourne dans un navigateur : son agent n'est pas celui d'un robot.
const NAVIGATEUR = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

// Fausse API au format de JaimeMaLangue ; `erreur` la fait échouer.
function fausseAsr({ marche, erreur } = {}) {
  return {
    configure: true,
    simulation: false,
    marche: async () => {
      if (erreur) throw erreur;
      return marche ?? { transcription: 'gbàdé glazuwe', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], duree_audio_s: 3, id: 'r1' };
    },
    transcrire: async () => {
      if (erreur) throw erreur;
      return { texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', duree_audio_s: 4, id: 'r2' };
    },
  };
}

async function demarrer(t, { asr = fausseAsr(), protection = null, codeConseiller = '', dossierMesures = null, maxVisitesParAdresse } = {}) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-mesures-serveur-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const mesures = creerMesures(dossierMesures ?? path.join(dossier, 'mesures'));
  const gerer = creerApplication({
    asr,
    base: lire('referentiel.json'),
    releves: { lire: () => JSON.parse(readFileSync(new URL('./fixtures/releves.json', import.meta.url), 'utf8')) },
    lexique: lire('lexique.json'),
    communes: lire('communes.json').communes,
    registre: await creerRegistre(dossier),
    textes: creerTextes(lire('reponses.json')),
    codeConseiller,
    voix: creerVoix('/inexistant'),
    solutions: lire('solutions.json'),
    protection,
    mesures,
    ...(maxVisitesParAdresse && { maxVisitesParAdresse }),
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(() => serveur.close());
  return { url: `http://127.0.0.1:${serveur.address().port}`, mesures, dossier };
}

const poster = (url, corps = 'audio') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: corps });

test('une visite comptée par l’état, pas par l’écran conseiller', async (t) => {
  const { url, mesures } = await demarrer(t);
  await fetch(`${url}/api/etat`, { headers: { 'X-Visiteur': VISITEUR, 'User-Agent': NAVIGATEUR } });
  await fetch(`${url}/api/etat`, { headers: { 'X-Visiteur': VISITEUR, 'User-Agent': NAVIGATEUR } });
  await fetch(`${url}/api/etat`); // sans identifiant : rien
  await fetch(`${url}/api/signalements`); // écran conseiller
  await mesures.vider();
  const s = await mesures.statistiques({ jours: 7, signalements: [] });
  assert.equal(s.personnes.total, 1);
});

test('un robot ne compte pas comme visite, même sur la route d’état qui lui reste ouverte', async (t) => {
  const { url, mesures } = await demarrer(t);
  await fetch(`${url}/api/etat`, { headers: { 'X-Visiteur': VISITEUR, 'User-Agent': 'curl/8.4.0' } });
  await mesures.vider();
  assert.equal((await mesures.statistiques({ jours: 1, signalements: [] })).personnes.total, 0);
});

test('au plus N nouveaux visiteurs par adresse et par jour', async (t) => {
  const { url, mesures } = await demarrer(t, { maxVisitesParAdresse: 2 });
  const visiter = (c, ip) => fetch(`${url}/api/etat`, { headers: { 'X-Visiteur': `${c}f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b`, 'X-Forwarded-For': ip, 'User-Agent': NAVIGATEUR } });
  await visiter('1', '41.85.160.12');
  await visiter('1', '41.85.160.12'); // le même revient : ne consomme rien
  await visiter('2', '41.85.160.12');
  await visiter('3', '41.85.160.12'); // au-delà de 2 nouveaux pour cette adresse
  await visiter('4', '41.85.160.13');
  await mesures.vider();
  assert.equal((await mesures.statistiques({ jours: 1, signalements: [] })).personnes.total, 3);
});

test('prix compris journalisé avec durées et produits reconnus, non compris aussi', async (t) => {
  const { url, mesures } = await demarrer(t);
  assert.equal((await poster(`${url}/api/prix`)).status, 200);
  await mesures.vider();
  const [a] = await mesures.lireJournal({});
  assert.equal(a.service, 'prix');
  assert.equal(a.resultat, 'compris');
  assert.equal(a.code, null);
  assert.deepEqual(a.reconnu, { produits: ['Maïs'], marche: 'Glazoué' });
  assert.equal(a.transcription, 'gbàdé glazuwe');
  assert.equal(a.duree_audio_s, 3);
  assert.ok(Number.isFinite(a.duree_api_ms) && a.duree_api_ms >= 0);
  assert.ok(a.duree_ms >= a.duree_api_ms);

  const autre = await demarrer(t, { asr: fausseAsr({ marche: { transcription: 'blabla', produits: [], id: 'r3' } }) });
  await poster(`${autre.url}/api/prix`);
  await autre.mesures.vider();
  assert.equal((await autre.mesures.lireJournal({}))[0].resultat, 'non_compris');
});

test('signalement journalisé avec sa référence, sans GPS', async (t) => {
  const { url, mesures, dossier } = await demarrer(t);
  const s = await (await poster(`${url}/api/signalements?lat=7.97&lon=2.24&precision=12&commune=Glazou%C3%A9`)).json();
  await mesures.vider();
  const [a] = await mesures.lireJournal({});
  assert.equal(a.service, 'signalement');
  assert.equal(a.resultat, 'compris');
  assert.equal(a.reference, s.reference);
  // « Gbàdé ama jaunissent » : ama (feuille) donne la partie « feuilles ».
  assert.deepEqual(a.reconnu, { culture: 'Maïs', parties: ['feuilles'], symptomes: ['Jaunissement'], commune: 'Glazoué' });
  const journal = readdirSync(path.join(dossier, 'mesures')).find((f) => f.startsWith('journal-'));
  const brut = await readFile(path.join(dossier, 'mesures', journal), 'utf8');
  assert.ok(!brut.includes('7.97') && !brut.includes('2.24'), brut);
});

test('erreur de l’API journalisée avec son code, réponse 503 inchangée ; audio vide aussi', async (t) => {
  const erreur = new ErreurAsr('Le service de reconnaissance vocale est momentanément indisponible.', { statut: 503, code: 'asr_indisponible' });
  const { url, mesures } = await demarrer(t, { asr: fausseAsr({ erreur }) });
  const rep = await poster(`${url}/api/prix`);
  assert.equal(rep.status, 503);
  assert.equal((await rep.json()).code, 'asr_indisponible');
  assert.equal((await poster(`${url}/api/signalements`, '')).status, 422);
  await mesures.vider();
  const [vide, api] = await mesures.lireJournal({});
  assert.deepEqual([api.resultat, api.code, api.service], ['erreur', 'asr_indisponible', 'prix']);
  assert.ok(Number.isFinite(api.duree_api_ms));
  assert.deepEqual([vide.resultat, vide.code, vide.service, vide.duree_api_ms], ['erreur', 'audio_trop_court', 'signalement', null]);
});

test('dossier des mesures inaccessible : la demande de prix répond 200', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-mesures-ko-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const fichier = path.join(dossier, 'pas-un-dossier');
  await writeFile(fichier, 'x');
  const { url, mesures } = await demarrer(t, { dossierMesures: path.join(fichier, 'mesures') });
  const rep = await fetch(`${url}/api/etat`, { headers: { 'X-Visiteur': VISITEUR, 'User-Agent': NAVIGATEUR } });
  assert.equal(rep.status, 200);
  assert.equal((await poster(`${url}/api/prix`)).status, 200);
  await mesures.vider(); // ne lève pas
});

test('refus de la protection et codes conseiller faux comptés', async (t) => {
  const { url, mesures } = await demarrer(t, { protection: creerProtection(), codeConseiller: 'secret' });
  assert.equal((await fetch(`${url}/`, { headers: { 'User-Agent': 'curl/8.4.0' } })).status, 403);
  const navigateur = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': '41.85.160.12' };
  assert.equal((await fetch(`${url}/api/signalements`, { headers: { ...navigateur, 'X-Code-Conseiller': 'faux' } })).status, 401);
  await mesures.vider();
  assert.deepEqual((await mesures.refusParJour(1))[0].motifs, { robot: 1, code_conseiller: 1 });
});
