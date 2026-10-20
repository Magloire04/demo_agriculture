// « Prix du marché » : à partir de la réponse du mode marché de l'API, retrouve le
// produit et le marché demandés, puis cherche le prix dans la base.

import { mots, reperer } from './texte.js';

const FORMAT_NOMBRE = new Intl.NumberFormat('fr-FR');
const LIBELLES_UNITE = { kg: 'le kilo', litre: 'le litre' };

export function formaterPrix(montant) {
  return `${FORMAT_NOMBRE.format(montant)} F CFA`;
}

function termesProduit(produit) {
  return [...produit.termes_fon, ...produit.termes_fr];
}

function versProduit(produit, entendu) {
  const { prix, termes_fon, termes_fr, ...reste } = produit;
  return { ...reste, libelle_unite: LIBELLES_UNITE[produit.unite] ?? `l'unité (${produit.unite})`, entendu };
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

function majuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
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

export function repondrePrix(base, reponseApi) {
  const marche = trouverMarche(base, transcriptions(reponseApi));
  const { trouves, sansPrix } = trouverProduits(base, reponseApi);

  const reponses = trouves.map(({ produit, entendu }) => {
    const lignes = lignesPrix(base, produit);
    const ici = marche ? lignes.find((l) => l.marche.id === marche.id) : null;
    return { produit: versProduit(produit, entendu), ici: ici ?? null, lignes };
  });

  const phrases = reponses.map(({ produit, ici, lignes }) => {
    if (ici) {
      return `${majuscule(marche.au)}, ${produit.article} coûte ${formaterPrix(ici.prix)} ${produit.libelle_unite}.`;
    }
    const min = lignes[0];
    const max = lignes[lignes.length - 1];
    const absent = marche ? `Pas de prix relevé ${marche.au}. ` : '';
    const fourchette = min.prix === max.prix
      ? `${formaterPrix(min.prix)} ${produit.libelle_unite} dans tous les marchés`
      : `de ${FORMAT_NOMBRE.format(min.prix)} à ${formaterPrix(max.prix)} ${produit.libelle_unite} selon les marchés. Le moins cher : ${nomMarche(min.marche)}`;
    return `${absent}${majuscule(produit.article)} coûte ${fourchette}.`;
  });
  for (const terme of sansPrix) {
    phrases.push(`Le prix de « ${terme} » n'est pas encore dans la base.`);
  }

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
      phrases.push(`Je n'ai pas compris le produit. Voici les prix relevés ${marche.au}.`);
    } else {
      statut = 'non_compris';
      phrases.push("Je n'ai pas reconnu de produit. Dites le nom du produit, puis le marché.");
    }
  }

  return {
    statut,
    message: phrases.join(' '),
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
