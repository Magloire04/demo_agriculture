import { appelerApi, dateHeure, el, enregistrerServiceWorker, heure, nombre } from './dom.js';

const RAFRAICHISSEMENT = 5000;
const etat = document.querySelector('[data-etat]');
const zone = document.querySelector('[data-liste]');
const liste = el('ul', { class: 'liste-signalements' });
const cartes = new Map(); // référence -> { statut, noeud }
let code = lireCode();
let premierChargement = true;

function lireCode() {
  try {
    return sessionStorage.getItem('agrifon.code') ?? '';
  } catch {
    return '';
  }
}

function garderCode(valeur) {
  code = valeur;
  try {
    sessionStorage.setItem('agrifon.code', valeur);
  } catch {
    // stockage indisponible : le code sera redemandé au rechargement
  }
}

const entetes = () => (code ? { 'X-Code-Conseiller': code } : {});

function lienCarte({ lat, lon }) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

function ligne(titre, ...valeur) {
  return el('div', {}, el('dt', {}, titre), el('dd', {}, ...valeur));
}

function lieu({ gps, commune }) {
  return [
    commune ? `${commune.nom} (${commune.departement})${commune.source === 'entendue' ? ' — entendu dans le message' : ''}` : 'Commune non précisée',
    gps
      ? [' · ', el('a', { href: lienCarte(gps), target: '_blank', rel: 'noopener' }, `voir la position GPS${gps.precision ? ` (± ${nombre(Math.round(gps.precision))} m)` : ''}`)]
      : ' · pas de position GPS',
  ];
}

function carte(s) {
  const observe = s.symptomes.length ? s.symptomes.map((x) => x.libelle).join(' · ') : 'Non reconnu : écouter le message';
  const parties = s.parties.length ? ` (${s.parties.map((p) => p.libelle).join(', ')})` : '';
  const audio = s.audio_disponible
    ? el('audio', {
      controls: true,
      preload: 'none',
      src: `api/signalements/${encodeURIComponent(s.reference)}/audio${code ? `?code=${encodeURIComponent(code)}` : ''}`,
    })
    : null;
  const bouton = s.statut === 'transmis'
    ? el('button', { class: 'bouton-principal', type: 'button', onclick: (e) => prendreEnCharge(s.reference, e.currentTarget) }, 'Prendre en charge')
    : null;

  return el('li', { class: 'signalement', 'data-statut': s.statut },
    el('div', { class: 'signalement-entete' },
      el('h2', {}, s.culture ? s.culture.nom : 'Culture à préciser'),
      el('span', { class: 'statut' }, s.statut === 'pris_en_charge' ? `Pris en charge à ${heure(s.pris_en_charge_le)}` : 'Nouveau')),
    el('dl', { class: 'recap' },
      ligne('Référence', `${s.reference} · reçu le ${dateHeure(s.recu_le)}${s.simulation ? ' · simulation' : ''}`),
      ligne('Ce qui est observé', observe + parties),
      ligne('Lieu', lieu(s.localisation)),
      ligne('Message (fongbé)', el('span', { class: 'fon', lang: 'fon' }, s.transcription || '—'))),
    audio,
    el('div', { class: 'actions' }, bouton));
}

async function prendreEnCharge(reference, bouton) {
  bouton.disabled = true;
  try {
    await appelerApi(`api/signalements/${encodeURIComponent(reference)}/prise-en-charge`, { method: 'POST', headers: entetes() });
    await charger();
  } catch (e) {
    bouton.disabled = false;
    etat.textContent = e.message;
  }
}

function demanderCode(message) {
  const champ = el('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Code conseiller' });
  zone.replaceChildren(el('form', {
    class: 'formulaire-code',
    onsubmit: (e) => {
      e.preventDefault();
      garderCode(champ.value);
      zone.replaceChildren();
      charger();
    },
  }, el('label', {}, 'Code conseiller'), champ, el('button', { class: 'bouton-principal', type: 'submit' }, 'Ouvrir')));
  etat.textContent = message;
  champ.focus();
}

async function charger() {
  let signalements;
  try {
    ({ signalements } = await appelerApi('api/signalements', { headers: entetes() }));
  } catch (e) {
    if (e.statut === 401) return demanderCode(code ? 'Code incorrect.' : 'Saisissez le code conseiller.');
    etat.textContent = `${e.message} Nouvel essai dans quelques secondes.`;
    return;
  }

  // Mise à jour par référence : un message en cours d'écoute n'est pas interrompu.
  const nouvelles = [];
  for (const s of signalements) {
    const connue = cartes.get(s.reference);
    if (connue && connue.statut === s.statut) {
      nouvelles.push(connue.noeud);
      continue;
    }
    const noeud = carte(s);
    if (!connue && !premierChargement) noeud.classList.add('nouveau');
    cartes.set(s.reference, { statut: s.statut, noeud });
    nouvelles.push(noeud);
  }
  liste.replaceChildren(...nouvelles);
  if (!zone.contains(liste)) zone.replaceChildren(liste);
  if (signalements.length === 0) zone.replaceChildren(el('p', { class: 'vide' }, 'Aucun signalement pour le moment.'));

  const enAttente = signalements.filter((s) => s.statut === 'transmis').length;
  etat.textContent = `${signalements.length} signalement${signalements.length > 1 ? 's' : ''}, dont ${enAttente} à prendre en charge. Mise à jour automatique.`;
  premierChargement = false;
}

async function boucle() {
  if (!document.querySelector('.formulaire-code')) await charger();
  setTimeout(boucle, RAFRAICHISSEMENT);
}

boucle();
enregistrerServiceWorker();
