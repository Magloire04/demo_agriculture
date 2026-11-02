import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appelerApi } from '../site/js/dom.js';

function remplacerFetch(t, f) {
  const avant = globalThis.fetch;
  globalThis.fetch = f;
  t.after(() => { globalThis.fetch = avant; });
}

test('pas de réseau : erreur au code « connexion »', async (t) => {
  remplacerFetch(t, async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(appelerApi('api/etat'), (e) => e.code === 'connexion');
});

test('délai dépassé : erreur au code « delai »', async (t) => {
  remplacerFetch(t, (_url, { signal }) => new Promise((_ok, ko) => signal.addEventListener('abort', () => ko(new DOMException('arrêt', 'AbortError')))));
  await assert.rejects(appelerApi('api/etat', { delaiMs: 10 }), (e) => e.code === 'delai');
});

test('erreur du serveur : son code et son fon', async (t) => {
  remplacerFetch(t, async () => Response.json({ erreur: 'Trop court.', code: 'audio_trop_court', erreur_fon: 'Xó hwe.' }, { status: 422 }));
  await assert.rejects(appelerApi('api/prix'), (e) => e.code === 'audio_trop_court' && e.fon === 'Xó hwe.' && e.statut === 422);
});
