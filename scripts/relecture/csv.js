// Relecture des solutions par un locuteur du fon : export en CSV (une ligne par
// texte, avec le français, le fon affiché, le texte dit par la voix et la source)
// et réimport des corrections. Le CSV s'ouvre dans un tableur : séparateur « ; »,
// UTF-8 avec BOM, chaque cellule entre guillemets.

const COLONNES = ['cle', 'type', 'fr', 'fon', 'voix', 'source'];

const cellule = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function nomsSources(donnees, liste = []) {
  return liste.map(({ id, detail }) => {
    const s = donnees.sources[id];
    return s ? `${s.editeur}, ${s.titre}${detail ? ` (${detail})` : ''}` : id;
  }).join(' ; ');
}

// Lignes à relire, dans l'ordre du fichier de données.
function lignes(donnees) {
  const resultat = [];
  for (const [id, p] of Object.entries(donnees.phrases)) resultat.push({ cle: `phrases.${id}`, type: 'phrase', texte: p, source: '' });
  for (const [id, g] of Object.entries(donnees.gestes)) resultat.push({ cle: `gestes.${id}`, type: 'geste', texte: g, source: nomsSources(donnees, g.sources) });
  for (const c of donnees.cas) {
    resultat.push({ cle: `cas.${c.id}.probleme`, type: 'probleme', texte: c.probleme, source: nomsSources(donnees, c.sources) });
    if (!c.traitement) continue;
    resultat.push({ cle: `cas.${c.id}.traitement`, type: 'traitement', texte: c.traitement, source: nomsSources(donnees, c.traitement.sources) });
    if (c.traitement.securite) {
      resultat.push({ cle: `cas.${c.id}.traitement.securite`, type: 'securite', texte: c.traitement.securite, source: nomsSources(donnees, c.traitement.sources) });
    }
  }
  return resultat;
}

export function exporterCsv(donnees) {
  const corps = lignes(donnees).map(({ cle, type, texte, source }) => [cle, type, texte.fr, texte.fon, texte.voix ?? '', source].map(cellule).join(';'));
  return `﻿${[COLONNES.map(cellule).join(';'), ...corps].join('\r\n')}\r\n`;
}

// Lecture CSV : guillemets doublés, séparateur « ; », fins de ligne CRLF ou LF.
function lireCsv(texte) {
  const rangees = [];
  let rangee = [];
  let champ = '';
  let entreGuillemets = false;
  const t = texte.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreGuillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') entreGuillemets = false;
      else champ += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === ';') { rangee.push(champ); champ = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      rangee.push(champ);
      if (rangee.some((x) => x !== '')) rangees.push(rangee);
      rangee = [];
      champ = '';
    } else champ += c;
  }
  if (champ !== '' || rangee.length) { rangee.push(champ); rangees.push(rangee); }
  return rangees;
}

function cible(donnees, cle) {
  const [groupe, id, partie, sous] = cle.split('.');
  if (groupe === 'phrases' && !partie) return donnees.phrases[id];
  if (groupe === 'gestes' && !partie) return donnees.gestes[id];
  if (groupe !== 'cas') return undefined;
  const c = donnees.cas.find((x) => x.id === id);
  if (!c) return undefined;
  if (partie === 'probleme' && !sous) return c.probleme;
  if (partie === 'traitement' && !sous) return c.traitement;
  if (partie === 'traitement' && sous === 'securite') return c.traitement?.securite;
  return undefined;
}

export function importerCsv(texte, donnees) {
  const copie = structuredClone(donnees);
  const alertes = [];
  const [entete, ...rangees] = lireCsv(texte);
  const col = Object.fromEntries(COLONNES.map((nom) => [nom, entete.indexOf(nom)]));
  for (const r of rangees) {
    const cle = r[col.cle];
    const t = cible(copie, cle);
    if (!t) { alertes.push(`clé inconnue : ${cle}`); continue; }
    const fon = (r[col.fon] ?? '').trim();
    const voix = (r[col.voix] ?? '').trim();
    const aUneVoix = typeof t.voix === 'string';
    if (!fon) { alertes.push(`fon vide, valeur précédente gardée : ${cle}`); continue; }
    if (aUneVoix && !voix) { alertes.push(`voix vide, valeur précédente gardée : ${cle}`); continue; }
    const fonChange = fon !== t.fon;
    const voixChange = aUneVoix && voix !== t.voix;
    if (aUneVoix && fonChange !== voixChange) {
      alertes.push(`${fonChange ? 'fon' : 'voix'} corrigé sans ${fonChange ? 'la voix' : 'le fon'} : ${cle}`);
    }
    t.fon = fon;
    if (aUneVoix) t.voix = voix;
  }
  return { donnees: copie, alertes };
}
