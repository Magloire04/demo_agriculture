// Back office d'AgriFon. L'écran relève le tableau de bord et les derniers appels
// toutes les 5 secondes. Ces relèves ne prolongent pas la session : seul un clic,
// une frappe ou un défilement de l'administrateur le fait (en-tête X-Activite).
import { el, nombre, svg } from './dom.js';

const RELEVE_MS = 5000;
const FUSEAU = 'Africa/Porto-Novo';
const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (selecteur, racine = document) => racine.querySelector(selecteur);
const $$ = (selecteur, racine = document) => [...racine.querySelectorAll(selecteur)];

const ICONES = {
  compris: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  non_compris: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01"/>',
  erreur: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5h.01"/>',
};
const ERREURS = {
  audio_trop_court: 'Audio trop court', audio_trop_long: 'Audio trop long', audio_illisible: 'Audio illisible',
  service_sature: 'Service saturé', hors_service: 'Site hors service', erreur_interne: 'Erreur du serveur',
};
const MOTIFS = [
  ['robot', 'Robots'], ['autre_site', 'Autre site'], ['origine', 'Origine'], ['trop_de_demandes', 'Demandes en trop'],
  ['service_sature', 'Service saturé'], ['code_conseiller', 'Code conseiller faux'], ['mot_de_passe_admin', 'Mot de passe faux'],
];

/* ---------- formats ---------- */

const heureCourte = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU });
const jourHeure = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: FUSEAU });
const jourDe = (iso) => new Date(iso).toLocaleDateString('fr-CA', { timeZone: FUSEAU }); // AAAA-MM-JJ
const quand = (iso) => (jourDe(iso) === jourDe(new Date().toISOString()) ? heureCourte(iso) : `le ${jourHeure(iso)}`);
const jourLong = (jour, options = { day: 'numeric', month: 'long', year: 'numeric' }) => new Date(`${jour}T12:00:00Z`).toLocaleDateString('fr-FR', { ...options, timeZone: 'UTC' });
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const secondes = (ms) => `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;
const pluriel = (n, un, plusieurs) => `${nombre(n)} ${n > 1 ? plusieurs : un}`;

function duree(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function taille(octets) {
  if (octets < 1_000_000) return `${nombre(Math.round(octets / 1000))} Ko`;
  return `${(octets / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

function periode({ du, au }) {
  const [a1, m1] = du.split('-');
  const [a2, m2] = au.split('-');
  if (a1 === a2 && m1 === m2) return `Du ${Number(du.slice(8))} au ${jourLong(au)}`;
  return `Du ${jourLong(du, a1 === a2 ? { day: 'numeric', month: 'long' } : undefined)} au ${jourLong(au)}`;
}

/* ---------- appels au serveur ---------- */

let activite = false;
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  addEventListener(type, () => { activite = true; }, { passive: true });
}

async function api(chemin, { methode = 'GET', corps, action = false, delaiMs = 30_000 } = {}) {
  const entetes = {};
  if (activite || action) {
    entetes['X-Activite'] = '1';
    activite = false;
  }
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';
  let reponse;
  try {
    reponse = await fetch(chemin, {
      method: methode, headers: entetes, credentials: 'same-origin',
      body: corps === undefined ? undefined : JSON.stringify(corps), signal: AbortSignal.timeout(delaiMs),
    });
  } catch {
    throw Object.assign(new Error('Le serveur ne répond pas. Vérifiez la connexion.'), { statut: 0 });
  }
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    if (reponse.status === 401 && chemin !== 'api/admin/connexion') sessionTerminee();
    throw Object.assign(new Error(donnees.erreur || `Erreur du serveur (${reponse.status}).`), { statut: reponse.status, code: donnees.code });
  }
  return donnees;
}

/* ---------- l'onde du site ---------- */

function creerOnde(canvas) {
  const ctx = canvas.getContext('2d');
  const PAS = 5; // barres de 3 px espacées de 2 px
  let echantillons = [];
  let cible = 1;
  let ampli = 1;
  let rafale = 0;
  let t = 0;
  let revele = 1;
  let debut = 0;
  let dernier = 0;
  let attente = 0;
  let animation = 0;

  function taille() {
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.ceil(r.width / PAS) + 1;
    while (echantillons.length < n) echantillons.unshift(0.3);
    echantillons = echantillons.slice(-n);
    if (reduit) dessiner();
  }

  // Hauteur brute d'une barre ; l'amplitude du site s'applique au dessin, à toutes
  // les barres à la fois, pour que toute l'onde s'aplatisse quand le site est coupé.
  function suivant() {
    t += 0.06;
    const souffle = 0.28 + 0.12 * Math.sin(t) + 0.08 * Math.sin(t * 2.7 + 1) + 0.08 * Math.random();
    const v = souffle + rafale * (0.45 + 0.55 * Math.random());
    rafale *= 0.86;
    return Math.min(1, v);
  }

  // Du vert (en service) au rouge (coupé), selon l'amplitude.
  function couleur() {
    const k = Math.max(0, Math.min(1, ampli));
    const melange = (a, b) => Math.round(a + (b - a) * k);
    return `rgb(${melange(195, 0)}, ${melange(38, 104)}, ${melange(27, 40)})`;
  }

  function dessiner() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = couleur();
    const visibles = w * (1 - (1 - revele) ** 3);
    echantillons.forEach((s, i) => {
      const x = i * PAS;
      if (x > visibles) return;
      const hb = Math.max(2, s * ampli * (h - 12));
      ctx.beginPath();
      ctx.roundRect(x, (h - hb) / 2, 3, hb, 1.5);
      ctx.fill();
    });
  }

  // Tout se règle sur le temps écoulé, pas sur le nombre d'images : l'onde
  // défile et retombe à la même vitesse sur un téléphone lent ou un onglet ralenti.
  function image(maintenant) {
    const ecoule = Math.min(2000, maintenant - (dernier || maintenant));
    dernier = maintenant;
    ampli += (cible - ampli) * (1 - Math.exp(-ecoule / 450)); // ligne plate en 1,5 s environ
    attente += ecoule;
    while (attente >= 33) { // une barre nouvelle toutes les 33 ms
      attente -= 33;
      echantillons.push(suivant());
      echantillons.shift();
    }
    revele = Math.min(1, (maintenant - debut) / 1300);
    dessiner();
    animation = requestAnimationFrame(image);
  }

  new ResizeObserver(taille).observe(canvas);

  return {
    demarrer() {
      cancelAnimationFrame(animation);
      if (reduit) {
        echantillons = echantillons.map(() => 0.22 + 0.1 * Math.random());
        revele = 1;
        dessiner();
        return;
      }
      revele = 0;
      debut = performance.now();
      dernier = 0;
      animation = requestAnimationFrame(image);
    },
    arreter: () => cancelAnimationFrame(animation),
    reprendre() {
      if (reduit) return;
      cancelAnimationFrame(animation);
      dernier = 0; // pas de rattrapage du temps passé en arrière-plan
      animation = requestAnimationFrame(image);
    },
    pic() {
      if (cible > 0) rafale = 0.9;
    },
    couper(coupe) {
      cible = coupe ? 0 : 1;
      if (reduit) {
        ampli = cible;
        dessiner();
      }
    },
  };
}

/* ---------- vues ---------- */

const vueConnexion = $('[data-vue="connexion"]');
const vueBo = $('[data-vue="bo"]');
const champMdp = $('#mot-de-passe');
const messageConnexion = $('[data-message]');
const bande = $('[data-bande]');
const libelle = $('[data-libelle]');
const depuis = $('[data-depuis]');
const basculer = $('[data-basculer]');
const confirmer = $('[data-confirmer]');
const onde = creerOnde($('[data-onde]'));

let minuterie = 0;
let siteCoupe = false;
let premierAffichage = true;
let dernierAppel = null;
let charge = false; // une relève a abouti depuis la connexion
let rubrique = 'tableau';

function montrerConnexion(message = '') {
  clearInterval(minuterie);
  onde.arreter();
  vueBo.hidden = true;
  vueConnexion.hidden = false;
  messageConnexion.textContent = message;
  champMdp.value = '';
  champMdp.focus();
}

function sessionTerminee() {
  if (!vueBo.hidden) montrerConnexion('Session terminée après 10 minutes sans activité. Reconnectez-vous.');
}

$('[data-connexion]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bouton = $('button[type=submit]', e.currentTarget);
  bouton.disabled = true;
  messageConnexion.textContent = '';
  try {
    await api('api/admin/connexion', { methode: 'POST', corps: { mot_de_passe: champMdp.value }, action: true });
    champMdp.value = '';
    await demarrerBo();
  } catch (erreur) {
    messageConnexion.textContent = erreur.code === 'mot_de_passe' ? 'Mot de passe incorrect.' : erreur.message;
  } finally {
    bouton.disabled = false;
  }
});

/* ---------- bande : état du site et coupure ---------- */

function afficherSite(site) {
  siteCoupe = site.hors_service;
  bande.dataset.etat = siteCoupe ? 'coupe' : 'service';
  libelle.textContent = siteCoupe ? 'Hors service' : 'En service';
  depuis.textContent = site.depuis ? `depuis ${quand(site.depuis)}${siteCoupe ? ', les téléphones voient la page d’attente' : ''}` : '';
  basculer.textContent = siteCoupe ? 'Remettre en service' : 'Mettre hors service';
  basculer.className = `bouton ${siteCoupe ? 'bouton-relancer' : 'bouton-couper'}`;
  onde.couper(siteCoupe);
}

// Fermée, la confirmation est inerte : ses boutons ne se prennent pas au clavier.
function fermerConfirmation() {
  confirmer.removeAttribute('data-ouvert');
  confirmer.inert = true;
}

basculer.addEventListener('click', async () => {
  if (!siteCoupe) {
    if (confirmer.hasAttribute('data-ouvert')) return fermerConfirmation();
    confirmer.setAttribute('data-ouvert', '');
    confirmer.inert = false;
    return $('[data-couper]').focus();
  }
  try {
    afficherSite((await api('api/admin/hors-service', { methode: 'POST', corps: { actif: false }, action: true })).site);
  } catch (erreur) {
    depuis.textContent = erreur.message;
  }
});

$('[data-annuler]').addEventListener('click', () => {
  fermerConfirmation();
  basculer.focus();
});

$('[data-couper]').addEventListener('click', async () => {
  fermerConfirmation();
  try {
    afficherSite((await api('api/admin/hors-service', { methode: 'POST', corps: { actif: true }, action: true })).site);
  } catch (erreur) {
    depuis.textContent = erreur.message;
  }
  basculer.focus();
});

/* ---------- rubriques ---------- */

function ouvrirRubrique(nom) {
  rubrique = nom;
  for (const b of $$('[data-rubrique]')) {
    if (b.dataset.rubrique === nom) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const s of $$('[data-section]')) s.hidden = s.dataset.section !== nom;
  if (nom === 'journal') chargerJournal();
  if (nom === 'refus') chargerRefus();
  if (nom === 'services') chargerServices();
  if (nom === 'reglages') chargerReglages();
}

for (const b of $$('[data-rubrique]')) b.addEventListener('click', () => ouvrirRubrique(b.dataset.rubrique));

$('[data-deconnexion]').addEventListener('click', async () => {
  try {
    await api('api/admin/deconnexion', { methode: 'POST', action: true });
  } finally {
    montrerConnexion('Vous êtes déconnecté.');
  }
});

/* ---------- tableau de bord ---------- */

// Les chiffres montent de 0 à leur valeur une seule fois, après le dessin de l'onde.
function poserChiffres(valeurs) {
  const cases = Object.entries(valeurs).map(([cle, v]) => [$(`[data-chiffre="${cle}"]`), v, cle === 'comprises' ? ' %' : '']);
  const ecrire = (k) => cases.forEach(([n, v, suffixe]) => { n.textContent = `${nombre(Math.round(k * v))}${suffixe}`; });
  if (!premierAffichage || reduit) return ecrire(1);
  premierAffichage = false;
  ecrire(0);
  setTimeout(() => {
    const t0 = performance.now();
    const tour = (m) => {
      const p = Math.min(1, (m - t0) / 900);
      ecrire(1 - (1 - p) ** 3);
      if (p < 1) requestAnimationFrame(tour);
    };
    requestAnimationFrame(tour);
  }, 1300);
}

function montrerBulle(conteneur, b) {
  const bulle = $('.bulle', conteneur);
  const r = b.getBoundingClientRect();
  const g = conteneur.getBoundingClientRect();
  bulle.textContent = b.getAttribute('aria-label');
  bulle.style.left = `${r.left - g.left + r.width / 2}px`;
  bulle.style.top = `${r.top - g.top}px`;
  bulle.dataset.barre = b.dataset.i;
  bulle.setAttribute('data-visible', '');
}

// Les barres sont créées une fois, puis mises à jour à chaque relève : le focus
// du clavier et la bulle ouverte restent en place, et la bulle suit sa barre.
function graphe(conteneur, points, axe) {
  const max = Math.max(1, ...points.map((p) => p.valeur));
  let barres = $('.graphe-barres', conteneur);
  if (barres?.children.length !== points.length) {
    barres = el('div', { class: 'graphe-barres' });
    const bulle = el('div', { class: 'bulle' });
    const cacher = () => bulle.removeAttribute('data-visible');
    points.forEach((_, i) => {
      const b = el('button', { type: 'button', 'data-i': String(i) });
      const montrer = () => montrerBulle(conteneur, b);
      b.addEventListener('mouseenter', montrer);
      b.addEventListener('focus', montrer);
      b.addEventListener('mouseleave', cacher);
      b.addEventListener('blur', cacher);
      b.addEventListener('transitionend', () => {
        if (bulle.hasAttribute('data-visible') && bulle.dataset.barre === b.dataset.i) montrer();
      });
      barres.append(b);
    });
    conteneur.replaceChildren(barres, el('div', { class: 'graphe-axe' }), bulle);
  }
  points.forEach((p, i) => {
    const b = barres.children[i];
    b.classList.toggle('vide', !p.valeur);
    b.setAttribute('aria-label', p.texte);
    b.style.height = `${Math.max(2, (p.valeur / max) * 100)}%`;
  });
  $('.graphe-axe', conteneur).replaceChildren(...axe.map((a) => el('span', {}, a)));
  const bulle = $('.bulle', conteneur);
  if (bulle.hasAttribute('data-visible')) montrerBulle(conteneur, barres.children[Number(bulle.dataset.barre)]);
}

function classement(liste, elements) {
  if (!elements.length) return liste.replaceChildren(el('li', { class: 'vide-texte' }, 'Aucune donnée sur la période.'));
  const max = elements[0].n;
  liste.replaceChildren(...elements.map(({ nom, n }) => {
    const barre = el('i');
    barre.style.width = `${(n / max) * 100}%`;
    return el('li', {}, el('span', {}, nom), el('b', {}, nombre(n)), el('span', { class: 'jauge' }, barre));
  }));
}

function afficherTableau({ site, statistiques: s }) {
  afficherSite(site);
  const { comprises, non_comprises: nonComprises, erreurs } = s.demandes;
  const vues = comprises + nonComprises;
  poserChiffres({ personnes: s.personnes.total, comprises: vues ? Math.round((100 * comprises) / vues) : 0, pris: s.signalements.pris });
  $('[data-sur]').textContent = ` / ${nombre(s.signalements.total)}`;
  $('[data-sous="personnes"]').textContent = !s.personnes.total ? 'aucune personne sur la période'
    : s.personnes.revenues ? `dont ${pluriel(s.personnes.revenues, 'revenue', 'revenues')} un autre jour`
      : 'aucune encore revenue un autre jour';
  $('[data-sous="comprises"]').textContent = (vues ? `${nombre(comprises)} demandes vocales sur ${nombre(vues)}` : 'aucune demande vocale')
    + (erreurs ? `, ${pluriel(erreurs, 'autre en erreur', 'autres en erreur')}` : '');
  $('[data-sous="pris"]').textContent = s.signalements.delai_moyen_ms !== null
    ? `en ${duree(s.signalements.delai_moyen_ms)} en moyenne`
    : s.signalements.total ? 'aucun encore pris en charge' : 'aucun signalement sur la période';
  $('[data-periode]').textContent = periode(s.periode);

  const jours = s.parJour;
  graphe($('[data-graphe="jours"]'), jours.map(({ jour, personnes }) => ({
    valeur: personnes,
    texte: `${majuscule(jourLong(jour, { weekday: 'long', day: 'numeric', month: 'long' }))} : ${pluriel(personnes, 'personne', 'personnes')}`,
  })), [jourLong(jours[0].jour, { day: 'numeric', month: 'short' }), jourLong(jours.at(-1).jour, { day: 'numeric', month: 'short' })]);
  graphe($('[data-graphe="heures"]'), s.heures.map((n, h) => ({ valeur: n, texte: `${h} h : ${pluriel(n, 'demande', 'demandes')}` })),
    ['0 h', '6 h', '12 h', '18 h', '23 h']);
  classement($('[data-classement="produits"]'), s.produits);
  classement($('[data-classement="marches"]'), s.marches);
  classement($('[data-classement="communes"]'), s.communes);
}

/* ---------- appels ---------- */

function resume(a) {
  const r = a.reconnu;
  if (!r) return '';
  if (a.service === 'prix') return [r.produits?.join(', ') || 'aucun produit reconnu', r.marche].filter(Boolean).join(', ');
  return [r.culture, r.symptomes?.join(' et '), r.commune].filter(Boolean).join(', ') || 'rien de reconnu';
}

function libelleResultat(a) {
  if (a.resultat === 'compris') return 'Compris';
  if (a.resultat === 'non_compris') return 'Non compris';
  return a.code?.startsWith('asr_') ? 'Erreur de l’API' : ERREURS[a.code] ?? 'Erreur';
}

// Petite onde de l'appel : sa longueur suit la durée de l'audio ; ses hauteurs
// sont tirées de la date, pour qu'une même ligne garde toujours la même forme.
function petiteOnde(a, nouveau) {
  const n = Math.max(4, Math.min(14, Math.round((a.duree_audio_s ?? 3) * 2)));
  let graine = [...a.date].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);
  const onde = el('span', { class: 'mini', 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    graine = (graine * 17 + 11) % 9973;
    const barre = el('i');
    barre.style.height = `${6 + (graine % 19)}px`;
    if (nouveau) barre.style.animationDelay = `${i * 30}ms`;
    onde.append(barre);
  }
  return onde;
}

function ligneAppel(a, { nouveau = false, detail = false } = {}) {
  const service = a.service === 'prix' ? 'Prix' : 'Signalement';
  const morceaux = [`${service}, ${resume(a)}`, detail ? jourHeure(a.date) : heureCourte(a.date)];
  if (a.duree_api_ms !== null) morceaux.push(`réponse de l’API en ${secondes(a.duree_api_ms)}`);
  if (detail) {
    morceaux.push(`${secondes(a.duree_ms)} en tout`);
    if (a.duree_audio_s !== null) morceaux.push(`${secondes(a.duree_audio_s * 1000)} d’audio`);
    if (a.reference) morceaux.push(a.reference);
  }
  return el('li', { class: nouveau ? 'nouveau' : null },
    petiteOnde(a, nouveau),
    el('div', {},
      el('p', { class: 'fon', lang: 'fon' }, a.transcription || 'Rien n’a été entendu.'),
      el('small', {}, morceaux.join(', '))),
    el('span', { class: `resultat resultat-${a.resultat}` }, svg(ICONES[a.resultat] ?? ICONES.erreur), libelleResultat(a)));
}

function afficherDerniers(appels) {
  const liste = $('[data-appels="derniers"]');
  dernierAppel = appels[0]?.ecrit_le ?? dernierAppel;
  if (!appels.length) return liste.replaceChildren(el('li', { class: 'vide-texte' }, 'Aucun appel pour le moment.'));
  liste.replaceChildren(...appels.slice(0, 5).map((a) => ligneAppel(a)));
}

function ajouterAppels(nouveaux) {
  if (!nouveaux.length) return;
  dernierAppel = nouveaux[0].ecrit_le;
  const derniers = $('[data-appels="derniers"]');
  const journal = $('[data-appels="journal"]');
  const journalOuvert = !$('[data-section="journal"]').hidden;
  $('.vide-texte', derniers)?.remove();
  if (journalOuvert) $('.vide-texte', journal)?.remove();
  [...nouveaux].reverse().forEach((a, i) => {
    derniers.prepend(ligneAppel(a, { nouveau: !reduit }));
    if (journalOuvert) journal.prepend(ligneAppel(a, { nouveau: !reduit, detail: true }));
    setTimeout(() => onde.pic(), i * 350); // chaque appel se voit dans l'onde
  });
  while (derniers.children.length > 5) derniers.lastElementChild.remove();
}

// Le journal se lit par pages de 50, de la plus récente à la plus ancienne ;
// le bouton ramène la page précédente tant qu'il en reste.
const PAGE_JOURNAL = 50;
let plusAncien = null;
const boutonPlus = $('[data-plus]');
const messageJournal = $('[data-message-journal]');

function poserPage(appels, { suite = false } = {}) {
  const liste = $('[data-appels="journal"]');
  const lignes = appels.map((a) => ligneAppel(a, { detail: true }));
  if (suite) liste.append(...lignes);
  else liste.replaceChildren(...(lignes.length ? lignes : [el('li', { class: 'vide-texte' }, 'Aucun appel pour le moment.')]));
  if (appels.length) plusAncien = appels.at(-1).ecrit_le;
  boutonPlus.hidden = appels.length < PAGE_JOURNAL;
}

async function chargerJournal() {
  boutonPlus.hidden = true;
  messageJournal.textContent = '';
  try {
    poserPage((await api('api/admin/appels')).appels);
  } catch (erreur) {
    $('[data-appels="journal"]').replaceChildren(el('li', { class: 'vide-texte' }, erreur.message));
  }
}

boutonPlus.addEventListener('click', async () => {
  boutonPlus.disabled = true;
  messageJournal.textContent = '';
  try {
    poserPage((await api(`api/admin/appels?avant=${encodeURIComponent(plusAncien)}`, { action: true })).appels, { suite: true });
    if (boutonPlus.hidden) messageJournal.textContent = 'C’est le début du journal.';
  } catch (erreur) {
    messageJournal.textContent = erreur.message;
  } finally {
    boutonPlus.disabled = false;
  }
});

/* ---------- refus, services, réglages ---------- */

async function chargerRefus() {
  const table = $('[data-refus]');
  try {
    const { refus } = await api('api/admin/refus?jours=14');
    const tete = el('thead', {}, el('tr', {}, el('th', {}, 'Jour'), MOTIFS.map(([, l]) => el('th', {}, l)), el('th', {}, 'Total')));
    const corps = el('tbody', {}, refus.map(({ jour, motifs }) => {
      const total = MOTIFS.reduce((s, [m]) => s + (motifs[m] ?? 0), 0);
      return el('tr', {},
        el('td', {}, majuscule(jourLong(jour, { weekday: 'short', day: 'numeric', month: 'short' }))),
        MOTIFS.map(([m]) => el('td', { class: motifs[m] ? null : 'zero' }, nombre(motifs[m] ?? 0))),
        el('td', { class: total ? null : 'zero' }, el('b', {}, nombre(total))));
    }));
    table.replaceChildren(tete, corps);
  } catch (erreur) {
    table.replaceChildren(el('caption', {}, erreur.message));
  }
}

async function chargerServices(action = false) {
  const liste = $('[data-services]');
  try {
    const s = await api('api/admin/services', { action });
    const ligne = (titre, ...valeur) => [el('dt', {}, titre), el('dd', {}, ...valeur)];
    liste.replaceChildren(
      ...ligne('API JaimeMaLangue',
        el('span', { class: s.api.ok ? 'etat-ok' : 'etat-ko' }, s.api.ok ? 'Répond' : 'Ne répond pas'),
        s.api.ok ? `, en ${secondes(s.api.duree_ms)}${s.api.modele ? `, modèle ${s.api.modele}` : ''}` : ''),
      ...ligne('Prix du PAM', s.prix.importe_le
        ? `importés le ${jourHeure(s.prix.importe_le)}, relevé le plus récent du ${jourLong(s.prix.derniere_date)}`
        : 'pas encore importés'),
      ...ligne('Messages vocaux', `${pluriel(s.stockage.messages_vocaux, 'message', 'messages')}, ${taille(s.stockage.octets)}`),
      ...ligne('Version en ligne', `code ${s.version.commit ?? 'inconnu'}, démarré le ${jourHeure(s.version.demarre_le)}`),
    );
  } catch (erreur) {
    liste.replaceChildren(el('dt', {}, erreur.message));
  }
}

$('[data-verifier]').addEventListener('click', () => chargerServices(true));

$('[data-importer]').addEventListener('click', async (e) => {
  const bouton = e.currentTarget;
  const message = $('[data-message-services]');
  bouton.disabled = true;
  message.textContent = 'Import des prix en cours, cela peut prendre quelques minutes…';
  try {
    const r = await api('api/admin/prix/importer', { methode: 'POST', corps: {}, action: true, delaiMs: 400_000 });
    message.textContent = r.message;
    await chargerServices();
  } catch (erreur) {
    message.textContent = erreur.message;
  } finally {
    bouton.disabled = false;
  }
});

async function chargerReglages() {
  const coupures = $('[data-coupures]');
  try {
    const r = await api('api/admin/reglages');
    $('[data-brouillon]').checked = r.solutions_brouillon;
    const lignes = [...r.coupures].reverse().map((c) => el('li', {}, c.fin
      ? `Du ${jourHeure(c.debut)} au ${jourHeure(c.fin)}, ${duree(Date.parse(c.fin) - Date.parse(c.debut))}`
      : `Depuis le ${jourHeure(c.debut)}, en cours`));
    coupures.replaceChildren(...(lignes.length ? lignes : [el('li', { class: 'vide-texte' }, 'Aucune coupure.')]));
  } catch (erreur) {
    coupures.replaceChildren(el('li', { class: 'vide-texte' }, erreur.message));
  }
}

$('[data-brouillon]').addEventListener('change', async (e) => {
  const caseACocher = e.currentTarget;
  try {
    const r = await api('api/admin/solutions-brouillon', { methode: 'POST', corps: { actif: caseACocher.checked }, action: true });
    caseACocher.checked = r.solutions_brouillon;
  } catch {
    caseACocher.checked = !caseACocher.checked;
  }
});

/* ---------- démarrage et relève ---------- */

const etatReleve = $('[data-etat-releve]');

// Tant qu'aucune relève n'a abouti, les derniers appels sont posés en entier ;
// ensuite, seuls les nouveaux s'y ajoutent. Une relève qui échoue le dit et la
// suivante réessaie ; une session terminée ramène à la connexion.
async function relever({ action = false } = {}) {
  if (document.hidden || vueBo.hidden) return;
  try {
    const apres = charge && dernierAppel ? `?apres=${encodeURIComponent(dernierAppel)}` : '';
    const [tableau, { appels }] = await Promise.all([api('api/admin/tableau', { action }), api(`api/admin/appels${apres}`)]);
    afficherTableau(tableau);
    if (charge) ajouterAppels(appels);
    else afficherDerniers(appels);
    charge = true;
    etatReleve.textContent = '';
  } catch (erreur) {
    if (erreur.statut !== 401) etatReleve.textContent = `${erreur.message} Nouvel essai dans 5 secondes.`;
  }
}

async function demarrerBo() {
  vueConnexion.hidden = true;
  vueBo.hidden = false;
  premierAffichage = true;
  dernierAppel = null;
  charge = false;
  etatReleve.textContent = '';
  ouvrirRubrique(rubrique);
  onde.demarrer();
  clearInterval(minuterie);
  minuterie = setInterval(relever, RELEVE_MS);
  await relever({ action: true });
}

document.addEventListener('visibilitychange', () => {
  if (vueBo.hidden) return;
  if (document.hidden) return onde.arreter();
  onde.reprendre();
  relever();
});

api('api/admin/session').then(demarrerBo, () => montrerConnexion());
