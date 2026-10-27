// Prépare à l'avance la voix des phrases fixes (accusés de réception de signalement
// pour chaque commune, produit non compris, marché compris sans produit) et des
// réponses de prix sur un seul produit, pour qu'elles soient lues aussitôt avec la
// voix des phrases entières. Lancé en arrière-plan après chaque import des prix (donc
// aussi à chaque déploiement) par scripts/voix/lancer-preparation.sh, qui fait attendre
// une préparation tant qu'une autre tourne :
//
//   bash scripts/voix/lancer-preparation.sh
//
// Une phrase déjà en réserve n'est pas refaite. Une seule synthèse à la fois, avec une
// pause entre deux, pour ne pas accaparer le GPU partagé du labo.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phrasesProduits, reponseProduit } from '../../server/prix.js';
import { creerTextes } from '../../server/reponses.js';
import { creerSyntheseDepuisEnv, texteADire } from '../../server/synthese.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Les textes exacts que le serveur fait dire (voir server/index.js et server/prix.js).
export function phrasesFixes({ reponses, base, communes, releves }) {
  const textes = creerTextes(reponses);
  const dire = (phrases) => texteADire(textes.joindre(phrases).voix ?? []);
  const titre = textes.phrase('signalement_transmis');
  const liste = [
    ...communes.map((c) => dire([titre, textes.phrase('signalement_recu_commune', { commune: c.nom })])),
    dire([titre, textes.phrase('signalement_recu_gps')]),
    dire([textes.phrase('prix_non_compris')]),
    ...base.marches
      .filter((m) => base.produits.some((p) => releves.prix[p.id]?.[m.id]))
      .map((m) => dire([textes.phrase('prix_marche_seul', { au_marche: m.au, marche: m.nom })])),
  ];
  return [...new Set(liste.filter(Boolean))];
}

// Toutes les réponses à une question sur un seul produit : sur un marché où il a un
// prix (les plus demandées, d'abord), sans marché, puis sur un marché sans son prix.
export function phrasesPrix({ reponses, base, releves }) {
  const textes = creerTextes(reponses);
  const dire = (reponse, marche) => texteADire(textes.joindre(phrasesProduits(textes, [reponse], marche)).voix ?? []);
  const ici = [];
  const ailleurs = [];
  for (const produit of base.produits) {
    for (const marche of [null, ...base.marches]) {
      const reponse = reponseProduit(base, releves, produit, null, marche);
      (reponse.ici ? ici : ailleurs).push(dire(reponse, marche));
    }
  }
  return [...new Set([...ici, ...ailleurs].filter(Boolean))];
}

async function lireJson(chemin) {
  return JSON.parse(await readFile(chemin, 'utf8'));
}

async function principal() {
  try {
    process.loadEnvFile(path.join(RACINE, '.env'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const env = process.env;
  const dossierDonnees = path.resolve(RACINE, env.DOSSIER_DONNEES || 'stockage');
  const synthese = creerSyntheseDepuisEnv(env, dossierDonnees, { simulation: env.ASR_SIMULATION === '1' });
  const heure = () => new Date().toISOString();
  if (!synthese) {
    console.log(`${heure()} voix préparée à l'avance : rien à préparer (phrases entières coupées).`);
    return;
  }
  const [reponses, base, { communes }] = await Promise.all(['reponses', 'referentiel', 'communes'].map((f) => lireJson(path.join(RACINE, 'data', `${f}.json`))));
  const releves = await lireJson(path.join(dossierDonnees, 'releves-prix.json'))
    .catch(() => lireJson(path.join(RACINE, 'data', 'releves-prix.json')));
  const fixes = phrasesFixes({ reponses, base, communes, releves });
  const prix = phrasesPrix({ reponses, base, releves });
  const liste = [...new Set([...fixes, ...prix])];
  const bilan = await synthese.preparer(liste, { pauseMs: 2000 });
  console.log(`${heure()} voix préparée à l'avance (${fixes.length} phrases fixes, ${prix.length} prix) : ${bilan.faits} faites, ${bilan.deja} déjà prêtes, ${bilan.echecs} échecs`
    + `${bilan.interrompu ? ', arrêt après trois échecs de suite' : ''}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`Voix préparée à l'avance : ${e.message}`);
    process.exit(1);
  });
}
