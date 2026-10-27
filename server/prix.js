// « Prix du marché » : à partir de la réponse du mode marché de l'API, retrouve le
// produit et le marché demandés, puis cherche le prix dans les relevés importés.

import { mots, reperer } from './texte.js';

function termesProduit(produit) {
  return [...produit.termes_fon, ...produit.termes_fr];
}

function versProduit(produit, entendu) {
  const { pam, termes_fon, termes_fr, ...reste } = produit;
  return { ...reste, nom_fon: produit.nom_fon ?? null, entendu };
}

function versMarche({ termes, pam, ...marche }) {
  return marche;
}

function versLigne(releve) {
  return {
    prix: releve.prix,
    date: releve.date,
    precedent: releve.precedent?.prix ?? null,
    date_precedente: releve.precedent?.date ?? null,
  };
}

function lignesPrix(base, releves, produit) {
  const parMarche = releves.prix[produit.id] ?? {};
  return base.marches
    .filter((m) => parMarche[m.id])
    .map((m) => ({ marche: versMarche(m), ...versLigne(parMarche[m.id]) }))
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
// trouvés directement dans la transcription. Un même mot peut désigner plusieurs
// produits relevés (« mɔ̌likún » : riz local et riz importé) : on les rend tous.
export function trouverProduits(base, reponseApi) {
  const trouves = [];
  const sansPrix = [];
  for (const p of reponseApi.produits ?? []) {
    const terme = p.terme_canonique || p.terme;
    if (!terme) continue;
    const resultats = reperer(terme, base.produits, termesProduit);
    const produits = resultats.filter((r) => r.ecart === resultats[0].ecart).map((r) => r.entree);
    if (!produits.length) sansPrix.push(p.terme || terme);
    for (const produit of produits) {
      if (!trouves.some((t) => t.produit.id === produit.id)) trouves.push({ produit, entendu: p.terme || terme });
    }
  }
  if (trouves.length === 0 && sansPrix.length === 0) {
    // Dans la phrase entière, des noms courts (klé, feví) se trouveraient à tort avec une tolérance.
    const motsTextes = transcriptions(reponseApi).flatMap((t) => [...mots(t), '|']);
    for (const r of reperer(motsTextes, base.produits, termesProduit, { exact: true })) {
      trouves.push({ produit: r.entree, entendu: r.terme });
    }
  }
  return { trouves, sansPrix };
}

// Prix d'un produit au marché demandé (`ici`, null sans marché) et sur tous les marchés.
export function reponseProduit(base, releves, produit, entendu, marche) {
  const lignes = lignesPrix(base, releves, produit);
  const ici = marche ? lignes.find((l) => l.marche.id === marche.id) : null;
  return { produit: versProduit(produit, entendu), ici: ici ?? null, lignes };
}

// Phrases de la réponse, produit par produit. La préparation des voix
// (scripts/voix/preparer-phrases.js) s'en sert aussi : même texte, même son.
export function phrasesProduits(textes, reponses, marche) {
  const phrases = [];
  for (const { produit, ici, lignes } of reponses) {
    const valeurs = { produit: { fr: produit.article, fon: produit.nom_fon }, unite: textes.unite(produit.unite) };
    if (ici) {
      phrases.push(textes.phrase('prix_ici', { ...valeurs, au_marche: marche.au, marche: marche.nom, prix: ici.prix }));
      continue;
    }
    if (lignes.length === 0) {
      phrases.push(textes.phrase('prix_inconnu', valeurs));
      continue;
    }
    if (marche) phrases.push(textes.phrase('prix_absent', { ...valeurs, au_marche: marche.au, marche: marche.nom }));
    const min = lignes[0];
    const max = lignes[lignes.length - 1];
    phrases.push(min.prix === max.prix
      ? textes.phrase('prix_partout', { ...valeurs, prix: min.prix })
      : textes.phrase('prix_fourchette', {
        ...valeurs,
        min: min.prix,
        max: max.prix,
        marche: { fr: nomMarche(min.marche), fon: min.marche.nom },
      }));
  }
  return phrases;
}

export function repondrePrix(base, releves, textes, reponseApi) {
  const marche = trouverMarche(base, transcriptions(reponseApi));
  const { trouves, sansPrix } = trouverProduits(base, reponseApi);

  const reponses = trouves.map(({ produit, entendu }) => reponseProduit(base, releves, produit, entendu, marche));
  const phrases = phrasesProduits(textes, reponses, marche);
  for (const terme of sansPrix) phrases.push(textes.phrase('prix_sans_prix', { terme }));

  let statut = 'ok';
  let produitsDuMarche = [];
  if (reponses.length === 0) {
    if (sansPrix.length > 0) {
      statut = 'sans_prix';
    } else if (marche && base.produits.some((p) => releves.prix[p.id]?.[marche.id])) {
      statut = 'marche_seul';
      produitsDuMarche = base.produits
        .filter((p) => releves.prix[p.id]?.[marche.id])
        .map((p) => ({ produit: versProduit(p, null), ...versLigne(releves.prix[p.id][marche.id]) }));
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
    voix: message.voix,
    transcription: reponseApi.transcription ?? '',
    marche: marche ? versMarche(marche) : null,
    reponses,
    produits_du_marche: produitsDuMarche,
    source: releves.source,
    id_requete: reponseApi.id ?? null,
  };
}

// Liste publique du référentiel et de l'état des relevés.
export function resumerBase(base, releves) {
  return {
    source: releves.source,
    derniere_date: releves.derniere_date,
    marches: base.marches.map(versMarche),
    produits: base.produits.map((p) => versProduit(p, null)),
  };
}
