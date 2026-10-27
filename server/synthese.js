// Voix des réponses en phrases entières : le texte fon de la réponse est synthétisé
// d'un seul tenant par la route de synthèse du labo (voix P1 de JML Traduction),
// ramené à 16 kHz et gardé en réserve sur disque, un fichier par phrase. Seuls les
// textes produits par AgriFon (enregistrer) peuvent être synthétisés. Quand le son
// n'est pas prêt, le téléphone joue les anciens extraits (server/voix.js).

import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { texteVoix } from './voix.js';
import { assembler, ecrireWav, lireWav, reechantillonner } from './wav.js';

export const URL_VOIX = 'https://51-159-167-70.sslip.io/app/api/tts-fon-p1';
export const VOIX_PAR_DEFAUT = 'homme2';
const JOUR_MS = 86_400_000;

// Morceaux de voix mis bout à bout. Chaque morceau commence par une majuscule : on
// ne la garde qu'au début d'une phrase.
export function texteADire(morceaux) {
  return morceaux.map((m) => m.normalize('NFC').trim()).filter(Boolean)
    .reduce((texte, m) => (texte === '' ? m
      : `${texte} ${/[.!?:]$/.test(texte) ? m : m.charAt(0).toLowerCase() + m.slice(1)}`), '');
}

// Regroupe des éléments, séparés par une espace, en morceaux de `max` caractères au plus.
function regrouper(elements, max) {
  const morceaux = [];
  for (const e of elements) {
    const dernier = morceaux.at(-1);
    if (dernier !== undefined && dernier.length + 1 + e.length <= max) morceaux[morceaux.length - 1] = `${dernier} ${e}`;
    else morceaux.push(e);
  }
  return morceaux;
}

// Une phrase trop longue est coupée après ses virgules, puis à ses espaces.
function couper(phrase, max) {
  if (phrase.length <= max) return [phrase];
  const parties = phrase.split(/(?<=,)\s+/);
  if (parties.length > 1) return parties.flatMap((p) => couper(p, max));
  return regrouper(phrase.split(/\s+/), max);
}

// Morceaux de `max` caractères au plus, coupés entre deux phrases.
export function decouperTexte(texte, max = 300) {
  return regrouper(texte.trim().split(/(?<=[.!?])\s+/).flatMap((p) => couper(p, max)), max);
}

// La voix fait partie de l'identifiant : changer de voix ne ressert pas les anciens sons.
export function idPhrase(texte, voix) {
  return createHash('sha1').update(`${voix}|${texteVoix(texte)}`).digest('hex').slice(0, 16);
}

export function creerAppelLabo({ url = URL_VOIX, identifiant, motDePasse, voix = VOIX_PAR_DEFAUT, delaiMs = 90_000, fetch = globalThis.fetch }) {
  const auth = `Basic ${Buffer.from(`${identifiant}:${motDePasse}`).toString('base64')}`;
  return async function appeler(texte) {
    const reponse = await fetch(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte, voix }),
      signal: AbortSignal.timeout(delaiMs),
    });
    if (!reponse.ok) throw new Error(`Synthèse refusée par le labo (HTTP ${reponse.status})`);
    const corps = Buffer.from(await reponse.arrayBuffer());
    if (corps.toString('latin1', 0, 4) !== 'RIFF' || corps.toString('latin1', 8, 12) !== 'WAVE') {
      throw new Error('Réponse du labo qui n’est pas un son WAV');
    }
    return corps;
  };
}

export function creerSynthese({
  dossier, appeler, voix = VOIX_PAR_DEFAUT, attenteMs = 20_000, maxFile = 20, pauseEchecMs = 300_000,
  maxOctets = 500_000_000, joursConservation = 30, maxIdentifiants = 5000, silenceMs = 250, frequence = 16_000,
  maintenant = Date.now,
}) {
  const textes = new Map(); // identifiant -> texte, du plus ancien au plus récent
  const enCours = new Map(); // identifiant -> promesse de la synthèse (true si le son est prêt)
  let file = Promise.resolve();
  let enFile = 0;
  let pauseJusqua = 0;
  let derniereErreur = null;
  const chemin = (id) => path.join(dossier, `${id}.wav`);

  async function present(id) {
    try {
      return (await stat(chemin(id))).isFile();
    } catch {
      return false;
    }
  }

  // Date de modification = dernier usage : c'est elle que la purge regarde.
  async function toucher(id) {
    const date = new Date(maintenant());
    await utimes(chemin(id), date, date).catch(() => {});
  }

  function noterEchec(e) {
    derniereErreur = { message: e.message, le: new Date(maintenant()).toISOString() };
    pauseJusqua = maintenant() + pauseEchecMs;
  }

  // Un appel par morceau, dans l'ordre ; fichier temporaire puis renommage, pour qu'un
  // son à moitié écrit ne soit jamais servi.
  async function synthetiser(texte, id) {
    const sons = [];
    for (const morceau of decouperTexte(texte)) {
      const son = lireWav(await appeler(morceau));
      sons.push(reechantillonner(son.echantillons, son.frequence, frequence));
    }
    await mkdir(dossier, { recursive: true });
    const temporaire = `${chemin(id)}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaire, ecrireWav({ frequence, echantillons: assembler(sons, frequence, silenceMs) }));
    await rename(temporaire, chemin(id));
  }

  // Lance la synthèse d'un identifiant, ou rejoint celle en cours. Une seule à la fois ;
  // null si la file est pleine ou si le labo vient d'échouer.
  function lancer(id) {
    if (enCours.has(id)) return enCours.get(id);
    if (maintenant() < pauseJusqua || enFile >= maxFile) return null;
    const texte = textes.get(id);
    enFile++;
    const tache = file.then(async () => {
      if (await present(id)) return true; // préparé entre-temps
      if (maintenant() < pauseJusqua) return false; // le précédent a échoué pendant l'attente
      try {
        await synthetiser(texte, id);
        return true;
      } catch (e) {
        noterEchec(e);
        return false;
      }
    }).finally(() => {
      enFile--;
      enCours.delete(id);
    });
    file = tache.catch(() => {});
    enCours.set(id, tache);
    return tache;
  }

  return {
    voix,
    enregistrer(texte) {
      const id = idPhrase(texte, voix);
      textes.delete(id);
      textes.set(id, texte);
      while (textes.size > maxIdentifiants) textes.delete(textes.keys().next().value);
      return id;
    },

    async obtenir(id, { attenteMs: attente = attenteMs } = {}) {
      if (await present(id)) {
        await toucher(id);
        return { etat: 'pret', chemin: chemin(id) };
      }
      if (!textes.has(id)) return { etat: 'inconnu' };
      const tache = lancer(id);
      if (!tache) return { etat: 'en_cours' };
      let minuterie;
      const delai = new Promise((ok) => { minuterie = setTimeout(() => ok(false), attente); });
      const pret = await Promise.race([tache, delai]);
      clearTimeout(minuterie);
      return pret ? { etat: 'pret', chemin: chemin(id) } : { etat: 'en_cours' };
    },

    // Une phrase à la fois, avec une pause entre deux synthèses ; arrêt après trois
    // échecs de suite, pour ne pas insister quand le labo est en panne.
    async preparer(liste, { pauseMs = 2000 } = {}) {
      const bilan = { faits: 0, deja: 0, echecs: 0, interrompu: false };
      // D'abord celles déjà en réserve : toujours dans la liste, servies ou non, elles
      // échappent à la purge, même si une panne du labo arrête la suite.
      const manquantes = [];
      for (const texte of liste) {
        const id = idPhrase(texte, voix);
        if (await present(id)) {
          await toucher(id);
          bilan.deja++;
        } else {
          manquantes.push([texte, id]);
        }
      }
      let echecsDeSuite = 0;
      for (const [texte, id] of manquantes) {
        if (await present(id)) { // faite entre-temps par le serveur, à la demande
          bilan.deja++;
          continue;
        }
        try {
          await synthetiser(texte, id);
          bilan.faits++;
          echecsDeSuite = 0;
        } catch (e) {
          noterEchec(e);
          bilan.echecs++;
          if (++echecsDeSuite >= 3) {
            bilan.interrompu = true;
            break;
          }
        }
        if (pauseMs) await new Promise((ok) => setTimeout(ok, pauseMs));
      }
      return bilan;
    },

    // Efface les sons inutilisés depuis `joursConservation` jours, puis les plus anciens
    // tant que la réserve dépasse `maxOctets`. Les fichiers temporaires abandonnés aussi.
    async purger() {
      let fichiers;
      try {
        fichiers = await readdir(dossier);
      } catch (e) {
        if (e.code === 'ENOENT') return { effaces: 0 };
        throw e;
      }
      const limite = maintenant() - joursConservation * JOUR_MS;
      let effaces = 0;
      const gardes = [];
      for (const f of fichiers) {
        const c = path.join(dossier, f);
        let infos;
        try {
          infos = await stat(c);
        } catch {
          continue;
        }
        if (f.endsWith('.tmp') && infos.mtimeMs < Date.now() - 3_600_000) await rm(c, { force: true });
        if (!f.endsWith('.wav')) continue;
        if (infos.mtimeMs < limite) {
          await rm(c, { force: true });
          effaces++;
        } else {
          gardes.push({ c, date: infos.mtimeMs, taille: infos.size });
        }
      }
      gardes.sort((a, b) => a.date - b.date);
      let total = gardes.reduce((s, g) => s + g.taille, 0);
      for (const g of gardes) {
        if (total <= maxOctets) break;
        await rm(g.c, { force: true });
        total -= g.taille;
        effaces++;
      }
      return { effaces };
    },

    async etat() {
      let enReserve = 0;
      let octets = 0;
      for (const f of await readdir(dossier).catch(() => [])) {
        if (!f.endsWith('.wav')) continue;
        const infos = await stat(path.join(dossier, f)).catch(() => null);
        if (!infos) continue;
        enReserve++;
        octets += infos.size;
      }
      return {
        en_reserve: enReserve,
        octets,
        plafond_octets: maxOctets,
        derniere_erreur: derniereErreur,
        pause_jusqua: pauseJusqua > maintenant() ? new Date(pauseJusqua).toISOString() : null,
      };
    },
  };
}

// La nouvelle voix est coupée en simulation, avec VOIX_PHRASES=0 ou sans les
// identifiants de l'API (les mêmes que pour la reconnaissance vocale).
export function creerSyntheseDepuisEnv(env, dossierDonnees, { simulation = false } = {}) {
  if (simulation || env.VOIX_PHRASES === '0' || !env.ASR_ID || !env.ASR_MDP) return null;
  const voix = env.VOIX_NOM || VOIX_PAR_DEFAUT;
  return creerSynthese({
    dossier: path.join(dossierDonnees, 'voix-phrases'),
    voix,
    appeler: creerAppelLabo({ url: env.VOIX_URL || URL_VOIX, identifiant: env.ASR_ID, motDePasse: env.ASR_MDP, voix }),
  });
}
