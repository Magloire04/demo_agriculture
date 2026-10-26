import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { phrasesFixes } from '../scripts/voix/preparer-phrases.js';
import { creerApplication } from '../server/index.js';
import { creerTextes } from '../server/reponses.js';
import { creerRegistre } from '../server/signalement.js';
import { creerSynthese, idPhrase, texteADire } from '../server/synthese.js';
import { creerVoix } from '../server/voix.js';
import { ecrireWav } from '../server/wav.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const donnees = () => ({ reponses: lire('reponses.json'), base: lire('referentiel.json'), communes: lire('communes.json').communes, releves: lire('releves-prix.json') });

test('phrases fixes : chaque commune, le GPS, produit non compris, chaque marché avec des prix', () => {
  const { reponses, base, communes, releves } = donnees();
  const liste = phrasesFixes({ reponses, base, communes, releves });
  const marchesAvecPrix = base.marches.filter((m) => base.produits.some((p) => releves.prix[p.id]?.[m.id]));
  assert.ok(marchesAvecPrix.length > 0 && marchesAvecPrix.length < base.marches.length); // Lokossa n'a pas de prix
  assert.equal(liste.length, communes.length + 1 + 1 + marchesAvecPrix.length);
  assert.equal(new Set(liste).size, liste.length);
  const textes = creerTextes(reponses);
  const titre = textes.phrase('signalement_transmis');
  assert.ok(liste.includes(texteADire(textes.joindre([titre, textes.phrase('signalement_recu_commune', { commune: 'Bohicon' })]).voix)));
  assert.ok(liste.includes(texteADire(textes.joindre([titre, textes.phrase('signalement_recu_gps')]).voix)));
  assert.ok(liste.includes('Un ma se nǔ ɖěbǔ sín nyǐkɔ ǎ. Mi kɛnklɛ́n bo ɖɔ nǔ ɔ sín nyǐkɔ. Énɛ́ gúdo ɔ, mi ɖɔ axi ɔ sín nyǐkɔ.'));
  assert.ok(liste.includes('Un ma se nǔ ɔ sín nyǐkɔ ǎ. Ɖo Dantokpa axi mɛ ɔ, nǔ lɛ́ sín akwɛ́ ɖíe.'));
  assert.ok(!liste.some((p) => p.includes('Lokossa axi')));
});

test('le serveur et la préparation produisent le même identifiant pour un accusé de signalement', async (t) => {
  const { reponses, base, communes, releves } = donnees();
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-preparer-'));
  const gerer = creerApplication({
    asr: {
      configure: true,
      simulation: false,
      transcrire: async () => ({ texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', id: 'r2' }),
    },
    base,
    releves: { lire: () => releves },
    lexique: lire('lexique.json'),
    communes,
    registre: await creerRegistre(dossier),
    textes: creerTextes(reponses),
    voix: creerVoix('/inexistant'),
    protection: null,
    synthese: creerSynthese({ dossier: path.join(dossier, 'voix-phrases'), voix: 'homme2', appeler: async () => ecrireWav({ frequence: 24000, echantillons: new Int16Array(10) }) }),
  });
  const serveur = createServer(gerer);
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  t.after(async () => {
    serveur.close();
    await rm(dossier, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${serveur.address().port}/api/signalements?commune=Bohicon`;
  const r = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: 'audio' })).json();
  const fixe = phrasesFixes({ reponses, base, communes, releves }).find((p) => p.includes(' Bohicon '));
  assert.equal(r.voix_phrase, idPhrase(fixe, 'homme2'));
});
