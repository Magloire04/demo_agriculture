// Moteur du tour de présentation : déroule les étapes (site/js/tour-etapes.js) sans
// toucher à la page. Tout ce qui se voit ou s'entend passe par `effets`, fournis par
// site/js/tour.js (et par de faux effets dans les tests) :
//   aller(vue), cibleExiste(selecteur), eclairer({ cible, voile, ecran, partie, geste }),
//   dire(cle) → Promise<boolean>, taire(),
//   etatPermission(nom) → Promise<'granted'|'denied'|'prompt'|null>,
//   attendre(type, { cible, depuis, signal, vue }) → Promise<{ ok, code? }>,
//   numeroEvenement() → number, surEnregistrement(rappel) → désabonnement,
//   enregistrementEnCours() → boolean (micro en écoute ou en analyse),
//   estVisible() → boolean, visible() → Promise (résolue quand la page est visible),
//   lieuDeja() → boolean, marquerVu(), fermer().
// `delai(ms, signal)` attend `ms` millisecondes, ou l'arrêt du tour.

// Échecs qu'un nouvel essai ne réparera pas : le tour passe à la partie suivante.
const SANS_ISSUE = new Set(['micro_refuse', 'micro_non_disponible', 'micro_absent', 'service_sature']);
const ECHECS_MAX = 2; // échecs de suite avant de passer à la partie suivante
const GESTES = new Set(['appui', 'reponse', 'lieu']); // attentes d'un geste sur la cible

// `lectureMaxMs` : la voix d'une réponse peut se faire attendre 150 s (site/js/voix.js),
// puis se lire ; au-delà, le tour continue.
export function creerMoteur({ etapes, effets, delai, relanceMs = 10_000, relancesMax = 3, lectureMaxMs = 240_000 }) {
  let controleur = null;
  let courante = null;
  let parole = false; // une phrase est dite, ou attend le retour de la page

  const rang = (id) => {
    const i = etapes.findIndex((e) => e.id === id);
    if (i < 0) throw new Error(`Étape inconnue : ${id}`);
    return i;
  };
  // L'agriculteur a déjà appuyé sur le micro : la voix du tour se tait.
  const enregistre = (etape) => etape.attente === 'reponse' && effets.enregistrementEnCours();

  // Dit une phrase quand la page est visible ; coupée parce que la page a été cachée
  // (écran éteint, autre application), elle est redite au retour.
  async function direVisible(cle, signal) {
    parole = true;
    try {
      for (;;) {
        await effets.visible();
        if (signal.aborted) return;
        await effets.dire(cle);
        if (signal.aborted || effets.estVisible()) return;
      }
    } finally {
      parole = false;
    }
  }

  // Attend le geste de l'étape ; sans geste, redit la consigne toutes les `relanceMs`,
  // `relancesMax` fois au plus. Plus de relance dès que l'enregistrement commence : la
  // voix du tour ne doit pas couvrir celle de l'agriculteur.
  async function attendreGeste(etape, depuis, signal) {
    const attente = effets.attendre(etape.attente, { cible: etape.cible, depuis, signal, vue: etape.vue });
    // Une lecture bloquée (son qui ne finit jamais) ne retient pas le tour sans fin.
    if (etape.attente === 'lecture') return Promise.race([attente, delai(lectureMaxMs, signal).then(() => ({ ok: true, code: 'delai' }))]);
    if (!etape.phrase) return attente;
    let enregistrement = enregistre(etape);
    const desabonner = effets.surEnregistrement(() => {
      enregistrement = true;
      effets.taire();
    });
    try {
      let relances = 0;
      for (;;) {
        if (enregistrement || enregistre(etape) || relances >= relancesMax) return await attente;
        const fini = await Promise.race([attente.then((r) => ({ r })), delai(relanceMs, signal).then(() => null)]);
        if (fini) return fini.r;
        if (signal.aborted) return { ok: false, code: 'arrete' };
        if (enregistrement || enregistre(etape)) continue;
        relances += 1;
        await direVisible(etape.phrase, signal);
      }
    } finally {
      desabonner?.();
    }
  }

  async function derouler(depuis, signal) {
    let i = rang(depuis);
    let debutDemande = null; // numéro d'événement au début de la dernière vraie demande
    let echecs = 0; // échecs de suite de la demande en cours
    while (i < etapes.length) {
      if (signal.aborted) return 'arrete';
      await effets.visible();
      if (signal.aborted) return 'arrete';
      const etape = etapes[i];
      courante = etape;
      const numero = effets.numeroEvenement();
      await effets.aller(etape.vue);
      if (signal.aborted) return 'arrete';
      if (etape.cible && !effets.cibleExiste(etape.cible)) {
        i += 1;
        continue;
      }
      if (etape.attente === 'reponse') debutDemande = numero;
      effets.eclairer({
        cible: etape.cible, voile: etape.voile !== false, ecran: etape.ecran ?? null, partie: etape.partie,
        geste: GESTES.has(etape.attente),
      });
      if (etape.permission && etape.avant && !enregistre(etape)) {
        // Permission déjà donnée : rien à dire ; refusée : le téléphone ne la redemandera pas.
        const etat = await effets.etatPermission(etape.permission);
        if (etat !== 'granted' && etat !== 'denied') await direVisible(etape.avant, signal);
      }
      if (signal.aborted) return 'arrete';
      if (etape.phrase && !enregistre(etape)) await direVisible(etape.phrase, signal);
      if (signal.aborted) return 'arrete';
      if (!etape.attente || (etape.attente === 'lieu' && effets.lieuDeja())) {
        i += 1;
        continue;
      }
      // Sans voix, la fin de lecture suit la réponse de si près qu'elle précède cette
      // étape : elle se compte depuis le début de la demande.
      const depuisEvenement = etape.attente === 'lecture' && debutDemande !== null ? debutDemande : numero;
      const resultat = await attendreGeste(etape, depuisEvenement, signal);
      if (signal.aborted) return 'arrete';
      if (etape.attente === 'reponse' && !resultat?.ok) {
        if (resultat?.code === 'hors_service') {
          effets.taire();
          effets.fermer();
          return 'arrete';
        }
        echecs += 1;
        if (SANS_ISSUE.has(resultat?.code) || echecs >= ECHECS_MAX) {
          echecs = 0;
          i = etape.sinon ? rang(etape.sinon) : i + 1;
          continue;
        }
        await direVisible('tour_pas_compris', signal);
        i = rang(etape.retour ?? etape.id);
        continue;
      }
      if (etape.attente === 'reponse') echecs = 0;
      i += 1;
    }
    effets.marquerVu();
    effets.fermer();
    return 'fini';
  }

  return {
    // Démarre à l'étape `depuis` ; un tour en cours est abandonné sans être marqué vu.
    async demarrer(depuis = etapes[0].id) {
      controleur?.abort();
      const moi = new AbortController();
      controleur = moi;
      const arret = new Promise((ok) => moi.signal.addEventListener('abort', () => ok('arrete')));
      try {
        return await Promise.race([derouler(depuis, moi.signal), arret]);
      } finally {
        if (controleur === moi) {
          controleur = null;
          courante = null;
        }
      }
    },

    // La croix : silence, tour vu, fermeture.
    arreter() {
      if (!controleur) return;
      const actuel = controleur;
      controleur = null;
      courante = null;
      effets.taire();
      effets.marquerVu();
      effets.fermer();
      actuel.abort();
    },

    // Retour dans l'application pendant une attente : la consigne de l'étape est redite,
    // sauf si une phrase est déjà en cours ou si l'agriculteur parle.
    reprendre() {
      if (parole || !courante?.phrase || enregistre(courante)) return;
      effets.dire(courante.phrase);
    },

    etape: () => courante?.id ?? null,
  };
}
