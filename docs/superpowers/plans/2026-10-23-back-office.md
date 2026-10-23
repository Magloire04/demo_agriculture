# Back office d'AgriFon : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objectif :** un back office réservé à Elisée (`/admin`) qui montre l'usage réel d'AgriFon (personnes, demandes comprises, signalements, journal des appels, refus, état des services) et qui permet de couper le site, d'importer les prix et de régler l'affichage des solutions en brouillon.

**Architecture :** trois modules serveur nouveaux, chacun avec son stockage en fichiers dans `stockage/` : `server/reglages.js` (hors service, solutions en brouillon, coupures), `server/mesures.js` (visiteurs anonymes par jour, journal des appels, refus, statistiques, purge à 90 jours) et `server/admin.js` (mot de passe, sessions, routes `/api/admin/*`). `server/index.js` les branche : il compte les visites, journalise chaque demande vocale, compte les refus, applique le mode hors service et délègue `/api/admin/*`. L'écran est une page sans framework (`site/admin.html`, `site/js/admin.js`, `site/css/admin.css`) qui reproduit la maquette validée ; la page d'attente est `site/hors-service.html`.

**Pile :** Node.js ≥ 20.12, modules ES, sans dépendance npm ; tests `node --test` ; navigateur sans framework ; `crypto.scrypt` pour l'empreinte du mot de passe.

**Spécification :** `docs/superpowers/specs/2026-10-23-back-office-design.md` (à lire avant chaque tâche). Maquettes de référence, non versionnées : `.superpowers/brainstorm/1912-1792761711/content/back-office-motion.html` et `hors-service.html`.

## Contraintes globales

- Aucune dépendance ajoutée à `package.json`. Tests en `node:test` et `node:assert/strict` dans `test/*.test.js`, écrits avant le code.
- Noms de code en français, comme le reste du dépôt. Commits en anglais, Conventional Commits, sans aucune trace d'outil d'IA (règle `git-sans-trace-ia`).
- Fichiers du site dans `site/`, jamais dans `public/`. Rien chargé depuis l'extérieur : la CSP reste `default-src 'self'` ; pas de `<style>` ni d'attribut `style` dans le HTML (les styles dynamiques passent par `element.style` en JavaScript) ; polices locales de `site/css/polices.css` (graisses 300, 400, 600, 700).
- Aucune adresse IP, position GPS ni audio dans les mesures. Le journal ne contient pas l'identifiant anonyme.
- Une mesure qui échoue ne fait jamais échouer une demande : chaque écriture de mesure est protégée et ne remonte pas d'erreur.
- Jours et heures à l'heure de Porto-Novo : UTC+1, sans heure d'été.
- Rétention : 90 jours pour le journal, les visiteurs par jour et les refus.
- Session : 10 minutes sans activité ; seule une requête portant l'en-tête `X-Activite: 1` prolonge la session.
- Mot de passe : 3 essais faux depuis une même adresse bloquent 10 minutes ; adresse inconnue : pas de blocage, 2 secondes d'attente par essai faux.
- Textes exacts : page d'attente « Mǐ ma sixú yí gbe nú mi din ǎ. » puis « AgriFon est momentanément hors service. Revenez un peu plus tard. » ; confirmation « Couper AgriFon maintenant ? Les téléphones afficheront la page d'attente jusqu'à ce que vous remettiez le site en service. L'écran conseiller reste ouvert. », boutons « Mettre hors service », « Couper le site », « Annuler », « Remettre en service » ; résultats « Compris », « Non compris », « Erreur de l'API » ; libellé « demandes comprises ».
- Couleurs de l'écran d'administration : papier `#F4F7F3`, surface `#FFFFFF`, encre `#102A1C`, encre douce `#4B5E52`, filet `#DCE4DC`, vert `#006828`, rouge `#C3261B`, jaune `#FFBE00` (focus).
- Le plan s'arrête à la PR. Le mot de passe est défini par Elisée lui-même sur le serveur, jamais dans le chat ni dans Git.

## Points à surveiller en revue

1. Le dossier des mesures est inaccessible (disque plein, droits) : une demande de prix répond quand même 200 (test dans la tâche 4).
2. Un en-tête `X-Visiteur` forgé (texte long, pas un UUID v4) est ignoré et n'écrit rien (test dans la tâche 2).
3. Site coupé : le back office et l'écran conseiller répondent, et la remise en service fonctionne (test dans la tâche 5).
4. Écran resté ouvert sans clic : après 10 minutes, ses relèves automatiques reçoivent 401 même si elles arrivaient toutes les 5 secondes (test dans la tâche 3).
5. Limite de jour : une demande à 23 h 30 UTC compte pour le lendemain à Porto-Novo (test dans la tâche 2).

---

## Structure des fichiers

| Fichier | Rôle |
| --- | --- |
| `server/http.js` (nouveau) | `ErreurHttp`, `envoyerJson`, `ENTETES_SECURITE`, `lireCorpsJson` : sortis de `server/index.js` pour être partagés avec `server/admin.js` |
| `server/reglages.js` (nouveau) | réglages persistés dans `stockage/reglages.json` |
| `server/mesures.js` (nouveau) | visiteurs par jour, journal, refus, statistiques, purge, dans `stockage/mesures/` |
| `server/admin.js` (nouveau) | empreinte du mot de passe, sessions, blocage, routes `/api/admin/*` |
| `server/asr.js` | ajout de `sante()` (appel de `/health`) |
| `server/index.js` | branchement des visites, du journal, des refus, du mode hors service, des solutions en brouillon et de l'administration |
| `data/reponses.json` | phrase `hors_service` |
| `site/hors-service.html`, `site/css/hors-service.css` (nouveaux) | page d'attente |
| `site/admin.html`, `site/css/admin.css`, `site/js/admin.js` (nouveaux) | écran d'administration |
| `site/js/app.js` | envoi de `X-Visiteur`, rechargement si le site est coupé |
| `scripts/admin-mot-de-passe.js` (nouveau) | définit `ADMIN_MDP_EMPREINTE` dans `.env` sur le serveur |
| `.env.example`, `README.md` | documentation |

---

### Task 1 : réglages persistés

**Files:**
- Create: `server/reglages.js`
- Test: `test/reglages.test.js`

**Interfaces:**
- Produces: `creerReglages(fichier: string, { solutionsBrouillon: boolean, maintenant?: () => Date }) : Promise<Reglages>` avec
  - `lire() : { hors_service: { actif: boolean, depuis: string|null }, solutions_brouillon: boolean, coupures: Array<{ debut: string, fin: string|null }> }` (copie, dates ISO) ;
  - `horsService() : boolean` ;
  - `mettreHorsService() : Promise<void>` (ouvre une coupure ; sans effet si déjà coupé) ;
  - `remettreEnService() : Promise<void>` (ferme la coupure en cours ; sans effet si en service) ;
  - `definirSolutionsBrouillon(actif: boolean) : Promise<void>`.
- `solutionsBrouillon` n'est que la valeur de départ : une valeur déjà enregistrée dans le fichier l'emporte.

- [ ] **Step 1 : écrire les tests** `test/reglages.test.js` (dossier temporaire, horloge injectée) :
  - `reglages par défaut : en service, solutions selon la valeur de départ, aucune coupure` ;
  - `couper puis remettre en service : une coupure fermée avec début et fin` ;
  - `réglages relus après redémarrage` : `creerReglages` sur le même fichier rend `hors_service.actif === true` et la même date `depuis` ;
  - `la valeur de départ ne remplace pas un réglage enregistré` : enregistrer `false`, recréer avec `solutionsBrouillon: true`, lire `false` ;
  - `fichier abîmé : valeurs par défaut, sans erreur`.
- [ ] **Step 2 : lancer** `node --test test/reglages.test.js` ; attendu : échec, module absent.
- [ ] **Step 3 : écrire `server/reglages.js`.** Écriture dans un fichier temporaire puis renommage (comme `server/signalement.js`), écritures en file l'une après l'autre.
- [ ] **Step 4 : relancer le test** ; attendu : tout passe. Puis `npm test` : tout passe.
- [ ] **Step 5 : commit** `feat(server): persist admin settings (maintenance, draft solutions)`.

### Task 2 : mesures (visiteurs, journal, refus, statistiques)

**Files:**
- Create: `server/mesures.js`
- Test: `test/mesures.test.js`

**Interfaces:**
- Produces: `jourLocal(date: Date) : string` (« AAAA-MM-JJ » à UTC+1) ; `creerMesures(dossier: string, { maintenant?: () => Date }) : Mesures` avec
  - `visite(identifiant: string) : void` : n'accepte qu'un UUID v4 (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`), une fois par jour et par identifiant ;
  - `appel(entree: Appel) : void` ; `Appel` = `{ date: string, service: 'prix'|'signalement', resultat: 'compris'|'non_compris'|'erreur', code: string|null, duree_ms: number, duree_api_ms: number|null, duree_audio_s: number|null, transcription: string, reconnu: { produits: string[], marche: string|null } | { culture: string|null, parties: string[], symptomes: string[], commune: string|null }, reference: string|null }` ;
  - `refus(motif: string) : void` ;
  - `vider() : Promise<void>` : attend la fin des écritures en cours (pour les tests et l'arrêt) ;
  - `lireJournal({ apres?: string|null, limite?: number }) : Promise<Appel[]>` : du plus récent au plus ancien, `limite` 50 par défaut, seulement les entrées postérieures à `apres` si donné ;
  - `statistiques({ jours?: number, signalements: object[] }) : Promise<Statistiques>` ;
  - `refusParJour(jours: number) : Promise<Array<{ jour: string, motifs: Record<string, number> }>>` ;
  - `purger() : Promise<void>`.
- `Statistiques` = `{ periode: { du, au }, personnes: { total, revenues }, parJour: Array<{ jour, personnes }> (14 jours), demandes: { comprises, non_comprises, erreurs }, signalements: { total, pris, delai_moyen_ms: number|null }, produits, marches, communes: Array<{ nom, n }> (5 au plus, du plus fréquent au moins fréquent), heures: number[] (24 cases) }`.
- Stockage dans `dossier` : `visiteurs-AAAA-MM-JJ.txt` (un identifiant par ligne), `journal-AAAA-MM-JJ.jsonl`, `refus-AAAA-MM-JJ.json`. Seuls les signalements non simulés comptent ; les communes viennent de `localisation.commune.nom`.

- [ ] **Step 1 : écrire les tests** `test/mesures.test.js` (dossier temporaire, horloge injectée) :
  - `une personne est comptée une fois par jour, et revenue si vue deux jours` : même identifiant deux fois le 20, une fois le 22 ; `personnes.total === 1`, `revenues === 1`, `parJour` du 20 vaut 1 ;
  - `identifiant forgé ignoré` : `visite('x'.repeat(5000))` et `visite('123')` n'écrivent aucun fichier ;
  - `limite de jour à Porto-Novo` : une visite à `2026-10-22T23:30:00Z` compte pour le `2026-10-23` ;
  - `taux sans les erreurs` : 3 `compris`, 1 `non_compris`, 2 `erreur` donnent `{ comprises: 3, non_comprises: 1, erreurs: 2 }` ;
  - `classements` : produits comptés depuis `reconnu.produits`, triés, 5 au plus ;
  - `signalements pris en charge et délai` : deux signalements dont un pris en charge 2 h après réception ; un signalement `simulation: true` ignoré ; `{ total: 2, pris: 1, delai_moyen_ms: 7_200_000 }` ;
  - `le journal ne garde ni identifiant, ni IP, ni GPS` : après `appel()`, le fichier ne contient que les clés d'`Appel` ;
  - `lireJournal après une date` ;
  - `refus comptés par jour et par motif` ;
  - `purge à 90 jours` : un fichier daté de 91 jours disparaît, un de 89 jours reste.
- [ ] **Step 2 : lancer** `node --test test/mesures.test.js` ; attendu : échec, module absent.
- [ ] **Step 3 : écrire `server/mesures.js`.** Écritures ajoutées (`appendFile`) en file ; refus du jour gardés en mémoire et écrits au plus toutes les 5 secondes (minuterie `unref()`) et par `vider()` ; ensemble des visiteurs du jour en mémoire ; toute erreur d'écriture est consignée par `console.error` et avalée. `purger()` est lancée à la création puis au premier passage de chaque nouveau jour.
- [ ] **Step 4 : relancer le test**, puis `npm test` ; attendu : tout passe.
- [ ] **Step 5 : commit** `feat(server): anonymous usage measures with 90-day retention`.

### Task 3 : authentification de l'administrateur

**Files:**
- Create: `server/http.js`, `server/admin.js`, `scripts/admin-mot-de-passe.js`
- Modify: `server/index.js` (importer `ErreurHttp`, `envoyerJson`, `ENTETES_SECURITE` depuis `server/http.js` ; aucun changement de comportement)
- Test: `test/admin.test.js`

**Interfaces:**
- Produces (`server/http.js`) : `ErreurHttp(statut, message, code = 'requete_invalide', attente = 0)`, `envoyerJson(res, statut, donnees, attente = 0, entetes = {})`, `ENTETES_SECURITE`, `lireCorpsJson(req, max = 4096) : Promise<object>` (415 si le type n'est pas `application/json`, 413 au-delà de `max`, 400 si illisible).
- Produces (`server/admin.js`) :
  - `empreinteMotDePasse(mdp: string) : string` au format `scrypt:<sel hex>:<empreinte hex>` ; `verifierMotDePasse(mdp: string, empreinte: string) : boolean` (comparaison en temps constant, `false` si l'empreinte est mal formée) ;
  - `creerSessions({ dureeMs = 600_000, maintenant = Date.now })` : `ouvrir() : string` (jeton aléatoire de 32 octets en hexadécimal), `valider(jeton, { activite: boolean }) : boolean` (périmé au-delà de `dureeMs` depuis la dernière activité ; `activite` remet le compteur à zéro), `fermer(jeton)` ;
  - `creerAdmin({ empreinte, sessions, mesures, reglages, registre, releves, asr, version, dossierAudio, importerPrix, attendre = (ms) => new Promise((r) => setTimeout(r, ms)) })` : `gerer(req, res, url) : Promise<boolean>` qui traite `/api/admin/*` et rend `false` pour toute autre adresse. Cette tâche n'écrit que `POST /api/admin/connexion` (corps `{ "mot_de_passe": "…" }`) et `POST /api/admin/deconnexion` ; les autres routes viennent à la tâche 6.
- Chaque route protégée valide la session avec `activite: req.headers['x-activite'] === '1'`.
- Cookie de session : `agrifon_admin=<jeton>; Path=/; HttpOnly; Secure; SameSite=Strict`. Codes d'erreur : `admin_non_configure` (503, pas d'empreinte), `mot_de_passe` (401), `trop_de_demandes` (429, avec `Retry-After`), `connexion_requise` (401). Un essai faux appelle `mesures?.refus('mot_de_passe_admin')`.
- `scripts/admin-mot-de-passe.js` : demande deux fois le mot de passe sans l'afficher, refuse s'ils diffèrent ou s'il fait moins de 12 caractères, écrit ou remplace la ligne `ADMIN_MDP_EMPREINTE=` du `.env` (droits 600), n'affiche jamais le mot de passe.

- [ ] **Step 1 : écrire les tests** `test/admin.test.js` :
  - `empreinte vérifiée, mauvais mot de passe refusé, empreinte mal formée refusée` ;
  - `connexion : cookie HttpOnly, Secure, SameSite=Strict` ;
  - `3 essais faux bloquent ce visiteur 10 minutes, pas un autre` (`X-Forwarded-For` différents) ;
  - `adresse inconnue : pas de blocage, chaque essai faux attend 2 secondes` (`attendre` injecté, appels comptés) ;
  - `session : relèves sans activité périmées après 10 minutes, activité qui prolonge` (horloge injectée : relèves toutes les 5 s sans `X-Activite` puis 401 à 10 min 01 s ; avec `X-Activite: 1` à 9 min, encore valide à 18 min) ;
  - `sans empreinte configurée : 503 admin_non_configure`.
- [ ] **Step 2 : lancer** `node --test test/admin.test.js` ; attendu : échec, modules absents.
- [ ] **Step 3 : créer `server/http.js`** en y déplaçant les éléments de `server/index.js`, puis `npm test` : tout passe toujours.
- [ ] **Step 4 : écrire `server/admin.js`** (blocage avec `creerCompteur` et `adresseClient` de `server/protection.js`, fenêtre 600 000 ms, maximum 3) **et `scripts/admin-mot-de-passe.js`**.
- [ ] **Step 5 : relancer le test**, puis `npm test` ; attendu : tout passe.
- [ ] **Step 6 : commit** `feat(server): admin password, sessions and lockout`.

### Task 4 : mesurer les visites, les appels et les refus

**Files:**
- Modify: `server/index.js`, `site/js/app.js`
- Test: `test/mesures-serveur.test.js`

**Interfaces:**
- Consumes: `creerMesures` (tâche 2).
- Produces: `creerApplication({ …, mesures = null })`. `GET /api/etat` avec un en-tête `X-Visiteur` appelle `mesures.visite()`. Chaque `POST /api/prix` et `POST /api/signalements` arrivé au serveur (après la protection) appelle `mesures.appel()` une fois, en succès comme en erreur ; `duree_api_ms` mesure l'appel à l'API ; `duree_audio_s` reprend `reponseApi.duree_audio_s` s'il existe. Prix compris : statut `ok`, `sans_prix` ou `marche_seul`. Signalement compris : culture et au moins un symptôme. Un refus de la protection appelle `mesures.refus(refus.code)` ; un code conseiller faux, `mesures.refus('code_conseiller')`.
- Côté téléphone : `site/js/app.js` crée l'identifiant (`crypto.randomUUID()`, ou UUID v4 tiré de `crypto.getRandomValues` à défaut) sous la clé `agrifon.visiteur` de `localStorage` (identifiant de session si le stockage est indisponible) et l'envoie en `X-Visiteur` avec l'appel à `api/etat` du démarrage.

- [ ] **Step 1 : écrire les tests** `test/mesures-serveur.test.js` (application de test comme `test/serveur.test.js`, `protection: null`, mesures réelles dans un dossier temporaire) :
  - `une visite comptée par l'état, pas par l'écran conseiller` ;
  - `prix compris journalisé avec durées et produits reconnus` ;
  - `signalement journalisé avec sa référence, sans GPS` ;
  - `erreur de l'API journalisée avec son code, réponse 503 inchangée` ;
  - `dossier des mesures inaccessible : la demande de prix répond 200` (le dossier est un fichier) ;
  - `refus de la protection comptés` (application avec `creerProtection()`, agent `curl/8`).
- [ ] **Step 2 : lancer** `node --test test/mesures-serveur.test.js` ; attendu : échec.
- [ ] **Step 3 : modifier `server/index.js` et `site/js/app.js`.**
- [ ] **Step 4 : relancer le test**, puis `npm test` ; attendu : tout passe.
- [ ] **Step 5 : commit** `feat(server): record visits, voice requests and refusals`.

### Task 5 : mode hors service et solutions en brouillon réglables

**Files:**
- Create: `site/hors-service.html`, `site/css/hors-service.css`
- Modify: `server/index.js`, `data/reponses.json`, `site/js/app.js`, `site/sw.js`
- Test: `test/hors-service.test.js`

**Interfaces:**
- Consumes: `creerReglages` (tâche 1).
- Produces: `creerApplication({ …, reglages = null })`. Quand `reglages.horsService()` :
  - navigation vers `/` ou `/index.html` : contenu de `site/hors-service.html`, statut 503, `Retry-After: 300`, `Cache-Control: no-store` ;
  - `POST /api/prix` et `POST /api/signalements` : 503, code `hors_service`, `erreur` et `erreur_fon` tirés de la phrase `hors_service` ;
  - tout le reste répond comme d'habitude (écran conseiller et ses routes, `/admin`, `/api/admin/*`, fichiers statiques, `robots.txt`, `/api/etat`, suivi d'un signalement).
- `GET /api/etat` ajoute `hors_service: boolean`. `site/js/app.js` recharge la page quand il vaut `true`.
- Solutions : avec `reglages`, les solutions servies sont `solutionsPubliables(solutions, { SOLUTIONS_BROUILLON: reglages.lire().solutions_brouillon ? '1' : '0' })`, recalculées à chaque signalement ; sans `reglages`, `solutions` est utilisé tel quel, comme aujourd'hui.
- `data/reponses.json`, phrase `hors_service` : `fr` « AgriFon est momentanément hors service. Revenez un peu plus tard. », `fon` « Mǐ ma sixú yí gbe nú mi din ǎ. », sans champ `voix`.
- `site/hors-service.html` reproduit la maquette « C » : marque AgriFon, six barres (vert, vert, jaune, rouge, vert, vert) qui ondulent l'une après l'autre (2,4 s, décalage 0,15 s), phrase fon en grand, français dessous, bande tricolore courte en bas, immobile avec `prefers-reduced-motion`. Styles dans `site/css/hors-service.css` et `site/css/polices.css`, aucun script.
- `site/sw.js` : version du cache `agrifon-v10`.

- [ ] **Step 1 : écrire les tests** `test/hors-service.test.js` :
  - `site coupé : l'accueil rend la page d'attente en 503 avec Retry-After` (corps contenant les deux phrases) ;
  - `site coupé : une demande vocale reçoit hors_service en fon et en français` ;
  - `site coupé : écran conseiller, liste des signalements, état et robots.txt répondent` ;
  - `remis en service : l'accueil répond 200` ;
  - `solutions en brouillon coupées depuis les réglages : plus de solutions, puis de retour` (données avec `fon_a_relire: true`).
- [ ] **Step 2 : lancer** `node --test test/hors-service.test.js` ; attendu : échec.
- [ ] **Step 3 : écrire les fichiers et modifier le serveur.**
- [ ] **Step 4 : relancer le test**, puis `npm test` ; attendu : tout passe.
- [ ] **Step 5 : regarder la page d'attente** dans un navigateur (serveur local en simulation, site coupé) : animation fluide, texte lisible sur téléphone, immobile en mouvement réduit.
- [ ] **Step 6 : commit** `feat(server): maintenance mode and runtime draft-solutions setting`.

### Task 6 : routes de données de l'administration

**Files:**
- Modify: `server/admin.js`, `server/asr.js`, `server/index.js` (`demarrer()` crée réglages, mesures, sessions et administration ; `gerer` délègue `/api/admin/*` avant les autres routes ; `statique` sert `/admin` comme `/admin.html`)
- Test: `test/admin.test.js` (ajouts), `test/serveur.test.js` (`sante()` du client ASR)

**Interfaces:**
- Consumes: tâches 1, 2, 3, 5.
- Produces: `creerApplication({ …, admin = null })` : quand `admin` est fourni, `admin.gerer(req, res, url)` est appelé pour toute adresse `/api/admin/*` ; sans `admin`, ces adresses répondent 404. Statistiques calculées avec `signalements: registre.lister()`.
- Routes, toutes protégées par la session (`connexion_requise` sinon) :
  - `GET /api/admin/tableau?jours=7` → `{ site: { hors_service, depuis }, statistiques: Statistiques }` ;
  - `GET /api/admin/appels?apres=<ISO>` → `{ appels: Appel[] }` (50 au plus) ;
  - `GET /api/admin/refus?jours=14` → `{ refus: refusParJour(jours) }` (`jours` borné à 90) ;
  - `GET /api/admin/services` → `{ api: { ok, modele, duree_ms }, prix: { importe_le, derniere_date }, stockage: { messages_vocaux, octets }, version: { commit, demarre_le } }` ;
  - `POST /api/admin/prix/importer` → `{ ok, message }` (un import à la fois, 409 `import_en_cours` sinon) ;
  - `POST /api/admin/hors-service` corps `{ "actif": boolean }` → `{ site }` ;
  - `POST /api/admin/solutions-brouillon` corps `{ "actif": boolean }` → `{ solutions_brouillon }` ;
  - `GET /api/admin/reglages` → `reglages.lire()`.
- `asr.sante() : Promise<{ ok: boolean, modele: string|null, duree_ms: number }>` : `GET /health` avec l'authentification, délai 10 s, hors de la file d'attente, `ok: false` en cas d'erreur ; en simulation `{ ok: true, modele: 'simulation', duree_ms: 0 }`.
- `version` : `{ commit }` lu dans `.git` au démarrage (`null` si illisible) et `demarre_le` (ISO).
- `importerPrix` : lance `node scripts/importer-prix.js` (`execFile` avec `process.execPath`, `cwd` à la racine, délai 6 minutes) ; injectable pour les tests.

- [ ] **Step 1 : écrire les tests** : chaque route sans session répond 401 ; `tableau` rend les statistiques de la tâche 2 ; `hors-service` coupe puis rétablit (vérifié par `GET /`) ; `importer` deux fois en même temps donne 409 la seconde (`importerPrix` injecté et lent) ; `services` avec une fausse ASR ; `sante()` en simulation et en erreur réseau.
- [ ] **Step 2 : lancer** `node --test test/admin.test.js test/serveur.test.js` ; attendu : échec sur les nouveaux tests.
- [ ] **Step 3 : écrire les routes**, `sante()`, et le branchement dans `demarrer()` : `.env` lu pour `ADMIN_MDP_EMPREINTE` ; réglages dans `<DOSSIER_DONNEES>/reglages.json` avec `solutionsBrouillon: env.SOLUTIONS_BROUILLON === '1'` ; mesures dans `<DOSSIER_DONNEES>/mesures`.
- [ ] **Step 4 : relancer**, puis `npm test` ; attendu : tout passe.
- [ ] **Step 5 : commit** `feat(server): admin data routes and settings`.

### Task 7 : écran d'administration

**Files:**
- Create: `site/admin.html`, `site/css/admin.css`, `site/js/admin.js`
- Test: `test/serveur.test.js` (ajout : `/admin` sert la page)

**Interfaces:**
- Consumes: routes de la tâche 6 ; `el`, `appelerApi` de `site/js/dom.js` ; `site/css/polices.css`.
- Reproduit la maquette `back-office-motion.html` dans sa dernière version (voir la spécification, « La maquette validée, décrite »), avec les données réelles :
  - vue de connexion (champ mot de passe, bouton « Se connecter », message de blocage avec le délai) ; retour à cette vue sur toute réponse 401 ;
  - bande du haut : marque, état, onde du site (canvas, barres de 3 px espacées de 2 px, défilement de droite à gauche, un pic par nouvel appel reçu, retombée vers une ligne plate rouge en environ 1,5 s quand le site est coupé), bouton et confirmation ;
  - rubriques : Tableau de bord (trois chiffres, période, graphique 14 jours avec bulle au survol et au focus, classements produits, marchés et communes, heures, derniers appels en direct), Journal des appels, Refus (tableau par jour et par motif), État des services (avec « Vérifier l'API » et « Importer maintenant »), Réglages (solutions en brouillon, historique des coupures), Se déconnecter ;
  - menu sur le côté au-delà de 720 px de large, onglets en haut en dessous ;
  - relève toutes les 5 secondes de `appels` et `tableau` quand la page est visible ; l'en-tête `X-Activite: 1` est joint à la relève suivante après un clic, une frappe ou un défilement, et à chaque action (POST) ;
  - chargement : onde dessinée de gauche à droite (1,3 s) puis chiffres de 0 à leur valeur (0,9 s), rien d'autre ; `prefers-reduced-motion` : tout immobile ;
  - aucun style en ligne dans le HTML, aucun `innerHTML` avec des données (transcriptions incluses) : `el()`.
- `site/sw.js` : `admin.html`, `css/admin.css`, `js/admin.js` ne sont pas ajoutés à la liste mise en cache au démarrage.

- [ ] **Step 1 : écrire le test** `/admin sert la page d'administration` ; le lancer ; attendu : 404.
- [ ] **Step 2 : écrire les trois fichiers.**
- [ ] **Step 3 : relancer** `npm test` ; attendu : tout passe.
- [ ] **Step 4 : vérifier dans un navigateur** (serveur local en simulation, empreinte de test dans l'environnement) : connexion, blocage après 3 essais, chaque rubrique sur ordinateur et à 390 px de large, coupure puis remise en service (l'onde retombe et repart, l'accueil montre la page d'attente), pic dans l'onde à chaque demande vocale faite depuis l'application, déconnexion après 10 minutes sans activité (horloge réduite en test manuel), mouvement réduit. Faire des captures et les comparer à la maquette.
- [ ] **Step 5 : commit** `feat(admin): back office screen`.

### Task 8 : documentation

**Files:**
- Modify: `README.md`, `.env.example`

- [ ] **Step 1 :** `.env.example` : ligne commentée `ADMIN_MDP_EMPREINTE=` avec « à définir par `node scripts/admin-mot-de-passe.js`, sur le serveur ». README : section « Back office » (adresse, définition du mot de passe, mesures et ce qu'elles ne gardent pas, mode hors service, réglages), routes `/api/admin/*`, arborescence, nombre de tests.
- [ ] **Step 2 :** `npm test` ; attendu : tout passe.
- [ ] **Step 3 : commit** `docs(readme): document the back office`.
