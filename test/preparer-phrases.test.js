import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { attendreTour, phrasesFixes, phrasesPrix } from '../scripts/voix/preparer-phrases.js';
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

test('phrases de prix : un produit sur chaque marché, ou sans marché, celles des marchés relevés d’abord', () => {
  const { reponses, base, releves } = donnees();
  const liste = phrasesPrix({ reponses, base, releves });
  assert.equal(new Set(liste).size, liste.length);
  const relevees = base.produits.flatMap((p) => base.marches.filter((m) => releves.prix[p.id]?.[m.id]));
  // Un produit sur un marché relevé, sur un autre marché, ou sans marché : 15 réponses par produit.
  assert.ok(liste.length > relevees.length && liste.length <= base.produits.length * (base.marches.length + 1), String(liste.length));
  const textes = creerTextes(reponses);
  const mais = base.produits.find((p) => p.id === 'mais');
  const dantokpa = base.marches.find((m) => m.id === 'dantokpa');
  const ici = texteADire(textes.joindre([textes.phrase('prix_ici', {
    produit: { fr: mais.article, fon: mais.nom_fon }, unite: textes.unite(mais.unite), au_marche: dantokpa.au, marche: dantokpa.nom, prix: releves.prix.mais.dantokpa.prix,
  })]).voix);
  assert.ok(liste.slice(0, relevees.length).includes(ici));
});

// Serveur réel, labo et API de reconnaissance factices : l'identifiant rendu au téléphone.
async function serveurAvec(t, asr) {
  const { reponses, base, communes, releves } = donnees();
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-preparer-'));
  const gerer = creerApplication({
    asr: { configure: true, simulation: false, ...asr },
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
  return `http://127.0.0.1:${serveur.address().port}`;
}

test('le serveur et la préparation produisent le même identifiant pour un prix, avec ou sans marché, relevé ou non', async (t) => {
  const { reponses, base, releves } = donnees();
  const ids = new Set(phrasesPrix({ reponses, base, releves }).map((p) => idPhrase(p, 'homme2')));
  let transcription = '';
  const adresse = await serveurAvec(t, { marche: async () => ({ transcription, produits: [{ terme: 'gbàdé', terme_canonique: 'gbàdé' }], id: 'r1' }) });
  for (const dit of ['gbàdé glazuwe', 'gbàdé lokossa', 'gbàdé']) {
    transcription = dit;
    const r = await (await fetch(`${adresse}/api/prix`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: 'audio' })).json();
    assert.ok(r.voix_phrase && ids.has(r.voix_phrase), `${dit} : ${r.message}`);
  }
});

test('le serveur et la préparation produisent le même identifiant pour un accusé de signalement', async (t) => {
  const { reponses, base, communes, releves } = donnees();
  const adresse = await serveurAvec(t, { transcrire: async () => ({ texte: 'gbàdé ama jaunissent', texte_ponctue: 'Gbàdé ama jaunissent.', id: 'r2' }) });
  const r = await (await fetch(`${adresse}/api/signalements?commune=Bohicon`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: 'audio' })).json();
  const fixe = phrasesFixes({ reponses, base, communes, releves }).find((p) => p.includes(' Bohicon '));
  assert.equal(r.voix_phrase, idPhrase(fixe, 'homme2'));
});

test('une seule préparation à la fois : la seconde attend la fin de la première', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-verrou-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const verrou = path.join(dossier, 'preparation.verrou');
  const liberer = await attendreTour(verrou, { pid: 101, vivant: () => true });
  const attentes = [];
  let entree = false;
  const seconde = attendreTour(verrou, { pid: 102, vivant: () => true, pauseMs: 5, surAttente: (pid) => attentes.push(pid) })
    .then((l) => { entree = true; return l; });
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(entree, false);
  assert.deepEqual([...new Set(attentes)], [101]);
  await liberer();
  await (await seconde)();
  assert.equal(entree, true);
});

test('le verrou d’une préparation arrêtée en cours de route est repris', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-verrou-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const verrou = path.join(dossier, 'preparation.verrou');
  await writeFile(verrou, '999999');
  const liberer = await attendreTour(verrou, { pid: 103, vivant: (pid) => pid !== 999999, pauseMs: 5 });
  assert.equal(await readFile(verrou, 'utf8'), '103');
  await liberer();
});
