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

  let ecriture = Promise.resolve();
  function sauver() {
    const contenu = JSON.stringify(etat, null, 1);
    ecriture = ecriture.then(async () => {
      await mkdir(path.dirname(fichier), { recursive: true });
      await writeFile(`${fichier}.tmp`, contenu);
      await rename(`${fichier}.tmp`, fichier);
    });
    return ecriture;
  }

  return {
    lire: () => copier(etat),
    horsService: () => etat.hors_service.actif,
    async mettreHorsService() {
      if (etat.hors_service.actif) return;
      const debut = maintenant().toISOString();
      etat.hors_service = { actif: true, depuis: debut };
      etat.coupures.push({ debut, fin: null });
      await sauver();
    },
    async remettreEnService() {
      if (!etat.hors_service.actif) return;
      const fin = maintenant().toISOString();
      etat.hors_service = { actif: false, depuis: fin };
      const enCours = etat.coupures.findLast((c) => c.fin === null);
      if (enCours) enCours.fin = fin;
      await sauver();
    },
    async definirSolutionsBrouillon(actif) {
      etat.solutions_brouillon = Boolean(actif);
      await sauver();
    },
  };
}
