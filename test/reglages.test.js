import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerReglages } from '../server/reglages.js';

async function dossier(t) {
  const d = await mkdtemp(path.join(tmpdir(), 'agrifon-reglages-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return path.join(d, 'reglages.json');
}

// Horloge réglable : chaque appel rend l'instant courant.
function horloge(depart) {
  let t = new Date(depart).getTime();
  return { maintenant: () => new Date(t), avancer: (ms) => { t += ms; } };
}

test('reglages par défaut : en service, solutions selon la valeur de départ, aucune coupure', async (t) => {
  const r = await creerReglages(await dossier(t), { solutionsBrouillon: true });
  assert.equal(r.horsService(), false);
  assert.deepEqual(r.lire(), { hors_service: { actif: false, depuis: null }, solutions_brouillon: true, coupures: [] });
});

test('couper puis remettre en service : une coupure fermée avec début et fin', async (t) => {
  const h = horloge('2026-10-23T10:00:00Z');
  const r = await creerReglages(await dossier(t), { solutionsBrouillon: false, maintenant: h.maintenant });
  await r.mettreHorsService();
  assert.equal(r.horsService(), true);
  assert.deepEqual(r.lire().hors_service, { actif: true, depuis: '2026-10-23T10:00:00.000Z' });
  h.avancer(5 * 60_000);
  await r.mettreHorsService(); // déjà coupé : la coupure en cours ne change pas
  assert.equal(r.lire().coupures.length, 1);
  h.avancer(25 * 60_000);
  await r.remettreEnService();
  await r.remettreEnService(); // déjà en service : sans effet
  assert.equal(r.horsService(), false);
  assert.deepEqual(r.lire().hors_service, { actif: false, depuis: '2026-10-23T10:30:00.000Z' });
  assert.deepEqual(r.lire().coupures, [{ debut: '2026-10-23T10:00:00.000Z', fin: '2026-10-23T10:30:00.000Z' }]);
});

test('réglages relus après redémarrage', async (t) => {
  const fichier = await dossier(t);
  const h = horloge('2026-10-23T12:00:00Z');
  const avant = await creerReglages(fichier, { solutionsBrouillon: false, maintenant: h.maintenant });
  await avant.mettreHorsService();
  const apres = await creerReglages(fichier, { solutionsBrouillon: false });
  assert.equal(apres.horsService(), true);
  assert.equal(apres.lire().hors_service.depuis, '2026-10-23T12:00:00.000Z');
  assert.deepEqual(apres.lire().coupures, [{ debut: '2026-10-23T12:00:00.000Z', fin: null }]);
});

test('la valeur de départ ne remplace pas un réglage enregistré', async (t) => {
  const fichier = await dossier(t);
  const avant = await creerReglages(fichier, { solutionsBrouillon: true });
  await avant.definirSolutionsBrouillon(false);
  assert.equal(avant.lire().solutions_brouillon, false);
  const apres = await creerReglages(fichier, { solutionsBrouillon: true });
  assert.equal(apres.lire().solutions_brouillon, false);
});

test('lire() rend une copie : la modifier ne change pas les réglages', async (t) => {
  const r = await creerReglages(await dossier(t), { solutionsBrouillon: false });
  const copie = r.lire();
  copie.hors_service.actif = true;
  copie.coupures.push({ debut: 'x', fin: null });
  assert.equal(r.horsService(), false);
  assert.deepEqual(r.lire().coupures, []);
});

test('écriture impossible : le réglage reste tel qu’il était', async (t) => {
  const fichier = await dossier(t);
  const r = await creerReglages(fichier, { solutionsBrouillon: false });
  await mkdir(`${fichier}.tmp`); // le fichier temporaire ne peut plus être écrit
  await assert.rejects(r.mettreHorsService());
  assert.equal(r.horsService(), false);
  assert.deepEqual(r.lire().coupures, []);
});

test('après une écriture impossible, les suivantes reprennent', async (t) => {
  const fichier = await dossier(t);
  const r = await creerReglages(fichier, { solutionsBrouillon: false });
  await mkdir(`${fichier}.tmp`);
  await assert.rejects(r.definirSolutionsBrouillon(true));
  await rm(`${fichier}.tmp`, { recursive: true });
  await r.definirSolutionsBrouillon(true);
  assert.equal(r.lire().solutions_brouillon, true);
  assert.equal((await creerReglages(fichier, { solutionsBrouillon: false })).lire().solutions_brouillon, true);
});

test('fichier abîmé : valeurs par défaut, sans erreur', async (t) => {
  const fichier = await dossier(t);
  await writeFile(fichier, '{ pas du json');
  const r = await creerReglages(fichier, { solutionsBrouillon: true });
  assert.deepEqual(r.lire(), { hors_service: { actif: false, depuis: null }, solutions_brouillon: true, coupures: [] });
});
