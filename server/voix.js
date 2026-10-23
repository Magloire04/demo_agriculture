// Réponses à voix haute. Chaque phrase fon est dite par une suite d'extraits audio
// préparés à l'avance dans public/voix, un par morceau de phrase (voir le champ
// « voix » de data/reponses.json). Le nom d'un fichier se déduit du texte qu'il
// dit : un enregistrement humain peut remplacer un extrait de synthèse sans
// toucher au code.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { morceauxDeMontants } from './nombres-fon.js';
import { morceauxSolutions } from './solutions.js';

export function texteVoix(texte) {
  return texte.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function fichierVoix(texte) {
  return `${createHash('sha1').update(texteVoix(texte)).digest('hex').slice(0, 16)}.mp3`;
}

export function creerVoix(dossier) {
  return {
    // Fichiers à enchaîner pour dire ces morceaux, ou null s'il en manque un. Le
    // dossier est regardé à chaque fois : un extrait ajouté ou retiré compte aussitôt.
    fichiers(morceaux) {
      if (!morceaux?.length) return null;
      const fichiers = morceaux.map(fichierVoix);
      return fichiers.every((f) => existsSync(path.join(dossier, f))) ? fichiers : null;
    },
  };
}

// Tous les morceaux que les réponses peuvent dire : modèles « voix » remplis avec
// chaque produit, marché ou commune, plus les morceaux de montants, et ceux des
// solutions proposées après un signalement quand leurs données sont fournies.
export function listerMorceaux(reponses, base, communes, solutions = null) {
  // Une valeur sans traduction fon ne donne pas de phrase fon, donc pas de voix.
  const complet = (valeurs) => Object.values(valeurs).every(Boolean);
  const domaines = {
    produit: base.produits.map((p) => ({ produit: p.nom_fon, unite: reponses.unites[p.unite]?.fon })).filter(complet),
    marche: base.marches.map((m) => ({ marche: m.nom })),
    commune: communes.map((c) => ({ commune: c.nom })),
  };
  const morceaux = new Set(morceauxDeMontants().map(texteVoix));
  for (const { fon, voix } of Object.values(reponses.phrases)) {
    for (const morceau of fon && voix ? voix.split('|').map((m) => m.trim()) : []) {
      const noms = [...morceau.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
      if (noms.length === 1 && morceau === `{${noms[0]}}`) continue; // montant
      const groupes = [...new Set(noms.map((n) => (n === 'unite' ? 'produit' : n)))];
      let valeurs = [{}];
      for (const g of groupes) {
        if (!domaines[g]) throw new Error(`Emplacement {${g}} sans liste de valeurs dans un modèle « voix »`);
        valeurs = valeurs.flatMap((v) => domaines[g].map((d) => ({ ...v, ...d })));
      }
      for (const v of valeurs) morceaux.add(texteVoix(morceau.replace(/\{(\w+)\}/g, (_, n) => v[n])));
    }
  }
  if (solutions) for (const m of morceauxSolutions(solutions)) morceaux.add(texteVoix(m));
  return [...morceaux];
}
