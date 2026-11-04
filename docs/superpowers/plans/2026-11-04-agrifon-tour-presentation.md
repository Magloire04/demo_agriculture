# Tour de présentation à la voix : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** au premier accès, une voix en fon fait faire à l'agriculteur une vraie demande de prix et un vrai signalement, en montrant chaque bouton sous un projecteur avec une main animée ; un bouton d'aide (la main) relance ce tour à tout moment.

**Architecture:** le serveur lit `data/tour.json` (phrases du tour, fon et sens français) et rend leurs identifiants de voix (`GET /api/tour`) ; la préparation les synthétise à l'avance avec les phrases fixes. Côté téléphone, un moteur sans DOM (`site/js/tour-moteur.js`) déroule les étapes décrites dans `site/js/tour-etapes.js` à partir d'effets injectés, testé sous Node ; `site/js/tour.js` fournit ces effets (projecteur, main, haut-parleur, croix, points, bulle, écran de démarrage, blocage des appuis hors cible) et écoute les événements que `app.js` émet (micro, réponse, fin de lecture, lieu).

**Tech Stack:** Node ≥ 20.12 sans dépendance, modules ES, `node --test`, HTML/CSS/JS sans cadre, voix JML `homme2` via `server/synthese.js`.

**Spec:** `docs/superpowers/specs/2026-11-04-agrifon-tour-presentation-design.md`

## Global Constraints

- Aucun mot français affiché à l'agriculteur ; le contrôle `test/sans-francais.test.js` s'étend à `data/tour.json` et à `site/js/tour*.js`.
- Identifiants en français, commits en anglais (Conventional Commits), aucune trace d'outil d'IA.
- Pas de dépendance npm, pas de bibliothèque côté téléphone.
- Voix : celle des phrases entières (`server/synthese.js`, voix `homme2`) ; pas d'extraits FongLab pour le tour.
- Rendu : projecteur (voile `rgba(0,0,0,.68)` autour de la cible, cercle ou rectangle arrondi éclairé), main SVG de la maquette du 4 novembre dont le bout de l'index touche le centre de la cible, haut-parleur animé en haut tant que la voix du tour parle, croix en haut à droite, points de progression en bas ; écran de démarrage vert `#006828` avec gros bouton blanc.
- Bouton d'aide : icône de la main du tour, en haut à droite de l'en-tête, sur tous les écrans de l'agriculteur ; nom accessible en fon (clé `aide` de `data/interface.json`).
- Relance : 10 s après la fin d'une phrase qui attend un geste, trois fois au plus ; plus de relance dès que l'enregistrement commence.
- Mémoire : clé `agrifon.tour` = `vu` dans `localStorage` (via `lireMemoire` / `ecrireMemoire` de `dom.js`), écrite à la fin du tour ou à la croix.
- Tout nouveau texte fon est relu par Elisée avant la mise en ligne (tâche 7).

## Review Focus

- **Réponse affichée avant que le moteur n'attende sa lecture** : sans voix, `lecture-finie` part aussitôt après la réponse ; le moteur doit quand même passer l'étape. Test « un événement arrivé avant l'attente compte » (tâche 3).
- **Relance pendant que l'agriculteur parle** : la voix du tour ne doit jamais couvrir l'enregistrement. Test « le début de l'enregistrement arrête les relances » (tâche 3).
- **Cible absente** (bouton « réécouter » sans voix disponible, pas de bouton d'autre question) : l'étape est passée, le tour ne se bloque pas. Test « une cible absente fait passer l'étape » (tâche 3).
- **Appui hors du projecteur** : il ne doit ni changer d'écran ni lancer le micro, sauf la croix. Vérification au navigateur (tâche 6) et test du filtre `appuiAutorise` (tâche 5).
- **Stockage indisponible** : l'écran de démarrage revient à chaque ouverture, sans erreur. Test « sans mémoire, le tour est proposé » (tâche 5).

---

### Task 1: Phrases du tour, route `GET /api/tour` et préparation des voix

**Files:**
- Create: `data/tour.json`
- Modify: `data/interface.json` (clé `aide`), `server/index.js` (paramètre `tour`, route, lecture au démarrage), `scripts/voix/preparer-phrases.js` (`phrasesFixes` reçoit `tour`)
- Test: `test/tour-serveur.test.js` (créé), `test/preparer-phrases.test.js`, `test/sans-francais.test.js`

**Interfaces:**
- Produces: `data/tour.json` = `{ "_note": string, "phrases": { [cle]: { "fr": string, "fon": string } } }` avec exactement les clés de la table ci-dessous.
- Produces: `creerApplication({ …, tour = null })` ; `GET /api/tour` → `200 { phrases: { [cle]: { fon: string, voix_phrase: string|null } } }` (`voix_phrase` = `voixPhrase([fon])`, donc enregistré auprès de la synthèse ; `null` sans synthèse ; `{ phrases: {} }` sans `tour`).
- Produces: `phrasesFixes({ reponses, base, releves, tour = null })` ajoute `texteADire([fon])` pour chaque phrase du tour.

Brouillons fon (à relire par Elisée, tâche 7) :

| Clé | Sens (fr) | Fon (brouillon) |
| --- | --- | --- |
| `tour_bienvenue` | Bienvenue dans AgriFon. Je vais vous montrer comment vous servir de l'application. | Mi kú abɔ ɖo AgriFon mɛ. Un na xlɛ́ mi lee mi na zán mɔn élɔ́ gbɔn é. |
| `tour_accueil_prix` | Ici, vous connaissez le prix d'un produit au marché. | Fí ɔ, mi na mɔ nǔ ɖé sín akwɛ́ ɖo axi mɛ. |
| `tour_accueil_conseil` | Ici, vous demandez conseil quand vos cultures sont malades. | Fí ɔ, mi na biɔ nu tuntun hwenu e àzɔn jɛ atín mitɔn lɛ́ wú é. |
| `tour_prix_carte` | Appuyez ici pour connaître un prix. | Mi zìn fí ɔ bo mɔ nǔ ɖé sín akwɛ́. |
| `tour_permission_micro` | Le téléphone va vous demander la permission d'utiliser le micro : acceptez. | Alokan ɔ na biɔ gbè mi nú mikló ɔ : mi ná gbè. |
| `tour_prix_micro` | Appuyez sur le micro, dites le nom du produit puis celui du marché, et appuyez encore pour finir. | Mi zìn mikló ɔ, mi ɖɔ nǔ ɔ sín nyǐkɔ kpo axi ɔ sín nyǐkɔ kpo, bo lɛ́ zìn d’é jí ényí mi fó xó. |
| `tour_prix_reecouter` | Appuyez ici pour réécouter la réponse. | Mi zìn fí ɔ bo lɛ́ sè xó ɔ. |
| `tour_prix_autre` | Appuyez ici pour poser une autre question. | Mi zìn fí ɔ bo kàn nǔ ɖevo byɔ. |
| `tour_conseil_onglet` | Appuyez ici pour demander conseil. | Mi zìn fí ɔ bo biɔ nu tuntun. |
| `tour_permission_position` | Le téléphone va vous demander la permission de connaître votre position : acceptez. | Alokan ɔ na biɔ gbè mi nú fí e mi ɖè é : mi ná gbè. |
| `tour_conseil_lieu` | Appuyez ici pour dire où se trouve votre champ, ou choisissez votre commune dans la liste. | Mi zìn fí ɔ bo xlɛ́ fí e gle mitɔn ɖè é, alǒ mi sɔ́ glétoxo mitɔn. |
| `tour_conseil_micro` | Appuyez sur le micro, dites la culture et ce que vous voyez, et appuyez encore pour finir. | Mi zìn mikló ɔ, mi ɖɔ atín ɔ kpo nǔ e mi mɔ é kpo, bo lɛ́ zìn d’é jí ényí mi fó xó. |
| `tour_conseil_recu` | Le conseiller agricole a reçu votre message. | Glegán ɔ yí xó mitɔn. |
| `tour_fin` | Pour réentendre ces explications, appuyez ici à tout moment. | Nú mi jló na lɛ́ sè xó élɔ́ lɛ́ ɔ, mi zìn fí ɔ hwenu e mi jló é. |
| `tour_pas_compris` | Je n'ai pas compris. Recommençons. | Un se xó ɔ ǎ. Mi nú mǐ lɛ́ bɛ́ ɛ. |

Clé d'interface ajoutée : `aide` = `{ "fr": "Aide : refaire le tour de présentation", "fon": "Alɔdó" }`.

- [ ] **Step 1: Write the failing tests**
  - `test/tour-serveur.test.js` : `'GET /api/tour : chaque phrase avec son fon et un identifiant de voix'` (serveur de `test/voix-phrases-serveur.test.js` avec `tour: lire('tour.json')` ; 15 clés ; chaque `voix_phrase` correspond à `/^[0-9a-f]{16}$/` ; `GET /api/voix/<id>.wav` ne répond pas 404) ; `'sans synthèse : voix_phrase null'` ; `'sans tour : aucune phrase'` (`{ phrases: {} }`).
  - `test/preparer-phrases.test.js` : `'phrases fixes : chaque phrase du tour, avec le même identifiant que le serveur'` (`phrasesFixes({ …, tour })` contient `texteADire([p.fon])` pour chaque phrase ; l'identifiant rendu par `/api/tour` vaut `idPhrase(texte, 'homme2')`). Le compte du test existant devient `1 + marchesAvecPrix.length + 15` quand `tour` est passé.
  - `test/sans-francais.test.js` : les `fr` de `data/tour.json` entrent dans les marqueurs ; `'aucun mot français dans le fon du tour'` (chaque `fon` de `data/tour.json` sans marqueur).
- [ ] **Step 2: Run** `node --test test/tour-serveur.test.js test/preparer-phrases.test.js test/sans-francais.test.js` — Expected: FAIL (fichier `data/tour.json` absent, route 404).
- [ ] **Step 3: Implement** `data/tour.json` (table ci-dessus), la clé `aide`, le paramètre `tour` et la route dans `creerApplication`, la lecture de `data/tour.json` au démarrage (`lireJson('data/tour.json')` dans le `Promise.all`), `phrasesFixes` et son appel dans `principal()` de `preparer-phrases.js`. Lancer `node scripts/textes-interface.js`.
- [ ] **Step 4: Run** the same command — Expected: PASS ; `npm test` all pass.
- [ ] **Step 5: Commit** `feat(tour): Fon sentences of the guided tour, served with their voice ids and prepared ahead`

### Task 2: Étapes du tour

**Files:**
- Create: `site/js/tour-etapes.js`
- Test: `test/tour-etapes.test.js`

**Interfaces:**
- Produces: `export const ETAPES` : tableau d'objets `{ id: string, partie: 1..5, vue: 'accueil'|'prix'|'signalement'|null, cible: string|null (sélecteur CSS), phrase: string|null (clé de data/tour.json), attente: null|'appui'|'reponse'|'lecture'|'lieu', permission?: 'microphone'|'geolocation', avant?: string (clé dite d'abord si la permission n'est pas accordée), retour?: string (id de l'étape où revenir après un échec), voile?: false (écran normal, sans projecteur), ecran?: 'demarrage' }`.
- Produces: `export const PREMIERE_ETAPE_AIDE = '2a'` ; `export const PARTIES = 5`.

Étapes (dans cet ordre) :

| id | partie | vue | cible | phrase | attente | autre |
| --- | --- | --- | --- | --- | --- | --- |
| `1` | 1 | null | `[data-tour-demarrer]` | null | `appui` | `ecran: 'demarrage'` |
| `1b` | 1 | `accueil` | null | `tour_bienvenue` | null | |
| `2a` | 2 | `accueil` | `.carte-choix[href="#/prix"]` | `tour_accueil_prix` | null | |
| `2b` | 2 | `accueil` | `.carte-choix[href="#/signalement"]` | `tour_accueil_conseil` | null | |
| `3a` | 3 | `accueil` | `.carte-choix[href="#/prix"]` | `tour_prix_carte` | `appui` | |
| `3b` | 3 | `prix` | `[data-micro=prix] .bouton-micro` | `tour_prix_micro` | `reponse` | `permission: 'microphone', avant: 'tour_permission_micro'` |
| `3c` | 3 | `prix` | null | null | `lecture` | `voile: false` |
| `3d` | 3 | `prix` | `[data-resultat=prix] .bouton-ecouter` | `tour_prix_reecouter` | null | |
| `3e` | 3 | `prix` | `[data-resultat=prix] .bouton-principal` | `tour_prix_autre` | null | |
| `4a` | 4 | `prix` | `[data-lien=signalement]` | `tour_conseil_onglet` | `appui` | |
| `4b` | 4 | `signalement` | `[data-lieu]` | `tour_conseil_lieu` | `lieu` | `permission: 'geolocation', avant: 'tour_permission_position'` |
| `4c` | 4 | `signalement` | `[data-micro=signalement] .bouton-micro` | `tour_conseil_micro` | `reponse` | `permission: 'microphone', avant: 'tour_permission_micro'` |
| `4d` | 4 | `signalement` | null | null | `lecture` | `voile: false` |
| `4e` | 4 | `signalement` | `[data-resultat=signalement] .confirmation` | `tour_conseil_recu` | null | |
| `5` | 5 | `signalement` | `[data-aide]` | `tour_fin` | null | |

Une étape `reponse` a `retour` = son propre id.

- [ ] **Step 1: Write the failing tests** `test/tour-etapes.test.js` :
  - `'chaque phrase des étapes existe dans data/tour.json, et chaque phrase du tour sert'` (phrases + `avant` + `tour_pas_compris` = toutes les clés).
  - `'les cibles fixes existent dans la page, les cibles des réponses sont créées par app.js'` (les sélecteurs sans `[data-resultat=` se retrouvent dans `site/index.html` par leur attribut ou leur `href`, sauf `[data-aide]` et `[data-tour-demarrer]`, créés à la tâche 5 et vérifiés par ses tests ; `.bouton-ecouter`, `.bouton-principal`, `.confirmation` figurent dans `site/js/app.js`).
  - `'ordre et parties : 1 à 5, sans recul ; l’aide commence à 2a'`.
- [ ] **Step 2: Run** `node --test test/tour-etapes.test.js` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `site/js/tour-etapes.js`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tour): steps of the guided tour`

### Task 3: Moteur du tour (sans DOM)

**Files:**
- Create: `site/js/tour-moteur.js`
- Test: `test/tour-moteur.test.js`

**Interfaces:**
- Consumes: `ETAPES` (tâche 2).
- Produces: `export function creerMoteur({ etapes, effets, delai, relanceMs = 10_000, relancesMax = 3 })` → `{ demarrer(depuis = etapes[0].id): Promise<'fini'|'arrete'>, arreter(): void, reprendre(): void, etape(): string|null }`.
- `effets` (injectés, tous éventuellement asynchrones) :
  - `aller(vue)` : affiche la vue (ne fait rien si `null` ou déjà affichée) ;
  - `cibleExiste(selecteur)` → `boolean` ;
  - `eclairer({ cible, voile, ecran, partie })` : met en place le projecteur (ou l'écran de démarrage, ou l'écran normal si `voile === false`) ;
  - `dire(cle)` → `Promise<boolean>` : `true` si la voix a été jouée jusqu'au bout, `false` si elle n'a pas pu l'être (l'effet affiche alors la bulle fon pendant 5 s avant de résoudre) ;
  - `taire()` ;
  - `permissionAccordee(nom)` → `Promise<boolean>` ;
  - `attendre(type, { cible, depuis, signal })` → `Promise<{ ok: boolean, code?: string }>` pour `appui`, `reponse`, `lecture`, `lieu` ; `depuis` est le numéro du dernier événement vu au début de l'étape : un événement arrivé après lui compte, même s'il a précédé l'appel ;
  - `numeroEvenement()` → `number` ;
  - `surEnregistrement(rappel)` → fonction de désabonnement : appelle `rappel()` quand le micro passe en enregistrement ;
  - `lieuDeja()` → `boolean` ;
  - `marquerVu()`, `fermer()`.
- `delai(ms, signal)` → `Promise` (injecté pour les tests).

Règles :
1. Pour chaque étape : `aller(vue)` ; si `cible` et `!cibleExiste(cible)` → étape suivante ; `eclairer(...)` ; si `permission` et pas accordée → `dire(avant)` ; si `phrase` → `dire(phrase)`.
2. `attente === null` → étape suivante. `'lieu'` et `lieuDeja()` → étape suivante.
3. Sinon : attendre l'événement ; pendant ce temps, après chaque `relanceMs` sans geste, `dire(phrase)` à nouveau, `relancesMax` fois au plus ; `surEnregistrement` coupe les relances (`taire()` compris).
4. `reponse` : `ok` → étape suivante ; `code === 'hors_service'` → `fermer()`, `demarrer` rend `'arrete'` sans `marquerVu` ; autre échec → `dire('tour_pas_compris')`, puis retour à `retour`.
5. Fin de la dernière étape → `marquerVu()`, `fermer()`, `'fini'`. `arreter()` (la croix) → `taire()`, `marquerVu()`, `fermer()`, `'arrete'`.
6. `reprendre()` (retour dans l'application) : redit la phrase de l'étape en cours si elle en a une.

- [ ] **Step 1: Write the failing tests** `test/tour-moteur.test.js` (effets factices qui notent leurs appels ; `delai` qui résout à la demande) :
  - `'déroule les étapes dans l’ordre : vue, projecteur, phrase, attente'`
  - `'sans geste, la consigne est redite toutes les 10 s, trois fois au plus'`
  - `'le début de l’enregistrement arrête les relances'`
  - `'un événement arrivé avant l’attente compte'`
  - `'une demande non comprise fait dire « recommençons » et revient au micro'`
  - `'hors service : le tour se ferme sans être marqué vu'`
  - `'la croix arrête la voix et marque le tour vu'` ; `'arrivé au bout, le tour est marqué vu'`
  - `'voix indisponible : le tour continue après la bulle'` (`dire` rend `false`)
  - `'une cible absente fait passer l’étape'`
  - `'lieu déjà donné : l’étape passe après sa phrase'`
  - `'permission déjà accordée : la phrase d’avertissement n’est pas dite'`
  - `'reprise : la phrase de l’étape en cours est redite'`
  - `'relancé par l’aide : commence à 2a'`
- [ ] **Step 2: Run** `node --test test/tour-moteur.test.js` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `site/js/tour-moteur.js` (un `AbortController` par démarrage ; `arreter()` l'interrompt et toute attente en cours se résout).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tour): tour engine, tested without a browser`

### Task 4: Événements de l'application

**Files:**
- Modify: `site/js/app.js`
- Test: `test/app-evenements.test.js` (créé)

**Interfaces:**
- Produces: événements `CustomEvent` sur `document` :
  - `agrifon:micro` `{ vue: 'prix'|'signalement', etat: 'enregistrement'|'analyse'|'pret' }` à chaque `changer()` de `brancherMicro` ;
  - `agrifon:reponse` `{ vue, ok: true }` après `traiter()` réussi ; `{ vue, ok: false, code }` après un échec (`e.code`, ou `trop_court`, `micro_refuse`, `micro_absent`, `micro_impossible`, `micro_non_disponible` pour les échecs locaux) ;
  - `agrifon:lecture-finie` `{ zone: 'prix'|'signalement' }` quand `lireDesLArrivee` a fini, y compris quand il n'y a rien à lire ou qu'il ne lit pas (vue cachée, application en arrière-plan, module de voix absent) ;
  - `agrifon:lieu` `{}` quand une position est obtenue ou une commune choisie.
- Produces: `export function emettre(type, detail)` dans `site/js/dom.js` (`document.dispatchEvent(new CustomEvent(\`agrifon:${type}\`, { detail }))`).

- [ ] **Step 1: Write the failing test** `test/app-evenements.test.js` : `'dom.emettre envoie un événement agrifon: avec son détail'` (faux `document` avec `dispatchEvent` ; `CustomEvent` de Node) et `'app.js émet chaque événement du tour'` (le source de `site/js/app.js` contient `emettre('micro'`, `emettre('reponse'`, `emettre('lecture-finie'`, `emettre('lieu'`).
- [ ] **Step 2: Run** `node --test test/app-evenements.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `emettre` et ses appels : `changer()` ; `analyser()` (succès, échec) ; les retours d'échec du clic micro (`erreur_trop_court`, refus, absence, impossible, non disponible) ; `lireDesLArrivee` (après `await voix.lireSuite(...)` et dans chaque sortie anticipée) ; succès de `demanderPosition` et `change` de `choixCommune`.
- [ ] **Step 4: Run** the test, then `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tour): app events the tour listens to`

### Task 5: Habillage du tour et bouton d'aide

**Files:**
- Create: `site/js/tour.js`
- Modify: `site/index.html` (bouton d'aide dans `.entete-interieur`, `data-aide`, `data-texte-aria-label="aide"`, SVG de la main), `site/css/app.css` (styles du tour), `site/js/app.js` (chargement de `tour.js`, branchement du bouton d'aide), `site/sw.js` (`js/tour.js`, `js/tour-moteur.js`, `js/tour-etapes.js` ; cache `agrifon-v15`)
- Test: `test/tour-telephone.test.js` (créé), `test/sans-francais.test.js` (contrôle de `site/js/tour.js`, `tour-moteur.js`, `tour-etapes.js`), `test/interface.test.js` ou `test/textes-interface.test.js` (bouton d'aide)

**Interfaces:**
- Consumes: `creerMoteur`, `ETAPES`, `PREMIERE_ETAPE_AIDE`, `PARTIES`, `appelerApi`, `lireMemoire`, `ecrireMemoire`, `T`, `voix.prechargerPhrase`, `voix.lireReponse`, `voix.arreterLecture`, événements de la tâche 4.
- Produces: `export async function lancerSiPremierAcces()`, `export async function lancer({ depuisAide = false } = {})`, `export function appuiAutorise(cible, tourActif, element)` → `boolean` (pur, testé), `export function premierAcces(memoire = lireMemoire)` → `boolean`.

Comportement de l'habillage :
- `lancer` charge `api/tour` (une fois), précharge chaque `voix_phrase`, construit les éléments (`.tour` : projecteur, main, haut-parleur, croix `[data-tour-fermer]` au nom `T.arreter`, points, bulle) et démarre le moteur à `1` (premier accès) ou `PREMIERE_ETAPE_AIDE` (aide).
- `eclairer` : fait défiler la cible au centre, place le projecteur sur son rectangle (marge 10 px, rayon 50 % pour le micro, sinon 14 px) et le recalcule à chaque `scroll`/`resize` tant que l'étape dure ; place la main (bout de l'index à 44 % de sa largeur) au centre ; `voile: false` → ni voile, ni main.
- `dire(cle)` : haut-parleur visible pendant `voix.lireReponse({ phrase: id }, { attenteMs: voix.ATTENTE_AUTO_MS })` ; en cas d'échec ou sans identifiant, bulle avec le fon pendant 5 s puis `false`.
- Blocage : écouteurs `click` et `pointerdown` en capture sur `document` ; un appui qui ne vérifie pas `appuiAutorise` est annulé (`preventDefault` + `stopPropagation`). Autorisés : la croix, la cible de l'étape (et ce qu'elle contient), et, pendant `3c`/`4d`, rien d'autre que la croix.
- `visibilitychange` : caché → `voix.arreterLecture()` ; visible → `moteur.reprendre()`.
- `prefers-reduced-motion: reduce` : la main reste posée sur la cible, sans animation ; le projecteur ne pulse pas.
- `app.js` : `import('./tour.js')` après `afficherVue()`, puis `lancerSiPremierAcces()` ; clic sur `[data-aide]` → `voix?.debloquer?.()` puis `lancer({ depuisAide: true })`. Un clic sur l'aide pendant un tour en cours le recommence à `2a`.

- [ ] **Step 1: Write the failing tests** `test/tour-telephone.test.js` : `'appuiAutorise : la croix et la cible passent, le reste est bloqué'` ; `'sans mémoire, le tour est proposé'` (mémoire qui rend `null` → `premierAcces` vrai ; `'vu'` → faux) ; dans le test d'interface : `'le bouton d’aide est dans l’en-tête, avec son nom en fon'`. Étendre `test/sans-francais.test.js` aux trois modules du tour.
- [ ] **Step 2: Run** `node --test test/tour-telephone.test.js test/tour-etapes.test.js test/sans-francais.test.js test/interface.test.js test/textes-interface.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `site/js/tour.js`, le bouton d'aide (puis `node scripts/textes-interface.js`), les styles, le branchement dans `app.js`, le cache.
- [ ] **Step 4: Run** the same command, then `npm test` — Expected: PASS ; `tour.js` crée `[data-tour-demarrer]` (gros bouton de l'écran de démarrage), vérifié par `'l’écran de démarrage porte la cible de l’étape 1'` dans `test/tour-telephone.test.js` (le source de `tour.js` contient `data-tour-demarrer`).
- [ ] **Step 5: Commit** `feat(tour): spotlight, hand, help button and first-access start screen`

### Task 6: Essai complet au navigateur

**Files:**
- Modify: au besoin, les fichiers des tâches 4 et 5 (corrections trouvées)

- [ ] **Step 1: Run** `node server/index.js --simulation` (port libre), navigateur 390 × 844, service worker bloqué, `localStorage` vide.
- [ ] **Step 2: Parcourir** le tour entier : écran de démarrage, accueil, prix (un fichier audio envoyé à la place du micro), lecture, réécouter, autre question, onglet du conseil, lieu (commune choisie), signalement, accusé, fin sur le bouton d'aide. Expected : à chaque étape, le projecteur et la main sur la bonne cible ; aucun appui hors cible ne change l'écran ; `agrifon.tour` vaut `vu` à la fin.
- [ ] **Step 3: Vérifier** : la croix arrête tout ; le bouton d'aide relance à `2a` depuis l'écran des prix ; un échec de demande (fichier vide) fait dire « recommençons » et revient au micro ; sans voix (simulation), la bulle fon s'affiche puis le tour continue ; aucun mot français à l'écran (hors bandeau de simulation).
- [ ] **Step 4: Commit** les corrections éventuelles (`fix(tour): …`), chacune avec le test qui l'a d'abord fait échouer quand c'est possible.

### Task 7: Relecture du fon du tour par Elisée

**Files:**
- Aucun fichier du dépôt : page de relecture provisoire (artefact claude.ai avec base de données), du même type que celle de novembre.

- [ ] **Step 1:** Publier la page avec les 16 textes (15 phrases du tour + clé `aide`) : sens français, fon brouillon, champ de correction, statut (`a_relire` / `valide` / `corrige`), note.
- [ ] **Step 2:** Attendre la relecture d'Elisée (arrêt du plan jusqu'à son retour).

### Task 8: Report de la relecture, nettoyage et PR

**Files:**
- Modify: `data/tour.json`, `data/interface.json`
- Test: suite complète

- [ ] **Step 1:** Reporter chaque fon validé ou corrigé dans `data/tour.json` et `data/interface.json` ; `node scripts/textes-interface.js`.
- [ ] **Step 2: Run** `npm test` — Expected: PASS (le contrôle anti-français compris).
- [ ] **Step 3: Commit** `fix(fon): apply Elisée's review of the tour sentences` ; supprimer la page de relecture (accord déjà donné pour ce type de page) ; README : section « Tour de présentation » (déroulé, bouton d'aide, mémoire `agrifon.tour`, route `/api/tour`, préparation des phrases).
- [ ] **Step 4:** Pousser la branche `feature/agrifon-tour-presentation` et ouvrir la PR (Elisée fusionne, puis déploiement sur son accord).
