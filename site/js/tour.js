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
// Phrases dans l'ordre du tour : chacune précharge les deux suivantes.
const ORDRE = [...new Set(ETAPES.flatMap((e) => [e.avant, e.phrase]).filter(Boolean))];

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
let numero = 0; // compteur des événements de l'application
const derniers = new Map(); // type → { numero, detail }
const abonnes = new Set();
let installe = false;

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
    if (!appuiAutorise(cible, actif, e.target)) {
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
    if (cible?.contains(e.target)) noter('appui', {});
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (!actif) return;
    if (document.hidden) voix?.arreterLecture?.();
    else moteur?.reprendre();
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

  eclairer({ cible: selecteur, voile, ecran, partie }) {
    [...racine.querySelectorAll('.tour-points i')].forEach((point, i) => point.classList.toggle('ici', i + 1 === partie));
    const demarrage = ecran === 'demarrage';
    $('.tour-demarrage').hidden = !demarrage;
    $('.tour-projecteur').hidden = demarrage || !voile;
    montrer($('.tour-main:not(.tour-main-demarrage)'), false);
    cible = selecteur ? document.querySelector(selecteur) : null;
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
      await pause(BULLE_MS);
      bulle.hidden = true;
      return false;
    } finally {
      if (racine) indicateur.hidden = true;
    }
  },

  taire() {
    voix?.arreterLecture?.();
  },

  async permissionAccordee(nom) {
    try {
      return (await navigator.permissions?.query({ name: nom }))?.state === 'granted';
    } catch {
      return false; // permission inconnue du navigateur : la voix prévient quand même
    }
  },

  attendre(type, { depuis, signal }) {
    const attendu = TYPES[type];
    const resultat = (detail) => (type === 'reponse' ? { ok: Boolean(detail?.ok), code: detail?.code ?? null } : { ok: true });
    return new Promise((ok) => {
      const dernier = derniers.get(attendu);
      if (dernier && dernier.numero > depuis) return ok(resultat(dernier.detail));
      const ecouter = (t, n, detail) => {
        if (t !== attendu || n <= depuis) return;
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
    racine?.remove();
    racine = null;
  },
};

// Premier accès ou bouton d'aide (qui commence à l'accueil, son appui ayant débloqué le son).
export async function lancer({ depuisAide = false } = {}) {
  installer();
  voix ??= await import('./voix.js').catch(() => null);
  if (!phrases) {
    try {
      phrases = (await appelerApi('api/tour')).phrases;
    } catch {
      return 'indisponible'; // hors ligne : le tour sera proposé à la prochaine ouverture
    }
  }
  construire();
  actif = true;
  precharger(depuisAide ? ORDRE[1] : ORDRE[0]);
  moteur ??= creerMoteur({ etapes: ETAPES, effets, delai: pause });
  return moteur.demarrer(depuisAide ? PREMIERE_ETAPE_AIDE : ETAPES[0].id);
}

export function lancerSiPremierAcces() {
  return premierAcces() ? lancer() : null;
}
