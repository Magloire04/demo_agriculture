import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { choisirSolutions, morceauxSolutions } from '../server/solutions.js';
import { texteVoix } from '../server/voix.js';

const donnees = JSON.parse(readFileSync(new URL('./fixtures/solutions.json', import.meta.url), 'utf8'));
const AOUT = new Date('2026-08-15T12:00:00Z');

function analyse(culture, symptomes, parties = []) {
  return {
    culture: culture ? { id: culture, nom: culture } : null,
    parties: parties.map((id) => ({ id, libelle: id })),
    symptomes: symptomes.map((id) => ({ id, libelle: id })),
    commune: null,
  };
}
const choisir = (a, options = {}) => choisirSolutions(donnees, a, { departement: null, date: AOUT, transcription: '', ...options });
const ids = (s) => s.elements.map((e) => e.id);

test('aucune solution sans culture ou sans symptôme', () => {
  assert.equal(choisir(analyse(null, ['jaunissement'])), null);
  assert.equal(choisir(analyse('mais', [])), null);
});

test('cas nette : problème « probablement », traitement en premier', () => {
  const s = choisir(analyse('haricot', ['feuilles_mangees'], ['fruits']));
  assert.equal(s.problemes.length, 1);
  assert.equal(s.problemes[0].certitude, 'nette');
  assert.ok(s.problemes[0].fr.startsWith("C'est probablement les foreurs des gousses"));
  assert.equal(s.elements[0].type, 'traitement');
  assert.equal(s.elements[0].id, 'haricot-foreurs.traitement');
  assert.deepEqual(s.elements[0].reserves, ['Pulvérisateur à très bas volume.']);
  assert.deepEqual(s.elements[0].securite, { fr: 'Porter des gants.', fon: 'gants fon' });
  assert.deepEqual(s.elements[0].video, { url: 'https://www.accessagriculture.org/exemple', titre: 'Vidéo de test' });
  assert.deepEqual(s.elements[0].sources, [{ id: 's-benin', nom: 'INRAB, Recueil de test', detail: 'fiche M-11', url: 'https://exemple.bj/recueil.pdf' }]);
  assert.equal(s.mention.fr, 'À confirmer avec un conseiller.');
  assert.equal(s.titre.fr, 'En attendant le conseiller, vous pouvez :');
  assert.equal(s.version, 'test-1');
});

test('cas possible : « Ce peut être », jamais de traitement', () => {
  const s = choisir(analyse('mais', ['taches']));
  assert.equal(s.problemes[0].certitude, 'possible');
  assert.ok(s.problemes[0].fr.startsWith('Ce peut être une maladie des feuilles'));
  assert.ok(s.elements.every((e) => e.type === 'geste'));
  assert.equal(s.elements[0].id, 'bruler');
});

test('mots déclencheurs absents : le cas devient possible', () => {
  const sans = choisir(analyse('coton', ['deformation']), { transcription: 'les feuilles du coton sont frisées' });
  assert.equal(sans.problemes[0].certitude, 'possible');
  assert.ok(sans.elements.every((e) => e.type === 'geste'));
  const avec = choisir(analyse('coton', ['deformation']), { transcription: 'il y a des pucerons sur le coton' });
  assert.equal(avec.problemes[0].certitude, 'nette');
  assert.equal(avec.elements[0].id, 'coton-pucerons.traitement');
});

test('partie exigée', () => {
  const s = choisir(analyse('haricot', ['feuilles_mangees'], ['feuilles']));
  assert.deepEqual(s.problemes, []);
  assert.ok(s.elements.every((e) => e.type === 'geste'));
});

test('saison connue : gestes de la saison seulement ; saison inconnue : aucun geste marqué', () => {
  const seche = choisir(analyse('mais', ['jaunissement']), { departement: 'Atlantique' });
  assert.deepEqual(ids(seche), ['mais-special', 'fumure', 'desherber', 'arroser']);
  const inconnue = choisir(analyse('mais', ['jaunissement']));
  assert.deepEqual(ids(inconnue), ['mais-special', 'fumure', 'desherber']);
});

test('plafonds', () => {
  const s = choisir(analyse('mais', ['jaunissement', 'taches', 'feuilles_mangees', 'deformation']), { departement: 'Atlantique' });
  assert.ok(s.elements.length <= 4);
  assert.ok(s.problemes.length <= 2);
  assert.ok(s.elements.filter((e) => e.type === 'traitement').length <= 1);
  assert.equal(new Set(ids(s)).size, s.elements.length);
});

test('deux symptômes : chacun contribue', () => {
  const s = choisir(analyse('haricot', ['jaunissement', 'taches']));
  assert.deepEqual(ids(s), ['fumure', 'retirer-feuilles', 'desherber', 'bruler']);
});

test('morceaux : du titre à la mention, tous dans la liste des extraits', () => {
  const s = choisir(analyse('haricot', ['feuilles_mangees'], ['fruits']));
  assert.equal(texteVoix(s.morceaux[0]), 'titre fon');
  assert.equal(texteVoix(s.morceaux.at(-1)), 'mention fon');
  assert.ok(s.morceaux.map(texteVoix).includes('kilo wo'));
  assert.ok(s.morceaux.map(texteVoix).includes('gants fon'));
  const liste = new Set(morceauxSolutions(donnees).map(texteVoix));
  for (const m of s.morceaux) assert.ok(liste.has(texteVoix(m)), m);
  assert.ok(liste.has('foreurs fon') && liste.has('loin du champ'));
});
