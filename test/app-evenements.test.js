import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('dom.emettre envoie un événement agrifon: avec son détail', async (t) => {
  const recus = [];
  const avant = globalThis.document;
  globalThis.document = { dispatchEvent: (e) => recus.push(e) };
  t.after(() => { globalThis.document = avant; });
  const { emettre } = await import('../site/js/dom.js');
  emettre('reponse', { vue: 'prix', ok: true });
  assert.equal(recus.length, 1);
  assert.equal(recus[0].type, 'agrifon:reponse');
  assert.deepEqual(recus[0].detail, { vue: 'prix', ok: true });
});

// Le tour (site/js/tour.js) ne connaît l'application que par ces événements.
test('app.js émet chaque événement du tour', () => {
  const app = readFileSync(new URL('../site/js/app.js', import.meta.url), 'utf8');
  for (const type of ['micro', 'reponse', 'lecture-finie', 'lieu']) assert.ok(app.includes(`emettre('${type}'`), type);
  // Chaque échec local du micro est annoncé comme une réponse non comprise.
  for (const code of ['trop_court', 'micro_refuse', 'micro_absent', 'micro_impossible', 'micro_non_disponible']) {
    assert.ok(app.includes(`'${code}'`), code);
  }
});
