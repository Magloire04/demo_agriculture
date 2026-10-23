// Solutions proposées après un signalement : gestes sans risque pour la culture et
// les symptômes reconnus, et, quand la combinaison désigne nettement un cas
// documenté, le problème probable et le traitement que donne la source. Les
// données (data/solutions.json) portent chaque texte en français et en fon, sa
// voix et ses sources.

import { creerTextes } from './reponses.js';
import { saisonDe } from './saison.js';
import { chercherExact, mots } from './texte.js';

const MAX_ELEMENTS = 4;
const MAX_PROBLEMES = 2;

const decouper = (voix) => (voix ?? '').split('|').map((m) => m.trim()).filter(Boolean);

function sourcesDe(donnees, liste = []) {
  return liste.map(({ id, detail = null }) => {
    const s = donnees.sources[id];
    if (!s) throw new Error(`Source inconnue : ${id}`);
    return { id, nom: `${s.editeur}, ${s.titre}`, detail, url: s.url };
  });
}

// Un cas s'applique à la culture et au symptôme, si toutes ses parties exigées ont
// été dites. Sans ses mots déclencheurs, un cas « nette » n'est plus que possible.
function trouverCas(donnees, culture, symptome, parties, motsTexte, dejaPris) {
  const cas = donnees.cas.find((c) => c.culture === culture && c.symptomes.includes(symptome)
    && (c.parties ?? []).every((p) => parties.has(p)) && !dejaPris.includes(c));
  if (!cas) return null;
  const termes = [...(cas.termes?.fr ?? []), ...(cas.termes?.fon ?? [])];
  const declenche = !termes.length || termes.some((t) => chercherExact(motsTexte, t));
  return { cas, certitude: cas.certitude === 'nette' && declenche ? 'nette' : 'possible' };
}

export function choisirSolutions(donnees, analyse, { departement = null, date = new Date(), transcription = '' } = {}) {
  if (!donnees || !analyse?.culture || !analyse.symptomes?.length) return null;
  const culture = analyse.culture.id;
  const symptomes = analyse.symptomes.map((s) => s.id);
  const parties = new Set((analyse.parties ?? []).map((p) => p.id));
  const saison = saisonDe(departement, date);
  const motsTexte = mots(transcription);
  const textes = creerTextes({ phrases: donnees.phrases, unites: {} });

  // Au plus un cas par symptôme ; les cas nets d'abord, puis l'ordre des symptômes.
  const retenus = [];
  for (const symptome of symptomes) {
    const r = trouverCas(donnees, culture, symptome, parties, motsTexte, retenus.map((x) => x.cas));
    if (r) retenus.push({ ...r, symptome });
  }
  const rang = (r) => (r.certitude === 'nette' ? 0 : 1);
  const problemes = retenus.sort((a, b) => rang(a) - rang(b)).slice(0, MAX_PROBLEMES);

  const choisis = []; // { element, voix, cas }
  const avecTraitement = problemes.find((p) => p.certitude === 'nette' && p.cas.traitement);
  if (avecTraitement) {
    const { cas } = avecTraitement;
    const t = cas.traitement;
    choisis.push({
      element: {
        type: 'traitement', id: `${cas.id}.traitement`, fr: t.fr, fon: t.fon,
        ...(t.securite && { securite: { fr: t.securite.fr, fon: t.securite.fon } }),
        reserves: t.reserves ?? [],
        sources: sourcesDe(donnees, t.sources),
      },
      voix: [...decouper(t.voix), ...decouper(t.securite?.voix)],
      cas,
    });
  }

  // Une liste par symptôme : gestes du cas retenu pour ce symptôme, puis ceux de la
  // culture, puis ceux par défaut. Le symptôme qui a le moins apporté est servi en
  // premier, pour qu'aucun ne reste sans geste.
  const casDe = new Map(problemes.map((p) => [p.symptome, p.cas]));
  const listes = symptomes.map((s) => ({
    ids: [
      ...(casDe.get(s)?.gestes ?? []).map((id) => ({ id, cas: casDe.get(s) })),
      ...[...(donnees.par_culture?.[culture]?.[s] ?? []), ...(donnees.par_symptome?.[s] ?? [])].map((id) => ({ id, cas: null })),
    ],
    suivant: 0,
    apports: avecTraitement?.symptome === s ? 1 : 0,
  }));
  while (choisis.length < MAX_ELEMENTS) {
    const restantes = listes.filter((l) => l.suivant < l.ids.length);
    if (!restantes.length) break;
    const liste = restantes.reduce((a, b) => (b.apports < a.apports ? b : a));
    const { id, cas } = liste.ids[liste.suivant++];
    if (choisis.some((c) => c.element.id === id)) continue;
    const geste = donnees.gestes[id];
    if (!geste) throw new Error(`Geste inconnu : ${id}`);
    if (geste.saison && geste.saison !== saison) continue;
    choisis.push({ element: { type: 'geste', id, fr: geste.fr, fon: geste.fon, sources: sourcesDe(donnees, geste.sources) }, voix: decouper(geste.voix), cas });
    liste.apports++;
  }

  // Affichage : le traitement, puis les gestes des cas, puis les autres.
  const rangAffichage = (c) => (c.element.type === 'traitement' ? 0 : c.cas ? 1 : 2);
  choisis.sort((a, b) => rangAffichage(a) - rangAffichage(b));
  const elements = choisis.map((c) => c.element);
  const voixElements = choisis.map((c) => c.voix);

  // La vidéo d'un cas accompagne le premier élément qui en vient.
  for (const { cas } of problemes) {
    const premier = choisis.find((c) => c.cas === cas)?.element;
    if (cas.video && premier && !premier.video) premier.video = { url: cas.video.url, titre: cas.video.titre };
  }

  const titre = textes.phrase('titre');
  const mention = textes.phrase('mention');
  const phrasesProblemes = problemes.map((p) => ({
    p, phrase: textes.phrase(p.certitude === 'nette' ? 'probablement' : 'possible', { probleme: p.cas.probleme }),
  }));
  return {
    version: donnees.version,
    titre: { fr: titre.fr, fon: titre.fon },
    problemes: phrasesProblemes.map(({ p, phrase }) => ({ id: p.cas.id, certitude: p.certitude, fr: phrase.fr, fon: phrase.fon })),
    elements,
    mention: { fr: mention.fr, fon: mention.fon },
    morceaux: [
      ...(titre.voix ?? []),
      ...phrasesProblemes.flatMap(({ phrase }) => phrase.voix ?? []),
      ...voixElements.flat(),
      ...(mention.voix ?? []),
    ],
  };
}

// Tous les morceaux de voix que les solutions peuvent dire, pour préparer les extraits.
export function morceauxSolutions(donnees) {
  const morceaux = [];
  for (const phrase of Object.values(donnees.phrases)) {
    for (const m of decouper(phrase.voix)) {
      if (m.includes('{probleme}')) morceaux.push(...donnees.cas.map((c) => m.replace('{probleme}', c.probleme.fon)));
      else morceaux.push(m);
    }
  }
  for (const g of Object.values(donnees.gestes)) morceaux.push(...decouper(g.voix));
  for (const c of donnees.cas) {
    if (!c.traitement) continue;
    morceaux.push(...decouper(c.traitement.voix), ...decouper(c.traitement.securite?.voix));
  }
  return [...new Set(morceaux)];
}
