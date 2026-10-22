# Solutions après un signalement : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objectif :** après un signalement où la culture et au moins un symptôme sont reconnus, proposer à l'agriculteur des solutions (texte fon et français, audio fon) tirées de sources reconnues, et les montrer au conseiller.

**Architecture :** un fichier de données `data/solutions.json` (sources, phrases, gestes, cas documentés) et un module pur `server/solutions.js` qui choisit les solutions selon l'analyse du signalement et la saison (`server/saison.js`). Le serveur joint le résultat à la réponse et l'enregistre dans le registre. La PWA et l'écran conseiller l'affichent. Un contrôle de test vérifie, par `server/pesticides.js` et `data/pesticides.json` (extrait de la liste COAHP), que tout produit nommé est autorisé au Bénin.

**Pile :** Node.js 20.12 ou plus, modules ES, sans dépendance npm ; tests `node --test` ; PWA en JavaScript sans framework ; extraction du PDF COAHP en Python avec `pypdf` (outil de poste, hors serveur) ; voix générées par l'API FongLab.

**Spécification :** `docs/superpowers/specs/2026-10-22-solutions-signalement-design.md` (à lire avant chaque tâche).

## Contraintes globales

- Aucune dépendance ajoutée à `package.json`. Node.js ≥ 20.12.
- Tests en `node:test` et `node:assert/strict`, fichiers `test/*.test.js`, comme l'existant.
- Noms de code en français, comme le reste du dépôt. Messages de commit en anglais, Conventional Commits, sans aucune trace d'outil d'IA (règle `git-sans-trace-ia`).
- Textes affichés : français sans tiret cadratin ni formule toute faite ; fon en grand, français dessous (fonction `bilingue` existante).
- Textes exacts : titre « En attendant le conseiller, vous pouvez : » ; hypothèses « C'est probablement {probleme}. » (`nette`) et « Ce peut être {probleme}. » (`possible`) ; étiquette « Traitement documenté » ; mention « À confirmer avec un conseiller. » ; lien « Voir la vidéo en fon (Access Agriculture) » ; bloc conseiller « Solutions proposées ».
- Au plus 4 éléments (traitement compris), au plus 2 problèmes nommés, au plus 1 traitement.
- Doses recopiées telles que la source les écrit, en chiffres dans le fon affiché, en toutes lettres fon dans le champ `voix`.
- Un traitement n'est montré que si le cas est `nette`, que sa source a `pour_le_benin: true` et, pour un produit (`type: "produit"`), qu'il passe `verifierTraitement`. Les préparations faites à la ferme (`type: "preparation"`) ne passent pas par la liste COAHP.
- Jamais de nom commercial affiché ; seulement la matière active et sa concentration.
- Access Agriculture : lien seulement, aucun texte repris de leurs pages.
- CSP inchangée (`script-src 'self'`, rien de chargé depuis l'extérieur).
- Le plan s'arrête à la PR. La mise en ligne attend la relecture du fon par le locuteur.

## Points à surveiller en revue

1. Un signalement enregistré avant cette fonction n'a pas de champ `solutions` : l'écran conseiller doit l'afficher sans erreur (test dans la tâche 5, garde dans la tâche 7).
2. Un extrait audio manquant pour une seule solution : la section s'affiche quand même, sans bouton d'écoute (`solutions.voix === null`) (test dans la tâche 5).
3. Signalement localisé par GPS seulement, sans commune : saison inconnue, aucun geste marqué d'une saison (test dans la tâche 5).
4. Heure de Porto-Novo contre UTC à une limite de saison : le 31 mars à 23 h 30 UTC est le 1er avril à Porto-Novo (test dans la tâche 1).
5. Deux symptômes reconnus : chacun fournit au moins un élément, à tour de rôle (test dans la tâche 3).

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `server/saison.js` (nouveau) | saison d'un département à une date |
| `server/solutions.js` (nouveau) | choix des solutions, morceaux de voix des solutions |
| `server/pesticides.js` (nouveau) | règle d'autorisation d'un traitement |
| `data/solutions.json` (nouveau) | sources, phrases, gestes, gestes par symptôme et par culture, cas |
| `data/pesticides.json` (nouveau) | liste COAHP extraite, groupes de cultures, interdits nationaux |
| `scripts/pesticides/extraire_coahp.py` (nouveau) | extraction du PDF COAHP vers `data/pesticides.json` |
| `scripts/relecture/csv.js`, `scripts/relecture-solutions.js` (nouveaux) | export et réimport CSV pour le locuteur |
| `data/lexique.json` | symptôme `striga` |
| `server/index.js` | chargement, réponse et enregistrement des solutions |
| `server/voix.js`, `scripts/lister-voix.js`, `scripts/voix/generer.js`, `scripts/voix/evaluer.js` | morceaux des solutions dans la liste des extraits |
| `public/js/app.js`, `public/js/conseiller.js`, `public/css/app.css`, `public/sw.js` | affichage |
| `test/saison.test.js`, `test/solutions.test.js`, `test/solutions-donnees.test.js`, `test/pesticides.test.js`, `test/relecture.test.js`, `test/fixtures/solutions.json`, `test/fixtures/pesticides.json` (nouveaux) | tests |

## Schéma de `data/solutions.json`

Fixé ici parce que plusieurs tâches en dépendent.

```json
{
  "version": "2026-10-22",
  "sources": {
    "inrab-recueil-2020": { "editeur": "INRAB", "titre": "Recueil des technologies agricoles prometteuses", "annee": 2020, "url": "https://…", "licence": null, "pour_le_benin": true }
  },
  "phrases": {
    "titre":        { "fr": "En attendant le conseiller, vous pouvez :", "fon": "…", "voix": "…" },
    "probablement": { "fr": "C'est probablement {probleme}.", "fon": "… {probleme} …", "voix": "… | {probleme}" },
    "possible":     { "fr": "Ce peut être {probleme}.", "fon": "…", "voix": "…" },
    "mention":      { "fr": "À confirmer avec un conseiller.", "fon": "…", "voix": "…" }
  },
  "gestes": {
    "arroser": { "fr": "…", "fon": "…", "voix": "…", "sources": [{ "id": "aa-gombo", "detail": "vidéo" }], "saison": "seche" }
  },
  "par_symptome": { "jaunissement": ["fumure-organique", "desherber", "arroser", "drainer"] },
  "par_culture": { "gombo": { "croissance": ["gombo-compost-pied"] } },
  "cas": [
    {
      "id": "niebe-foreurs-gousses",
      "culture": "haricot",
      "symptomes": ["ravageurs", "feuilles_mangees"],
      "parties": ["fruits"],
      "termes": { "fr": [], "fon": [] },
      "certitude": "nette",
      "probleme": { "fr": "les foreurs des gousses (Maruca)", "fon": "…" },
      "gestes": ["…"],
      "traitement": {
        "type": "preparation",
        "fr": "…", "fon": "…", "voix": "…",
        "securite": { "fr": "…", "fon": "…", "voix": "…" },
        "matieres": [], "cible": null,
        "reserves": ["Suppose un pulvérisateur à très bas volume (10 l/ha)."],
        "sources": [{ "id": "inrab-recueil-2020", "detail": "fiche M-11, p. 221" }]
      },
      "sources": [{ "id": "inrab-recueil-2020", "detail": "fiche M-11" }],
      "video": { "url": "https://www.accessagriculture.org/…", "titre": "…" }
    }
  ]
}
```

Champs facultatifs : `saison` (geste), `parties`, `termes`, `traitement`, `traitement.securite`, `video`. Un produit a `type: "produit"`, `matieres: [{ "nom": "spinosad", "concentration": "480 g/l" }]` et `cible` (nom scientifique du ravageur ou de la maladie). Le champ `voix` d'un geste ou d'un traitement est le fon coupé par `|`, nombres en toutes lettres.

---

### Task 1 : saison d'un département

**Fichiers :** créer `server/saison.js`, `test/saison.test.js`.

**Interfaces :**
- Produit : `saisonDe(departement: string | null, date: Date): 'pluies' | 'seche' | null`.

- [ ] **Étape 1 : écrire le test**

```js
const d = (iso) => new Date(iso);
test('Sud : deux saisons des pluies, transitions inconnues', () => {
  assert.equal(saisonDe('Atlantique', d('2026-05-10T12:00:00Z')), 'pluies');
  assert.equal(saisonDe('Ouémé', d('2026-08-15T12:00:00Z')), 'seche');
  assert.equal(saisonDe('Mono', d('2026-09-20T12:00:00Z')), 'pluies');
  assert.equal(saisonDe('Littoral', d('2026-11-05T12:00:00Z')), null);
  assert.equal(saisonDe('Couffo', d('2027-01-10T12:00:00Z')), 'seche');
  assert.equal(saisonDe('Plateau', d('2026-03-25T12:00:00Z')), null);
});
test('Zou et Collines : août inconnu (petite saison sèche faible)', () => {
  assert.equal(saisonDe('Zou', d('2026-08-15T12:00:00Z')), null);
  assert.equal(saisonDe('Collines', d('2026-06-15T12:00:00Z')), 'pluies');
});
test('Nord et Alibori', () => {
  assert.equal(saisonDe('Borgou', d('2026-04-15T12:00:00Z')), null);
  assert.equal(saisonDe('Donga', d('2026-07-01T12:00:00Z')), 'pluies');
  assert.equal(saisonDe('Atacora', d('2027-02-01T12:00:00Z')), 'seche');
  assert.equal(saisonDe('Alibori', d('2026-05-15T12:00:00Z')), null);
  assert.equal(saisonDe('Alibori', d('2026-06-02T12:00:00Z')), 'pluies');
});
test('heure de Porto-Novo, département inconnu', () => {
  assert.equal(saisonDe('Atlantique', d('2026-03-31T23:30:00Z')), 'pluies'); // 1er avril à Porto-Novo
  assert.equal(saisonDe(null, d('2026-05-10T12:00:00Z')), null);
  assert.equal(saisonDe('Inconnu', d('2026-05-10T12:00:00Z')), null);
});
```

- [ ] **Étape 2 : lancer `node --test test/saison.test.js`** ; attendu : échec, module introuvable.
- [ ] **Étape 3 : écrire `saisonDe`** dans `server/saison.js`. Date ramenée à l'heure de Porto-Novo (UTC+1, sans heure d'été). Bornes, jour inclus :
  - Littoral, Atlantique, Ouémé, Plateau, Mono, Couffo : pluies du 1/4 au 31/7 et du 1/9 au 31/10 ; sèche en août et du 16/11 au 20/3 ; inconnue du 1/11 au 15/11 et du 21/3 au 31/3.
  - Zou, Collines : même règle, mais août inconnu.
  - Borgou, Atacora, Donga : pluies du 1/5 au 31/10 ; sèche du 16/11 au 31/3 ; inconnue en avril et du 1/11 au 15/11.
  - Alibori : pluies du 1/6 au 31/10 ; sèche du 16/11 au 30/4 ; inconnue en mai et du 1/11 au 15/11.
  - Un commentaire cite Météo-Bénin, normales 1991-2020.
- [ ] **Étape 4 : relancer le test** ; attendu : succès.
- [ ] **Étape 5 : commit** `feat(server): tell the rainy or dry season of a department`.

### Task 2 : symptôme « plante parasite (striga) »

**Fichiers :** modifier `data/lexique.json`, `test/signalement.test.js`.

- [ ] **Étape 1 : ajouter le test**

```js
test('striga reconnu seulement quand il est nommé', () => {
  const ids = (t) => analyserSignalement(lexique, communes, t).symptomes.map((s) => s.id);
  assert.deepEqual(ids('Mon maïs a du striga'), ['striga']);
  assert.deepEqual(ids('une plante parasite dans le sorgho'), ['striga']);
  assert.deepEqual(ids('Gbàdé ce ama jaunissent'), ['jaunissement']);
});
```

- [ ] **Étape 2 : lancer `node --test test/signalement.test.js`** ; attendu : échec du nouveau test.
- [ ] **Étape 3 : ajouter à `symptomes`** `{ "id": "striga", "libelle": "Plante parasite (striga)", "fon": [], "fr": ["striga", "plante parasite", "plantes parasites", "herbe parasite", "herbes parasites"] }`. Le fon sera fourni par le locuteur.
- [ ] **Étape 4 : relancer** ; attendu : succès, et `npm test` toujours vert.
- [ ] **Étape 5 : commit** `feat(data): recognize striga when the farmer names it`.

### Task 3 : choix des solutions (module pur)

**Fichiers :** créer `server/solutions.js`, `test/solutions.test.js`, `test/fixtures/solutions.json` (petit jeu : 2 cultures, 3 symptômes, gestes avec et sans saison, un cas `nette` avec préparation, un cas `nette` avec `termes`, un cas `possible` avec traitement, un cas avec `parties`).

**Interfaces :**
- Consomme : `saisonDe` (tâche 1) ; `creerTextes` de `server/reponses.js`, appelé avec `{ phrases: donnees.phrases, unites: {} }`, pour remplir `{probleme}`.
- Produit :
  - `choisirSolutions(donnees, analyse, { departement, date, transcription }): Solutions | null`. `analyse` est le retour de `analyserSignalement`. Rend `null` sans culture ou sans symptôme.
  - `Solutions = { version, titre: {fr, fon}, problemes: [{ id, certitude, fr, fon }], elements: [Element], mention: {fr, fon}, morceaux: string[] }`.
  - `Element = { type: 'traitement' | 'geste', id, fr, fon, securite?: {fr, fon}, reserves?: string[], sources: [{ id, nom, detail, url }], video?: { url, titre } }` ; `nom` vaut « éditeur, titre » de la source ; `id` vaut l'identifiant du geste, ou `<id du cas>.traitement` pour un traitement ; `video` est portée par le premier élément issu du cas.
  - `morceaux` : les morceaux de voix dans l'ordre de lecture (titre, problèmes, éléments et leur sécurité, mention).
  - `morceauxSolutions(donnees): string[]` : tous les morceaux que les solutions peuvent dire (phrases fixes, nom fon de chaque problème à la place de `{probleme}`, voix de chaque geste, traitement et sécurité).

- [ ] **Étape 1 : écrire les tests** (noms et assertions) :
  - `aucune solution sans culture ou sans symptôme` : `null` pour `{ culture: null, … }` et pour `symptomes: []`.
  - `cas nette : problème « probablement », traitement en premier` : `problemes[0].fr` commence par `C'est probablement` ; `elements[0].type === 'traitement'`.
  - `cas possible : « Ce peut être », jamais de traitement` : aucun élément de type `traitement`.
  - `mots déclencheurs absents : le cas devient possible` : sans « puceron » dans la transcription, `problemes[0].certitude === 'possible'` et pas de traitement ; avec « pucerons », `nette` et un traitement.
  - `partie exigée` : le cas à `parties: ['fruits']` ne s'applique pas si seules les feuilles sont dites.
  - `saison connue : gestes de la saison seulement ; saison inconnue : aucun geste marqué` : avec `departement: 'Atlantique'` en août, le geste `seche` est présent et le geste `pluies` absent ; avec `departement: null`, aucun des deux.
  - `plafonds` : au plus 4 éléments, au plus 2 problèmes, au plus 1 traitement, sans doublon de geste.
  - `deux symptômes : chacun contribue` : avec deux symptômes à gestes distincts, les éléments contiennent au moins un geste de chacun.
  - `morceaux` : `morceaux` commence par les morceaux du titre et finit par ceux de la mention ; `morceauxSolutions(fixture)` contient chacun d'eux.
- [ ] **Étape 2 : lancer `node --test test/solutions.test.js`** ; attendu : échec.
- [ ] **Étape 3 : écrire `choisirSolutions` et `morceauxSolutions`** en suivant l'ordre de la spécification (« Choix des solutions », points 1 à 7). Les `termes` d'un cas sont cherchés avec `chercherExact` de `server/texte.js` sur `mots(transcription)`. Ordre des gestes : ceux des cas, puis `par_culture[culture][symptome]`, puis `par_symptome[symptome]`, symptômes pris à tour de rôle.
- [ ] **Étape 4 : relancer** ; attendu : succès.
- [ ] **Étape 5 : commit** `feat(server): choose solutions for a crop disease report`.

### Task 4 : données de base (sources, phrases, gestes par défaut)

**Fichiers :** créer `data/solutions.json`, `test/solutions-donnees.test.js`.

- [ ] **Étape 1 : écrire `test/solutions-donnees.test.js`** :
  - `chaque élément a fr, fon, voix et des sources existantes` : phrases, gestes, problèmes (fr, fon), traitements et sécurité ; chaque `sources[].id` existe dans `sources`.
  - `chaque combinaison culture × symptôme donne au moins deux gestes sans saison` : pour les 19 cultures et les 9 symptômes de `lexique.json`, `choisirSolutions` avec `departement: null` rend au moins 2 éléments de type `geste`.
  - `un traitement vient d'une source faite pour le Bénin et d'un cas nette` : pour chaque cas avec `traitement`, `certitude === 'nette'` et toutes ses sources ont `pour_le_benin: true`.
  - `références croisées` : tout identifiant de geste cité existe ; toute culture et tout symptôme cités existent dans le lexique.
- [ ] **Étape 2 : lancer** ; attendu : échec (fichier absent).
- [ ] **Étape 3 : écrire `data/solutions.json`** :
  - `sources` : recueil INRAB 2020, guide IITA/INRAB 2010 (`pour_le_benin: true`), guides FAO lus (i9124fr, i3722f, i3278f, x5039e ; `pour_le_benin: true`), fiches Plantwise lues (`pour_le_benin: false`), pages Access Agriculture citées (`pour_le_benin: false`). URL dans la section « Ce que les recherches ont trouvé » de la spécification.
  - `phrases` : les quatre textes exacts des contraintes globales, en fr, fon et voix.
  - `gestes` et `par_symptome` : 2 à 4 gestes par symptôme, dont au moins 2 sans `saison`. Les gestes saisonniers s'appellent exactement `arroser` (`saison: "seche"`) et `drainer` (`saison: "pluies"`) : la tâche 5 les teste par ces identifiants. Base minimale :
    - jaunissement : fumure organique, désherber, arroser (`seche`), drainer (`pluies`) ;
    - taches : retirer et brûler les feuilles malades, ne pas composter les plants malades, espacer pour aérer ;
    - flétrissement : arracher et sortir les plants fanés, pailler, arroser (`seche`), drainer (`pluies`) ;
    - ravageurs : visiter le champ deux fois par semaine, écraser œufs et insectes à la main, désherber les bordures ;
    - feuilles mangées : ramasser les chenilles à la main, retirer les feuilles roulées, visiter deux fois par semaine ;
    - pourriture : retirer et brûler les parties pourries, récolter sans blesser et bien sécher, drainer (`pluies`) ;
    - déformation : arracher les plants très déformés, semences ou boutures saines à la prochaine saison, pièges jaunes ;
    - croissance : fumure organique, désherber, alterner avec une légumineuse, arroser (`seche`) ;
    - striga : arracher le striga avant ses fleurs, apporter du compost, alterner avec une légumineuse.
  - Chaque geste cite une source lue (spécification et rapports de recherche). Fon rédigé d'après les textes publiés, comme `data/reponses.json`.
- [ ] **Étape 4 : relancer** puis `npm test` ; attendu : succès.
- [ ] **Étape 5 : commit** `feat(data): add sources, phrases and default actions for each symptom`.

### Task 5 : serveur et registre

**Fichiers :** modifier `server/index.js`, `test/serveur.test.js`.

**Interfaces :**
- Consomme : `choisirSolutions` (tâche 3), `data/solutions.json` (tâche 4).
- Produit : `creerApplication({ …, solutions = null })`. Réponse de `POST /api/signalements` : champ `solutions` = `Solutions` sans `morceaux`, plus `voix: string[] | null` (`voix.fichiers(morceaux)`). Le registre garde `solutions` sans `morceaux` ni `voix`. `GET /api/signalements` le rend tel quel.

- [ ] **Étape 1 : écrire les tests** (le `demarrer` du test charge `lire('solutions.json')`) :
  - `signalement : solutions jointes et enregistrées` : avec la fausse ASR (« gbàdé ama jaunissent »), `r.solutions.elements.length >= 2`, `r.solutions.mention.fr === 'À confirmer avec un conseiller.'` ; la liste conseiller (`GET /api/signalements`) rend les mêmes `elements` pour cette référence.
  - `signalement : voix des solutions nulle s'il manque un extrait, section présente` : avec `creerVoix('/inexistant')`, `r.solutions.voix === null` et `r.solutions.elements.length >= 2`.
  - `signalement localisé par GPS seulement : aucun geste de saison` : avec `?lat=6.4&lon=2.3` et sans commune, aucun élément d'identifiant `arroser` ni `drainer`.
  - `signalement sans symptôme reconnu : solutions nulles` : transcription « blabla », `r.solutions === null`.
  - `ancien signalement sans solutions : liste conseiller intacte` : écrire dans le registre une entrée sans `solutions`, `GET /api/signalements` répond 200 et l'entrée a `solutions` absent ou `null`.
- [ ] **Étape 2 : lancer `node --test test/serveur.test.js`** ; attendu : échec des nouveaux tests.
- [ ] **Étape 3 : modifier `server/index.js`** : `demarrer` lit `data/solutions.json` ; la route `POST /api/signalements` appelle `choisirSolutions(solutions, analyse, { departement: commune?.departement ?? null, date: new Date(), transcription: texte })` avant `registre.ajouter`, enregistre le résultat sans `morceaux`, et répond avec `voix`.
- [ ] **Étape 4 : relancer** puis `npm test` ; attendu : succès.
- [ ] **Étape 5 : commit** `feat(server): answer and store solutions with each report`.

### Task 6 : écran de l'agriculteur

**Fichiers :** modifier `public/js/app.js`, `public/css/app.css`, `public/sw.js`.

**Interfaces :**
- Consomme : `s.solutions` de la tâche 5 ; `el`, `bilingue`, `lecture` existants.
- Produit : `sectionSolutions(solutions): HTMLElement | null`, appelée dans `afficherSignalement` entre le tableau `recap` et `vousAvezDit(...)`.

- [ ] **Étape 1 : écrire `sectionSolutions`** : rien si `solutions` est nul ; sinon une `section.solutions` avec le titre bilingue, une ligne par problème (`bilingue`), une `div.solution` par élément (`bilingue`, et pour un traitement : étiquette `span.solution-etiquette` « Traitement documenté », classe `solution-traitement`, `bilingue(securite)`), la source en `p.solution-source` (« Source : {nom}, {detail} »), le lien vidéo s'il existe (`target="_blank" rel="noopener"`), puis `lecture(solutions.voix)` et la mention bilingue en `p.solutions-mention`.
- [ ] **Étape 2 : styles** dans `app.css`, dans l'esprit des cartes existantes (`.carte`, `.bilingue`, `.lecture`) ; étiquette de traitement en vert foncé (`var(--vert)`).
- [ ] **Étape 3 : `public/sw.js`** : `CACHE = 'agrifon-v6'`.
- [ ] **Étape 4 : vérifier dans un navigateur** : `npm run simulation`, ouvrir http://localhost:3000 en largeur 390 px, onglet « Signaler », envoyer un fichier audio quelconque. La simulation répond « gbàdé ama jaunissent » (maïs, jaunissement) puis « timáti ama taches » (tomate, taches). Attendu : la section apparaît sous le tableau, sans défilement horizontal, mention en bas. Aucune erreur dans la console.
- [ ] **Étape 5 : commit** `feat(pwa): show suggested solutions after a report`.

### Task 7 : écran du conseiller

**Fichiers :** modifier `public/js/conseiller.js`, `public/css/app.css`.

- [ ] **Étape 1 : écrire `blocSolutions(solutions): HTMLElement | null`** et l'insérer dans `carte(s)` après le `dl.recap` : titre « Solutions proposées », problèmes, puis chaque élément en français d'abord et fon dessous, étiquette « Traitement documenté », sécurité, réserves en liste (`ul.solution-reserves`), source avec lien. Rien si `s.solutions` est absent ou nul.
- [ ] **Étape 2 : vérifier** : `npm run simulation`, faire un signalement, ouvrir http://localhost:3000/conseiller : le bloc apparaît. Avec un registre contenant un ancien signalement sans `solutions`, la carte s'affiche sans erreur.
- [ ] **Étape 3 : commit** `feat(pwa): show the advisor the solutions given to the farmer`.

### Task 8 : produits autorisés au Bénin

**Fichiers :** créer `scripts/pesticides/extraire_coahp.py`, `data/pesticides.json`, `server/pesticides.js`, `test/pesticides.test.js`, `test/fixtures/pesticides.json`.

**Interfaces :**
- Produit :
  - `data/pesticides.json` : `{ liste: { titre, url, date }, groupes: { "<libellé du groupe dans la liste>": ["<id culture>", …] }, produits: [{ nom, matieres: [{ nom, concentration }], usages: [{ texte, cultures: ["<id>"], cible }], autorisation: { type: "homologation" | "apv", fin: "AAAA-MM-JJ" | null } }], interdits: [{ matiere, texte }] }`.
  - `verifierTraitement(traitement, culture: string, pesticides): { autorise: boolean, raisons: string[] }`.

- [ ] **Étape 1 : écrire `test/pesticides.test.js`** sur la fixture (trois produits fictifs et un interdit) :
  - `autorisé : même matière et concentration, culture et cible couvertes` → `autorise === true`.
  - `refusé : autre concentration` ; `refusé : culture absente` ; `refusé : culture couverte par un groupe seulement si le groupe la contient` ; `refusé : cible différente` ; `refusé : autorisation expirée à la date de la liste` ; `refusé : matière interdite au Bénin`. Chaque refus a une `raisons` non vide.
  - Concentrations comparées sans espaces ni casse (« 480 g/L » = « 480 g/l »). Cible comparée sur le genre (premier mot du nom scientifique), sans casse.
- [ ] **Étape 2 : lancer** ; attendu : échec.
- [ ] **Étape 3 : écrire `verifierTraitement`** dans `server/pesticides.js`.
- [ ] **Étape 4 : écrire `scripts/pesticides/extraire_coahp.py <pdf> <sortie.json>`**, avec `pypdf` (en-tête du script : installation dans un environnement virtuel du poste, `pip install pypdf`). Source : https://insah.cilss.int/wp-content/uploads/2026/08/1ere-liste-regionale_COAHP-Version-2023_13-08-2026.pdf. Les noms de culture de la liste sont rapprochés des identifiants du lexique ; les groupes rencontrés (cultures maraîchères, légumineuses…) sont listés dans `groupes`, à compléter à la main. `interdits` : endosulfan (arrêté n° 447 du 5 novembre 2009), dichlorvos (Conseil des ministres du 1er juillet 2026), DDT, aldrine, dieldrine, chlordane, heptachlore, mirex, toxaphène (polluants organiques persistants).
- [ ] **Étape 5 : générer `data/pesticides.json`** et vérifier : `node -e "const p=require('./data/pesticides.json'); console.log(p.produits.length)"` affiche 844 (à quelques unités près si des lignes du PDF sont fusionnées ; écart à expliquer dans le commit), et le produit au dichlorvos de la liste est bien présent (pour prouver que la liste des interdits sert).
- [ ] **Étape 6 : ajouter à `test/solutions-donnees.test.js`** : `chaque produit nommé passe la règle d'autorisation` (pour tout `traitement.type === 'produit'`, `verifierTraitement(...).autorise`).
- [ ] **Étape 7 : `npm test`** ; attendu : succès.
- [ ] **Étape 8 : commit** `feat(data): check named products against the COAHP list and national bans`.

### Task 9 : contenu, céréales, légumineuses et coton

**Fichiers :** modifier `data/solutions.json`.

- [ ] **Étape 1 : ajouter les cas** (problème en fr et fon, gestes, sources, vidéo en fon si elle existe) :
  - `mais-chenille-legionnaire` : maïs ; ravageurs, feuilles mangées ; `possible` ; gestes FAO i9124fr (visiter deux fois par semaine au stade végétatif, écraser pontes et jeunes chenilles) ; vidéo Access Agriculture « killing fall armyworms naturally » si la version fon existe.
  - `mais-striga`, `sorgho-striga` : symptôme `striga` ; `nette` ; gestes INRAB fiche D-20 (rotation ou culture intercalaire, plantes pièges, destruction avant floraison, variétés tolérantes).
  - `niebe-foreurs-gousses` : haricot ; ravageurs, feuilles mangées ; partie `fruits` ; `nette` ; traitement `preparation` INRAB fiche M-11 : « 15 kg de feuilles de neem ou de papayer par hectare, pilées, dans 10 litres d'eau avec ½ pain de savon ; laisser reposer au moins 12 heures, filtrer ; dès l'apparition des boutons floraux, 6 traitements tous les 5 jours » ; réserve « Suppose un pulvérisateur à très bas volume (10 l/ha). ».
  - `coton-pucerons` : coton ; déformation, ravageurs ; `termes.fr` « puceron », « pucerons » ; `nette` ; traitement `preparation` FAO i3722f p. 26-27 : « 500 g de poudre d'amande de neem, 10 l d'eau, 200 g de savon, 100 ml d'huile ; 10 l/ha tous les 7 jours selon la présence des pucerons » ; réserve « Appareil à très bas volume. ».
- [ ] **Étape 2 : gestes par culture** (`par_culture`) tirés des rapports : riz (tri des semences par flottaison, retrait des grains tachés), arachide et soja (rotation avec une céréale), sorgho (arrachage collectif du striga avant les graines), coton (ramasser les chenilles, détruire les tiges après récolte), maïs (récolter à maturité, sécher, trier les épis abîmés contre les moisissures).
- [ ] **Étape 3 : `npm test`** ; attendu : succès.
- [ ] **Étape 4 : commit** `feat(data): add cereal, legume and cotton cases`.

### Task 10 : contenu, tubercules et cultures pérennes

**Fichiers :** modifier `data/solutions.json`.

- [ ] **Étape 1 : ajouter les cas** :
  - `manioc-mosaique` : déformation ; `nette` ; arracher et brûler tôt, boutures de plants sans symptômes, rotation sorgho ou niébé (Plantwise 20167801156, FAO i3278f p. 78) ; vidéo fon `/fon/ama-wunwun-fennye-ton-sin-azon`.
  - `manioc-pourridie` : pourriture, partie non exigée ; `nette` ; terrain non inondable, pas de boutures d'un champ atteint, outils lavés à l'eau de Javel, rotation 3 saisons (Plantwise 20177800656, FAO p. 79).
  - `igname-pourriture-stockage` : pourriture ; `possible` ; tubercules sans blessure, cure de 1 à 4 jours sous bâche, tri régulier, magasin propre (FAO x5039e, section 11.1).
  - `plantain-bunchy-top` : croissance, déformation ; `possible` ; arracher, rejets sains (INRAB BRAB 2022).
  - `plantain-cercosporiose` : taches ; `possible` ; écartement, drainage, effeuillage puis brûlage ; sans traitement.
  - `anacarde-anthracnose` : taches ; `possible` ; tailler et sortir les branches mortes ; sans traitement.
  - `palmier-fusariose` : flétrissement, jaunissement ; `possible` ; replanter avec des plants tolérants de la station de Pobè (INRAB BRAB 2021).
- [ ] **Étape 2 : gestes par culture** : ananas (rejets sains, drainage), plantain (rejets sains, piégeage des charançons), anacarde (fourmis tisserandes, jet d'eau contre les pucerons), manioc (couper et brûler les parties infestées de cochenilles, sans insecticide sur les feuilles).
- [ ] **Étape 3 : `npm test`** ; attendu : succès.
- [ ] **Étape 4 : commit** `feat(data): add root, tuber and tree crop cases`.

### Task 11 : contenu, cultures maraîchères

**Fichiers :** modifier `data/solutions.json`.

- [ ] **Étape 1 : ajouter les cas** :
  - `tomate-helicoverpa` : feuilles mangées ; partie `fruits` ; `nette` ; traitement `produit` INRAB fiche C-8 : spinosad 480 g/l (SC), « 96 g de matière active par hectare, 4 applications à 15 jours d'intervalle » ; `cible: "Helicoverpa armigera"` ; réserves « La fiche date de 2006 et ne donne pas de délai avant récolte. », « Début des traitements ambigu (floraison ou repiquage). ». Si `verifierTraitement` refuse, retirer le traitement, garder le cas et ses gestes (ramasser et détruire les fruits troués, filet sur la pépinière), et le noter dans le commit.
  - `tomate-enroulement` (TYLCV) : déformation, jaunissement ; `possible` ; arracher, pépinière sous filet, pièges jaunes, variétés BENTO 02 et BENTO 04.
  - `tomate-fletrissement-bacterien` : flétrissement ; `possible` ; arracher et sortir les plants, rotation, hybrides BENTO 06 et BENTO 08.
  - `amarante-chenilles`, `gboma-chenilles` : feuilles mangées ; `nette` ; traitement `preparation` INRAB fiche C-23 : « pour 400 m², 0,76 à 1,2 kg d'ail décortiqué et écrasé, dilué dans 15 litres d'eau, filtré ; pulvériser 2 heures après la filtration ; refaire la préparation à chaque pulvérisation » ; réserve « La fiche ne donne ni intervalle entre pulvérisations ni délai avant récolte. ».
  - `piment-anthracnose` : taches ; `possible` ; sans traitement ; variété BENPIM-01 à la prochaine saison.
  - `oignon-anthracnose` : taches, déformation ; `possible` ; sans traitement ; planches surélevées en saison des pluies, oignon une fois en 3 ans sur la même parcelle.
- [ ] **Étape 2 : gestes par culture** : gombo (arroser régulièrement, compost au pied, désherber), gboma et amarante (irrigation régulière contre les acariens en saison sèche), oignon et piment (fumure organique 10 à 20 t/ha selon la fiche INRAB C-16 et S-2).
- [ ] **Étape 3 : `npm test`** ; attendu : succès, dont la règle d'autorisation.
- [ ] **Étape 4 : commit** `feat(data): add vegetable cases`.

### Task 12 : voix des solutions

**Fichiers :** modifier `server/voix.js`, `scripts/lister-voix.js`, `scripts/voix/generer.js`, `scripts/voix/evaluer.js`, `test/voix.test.js` ; ajouter les MP3 dans `public/voix`.

**Interfaces :**
- Consomme : `morceauxSolutions` (tâche 3).
- Produit : `listerMorceaux(reponses, base, communes, solutions = null)` ajoute les morceaux des solutions. Les trois scripts lisent `data/solutions.json` et le passent.

- [ ] **Étape 1 : ajouter le test** `chaque morceau que disent les solutions figure dans la liste des extraits` : pour chaque culture et chaque symptôme, avec et sans saison connue, tous les `morceaux` de `choisirSolutions` sont dans `new Set(listerMorceaux(reponses, base, communes, solutions))` (comparés avec `texteVoix`).
- [ ] **Étape 2 : lancer `node --test test/voix.test.js`** ; attendu : échec.
- [ ] **Étape 3 : modifier `listerMorceaux` et les trois scripts.**
- [ ] **Étape 4 : relancer** ; attendu : succès.
- [ ] **Étape 5 : générer** : `node scripts/lister-voix.js` (nombre de manquants) ; `node scripts/voix/generer.js --point` ; `node scripts/voix/evaluer.js --json <scratchpad>/eval-solutions.json` ; régénérer avec `--graine 1` puis `--graine 2` les extraits des solutions à plus de 25 % d'écart, et garder la version la mieux relue. Attendu : `node scripts/lister-voix.js` affiche 0 manquant.
- [ ] **Étape 6 : `npm test`** ; attendu : succès.
- [ ] **Étape 7 : commit** `feat(data): add fon voice pieces for the solutions`.

### Task 13 : relecture par le locuteur

**Fichiers :** créer `scripts/relecture/csv.js`, `scripts/relecture-solutions.js`, `test/relecture.test.js`.

**Interfaces :**
- Produit :
  - `exporterCsv(donnees): string` : UTF-8 avec BOM, séparateur `;`, guillemets doublés, colonnes `cle;type;fr;fon;voix;source`. `cle` désigne l'élément : `phrases.titre`, `gestes.<id>`, `cas.<id>.probleme`, `cas.<id>.traitement`, `cas.<id>.traitement.securite`.
  - `importerCsv(texte, donnees): { donnees, alertes: string[] }` : remplace `fon` et `voix` par clé ; une alerte quand le fon change sans la voix ou l'inverse, quand une clé est inconnue, quand une cellule fon ou voix est vide.
  - CLI : `node scripts/relecture-solutions.js exporter relecture.csv` et `node scripts/relecture-solutions.js importer relecture.csv` (écrit `data/solutions.json`, affiche les alertes, ne régénère pas l'audio).

- [ ] **Étape 1 : écrire les tests** : `aller-retour sans changement : aucune alerte, données identiques` ; `point-virgule et guillemets dans un texte survivent à l'aller-retour` ; `fon corrigé sans la voix : une alerte nommant la clé` ; `clé inconnue : une alerte` ; `cellule fon vide : une alerte, valeur précédente gardée`.
- [ ] **Étape 2 : lancer** ; attendu : échec.
- [ ] **Étape 3 : écrire `csv.js` et la commande.**
- [ ] **Étape 4 : relancer** ; attendu : succès. Exporter la fiche réelle dans le scratchpad et l'ouvrir pour contrôle.
- [ ] **Étape 5 : commit** `feat(scripts): export and import solutions for the fon speaker review`.

### Task 14 : documentation et PR

**Fichiers :** modifier `README.md`.

- [ ] **Étape 1 : README** : section « Solutions proposées » sous « Fonctionnement » (niveaux, sources, règle d'autorisation, saison, relecture du locuteur, commandes `relecture-solutions.js` et `extraire_coahp.py`) ; tableau du vocabulaire (9 symptômes, striga sans terme fon) ; arborescence ; nombre de tests ; limites connues (pas de validation agronomique, mention « À confirmer avec un conseiller », sources inaccessibles le 22 octobre 2026).
- [ ] **Étape 2 : vérifications finales** : `npm test` vert ; `node scripts/lister-voix.js` à 0 manquant ; essai en simulation des deux transcriptions (tâche 6, étape 4) et de l'écran conseiller.
- [ ] **Étape 3 : commit** `docs(readme): describe suggested solutions`.
- [ ] **Étape 4 : pousser la branche et ouvrir la PR** (format des PR précédentes : Objectif, Changements, Tests, Points d'attention, Checklist auteur), en indiquant que la mise en ligne attend la relecture du fon.
