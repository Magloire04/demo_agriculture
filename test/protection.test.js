import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerApplication } from '../server/index.js';
import { adresseClient, creerCompteur, creerProtection, estRobot } from '../server/protection.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerVoix } from '../server/voix.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
// Un vrai téléphone dont le nom contient « bot » : il ne doit pas être pris pour un robot.
const CUBOT = 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';

// En-têtes d'un appel fait par la page AgriFon depuis un navigateur récent.
const PAGE = { 'User-Agent': CHROME_ANDROID, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };
const depuis = (ip, entetes = PAGE) => ({ ...entetes, 'X-Forwarded-For': ip });

async function demarrer(t, { protection = creerProtection(), asr = fausseAsr(), codeConseiller = '', maxEnAttente, maxEnAttenteParVisiteur } = {}) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-'));
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
    ...(maxEnAttente && { maxEnAttente }),
    ...(maxEnAttenteParVisiteur && { maxEnAttenteParVisiteur }),
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(async () => {
    serveur.close();
    await rm(dossier, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${serveur.address().port}`;
}

function fausseAsr({ attente = null } = {}) {
  return {
    configure: true,
    simulation: false,
    marche: async () => {
      if (attente) await attente;
      return { transcription: 'gbàdé glazuwe', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], id: 'r1' };
    },
    transcrire: async () => ({ texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', id: 'r2' }),
  };
}

const poster = (url, entetes) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm', ...entetes }, body: 'audio' });

// fetch impose son propre Sec-Fetch-Mode : pour simuler une navigation, requête brute.
const statutBrut = (url, entetes) => new Promise((ok, ko) => {
  request(url, { headers: entetes }, (rep) => {
    rep.resume();
    ok(rep.statusCode);
  }).on('error', ko).end();
});

test('robots : outils, moteurs, IA et agent vide reconnus ; navigateurs et téléphones admis', () => {
  for (const ua of [
    'curl/8.4.0', 'Wget/1.21', 'python-requests/2.31.0', 'Scrapy/2.11 (+https://scrapy.org)', 'Go-http-client/2.0', 'node',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'CCBot/2.0 (https://commoncrawl.org/faq/)', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'facebookexternalhit/1.1', 'WhatsApp/2.23.20.0', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    '', undefined,
  ]) assert.equal(estRobot(ua), true, String(ua));
  for (const ua of [CHROME_ANDROID, SAFARI_IPHONE, CUBOT,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Linux; Android 11; TECNO KF6i) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
    'Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; fr) Presto/2.12.423 Version/12.16',
  ]) assert.equal(estRobot(ua), false, ua);
});

test('adresse du visiteur : celle ajoutée par le proxy local, jamais une adresse inventée par le client', () => {
  const req = (distante, xff) => ({ socket: { remoteAddress: distante }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(adresseClient(req('127.0.0.1', '6.6.6.6, 41.85.160.12')), '41.85.160.12');
  assert.equal(adresseClient(req('::ffff:127.0.0.1', '41.85.160.12')), '41.85.160.12');
  assert.equal(adresseClient(req('127.0.0.1', null)), null);
  assert.equal(adresseClient(req('41.85.160.12', '6.6.6.6')), '41.85.160.12');
});

test('compteur : un maximum de passages par fenêtre glissante', () => {
  let maintenant = 0;
  const c = creerCompteur({ fenetreMs: 1000, maximum: 2, maintenant: () => maintenant });
  assert.equal(c.passer('a'), 0);
  assert.equal(c.passer('a'), 0);
  assert.equal(c.passer('a'), 1000);
  assert.equal(c.passer('b'), 0);
  maintenant = 400;
  assert.equal(c.passer('a'), 600);
  maintenant = 1001;
  assert.equal(c.passer('a'), 0);
});

test('robots.txt interdit tout, et chaque réponse demande de ne pas indexer', async (t) => {
  const url = await demarrer(t);
  const robots = await fetch(`${url}/robots.txt`, { headers: { 'User-Agent': 'GPTBot/1.2' } });
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /User-agent: \*\s+Disallow: \/\s*$/);
  const accueil = await fetch(`${url}/`, { headers: { 'User-Agent': CHROME_ANDROID } });
  assert.equal(accueil.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  assert.equal(accueil.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(await accueil.text(), /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">/);
  const etat = await fetch(`${url}/api/etat`, { headers: PAGE });
  assert.equal(etat.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet, noimageindex');
});

test('un robot est refusé partout, sauf robots.txt et la route d’état du déploiement', async (t) => {
  const url = await demarrer(t);
  const robot = { 'User-Agent': 'python-requests/2.31.0' };
  assert.equal((await fetch(`${url}/`, { headers: robot })).status, 403);
  assert.equal((await fetch(`${url}/voix/7db4d6320a713225.mp3`, { headers: robot })).status, 403);
  assert.equal((await fetch(`${url}/api/communes`, { headers: robot })).status, 403);
  assert.equal((await poster(`${url}/api/prix`, robot)).status, 403);
  assert.equal((await fetch(`${url}/api/etat`, { headers: { 'User-Agent': 'curl/8.4.0' } })).status, 200);
});

test('une demande vocale doit venir de la page AgriFon elle-même', async (t) => {
  const url = await demarrer(t);
  const sansPreuve = { 'User-Agent': CHROME_ANDROID };
  assert.equal((await poster(`${url}/api/prix`, sansPreuve)).status, 403);
  assert.equal((await poster(`${url}/api/prix`, { ...sansPreuve, Origin: 'https://ailleurs.example' })).status, 403);
  assert.equal((await poster(`${url}/api/prix`, { ...PAGE, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await poster(`${url}/api/prix`, PAGE)).status, 200);
  // Navigateur sans en-têtes Sec-Fetch (iPhone plus ancien) : l'origine suffit.
  assert.equal((await poster(`${url}/api/prix`, { 'User-Agent': SAFARI_IPHONE, Origin: url })).status, 200);
});

test('un autre site ne peut pas reprendre les fichiers, mais un lien vers l’accueil reste ouvert', async (t) => {
  const url = await demarrer(t);
  const autreSite = { 'User-Agent': CHROME_ANDROID, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors' };
  assert.equal((await fetch(`${url}/img/logo-agrifon.svg`, { headers: autreSite })).status, 403);
  assert.equal((await fetch(`${url}/api/communes`, { headers: { ...autreSite, 'Sec-Fetch-Mode': 'cors' } })).status, 403);
  const lien = { 'User-Agent': CHROME_ANDROID, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' };
  assert.equal(await statutBrut(`${url}/`, lien), 200);
  assert.equal(await statutBrut(`${url}/img/logo-agrifon.svg`, { ...lien, 'Sec-Fetch-Mode': 'no-cors' }), 403);
});

test('demandes vocales limitées par visiteur, avec un délai et un message en fon', async (t) => {
  const url = await demarrer(t);
  for (let i = 0; i < 20; i++) assert.equal((await poster(`${url}/api/prix`, depuis('41.85.160.12'))).status, 200, `demande ${i + 1}`);
  const refus = await poster(`${url}/api/prix`, depuis('41.85.160.12'));
  assert.equal(refus.status, 429);
  assert.ok(Number(refus.headers.get('retry-after')) > 0);
  const corps = await refus.json();
  assert.equal(corps.code, 'trop_de_demandes');
  assert.equal(corps.erreur_fon, lire('reponses.json').phrases.erreur_reessayer.fon);
  assert.equal((await poster(`${url}/api/prix`, depuis('41.85.160.13'))).status, 200);
});

test('visiteur non identifiable : pas de limite par visiteur, pour ne pas bloquer tout le monde ensemble', async (t) => {
  const url = await demarrer(t, { protection: creerProtection({ limites: { audio: [{ fenetreMs: 60_000, maximum: 2 }] } }) });
  for (let i = 0; i < 4; i++) assert.equal((await poster(`${url}/api/prix`, PAGE)).status, 200);
  const etat = async (entetes) => (await (await fetch(`${url}/api/etat`, { headers: entetes })).json()).client_identifie;
  assert.equal(await etat(PAGE), false);
  assert.equal(await etat(depuis('41.85.160.12')), true);
});

test('code conseiller : bloqué 15 minutes après 5 essais faux, pour ce visiteur seulement', async (t) => {
  const url = await demarrer(t, { codeConseiller: 'secret' });
  const essai = (code, ip = '41.85.160.12') => fetch(`${url}/api/signalements`, { headers: { ...depuis(ip), 'X-Code-Conseiller': code } });
  for (let i = 0; i < 5; i++) assert.equal((await essai('faux')).status, 401);
  const bloque = await essai('secret');
  assert.equal(bloque.status, 429);
  assert.ok(Number(bloque.headers.get('retry-after')) > 800);
  assert.equal((await essai('secret', '41.85.160.99')).status, 200);
});

test('trop de demandes vocales en attente : refus immédiat plutôt qu’une longue attente', { timeout: 5000 }, async (t) => {
  let liberer;
  const attente = new Promise((r) => { liberer = r; });
  const url = await demarrer(t, { asr: fausseAsr({ attente }), maxEnAttente: 2 });
  const enCours = [poster(`${url}/api/prix`, depuis('1.1.1.1')), poster(`${url}/api/prix`, depuis('1.1.1.2'))];
  await new Promise((r) => setTimeout(r, 50));
  const refus = await poster(`${url}/api/prix`, depuis('1.1.1.3'));
  assert.equal(refus.status, 503);
  assert.equal((await refus.json()).code, 'service_sature');
  liberer();
  assert.deepEqual((await Promise.all(enCours)).map((r) => r.status), [200, 200]);
  assert.equal((await poster(`${url}/api/prix`, depuis('1.1.1.3'))).status, 200);
});

test('un signalement refusé ne consomme pas le quota du jour', async (t) => {
  const url = await demarrer(t, { protection: creerProtection({ limites: { signalementsJour: [{ fenetreMs: 86_400_000, maximum: 2 }] } }) });
  const vide = (ip) => fetch(`${url}/api/signalements`, { method: 'POST', headers: { 'Content-Type': 'audio/webm', ...depuis(ip) }, body: '' });
  assert.equal((await vide('1.1.1.1')).status, 422);
  assert.equal((await vide('1.1.1.1')).status, 422);
  assert.equal((await poster(`${url}/api/signalements`, depuis('1.1.1.1'))).status, 201);
  assert.equal((await poster(`${url}/api/signalements`, depuis('1.1.1.2'))).status, 201);
});

test('un visiteur seul ne peut pas épuiser le quota du jour de tous', async (t) => {
  const url = await demarrer(t, { protection: creerProtection({ limites: { signalementsVisiteur: [{ fenetreMs: 86_400_000, maximum: 1 }] } }) });
  assert.equal((await poster(`${url}/api/signalements`, depuis('1.1.1.1'))).status, 201);
  const refus = await poster(`${url}/api/signalements`, depuis('1.1.1.1'));
  assert.equal(refus.status, 429);
  assert.equal((await refus.json()).code, 'trop_de_demandes');
  assert.equal((await poster(`${url}/api/signalements`, depuis('1.1.1.2'))).status, 201);
});

test('un envoi lent n’occupe pas de place dans la file de l’API', { timeout: 5000 }, async (t) => {
  const url = await demarrer(t, { maxEnAttente: 1 });
  const { hostname, port } = new URL(url);
  // Envoi commencé (1 octet sur 10), jamais terminé pendant le test.
  const lent = request({ hostname, port, path: '/api/prix', method: 'POST', headers: { ...depuis('1.1.1.1'), 'Content-Type': 'audio/webm', 'Content-Length': 10 } });
  lent.on('error', () => {});
  lent.write('a');
  t.after(() => lent.destroy());
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await poster(`${url}/api/prix`, depuis('1.1.1.2'))).status, 200);
});

test('un visiteur seul ne prend pas toutes les places de la file', { timeout: 5000 }, async (t) => {
  let liberer;
  const attente = new Promise((r) => { liberer = r; });
  const url = await demarrer(t, { asr: fausseAsr({ attente }), maxEnAttente: 4, maxEnAttenteParVisiteur: 2 });
  const enCours = [poster(`${url}/api/prix`, depuis('1.1.1.1')), poster(`${url}/api/prix`, depuis('1.1.1.1'))];
  await new Promise((r) => setTimeout(r, 50));
  const refus = await poster(`${url}/api/prix`, depuis('1.1.1.1'));
  assert.equal(refus.status, 503);
  const autre = poster(`${url}/api/prix`, depuis('1.1.1.2'));
  await new Promise((r) => setTimeout(r, 50));
  liberer();
  assert.deepEqual((await Promise.all([...enCours, autre])).map((r) => r.status), [200, 200, 200]);
});

test('nombre de signalements par jour plafonné, tous visiteurs confondus', async (t) => {
  const url = await demarrer(t, { protection: creerProtection({ limites: { signalementsJour: [{ fenetreMs: 86_400_000, maximum: 2 }] } }) });
  assert.equal((await poster(`${url}/api/signalements`, depuis('1.1.1.1'))).status, 201);
  assert.equal((await poster(`${url}/api/signalements`, depuis('1.1.1.2'))).status, 201);
  const refus = await poster(`${url}/api/signalements`, depuis('1.1.1.3'));
  assert.equal(refus.status, 503);
  assert.equal((await refus.json()).code, 'service_sature');
});
