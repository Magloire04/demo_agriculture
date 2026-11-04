import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ETAPES, PARTIES, PREMIERE_ETAPE_AIDE } from '../site/js/tour-etapes.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const phrasesDuTour = () => JSON.parse(lire('data/tour.json')).phrases;

test('chaque phrase des étapes existe dans data/tour.json, et chaque phrase du tour sert', () => {
  const phrases = phrasesDuTour();
  const citees = new Set(['tour_pas_compris']);
  for (const e of ETAPES) {
    for (const cle of [e.phrase, e.avant].filter(Boolean)) {
      assert.ok(phrases[cle], `${e.id} : phrase inconnue ${cle}`);
      citees.add(cle);
    }
  }
  assert.deepEqual([...citees].sort(), Object.keys(phrases).sort());
});

// Une cible de la page se retrouve par son attribut data-… ou son href ; celles des
// réponses sont des classes que app.js crée. [data-aide] et [data-tour-demarrer]
// viennent avec l'habillage du tour (tâche 5), qui a ses propres tests.
test('les cibles fixes existent dans la page, les cibles des réponses sont créées par app.js', () => {
  const page = lire('site/index.html');
  const app = lire('site/js/app.js');
  for (const { id, cible } of ETAPES.filter((e) => e.cible)) {
    if (cible.includes('[data-resultat=')) {
      const classe = cible.match(/\.([a-z-]+)$/)[1];
      assert.ok(new RegExp(`class: '[^']*\\b${classe}\\b`).test(app), `${id} : .${classe} absente de app.js`);
      continue;
    }
    if (['[data-aide]', '[data-tour-demarrer]'].includes(cible)) continue;
    const href = cible.match(/href="([^"]+)"/)?.[1];
    const attributs = [...cible.matchAll(/\[(data-[a-z-]+)(?:=([a-z]+))?\]/g)];
    if (href) assert.ok(page.includes(`href="${href}"`), `${id} : ${cible}`);
    for (const [, nom, valeur] of attributs) {
      assert.ok(page.includes(valeur ? `${nom}="${valeur}"` : nom), `${id} : ${cible}`);
    }
    assert.ok(href || attributs.length, `${id} : cible sans attribut ni lien (${cible})`);
  }
});

test('ordre et parties : 1 à 5, sans recul ; l’aide commence à 2a', () => {
  assert.equal(PARTIES, 5);
  assert.deepEqual(ETAPES.map((e) => e.id), ['1', '1b', '2a', '2b', '3a', '3b', '3c', '3d', '3e', '4a', '4b', '4c', '4d', '4e', '5']);
  ETAPES.reduce((avant, e) => {
    assert.ok(e.partie >= avant && e.partie <= PARTIES, `${e.id} : partie ${e.partie}`);
    return e.partie;
  }, 1);
  assert.equal(PREMIERE_ETAPE_AIDE, '2a');
  assert.ok(ETAPES.some((e) => e.id === PREMIERE_ETAPE_AIDE));
  for (const e of ETAPES.filter((x) => x.attente === 'reponse')) assert.equal(e.retour, e.id);
  // Un échec sans issue (micro refusé…) fait passer à la partie suivante.
  assert.deepEqual(ETAPES.filter((x) => x.attente === 'reponse').map((e) => [e.id, e.sinon]), [['3b', '4a'], ['4c', '5']]);
  assert.equal(ETAPES[0].ecran, 'demarrage');
  for (const e of ETAPES.filter((x) => x.attente === 'lecture')) assert.equal(e.voile, false);
});
