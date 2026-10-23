// Outils HTTP partagés par le serveur de l'application et par l'administration.

export const ENTETES_SECURITE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'microphone=(self), geolocation=(self), camera=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  // Ni indexation, ni archivage, ni extrait dans un moteur ; aucun fichier repris par un autre site.
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export class ErreurHttp extends Error {
  constructor(statut, message, code = 'requete_invalide', attente = 0) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.attente = attente; // secondes, pour l'en-tête Retry-After
  }
}

export function envoyerJson(res, statut, donnees, attente = 0, entetes = {}) {
  const corps = JSON.stringify(donnees);
  res.writeHead(statut, {
    ...ENTETES_SECURITE,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(attente > 0 && { 'Retry-After': String(attente) }),
    ...entetes,
  });
  res.end(corps);
}

// Corps JSON d'une requête, de `max` octets au plus.
export async function lireCorpsJson(req, max = 4096) {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) throw new ErreurHttp(415, 'Envoyez un corps JSON (Content-Type application/json).');
  const morceaux = [];
  let taille = 0;
  for await (const morceau of req) {
    taille += morceau.length;
    if (taille > max) throw new ErreurHttp(413, 'Le corps de la requête est trop long.');
    morceaux.push(morceau);
  }
  try {
    const donnees = JSON.parse(Buffer.concat(morceaux).toString('utf8'));
    if (donnees === null || typeof donnees !== 'object') throw new Error('objet attendu');
    return donnees;
  } catch {
    throw new ErreurHttp(400, 'Le corps de la requête est illisible.');
  }
}
