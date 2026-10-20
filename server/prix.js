// « Prix du marché » : à partir de la réponse du mode marché de l'API, retrouve le
// produit et le marché demandés, puis cherche le prix dans la base.

import { mots, reperer } from './texte.js';

const FORMAT_NOMBRE = new Intl.NumberFormat('fr-FR');
const nombre = (montant) => FORMAT_NOMBRE.format(montant);

function termesProduit(produit) {
  return [...produit.termes_fon, ...produit.termes_fr];
}

function versProduit(produit, entendu) {
  const { prix, termes_fon, termes_fr, ...reste } = produit;
  return { ...reste, nom_fon: produit.nom_fon ?? null, entendu };
}

function versMarche({ termes, ...marche }) {
  return marche;
}

function lignesPrix(base, produit) {
  return base.marches
    .filter((m) => produit.prix[m.id])
    .map((m) => ({ marche: versMarche(m), prix: produit.prix[m.id].actuel, precedent: produit.prix[m.id].precedent }))
    .sort((a, b) => a.prix - b.prix);
}

function nomMarche(marche) {
  return marche.nom === marche.ville ? marche.nom : `${marche.nom} (${marche.ville})`;
}

// Les transcriptions rendues par /marche (la retenue et celles de diagnostic) :
// un nom de marché manqué dans l'une peut être juste dans une autre.
function transcriptions(reponseApi) {
  const champs = ['transcription', 'transcription_vote', 'transcription_marche', 'transcription_lue'];
  return [...new Set(champs.map((c) => reponseApi[c]).filter(Boolean))];
}

export function trouverMarche(base, textes) {
  const motsTextes = textes.flatMap((t) => [...mots(t), '|']);
  return reperer(motsTextes, base.marches, (m) => m.termes)[0]?.entree ?? null;
}

// Produits demandés : d'abord ceux reconnus par le lexique de l'API, sinon ceux
// trouvés directement dans la transcription.
export function trouverProduits(base, reponseApi) {
  const trouves = [];
  const sansPrix = [];
  for (const p of reponseApi.produits ?? []) {
    const terme = p.terme_canonique || p.terme;
    if (!terme) continue;
    const produit = reperer(terme, base.produits, termesProduit)[0]?.entree;
    if (!produit) sansPrix.push(p.terme || terme);
    else if (!trouves.some((t) => t.produit.id === produit.id)) trouves.push({ produit, entendu: p.terme || terme });
  }
  if (trouves.length === 0 && sansPrix.length === 0) {
    const motsTextes = transcriptions(reponseApi).flatMap((t) => [...mots(t), '|']);
    for (const r of reperer(motsTextes, base.produits, termesProduit)) {
      trouves.push({ produit: r.entree, entendu: r.terme });
    }
  }
  return { trouves, sansPrix };
}

export function repondrePrix(base, textes, reponseApi) {
  const marche = trouverMarche(base, transcriptions(reponseApi));
  const { trouves, sansPrix } = trouverProduits(base, reponseApi);

  const reponses = trouves.map(({ produit, entendu }) => {
    const lignes = lignesPrix(base, produit);
    const ici = marche ? lignes.find((l) => l.marche.id === marche.id) : null;
    return { produit: versProduit(produit, entendu), ici: ici ?? null, lignes };
  });

  const phrases = [];
  for (const { produit, ici, lignes } of reponses) {
    const valeurs = { produit: { fr: produit.article, fon: produit.nom_fon }, unite: textes.unite(produit.unite) };
    if (ici) {
      phrases.push(textes.phrase('prix_ici', { ...valeurs, au_marche: marche.au, marche: marche.nom, prix: nombre(ici.prix) }));
      continue;
    }
    if (marche) phrases.push(textes.phrase('prix_absent', { au_marche: marche.au, marche: marche.nom }));
    const min = lignes[0];
    const max = lignes[lignes.length - 1];
    phrases.push(min.prix === max.prix
      ? textes.phrase('prix_partout', { ...valeurs, prix: nombre(min.prix) })
      : textes.phrase('prix_fourchette', {
        ...valeurs,
        min: nombre(min.prix),
        max: nombre(max.prix),
        marche: { fr: nomMarche(min.marche), fon: min.marche.nom },
      }));
  }
  for (const terme of sansPrix) phrases.push(textes.phrase('prix_sans_prix', { terme }));

  let statut = 'ok';
  let produitsDuMarche = [];
  if (reponses.length === 0) {
    if (sansPrix.length > 0) {
      statut = 'sans_prix';
    } else if (marche) {
      statut = 'marche_seul';
      produitsDuMarche = base.produits
        .filter((p) => p.prix[marche.id])
        .map((p) => ({ produit: versProduit(p, null), prix: p.prix[marche.id].actuel, precedent: p.prix[marche.id].precedent }));
      phrases.push(textes.phrase('prix_marche_seul', { au_marche: marche.au, marche: marche.nom }));
    } else {
      statut = 'non_compris';
      phrases.push(textes.phrase('prix_non_compris'));
    }
  }
  const message = textes.joindre(phrases);

  return {
    statut,
    message: message.fr,
    message_fon: message.fon,
    transcription: reponseApi.transcription ?? '',
    marche: marche ? versMarche(marche) : null,
    reponses,
    produits_du_marche: produitsDuMarche,
    releve: base.releve,
    id_requete: reponseApi.id ?? null,
  };
}

// Liste publique de la base (pour l'écran d'aide).
export function resumerBase(base) {
  return {
    releve: base.releve,
    marches: base.marches.map(versMarche),
    produits: base.produits.map((p) => versProduit(p, null)),
  };
}
