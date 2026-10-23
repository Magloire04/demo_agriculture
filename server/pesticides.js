// Règle d'autorisation d'un traitement nommé : un produit de la liste régionale
// du COAHP (data/pesticides.json) porte les mêmes matières actives aux mêmes
// concentrations (la dose en dépend), son usage couvre la culture et le ravageur
// ou la maladie visés, son autorisation est valable à la date de la liste, et
// aucune de ses matières n'est interdite au Bénin. Sert aux tests des données :
// un traitement qui ne passe pas cette règle n'est pas publié.

const sansAccents = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const matiere = (nom) => sansAccents(nom).replace(/\s+/g, ' ');
const concentration = (c) => sansAccents(c).replace(/\s+/g, '').replace(/,/g, '.');
const genre = (cible) => sansAccents(cible).split(/\s+/)[0];

function memesMatieres(produit, traitement) {
  if (produit.matieres.length !== traitement.matieres.length) return false;
  return traitement.matieres.every((m) => produit.matieres.some((p) => matiere(p.nom) === matiere(m.nom)
    && concentration(p.concentration) === concentration(m.concentration)));
}

function couvreCulture(usage, culture, groupes) {
  const groupesUsage = [usage.groupe, ...(usage.groupes ?? [])].filter(Boolean);
  return (usage.cultures ?? []).includes(culture) || groupesUsage.some((g) => groupes?.[g]?.includes(culture));
}

function viseCible(usage, cible) {
  const g = genre(cible);
  return Boolean(g) && sansAccents(`${usage.cible ?? ''} ${usage.texte ?? ''}`).includes(g);
}

export function verifierTraitement(traitement, culture, pesticides) {
  const decrire = traitement.matieres.map((m) => `${m.nom} à ${m.concentration}`).join(' + ');
  const interdites = traitement.matieres
    .filter((m) => pesticides.interdits.some((i) => matiere(i.matiere) === matiere(m.nom)))
    .map((m) => m.nom);
  if (interdites.length) return { autorise: false, raisons: [`matière interdite au Bénin : ${interdites.join(', ')}`] };

  const memes = pesticides.produits.filter((p) => memesMatieres(p, traitement));
  if (!memes.length) return { autorise: false, raisons: [`aucun produit de la liste avec ${decrire}`] };
  const valables = memes.filter((p) => !p.autorisation?.fin || p.autorisation.fin >= pesticides.liste.date);
  if (!valables.length) return { autorise: false, raisons: [`autorisation expirée pour ${decrire}`] };
  const pourCulture = valables.filter((p) => p.usages.some((u) => couvreCulture(u, culture, pesticides.groupes)));
  if (!pourCulture.length) return { autorise: false, raisons: [`${decrire} n'est pas autorisé sur la culture ${culture}`] };
  const pourCible = pourCulture.filter((p) => p.usages.some((u) => couvreCulture(u, culture, pesticides.groupes) && viseCible(u, traitement.cible)));
  if (!pourCible.length) return { autorise: false, raisons: [`${decrire} n'est pas autorisé contre ${traitement.cible} sur la culture ${culture}`] };
  return { autorise: true, raisons: [] };
}
