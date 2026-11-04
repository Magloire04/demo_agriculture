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
function faux({ cibles = null, permission = 'granted', lieu = false, voix = true, pendantDire = () => {} } = {}) {
  const journal = [];
  const attentes = [];
  let numero = 0;
  let surEnregistrement = null;
  const etat = { enregistrement: false, cache: false, retour: null };
  const effets = {
    aller: async (vue) => { journal.push(['aller', vue]); },
    cibleExiste: (c) => (cibles ? cibles.includes(c) : true),
    eclairer: ({ cible, voile, ecran, geste }) => { journal.push(['eclairer', cible, voile, ecran ?? null, geste]); },
    dire: async (cle) => { journal.push(['dire', cle]); numero++; pendantDire(cle, etat); return voix; },
    taire: () => { journal.push(['taire']); },
    etatPermission: async () => permission,
    enregistrementEnCours: () => etat.enregistrement,
    estVisible: () => !etat.cache,
    visible: () => (etat.cache ? new Promise((ok) => { etat.retour = ok; }) : Promise.resolve()),
    attendre: (type, { depuis, signal, vue }) => new Promise((resoudre) => {
      attentes.push({ type, depuis, vue, resoudre });
      signal?.addEventListener('abort', () => resoudre({ ok: false, code: 'arrete' }));
    }),
    numeroEvenement: () => numero,
    surEnregistrement: (f) => { surEnregistrement = f; return () => { surEnregistrement = null; }; },
    lieuDeja: () => lieu,
    marquerVu: () => { journal.push(['vu']); },
    fermer: () => { journal.push(['fermer']); },
  };
  return {
    effets, journal, attentes, etat,
    enregistrement: () => { etat.enregistrement = true; surEnregistrement?.(); },
    revenir: () => { etat.cache = false; etat.retour?.(); },
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
    ['aller', 'accueil'], ['eclairer', '#x', true, null, false], ['dire', 'p_a'],
    ['aller', 'prix'], ['eclairer', '#micro', true, null, true], ['dire', 'p_b'],
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
  assert.deepEqual(f.journal.find(([quoi, cible]) => quoi === 'eclairer' && cible === null), ['eclairer', null, false, null, false]);
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
  const accordee = faux({ permission: 'granted' });
  await creerMoteur({ etapes, effets: accordee.effets, delai: horloge().delai }).demarrer();
  assert.deepEqual(accordee.dits(), ['p_micro']);
  const demandee = faux({ permission: 'prompt' });
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

// Relecture finale (C1) : la voix du tour ne couvre jamais l'enregistrement, même quand
// l'agriculteur appuie sur le micro avant la fin de la consigne.
const etapeMicro = {
  id: 'm', partie: 3, vue: 'prix', cible: '#micro', phrase: 'p_micro', attente: 'reponse',
  permission: 'microphone', avant: 'p_permission', retour: 'm', sinon: 'n',
};
const etapeSuivante = { id: 'n', partie: 4, vue: 'signalement', cible: null, phrase: 'p_n', attente: null };

test('appui sur le micro pendant l’avertissement : la consigne n’est pas dite, aucune relance', async () => {
  const f = faux({ permission: 'prompt', pendantDire: (cle, etat) => { if (cle === 'p_permission') etat.enregistrement = true; } });
  const h = horloge();
  const fin = creerMoteur({ etapes: [etapeMicro], effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  h.avancer();
  await tic();
  await tic();
  assert.deepEqual(f.dits(), ['p_permission']);
  f.attentes[0].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});

test('enregistrement commencé avant l’attente : aucune relance ensuite', async () => {
  const f = faux({ pendantDire: (cle, etat) => { if (cle === 'p_micro') etat.enregistrement = true; } });
  const h = horloge();
  const fin = creerMoteur({ etapes: [etapeMicro], effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  for (let i = 0; i < 3; i++) {
    h.avancer();
    await tic();
  }
  assert.deepEqual(f.dits(), ['p_micro']);
  f.attentes[0].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});

test('reprise pendant l’enregistrement : rien n’est dit', async () => {
  const f = faux();
  const moteur = creerMoteur({ etapes: [etapeMicro], effets: f.effets, delai: horloge().delai });
  const fin = moteur.demarrer();
  await jusqua(() => f.attentes.length === 1);
  f.enregistrement();
  moteur.reprendre();
  await tic();
  assert.deepEqual(f.dits(), ['p_micro']);
  moteur.arreter();
  await fin;
});

// I2 : un échec qu'un nouvel essai ne réparera pas fait passer à la partie suivante.
test('micro refusé : pas de « recommençons », le tour passe à la partie suivante', async () => {
  const f = faux();
  const fin = creerMoteur({ etapes: [etapeMicro, etapeSuivante], effets: f.effets, delai: horloge().delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  f.attentes[0].resoudre({ ok: false, code: 'micro_refuse' });
  assert.equal(await fin, 'fini');
  assert.deepEqual(f.dits(), ['p_micro', 'p_n']);
});

test('deux échecs de suite : le tour passe à la partie suivante', async () => {
  const f = faux();
  const fin = creerMoteur({ etapes: [etapeMicro, etapeSuivante], effets: f.effets, delai: horloge().delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  f.attentes[0].resoudre({ ok: false, code: 'non_compris' });
  await jusqua(() => f.attentes.length === 2);
  f.attentes[1].resoudre({ ok: false, code: 'non_compris' });
  assert.equal(await fin, 'fini');
  assert.deepEqual(f.dits(), ['p_micro', 'tour_pas_compris', 'p_micro', 'p_n']);
});

test('permission refusée : l’avertissement n’est pas dit', async () => {
  const etape = { ...etapeMicro, attente: null };
  const f = faux({ permission: 'denied' });
  await creerMoteur({ etapes: [etape], effets: f.effets, delai: horloge().delai }).demarrer();
  assert.deepEqual(f.dits(), ['p_micro']);
});

// I3 : page cachée (écran éteint, autre application) : le tour attend son retour.
test('page cachée pendant une phrase : le tour attend le retour, redit la phrase puis continue', async () => {
  const f = faux({ pendantDire: (cle, etat) => { if (cle === 'p_a' && !etat.vu) { etat.vu = true; etat.cache = true; } } });
  const etapes = [
    { id: 'a', partie: 1, vue: 'accueil', cible: null, phrase: 'p_a', attente: null },
    { id: 'b', partie: 2, vue: 'accueil', cible: null, phrase: 'p_b', attente: null },
  ];
  const fin = creerMoteur({ etapes, effets: f.effets, delai: horloge().delai }).demarrer();
  await jusqua(() => f.etat.retour !== null);
  await tic();
  assert.deepEqual(f.dits(), ['p_a'], 'rien n’est dit tant que la page est cachée');
  f.revenir();
  assert.equal(await fin, 'fini');
  assert.deepEqual(f.dits(), ['p_a', 'p_a', 'p_b']);
});

// M2 relevée : une étape sans geste n'ouvre pas sa cible aux appuis.
test('seules les étapes qui attendent un geste ouvrent leur cible aux appuis', async () => {
  const f = faux();
  const h = horloge();
  const fin = creerMoteur({ etapes: etapesSimples, effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  const gestes = f.journal.filter(([quoi]) => quoi === 'eclairer').map((e) => e[4]);
  assert.deepEqual(gestes, [false, true]);
  f.attentes[0].resoudre({ ok: true });
  await fin;
});

// M3 : une lecture qui ne finit jamais (son bloqué) ne retient pas le tour sans fin.
test('l’attente de la lecture a une limite : passé 4 minutes, le tour continue', async () => {
  const f = faux();
  const h = horloge();
  const etapes = [
    { id: 'l', partie: 3, vue: 'prix', cible: null, phrase: null, attente: 'lecture', voile: false },
    { id: 'z', partie: 5, vue: 'prix', cible: null, phrase: 'p_z', attente: null },
  ];
  const fin = creerMoteur({ etapes, effets: f.effets, delai: h.delai }).demarrer();
  await jusqua(() => h.enAttente.length === 1);
  assert.equal(h.enAttente[0].ms, 240_000);
  h.avancer();
  assert.equal(await fin, 'fini');
  assert.deepEqual(f.dits(), ['p_z']);
});

// M4 : la réponse attendue est celle de l'écran de l'étape.
test('l’attente d’une réponse ou d’une lecture nomme l’écran de l’étape', async () => {
  const f = faux();
  const etapes = [
    { id: 'm', partie: 3, vue: 'prix', cible: '#micro', phrase: 'p_micro', attente: 'reponse', retour: 'm' },
    { id: 'l', partie: 3, vue: 'prix', cible: null, phrase: null, attente: 'lecture', voile: false },
  ];
  const fin = creerMoteur({ etapes, effets: f.effets, delai: horloge().delai }).demarrer();
  await jusqua(() => f.attentes.length === 1);
  assert.equal(f.attentes[0].vue, 'prix');
  f.attentes[0].resoudre({ ok: true });
  await jusqua(() => f.attentes.length === 2);
  assert.equal(f.attentes[1].vue, 'prix');
  f.attentes[1].resoudre({ ok: true });
  assert.equal(await fin, 'fini');
});
