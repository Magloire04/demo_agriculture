import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { creerAdmin, creerSessions, empreinteMotDePasse, lancerPreparationVoix, lireVersion, verifierMotDePasse } from '../server/admin.js';
import { creerApplication } from '../server/index.js';
import { creerReglages } from '../server/reglages.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerVoix } from '../server/voix.js';
import { envoyerJson, ErreurHttp } from '../server/http.js';
import { creerMesures } from '../server/mesures.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MDP = 'un-mot-de-passe-solide';
const EMPREINTE = empreinteMotDePasse(MDP);

// Serveur minimal : l'administration, et les erreurs rendues comme le fait server/index.js.
async function demarrer(t, options = {}) {
  const admin = creerAdmin({ empreinte: EMPREINTE, sessions: creerSessions(), attendre: async () => {}, ...options });
  const serveur = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!(await admin.gerer(req, res, url))) envoyerJson(res, 404, { code: 'introuvable' });
    } catch (e) {
      if (!(e instanceof ErreurHttp)) throw e;
      envoyerJson(res, e.statut, { erreur: e.message, code: e.code }, e.attente);
    }
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(() => serveur.close());
  return `http://127.0.0.1:${serveur.address().port}`;
}

const connexion = (url, mdp, entetes = {}) => fetch(`${url}/api/admin/connexion`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...entetes }, body: JSON.stringify({ mot_de_passe: mdp }),
});
const jeton = (rep) => rep.headers.get('set-cookie')?.match(/agrifon_admin=([0-9a-f]+)/)?.[1];
const session = (url, j, entetes = {}) => fetch(`${url}/api/admin/session`, { headers: { Cookie: `agrifon_admin=${j}`, ...entetes } });

test('empreinte vérifiée, mauvais mot de passe refusé, empreinte mal formée refusée', () => {
  assert.match(EMPREINTE, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  assert.notEqual(empreinteMotDePasse(MDP), EMPREINTE); // sel différent à chaque fois
  assert.equal(verifierMotDePasse(MDP, EMPREINTE), true);
  assert.equal(verifierMotDePasse('autre-mot-de-passe', EMPREINTE), false);
  for (const abimee of ['', 'scrypt:zz', 'md5:00:00', 'scrypt:00', undefined]) assert.equal(verifierMotDePasse(MDP, abimee), false, String(abimee));
});

test('connexion : cookie HttpOnly, Secure, SameSite=Strict, puis déconnexion', async (t) => {
  const url = await demarrer(t);
  assert.equal((await fetch(`${url}/api/admin/connexion`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: MDP })).status, 415);
  const rep = await connexion(url, MDP);
  assert.equal(rep.status, 200);
  const cookie = rep.headers.get('set-cookie');
  for (const attribut of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(attribut), attribut);
  const j = jeton(rep);
  assert.equal(j.length, 64);
  assert.equal((await session(url, j)).status, 200);
  assert.equal((await session(url, 'f'.repeat(64))).status, 401);
  assert.equal((await fetch(`${url}/api/admin/session`)).status, 401);
  const fin = await fetch(`${url}/api/admin/deconnexion`, { method: 'POST', headers: { Cookie: `agrifon_admin=${j}` } });
  assert.equal(fin.status, 200);
  assert.equal((await session(url, j)).status, 401);
  assert.equal(await (await fetch(`${url}/autre`)).status, 404);
});

test('3 essais faux bloquent ce visiteur 10 minutes, pas un autre', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-admin-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const mesures = creerMesures(dossier);
  const url = await demarrer(t, { mesures });
  const depuis = { 'X-Forwarded-For': '41.85.160.12' };
  for (let i = 0; i < 3; i++) assert.equal((await connexion(url, 'faux', depuis)).status, 401);
  const bloque = await connexion(url, MDP, depuis);
  assert.equal(bloque.status, 429);
  assert.equal((await bloque.json()).code, 'trop_de_demandes');
  assert.ok(Number(bloque.headers.get('retry-after')) > 590);
  assert.equal((await connexion(url, MDP, { 'X-Forwarded-For': '41.85.160.13' })).status, 200);
  await mesures.vider();
  assert.equal((await mesures.refusParJour(1))[0].motifs.mot_de_passe_admin, 3);
});

test('adresse inconnue : pas de blocage, chaque essai faux attend 2 secondes', async (t) => {
  const attentes = [];
  const url = await demarrer(t, { attendre: async (ms) => { attentes.push(ms); } });
  for (let i = 0; i < 5; i++) assert.equal((await connexion(url, 'faux')).status, 401);
  assert.deepEqual(attentes, [2000, 2000, 2000, 2000, 2000]);
  assert.equal((await connexion(url, MDP)).status, 200);
});

test('essais faux simultanés sans adresse : chacun attend 2 secondes', async (t) => {
  const attentes = [];
  const url = await demarrer(t, { attendre: async (ms) => { attentes.push(ms); } });
  const statuts = await Promise.all(Array.from({ length: 5 }, () => connexion(url, 'faux').then((r) => r.status)));
  assert.deepEqual(statuts, [401, 401, 401, 401, 401]);
  assert.deepEqual(attentes, [2000, 2000, 2000, 2000, 2000]);
});

test('essais faux simultanés depuis une même adresse : 3 vérifiés, les suivants bloqués', async (t) => {
  const url = await demarrer(t, { verifier: async (mdp) => { await new Promise((r) => setTimeout(r, 30)); return mdp === MDP; } });
  const depuis = { 'X-Forwarded-For': '41.85.160.20' };
  const statuts = await Promise.all(Array.from({ length: 6 }, () => connexion(url, 'faux', depuis).then((r) => r.status)));
  assert.deepEqual(statuts.toSorted(), [401, 401, 401, 429, 429, 429]);
  assert.equal((await connexion(url, MDP, depuis)).status, 429);
});

test('les essais faux qui attendent leurs 2 secondes ne retardent pas le bon mot de passe', async (t) => {
  let liberer;
  const retenue = new Promise((r) => { liberer = r; });
  t.after(() => liberer());
  const url = await demarrer(t, { attendre: () => retenue, verifier: async (mdp) => mdp === MDP });
  const faux = Array.from({ length: 25 }, () => connexion(url, 'faux').then((r) => r.status));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await connexion(url, MDP)).status, 200);
  liberer();
  assert.deepEqual([...new Set(await Promise.all(faux))], [401]);
});

test('au-delà de 10 échecs en 10 minutes, toutes adresses confondues, chaque essai faux attend 2 secondes', async (t) => {
  const attentes = [];
  const url = await demarrer(t, { attendre: async (ms) => { attentes.push(ms); } });
  for (let i = 1; i <= 10; i++) assert.equal((await connexion(url, 'faux', { 'X-Forwarded-For': `41.85.160.${i}` })).status, 401);
  assert.deepEqual(attentes, []);
  assert.equal((await connexion(url, 'faux', { 'X-Forwarded-For': '41.85.161.1' })).status, 401);
  assert.deepEqual(attentes, [2000]);
  assert.equal((await connexion(url, MDP, { 'X-Forwarded-For': '41.85.161.2' })).status, 200); // jamais de blocage commun
});

test('IPv6 : les adresses d’un même /64 partagent le blocage', async (t) => {
  const url = await demarrer(t);
  for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:aaaa::3']) assert.equal((await connexion(url, 'faux', { 'X-Forwarded-For': ip })).status, 401);
  assert.equal((await connexion(url, MDP, { 'X-Forwarded-For': '2001:0db8:0001:0002::4' })).status, 429);
  assert.equal((await connexion(url, MDP, { 'X-Forwarded-For': '2001:db8:1:3::1' })).status, 200);
});

test('file des vérifications pleine : refus immédiat plutôt qu’une attente sans fin', async (t) => {
  let liberer;
  const retenue = new Promise((r) => { liberer = r; });
  const url = await demarrer(t, { verifier: () => retenue.then(() => false) });
  const reponses = Array.from({ length: 22 }, () => connexion(url, 'faux').then((r) => r.status));
  await new Promise((r) => setTimeout(r, 300));
  liberer();
  const statuts = await Promise.all(reponses);
  assert.equal(statuts.filter((s) => s === 429).length, 2);
  assert.equal(statuts.filter((s) => s === 401).length, 20);
});

test('session : relèves sans activité périmées après 10 minutes, activité qui prolonge', async (t) => {
  let maintenant = Date.parse('2026-10-23T10:00:00Z');
  const url = await demarrer(t, { sessions: creerSessions({ maintenant: () => maintenant }) });
  const j = jeton(await connexion(url, MDP));
  // Relèves automatiques toutes les 5 s, sans X-Activite : la session ne se prolonge pas.
  for (let s = 5; s <= 595; s += 5) {
    maintenant = Date.parse('2026-10-23T10:00:00Z') + s * 1000;
    assert.equal((await session(url, j)).status, 200, `relève à ${s} s`);
  }
  maintenant = Date.parse('2026-10-23T10:10:01Z');
  const perime = await session(url, j);
  assert.equal(perime.status, 401);
  assert.equal((await perime.json()).code, 'connexion_requise');

  const k = jeton(await connexion(url, MDP));
  maintenant = Date.parse('2026-10-23T10:19:01Z'); // 9 minutes après cette connexion
  assert.equal((await session(url, k, { 'X-Activite': '1' })).status, 200);
  maintenant = Date.parse('2026-10-23T10:28:01Z'); // 18 minutes après la connexion, 9 après l'activité
  assert.equal((await session(url, k)).status, 200);
  maintenant = Date.parse('2026-10-23T10:29:02Z');
  assert.equal((await session(url, k)).status, 401);
});

test('sans empreinte configurée : 503 admin_non_configure', async (t) => {
  const url = await demarrer(t, { empreinte: '' });
  const rep = await connexion(url, MDP);
  assert.equal(rep.status, 503);
  assert.equal((await rep.json()).code, 'admin_non_configure');
});

function lancerScript(env, entree) {
  return new Promise((ok) => {
    const enfant = execFile(process.execPath, [path.join(RACINE, 'scripts', 'admin-mot-de-passe.js'), '--env', env], (erreur, sortie, sortieErreur) => {
      ok({ code: erreur ? erreur.code : 0, sortie: sortie + sortieErreur });
    });
    enfant.stdin.end(entree);
  });
}

test('script : écrit l’empreinte dans .env sans afficher le mot de passe, garde les autres lignes', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-script-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const env = path.join(dossier, '.env');
  await writeFile(env, 'ASR_ID=identifiant\nADMIN_MDP_EMPREINTE=scrypt:00:00\nCODE_CONSEILLER=abc\n');
  const r = await lancerScript(env, `${MDP}\n${MDP}\n`);
  assert.equal(r.code, 0, r.sortie);
  assert.ok(!r.sortie.includes(MDP));
  const contenu = await readFile(env, 'utf8');
  assert.match(contenu, /^ASR_ID=identifiant$/m);
  assert.match(contenu, /^CODE_CONSEILLER=abc$/m);
  const lignes = contenu.split('\n').filter((l) => l.startsWith('ADMIN_MDP_EMPREINTE='));
  assert.equal(lignes.length, 1);
  assert.equal(verifierMotDePasse(MDP, lignes[0].slice('ADMIN_MDP_EMPREINTE='.length)), true);

  const differents = await lancerScript(env, `${MDP}\nautre-mot-de-passe\n`);
  assert.notEqual(differents.code, 0);
  const court = await lancerScript(env, 'court\ncourt\n');
  assert.notEqual(court.code, 0);
  assert.equal(await readFile(env, 'utf8'), contenu); // .env inchangé après un refus
});

// ---------- Routes de données, branchées dans l'application complète ----------

const lireData = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const NAVIGATEUR = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

async function demarrerApplication(t, { importerPrix = async () => ({ ok: true, message: 'Prix importés.' }), synthese = null } = {}) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-admin-app-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const asr = {
    configure: true,
    simulation: false,
    marche: async () => ({ transcription: 'gbàdé glazuwe', produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], id: 'r1' }),
    transcrire: async () => ({ texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', id: 'r2' }),
    sante: async () => ({ ok: true, modele: 'ROVER fonasr', duree_ms: 12 }),
  };
  const registre = await creerRegistre(dossier);
  const reglages = await creerReglages(path.join(dossier, 'reglages.json'), { solutionsBrouillon: true });
  const mesures = creerMesures(path.join(dossier, 'mesures'));
  const releves = { lire: () => JSON.parse(readFileSync(new URL('./fixtures/releves.json', import.meta.url), 'utf8')) };
  await mkdir(path.join(dossier, 'audio'), { recursive: true });
  await writeFile(path.join(dossier, 'audio', 'SIG-20261023-901.webm'), Buffer.alloc(1000));
  await writeFile(path.join(dossier, 'audio', 'SIG-20261023-902.webm'), Buffer.alloc(500));
  const admin = creerAdmin({
    empreinte: EMPREINTE, sessions: creerSessions(), mesures, reglages, registre, releves, asr,
    version: { commit: 'abc1234', demarre_le: '2026-10-23T08:00:00.000Z' }, dossierAudio: path.join(dossier, 'audio'), importerPrix, synthese,
  });
  const gerer = creerApplication({
    asr, base: lireData('referentiel.json'), releves, lexique: lireData('lexique.json'), communes: lireData('communes.json').communes,
    registre, textes: creerTextes(lireData('reponses.json')), voix: creerVoix('/inexistant'), solutions: lireData('solutions.json'),
    protection: null, mesures, reglages, admin,
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(() => serveur.close());
  const url = `http://127.0.0.1:${serveur.address().port}`;
  const j = jeton(await connexion(url, MDP));
  const avecSession = (chemin, options = {}) => fetch(`${url}${chemin}`, { ...options, headers: { Cookie: `agrifon_admin=${j}`, ...options.headers } });
  const poster = (chemin, corps) => avecSession(chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Activite': '1' }, body: JSON.stringify(corps) });
  return { url, avecSession, poster, mesures, reglages };
}

const posterAudio = (url) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: 'audio' });

test('routes de l’administration : 401 sans session', async (t) => {
  const { url } = await demarrerApplication(t);
  const routes = [['GET', '/api/admin/tableau'], ['GET', '/api/admin/appels'], ['GET', '/api/admin/refus'], ['GET', '/api/admin/services'],
    ['GET', '/api/admin/reglages'], ['POST', '/api/admin/prix/importer'], ['POST', '/api/admin/hors-service'], ['POST', '/api/admin/solutions-brouillon']];
  for (const [methode, chemin] of routes) assert.equal((await fetch(`${url}${chemin}`, { method: methode })).status, 401, `${methode} ${chemin}`);
});

test('tableau : état du site et statistiques réelles', async (t) => {
  const { url, avecSession, mesures } = await demarrerApplication(t);
  await fetch(`${url}/api/etat`, { headers: { 'X-Visiteur': '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b', 'User-Agent': NAVIGATEUR } });
  await posterAudio(`${url}/api/prix`);
  await posterAudio(`${url}/api/signalements`);
  await mesures.vider();
  const r = await (await avecSession('/api/admin/tableau?jours=7')).json();
  assert.deepEqual(r.site, { hors_service: false, depuis: null });
  assert.equal(r.statistiques.personnes.total, 1);
  assert.deepEqual(r.statistiques.demandes, { comprises: 2, non_comprises: 0, erreurs: 0 });
  assert.equal(r.statistiques.signalements.total, 1);
  assert.deepEqual(r.statistiques.produits, [{ nom: 'Maïs', n: 1 }]);
});

test('appels : les derniers, et seulement ceux écrits après le curseur', async (t) => {
  const { url, avecSession, mesures } = await demarrerApplication(t);
  await posterAudio(`${url}/api/prix`);
  await mesures.vider();
  const { appels } = await (await avecSession('/api/admin/appels')).json();
  assert.equal(appels.length, 1);
  assert.equal(appels[0].service, 'prix');
  const apres = await (await avecSession(`/api/admin/appels?apres=${encodeURIComponent(appels[0].ecrit_le)}`)).json();
  assert.deepEqual(apres.appels, []);
});

test('appels : page précédente avec avant, curseurs impossibles ignorés', async (t) => {
  const { url, avecSession, mesures } = await demarrerApplication(t);
  await posterAudio(`${url}/api/prix`);
  await posterAudio(`${url}/api/prix`);
  await mesures.vider();
  const { appels } = await (await avecSession('/api/admin/appels')).json();
  assert.equal(appels.length, 2);
  const avant = await (await avecSession(`/api/admin/appels?avant=${encodeURIComponent(appels[0].ecrit_le)}`)).json();
  assert.deepEqual(avant.appels, [appels[1]]);
  for (const q of ['apres=2026-99-99T00:00:00Z', 'avant=2026-13-45T00:00:00Z']) {
    const rep = await avecSession(`/api/admin/appels?${q}`);
    assert.equal(rep.status, 200, q);
    assert.equal((await rep.json()).appels.length, 2, q);
  }
});

test('hors service coupé puis rétabli depuis l’administration', async (t) => {
  const { url, poster, avecSession } = await demarrerApplication(t);
  const coupe = await (await poster('/api/admin/hors-service', { actif: true })).json();
  assert.equal(coupe.site.hors_service, true);
  assert.equal((await fetch(`${url}/`)).status, 503);
  assert.equal((await avecSession('/api/admin/tableau')).status, 200); // l'administration reste ouverte
  const remis = await (await poster('/api/admin/hors-service', { actif: false })).json();
  assert.equal(remis.site.hors_service, false);
  assert.equal((await fetch(`${url}/`)).status, 200);
  const reglages = await (await avecSession('/api/admin/reglages')).json();
  assert.equal(reglages.coupures.length, 1);
  assert.ok(reglages.coupures[0].fin);
  assert.equal((await poster('/api/admin/hors-service', { actif: 'oui' })).status, 400);
});

test('solutions en brouillon réglées depuis l’administration', async (t) => {
  const { poster, reglages } = await demarrerApplication(t);
  assert.deepEqual(await (await poster('/api/admin/solutions-brouillon', { actif: false })).json(), { solutions_brouillon: false });
  assert.equal(reglages.lire().solutions_brouillon, false);
});

test('import des prix : un seul à la fois', async (t) => {
  let liberer;
  const fin = new Promise((r) => { liberer = r; });
  const { poster } = await demarrerApplication(t, { importerPrix: async () => { await fin; return { ok: true, message: 'Prix importés : 398 couples.' }; } });
  const premier = poster('/api/admin/prix/importer', {});
  await new Promise((r) => setTimeout(r, 50));
  const second = await poster('/api/admin/prix/importer', {});
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, 'import_en_cours');
  liberer();
  assert.deepEqual(await (await premier).json(), { ok: true, message: 'Prix importés : 398 couples.' });
});

test('services : API, prix, messages vocaux, version', async (t) => {
  const { avecSession } = await demarrerApplication(t);
  assert.deepEqual(await (await avecSession('/api/admin/services')).json(), {
    api: { ok: true, modele: 'ROVER fonasr', duree_ms: 12 },
    prix: { importe_le: '2026-10-21T06:00:00.000Z', derniere_date: '2026-09-15' },
    stockage: { messages_vocaux: 2, octets: 1500 },
    version: { commit: 'abc1234', demarre_le: '2026-10-23T08:00:00.000Z' },
    voix: null,
  });
});

test('services : réserve de la voix des phrases entières', async (t) => {
  const etat = { en_reserve: 3, octets: 120000, derniere_erreur: null, pause_jusqua: null };
  const { avecSession } = await demarrerApplication(t, { synthese: { etat: async () => etat } });
  assert.deepEqual((await (await avecSession('/api/admin/services')).json()).voix, etat);
});

test('refus : jours bornés à 90', async (t) => {
  const { avecSession } = await demarrerApplication(t);
  assert.equal((await (await avecSession('/api/admin/refus?jours=500')).json()).refus.length, 90);
  assert.equal((await (await avecSession('/api/admin/refus')).json()).refus.length, 14);
});

test('version du code lue dans .git : branche, références groupées, ou rien', async (t) => {
  const racine = await mkdtemp(path.join(tmpdir(), 'agrifon-git-'));
  t.after(() => rm(racine, { recursive: true, force: true }));
  assert.equal(lireVersion(racine).commit, null);
  await mkdir(path.join(racine, '.git', 'refs', 'heads'), { recursive: true });
  await writeFile(path.join(racine, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(path.join(racine, '.git', 'packed-refs'), '# pack-refs\n955eb3dffffffffffffffffffffffffffffffff0 refs/heads/main\n');
  assert.equal(lireVersion(racine).commit, '955eb3d');
  await writeFile(path.join(racine, '.git', 'refs', 'heads', 'main'), '0c6bc02eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1\n');
  assert.equal(lireVersion(racine).commit, '0c6bc02');
  assert.match(lireVersion(racine).demarre_le, /^\d{4}-\d{2}-\d{2}T/);
});

// Un bash qui voit les fichiers de ce poste (pas celui de WSL depuis PowerShell).
async function bashUtilisable(dossier) {
  const temoin = path.join(dossier, 'temoin');
  await writeFile(temoin, '');
  return new Promise((ok) => {
    execFile('bash', ['-c', 'test -f "$1" && echo oui', '_', temoin], (erreur, sortie) => ok(!erreur && sortie.trim() === 'oui'));
  });
}

test('après un import du back office, la préparation de la voix est lancée avec le node du serveur', async (t) => {
  const racine = await mkdtemp(path.join(tmpdir(), 'agrifon-preparation-'));
  t.after(() => rm(racine, { recursive: true, force: true }));
  if (!(await bashUtilisable(racine))) return t.skip('pas de bash utilisable sur ce poste');
  await mkdir(path.join(racine, 'scripts', 'voix'), { recursive: true });
  await writeFile(path.join(racine, 'scripts', 'voix', 'lancer-preparation.sh'), 'printf %s "$NODE" > lance-avec\n');
  lancerPreparationVoix(racine);
  let lance = null;
  for (let i = 0; i < 50 && lance === null; i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    lance = await readFile(path.join(racine, 'lance-avec'), 'utf8').catch(() => null);
  }
  assert.equal(lance, process.execPath);
});
