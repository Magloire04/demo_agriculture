// Phrases de réponse en français et en fongbé, construites à partir des modèles de
// data/reponses.json. Une phrase fongbé absente (null) n'empêche pas la réponse
// française : l'interface n'affiche alors que le français.

const EMPLACEMENT = /\{(\w+)\}/g;

function majuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

// Remplit un modèle. Une valeur est soit un texte commun aux deux langues, soit
// { fr, fon }. Rend null si le modèle ou une valeur manque dans cette langue.
function remplir(modele, valeurs, langue) {
  if (!modele) return null;
  let manque = false;
  const texte = modele.replace(EMPLACEMENT, (_, nom) => {
    const valeur = valeurs[nom];
    const traduite = valeur !== null && typeof valeur === 'object' ? valeur[langue] : valeur;
    if (traduite === null || traduite === undefined || traduite === '') manque = true;
    return traduite ?? '';
  });
  return manque ? null : majuscule(texte);
}

export function creerTextes(donnees) {
  function phrase(id, valeurs = {}) {
    const modele = donnees.phrases[id];
    if (!modele) throw new Error(`Phrase inconnue : ${id}`);
    const fr = remplir(modele.fr, valeurs, 'fr');
    if (fr === null) throw new Error(`Phrase française incomplète : ${id}`);
    return { fr, fon: remplir(modele.fon, valeurs, 'fon') };
  }

  return {
    phrase,
    unite: (code) => donnees.unites[code] ?? { fr: `l'unité (${code})`, fon: null },
    // Met bout à bout plusieurs phrases ; le fongbé n'est rendu que s'il est complet.
    joindre(phrases) {
      return {
        fr: phrases.map((p) => p.fr).join(' '),
        fon: phrases.every((p) => p.fon) ? phrases.map((p) => p.fon).join(' ') : null,
      };
    },
  };
}
