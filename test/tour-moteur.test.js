import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ETAPES, PREMIERE_ETAPE_AIDE } from '../site/js/tour-etapes.js';
import { creerMoteur } from '../site/js/tour-moteur.js';

const tic = () => new Promise((r) => setImmediate(r));
async function jusqua(condition, essais = 200) {
  for (let i = 0; i < essais; i++) {
    if (condition()) return;
    await tic();
  }
  throw new Error('condition jamais atteinte');
}

// Effets factices : notent ce que le moteur demande ; les attentes se résolvent à la main.
function faux({ cibles = null, permission = true, lieu = false, voix = true } = {}) {
  const journal = [];
  const attentes = [];
  let numero = 0;
  let surEnregistrement = null;
  const effets = {
    aller: async (vue) => { journal.push(['aller', vue]); },
    cibleExiste: (c) => (cibles ? cibles.includes(c) : true),
    eclairer: ({ cible, voile, ecran }) => { journal.push(['eclairer', cible, voile, ecran ?? null]); },
    dire: async (cle) => { journal.push(['dire', cle]); numero++; return voix; },
    taire: () => { journal.push(['taire']); },
    permissionAccordee: async () => permission,
    attendre: (type, { depuis, signal }) => new Promise((resoudre) => {
      attentes.push({ type, depuis, resoudre });
      signal?.addEventListener('abort', () => resoudre({ ok: false, code: 'arrete' }));
    }),
    numeroEvenement: () => numero,
    surEnregistrement: (f) => { surEnregistrement = f; return () => { surEnregistrement = null; }; },
    lieuDeja: () => lieu,
    marquerVu: () => { journal.push(['vu']); },
    fermer: () => { journal.push(['fermer']); },
  };
  return {
    effets, journal, attentes,
    enregistrement: () => surEnregistrement?.(),
    evenement: () => { numero++; },
    dits: () => journal.filter(([quoi]) => quoi === 'dire').map(([, cle]) => cle),
  };
}

// Horloge factice : chaque délai attend qu'on l'avance.
function horloge() {
  const enAttente = [];
  return {
    enAttente,
    delai: (ms, signal) => new Promise((ok) => {
      enAttente.push({ ms, ok });
      signal?.addEventListener('abort', () => ok());
    }),
    avancer: () => enAttente.shift()?.ok(),
  };
}

const etapesSimples = [
  { id: 'a', partie: 1, vue: 'accueil', cible: '#x', phrase: 'p_a', attente: null },
  { id: 'b', partie: 2, vue: 'prix', cible: '#micro', phrase: 'p_b', attente: 'appui' },
];

test('déroule les étapes dans l’ordre : vue, projecteur, phrase, attente', async () => {
  const f = faux();
  const h = horloge();
  const fin = creerMoteur({ etapes: etapesSimples, effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  assert.deepEqual(f.journal, [
    ['aller', 'accueil'], ['eclairer', '#x', true, null], ['dire', 'p_a'],
    ['aller', 'prix'], ['eclairer', '#micro', true, null], ['dire', 'p_b'],
  ]);
  assert.equal(f.attentes[0].type, 'appui');
  f.attentes[0].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
  assert.deepEqual(f.journal.slice(-2), [['vu'], ['fermer']]);
});

test('sans geste, la consigne est redite toutes les 10 s, trois fois au plus', async () => {
  const f = faux();
  const h = horloge();
  const fin = creerMoteur({ etapes: [etapesSimples[1]], effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => h.enAttente.length === 1);
  for (let i = 0; i < 3; i++) {
    assert.equal(h.enAttente[0].ms, 10_000);
    h.avancer();
    await jusqua(() => f.dits().length === i + 2);
  }
  await tic();
  assert.equal(h.enAttente.length, 0, 'plus de relance après la troisième');
  assert.deepEqual(f.dits(), ['p_b', 'p_b', 'p_b', 'p_b']);
  f.attentes[0].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});

test('le début de l’enregistrement arrête les relances', async () => {
  const f = faux();
  const h = horloge();
  const etape = { id: 'm', partie: 3, vue: 'prix', cible: '#micro', phrase: 'p_micro', attente: 'reponse', retour: 'm' };
  const fin = creerMoteur({ etapes: [etape], effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => h.enAttente.length === 1);
  f.enregistrement();
  assert.ok(f.journal.some(([quoi]) => quoi === 'taire'), 'la voix du tour se tait');
  h.avancer();
  await tic();
  await tic();
  assert.deepEqual(f.dits(), ['p_micro'], 'aucune relance pendant que l’agriculteur parle');
  f.attentes[0].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});

test('un événement arrivé avant l’attente compte : la lecture se compte depuis la demande', async () => {
  const f = faux();
  const h = horloge();
  const etapes = [
    { id: 'm', partie: 3, vue: 'prix', cible: '#micro', phrase: 'p_micro', attente: 'reponse', retour: 'm' },
    { id: 'l', partie: 3, vue: 'prix', cible: null, phrase: null, attente: 'lecture', voile: false },
  ];
  const fin = creerMoteur({ etapes, effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  const debutDemande = f.attentes[0].depuis;
  f.evenement();
  f.evenement(); // réponse puis fin de lecture, avant que l'étape de lecture n'attende
  f.attentes[0].resoudre({ ok: true });
  await jusqua(() => f.attentes.length === 2);
  assert.equal(f.attentes[1].type, 'lecture');
  assert.equal(f.attentes[1].depuis, debutDemande);
  assert.deepEqual(f.journal.find(([quoi, cible]) => quoi === 'eclairer' && cible === null), ['eclairer', null, false, null]);
  f.attentes[1].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});

test('une demande non comprise fait dire « recommençons » et revient au micro', async () => {
  const f = faux();
  const h = horloge();
  const etape = { id: 'm', partie: 3, vue: 'prix', cible: '#micro', phrase: 'p_micro', attente: 'reponse', retour: 'm' };
  const fin = creerMoteur({ etapes: [etape], effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  f.attentes[0].resoudre({ ok: false, code: 'produit_inconnu' });
  await jusqua(() => f.attentes.length === 2);
  assert.deepEqual(f.dits(), ['p_micro', 'tour_pas_compris', 'p_micro']);
  f.attentes[1].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});

test('hors service : le tour se ferme sans être marqué vu', async () => {
  const f = faux();
  const h = horloge();
  const etape = { id: 'm', partie: 3, vue: 'prix', cible: '#micro', phrase: 'p_micro', attente: 'reponse', retour: 'm' };
  const fin = creerMoteur({ etapes: [etape], effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  f.attentes[0].resoudre({ ok: false, code: 'hors_service' });
  assert.equal(await fin, 'arrete');
  assert.ok(f.journal.some(([quoi]) => quoi === 'fermer'));
  assert.ok(!f.journal.some(([quoi]) => quoi === 'vu'));
  assert.ok(!f.dits().includes('tour_pas_compris'));
});

test('la croix arrête la voix et marque le tour vu', async () => {
  const f = faux();
  const h = horloge();
  const moteur = creerMoteur({ etapes: etapesSimples, effets: f.effets, delai: h.delai });
  const fin = moteur.demarrer();
  await jusqua(() => f.attentes.length === 1);
  moteur.arreter();
  assert.equal(await fin, 'arrete');
  assert.deepEqual(f.journal.slice(-3), [['taire'], ['vu'], ['fermer']]);
  assert.equal(moteur.etape(), null);
});

test('arrivé au bout, le tour est marqué vu', async () => {
  const f = faux();
  const etapes = [{ id: 'a', partie: 1, vue: 'accueil', cible: null, phrase: 'p_a', attente: null }];
  assert.equal(await creerMoteur({ etapes, effets: f.effets, delai: horloge().delai }).demarrer(), 'fini');
  assert.deepEqual(f.journal.slice(-2), [['vu'], ['fermer']]);
});

test('voix indisponible : le tour continue après la bulle', async () => {
  const f = faux({ voix: false });
  const etapes = [
    { id: 'a', partie: 1, vue: 'accueil', cible: null, phrase: 'p_a', attente: null },
    { id: 'z', partie: 5, vue: 'accueil', cible: null, phrase: 'p_z', attente: null },
  ];
  assert.equal(await creerMoteur({ etapes, effets: f.effets, delai: horloge().delai }).demarrer(), 'fini');
  assert.deepEqual(f.dits(), ['p_a', 'p_z']);
});

test('une cible absente fait passer l’étape', async () => {
  const f = faux({ cibles: ['#x'] });
  const etapes = [
    { id: 'a', partie: 1, vue: 'accueil', cible: '#x', phrase: 'p_a', attente: null },
    { id: 'r', partie: 3, vue: 'prix', cible: '#ecouter', phrase: 'p_r', attente: null },
  ];
  assert.equal(await creerMoteur({ etapes, effets: f.effets, delai: horloge().delai }).demarrer(), 'fini');
  assert.deepEqual(f.dits(), ['p_a']);
});

test('lieu déjà donné : l’étape passe après sa phrase', async () => {
  const f = faux({ lieu: true });
  const etapes = [{ id: 'l', partie: 4, vue: 'signalement', cible: '#lieu', phrase: 'p_lieu', attente: 'lieu' }];
  assert.equal(await creerMoteur({ etapes, effets: f.effets, delai: horloge().delai }).demarrer(), 'fini');
  assert.deepEqual(f.dits(), ['p_lieu']);
  assert.equal(f.attentes.length, 0);
});

test('permission déjà accordée : la phrase d’avertissement n’est pas dite', async () => {
  const etapes = [{ id: 'm', partie: 3, vue: 'prix', cible: '#micro', phrase: 'p_micro', attente: null, permission: 'microphone', avant: 'p_permission' }];
  const accordee = faux({ permission: true });
  await creerMoteur({ etapes, effets: accordee.effets, delai: horloge().delai }).demarrer();
  assert.deepEqual(accordee.dits(), ['p_micro']);
  const demandee = faux({ permission: false });
  await creerMoteur({ etapes, effets: demandee.effets, delai: horloge().delai }).demarrer();
  assert.deepEqual(demandee.dits(), ['p_permission', 'p_micro']);
});

test('reprise : la phrase de l’étape en cours est redite', async () => {
  const f = faux();
  const h = horloge();
  const moteur = creerMoteur({ etapes: [etapesSimples[1]], effets: f.effets, delai: h.delai });
  const fin = moteur.demarrer();
  await jusqua(() => f.attentes.length === 1);
  assert.equal(moteur.etape(), 'b');
  moteur.reprendre();
  await tic();
  assert.deepEqual(f.dits(), ['p_b', 'p_b']);
  f.attentes[0].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});

test('relancé par l’aide : commence à 2a, sans l’écran de démarrage', async () => {
  const f = faux();
  const moteur = creerMoteur({ etapes: ETAPES, effets: f.effets, delai: horloge().delai });
  const fin = moteur.demarrer(PREMIERE_ETAPE_AIDE);
  await jusqua(() => f.attentes.length === 1);
  assert.equal(f.dits()[0], 'tour_accueil_prix');
  assert.ok(!f.journal.some(([quoi, , , ecran]) => quoi === 'eclairer' && ecran === 'demarrage'));
  moteur.arreter();
  assert.equal(await fin, 'arrete');
});
