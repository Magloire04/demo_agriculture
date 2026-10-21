// Relevés de prix lus par le serveur. Le fichier produit par scripts/importer-prix.js
// (dans le dossier de stockage) est préféré à l'instantané livré avec le code
// (data/releves-prix.json). Le fichier est relu dès qu'il change, sans redémarrage.

import { readFileSync, statSync } from 'node:fs';

const VIDE = { source: null, derniere_date: null, prix: {} };

export function creerReleves(chemins, { intervalleMs = 30_000, maintenant = Date.now } = {}) {
  let actuel = VIDE;
  let signature = '';
  let verifieLe = -Infinity;

  function recharger() {
    for (const chemin of chemins) {
      let infos;
      try {
        infos = statSync(chemin);
      } catch {
        continue;
      }
      const nouvelle = `${chemin}|${infos.mtimeMs}|${infos.size}`;
      if (nouvelle === signature) return;
      try {
        actuel = JSON.parse(readFileSync(chemin, 'utf8'));
        signature = nouvelle;
        console.log(`Prix chargés depuis ${chemin} (relevé le plus récent : ${actuel.derniere_date}).`);
        return;
      } catch (e) {
        // Fichier abîmé : on garde les prix déjà chargés, sinon on essaie le suivant.
        console.error(`Prix illisibles dans ${chemin} : ${e.message}`);
        if (actuel !== VIDE) return;
      }
    }
  }

  return {
    lire() {
      if (maintenant() - verifieLe >= intervalleMs) {
        verifieLe = maintenant();
        recharger();
      }
      return actuel;
    },
  };
}
