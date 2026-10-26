import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { creerAppelLabo, creerSynthese, creerSyntheseDepuisEnv, decouperTexte, idPhrase, texteADire } from '../server/synthese.js';
import { ecrireWav, lireWav } from '../server/wav.js';

const WAV_24K = ecrireWav({ frequence: 24000, echantillons: new Int16Array(2400) }); // 0,1 s

async function dossier(t) {
  const d = await mkdtemp(path.join(tmpdir(), 'agrifon-synthese-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
}

// Labo factice : note les textes reçus ; peut attendre une promesse, échouer ou rendre un autre corps.
function labo({ retenue = null, echec = null, corps = WAV_24K } = {}) {
  const recus = [];
  return {
    recus,
    appeler: async (texte) => {
      recus.push(texte);
      if (retenue) await retenue;
      if (echec) throw echec;
      return corps;
    },
  };
}

function retenue() {
  let liberer;
  const promesse = new Promise((r) => { liberer = r; });
  return { promesse, liberer };
}

const phrase = (lettre, longueur) => `${lettre.repeat(longueur - 1)}.`;

test('texte à dire : minuscule en milieu de phrase, majuscule après un point', () => {
  assert.equal(texteADire(['È nɔ sa gbadé kilo ɖokpó yí', 'kpɔ́nwun wǒ', 'Ɖo Dantokpa axi mɛ.']), 'È nɔ sa gbadé kilo ɖokpó yí kpɔ́nwun wǒ ɖo Dantokpa axi mɛ.');
  assert.equal(texteADire(['Un ma se nǔ ɔ sín nyǐkɔ ǎ.', 'Ɖo Pobè axi mɛ ɔ, nǔ lɛ́ sín akwɛ́ ɖíe.']), 'Un ma se nǔ ɔ sín nyǐkɔ ǎ. Ɖo Pobè axi mɛ ɔ, nǔ lɛ́ sín akwɛ́ ɖíe.');
});

test('découpage : phrases regroupées sous 300 caractères, une phrase trop longue coupée sans perdre un mot', () => {
  const trois = [phrase('a', 120), phrase('b', 120), phrase('c', 120)].join(' ');
  const morceaux = decouperTexte(trois);
  assert.equal(morceaux.length, 2);
  assert.ok(morceaux.every((m) => m.length <= 300));
  assert.equal(morceaux.join(' '), trois);

  const parties = Array.from({ length: 8 }, (_, i) => `mi ɖɔ xó ${i} ${'x'.repeat(38)},`);
  const avecVirgules = `${parties.join(' ')} fin.`;
  assert.ok(avecVirgules.length > 300);
  const coupes = decouperTexte(avecVirgules);
  assert.ok(coupes.length >= 2 && coupes.every((m) => m.length <= 300));
  assert.ok(coupes[0].endsWith(','), coupes[0]);
  assert.equal(coupes.join(' '), avecVirgules);

  const sansVirgule = `${Array.from({ length: 80 }, (_, i) => `mot${i}`).join(' ')}.`;
  assert.ok(sansVirgule.length > 300);
  const auxEspaces = decouperTexte(sansVirgule);
  assert.ok(auxEspaces.length >= 2 && auxEspaces.every((m) => m.length <= 300));
  assert.equal(auxEspaces.join(' '), sansVirgule);
});

test('identifiant : même texte à la casse près, voix différente, 16 caractères hexadécimaux', () => {
  assert.equal(idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'homme2'), idPhrase('mǐ sɛ́ xó mitɔn dó.', 'homme2'));
  assert.notEqual(idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'homme2'), idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'femme'));
  assert.match(idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'homme2'), /^[0-9a-f]{16}$/);
});

test('appel au labo : Basic, JSON { texte, voix }, rejet sur 500 et sur un corps qui n’est pas un WAV', async () => {
  const requetes = [];
  let reponse = () => new Response(WAV_24K, { status: 200, headers: { 'Content-Type': 'audio/wav' } });
  const fetch = async (url, options) => {
    requetes.push({ url, ...options });
    return reponse();
  };
  const appeler = creerAppelLabo({ url: 'https://labo.example/tts', identifiant: 'id', motDePasse: 'mdp', voix: 'homme2', fetch });
  assert.deepEqual(await appeler('Mǐ sɛ́ xó mitɔn dó.'), WAV_24K);
  assert.equal(requetes[0].url, 'https://labo.example/tts');
  assert.equal(requetes[0].method, 'POST');
  assert.equal(requetes[0].headers.Authorization, `Basic ${Buffer.from('id:mdp').toString('base64')}`);
  assert.deepEqual(JSON.parse(requetes[0].body), { texte: 'Mǐ sɛ́ xó mitɔn dó.', voix: 'homme2' });
  reponse = () => new Response('erreur', { status: 500 });
  await assert.rejects(appeler('a.'), /HTTP 500/);
  reponse = () => new Response('oops', { status: 200 });
  await assert.rejects(appeler('a.'), /WAV/);
});

test('une phrase synthétisée une fois, servie ensuite sans appel, en WAV 16 kHz', async (t) => {
  const l = labo();
  const s = creerSynthese({ dossier: await dossier(t), appeler: l.appeler, voix: 'homme2' });
  const id = s.enregistrer('Mǐ sɛ́ xó mitɔn dó.');
  const premier = await s.obtenir(id);
  assert.equal(premier.etat, 'pret');
  const { frequence, echantillons } = lireWav(await readFile(premier.chemin));
  assert.equal(frequence, 16000);
  assert.equal(echantillons.length, 1600);
  assert.equal((await s.obtenir(id)).etat, 'pret');
  assert.deepEqual(l.recus, ['Mǐ sɛ́ xó mitɔn dó.']);
});

test('identifiant jamais émis : inconnu, sans appel', async (t) => {
  const l = labo();
  const s = creerSynthese({ dossier: await dossier(t), appeler: l.appeler, voix: 'homme2' });
  assert.deepEqual(await s.obtenir('0123456789abcdef'), { etat: 'inconnu' });
  assert.equal(l.recus.length, 0);
});

test('deux demandes simultanées : une seule synthèse', async (t) => {
  const l = labo();
  const s = creerSynthese({ dossier: await dossier(t), appeler: l.appeler, voix: 'homme2' });
  const id = s.enregistrer('Mǐ sɛ́ xó mitɔn dó.');
  const etats = await Promise.all([s.obtenir(id), s.obtenir(id)]);
  assert.deepEqual(etats.map((e) => e.etat), ['pret', 'pret']);
  assert.equal(l.recus.length, 1);
});

test('labo lent : en_cours, puis pret sans nouvel appel', async (t) => {
  const r = retenue();
  const l = labo({ retenue: r.promesse });
  const s = creerSynthese({ dossier: await dossier(t), appeler: l.appeler, voix: 'homme2' });
  const id = s.enregistrer('Mǐ sɛ́ xó mitɔn dó.');
  assert.deepEqual(await s.obtenir(id, { attenteMs: 10 }), { etat: 'en_cours' });
  r.liberer();
  assert.equal((await s.obtenir(id)).etat, 'pret');
  assert.equal(l.recus.length, 1);
});

test('texte long : un appel par morceau, dans l’ordre, sons recollés avec 250 ms de silence', async (t) => {
  const l = labo();
  const s = creerSynthese({ dossier: await dossier(t), appeler: l.appeler, voix: 'homme2' });
  const texte = `${phrase('a', 200)} ${phrase('b', 200)}`;
  const resultat = await s.obtenir(s.enregistrer(texte));
  assert.deepEqual(l.recus, [phrase('a', 200), phrase('b', 200)]);
  assert.equal(lireWav(await readFile(resultat.chemin)).echantillons.length, 1600 + 4000 + 1600);
});

test('échec du labo : rien en réserve, pause, puis nouvel essai après la pause', async (t) => {
  let horloge = Date.parse('2026-10-26T12:00:00Z');
  const l = labo({ echec: new Error('GPU indisponible') });
  const d = await dossier(t);
  const s = creerSynthese({ dossier: d, appeler: l.appeler, voix: 'homme2', pauseEchecMs: 300_000, maintenant: () => horloge });
  const a = s.enregistrer('a.');
  const b = s.enregistrer('b.');
  assert.deepEqual(await s.obtenir(a), { etat: 'en_cours' });
  assert.deepEqual(await s.obtenir(b), { etat: 'en_cours' }); // en pause : pas d'appel
  assert.deepEqual(l.recus, ['a.']);
  const etat = await s.etat();
  assert.equal(etat.en_reserve, 0);
  assert.equal(etat.derniere_erreur.message, 'GPU indisponible');
  assert.equal(etat.pause_jusqua, '2026-10-26T12:05:00.000Z');
  horloge += 300_001;
  await s.obtenir(b);
  assert.deepEqual(l.recus, ['a.', 'b.']);
});

test('corps tronqué ou non WAV : rien en réserve', async (t) => {
  const d = await dossier(t);
  const l = labo({ corps: WAV_24K.subarray(0, 30) });
  const s = creerSynthese({ dossier: d, appeler: l.appeler, voix: 'homme2' });
  assert.deepEqual(await s.obtenir(s.enregistrer('a.')), { etat: 'en_cours' });
  const fichiers = await readdir(d).catch(() => []);
  assert.deepEqual(fichiers.filter((f) => f.endsWith('.wav')), []);
  assert.match((await s.etat()).derniere_erreur.message, /WAV non pris en charge/);
});

test('file pleine : en_cours sans mise en file', async (t) => {
  const r = retenue();
  const l = labo({ retenue: r.promesse });
  const s = creerSynthese({ dossier: await dossier(t), appeler: l.appeler, voix: 'homme2', maxFile: 1 });
  const a = s.enregistrer('a.');
  const b = s.enregistrer('b.');
  assert.deepEqual(await s.obtenir(a, { attenteMs: 10 }), { etat: 'en_cours' });
  assert.deepEqual(await s.obtenir(b, { attenteMs: 10 }), { etat: 'en_cours' });
  assert.deepEqual(l.recus, ['a.']);
  r.liberer();
  assert.equal((await s.obtenir(a)).etat, 'pret');
  assert.equal((await s.obtenir(b)).etat, 'pret');
  assert.deepEqual(l.recus, ['a.', 'b.']);
});

test('après un redémarrage : un son en réserve est servi, un identifiant non synthétisé est inconnu', async (t) => {
  const d = await dossier(t);
  const avant = creerSynthese({ dossier: d, appeler: labo().appeler, voix: 'homme2' });
  const fait = avant.enregistrer('a.');
  await avant.obtenir(fait);
  const jamais = avant.enregistrer('b.');
  const l = labo();
  const apres = creerSynthese({ dossier: d, appeler: l.appeler, voix: 'homme2' });
  assert.equal((await apres.obtenir(fait)).etat, 'pret');
  assert.deepEqual(await apres.obtenir(jamais), { etat: 'inconnu' });
  assert.equal(l.recus.length, 0);
});

test('purge : plus de 30 jours sans usage effacés, puis les plus anciens au-delà du plafond', async (t) => {
  const d = await dossier(t);
  const maintenant = Date.parse('2026-10-26T12:00:00Z');
  const s = creerSynthese({ dossier: d, appeler: labo().appeler, voix: 'homme2', maxOctets: 5000, maintenant: () => maintenant });
  const chemins = [];
  for (const texte of ['a.', 'b.', 'c.']) chemins.push((await s.obtenir(s.enregistrer(texte))).chemin);
  const taille = (await stat(chemins[0])).size;
  assert.ok(taille < 5000 && 2 * taille > 5000, String(taille)); // un seul fichier tient sous le plafond
  const jours = (n) => new Date(maintenant - n * 86_400_000);
  await utimes(chemins[0], jours(40), jours(40));
  await utimes(chemins[1], jours(10), jours(10));
  await utimes(chemins[2], jours(1), jours(1));
  assert.deepEqual(await s.purger(), { effaces: 2 });
  assert.deepEqual((await readdir(d)).filter((f) => f.endsWith('.wav')), [path.basename(chemins[2])]);
});

test('préparation : déjà présents sautés, échecs comptés', async (t) => {
  const d = await dossier(t);
  const l = labo();
  const s = creerSynthese({ dossier: d, appeler: l.appeler, voix: 'homme2' });
  await s.obtenir(s.enregistrer('a.'));
  const bilan = await s.preparer(['a.', 'b.'], { pauseMs: 0 });
  assert.deepEqual({ faits: bilan.faits, deja: bilan.deja, echecs: bilan.echecs }, { faits: 1, deja: 1, echecs: 0 });
  assert.deepEqual(l.recus, ['a.', 'b.']);
  const enPanne = creerSynthese({ dossier: d, appeler: labo({ echec: new Error('panne') }).appeler, voix: 'homme2' });
  const panne = await enPanne.preparer(['c.', 'd.'], { pauseMs: 0 });
  assert.deepEqual({ faits: panne.faits, deja: panne.deja, echecs: panne.echecs }, { faits: 0, deja: 0, echecs: 2 });
});

test('creerSyntheseDepuisEnv : null en simulation, avec VOIX_PHRASES=0 ou sans identifiants', async (t) => {
  const d = await dossier(t);
  const env = { ASR_ID: 'id', ASR_MDP: 'mdp' };
  assert.equal(creerSyntheseDepuisEnv(env, d, { simulation: true }), null);
  assert.equal(creerSyntheseDepuisEnv({ ...env, VOIX_PHRASES: '0' }, d, { simulation: false }), null);
  assert.equal(creerSyntheseDepuisEnv({}, d, { simulation: false }), null);
  assert.notEqual(creerSyntheseDepuisEnv(env, d, { simulation: false }), null);
});
