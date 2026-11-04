// Étapes du tour de présentation (docs/superpowers/specs/2026-11-04-agrifon-tour-presentation-design.md).
// Chaque étape : la vue à afficher, l'élément mis sous le projecteur (`cible`), la
// phrase dite (clé de data/tour.json) et ce qu'elle attend :
//   null      : la fin de la phrase ;
//   'appui'   : un appui sur la cible ;
//   'reponse' : la réponse à une vraie demande (micro), réussie ou non ;
//   'lecture' : la fin de la lecture de la réponse à voix haute ;
//   'lieu'    : une position partagée ou une commune choisie.
// `permission` + `avant` : phrase dite d'abord si le téléphone n'a pas encore donné
// cette permission. `retour` : étape où revenir après une demande non comprise ;
// `sinon` : étape où passer quand la demande ne peut pas aboutir (micro refusé…).
// `voile: false` : écran normal pendant que l'application lit sa réponse.

export const PARTIES = 5;

// Relancé par le bouton d'aide : l'appui sur l'aide a déjà débloqué le son.
export const PREMIERE_ETAPE_AIDE = '2a';

const CARTE_PRIX = '.carte-choix[href="#/prix"]';

export const ETAPES = [
  { id: '1', partie: 1, vue: null, cible: '[data-tour-demarrer]', phrase: null, attente: 'appui', ecran: 'demarrage' },
  { id: '1b', partie: 1, vue: 'accueil', cible: null, phrase: 'tour_bienvenue', attente: null },
  { id: '2a', partie: 2, vue: 'accueil', cible: CARTE_PRIX, phrase: 'tour_accueil_prix', attente: null },
  { id: '2b', partie: 2, vue: 'accueil', cible: '.carte-choix[href="#/signalement"]', phrase: 'tour_accueil_conseil', attente: null },
  { id: '3a', partie: 3, vue: 'accueil', cible: CARTE_PRIX, phrase: 'tour_prix_carte', attente: 'appui' },
  {
    id: '3b', partie: 3, vue: 'prix', cible: '[data-micro=prix] .bouton-micro', phrase: 'tour_prix_micro', attente: 'reponse',
    permission: 'microphone', avant: 'tour_permission_micro', retour: '3b', sinon: '4a',
  },
  { id: '3c', partie: 3, vue: 'prix', cible: null, phrase: null, attente: 'lecture', voile: false },
  { id: '3d', partie: 3, vue: 'prix', cible: '[data-resultat=prix] .bouton-ecouter', phrase: 'tour_prix_reecouter', attente: null },
  { id: '3e', partie: 3, vue: 'prix', cible: '[data-resultat=prix] .bouton-principal', phrase: 'tour_prix_autre', attente: null },
  { id: '4a', partie: 4, vue: 'prix', cible: '[data-lien=signalement]', phrase: 'tour_conseil_onglet', attente: 'appui' },
  {
    id: '4b', partie: 4, vue: 'signalement', cible: '[data-lieu]', phrase: 'tour_conseil_lieu', attente: 'lieu',
    permission: 'geolocation', avant: 'tour_permission_position',
  },
  {
    id: '4c', partie: 4, vue: 'signalement', cible: '[data-micro=signalement] .bouton-micro', phrase: 'tour_conseil_micro', attente: 'reponse',
    permission: 'microphone', avant: 'tour_permission_micro', retour: '4c', sinon: '5',
  },
  { id: '4d', partie: 4, vue: 'signalement', cible: null, phrase: null, attente: 'lecture', voile: false },
  { id: '4e', partie: 4, vue: 'signalement', cible: '[data-resultat=signalement] .confirmation', phrase: 'tour_conseil_recu', attente: null },
  { id: '5', partie: 5, vue: 'signalement', cible: '[data-aide]', phrase: 'tour_fin', attente: null },
];
