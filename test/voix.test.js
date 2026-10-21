import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { repondrePrix } from '../server/prix.js';
import { creerTextes } from '../server/reponses.js';
import { creerVoix, fichierVoix, listerMorceaux, texteVoix } from '../server/voix.js';

const lire = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const reponses = lire('../data/reponses.json');
const base = lire('../data/referentiel.json');
const { communes } = lire('../data/communes.json');

test('nom de fichier : déduit du texte, sans tenir compte de la casse ni des espaces', () => {
  assert.equal(fichierVoix('Ɖo Glazoué axi mɛ.'), fichierVoix('ɖo  glazoué axi mɛ.'));
  assert.notEqual(fichierVoix('ɖo Glazoué axi mɛ.'), fichierVoix('ɖo Glazoue axi mɛ.'));
  assert.match(fichierVoix('x'), /^[0-9a-f]{16}\.mp3$/);
});

test('creerVoix : null dès qu’un extrait manque', async (t) => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'agrifon-voix-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  await writeFile(path.join(dossier, fichierVoix('a')), '');
  await writeFile(path.join(dossier, fichierVoix('b')), '');
  const voix = creerVoix(dossier);
  assert.deepEqual(voix.fichiers(['a', 'b']), [fichierVoix('a'), fichierVoix('b')]);
  assert.equal(voix.fichiers(['a', 'c']), null);
  assert.equal(voix.fichiers(null), null);
  assert.equal(creerVoix('/inexistant').fichiers(['a']), null);
  // Un extrait déposé ou retiré pendant que le serveur tourne compte aussitôt.
  await writeFile(path.join(dossier, fichierVoix('c')), '');
  assert.deepEqual(voix.fichiers(['a', 'c']), [fichierVoix('a'), fichierVoix('c')]);
  await rm(path.join(dossier, fichierVoix('a')));
  assert.equal(voix.fichiers(['a', 'c']), null);
});

test('listerMorceaux : un produit sans nom fon ne donne aucun morceau', () => {
  const avecTrou = { ...base, produits: [...base.produits, { id: 'x', nom: 'X', nom_fon: null, unite: 'kg' }, { id: 'y', nom: 'Y', nom_fon: 'y', unite: 'tas' }] };
  const liste = listerMorceaux(reponses, avecTrou, communes);
  assert.equal(liste.length, listerMorceaux(reponses, base, communes).length);
  assert.ok(liste.every((m) => !/undefined|null/.test(m)));
});

test('chaque morceau que disent les réponses figure dans la liste des extraits à préparer', () => {
  const liste = new Set(listerMorceaux(reponses, base, communes));
  const textes = creerTextes(reponses);
  const releves = lire('../data/releves-prix.json');
  const demandes = [];
  for (const p of base.produits) {
    demandes.push({ transcription: p.nom_fon, produits: [{ terme: p.nom_fon, terme_canonique: p.nom_fon }] });
    for (const m of base.marches) {
      demandes.push({ transcription: `${p.nom_fon} ${m.termes[0]}`, produits: [{ terme: p.nom_fon, terme_canonique: p.nom_fon }] });
    }
  }
  for (const m of base.marches) demandes.push({ transcription: `axi ${m.termes[0]}`, produits: [] });
  demandes.push({ transcription: 'blabla', produits: [] });
  let avecVoix = 0;
  for (const d of demandes) {
    const r = repondrePrix(base, releves, textes, d);
    if (!r.voix) continue;
    avecVoix++;
    for (const morceau of r.voix) assert.ok(liste.has(texteVoix(morceau)), `${d.transcription} : ${morceau}`);
  }
  assert.ok(avecVoix > 400, `${avecVoix} réponses avec voix`);
  for (const c of communes) {
    for (const morceau of textes.phrase('signalement_recu_commune', { commune: c.nom }).voix) assert.ok(liste.has(texteVoix(morceau)), morceau);
  }
});
