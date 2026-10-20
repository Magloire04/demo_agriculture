// Outils de comparaison de texte, pour retrouver un mot attendu (produit, marché,
// commune, symptôme) dans une transcription fon même quand les tons ou une lettre
// diffèrent.

const LETTRES_FON = { 'ɔ': 'o', 'ɛ': 'e', 'ɖ': 'd', 'ŋ': 'n', 'ƒ': 'f', 'ʋ': 'v', 'ɣ': 'g', 'ɑ': 'a' };

// Minuscules, sans tons ni accents, lettres fon ramenées à l'alphabet latin,
// ponctuation remplacée par des espaces.
export function normaliser(texte) {
  return String(texte ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ɔɛɖŋƒʋɣɑ]/g, (l) => LETTRES_FON[l])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function mots(texte) {
  const n = normaliser(texte);
  return n ? n.split(' ') : [];
}

export function distance(a, b) {
  if (a === b) return 0;
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const ligne = [i];
    for (let j = 1; j <= b.length; j++) {
      ligne[j] = Math.min(
        precedente[j] + 1,
        ligne[j - 1] + 1,
        precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    precedente = ligne;
  }
  return precedente[b.length];
}

// Écart toléré selon la longueur : les mots courts doivent être exacts.
export function tolerance(longueur) {
  if (longueur >= 8) return 2;
  if (longueur >= 5) return 1;
  return 0;
}

// Cherche une expression (un ou plusieurs mots) dans une liste de mots normalisés.
// Les mots du texte sont aussi comparés collés entre eux, pour accepter
// « porto novo » contre « portonovo » ou « gla zoue » contre « glazoue ».
// Rend { position, ecart } pour la meilleure occurrence, ou null.
export function chercher(motsTexte, expression) {
  const cible = mots(expression).join('');
  if (!cible) return null;
  const tol = tolerance(cible.length);
  const nbMots = mots(expression).length;
  let meilleur = null;
  for (let i = 0; i < motsTexte.length; i++) {
    let fenetre = '';
    for (let k = 0; k <= nbMots && i + k < motsTexte.length; k++) {
      fenetre += motsTexte[i + k];
      if (fenetre.length - cible.length > tol) break;
      if (cible.length - fenetre.length > tol) continue;
      const ecart = distance(fenetre, cible);
      if (ecart <= tol && (!meilleur || ecart < meilleur.ecart)) {
        meilleur = { position: i, ecart };
      }
    }
  }
  return meilleur;
}

// Parmi des entrées portant chacune une liste de termes, rend celles trouvées dans
// le texte, de la plus sûre (écart le plus faible) à la moins sûre, puis par ordre
// d'apparition. `termes(entree)` rend la liste des façons de dire l'entrée.
export function reperer(texte, entrees, termes) {
  const motsTexte = Array.isArray(texte) ? texte : mots(texte);
  const trouvees = [];
  for (const entree of entrees) {
    let meilleur = null;
    for (const terme of termes(entree)) {
      const r = chercher(motsTexte, terme);
      if (r && (!meilleur || r.ecart < meilleur.ecart || (r.ecart === meilleur.ecart && r.position < meilleur.position))) {
        meilleur = { ...r, terme };
      }
    }
    if (meilleur) trouvees.push({ entree, ...meilleur });
  }
  return trouvees.sort((a, b) => a.ecart - b.ecart || a.position - b.position);
}
