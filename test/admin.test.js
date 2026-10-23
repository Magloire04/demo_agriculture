import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { creerAdmin, creerSessions, empreinteMotDePasse, verifierMotDePasse } from '../server/admin.js';
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

test('essais faux simultanés sans adresse : l’attente de 2 secondes vaut aussi pour eux, l’un après l’autre', async (t) => {
  let enCours = 0;
  let maximum = 0;
  const attentes = [];
  const url = await demarrer(t, {
    attendre: async (ms) => {
      attentes.push(ms);
      enCours++;
      maximum = Math.max(maximum, enCours);
      await new Promise((r) => setTimeout(r, 20));
      enCours--;
    },
  });
  const statuts = await Promise.all(Array.from({ length: 5 }, () => connexion(url, 'faux').then((r) => r.status)));
  assert.deepEqual(statuts, [401, 401, 401, 401, 401]);
  assert.deepEqual(attentes, [2000, 2000, 2000, 2000, 2000]);
  assert.equal(maximum, 1);
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
  const url = await demarrer(t, { attendre: () => retenue });
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
