import { appelerApi, ecrireMemoire, el, enregistrerServiceWorker, heure, lireMemoire, nombre, svg } from './dom.js';
import { demarrerEnregistrement, enregistrementPossible } from './enregistreur.js';
import { T } from './textes.js';

const DUREE_MAX = 30; // secondes ; l'API accepte jusqu'à 60 s
const DELAI_API = 100_000; // l'API demande de prévoir au moins 90 s
const VUES = ['accueil', 'prix', 'signalement'];
const ICONE_COCHE = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const ICONE_ECOUTER = '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';

const $ = (selecteur, racine = document) => racine.querySelector(selecteur);

// Lecture à voix haute, chargée à part : si le module manque, le reste de
// l'application fonctionne et les boutons « Écouter » ne s'affichent pas.
let voix = null;
import('./voix.js').then((m) => { voix = m; }).catch(() => {});
const arreterLecture = () => voix?.arreterLecture();
const principal = $('main');

/* ---------- Navigation entre les vues ---------- */

const micros = [];
let premiereVue = true;

function afficherVue() {
  const demande = location.hash.replace(/^#\/?/, '');
  const vue = VUES.includes(demande) ? demande : 'accueil';
  micros.forEach((m) => m.annuler());
  arreterLecture();
  for (const section of document.querySelectorAll('[data-vue]')) section.hidden = section.dataset.vue !== vue;
  for (const lien of document.querySelectorAll('[data-lien]')) {
    if (lien.dataset.lien === vue) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');
  }
  if (vue === 'signalement') entrerSignalement();
  if (!premiereVue) {
    window.scrollTo(0, 0);
    principal.focus({ preventScroll: true });
  }
  premiereVue = false;
}

$('.evitement').addEventListener('click', (e) => {
  e.preventDefault();
  principal.focus();
});

/* ---------- État du serveur ---------- */

// Identifiant anonyme tiré au hasard et gardé sur le téléphone. Il ne dit rien
// de la personne : il sert seulement à compter les personnes et leurs retours.
function nouvelIdentifiant() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const o = crypto.getRandomValues(new Uint8Array(16));
  o[6] = (o[6] & 0x0f) | 0x40; // version 4
  o[8] = (o[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = [...o].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function identifiantVisiteur() {
  // localStorage d'abord ; à défaut, la session ; à défaut, la page seulement.
  for (const stockage of ['localStorage', 'sessionStorage']) {
    try {
      const memoire = window[stockage];
      const connu = memoire.getItem('agrifon.visiteur');
      if (connu) return connu;
      const id = nouvelIdentifiant();
      memoire.setItem('agrifon.visiteur', id);
      return id;
    } catch {
      // stockage indisponible (navigation privée...) : on essaie le suivant
    }
  }
  return nouvelIdentifiant();
}

async function verifierServeur() {
  const bandeau = $('[data-bandeau]');
  try {
    const { asr, hors_service: horsService } = await appelerApi('api/etat', { headers: { 'X-Visiteur': identifiantVisiteur() } });
    // Site coupé depuis le back office : le serveur sert la page d'attente à la place de l'accueil.
    if (horsService) {
      location.reload();
      return;
    }
    if (asr.simulation) {
      bandeau.textContent = 'Mode simulation : les réponses sont factices, aucune requête n’est envoyée à la reconnaissance vocale.'; // français admis (jamais en ligne)
      bandeau.hidden = false;
    } else if (!asr.configure) {
      bandeau.textContent = 'Reconnaissance vocale non configurée sur le serveur (identifiants manquants).'; // français admis (jamais en ligne)
      bandeau.classList.add('bandeau-erreur');
      bandeau.hidden = false;
    }
  } catch {
    // hors ligne : chaque action affichera son propre message
  }
}

/* ---------- Micro ---------- */

const TYPES_PAR_EXTENSION = {
  webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4',
  aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
};

function typeAudio(fichier) {
  if (fichier.type) return fichier.type;
  const extension = fichier.name?.split('.').pop()?.toLowerCase();
  return TYPES_PAR_EXTENSION[extension] ?? 'application/octet-stream';
}

function envoyerAudio(chemin, audio) {
  return appelerApi(chemin, {
    method: 'POST',
    headers: { 'Content-Type': typeAudio(audio) },
    body: audio,
    delaiMs: DELAI_API,
  });
}

function minutes(secondes) {
  const s = Math.floor(secondes);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Branche un bloc micro : appui pour parler, appui pour terminer, puis `traiter(audio)`.
function brancherMicro(racine, { traiter, afficherErreur }) {
  const bouton = $('.bouton-micro', racine);
  const etat = $('.micro-etat', racine);
  const minuteur = $('.micro-minuteur', racine);
  const fichier = $('input[type=file]', racine);
  let session = null;

  function changer(nom, texte, libelleBouton) {
    racine.dataset.etat = nom;
    etat.textContent = texte;
    bouton.setAttribute('aria-label', libelleBouton);
    bouton.setAttribute('aria-pressed', String(nom === 'enregistrement'));
  }

  function pret(texte = T.micro_pret) {
    changer('pret', texte, T.micro_pret);
    minuteur.textContent = '';
    bouton.style.setProperty('--niveau', 0);
  }

  async function analyser(audio) {
    changer('analyse', T.micro_analyse, T.micro_analyse);
    minuteur.textContent = '';
    const lent = setTimeout(() => {
      etat.textContent = T.micro_lent;
    }, 10_000);
    try {
      await traiter(audio);
      pret(T.micro_encore);
    } catch (e) {
      afficherErreur(e);
      pret(T.micro_reessayer);
    } finally {
      clearTimeout(lent);
    }
  }

  bouton.addEventListener('click', async () => {
    arreterLecture(); // le micro ne doit pas enregistrer la réponse lue à voix haute
    // Cet appui autorise le son : la réponse sera lue dès son arrivée, sans autre appui.
    voix?.debloquer?.();
    if (racine.dataset.etat === 'analyse') return;
    if (session) {
      session.arreter();
      return;
    }
    if (racine.dataset.etat === 'enregistrement') return; // autorisation du micro en attente
    if (!enregistrementPossible()) {
      pret(T.micro_non_disponible); // navigateur sans enregistrement, ou adresse non sécurisée
      return;
    }
    try {
      changer('enregistrement', T.micro_autoriser, T.micro_terminer);
      session = await demarrerEnregistrement({
        dureeMax: DUREE_MAX,
        surProgression: ({ secondes, niveau }) => {
          minuteur.textContent = `${minutes(secondes)} / ${minutes(DUREE_MAX)}`;
          bouton.style.setProperty('--niveau', niveau.toFixed(2));
        },
      });
      etat.textContent = T.micro_ecoute;
      const { blob, duree } = await session.fin;
      session = null;
      if (duree < 1 || blob.size === 0) {
        pret(T.erreur_trop_court);
        return;
      }
      await analyser(blob);
    } catch (e) {
      session = null;
      if (e?.name === 'AbortError') return pret();
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return pret(T.micro_refuse);
      if (e?.name === 'NotFoundError') return pret(T.micro_absent);
      pret(T.micro_impossible);
    }
  });

  fichier.addEventListener('click', () => {
    arreterLecture(); // et les réponses qui devaient suivre
    voix?.debloquer?.();
  });
  fichier.addEventListener('change', () => {
    arreterLecture();
    const choisi = fichier.files?.[0];
    fichier.value = '';
    if (choisi && racine.dataset.etat === 'pret') analyser(choisi);
  });

  const micro = {
    annuler() {
      session?.annuler();
      session = null;
    },
  };
  micros.push(micro);
  return micro;
}

function montrerResultat(zone, ...contenu) {
  arreterLecture();
  zone.replaceChildren(...contenu.flat().filter(Boolean));
  zone.hidden = false;
  zone.focus({ preventScroll: true });
  zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
  lireDesLArrivee(zone);
}

// Bloc de lecture à l'écran → son lancement, pour lire la réponse dès son arrivée.
const lancements = new WeakMap();

// Lit les réponses affichées l'une après l'autre, sans appui : l'appui sur le micro a
// débloqué le lecteur. Pas si la vue a changé pendant l'analyse ni si l'application
// est passée en arrière-plan. Un voix.js plus ancien (cache) ne sait pas le faire.
function lireDesLArrivee(zone) {
  if (typeof voix?.lireSuite !== 'function' || zone.closest('[data-vue]')?.hidden || document.hidden) return;
  const lectures = [...zone.querySelectorAll('.lecture')]
    .map((bloc) => lancements.get(bloc))
    .filter(Boolean)
    .map((lancer) => () => lancer({ attenteMs: voix.ATTENTE_AUTO_MS }));
  voix.lireSuite(lectures);
}

// Texte en fon seul : le français reste dans l'API pour l'écran du conseiller.
function texteFon(fon) {
  return el('div', { class: 'bilingue' }, el('p', { class: 'texte-fon fon', lang: 'fon' }, fon || T.erreur_reessayer));
}

// Fon suivi du français : seulement pour les solutions, jusqu'à leur passage en fon seul.
function bilingue({ fr, fon }, classeFrancaisSeul = '') {
  if (!fon) return el('p', { class: classeFrancaisSeul || null, lang: 'fr' }, fr);
  return el('div', { class: 'bilingue' },
    el('p', { class: 'texte-fon fon', lang: 'fon' }, fon),
    el('p', { class: 'texte-fr', lang: 'fr' }, fr));
}

// `lire(etiquette, options)` peut changer le libellé du bouton pendant qu'il travaille.
// `lancer(options)` démarre la lecture sans appui ; il rejette si elle échoue.
function boutonLecture(libelle, lire) {
  const texte = el('span', {}, libelle);
  const bouton = el('button', { type: 'button', class: 'bouton-secondaire bouton-ecouter' }, svg(ICONE_ECOUTER), texte);
  async function lancer(options = {}) {
    bouton.classList.add('en-cours');
    texte.textContent = T.arreter;
    try {
      await lire((t) => { texte.textContent = t; }, options);
      texte.textContent = T.reecouter;
    } catch (e) {
      // Son refusé faute d'appui (fichier envoyé depuis un iPhone) : l'utilisateur appuiera.
      texte.textContent = e?.name === 'NotAllowedError' ? libelle : T.lecture_impossible;
      throw e;
    } finally {
      bouton.classList.remove('en-cours');
    }
  }
  bouton.addEventListener('click', () => {
    const enCours = bouton.classList.contains('en-cours');
    arreterLecture(); // y compris les réponses qui devaient suivre
    if (!enCours) lancer().catch(() => {});
  });
  return { bouton, lancer };
}

// Crédits des voix de synthèse, exigés par leur licence : des noms, pas de phrase.
const MENTION_JML = 'JML · OmniVoice · CC BY-NC 4.0';
const MENTION_FONGLAB = 'FongLab · CC BY-NC 4.0';

// Lecture de la réponse en fongbé, dès son arrivée puis au bouton : la phrase entière
// (`phrase`, demandée dès l'affichage) si elle est prête, sinon les extraits audio
// s'ils existent tous. Un voix.js plus ancien, resté dans le cache du téléphone, ne
// sait dire que les extraits.
function lecture(extraits, phrase = null) {
  const entiere = Boolean(phrase && typeof voix?.lireReponse === 'function');
  if (!voix || (!extraits && !entiere)) return null;
  const mention = el('p', { class: 'lecture-mention' }, entiere ? MENTION_JML : MENTION_FONGLAB);
  // La mention nomme la voix qui joue, dès le début de la lecture.
  const lire = entiere
    ? (etiquette, { attenteMs } = {}) => voix.lireReponse({ phrase, extraits }, {
      attenteMs,
      surAttente: () => etiquette(T.voix_preparation),
      surLecture: (jouee) => {
        etiquette(T.arreter);
        mention.textContent = jouee === 'nouvelle' ? MENTION_JML : MENTION_FONGLAB;
      },
    })
    : () => voix.lireExtraits(extraits);
  const { bouton, lancer } = boutonLecture(T.ecouter, lire);
  const bloc = el('div', { class: 'lecture' }, bouton, mention);
  lancements.set(bloc, lancer);
  // Plus de nouvelle demande du son une fois la réponse retirée de l'écran.
  if (entiere) voix.prechargerPhrase(phrase, { actif: () => bloc.isConnected });
  return bloc;
}

// Message fon d'une erreur, d'après son code : jamais le message français du serveur.
const ERREURS = {
  audio_trop_court: 'erreur_trop_court',
  audio_trop_long: 'erreur_trop_long',
  audio_illisible: 'erreur_illisible',
  service_sature: 'erreur_sature',
  trop_de_demandes: 'erreur_sature',
  hors_service: 'hors_service',
  connexion: 'erreur_connexion',
};

function messageErreur(e) {
  const cle = ERREURS[e?.code];
  return (cle && T[cle]) || e?.fon || T.erreur_reessayer;
}

function erreurDans(zone) {
  return (e) => montrerResultat(zone, el('div', { class: 'message-erreur', role: 'alert' }, texteFon(messageErreur(e))));
}

function phraseDite(texte) {
  if (!texte) return null;
  return el('p', { class: 'phrase-dite' }, `${T.vous_avez_dit} : `, el('span', { class: 'fon', lang: 'fon' }, `« ${texte} »`));
}

function boutonRecommencer(libelle, micro) {
  return el('button', {
    class: 'bouton-principal',
    type: 'button',
    onclick: () => {
      const bouton = $('.bouton-micro', micro);
      micro.scrollIntoView({ behavior: 'smooth', block: 'center' });
      bouton.focus({ preventScroll: true });
    },
  }, libelle);
}

/* ---------- Prix du marché ---------- */

const zonePrix = $('[data-resultat=prix]');
const microPrix = $('[data-micro=prix]');

function nomMarche(marche) {
  return marche.nom === marche.ville ? marche.nom : `${marche.nom} (${marche.ville})`;
}

// Mois d'un relevé en chiffres (09/2026) : se lit en fon comme en français.
function moisChiffres(jour) {
  const [annee, moisNum] = jour.split('-');
  return `${moisNum}/${annee}`;
}

// Nom du produit : son nom fon (tous les produits en ont un).
const nomProduit = (produit) => produit.nom_fon || produit.nom;

// Évolution par rapport au relevé précédent (en général le mois d'avant).
function tendance({ prix, precedent, date_precedente: datePrecedente }) {
  if (precedent === null) return null;
  const depuis = moisChiffres(datePrecedente);
  const ecart = prix - precedent;
  if (ecart > 0) return el('p', { class: 'tendance tendance-hausse' }, `▲ +${nombre(ecart)} F · ${depuis}`);
  if (ecart < 0) return el('p', { class: 'tendance tendance-baisse' }, `▼ −${nombre(-ecart)} F · ${depuis}`);
  return el('p', { class: 'tendance' }, `→ · ${depuis}`);
}

// Mois de référence d'une liste de relevés : le plus récent.
function moisReference(lignes) {
  return lignes.reduce((plusRecent, l) => (l.date > plusRecent ? l.date : plusRecent), '').slice(0, 7);
}

// Mois du relevé, affiché seulement s'il diffère du mois de référence.
function moisSiAncien(ligne, reference) {
  return ligne.date.slice(0, 7) === reference ? null : el('small', {}, moisChiffres(ligne.date));
}

function carteProduit({ produit, ici, lignes }) {
  const unite = produit.unite;
  const reference = moisReference(lignes);
  const liste = el('ol', { class: 'liste-prix' }, lignes.map((ligne, i) =>
    el('li', { class: ici && ligne.marche.id === ici.marche.id ? 'ici' : null },
      el('span', {},
        nomMarche(ligne.marche),
        i === 0 ? el('span', { class: 'badge fon', lang: 'fon' }, T.moins_cher) : null,
        el('small', {}, ligne.marche.departement)),
      el('span', { class: 'valeur' }, `${nombre(ligne.prix)} F`, moisSiAncien(ligne, reference)))));

  return el('article', { class: 'carte' },
    el('div', { class: 'carte-entete' },
      el('span', { class: 'emoji', 'aria-hidden': 'true' }, produit.emoji),
      el('h2', { class: 'fon', lang: 'fon' }, nomProduit(produit))),
    ici && el('div', { class: 'prix-principal' },
      el('p', {}, el('span', { class: 'montant' }, nombre(ici.prix)), el('span', { class: 'devise' }, `F CFA / ${unite}`)),
      el('p', { class: 'prix-lieu' }, `${nomMarche(ici.marche)} · ${ici.marche.departement} · ${moisChiffres(ici.date)}`),
      tendance(ici)),
    ici
      ? el('details', { class: 'comparer' }, el('summary', { class: 'fon', lang: 'fon' }, T.comparer), liste)
      : liste);
}

function carteMarche(marche, produits) {
  const reference = moisReference(produits);
  return el('article', { class: 'carte' },
    el('div', { class: 'carte-entete' }, el('h2', {}, nomMarche(marche))),
    el('ul', { class: 'liste-prix' }, produits.map((ligne) =>
      el('li', {},
        el('span', { class: 'fon', lang: 'fon' }, el('span', { 'aria-hidden': 'true' }, `${ligne.produit.emoji} `), nomProduit(ligne.produit)),
        el('span', { class: 'valeur' }, `${nombre(ligne.prix)} F / ${ligne.produit.unite}`, moisSiAncien(ligne, reference))))));
}

// Source des prix : le sigle et la licence (CC BY-IGO demande de citer le PAM).
function texteSource(source) {
  return el('p', { class: 'source' },
    el('span', { 'aria-hidden': 'true' }, 'ⓘ '),
    el('a', { href: source.url, target: '_blank', rel: 'noopener' }, `${source.nom.split(' (')[0]} · ${source.licence}`));
}

function afficherPrix(r) {
  montrerResultat(zonePrix,
    phraseDite(r.transcription),
    el('div', { class: 'reponse' }, texteFon(r.message_fon), lecture(r.voix, r.voix_phrase)),
    r.reponses.filter((x) => x.lignes.length > 0).map(carteProduit),
    r.statut === 'marche_seul' && carteMarche(r.marche, r.produits_du_marche),
    r.source && (r.reponses.some((x) => x.lignes.length > 0) || r.statut === 'marche_seul') && texteSource(r.source),
    boutonRecommencer(T.autre_question, microPrix));
}

brancherMicro(microPrix, {
  traiter: async (audio) => afficherPrix(await envoyerAudio('api/prix', audio)),
  afficherErreur: erreurDans(zonePrix),
});

/* ---------- Signalement d'une maladie ---------- */

const zoneSignalement = $('[data-resultat=signalement]');
const microSignalement = $('[data-micro=signalement]');
const etatGps = $('[data-gps-etat]');
const boutonGps = $('[data-gps]');
const choixCommune = $('[data-commune]');
let position = null;
let communesChargees = false;

function demanderPosition() {
  if (!('geolocation' in navigator)) {
    etatGps.textContent = T.gps_indisponible;
    boutonGps.hidden = true;
    return;
  }
  etatGps.textContent = T.gps_recherche;
  delete etatGps.dataset.ok;
  boutonGps.disabled = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      position = { lat: coords.latitude, lon: coords.longitude, precision: coords.accuracy };
      etatGps.textContent = `${T.gps_partagee} (± ${nombre(Math.round(coords.accuracy))} m)`;
      etatGps.dataset.ok = '';
      boutonGps.textContent = T.gps_actualiser;
      boutonGps.disabled = false;
    },
    (erreur) => {
      position = null;
      etatGps.textContent = erreur.code === erreur.PERMISSION_DENIED ? T.gps_refusee : T.gps_introuvable;
      boutonGps.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
}

boutonGps.addEventListener('click', demanderPosition);

async function chargerCommunes() {
  if (communesChargees) return;
  try {
    const { communes } = await appelerApi('api/communes');
    const groupes = new Map();
    for (const c of communes) {
      if (!groupes.has(c.departement)) groupes.set(c.departement, el('optgroup', { label: c.departement }));
      groupes.get(c.departement).append(el('option', { value: c.nom }, c.nom));
    }
    choixCommune.append(...[...groupes.keys()].sort((a, b) => a.localeCompare(b, 'fr')).map((d) => groupes.get(d)));
    choixCommune.value = lireMemoire('agrifon.commune') ?? '';
    communesChargees = true;
  } catch {
    // la liste réessaiera au prochain affichage de la vue
  }
}

choixCommune.addEventListener('change', () => ecrireMemoire('agrifon.commune', choixCommune.value || null));

async function entrerSignalement() {
  chargerCommunes();
  if (!position && navigator.permissions) {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') demanderPosition();
    } catch {
      // API des permissions absente : l'utilisateur appuiera sur le bouton
    }
  }
}

// Lieu du champ : la commune (nom propre) et, si elle a été partagée, la précision GPS.
function texteLieu({ gps, commune }) {
  const morceaux = [];
  if (commune) morceaux.push(`${commune.nom} (${commune.departement})`);
  if (gps) morceaux.push(`📍${gps.precision ? ` ± ${nombre(Math.round(gps.precision))} m` : ''}`);
  return morceaux.length ? morceaux.join(' · ') : aPreciser(T.a_preciser);
}

function aPreciser(texte) {
  return el('span', { class: 'a-preciser' }, texte);
}

function ligneRecap(titre, valeur) {
  return el('div', {}, el('dt', {}, titre), el('dd', {}, valeur));
}

function etapePriseEnCharge(statut, messages) {
  return statut.statut === 'pris_en_charge'
    ? el('li', { class: 'fait' }, texteFon(`${messages.pris.fon} · ${heure(statut.pris_en_charge_le)}`))
    : el('li', {}, texteFon(messages.attente.fon));
}

let suivi = 0;
function suivreStatut(s, messages) {
  clearInterval(suivi);
  if (s.statut === 'pris_en_charge') return;
  const fin = Date.now() + 15 * 60_000;
  suivi = setInterval(async () => {
    const etape = $(`[data-reference="${s.reference}"] [data-etape]`, zoneSignalement);
    if (!etape || Date.now() > fin) return clearInterval(suivi);
    try {
      const statut = await appelerApi(`api/signalements/${encodeURIComponent(s.reference)}`);
      if (statut.statut === 'pris_en_charge') {
        clearInterval(suivi);
        const nouvelle = etapePriseEnCharge(statut, messages);
        nouvelle.dataset.etape = '';
        etape.replaceWith(nouvelle);
      }
    } catch {
      // nouvel essai au prochain tour
    }
  }, 5000);
}

function texteSourceSolution({ nom, detail }) {
  return `Source : ${nom}${detail ? `, ${detail}` : ''}`;
}

// Solutions proposées après le signalement : problème probable, traitement
// documenté éventuel, gestes, puis la mention « À confirmer avec un conseiller ».
function sectionSolutions(solutions) {
  if (!solutions) return null;
  const elements = solutions.elements.map((e) => {
    const traitement = e.type === 'traitement';
    return el('div', { class: `solution${traitement ? ' solution-traitement' : ''}` },
      traitement && el('span', { class: 'solution-etiquette fon', lang: 'fon' }, T.traitement),
      bilingue(e),
      traitement && e.securite && el('div', { class: 'solution-securite' }, bilingue(e.securite)),
      el('p', { class: 'solution-source' }, e.sources.map(texteSourceSolution).join(' · ')),
      e.video && el('a', { class: 'solution-video', href: e.video.url, target: '_blank', rel: 'noopener' }, `${T.video} · Access Agriculture`));
  });
  return el('section', { class: 'solutions', 'aria-label': T.solutions },
    el('div', { class: 'solutions-titre' }, bilingue(solutions.titre)),
    ...solutions.problemes.map((p) => el('div', { class: 'solutions-probleme' }, bilingue(p))),
    ...elements,
    lecture(solutions.voix, solutions.voix_phrase),
    el('div', { class: 'solutions-mention' }, bilingue(solutions.mention)));
}

// Accusé de réception en fon. Le récapitulatif garde la culture et le lieu ; ce qui est
// observé se lit dans la phrase dite, affichée plus bas.
function afficherSignalement(s) {
  const etape = etapePriseEnCharge(s, s.messages);
  etape.dataset.etape = '';

  montrerResultat(zoneSignalement,
    el('div', { class: 'confirmation', 'data-reference': s.reference },
      el('p', { class: 'confirmation-titre' }, el('span', { class: 'coche' }, svg(ICONE_COCHE)),
        el('span', { class: 'fon', lang: 'fon' }, s.messages.titre.fon || T.recu_a)),
      el('p', { class: 'reference', 'aria-label': `${T.reference} ${s.reference}` }, el('span', { 'aria-hidden': 'true' }, '# '), el('strong', {}, s.reference)),
      texteFon(s.messages.recu.fon),
      lecture(s.voix, s.voix_phrase),
      el('ol', { class: 'etapes' }, el('li', { class: 'fait' }, texteFon(`${T.recu_a} · ${heure(s.recu_le)}`)), etape)),
    el('dl', { class: 'recap' },
      ligneRecap(T.culture, s.culture ? el('span', { class: 'fon', lang: 'fon' }, s.culture.nom_fon || s.culture.nom) : aPreciser(T.a_preciser)),
      ligneRecap(T.lieu, texteLieu(s.localisation))),
    sectionSolutions(s.solutions),
    phraseDite(s.transcription),
    boutonRecommencer(T.autre_signalement, microSignalement));
  suivreStatut(s, s.messages);
}

brancherMicro(microSignalement, {
  traiter: async (audio) => {
    const parametres = new URLSearchParams();
    if (position) {
      parametres.set('lat', position.lat.toFixed(6));
      parametres.set('lon', position.lon.toFixed(6));
      parametres.set('precision', Math.round(position.precision));
    }
    if (choixCommune.value) parametres.set('commune', choixCommune.value);
    afficherSignalement(await envoyerAudio(`api/signalements?${parametres}`, audio));
  },
  afficherErreur: erreurDans(zoneSignalement),
});

/* ---------- Démarrage ---------- */

window.addEventListener('hashchange', afficherVue);
afficherVue();
verifierServeur();
enregistrerServiceWorker();
