import assert from 'node:assert/strict';
import { test } from 'node:test';

// Le lecteur du téléphone (site/js/voix.js) sous Node : `Audio` et `fetch` remplacés.
const lectures = [];
globalThis.Audio = class {
  constructor() {
    this.src = '';
    this.onended = null;
    this.onerror = null;
  }

  play() {
    const src = this.src;
    lectures.push(src);
    setTimeout(() => { if (this.src === src) this.onended?.(); }, 5);
    return Promise.resolve();
  }

  pause() {}
};
const voix = await import('../site/js/voix.js');
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const SON = () => new Response(new Uint8Array(200), { status: 200, headers: { 'Content-Type': 'audio/wav' } });

function remplacerFetch(t, f) {
  const avant = globalThis.fetch;
  globalThis.fetch = f;
  t.after(() => { globalThis.fetch = avant; });
}

test('une phrase abandonnée après une coupure réseau est redemandée à l’affichage suivant', async (t) => {
  const appels = [];
  remplacerFetch(t, async (url) => {
    appels.push(url);
    if (appels.length === 1) throw new TypeError('réseau coupé');
    return SON();
  });
  voix.prechargerPhrase('aaaa000000000001');
  await pause(20);
  voix.prechargerPhrase('aaaa000000000001');
  await pause(20);
  assert.deepEqual(appels, ['api/voix/aaaa000000000001.wav', 'api/voix/aaaa000000000001.wav']);
  assert.equal(await voix.lireReponse({ phrase: 'aaaa000000000001', extraits: ['a.mp3'] }), 'nouvelle');
});

test('une phrase prête ou en route n’est pas redemandée', async (t) => {
  const appels = [];
  remplacerFetch(t, async (url) => {
    appels.push(url);
    return SON();
  });
  voix.prechargerPhrase('aaaa000000000003');
  voix.prechargerPhrase('aaaa000000000003');
  await pause(20);
  voix.prechargerPhrase('aaaa000000000003');
  await pause(20);
  assert.equal(appels.length, 1);
});

test('les nouvelles demandes s’arrêtent quand la réponse a quitté l’écran', async (t) => {
  const appels = [];
  let affichee = true;
  remplacerFetch(t, async (url) => {
    appels.push(url);
    return new Response('{"pret":false}', { status: 202, headers: { 'Retry-After': '0.01' } });
  });
  voix.prechargerPhrase('aaaa000000000002', { actif: () => affichee });
  await pause(40);
  const avant = appels.length;
  assert.ok(avant >= 2, String(avant));
  affichee = false;
  await pause(60);
  assert.ok(appels.length <= avant + 1, `${avant} puis ${appels.length}`);
  assert.equal(await voix.lireReponse({ phrase: 'aaaa000000000002', extraits: ['b.mp3'] }), 'ancienne');
  assert.equal(lectures.at(-1), 'voix/b.mp3');
});
