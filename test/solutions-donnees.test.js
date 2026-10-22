import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { verifierTraitement } from '../server/pesticides.js';
import { choisirSolutions } from '../server/solutions.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const donnees = lire('solutions.json');
const lexique = lire('lexique.json');
const pesticides = lire('pesticides.json');

const complet = (t, ou) => {
  for (const champ of ['fr', 'fon', 'voix']) assert.ok(t?.[champ]?.trim(), `${ou} : ${champ} manquant`);
};
const sourcesExistent = (liste, ou) => {
  assert.ok(liste?.length, `${ou} : aucune source`);
  for (const { id } of liste) assert.ok(donnees.sources[id], `${ou} : source inconnue ${id}`);
};

test('chaque élément a fr, fon, voix et des sources existantes', () => {
  for (const [id, p] of Object.entries(donnees.phrases)) complet(p, `phrase ${id}`);
  for (const [id, g] of Object.entries(donnees.gestes)) {
    complet(g, `geste ${id}`);
    sourcesExistent(g.sources, `geste ${id}`);
    assert.ok([undefined, 'pluies', 'seche'].includes(g.saison), `geste ${id} : saison ${g.saison}`);
  }
  for (const c of donnees.cas) {
    for (const champ of ['fr', 'fon']) assert.ok(c.probleme?.[champ]?.trim(), `cas ${c.id} : problème ${champ}`);
    sourcesExistent(c.sources, `cas ${c.id}`);
    if (!c.traitement) continue;
    complet(c.traitement, `cas ${c.id} : traitement`);
    if (c.traitement.securite) complet(c.traitement.securite, `cas ${c.id} : sécurité`);
    sourcesExistent(c.traitement.sources, `cas ${c.id} : traitement`);
  }
  for (const s of Object.values(donnees.sources)) assert.ok(s.editeur && s.titre && s.url && typeof s.pour_le_benin === 'boolean', JSON.stringify(s));
});

test('chaque combinaison culture × symptôme donne au moins deux gestes sans saison', () => {
  for (const culture of lexique.cultures) {
    for (const symptome of lexique.symptomes) {
      const s = choisirSolutions(donnees, {
        culture: { id: culture.id, nom: culture.nom }, parties: [], symptomes: [{ id: symptome.id, libelle: symptome.libelle }], commune: null,
      }, { departement: null, date: new Date('2026-08-15T12:00:00Z'), transcription: '' });
      const gestes = s.elements.filter((e) => e.type === 'geste');
      assert.ok(gestes.length >= 2, `${culture.id} × ${symptome.id} : ${gestes.length} geste(s)`);
    }
  }
});

test('un traitement vient d’une source faite pour le Bénin et d’un cas nette', () => {
  for (const c of donnees.cas.filter((x) => x.traitement)) {
    assert.equal(c.certitude, 'nette', `cas ${c.id}`);
    for (const { id } of c.traitement.sources) assert.equal(donnees.sources[id].pour_le_benin, true, `cas ${c.id} : source ${id}`);
    assert.ok(['preparation', 'produit'].includes(c.traitement.type), `cas ${c.id} : type ${c.traitement.type}`);
  }
});

test('chaque produit nommé passe la règle d’autorisation', () => {
  for (const c of donnees.cas.filter((x) => x.traitement?.type === 'produit')) {
    assert.ok(c.traitement.matieres?.length && c.traitement.cible, `cas ${c.id} : matières et cible exigées`);
    const r = verifierTraitement(c.traitement, c.culture, pesticides);
    assert.ok(r.autorise, `cas ${c.id} : ${r.raisons.join(' ; ')}`);
  }
});

// Cas tirés des recherches du 22 octobre 2026 (spécification, « Ce que les recherches ont trouvé »).
const CAS_ATTENDUS = [
  { id: 'mais-chenille-legionnaire', culture: 'mais', certitude: 'possible', traitement: null },
  { id: 'mais-striga', culture: 'mais', certitude: 'nette', traitement: null },
  { id: 'sorgho-striga', culture: 'sorgho', certitude: 'nette', traitement: null },
  { id: 'niebe-foreurs-gousses', culture: 'haricot', certitude: 'nette', traitement: 'preparation' },
  { id: 'coton-pucerons', culture: 'coton', certitude: 'nette', traitement: 'preparation' },
  { id: 'manioc-mosaique', culture: 'manioc', certitude: 'nette', traitement: null },
  { id: 'manioc-pourridie', culture: 'manioc', certitude: 'nette', traitement: null },
  { id: 'igname-pourriture-stockage', culture: 'igname', certitude: 'possible', traitement: null },
  { id: 'plantain-bunchy-top', culture: 'plantain', certitude: 'possible', traitement: null },
  { id: 'plantain-cercosporiose', culture: 'plantain', certitude: 'possible', traitement: null },
  { id: 'anacarde-anthracnose', culture: 'anacarde', certitude: 'possible', traitement: null },
  { id: 'palmier-fusariose', culture: 'palmier', certitude: 'possible', traitement: null },
];

test('cas attendus présents, avec leur certitude et leur type de traitement', () => {
  for (const attendu of CAS_ATTENDUS) {
    const c = donnees.cas.find((x) => x.id === attendu.id);
    assert.ok(c, `cas absent : ${attendu.id}`);
    assert.equal(c.culture, attendu.culture, attendu.id);
    assert.equal(c.certitude, attendu.certitude, attendu.id);
    assert.equal(c.traitement?.type ?? null, attendu.traitement, attendu.id);
  }
});

const signaler = (culture, symptomes, { parties = [], transcription = '', departement = null } = {}) => choisirSolutions(donnees, {
  culture: { id: culture, nom: culture }, parties: parties.map((id) => ({ id, libelle: id })), symptomes: symptomes.map((id) => ({ id, libelle: id })), commune: null,
}, { departement, date: new Date('2026-08-15T12:00:00Z'), transcription });

test('céréales, légumineuses et coton : scénarios types', () => {
  const striga = signaler('mais', ['striga']);
  assert.equal(striga.problemes[0].id, 'mais-striga');
  assert.ok(striga.elements.some((e) => e.id === 'arracher-striga'));
  const niebe = signaler('haricot', ['ravageurs'], { parties: ['fruits'] });
  assert.equal(niebe.elements[0].id, 'niebe-foreurs-gousses.traitement');
  assert.ok(niebe.elements[0].fr.includes('15 kg'));
  assert.equal(signaler('haricot', ['ravageurs']).elements.some((e) => e.type === 'traitement'), false);
  assert.equal(signaler('coton', ['deformation'], { transcription: 'des pucerons partout' }).elements[0].id, 'coton-pucerons.traitement');
  assert.equal(signaler('coton', ['deformation']).elements.some((e) => e.type === 'traitement'), false);
  assert.equal(signaler('mais', ['feuilles_mangees']).problemes[0].certitude, 'possible');
});

test('tubercules et cultures pérennes : scénarios types', () => {
  const mosaique = signaler('manioc', ['deformation']);
  assert.equal(mosaique.problemes[0].id, 'manioc-mosaique');
  assert.ok(mosaique.problemes[0].fr.startsWith("C'est probablement"));
  assert.ok(mosaique.elements[0].video?.url.includes('/fon/'));
  for (const [culture, symptome] of [['plantain', 'taches'], ['anacarde', 'taches'], ['palmier', 'fletrissement'], ['igname', 'pourriture']]) {
    const s = signaler(culture, [symptome]);
    assert.equal(s.problemes[0]?.certitude, 'possible', `${culture} × ${symptome}`);
    assert.equal(s.elements.some((e) => e.type === 'traitement'), false, `${culture} × ${symptome}`);
  }
});

test('références croisées', () => {
  const cultures = new Set(lexique.cultures.map((c) => c.id));
  const symptomes = new Set(lexique.symptomes.map((s) => s.id));
  const parties = new Set(lexique.parties.map((p) => p.id));
  const geste = (id, ou) => assert.ok(donnees.gestes[id], `${ou} : geste inconnu ${id}`);
  for (const [s, liste] of Object.entries(donnees.par_symptome)) {
    assert.ok(symptomes.has(s), `par_symptome : ${s}`);
    for (const id of liste) geste(id, `par_symptome.${s}`);
  }
  for (const [c, parSymptome] of Object.entries(donnees.par_culture)) {
    assert.ok(cultures.has(c), `par_culture : ${c}`);
    for (const [s, liste] of Object.entries(parSymptome)) {
      assert.ok(symptomes.has(s), `par_culture.${c} : ${s}`);
      for (const id of liste) geste(id, `par_culture.${c}.${s}`);
    }
  }
  const ids = new Set();
  for (const c of donnees.cas) {
    assert.ok(!ids.has(c.id), `cas en double : ${c.id}`);
    ids.add(c.id);
    assert.ok(cultures.has(c.culture), `cas ${c.id} : culture ${c.culture}`);
    for (const s of c.symptomes) assert.ok(symptomes.has(s), `cas ${c.id} : symptôme ${s}`);
    for (const p of c.parties ?? []) assert.ok(parties.has(p), `cas ${c.id} : partie ${p}`);
    for (const id of c.gestes ?? []) geste(id, `cas ${c.id}`);
    assert.ok(['nette', 'possible'].includes(c.certitude), `cas ${c.id} : certitude`);
  }
});
