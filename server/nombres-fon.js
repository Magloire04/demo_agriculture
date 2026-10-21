// Montants en F CFA dits en fon, avec les unités du marché : caki (1 000 F),
// kpɔ́nwun (25 F) et ɖɔ̌la (5 F). Sources : guide de fon du Corps de la Paix
// (leçon « Le marché »), dictionnaires fongbebenin.com et edutechbenin.com,
// presse traduite en fon (corpus MAFAND). Exemples attestés : 90 F = kpɔ́nwun atɔ̀n
// ɖɔ̌la atɔ̀n, 400 F = kpɔ́nwun afɔ́tɔn nukún ɖokpó, 1 500 F = caki ɖokpó adaɖé.

const PREMIERS = ['', 'ɖokpó', 'wè', 'atɔ̀n', 'ɛnɛ̀', 'atɔ́ɔ́n', 'ayizɛ́n', 'tɛ́nwe', 'tántɔn', 'tɛ́nnɛ',
  'wǒ', 'wǒ ɖokpó', 'wěwè', 'wǎtɔ̀n', 'wɛ̌nɛ̀'];
// Au-delà de 14, on compte par séries de 5 : série + nukún + 1 à 4 (17 = afɔ́tɔn nukún wè).
const SERIES = [[35, 'gbàn atɔ́ɔ́n'], [30, 'gbàn'], [25, 'kó atɔ́ɔ́n'], [20, 'kó'], [15, 'afɔ́tɔn']];
const ENVIRON = 'mɔ̌';

export function nombreFon(n) {
  if (!Number.isInteger(n) || n < 1 || n > 39) throw new RangeError(`Nombre hors de 1 à 39 : ${n}`);
  if (n < 15) return PREMIERS[n];
  const [base, nom] = SERIES.find(([b]) => n >= b);
  return n === base ? nom : `${nom} nukún ${PREMIERS[n - base]}`;
}

// Morceaux du montant, arrondi à 5 F entre 5 et 39 995 F (« mɔ̌ », environ, suit
// le dernier morceau quand on arrondit). Rend null hors de 1 à 39 999 F.
export function montantFon(prix) {
  if (!(prix > 0 && prix < 40_000)) return null;
  const arrondi = Math.min(39_995, Math.max(5, Math.round(prix / 5) * 5));
  const morceaux = [];
  if (arrondi < 75 && arrondi % 25) {
    // Sous 75 F, on compte en ɖɔ̌la (ɖɔ̌la wěwè = 60 F), sauf 25 et 50 F.
    morceaux.push(`ɖɔ̌la ${nombreFon(arrondi / 5)}`);
  } else {
    const milliers = Math.floor(arrondi / 1000);
    let reste = arrondi % 1000;
    if (milliers) morceaux.push(`caki ${nombreFon(milliers)}`);
    if (milliers && reste === 500) {
      morceaux.push('adaɖé');
      reste = 0;
    }
    if (reste >= 25) morceaux.push(`kpɔ́nwun ${nombreFon(Math.floor(reste / 25))}`);
    if (reste % 25) morceaux.push(`ɖɔ̌la ${nombreFon((reste % 25) / 5)}`);
  }
  if (arrondi !== prix) morceaux[morceaux.length - 1] += ` ${ENVIRON}`;
  return morceaux;
}

// Tous les morceaux que montantFon peut rendre : la liste des extraits à préparer.
export function morceauxDeMontants() {
  const nombres = (max) => Array.from({ length: max }, (_, i) => nombreFon(i + 1));
  const morceaux = [
    ...nombres(39).map((n) => `caki ${n}`),
    'adaɖé',
    ...nombres(39).map((n) => `kpɔ́nwun ${n}`),
    ...nombres(14).map((n) => `ɖɔ̌la ${n}`),
  ];
  return [...morceaux, ...morceaux.map((m) => `${m} ${ENVIRON}`)];
}
