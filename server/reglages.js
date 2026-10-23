// Réglages du back office, gardés dans un fichier JSON pour survivre à un
// redémarrage : site hors service ou non (avec l'historique des coupures) et
// affichage des solutions dont le fon attend sa relecture.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const copier = (o) => JSON.parse(JSON.stringify(o));

// `solutionsBrouillon` n'est que la valeur de départ (SOLUTIONS_BROUILLON du .env) :
// un réglage déjà enregistré l'emporte.
export async function creerReglages(fichier, { solutionsBrouillon, maintenant = () => new Date() }) {
  let etat = { hors_service: { actif: false, depuis: null }, solutions_brouillon: Boolean(solutionsBrouillon), coupures: [] };
  try {
    const lu = JSON.parse(await readFile(fichier, 'utf8'));
    etat = {
      hors_service: { actif: Boolean(lu.hors_service?.actif), depuis: lu.hors_service?.depuis ?? null },
      solutions_brouillon: typeof lu.solutions_brouillon === 'boolean' ? lu.solutions_brouillon : etat.solutions_brouillon,
      coupures: Array.isArray(lu.coupures) ? lu.coupures : [],
    };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`Réglages illisibles dans ${fichier} : ${e.message}. Valeurs par défaut.`);
  }

  // Les changements passent l'un après l'autre, et un changement n'est gardé en
  // mémoire qu'une fois écrit : l'écran, le site et le fichier disent la même
  // chose. Une écriture impossible laisse le réglage tel qu'il était, sans
  // empêcher les suivantes. `modifier` rend false quand il n'y a rien à changer.
  let file = Promise.resolve();
  function changer(modifier) {
    const tour = file.then(async () => {
      const suivant = copier(etat);
      if (modifier(suivant) === false) return;
      await mkdir(path.dirname(fichier), { recursive: true });
      await writeFile(`${fichier}.tmp`, JSON.stringify(suivant, null, 1));
      await rename(`${fichier}.tmp`, fichier);
      etat = suivant;
    });
    file = tour.catch(() => {});
    return tour;
  }

  return {
    lire: () => copier(etat),
    horsService: () => etat.hors_service.actif,
    mettreHorsService: () => changer((e) => {
      if (e.hors_service.actif) return false;
      const debut = maintenant().toISOString();
      e.hors_service = { actif: true, depuis: debut };
      e.coupures.push({ debut, fin: null });
    }),
    remettreEnService: () => changer((e) => {
      if (!e.hors_service.actif) return false;
      const fin = maintenant().toISOString();
      e.hors_service = { actif: false, depuis: fin };
      const enCours = e.coupures.findLast((c) => c.fin === null);
      if (enCours) enCours.fin = fin;
    }),
    definirSolutionsBrouillon: (actif) => changer((e) => {
      e.solutions_brouillon = Boolean(actif);
    }),
  };
}
