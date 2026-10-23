// Mesures d'usage pour le back office, sans donnée qui identifie une personne :
// identifiants anonymes vus chaque jour (pour compter les personnes et les
// retours), journal des demandes vocales (sans identifiant, sans IP, sans GPS)
// et refus de la protection par motif. Un fichier par jour et par type, effacé
// après 90 jours. Une mesure qui échoue ne remonte jamais d'erreur.

import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const JOUR_MS = 86_400_000;
const UNE_HEURE = 3_600_000; // Porto-Novo : UTC+1, sans heure d'été
const RETENTION_JOURS = 90;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLES_APPEL = ['date', 'service', 'resultat', 'code', 'duree_ms', 'duree_api_ms', 'duree_audio_s', 'transcription', 'reconnu', 'reference'];
const FICHIER_DATE = /^(visiteurs|journal|refus)-(\d{4}-\d{2}-\d{2})\.(txt|jsonl|json)$/;

export function jourLocal(date) {
  return new Date(date.getTime() + UNE_HEURE).toISOString().slice(0, 10);
}

const decaler = (jour, n) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * JOUR_MS).toISOString().slice(0, 10);
const joursJusqua = (au, n) => Array.from({ length: n }, (_, i) => decaler(au, i - n + 1)); // du plus ancien au plus récent

function classement(compte) {
  return [...compte].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 5).map(([nom, n]) => ({ nom, n }));
}

function compter(compte, nom) {
  if (nom) compte.set(nom, (compte.get(nom) ?? 0) + 1);
}

// `maxVisiteursParJour` borne la place que de faux identifiants pourraient prendre.
export function creerMesures(dossier, { maintenant = () => new Date(), maxVisiteursParJour = 10_000 } = {}) {
  let file = Promise.resolve();
  // Les tâches passent l'une après l'autre ; une erreur est consignée et avalée.
  function enFile(tache) {
    file = file.then(tache).catch((e) => console.error(`Mesures : ${e.message}`));
    return file;
  }
  const fichier = (type, jour, ext) => path.join(dossier, `${type}-${jour}.${ext}`);
  const preparer = () => mkdir(dossier, { recursive: true });

  const vusAujourdhui = { jour: null, ids: new Set() };
  const refusEnAttente = new Map(); // jour -> Map(motif -> n), pas encore écrits
  let minuterie = null;
  let dernierePurge = null;

  function purgerSiNouveauJour(jour) {
    if (dernierePurge === jour) return;
    dernierePurge = jour;
    enFile(() => purgerMaintenant());
  }

  async function purgerMaintenant() {
    let fichiers;
    try {
      fichiers = await readdir(dossier);
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    const limite = decaler(jourLocal(maintenant()), -(RETENTION_JOURS - 1));
    for (const f of fichiers) {
      const m = f.match(FICHIER_DATE);
      if (m && m[2] < limite) await rm(path.join(dossier, f), { force: true });
    }
  }

  async function ecrireRefus() {
    const lots = [...refusEnAttente];
    refusEnAttente.clear();
    if (!lots.length) return;
    await preparer();
    for (const [jour, motifs] of lots) {
      const lu = await lireRefusFichier(jour);
      for (const [motif, n] of motifs) lu[motif] = (lu[motif] ?? 0) + n;
      await writeFile(fichier('refus', jour, 'json'), JSON.stringify(lu));
    }
  }

  async function lireRefusFichier(jour) {
    try {
      return JSON.parse(await readFile(fichier('refus', jour, 'json'), 'utf8'));
    } catch {
      return {};
    }
  }

  async function lireLignes(chemin) {
    try {
      return (await readFile(chemin, 'utf8')).split('\n').filter(Boolean);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  async function lireAppels(jour) {
    const appels = [];
    for (const l of await lireLignes(fichier('journal', jour, 'jsonl'))) {
      try {
        appels.push(JSON.parse(l));
      } catch {
        // ligne abîmée : ignorée
      }
    }
    return appels;
  }

  purgerSiNouveauJour(jourLocal(maintenant()));

  return {
    // Rend true si l'identifiant est compté pour la première fois aujourd'hui.
    visite(identifiant) {
      try {
        if (typeof identifiant !== 'string' || !UUID_V4.test(identifiant)) return false;
        const jour = jourLocal(maintenant());
        purgerSiNouveauJour(jour);
        if (vusAujourdhui.jour !== jour) Object.assign(vusAujourdhui, { jour, ids: new Set() });
        const id = identifiant.toLowerCase();
        if (vusAujourdhui.ids.has(id) || vusAujourdhui.ids.size >= maxVisiteursParJour) return false;
        vusAujourdhui.ids.add(id);
        enFile(async () => {
          await preparer();
          await appendFile(fichier('visiteurs', jour, 'txt'), `${id}\n`);
        });
        return true;
      } catch (e) {
        console.error(`Mesures : ${e.message}`);
        return false;
      }
    },

    appel(entree) {
      try {
        const propre = Object.fromEntries(CLES_APPEL.map((c) => [c, entree[c] ?? null]));
        const jour = jourLocal(new Date(propre.date));
        purgerSiNouveauJour(jourLocal(maintenant()));
        enFile(async () => {
          await preparer();
          await appendFile(fichier('journal', jour, 'jsonl'), `${JSON.stringify(propre)}\n`);
        });
      } catch (e) {
        console.error(`Mesures : ${e.message}`);
      }
    },

    refus(motif) {
      try {
        const jour = jourLocal(maintenant());
        if (!refusEnAttente.has(jour)) refusEnAttente.set(jour, new Map());
        const motifs = refusEnAttente.get(jour);
        motifs.set(motif, (motifs.get(motif) ?? 0) + 1);
        if (!minuterie) {
          minuterie = setTimeout(() => {
            minuterie = null;
            enFile(ecrireRefus);
          }, 5000);
          minuterie.unref?.();
        }
      } catch (e) {
        console.error(`Mesures : ${e.message}`);
      }
    },

    async vider() {
      if (minuterie) {
        clearTimeout(minuterie);
        minuterie = null;
      }
      await enFile(ecrireRefus);
    },

    async lireJournal({ apres = null, limite = 50 } = {}) {
      await file;
      let fichiers = [];
      try {
        fichiers = (await readdir(dossier)).filter((f) => f.startsWith('journal-')).sort().reverse();
      } catch {
        return [];
      }
      const resultat = [];
      for (const f of fichiers) {
        const jour = f.match(FICHIER_DATE)?.[2];
        if (!jour || (apres && jour < jourLocal(new Date(apres)))) break;
        const appels = (await lireAppels(jour))
          .filter((a) => !apres || a.date > apres)
          .sort((a, b) => b.date.localeCompare(a.date));
        resultat.push(...appels);
        if (resultat.length >= limite) break;
      }
      return resultat.slice(0, limite);
    },

    async statistiques({ jours = 7, signalements = [] } = {}) {
      await file;
      const au = jourLocal(maintenant());
      const periode = joursJusqua(au, jours);
      const dansPeriode = new Set(periode);
      const quatorze = joursJusqua(au, 14);

      const visiteurs = new Map(); // jour -> Set
      for (const jour of new Set([...periode, ...quatorze])) {
        visiteurs.set(jour, new Set(await lireLignes(fichier('visiteurs', jour, 'txt'))));
      }
      const joursParId = new Map();
      for (const jour of periode) for (const id of visiteurs.get(jour)) joursParId.set(id, (joursParId.get(id) ?? 0) + 1);

      const demandes = { comprises: 0, non_comprises: 0, erreurs: 0 };
      const produits = new Map();
      const marches = new Map();
      const heures = Array(24).fill(0);
      for (const jour of periode) {
        for (const a of await lireAppels(jour)) {
          if (a.resultat === 'compris') demandes.comprises++;
          else if (a.resultat === 'non_compris') demandes.non_comprises++;
          else demandes.erreurs++;
          heures[new Date(Date.parse(a.date) + UNE_HEURE).getUTCHours()]++;
          for (const p of a.reconnu?.produits ?? []) compter(produits, p);
          compter(marches, a.reconnu?.marche);
        }
      }

      const retenus = signalements.filter((s) => !s.simulation && dansPeriode.has(jourLocal(new Date(s.recu_le))));
      const pris = retenus.filter((s) => s.statut === 'pris_en_charge' && s.pris_en_charge_le);
      const communes = new Map();
      for (const s of retenus) compter(communes, s.localisation?.commune?.nom);
      const delais = pris.map((s) => Date.parse(s.pris_en_charge_le) - Date.parse(s.recu_le));

      return {
        periode: { du: periode[0], au },
        personnes: { total: joursParId.size, revenues: [...joursParId.values()].filter((n) => n >= 2).length },
        parJour: quatorze.map((jour) => ({ jour, personnes: visiteurs.get(jour).size })),
        demandes,
        signalements: {
          total: retenus.length,
          pris: pris.length,
          delai_moyen_ms: delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : null,
        },
        produits: classement(produits),
        marches: classement(marches),
        communes: classement(communes),
        heures,
      };
    },

    async refusParJour(jours) {
      await file;
      const au = jourLocal(maintenant());
      const resultat = [];
      for (const jour of joursJusqua(au, jours).reverse()) {
        const motifs = await lireRefusFichier(jour);
        for (const [motif, n] of refusEnAttente.get(jour) ?? []) motifs[motif] = (motifs[motif] ?? 0) + n;
        resultat.push({ jour, motifs });
      }
      return resultat;
    },

    purger: () => enFile(purgerMaintenant),
  };
}
