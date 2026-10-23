// Protection contre les robots et l'aspiration du site. AgriFon est fait pour des
// personnes qui parlent à leur téléphone : les robots (moteurs, IA, outils de
// copie) sont refusés, un autre site ne peut pas reprendre ses fichiers, et chaque
// visiteur a un nombre limité de demandes. Rien ici ne gêne un agriculteur : pas de
// captcha, pas d'exigence qu'un vieux téléphone ne saurait remplir.

// Robots connus, outils de copie et bibliothèques HTTP. « bot/ » et « bot; » plutôt
// que « bot » seul : des téléphones s'appellent CUBOT.
const ROBOTS = new RegExp([
  // moteurs de recherche et aperçus de liens
  'googlebot', 'google-inspectiontool', 'googleother', 'google-extended', 'adsbot', 'mediapartners-google', 'apis-google',
  'feedfetcher', 'bingbot', 'bingpreview', 'msnbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandex', 'sogou', 'exabot',
  'seznambot', 'qwantify', 'petalbot', 'applebot', 'facebookexternalhit', 'facebot', 'meta-externalagent',
  'meta-externalfetcher', 'twitterbot', 'linkedinbot', 'slackbot', 'telegrambot', 'whatsapp', 'discordbot',
  'skypeuripreview', 'redditbot', 'embedly', 'vkshare',
  // intelligences artificielles
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web', 'claude-user', 'claude-searchbot', 'anthropic-ai',
  'ccbot', 'perplexitybot', 'perplexity-user', 'bytespider', 'amazonbot', 'cohere-ai', 'diffbot', 'imagesiftbot', 'omgili',
  'youbot', 'timpibot', 'ai2bot', 'duckassistbot', 'mistralai-user', 'iaskspider',
  // référencement et archivage
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'blexbot', 'dataforseobot', 'serpstatbot', 'screaming frog', 'rogerbot',
  'barkrowler', 'megaindex', 'archive\\.org_bot', 'ia_archiver', 'heritrix', 'nutch', 'httrack',
  // outils, bibliothèques et navigateurs pilotés
  'curl/', 'wget', 'python-requests', 'python-urllib', 'python-httpx', 'aiohttp', 'scrapy', 'go-http-client', 'java/',
  'okhttp', 'apache-httpclient', 'libwww-perl', 'lwp::', 'node-fetch', 'axios/', 'undici', '^node$', 'got \\(',
  'postmanruntime', 'insomnia', 'httpie', 'php/', 'guzzlehttp', 'ruby', 'mechanize', 'zgrab', 'masscan', 'nmap', 'nikto',
  'sqlmap', 'nuclei', 'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'webdriver',
  // familles génériques
  'bot/', 'bot;', 'crawler', 'spider', 'scraper',
].join('|'), 'i');

export function estRobot(agent) {
  const ua = String(agent ?? '').trim();
  return !ua || ROBOTS.test(ua);
}

// Adresse du visiteur. Derrière LiteSpeed, Node voit toujours 127.0.0.1 : la vraie
// adresse est la dernière de X-Forwarded-For, ajoutée par le proxy (les précédentes
// peuvent venir du client). Rend null si elle est inconnue.
export function adresseClient(req) {
  const distante = req.socket?.remoteAddress ?? '';
  if (distante && !/^(127\.|::1$|::ffff:127\.)/.test(distante)) return distante;
  const transmises = String(req.headers['x-forwarded-for'] ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  return transmises.at(-1) ?? null;
}

// Compte les passages acceptés par clé sur une fenêtre glissante. passer() rend 0 et
// compte le passage s'il est permis, sinon le délai à attendre en millisecondes.
export function creerCompteur({ fenetreMs, maximum, maintenant = Date.now, clesMax = 20_000 }) {
  const passages = new Map(); // clé -> dates des passages, de la plus ancienne à la plus récente
  return {
    passer(cle) {
      const t = maintenant();
      const recents = (passages.get(cle) ?? []).filter((d) => t - d < fenetreMs);
      if (recents.length >= maximum) {
        passages.set(cle, recents);
        return fenetreMs - (t - recents[0]);
      }
      recents.push(t);
      passages.delete(cle); // remise en fin de file : les clés les plus anciennes partent d'abord
      passages.set(cle, recents);
      if (passages.size > clesMax) passages.delete(passages.keys().next().value);
      return 0;
    },
    attente(cle) {
      const t = maintenant();
      const recents = (passages.get(cle) ?? []).filter((d) => t - d < fenetreMs);
      return recents.length >= maximum ? fenetreMs - (t - recents[0]) : 0;
    },
  };
}

const MINUTE = 60_000;
export const LIMITES = {
  // Par visiteur. Une salle de démonstration partage souvent une seule adresse
  // (même Wi-Fi) : les limites laissent une trentaine de personnes essayer ensemble.
  audio: [{ fenetreMs: MINUTE, maximum: 20 }, { fenetreMs: 60 * MINUTE, maximum: 200 }],
  api: [{ fenetreMs: MINUTE, maximum: 600 }],
  fichiers: [{ fenetreMs: MINUTE, maximum: 1200 }],
  code: [{ fenetreMs: 15 * MINUTE, maximum: 5 }], // essais faux du code conseiller
  // Signalements enregistrés : par visiteur, et tous visiteurs confondus pour borner
  // la place prise par les messages vocaux. Seuls les signalements acceptés comptent.
  signalementsVisiteur: [{ fenetreMs: 24 * 60 * MINUTE, maximum: 100 }],
  signalementsJour: [{ fenetreMs: 24 * 60 * MINUTE, maximum: 500 }],
};

function memeOrigine(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  // Navigateur sans en-têtes Sec-Fetch : l'origine d'un POST doit être ce site.
  try {
    const hote = new URL(req.headers.origin).host;
    return [req.headers.host, req.headers['x-forwarded-host']].some((h) => h && h.split(',')[0].trim() === hote);
  } catch {
    return false;
  }
}

export function creerProtection({ limites = {}, maintenant = Date.now } = {}) {
  const compteurs = {};
  for (const [nom, regles] of Object.entries({ ...LIMITES, ...limites })) {
    compteurs[nom] = regles.map((r) => creerCompteur({ ...r, maintenant }));
  }
  const attenteDe = (nom, cle) => Math.max(0, ...compteurs[nom].map((c) => c.attente(cle)));
  // Un passage n'est compté que s'il est permis par toutes les fenêtres.
  function passer(nom, cle) {
    const attente = attenteDe(nom, cle);
    if (!attente) compteurs[nom].forEach((c) => c.passer(cle));
    return attente;
  }
  const refus = (statut, code, message, attenteMs = 0) => ({ statut, code, message, attente: Math.ceil(attenteMs / 1000) });
  // Sans adresse connue, les essais faux du code partagent un compteur : mieux vaut
  // bloquer l'écran conseiller un quart d'heure que laisser deviner le code.
  const cleCode = (req) => adresseClient(req) ?? 'inconnu';

  return {
    // Rend null si la requête peut passer, sinon { statut, code, message, attente }.
    verifier(req, url) {
      const p = url.pathname;
      if (p === '/robots.txt') return null;
      // La route d'état sert à la vérification du déploiement (curl).
      if (p !== '/api/etat' && estRobot(req.headers['user-agent'])) {
        return refus(403, 'robot', 'Accès refusé : ce site est réservé aux personnes, pas aux robots.');
      }
      const site = req.headers['sec-fetch-site'];
      if (site && !['same-origin', 'none'].includes(site) && req.headers['sec-fetch-mode'] !== 'navigate') {
        return refus(403, 'autre_site', 'Ce contenu ne peut être utilisé que sur AgriFon.');
      }
      const api = p.startsWith('/api/');
      const vocale = req.method === 'POST' && (p === '/api/prix' || p === '/api/signalements');
      if (req.method === 'POST' && api && !memeOrigine(req)) {
        return refus(403, 'origine', "Envoyez votre demande depuis l'application AgriFon.");
      }
      const client = adresseClient(req);
      if (client) {
        const attente = passer(vocale ? 'audio' : api ? 'api' : 'fichiers', client);
        if (attente) return refus(429, 'trop_de_demandes', 'Trop de demandes. Réessayez dans un moment.', attente);
      }
      // Les quotas de signalements sont seulement consultés ici : signalementAccepte()
      // les décompte une fois le signalement enregistré.
      if (vocale && p === '/api/signalements') {
        const parVisiteur = client ? attenteDe('signalementsVisiteur', client) : 0;
        if (parVisiteur) return refus(429, 'trop_de_demandes', 'Vous avez envoyé beaucoup de signalements aujourd’hui. Réessayez demain.', parVisiteur);
        const attente = attenteDe('signalementsJour', 'tous');
        if (attente) return refus(503, 'service_sature', 'Le service a reçu trop de signalements aujourd’hui. Réessayez plus tard.', attente);
      }
      return null;
    },
    signalementAccepte(req) {
      const client = adresseClient(req);
      if (client) passer('signalementsVisiteur', client);
      passer('signalementsJour', 'tous');
    },
    // Délai (en millisecondes) avant un nouvel essai du code conseiller, 0 si permis.
    codeBloque: (req) => Math.max(0, ...compteurs.code.map((c) => c.attente(cleCode(req)))),
    echecCode: (req) => compteurs.code.forEach((c) => c.passer(cleCode(req))),
  };
}
