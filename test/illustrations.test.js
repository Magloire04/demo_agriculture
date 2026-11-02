import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const solutions = JSON.parse(readFileSync(new URL('../data/solutions.json', import.meta.url), 'utf8'));
const DOSSIER = new URL('../site/img/conseils/', import.meta.url);

// Les séries de la spec (docs/superpowers/specs/2026-11-02-agrifon-100-fon-design.md) et
// leurs conseils : gestes par identifiant, traitements par identifiant de cas.
const SERIES = {
  'jus-ail': { traitements: ['amarante-chenilles', 'gboma-chenilles'] },
  'neem-feuilles': { traitements: ['niebe-foreurs-gousses'] },
  'neem-amande': { traitements: ['coton-pucerons'] },
  spinosad: { traitements: ['tomate-helicoverpa'] },
  'couper-bruler': { gestes: ['retirer-bruler', 'retirer-pourri', 'plantain-effeuiller'] },
  'arracher-sortir': { gestes: ['tomate-arracher-sortir', 'tomate-arracher-viroses'] },
  'arracher-bruler-enterrer': { gestes: ['manioc-arracher-bruler-tot'] },
  'plantain-enfouir-replanter': { gestes: ['plantain-arracher-enfouir'] },
  'outils-javel': { gestes: ['manioc-outils-javel'] },
  'tri-semences': { gestes: ['riz-tri-semences'] },
  'igname-cicatriser': { gestes: ['igname-cure'] },
  rigoles: { gestes: ['drainer'] },
  'pieges-jaunes': { gestes: ['pieges-jaunes'] },
  'ecartement-plantain': { gestes: ['plantain-ecartement'] },
  'ecraser-cornet': { gestes: ['mais-cla-cornet', 'coton-ecraser-chenilles-cornet'] },
  'striga-arracher': { gestes: ['arracher-striga', 'striga-arrachage-collectif'] },
  'observer-montrer': { gestes: ['observer-collet', 'observer-dessous'] },
};

const citees = () => new Set([
  ...Object.values(solutions.gestes).map((g) => g.illustration),
  ...solutions.cas.map((c) => c.traitement?.illustration),
].filter(Boolean));

test('chaque conseil de la spec porte sa série, et rien d’autre n’est illustré', () => {
  for (const [serie, { gestes = [], traitements = [] }] of Object.entries(SERIES)) {
    for (const id of gestes) assert.equal(solutions.gestes[id]?.illustration, serie, `geste ${id}`);
    for (const id of traitements) assert.equal(solutions.cas.find((c) => c.id === id)?.traitement?.illustration, serie, `traitement ${id}`);
  }
  assert.deepEqual([...citees()].sort(), Object.keys(SERIES).sort());
});

test('chaque illustration citée a son fichier, chaque fichier est cité', () => {
  for (const serie of citees()) assert.ok(existsSync(new URL(`${serie}.svg`, DOSSIER)), `fichier manquant : site/img/conseils/${serie}.svg`);
  const fichiers = existsSync(DOSSIER) ? readdirSync(DOSSIER).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)) : [];
  assert.deepEqual(fichiers.filter((f) => !citees().has(f)), []);
});

test('une image ne contient que des chiffres et des unités, jamais de mot', () => {
  const permis = /^[0-9 ,.–×+\-/]*(kg|L|h|m²|m|g|%)?$/;
  for (const serie of citees()) {
    const fichier = new URL(`${serie}.svg`, DOSSIER);
    if (!existsSync(fichier)) continue; // signalé par le test précédent
    const svg = readFileSync(fichier, 'utf8');
    for (const [, texte] of svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)) assert.match(texte.trim(), permis, `${serie} : « ${texte} »`);
    assert.ok(!/<(script|foreignObject)\b/i.test(svg), `${serie} : élément interdit`);
  }
});
