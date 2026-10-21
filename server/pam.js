// Lecture des prix du PAM (jeu « Benin - Food Prices » publié sur HDX, licence CC BY-IGO).
// Les relevés retenus sont les deux derniers de chaque produit dans chaque marché du référentiel.

export const SOURCE_PAM = {
  nom: 'PAM (Programme alimentaire mondial)',
  jeu: 'Benin - Food Prices',
  url: 'https://data.humdata.org/dataset/wfp-food-prices-for-benin',
  licence: 'CC BY-IGO',
};

const UNITES_PAM = { kg: 'KG', litre: 'L' };
const FLAGS_RETENUS = new Set(['actual', 'aggregate']);

// Découpe un CSV (champs entre guillemets, guillemets doublés, fins de ligne CRLF).
export function lireCsv(texte) {
  const lignes = [];
  let champ = '';
  let ligne = [];
  let entreGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') {
        entreGuillemets = false;
      } else {
        champ += c;
      }
    } else if (c === '"') {
      entreGuillemets = true;
    } else if (c === ',') {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ);
      if (ligne.length > 1 || ligne[0] !== '') lignes.push(ligne);
      ligne = [];
      champ = '';
    } else {
      champ += c;
    }
  }
  if (champ !== '' || ligne.length) lignes.push([...ligne, champ]);

  const [entetes, ...donnees] = lignes;
  return donnees
    .filter((l) => !l[0]?.startsWith('#')) // ligne d'étiquettes HXL
    .map((l) => Object.fromEntries(entetes.map((e, j) => [e.trim(), (l[j] ?? '').trim()])));
}

function moisAvant(date, mois) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - mois);
  return d.toISOString().slice(0, 10);
}

// Relevés par marché et libellé, triés du plus récent au plus ancien ; plusieurs
// relevés à la même date sont moyennés.
function indexer(lignes) {
  const index = new Map();
  for (const l of lignes) {
    const prix = Number(l.price);
    if (l.currency !== 'XOF' || l.pricetype !== 'Retail' || !FLAGS_RETENUS.has(l.priceflag)) continue;
    if (!Number.isFinite(prix) || prix <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(l.date)) continue;
    const cle = `${l.market}|${l.commodity}|${l.unit}`;
    if (!index.has(cle)) index.set(cle, new Map());
    const parDate = index.get(cle);
    if (!parDate.has(l.date)) parDate.set(l.date, []);
    parDate.get(l.date).push(prix);
  }
  const resultat = new Map();
  for (const [cle, parDate] of index) {
    resultat.set(cle, [...parDate]
      .map(([date, prix]) => ({ date, prix: prix.reduce((a, b) => a + b, 0) / prix.length }))
      .sort((a, b) => b.date.localeCompare(a.date)));
  }
  return resultat;
}

// Rend { derniere_date, prix: { produit: { marche: { date, prix, libelle, precedent } } }, manquants }.
// Un relevé plus vieux que ageMaxMois (par rapport au relevé le plus récent du fichier) est ignoré.
export function extraireReleves(lignes, referentiel, { ageMaxMois = 6 } = {}) {
  const index = indexer(lignes);
  let derniere = '';
  for (const releves of index.values()) if (releves[0].date > derniere) derniere = releves[0].date;
  const limite = derniere ? moisAvant(derniere, ageMaxMois) : '';

  const prix = {};
  const manquants = [];
  for (const produit of referentiel.produits) {
    for (const marche of referentiel.marches) {
      if (!marche.pam) continue;
      let retenu = null;
      for (const libelle of produit.pam ?? []) {
        const releves = index.get(`${marche.pam}|${libelle}|${UNITES_PAM[produit.unite]}`);
        if (releves && releves[0].date >= limite) {
          const [dernier, precedent] = releves;
          retenu = {
            date: dernier.date,
            prix: Math.round(dernier.prix),
            libelle,
            precedent: precedent ? { date: precedent.date, prix: Math.round(precedent.prix) } : null,
          };
          break;
        }
      }
      if (retenu) (prix[produit.id] ??= {})[marche.id] = retenu;
      else manquants.push(`${produit.id} @ ${marche.id}`);
    }
  }
  return { derniere_date: derniere || null, prix, manquants };
}
