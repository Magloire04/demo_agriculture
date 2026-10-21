import { appelerApi, ecrireMemoire, el, enregistrerServiceWorker, heure, lireMemoire, mois, nombre, svg } from './dom.js';
import { demarrerEnregistrement, enregistrementPossible } from './enregistreur.js';

const DUREE_MAX = 30; // secondes ; l'API accepte jusqu'à 60 s
const DELAI_API = 100_000; // l'API demande de prévoir au moins 90 s
const VUES = ['accueil', 'prix', 'signalement'];
const ICONE_COCHE = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';

const $ = (selecteur, racine = document) => racine.querySelector(selecteur);
const principal = $('main');

/* ---------- Navigation entre les vues ---------- */

const micros = [];
let premiereVue = true;

function afficherVue() {
  const demande = location.hash.replace(/^#\/?/, '');
  const vue = VUES.includes(demande) ? demande : 'accueil';
  micros.forEach((m) => m.annuler());
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

async function verifierServeur() {
  const bandeau = $('[data-bandeau]');
  try {
    const { asr } = await appelerApi('api/etat');
    if (asr.simulation) {
      bandeau.textContent = 'Mode simulation : les réponses sont factices, aucune requête n’est envoyée à la reconnaissance vocale.';
      bandeau.hidden = false;
    } else if (!asr.configure) {
      bandeau.textContent = 'Reconnaissance vocale non configurée sur le serveur (identifiants manquants).';
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

  function pret(texte = 'Appuyez pour parler') {
    changer('pret', texte, 'Appuyer pour parler');
    minuteur.textContent = '';
    bouton.style.setProperty('--niveau', 0);
  }

  async function analyser(audio) {
    changer('analyse', 'Analyse de votre voix…', 'Analyse en cours');
    minuteur.textContent = '';
    const lent = setTimeout(() => {
      etat.textContent = 'Le service est un peu lent, merci de patienter…';
    }, 10_000);
    try {
      await traiter(audio);
      pret('Appuyez pour parler à nouveau');
    } catch (e) {
      afficherErreur(e);
      pret('Appuyez pour réessayer');
    } finally {
      clearTimeout(lent);
    }
  }

  bouton.addEventListener('click', async () => {
    if (racine.dataset.etat === 'analyse') return;
    if (session) {
      session.arreter();
      return;
    }
    if (racine.dataset.etat === 'enregistrement') return; // autorisation du micro en attente
    if (!enregistrementPossible()) {
      pret(window.isSecureContext
        ? "Ce navigateur ne permet pas d'enregistrer. Envoyez un fichier audio."
        : "L'enregistrement demande une adresse sécurisée (https). Envoyez un fichier audio.");
      return;
    }
    try {
      changer('enregistrement', 'Autorisez le micro…', 'Terminer');
      session = await demarrerEnregistrement({
        dureeMax: DUREE_MAX,
        surProgression: ({ secondes, niveau }) => {
          minuteur.textContent = `${minutes(secondes)} / ${minutes(DUREE_MAX)}`;
          bouton.style.setProperty('--niveau', niveau.toFixed(2));
        },
      });
      etat.textContent = 'Je vous écoute… Appuyez pour terminer.';
      const { blob, duree } = await session.fin;
      session = null;
      if (duree < 1 || blob.size === 0) {
        pret('Trop court : appuyez, parlez, puis appuyez de nouveau.');
        return;
      }
      await analyser(blob);
    } catch (e) {
      session = null;
      if (e?.name === 'AbortError') return pret();
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
        return pret('Micro refusé : autorisez le micro dans le navigateur.');
      }
      if (e?.name === 'NotFoundError') return pret('Aucun micro trouvé sur cet appareil.');
      pret("L'enregistrement n'a pas pu démarrer. Réessayez.");
    }
  });

  fichier.addEventListener('change', () => {
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
  zone.replaceChildren(...contenu.flat().filter(Boolean));
  zone.hidden = false;
  zone.focus({ preventScroll: true });
  zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Texte en fongbé (mis en avant) suivi du français ; le français seul si le fongbé manque.
function bilingue({ fr, fon }, classeFrancaisSeul = '') {
  if (!fon) return el('p', { class: classeFrancaisSeul || null, lang: 'fr' }, fr);
  return el('div', { class: 'bilingue' },
    el('p', { class: 'texte-fon fon', lang: 'fon' }, fon),
    el('p', { class: 'texte-fr', lang: 'fr' }, fr));
}

function erreurDans(zone) {
  return (e) => montrerResultat(zone, el('div', { class: 'message-erreur', role: 'alert' }, bilingue({ fr: e.message, fon: e.fon })));
}

function vousAvezDit(texte) {
  if (!texte) return null;
  return el('p', { class: 'vous-avez-dit' }, 'Vous avez dit : ', el('span', { class: 'fon', lang: 'fon' }, `« ${texte} »`));
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

// Évolution par rapport au relevé précédent (en général le mois d'avant).
function tendance({ prix, precedent, date_precedente: datePrecedente }) {
  if (precedent === null) return null;
  const depuis = `depuis ${mois(datePrecedente)}`;
  const ecart = prix - precedent;
  if (ecart > 0) return el('p', { class: 'tendance tendance-hausse' }, `▲ +${nombre(ecart)} F ${depuis}`);
  if (ecart < 0) return el('p', { class: 'tendance tendance-baisse' }, `▼ −${nombre(-ecart)} F ${depuis}`);
  return el('p', { class: 'tendance' }, `Stable ${depuis}`);
}

// Mois de référence d'une liste de relevés : le plus récent.
function moisReference(lignes) {
  return lignes.reduce((plusRecent, l) => (l.date > plusRecent ? l.date : plusRecent), '').slice(0, 7);
}

// Mois du relevé, affiché seulement s'il diffère du mois de référence.
function moisSiAncien(ligne, reference) {
  return ligne.date.slice(0, 7) === reference ? null : el('small', {}, `relevé de ${mois(ligne.date)}`);
}

function carteProduit({ produit, ici, lignes }) {
  const unite = produit.unite;
  const reference = moisReference(lignes);
  const liste = el('ol', { class: 'liste-prix' }, lignes.map((ligne, i) =>
    el('li', { class: ici && ligne.marche.id === ici.marche.id ? 'ici' : null },
      el('span', {},
        nomMarche(ligne.marche),
        i === 0 ? el('span', { class: 'badge' }, 'le moins cher') : null,
        el('small', {}, ligne.marche.departement)),
      el('span', { class: 'valeur' }, `${nombre(ligne.prix)} F`, moisSiAncien(ligne, reference)))));

  return el('article', { class: 'carte' },
    el('div', { class: 'carte-entete' },
      el('span', { class: 'emoji', 'aria-hidden': 'true' }, produit.emoji),
      el('h2', {}, produit.nom, nomFon(produit) && el('span', { class: 'nom-fon fon', lang: 'fon' }, nomFon(produit)))),
    ici && el('div', { class: 'prix-principal' },
      el('p', {}, el('span', { class: 'montant' }, nombre(ici.prix)), el('span', { class: 'devise' }, `F CFA / ${unite}`)),
      el('p', { class: 'prix-lieu' }, `Marché ${nomMarche(ici.marche)} · ${ici.marche.departement} · prix moyen de ${mois(ici.date)}`),
      tendance(ici)),
    ici
      ? el('details', { class: 'comparer' }, el('summary', {}, 'Comparer avec les autres marchés'), liste)
      : liste);
}

// Nom fon affiché à côté du nom français, sauf s'il est le même mot (carotte).
function nomFon(produit) {
  return produit.nom_fon && produit.nom_fon.toLowerCase() !== produit.nom.toLowerCase() ? produit.nom_fon : null;
}

function carteMarche(marche, produits) {
  const reference = moisReference(produits);
  return el('article', { class: 'carte' },
    el('div', { class: 'carte-entete' }, el('h2', {}, `Marché ${nomMarche(marche)}`)),
    el('ul', { class: 'liste-prix' }, produits.map((ligne) =>
      el('li', {},
        el('span', {}, el('span', { 'aria-hidden': 'true' }, `${ligne.produit.emoji} `), ligne.produit.nom,
          nomFon(ligne.produit) && el('small', { class: 'fon', lang: 'fon' }, nomFon(ligne.produit))),
        el('span', { class: 'valeur' }, `${nombre(ligne.prix)} F / ${ligne.produit.unite}`, moisSiAncien(ligne, reference))))));
}

function texteSource(source) {
  return el('p', { class: 'source' },
    'Prix de détail moyens relevés chaque mois. Source : ',
    el('a', { href: source.url, target: '_blank', rel: 'noopener' }, source.nom),
    `, jeu « ${source.jeu} », licence ${source.licence}.`);
}

function afficherPrix(r) {
  montrerResultat(zonePrix,
    vousAvezDit(r.transcription),
    el('div', { class: 'reponse' }, bilingue({ fr: r.message, fon: r.message_fon }, 'reponse-message')),
    r.reponses.filter((x) => x.lignes.length > 0).map(carteProduit),
    r.statut === 'marche_seul' && carteMarche(r.marche, r.produits_du_marche),
    r.source && (r.reponses.some((x) => x.lignes.length > 0) || r.statut === 'marche_seul') && texteSource(r.source),
    boutonRecommencer('Poser une autre question', microPrix));
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
    etatGps.textContent = 'Position indisponible sur cet appareil.';
    boutonGps.hidden = true;
    return;
  }
  etatGps.textContent = 'Recherche de la position…';
  delete etatGps.dataset.ok;
  boutonGps.disabled = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      position = { lat: coords.latitude, lon: coords.longitude, precision: coords.accuracy };
      etatGps.textContent = `Position partagée (± ${nombre(Math.round(coords.accuracy))} m)`;
      etatGps.dataset.ok = '';
      boutonGps.textContent = 'Actualiser';
      boutonGps.disabled = false;
    },
    (erreur) => {
      position = null;
      etatGps.textContent = erreur.code === erreur.PERMISSION_DENIED
        ? 'Position refusée : choisissez la commune.'
        : 'Position introuvable : choisissez la commune.';
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

function texteLieu({ gps, commune }) {
  const morceaux = [];
  if (commune) morceaux.push(`${commune.nom} (${commune.departement})${commune.source === 'entendue' ? ', entendu dans votre message' : ''}`);
  else morceaux.push('Commune non précisée');
  morceaux.push(gps ? `position GPS transmise${gps.precision ? ` (± ${nombre(Math.round(gps.precision))} m)` : ''}` : 'position GPS non partagée');
  return morceaux.join(' · ');
}

function aPreciser(texte) {
  return el('span', { class: 'a-preciser' }, texte);
}

function ligneRecap(titre, valeur) {
  return el('div', {}, el('dt', {}, titre), el('dd', {}, valeur));
}

function etapePriseEnCharge(statut, messages) {
  return statut.statut === 'pris_en_charge'
    ? el('li', { class: 'fait' }, bilingue({ ...messages.pris, fr: `${messages.pris.fr.replace(/\.$/, '')} (${heure(statut.pris_en_charge_le)}).` }))
    : el('li', {}, bilingue(messages.attente));
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

function afficherSignalement(s) {
  const observe = s.symptomes.length
    ? [s.symptomes.map((x) => x.libelle).join(' · '), s.parties.length ? ` (${s.parties.map((p) => p.libelle).join(', ')})` : '']
    : aPreciser(`À préciser par le conseiller${s.parties.length ? ` (${s.parties.map((p) => p.libelle).join(', ')})` : ''} : il reçoit votre message vocal.`);
  const etape = etapePriseEnCharge(s, s.messages);
  etape.dataset.etape = '';

  montrerResultat(zoneSignalement,
    el('div', { class: 'confirmation', 'data-reference': s.reference },
      el('p', { class: 'confirmation-titre' }, el('span', { class: 'coche' }, svg(ICONE_COCHE)),
        s.messages.titre.fon ? el('span', { class: 'fon', lang: 'fon' }, s.messages.titre.fon) : s.messages.titre.fr),
      s.messages.titre.fon && el('p', { class: 'texte-fr', lang: 'fr' }, s.messages.titre.fr),
      el('p', { class: 'reference' }, 'Référence : ', el('strong', {}, s.reference)),
      bilingue(s.messages.recu),
      el('ol', { class: 'etapes' }, el('li', { class: 'fait' }, `Reçu par le service à ${heure(s.recu_le)}`), etape)),
    el('dl', { class: 'recap' },
      ligneRecap('Culture', s.culture ? s.culture.nom : aPreciser('À préciser par le conseiller')),
      ligneRecap('Ce qui est observé', observe),
      ligneRecap('Lieu', texteLieu(s.localisation))),
    vousAvezDit(s.transcription),
    boutonRecommencer('Faire un autre signalement', microSignalement));
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
