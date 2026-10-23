import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerApplication } from '../server/index.js';
import { creerReglages } from '../server/reglages.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerVoix } from '../server/voix.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const FR = 'AgriFon est momentanément hors service. Revenez un peu plus tard.';
const FON = 'Mǐ ma sixú yí gbe nú mi din ǎ.';

const fausseAsr = {
  configure: true,
  simulation: false,
  marche: async () => ({ transcription: 'gbàdé glazuwe', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], id: 'r1' }),
  transcrire: async () => ({ texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', id: 'r2' }),
};

async function demarrer(t, { solutionsBrouillon = true } = {}) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-hors-service-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const reglages = await creerReglages(path.join(dossier, 'reglages.json'), { solutionsBrouillon });
  const gerer = creerApplication({
    asr: fausseAsr,
    base: lire('referentiel.json'),
    releves: { lire: () => JSON.parse(readFileSync(new URL('./fixtures/releves.json', import.meta.url), 'utf8')) },
    lexique: lire('lexique.json'),
    communes: lire('communes.json').communes,
    registre: await creerRegistre(dossier),
    textes: creerTextes(lire('reponses.json')),
    voix: creerVoix('/inexistant'),
    solutions: lire('solutions.json'), // fon_a_relire: true
    protection: null,
    reglages,
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(() => serveur.close());
  return { url: `http://127.0.0.1:${serveur.address().port}`, reglages };
}

const poster = (url) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: 'audio' });

test('site coupé : l’accueil rend la page d’attente en 503 avec Retry-After', async (t) => {
  const { url, reglages } = await demarrer(t);
  await reglages.mettreHorsService();
  for (const adresse of ['/', '/index.html']) {
    const rep = await fetch(`${url}${adresse}`);
    assert.equal(rep.status, 503, adresse);
    assert.equal(rep.headers.get('retry-after'), '300');
    assert.equal(rep.headers.get('cache-control'), 'no-store');
    assert.match(rep.headers.get('content-type'), /^text\/html/);
    assert.match(rep.headers.get('content-security-policy'), /default-src 'self'/);
    const corps = await rep.text();
    assert.ok(corps.includes(FON) && corps.includes(FR), adresse);
    assert.ok(!corps.includes('<script'), 'aucun script dans la page d’attente');
  }
});

test('site coupé : une demande vocale reçoit hors_service en fon et en français', async (t) => {
  const { url, reglages } = await demarrer(t);
  await reglages.mettreHorsService();
  for (const route of ['/api/prix', '/api/signalements']) {
    const rep = await poster(`${url}${route}`);
    assert.equal(rep.status, 503, route);
    assert.deepEqual(await rep.json(), { erreur: FR, erreur_fon: FON, code: 'hors_service' });
  }
});

test('site coupé : écran conseiller, signalements, état, fichiers et robots.txt répondent', async (t) => {
  const { url, reglages } = await demarrer(t);
  const s = await (await poster(`${url}/api/signalements`)).json();
  await reglages.mettreHorsService();
  assert.equal((await fetch(`${url}/conseiller`)).status, 200);
  assert.equal((await fetch(`${url}/api/signalements`)).status, 200);
  assert.equal((await fetch(`${url}/api/signalements/${s.reference}`)).status, 200);
  assert.equal((await fetch(`${url}/robots.txt`)).status, 200);
  assert.equal((await fetch(`${url}/css/hors-service.css`)).status, 200);
  assert.equal((await fetch(`${url}/js/app.js`)).status, 200);
  const etat = await (await fetch(`${url}/api/etat`)).json();
  assert.equal(etat.hors_service, true);
});

test('remis en service : l’accueil répond 200 et l’état le dit', async (t) => {
  const { url, reglages } = await demarrer(t);
  await reglages.mettreHorsService();
  await reglages.remettreEnService();
  assert.equal((await fetch(`${url}/`)).status, 200);
  assert.equal((await poster(`${url}/api/prix`)).status, 200);
  assert.equal((await (await fetch(`${url}/api/etat`)).json()).hors_service, false);
});

test('solutions en brouillon coupées depuis les réglages : plus de solutions, puis de retour', async (t) => {
  const { url, reglages } = await demarrer(t, { solutionsBrouillon: true });
  assert.ok((await (await poster(`${url}/api/signalements`)).json()).solutions.elements.length >= 2);
  await reglages.definirSolutionsBrouillon(false);
  assert.equal((await (await poster(`${url}/api/signalements`)).json()).solutions, null);
  await reglages.definirSolutionsBrouillon(true);
  assert.ok((await (await poster(`${url}/api/signalements`)).json()).solutions);
});
