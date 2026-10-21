// Phrases de réponse en français et en fongbé, construites à partir des modèles de
// data/reponses.json. Une phrase fongbé absente (null) n'empêche pas la réponse
// française : l'interface n'affiche alors que le français.

import { montantFon } from './nombres-fon.js';

const EMPLACEMENT = /\{(\w+)\}/g;
const FORMAT_NOMBRE = new Intl.NumberFormat('fr-FR');

function majuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

// Remplit un modèle. Une valeur est un texte ou un nombre commun aux deux langues,
// ou { fr, fon }. Rend null si le modèle ou une valeur manque dans cette langue.
function remplir(modele, valeurs, langue) {
  if (!modele) return null;
  let manque = false;
  const texte = modele.replace(EMPLACEMENT, (_, nom) => {
    const valeur = valeurs[nom];
    const traduite = typeof valeur === 'number' ? FORMAT_NOMBRE.format(valeur)
      : valeur !== null && typeof valeur === 'object' ? valeur[langue] : valeur;
    if (traduite === null || traduite === undefined || traduite === '') manque = true;
    return traduite ?? '';
  });
  return manque ? null : majuscule(texte);
}

// Morceaux à dire à voix haute. Le modèle « voix » reprend la phrase fon, coupée
// en morceaux par « | » ; un emplacement seul dans son morceau et rempli par un
// nombre est un montant, dit avec les unités du marché.
function morceauxVoix(modele, valeurs) {
  if (!modele) return null;
  const morceaux = [];
  for (const brut of modele.split('|')) {
    const morceau = brut.trim();
    const seul = morceau.match(/^\{(\w+)\}$/);
    const texte = seul && typeof valeurs[seul[1]] === 'number' ? montantFon(valeurs[seul[1]]) : remplir(morceau, valeurs, 'fon');
    if (texte === null) return null;
    morceaux.push(...[texte].flat());
  }
  return morceaux;
}

export function creerTextes(donnees) {
  function phrase(id, valeurs = {}) {
    const modele = donnees.phrases[id];
    if (!modele) throw new Error(`Phrase inconnue : ${id}`);
    const fr = remplir(modele.fr, valeurs, 'fr');
    if (fr === null) throw new Error(`Phrase française incomplète : ${id}`);
    const fon = remplir(modele.fon, valeurs, 'fon');
    return { fr, fon, voix: fon ? morceauxVoix(modele.voix, valeurs) : null };
  }

  return {
    phrase,
    unite: (code) => donnees.unites[code] ?? { fr: `l'unité (${code})`, fon: null },
    // Met bout à bout plusieurs phrases ; le fongbé et la voix ne sont rendus que
    // s'ils sont complets.
    joindre(phrases) {
      return {
        fr: phrases.map((p) => p.fr).join(' '),
        fon: phrases.every((p) => p.fon) ? phrases.map((p) => p.fon).join(' ') : null,
        voix: phrases.length && phrases.every((p) => p.voix) ? phrases.flatMap((p) => p.voix) : null,
      };
    },
  };
}
