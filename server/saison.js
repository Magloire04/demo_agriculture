// Saison des pluies ou saison sèche d'un département à une date donnée, d'après
// les normales 1991-2020 de Météo-Bénin : deux saisons des pluies au Sud et au
// Centre, une seule au Nord. Les périodes de transition rendent null : un geste
// lié à une saison (arroser, drainer) n'est alors pas proposé.

// Périodes [début, fin, saison], bornes incluses, en MMJJ (mois × 100 + jour).
const SUD = [
  [101, 320, 'seche'], [321, 331, null], [401, 731, 'pluies'], [801, 831, 'seche'],
  [901, 1031, 'pluies'], [1101, 1115, null], [1116, 1231, 'seche'],
];
// Zou et Collines : la petite saison sèche d'août y est faible.
const CENTRE = SUD.map(([debut, fin, saison]) => [debut, fin, debut === 801 ? null : saison]);
const NORD = [[101, 331, 'seche'], [401, 430, null], [501, 1031, 'pluies'], [1101, 1115, null], [1116, 1231, 'seche']];
const ALIBORI = [[101, 430, 'seche'], [501, 531, null], [601, 1031, 'pluies'], [1101, 1115, null], [1116, 1231, 'seche']];

const REGIMES = {
  Littoral: SUD, Atlantique: SUD, 'Ouémé': SUD, Plateau: SUD, Mono: SUD, Couffo: SUD,
  Zou: CENTRE, Collines: CENTRE,
  Borgou: NORD, Atacora: NORD, Donga: NORD,
  Alibori: ALIBORI,
};

const UNE_HEURE = 3_600_000; // Porto-Novo : UTC+1, sans heure d'été

export function saisonDe(departement, date) {
  const regime = REGIMES[departement];
  if (!regime) return null;
  const local = new Date(date.getTime() + UNE_HEURE);
  const jour = (local.getUTCMonth() + 1) * 100 + local.getUTCDate();
  return regime.find(([debut, fin]) => jour >= debut && jour <= fin)[2];
}
