// Moteur du tour de présentation : déroule les étapes (site/js/tour-etapes.js) sans
// toucher à la page. Tout ce qui se voit ou s'entend passe par `effets`, fournis par
// site/js/tour.js (et par de faux effets dans les tests) :
//   aller(vue), cibleExiste(selecteur), eclairer({ cible, voile, ecran, partie }),
//   dire(cle) → Promise<boolean>, taire(), permissionAccordee(nom) → Promise<boolean>,
//   attendre(type, { cible, depuis, signal }) → Promise<{ ok, code? }>,
//   numeroEvenement() → number, surEnregistrement(rappel) → désabonnement,
//   lieuDeja() → boolean, marquerVu(), fermer().
// `delai(ms, signal)` attend `ms` millisecondes, ou l'arrêt du tour.

export function creerMoteur({ etapes, effets, delai, relanceMs = 10_000, relancesMax = 3 }) {
  let controleur = null;
  let courante = null;

  const rang = (id) => {
    const i = etapes.findIndex((e) => e.id === id);
    if (i < 0) throw new Error(`Étape inconnue : ${id}`);
    return i;
  };

  // Attend le geste de l'étape ; sans geste, redit la consigne toutes les `relanceMs`,
  // `relancesMax` fois au plus. Plus de relance dès que l'enregistrement commence : la
  // voix du tour ne doit pas couvrir celle de l'agriculteur.
  async function attendreGeste(etape, depuis, signal) {
    const attente = effets.attendre(etape.attente, { cible: etape.cible, depuis, signal });
    if (!etape.phrase) return attente;
    let enregistrement = false;
    const desabonner = effets.surEnregistrement(() => {
      enregistrement = true;
      effets.taire();
    });
    try {
      let relances = 0;
      for (;;) {
        if (enregistrement || relances >= relancesMax) return await attente;
        const fini = await Promise.race([attente.then((r) => ({ r })), delai(relanceMs, signal).then(() => null)]);
        if (fini) return fini.r;
        if (signal.aborted) return { ok: false, code: 'arrete' };
        if (enregistrement) continue;
        relances += 1;
        await effets.dire(etape.phrase);
      }
    } finally {
      desabonner?.();
    }
  }

  async function derouler(depuis, signal) {
    let i = rang(depuis);
    let debutDemande = null; // numéro d'événement au début de la dernière vraie demande
    while (i < etapes.length) {
      if (signal.aborted) return 'arrete';
      const etape = etapes[i];
      courante = etape;
      const numero = effets.numeroEvenement();
      if (etape.attente === 'reponse') debutDemande = numero;
      await effets.aller(etape.vue);
      if (signal.aborted) return 'arrete';
      if (etape.cible && !effets.cibleExiste(etape.cible)) {
        i += 1;
        continue;
      }
      effets.eclairer({ cible: etape.cible, voile: etape.voile !== false, ecran: etape.ecran ?? null, partie: etape.partie });
      if (etape.permission && etape.avant && !(await effets.permissionAccordee(etape.permission))) await effets.dire(etape.avant);
      if (signal.aborted) return 'arrete';
      if (etape.phrase) await effets.dire(etape.phrase);
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
        await effets.dire('tour_pas_compris');
        i = rang(etape.retour ?? etape.id);
        continue;
      }
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

    // Retour dans l'application : la phrase de l'étape en cours est redite.
    reprendre() {
      if (courante?.phrase) effets.dire(courante.phrase);
    },

    etape: () => courante?.id ?? null,
  };
}
