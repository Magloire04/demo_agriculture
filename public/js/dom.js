// Petits outils partagés par l'application et l'espace conseiller.

// Crée un élément ; le texte est toujours inséré comme texte (jamais comme HTML).
export function el(balise, attributs = {}, ...enfants) {
  const noeud = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs ?? {})) {
    if (valeur === null || valeur === undefined || valeur === false) continue;
    if (nom.startsWith('on')) noeud.addEventListener(nom.slice(2), valeur);
    else noeud.setAttribute(nom, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    noeud.append(enfant instanceof Node ? enfant : String(enfant));
  }
  return noeud;
}

export function svg(contenu, viewBox = '0 0 24 24') {
  const modele = document.createElement('template');
  modele.innerHTML = `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${contenu}</svg>`;
  return modele.content.firstElementChild;
}

export const nombre = (n) => new Intl.NumberFormat('fr-FR').format(n);

export function heure(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function dateLongue(jour) {
  return new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function dateHeure(iso) {
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Appelle l'API du serveur et rend le JSON, ou lève une Error au message lisible.
export async function appelerApi(chemin, { delaiMs = 15000, ...options } = {}) {
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), delaiMs);
  let reponse;
  try {
    reponse = await fetch(chemin, { ...options, signal: controle.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Le service ne répond pas. Réessayez.');
    throw new Error('Pas de connexion internet. Vérifiez la connexion et réessayez.');
  } finally {
    clearTimeout(minuterie);
  }
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const erreur = new Error(donnees.erreur || `Erreur du serveur (${reponse.status}).`);
    erreur.statut = reponse.status;
    erreur.code = donnees.code;
    erreur.fon = donnees.erreur_fon ?? null;
    throw erreur;
  }
  return donnees;
}

export function lireMemoire(cle) {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

export function ecrireMemoire(cle, valeur) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch {
    // stockage indisponible (navigation privée...) : sans conséquence
  }
}

export function enregistrerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
