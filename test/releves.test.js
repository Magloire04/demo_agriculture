import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerReleves } from '../server/releves.js';

const contenu = (derniere) => JSON.stringify({ source: { nom: 'PAM' }, derniere_date: derniere, prix: { mais: {} } });

test('relevés : stockage préféré à l’instantané, relu quand il change, gardé s’il est abîmé', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const stockage = path.join(dossier, 'stockage.json');
  const instantane = path.join(dossier, 'instantane.json');
  await writeFile(instantane, contenu('2026-08-15'));
  const releves = creerReleves([stockage, instantane], { intervalleMs: 0 });

  assert.equal(releves.lire().derniere_date, '2026-08-15');

  await writeFile(stockage, contenu('2026-09-15'));
  assert.equal(releves.lire().derniere_date, '2026-09-15');

  await writeFile(stockage, `${contenu('2026-10-15')} `);
  assert.equal(releves.lire().derniere_date, '2026-10-15');

  await writeFile(stockage, '{ abîmé');
  assert.equal(releves.lire().derniere_date, '2026-10-15');
});

test('relevés : instantané utilisé si le fichier du stockage est abîmé dès le départ', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const stockage = path.join(dossier, 'stockage.json');
  const instantane = path.join(dossier, 'instantane.json');
  await writeFile(stockage, '{ abîmé');
  await writeFile(instantane, contenu('2026-08-15'));
  assert.equal(creerReleves([stockage, instantane], { intervalleMs: 0 }).lire().derniere_date, '2026-08-15');
});

test('relevés : aucun fichier, aucun prix', () => {
  const releves = creerReleves(['/inexistant/a.json'], { intervalleMs: 0 });
  assert.deepEqual(releves.lire().prix, {});
});

test('relevés : vérification limitée dans le temps', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const fichier = path.join(dossier, 'r.json');
  await writeFile(fichier, contenu('2026-08-15'));
  let horloge = 0;
  const releves = creerReleves([fichier], { intervalleMs: 30_000, maintenant: () => horloge });
  assert.equal(releves.lire().derniere_date, '2026-08-15');
  await writeFile(fichier, `${contenu('2026-09-15')}  `);
  horloge = 10_000;
  assert.equal(releves.lire().derniere_date, '2026-08-15');
  horloge = 30_000;
  assert.equal(releves.lire().derniere_date, '2026-09-15');
});
