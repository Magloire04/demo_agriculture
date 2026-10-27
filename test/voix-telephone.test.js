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
    // Son refusé par le navigateur : pas d'appui avant la lecture.
    if (globalThis.sonRefuse) return Promise.reject(new DOMException('Lecture refusée', 'NotAllowedError'));
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

test('la nouvelle voix est attendue jusqu’au délai, même après un « pas encore prête »', async (t) => {
  let appels = 0;
  remplacerFetch(t, async () => (++appels < 3
    ? new Response('{"pret":false}', { status: 202, headers: { 'Retry-After': '0.02' } })
    : SON()));
  voix.prechargerPhrase('aaaa000000000004');
  assert.equal(await voix.lireReponse({ phrase: 'aaaa000000000004', extraits: ['c.mp3'] }, { attenteMs: 1000 }), 'nouvelle');
  assert.equal(appels, 3);
});

test('passé le délai, les anciens extraits sont lus', async (t) => {
  remplacerFetch(t, async () => new Response('{"pret":false}', { status: 202, headers: { 'Retry-After': '0.02' } }));
  voix.prechargerPhrase('aaaa000000000005');
  const debut = Date.now();
  assert.equal(await voix.lireReponse({ phrase: 'aaaa000000000005', extraits: ['d.mp3'] }, { attenteMs: 80 }), 'ancienne');
  assert.ok(Date.now() - debut >= 75);
  assert.equal(lectures.at(-1), 'voix/d.mp3');
});

test('le lecteur se débloque par un court silence', () => {
  voix.debloquer();
  assert.match(lectures.at(-1), /^blob:/);
});

test('lecture à la suite : chaque réponse après la fin de la précédente', async () => {
  const journal = [];
  const lire = (nom) => async () => {
    journal.push(`début ${nom}`);
    await voix.lireExtraits([`${nom}.mp3`]);
    journal.push(`fin ${nom}`);
  };
  await voix.lireSuite([lire('accuse'), lire('solutions')]);
  assert.deepEqual(journal, ['début accuse', 'fin accuse', 'début solutions', 'fin solutions']);
});

test('lecture à la suite : un arrêt coupe aussi les réponses suivantes', async () => {
  const lues = [];
  const lire = (nom) => async () => {
    lues.push(nom);
    const lecture = voix.lireExtraits([`${nom}.mp3`]);
    if (nom === 'accuse') voix.arreterLecture();
    await lecture;
  };
  await voix.lireSuite([lire('accuse'), lire('solutions')]);
  assert.deepEqual(lues, ['accuse']);
});

test('lecture à la suite : un son refusé par le navigateur arrête la suite', async (t) => {
  globalThis.sonRefuse = true;
  t.after(() => { globalThis.sonRefuse = false; });
  const lues = [];
  const lire = (nom) => async () => {
    lues.push(nom);
    await voix.lireExtraits([`${nom}.mp3`]);
  };
  await voix.lireSuite([lire('accuse'), lire('solutions')]);
  assert.deepEqual(lues, ['accuse']);
});

test('débloquer pendant une lecture l’arrête : l’extrait suivant ne part pas', async () => {
  const lecture = voix.lireExtraits(['e1.mp3', 'e2.mp3']);
  voix.debloquer();
  await lecture;
  await pause(120);
  assert.ok(!lectures.includes('voix/e2.mp3'), lectures.join(', '));
});

test('un arrêt pendant « Je prépare la voix… » : rien n’est lu, la suite est annulée', async (t) => {
  remplacerFetch(t, async () => new Response('{"pret":false}', { status: 202, headers: { 'Retry-After': '0.02' } }));
  voix.prechargerPhrase('aaaa000000000006');
  const avant = lectures.length;
  const rendus = [];
  const suite = voix.lireSuite([
    async () => { rendus.push(await voix.lireReponse({ phrase: 'aaaa000000000006', extraits: ['f.mp3'] }, { attenteMs: 1000 })); },
    async () => { rendus.push('solutions'); },
  ]);
  await pause(30);
  voix.arreterLecture();
  await suite;
  await pause(50);
  assert.deepEqual(rendus, [null]);
  assert.ok(lectures.slice(avant).every((src) => src.startsWith('blob:')), lectures.slice(avant).join(', '));
});
