// Tour de présentation (docs/superpowers/specs/2026-11-04-agrifon-tour-presentation-design.md) :
// une voix en fon montre chaque bouton sous un projecteur, une main fait le geste, et
// l'agriculteur le refait lui-même, avec de vraies demandes. Ce module fournit les
// effets du moteur (site/js/tour-moteur.js) : écran de démarrage, projecteur, main,
// haut-parleur, croix, points, bulle de secours, blocage des appuis hors de la cible.
// Il suit l'application par ses événements « agrifon:… » (site/js/dom.js, emettre).

import { appelerApi, ecrireMemoire, el, lireMemoire, svg } from './dom.js';
import { T } from './textes.js';
import { ETAPES, PARTIES, PREMIERE_ETAPE_AIDE } from './tour-etapes.js';
import { creerMoteur } from './tour-moteur.js';

const CLE_MEMOIRE = 'agrifon.tour';
const BULLE_MS = 5000; // voix indisponible : le fon reste affiché ce temps-là
const MARGE = 10; // autour de l'élément éclairé, en pixels
const MAIN = '<path d="M22 6c0-3.3 2.7-6 6-6s6 2.7 6 6v26c1-1.2 2.6-2 4.3-2 3 0 5.4 2.2 5.7 5 1-.9 2.4-1.4 3.9-1.4 3.2 0 5.8 2.5 6 5.6 .9-.5 1.9-.8 3-.8 3.3 0 6 2.7 6 6V62c0 12-9.8 22-22 22h-6C21 84 13 79 9.5 71L2 54c-1.4-3.2 0-6.9 3.1-8.3 2.9-1.3 6.3-.3 8 2.3L22 60z"/>';
const HAUT_PARLEUR = '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none"/>';
const LECTURE = '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>';
const TYPES = { appui: 'appui', reponse: 'reponse', lecture: 'lecture-finie', lieu: 'lieu' };
// Phrases dans l'ordre du tour : chacune précharge les deux suivantes. « Recommençons »
// suit le micro, où une demande peut échouer.
export const ORDRE = [...new Set(ETAPES.flatMap((e) => [e.avant, e.phrase, e.attente === 'reponse' ? 'tour_pas_compris' : null]).filter(Boolean))];

// La réponse ou la lecture d'un autre écran (une demande lancée avant une relance par
// l'aide) ne fait pas passer l'étape.
export function pourCetEcran(type, detail, vue) {
  if (type === 'reponse') return !detail?.vue || detail.vue === vue;
  if (type === 'lecture-finie') return !detail?.zone || detail.zone === vue;
  return true;
}

// Sans aucune voix (synthèse coupée), le tour du premier accès n'est pas lancé : des
// bulles de texte ne servent à rien à qui ne lit pas. L'aide le relance quand même.
export function voixDisponibles(phrasesDuTour) {
  return Object.values(phrasesDuTour ?? {}).some((p) => p.voix_phrase);
}

export function premierAcces(memoire = lireMemoire) {
  return memoire(CLE_MEMOIRE) !== 'vu';
}

// Pendant le tour, seuls la croix et l'élément éclairé répondent ; sans cible (l'écran
// est rendu à l'application qui lit sa réponse), seule la croix.
export function appuiAutorise(cible, tourActif, element) {
  if (!tourActif) return true;
  if (element?.closest?.('[data-tour-fermer]')) return true;
  return Boolean(cible && cible.contains(element));
}

// Geste « retour » pendant le tour : la vue de l’étape est remise, sauf si le tour vient
// de demander lui-même ce changement (appui sur une carte ou sur l’onglet).
export function vueACorriger({ vueEtape, vueActuelle, navigationAttendue }) {
  if (!vueEtape || navigationAttendue || vueEtape === vueActuelle) return null;
  return vueEtape;
}

const vueActuelle = () => location.hash.replace(/^#\/?/, '') || 'accueil';
const adresseVue = (vue) => (vue === 'accueil' ? '#/' : `#/${vue}`);

// Deux rectangles (getBoundingClientRect) qui se recouvrent ; bord contre bord ne compte pas.
export function chevauche(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

let voix = null;
let phrases = null;
let moteur = null;
let actif = false;
let racine = null;
let cible = null; // élément sous le projecteur
let cibleCliquable = null; // la cible, quand l’étape attend un geste dessus
let navigationAttendue = false; // l’appui demandé va changer d’écran
let veille = null; // écran gardé allumé pendant le tour
const attentesVisibles = new Set();
let numero = 0; // compteur des événements de l'application
const derniers = new Map(); // type → { numero, detail }
const abonnes = new Set();
let installe = false;
let generation = 0; // change à chaque lancement : un ancien minuteur ne touche plus à rien

const $ = (selecteur) => racine?.querySelector(selecteur);
// La propriété hidden n'existe pas sur un élément SVG (la main) : son style, si.
const montrer = (element, oui) => { element.style.display = oui ? '' : 'none'; };
const pause = (ms, signal) => new Promise((ok) => {
  const minuterie = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(minuterie); ok(); });
});

function noter(type, detail) {
  numero += 1;
  derniers.set(type, { numero, detail });
  for (const f of [...abonnes]) f(type, numero, detail);
}

// Écouteurs posés une fois : événements de l'application, appuis, retour dans l'application.
function installer() {
  if (installe) return;
  installe = true;
  for (const type of Object.values(TYPES).filter((t) => t !== 'appui')) {
    document.addEventListener(`agrifon:${type}`, (e) => noter(type, e.detail));
  }
  document.addEventListener('agrifon:micro', (e) => noter('micro', e.detail));
  document.addEventListener('click', (e) => {
    if (!actif) return;
    if (!appuiAutorise(cibleCliquable, actif, e.target)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('[data-tour-fermer]')) {
      moteur?.arreter();
      return;
    }
    // L'appui sur le gros bouton autorise le son : la voix du tour pourra parler.
    if (e.target.closest('[data-tour-demarrer]')) voix?.debloquer?.();
    if (cibleCliquable?.contains(e.target)) {
      navigationAttendue = true;
      setTimeout(() => { navigationAttendue = false; }, 1500);
      noter('appui', {});
    }
  }, true);
  // Une liste déroulante s'ouvre à l'appui, avant le clic : bloquée aussi hors cible.
  document.addEventListener('pointerdown', (e) => {
    if (actif && !appuiAutorise(cibleCliquable, actif, e.target)) e.preventDefault();
  }, true);
  window.addEventListener('hashchange', () => {
    if (!actif) return;
    const etape = ETAPES.find((e) => e.id === moteur?.etape());
    const vue = vueACorriger({ vueEtape: etape?.vue ?? null, vueActuelle: vueActuelle(), navigationAttendue });
    if (vue) location.hash = adresseVue(vue);
    for (const ms of [100, 400]) setTimeout(placer, ms);
  });
  document.addEventListener('visibilitychange', () => {
    if (!actif) return;
    if (document.hidden) {
      voix?.arreterLecture?.();
      return;
    }
    garderEcranAllume();
    for (const ok of [...attentesVisibles]) ok();
    attentesVisibles.clear();
    moteur?.reprendre();
  });
  window.addEventListener('resize', placer);
  window.addEventListener('scroll', placer, true);
}

function construire() {
  if (racine) return;
  const main = () => svg(MAIN, '0 0 64 84'); // un nouvel élément à chaque appel
  const mainCible = main();
  mainCible.classList.add('tour-main');
  const mainDemarrage = main();
  mainDemarrage.classList.add('tour-main', 'tour-main-demarrage');
  racine = el('div', { class: 'tour', 'data-tour': '' },
    el('div', { class: 'tour-demarrage', hidden: true },
      el('span', { class: 'tour-logo', 'aria-hidden': 'true' }, 'AgriFon'),
      el('div', { class: 'tour-demarrage-cible' },
        el('button', { class: 'tour-demarrer', type: 'button', 'data-tour-demarrer': '', 'aria-label': T.ecouter }, svg(LECTURE)),
        mainDemarrage)),
    el('div', { class: 'tour-projecteur', hidden: true }),
    mainCible,
    el('div', { class: 'tour-voix', hidden: true, 'aria-hidden': 'true' },
      svg(HAUT_PARLEUR), el('span', { class: 'tour-barres' }, el('i'), el('i'), el('i'), el('i'))),
    el('button', { class: 'tour-fermer', type: 'button', 'data-tour-fermer': '', 'aria-label': T.arreter }, '✕'),
    el('div', { class: 'tour-points', 'aria-hidden': 'true' }, Array.from({ length: PARTIES }, () => el('i'))),
    el('p', { class: 'tour-bulle', lang: 'fon', role: 'status', hidden: true }));
  montrer(mainCible, false);
  $('.tour-bulle').classList.add('fon'); // police du fon
  document.body.append(racine);
}

// Projecteur et main sur l'élément éclairé, recalculés au défilement.
function placer() {
  if (!actif || !racine) return;
  const projecteur = $('.tour-projecteur');
  const main = $('.tour-main:not(.tour-main-demarrage)');
  if (projecteur.hidden) return;
  if (!cible) {
    // Phrase sans bouton à montrer : tout l'écran sous le voile.
    Object.assign(projecteur.style, { left: '50%', top: '50%', width: '0px', height: '0px', borderRadius: '0' });
    montrer(main, false);
    return;
  }
  const r = cible.getBoundingClientRect();
  // La croix ne doit pas cacher l'élément montré (le bouton d'aide, en haut à droite).
  const croix = $('.tour-fermer');
  croix.classList.remove('tour-fermer-gauche');
  if (chevauche(croix.getBoundingClientRect(), r)) croix.classList.add('tour-fermer-gauche');
  const rond = cible.matches('.bouton-micro, [data-aide]');
  Object.assign(projecteur.style, {
    left: `${r.left - MARGE}px`, top: `${r.top - MARGE}px`,
    width: `${r.width + 2 * MARGE}px`, height: `${r.height + 2 * MARGE}px`,
    borderRadius: rond ? '50%' : '14px',
  });
  // Le bout de l'index (44 % de la largeur de la main) touche le centre de l'élément.
  montrer(main, true);
  Object.assign(main.style, { left: `${r.left + r.width / 2 - 0.44 * main.getBoundingClientRect().width}px`, top: `${r.top + r.height / 2}px` });
}

function precharger(cle) {
  const id = phrases?.[cle]?.voix_phrase;
  if (id) voix?.prechargerPhrase?.(id, { actif: () => actif });
}

const effets = {
  async aller(vue) {
    if (!vue) return;
    const actuelle = location.hash.replace(/^#\/?/, '') || 'accueil';
    if (actuelle === vue) return;
    await new Promise((ok) => {
      window.addEventListener('hashchange', () => setTimeout(ok, 50), { once: true });
      setTimeout(ok, 400);
      location.hash = vue === 'accueil' ? '#/' : `#/${vue}`;
    });
  },

  cibleExiste(selecteur) {
    const e = document.querySelector(selecteur);
    return Boolean(e) && (Boolean(e.closest('[data-tour]')) || !e.closest('[hidden]'));
  },

  eclairer({ cible: selecteur, voile, ecran, partie, geste }) {
    [...racine.querySelectorAll('.tour-points i')].forEach((point, i) => point.classList.toggle('ici', i + 1 === partie));
    const demarrage = ecran === 'demarrage';
    $('.tour-demarrage').hidden = !demarrage;
    $('.tour-projecteur').hidden = demarrage || !voile;
    montrer($('.tour-main:not(.tour-main-demarrage)'), false);
    cible = selecteur ? document.querySelector(selecteur) : null;
    // « Appuyez ici » sans attendre l’appui (réécouter, autre question) : l’élément est
    // montré mais ne répond pas, sinon la phrase suivante couperait ce qu’il lance.
    cibleCliquable = geste ? cible : null;
    if (cible && !demarrage) cible.scrollIntoView({ block: 'center', behavior: 'smooth' });
    placer();
    // Le défilement doux dure un moment : le projecteur le suit.
    for (const ms of [120, 300, 600]) setTimeout(placer, ms);
  },

  async dire(cle) {
    const phrase = phrases?.[cle];
    const rang = ORDRE.indexOf(cle);
    for (const suivante of ORDRE.slice(rang + 1, rang + 3)) precharger(suivante);
    const indicateur = $('.tour-voix');
    indicateur.hidden = false;
    try {
      if (!phrase?.voix_phrase || typeof voix?.lireReponse !== 'function') throw new Error('voix_absente');
      precharger(cle);
      const jouee = await voix.lireReponse({ phrase: phrase.voix_phrase }, { attenteMs: voix.ATTENTE_AUTO_MS });
      return jouee !== null;
    } catch {
      if (!actif) return false;
      // Secours rare : le fon s'affiche, la main continue.
      const bulle = $('.tour-bulle');
      indicateur.hidden = true; // pas de voix : pas de haut-parleur
      bulle.textContent = phrase?.fon ?? '';
      bulle.hidden = false;
      const lancement = generation;
      await pause(BULLE_MS);
      if (lancement === generation && racine) bulle.hidden = true;
      return false;
    } finally {
      if (racine) indicateur.hidden = true;
    }
  },

  taire() {
    voix?.arreterLecture?.();
  },

  async etatPermission(nom) {
    try {
      return (await navigator.permissions?.query({ name: nom }))?.state ?? null;
    } catch {
      return null; // permission inconnue du navigateur : la voix prévient quand même
    }
  },

  enregistrementEnCours: () => Boolean(document.querySelector('[data-micro][data-etat="enregistrement"], [data-micro][data-etat="analyse"]')),

  estVisible: () => !document.hidden,

  visible: () => (document.hidden ? new Promise((ok) => attentesVisibles.add(ok)) : Promise.resolve()),

  attendre(type, { depuis, signal, vue }) {
    const attendu = TYPES[type];
    const compte = (n, detail) => n > depuis && pourCetEcran(attendu, detail, vue);
    const resultat = (detail) => (type === 'reponse' ? { ok: Boolean(detail?.ok), code: detail?.code ?? null } : { ok: true });
    return new Promise((ok) => {
      const dernier = derniers.get(attendu);
      if (dernier && compte(dernier.numero, dernier.detail)) return ok(resultat(dernier.detail));
      const ecouter = (t, n, detail) => {
        if (t !== attendu || !compte(n, detail)) return;
        abonnes.delete(ecouter);
        ok(resultat(detail));
      };
      abonnes.add(ecouter);
      signal?.addEventListener('abort', () => {
        abonnes.delete(ecouter);
        ok({ ok: false, code: 'arrete' });
      });
    });
  },

  numeroEvenement: () => numero,

  surEnregistrement(rappel) {
    const ecouter = (t, _n, detail) => { if (t === 'micro' && detail?.etat === 'enregistrement') rappel(); };
    abonnes.add(ecouter);
    return () => abonnes.delete(ecouter);
  },

  lieuDeja() {
    return document.querySelector('[data-gps-etat]')?.hasAttribute('data-ok')
      || Boolean(document.querySelector('[data-commune]')?.value);
  },

  marquerVu() {
    ecrireMemoire(CLE_MEMOIRE, 'vu');
  },

  fermer() {
    actif = false;
    cible = null;
    cibleCliquable = null;
    veille?.release?.().catch(() => {});
    veille = null;
    racine?.remove();
    racine = null;
  },
};

// Écran gardé allumé pendant le tour : les téléphones s’éteignent souvent au bout de 30 s
// sans appui, plus tôt que la réponse à une vraie demande. Refusé ou absent : sans gravité.
function garderEcranAllume() {
  if (!actif || veille || !navigator.wakeLock?.request) return;
  navigator.wakeLock.request('screen').then((v) => {
    veille = v;
    v.addEventListener?.('release', () => { if (veille === v) veille = null; });
  }).catch(() => {});
}

// Premier accès ou bouton d'aide (qui commence à l'accueil, son appui ayant débloqué le son).
async function chargerPhrases() {
  if (phrases) return true;
  try {
    phrases = (await appelerApi('api/tour')).phrases;
    return true;
  } catch {
    return false; // hors ligne : le tour sera proposé à la prochaine ouverture
  }
}

export async function lancer({ depuisAide = false } = {}) {
  installer();
  voix ??= await import('./voix.js').catch(() => null);
  if (!(await chargerPhrases())) return 'indisponible';
  generation += 1;
  construire();
  actif = true;
  garderEcranAllume();
  // Qui a trouvé l'aide connaît le tour : il ne revient pas de lui-même à l'ouverture.
  if (depuisAide) effets.marquerVu();
  precharger(depuisAide ? ORDRE[1] : ORDRE[0]);
  moteur ??= creerMoteur({ etapes: ETAPES, effets, delai: pause });
  try {
    return await moteur.demarrer(depuisAide ? PREMIERE_ETAPE_AIDE : ETAPES[0].id);
  } catch {
    effets.fermer(); // jamais de page bloquée par un tour en erreur
    return 'arrete';
  }
}

export async function lancerSiPremierAcces() {
  if (!premierAcces()) return null;
  installer();
  if (!(await chargerPhrases()) || !voixDisponibles(phrases)) return null;
  return lancer();
}
