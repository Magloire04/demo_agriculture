# Voix d'AgriFon en phrases entières : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objectif :** dire chaque réponse fon d'un seul tenant avec la voix `homme2` de la route de synthèse JML, gardée en réserve sur le serveur, avec repli sur l'ancienne voix en morceaux quand la nouvelle n'est pas prête.

**Architecture :** `server/wav.js` lit, écrit, rééchantillonne et assemble des WAV PCM. `server/synthese.js` compose le texte à dire, l'identifie, appelle le labo (une synthèse à la fois), garde les sons dans `stockage/voix-phrases/` et les purge. `server/index.js` ajoute l'identifiant aux réponses et sert `GET /api/voix/<id>.wav`. Le téléphone (`site/js/voix.js`) précharge le son dès l'arrivée de la réponse et choisit, à l'appui, entre la nouvelle voix et les anciens extraits. `scripts/voix/preparer-phrases.js`, lancé par `scripts/deployer.sh`, prépare les phrases fixes.

**Pile :** Node.js ≥ 20.12, modules ES, sans dépendance npm ; tests `node --test` ; navigateur sans framework.

**Spécification :** `docs/superpowers/specs/2026-10-26-voix-phrases-entieres-design.md` (à lire avant chaque tâche).

## Contraintes globales

- Aucune dépendance ajoutée à `package.json`. Tests en `node:test` et `node:assert/strict`, écrits avant le code, sans aucun appel réel au labo.
- Noms de code en français, comme le reste du dépôt. Commits en anglais, Conventional Commits, sans aucune trace d'outil d'IA (règle `git-sans-trace-ia`).
- Route de synthèse par défaut : `https://51-159-167-70.sslip.io/app/api/tts-fon-p1`, corps `{ "texte", "voix" }`, authentification Basic avec `ASR_ID` et `ASR_MDP`. Voix par défaut : `homme2`. Réglages `.env` : `VOIX_URL`, `VOIX_NOM`, `VOIX_PHRASES` (`0` coupe la nouvelle voix).
- Mode simulation (`ASR_SIMULATION=1` ou `--simulation`) : aucun appel au labo, la nouvelle voix est coupée.
- Les identifiants ne quittent jamais le serveur ; seuls les textes produits par AgriFon peuvent être synthétisés (pas de route qui prend un texte).
- Texte à dire : morceaux de voix mis bout à bout, montants en toutes lettres, « r » gardés, minuscule au début d'un morceau qui ne suit pas `.`, `!`, `?` ou `:`.
- Morceaux de 300 caractères au plus, coupés entre deux phrases ; 250 ms de silence entre deux morceaux recollés.
- Son en réserve : WAV PCM 16 bits mono à 16 kHz. Réserve purgée après 30 jours sans usage, plafonnée à 300 Mo (les plus anciens partent d'abord).
- Téléphone : attente de 5 s au plus après l'appui, puis anciens extraits. Après « pas encore prêt » (202), nouvelle demande toutes les 10 s, 12 fois au plus.
- CSP inchangée (`media-src 'self' blob:` existe déjà) ; aucun style en ligne dans le HTML.
- Le plan s'arrête à la PR.

## Points à surveiller en revue

1. Le labo répond une erreur, un corps qui n'est pas un WAV ou un WAV tronqué : rien n'entre dans la réserve et le téléphone se replie (tests dans la tâche 2).
2. Deux demandes simultanées pour le même identifiant ne déclenchent qu'une synthèse (test dans la tâche 2).
3. Après un redémarrage, un identifiant déjà en réserve est servi, un identifiant émis mais pas encore synthétisé rend 404 et le téléphone se replie (tests dans les tâches 2 et 3).
4. Une phrase seule de plus de 300 caractères est coupée aux virgules, puis aux espaces, sans perdre un mot (test dans la tâche 2).
5. Un chemin forgé (`/api/voix/../x`, identifiant non hexadécimal, autre extension) rend 404 (test dans la tâche 3).

---

## Structure des fichiers

| Fichier | Rôle |
| --- | --- |
| `server/wav.js` (nouveau) | lecture, écriture, rééchantillonnage, assemblage de WAV PCM 16 bits mono |
| `server/synthese.js` (nouveau) | texte à dire, découpage, identifiant, appel au labo, réserve, file, pause après échec, purge, préparation |
| `server/index.js` | `voix_phrase` dans les réponses, route `GET /api/voix/<id>.wav`, création au démarrage |
| `server/admin.js`, `site/js/admin.js` | ligne « Voix fon (JML) » dans l'état des services |
| `site/js/voix.js`, `site/js/app.js`, `site/sw.js` | préchargement, choix de la voix à l'appui, mention de la voix jouée |
| `scripts/voix/preparer-phrases.js` (nouveau), `scripts/deployer.sh` | préparation des phrases fixes après déploiement |
| `.env.example`, `README.md` | documentation |

---

### Task 1 : WAV PCM (lecture, écriture, rééchantillonnage, assemblage)

**Files:**
- Create: `server/wav.js`
- Test: `test/wav.test.js`

**Interfaces:**
- Produces :
  - `lireWav(tampon: Buffer): { frequence: number, echantillons: Int16Array }` : PCM 16 bits mono seulement, blocs inconnus sautés ; sinon `Error` dont le message commence par `WAV non pris en charge`.
  - `ecrireWav({ frequence, echantillons }): Buffer` : en-tête de 44 octets.
  - `reechantillonner(echantillons: Int16Array, de: number, vers: number): Int16Array` : longueur `Math.round(n * vers / de)`, filtre passe-bas sous la moitié de la plus petite fréquence (sinus cardinal fenêtré), valeurs bornées à l'intervalle 16 bits.
  - `assembler(sons: Int16Array[], frequence: number, silenceMs: number): Int16Array`.

- [ ] **Step 1 : écrire les tests**

```js
const sinus = (f, fe, duree, a = 10_000) => Int16Array.from({ length: Math.round(fe * duree) }, (_, i) => Math.round(a * Math.sin((2 * Math.PI * f * i) / fe)));
const efficace = (e) => Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length);

test('écrire puis lire un WAV rend les mêmes échantillons', () => {
  const echantillons = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  const tampon = ecrireWav({ frequence: 16000, echantillons });
  assert.equal(tampon.length, 54);
  assert.equal(tampon.toString('latin1', 0, 4), 'RIFF');
  assert.deepEqual(lireWav(tampon), { frequence: 16000, echantillons });
});
test('lireWav saute un bloc LIST et refuse un WAV stéréo', () => { /* bloc LIST de 4 octets inséré avant « data » : lu sans erreur ; canaux = 2 : assert.throws(..., /WAV non pris en charge/) */ });
test('24 kHz vers 16 kHz : longueur, amplitude et fréquence gardées pour 1 kHz', () => {
  const sortie = reechantillonner(sinus(1000, 24000, 1), 24000, 16000);
  assert.equal(sortie.length, 16000);
  const rapport = efficace(sortie.subarray(500, 15500)) / efficace(sinus(1000, 16000, 1));
  assert.ok(rapport > 0.95 && rapport < 1.05, String(rapport));
  let passages = 0;
  for (let i = 501; i < 15500; i++) if ((sortie[i - 1] < 0) !== (sortie[i] < 0)) passages++;
  assert.ok(Math.abs(passages - 1875) < 20, String(passages));
});
test('24 kHz vers 16 kHz : 10 kHz est coupé, sans repliement', () => {
  const sortie = reechantillonner(sinus(10000, 24000, 1), 24000, 16000);
  assert.ok(efficace(sortie.subarray(500, 15500)) < 0.05 * efficace(sinus(10000, 24000, 1)));
});
test('assembler met un silence entre deux sons', () => {
  assert.deepEqual([...assembler([Int16Array.from([1, 2]), Int16Array.from([3])], 1000, 3)], [1, 2, 0, 0, 0, 3]);
});
```

- [ ] **Step 2 : lancer `node --test test/wav.test.js`.** Attendu : échec, module `server/wav.js` introuvable.
- [ ] **Step 3 : écrire `server/wav.js`.** Sinus cardinal fenêtré (Blackman), 16 échantillons d'entrée de part et d'autre, fréquence de coupure à 0,45 × la plus petite des deux fréquences.
- [ ] **Step 4 : relancer.** Attendu : 5 tests passent ; `npm test` passe en entier.
- [ ] **Step 5 : commit** `feat(server): read, write and resample PCM WAV`.

### Task 2 : synthèse, réserve et appel au labo

**Files:**
- Create: `server/synthese.js`
- Test: `test/synthese.test.js`

**Interfaces:**
- Consumes : `lireWav`, `ecrireWav`, `reechantillonner`, `assembler` (tâche 1) ; `texteVoix` de `server/voix.js`.
- Produces :
  - `texteADire(morceaux: string[]): string`
  - `decouperTexte(texte: string, max = 300): string[]`
  - `idPhrase(texte: string, voix: string): string` : 16 caractères hexadécimaux de `sha1(`${voix}|${texteVoix(texte)}`)`. La voix fait partie de l'identifiant : changer de voix ne ressert pas les anciens sons.
  - `creerAppelLabo({ url, identifiant, motDePasse, voix, delaiMs = 90_000, fetch = globalThis.fetch }): (texte: string) => Promise<Buffer>` : rejette sur statut non 2xx, délai dépassé, ou corps qui ne commence pas par `RIFF` puis `WAVE`.
  - `creerSynthese({ dossier, appeler, voix, attenteMs = 20_000, maxFile = 20, pauseEchecMs = 300_000, maxOctets = 300 * 2 ** 20, joursConservation = 30, maxIdentifiants = 5000, silenceMs = 250, frequence = 16_000, maintenant = Date.now })` qui rend :
    - `enregistrer(texte): string` : l'identifiant ; garde au plus `maxIdentifiants` textes en mémoire (les plus anciens oubliés) ;
    - `obtenir(id, { attenteMs }?): Promise<{ etat: 'pret', chemin } | { etat: 'en_cours' } | { etat: 'inconnu' }>` : fichier présent, alors `pret` et date de modification remise à maintenant ; sinon identifiant inconnu, alors `inconnu` ; sinon synthèse lancée ou rejointe, attente bornée ; file pleine ou pause après échec, alors `en_cours` sans appel ;
    - `preparer(textes: string[], { pauseMs = 2000 }?): Promise<{ faits, deja, echecs }>` : une synthèse à la fois, hors de la file, déjà présents sautés ;
    - `purger(): Promise<{ effaces: number }>` ;
    - `etat(): Promise<{ en_reserve, octets, derniere_erreur, pause_jusqua }>` (dates ISO ou `null`).
  - `creerSyntheseDepuisEnv(env, dossierDonnees, { simulation }): synthese | null` : `null` si `simulation`, si `VOIX_PHRASES=0` ou sans `ASR_ID` et `ASR_MDP`.
- Une synthèse : `decouperTexte`, un appel par morceau dans l'ordre, chaque WAV lu, ramené à 16 kHz, assemblé, écrit dans un fichier temporaire puis renommé `<id>.wav`. Un échec n'écrit rien, mémorise l'erreur et ouvre une pause de `pauseEchecMs`.

- [ ] **Step 1 : écrire les tests**, avec un `appeler` factice qui rend `ecrireWav({ frequence: 24000, echantillons: new Int16Array(2400) })` et note les textes reçus.

```js
test('texte à dire : minuscule en milieu de phrase, majuscule après un point', () => {
  assert.equal(texteADire(['È nɔ sa gbadé kilo ɖokpó yí', 'kpɔ́nwun wǒ', 'Ɖo Dantokpa axi mɛ.']), 'È nɔ sa gbadé kilo ɖokpó yí kpɔ́nwun wǒ ɖo Dantokpa axi mɛ.');
  assert.equal(texteADire(['Un ma se nǔ ɔ sín nyǐkɔ ǎ.', 'Ɖo Pobè axi mɛ ɔ, nǔ lɛ́ sín akwɛ́ ɖíe.']), 'Un ma se nǔ ɔ sín nyǐkɔ ǎ. Ɖo Pobè axi mɛ ɔ, nǔ lɛ́ sín akwɛ́ ɖíe.');
});
test('découpage : phrases regroupées sous 300 caractères, une phrase trop longue coupée sans perdre un mot', () => {
  /* trois phrases de 120 caractères : 2 morceaux, aucun > 300, mots rejoints identiques au texte ;
     une phrase de 400 caractères avec des virgules : coupée après une virgule ; sans virgule : aux espaces */
});
test('identifiant : même texte à la casse près, voix différente, 16 caractères hexadécimaux', () => {
  assert.equal(idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'homme2'), idPhrase('mǐ sɛ́ xó mitɔn dó.', 'homme2'));
  assert.notEqual(idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'homme2'), idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'femme'));
  assert.match(idPhrase('Mǐ sɛ́ xó mitɔn dó.', 'homme2'), /^[0-9a-f]{16}$/);
});
test('appel au labo : Basic, JSON { texte, voix }, rejet sur 500 et sur un corps qui n’est pas un WAV', async () => {
  /* fetch factice : reçoit POST sur l'url, Authorization === 'Basic ' + base64('id:mdp'),
     corps JSON { texte: 'Mǐ sɛ́ xó mitɔn dó.', voix: 'homme2' } ; un WAV rendu tel quel ;
     statut 500 : assert.rejects ; corps 'oops' en 200 : assert.rejects */
});
test('une phrase synthétisée une fois, servie ensuite sans appel, en WAV 16 kHz', async () => {
  /* id = enregistrer(texte) ; obtenir(id) → { etat: 'pret', chemin } ; lireWav(lecture du chemin).frequence === 16000 ;
     second obtenir → pret ; appeler appelé une seule fois, avec le texte */
});
test('identifiant jamais émis : inconnu, sans appel', async () => {
  /* obtenir('0123456789abcdef') → { etat: 'inconnu' } ; appeler jamais appelé */
});
test('deux demandes simultanées : une seule synthèse', async () => {
  /* Promise.all([obtenir(id), obtenir(id)]) → deux 'pret' ; appeler appelé une fois */
});
test('labo lent : en_cours, puis pret sans nouvel appel', async () => { /* appeler qui attend une promesse ; attenteMs 10 */ });
test('texte long : un appel par morceau, dans l’ordre, sons recollés avec 250 ms de silence', async () => { /* longueur = somme + 4000 échantillons par couture */ });
test('échec du labo : rien en réserve, pause, puis nouvel essai après la pause', async () => { /* horloge factice */ });
test('corps tronqué ou non WAV : rien en réserve', async () => {
  /* appeler rend les 30 premiers octets d'un WAV : obtenir → en_cours, aucun fichier dans le dossier, etat().derniere_erreur non nulle */
});
test('file pleine : en_cours sans mise en file', async () => {
  /* maxFile 1, appeler bloqué sur une promesse : 1er identifiant en cours ; 2e → en_cours, appeler appelé une fois ;
     promesse libérée puis 2e redemandé → pret, appeler appelé deux fois */
});
test('après un redémarrage : un son en réserve est servi, un identifiant non synthétisé est inconnu', async () => { /* second creerSynthese sur le même dossier */ });
test('purge : plus de 30 jours sans usage effacés, puis les plus anciens au-delà du plafond', async () => { /* fs.utimes */ });
test('préparation : déjà présents sautés, échecs comptés', async () => { /* { faits: 1, deja: 1, echecs: 0 } */ });
test('creerSyntheseDepuisEnv : null en simulation, avec VOIX_PHRASES=0 ou sans identifiants', () => {
  const env = { ASR_ID: 'id', ASR_MDP: 'mdp' };
  assert.equal(creerSyntheseDepuisEnv(env, dossier, { simulation: true }), null);
  assert.equal(creerSyntheseDepuisEnv({ ...env, VOIX_PHRASES: '0' }, dossier, { simulation: false }), null);
  assert.equal(creerSyntheseDepuisEnv({}, dossier, { simulation: false }), null);
  assert.notEqual(creerSyntheseDepuisEnv(env, dossier, { simulation: false }), null);
});
```

- [ ] **Step 2 : lancer `node --test test/synthese.test.js`.** Attendu : échec, module introuvable.
- [ ] **Step 3 : écrire `server/synthese.js`** selon les interfaces.
- [ ] **Step 4 : relancer.** Attendu : tous passent ; `npm test` passe en entier.
- [ ] **Step 5 : commit** `feat(server): whole-sentence speech synthesis with an on-disk reserve`.

### Task 3 : identifiants dans les réponses et route du son

**Files:**
- Modify: `server/index.js`
- Test: `test/voix-phrases-serveur.test.js` (nouveau, même aide de démarrage que `test/serveur.test.js`, avec `synthese` construite par `creerSynthese` et un `appeler` factice)

**Interfaces:**
- Consumes : `creerSynthese`, `texteADire`, `creerSyntheseDepuisEnv` (tâche 2).
- Produces :
  - option `synthese = null` de `creerApplication` ;
  - champ `voix_phrase` (identifiant ou `null`) dans la réponse de `POST /api/prix`, dans celle de `POST /api/signalements` (titre et accusé joints) et dans `solutions` (`solutions.voix_phrase`) ; `voix` (anciens extraits) inchangé ;
  - `GET /api/voix/<id>.wav`, `id` en `[0-9a-f]{16}` : `pret`, alors 200 `audio/wav` avec `Cache-Control: public, max-age=31536000, immutable` ; `en_cours`, alors 202 `{ pret: false }` avec `Retry-After: 10` ; `inconnu`, sans synthèse, ou chemin non conforme, alors 404 ;
  - au démarrage : `creerSyntheseDepuisEnv(env, dossierDonnees, { simulation: asr.simulation })`, `purger()` au démarrage puis toutes les 24 h (minuterie `unref`), une ligne de journal qui dit si la nouvelle voix est active.

- [ ] **Step 1 : écrire les tests**

```js
test('prix : voix_phrase, et le labo reçoit le texte entier en minuscule au milieu', async (t) => {
  /* corps.voix_phrase correspond à /^[0-9a-f]{16}$/ ; textes reçus par appeler :
     /^È nɔ sa gbadé kilo ɖokpó yí .+ ɖo Glazoué axi mɛ\.$/ une fois le son demandé */
});
test('son : 200 audio/wav immuable, en 16 kHz', async (t) => { /* readUInt32LE(24) === 16000 */ });
test('son : 202 avec Retry-After 10 tant que le labo travaille, puis 200', async (t) => {});
test('son : identifiant inconnu, chemins forgés, autre extension : 404', async (t) => {
  for (const chemin of ['/api/voix/0123456789abcdef.wav', '/api/voix/../index.html', '/api/voix/XYZ.wav', '/api/voix/0123456789abcdef.mp3']) { /* 404 */ }
});
test('signalement : voix_phrase de l’accusé, et solutions.voix_phrase quand des solutions sont proposées', async (t) => {
  /* reprendre la transcription du test existant qui obtient solutions.elements dans test/serveur.test.js */
});
test('sans synthèse : voix_phrase null et route du son en 404', async (t) => {
  /* creerApplication sans option synthese : corps.voix_phrase === null ; GET /api/voix/<16 hex>.wav → 404 */
});
test('protection : un robot est refusé sur la route du son', async (t) => { /* creerProtection(), User-Agent curl : 403 */ });
```

- [ ] **Step 2 : lancer `node --test test/voix-phrases-serveur.test.js`.** Attendu : échec (champ absent, route en 404).
- [ ] **Step 3 : modifier `server/index.js`** selon les interfaces.
- [ ] **Step 4 : relancer.** Attendu : tous passent ; `npm test` passe en entier.
- [ ] **Step 5 : commit** `feat(server): serve whole-sentence voice for each answer`.

### Task 4 : le téléphone choisit la voix à l'appui

**Files:**
- Modify: `site/js/voix.js`, `site/js/app.js`, `site/sw.js` (cache `agrifon-v11`)

**Interfaces:**
- Consumes : `voix_phrase` et `solutions.voix_phrase` (tâche 3), route `api/voix/<id>.wav`.
- Produces (dans `site/js/voix.js`) :
  - `prechargerPhrase(id: string): void` : télécharge le son en arrière-plan ; 200, alors gardé en `Blob` ; 202, alors nouvel essai après `Retry-After` (10 s par défaut), 12 fois au plus ; autre réponse ou erreur réseau, alors abandon. Un identifiant déjà chargé ou en cours n'est pas redemandé.
  - `lireReponse({ phrase, extraits }): Promise<'nouvelle' | 'ancienne'>` : à appeler depuis le geste. Débloque aussitôt le lecteur en y jouant un court silence (WAV de 50 ms fabriqué en mémoire, URL `blob:`). Ensuite : son prêt, alors joué ; chargement en cours, alors attente de 5 s au plus ; sinon `lireExtraits(extraits)`. Sans extraits et sans son, rejette.
  - `arreterLecture()` arrête aussi la nouvelle voix.
- Dans `site/js/app.js` : `lecture(extraits, phrase)` affiche le bouton si l'un des deux existe, lance `prechargerPhrase(phrase)` à l'affichage, montre « Je prépare la voix… » pendant l'attente, puis la mention de la voix jouée : « Voix de synthèse JML (OmniVoice, licence CC BY-NC 4.0), en attente de relecture par un locuteur. » ou la mention FongLab actuelle. Appels : prix (`r.voix`, `r.voix_phrase`), signalement (`s.voix`, `s.voix_phrase`), solutions (`solutions.voix`, `solutions.voix_phrase`).

- [ ] **Step 1 : écrire le script de vérification dans le navigateur** (Playwright, serveur local en simulation). `page.route` ajoute `voix_phrase` à la réponse de `/api/prix` et simule `/api/voix/*` ; un espion sur `HTMLMediaElement.prototype.play` note les `src` joués. Quatre cas :
  1. son prêt avant l'appui : `blob:` joué, mention JML ;
  2. 202 constant : extraits `voix/….mp3` joués aussitôt, mention FongLab ;
  3. son servi après 3 s : « Je prépare la voix… », puis `blob:` ;
  4. son servi après 8 s : extraits joués 5 s après l'appui.
- [ ] **Step 2 : lancer le script sur le code actuel.** Attendu : les quatre cas échouent (aucun `blob:`, pas de préchargement).
- [ ] **Step 3 : modifier `site/js/voix.js`, `site/js/app.js` et `site/sw.js`.**
- [ ] **Step 4 : relancer le script.** Attendu : les quatre cas passent ; aucune erreur dans la console ; `npm test` passe en entier.
- [ ] **Step 5 : commit** `feat(pwa): play the whole-sentence voice, fall back to the clips`.

### Task 5 : préparation des phrases fixes après déploiement

**Files:**
- Create: `scripts/voix/preparer-phrases.js`
- Modify: `scripts/deployer.sh`
- Test: `test/preparer-phrases.test.js`

**Interfaces:**
- Consumes : `creerTextes` (`server/reponses.js`), `texteADire`, `creerSyntheseDepuisEnv` (tâche 2).
- Produces :
  - `phrasesFixes({ reponses, base, communes, releves }): string[]` (exportée) : pour chaque commune, puis sans commune (GPS), le titre et l'accusé joints comme dans `server/index.js` ; `prix_non_compris` ; `prix_marche_seul` pour chaque marché qui a au moins un prix. Sans doublon.
  - exécutable : charge `.env`, les données et les relevés (`stockage/releves-prix.json`, sinon `data/releves-prix.json`), appelle `preparer(phrasesFixes(…), { pauseMs: 2000 })`, écrit un bilan d'une ligne, sort en 0 sans rien faire si `creerSyntheseDepuisEnv` rend `null`.
  - `scripts/deployer.sh` : après le redémarrage, une étape « Voix des phrases fixes » qui lance le script en arrière-plan (`nohup`, `node` trouvé comme dans `scripts/importer-prix.sh`), journal dans `stockage/voix-phrases/preparation.log`. Le déploiement n'attend pas la fin.

- [ ] **Step 1 : écrire les tests.**

```js
test('phrases fixes : chaque commune, le GPS, produit non compris, chaque marché avec des prix', () => {
  /* longueur === communes.length + 1 + 1 + nombre de marchés avec au moins un prix ;
     contient texteADire(textes.joindre([titre, recu Bohicon]).voix), exactement ce que dit le serveur */
});
test('le serveur et la préparation produisent le même identifiant pour un accusé de signalement', async (t) => {
  /* voix_phrase d'un signalement à Bohicon === idPhrase(phrase fixe correspondante, 'homme2') */
});
```

- [ ] **Step 2 : lancer `node --test test/preparer-phrases.test.js`.** Attendu : échec, module introuvable.
- [ ] **Step 3 : écrire le script et l'étape de `scripts/deployer.sh`.**
- [ ] **Step 4 : relancer.** Attendu : les deux passent ; `npm test` passe en entier ; `bash -n scripts/deployer.sh` ne signale rien.
- [ ] **Step 5 : commit** `feat(scripts): prepare fixed sentences after deployment`.

### Task 6 : état dans le back office et documentation

**Files:**
- Modify: `server/admin.js`, `server/index.js` (passage de `synthese` à `creerAdmin`), `site/js/admin.js`, `.env.example`, `README.md`
- Test: `test/admin.test.js`

**Interfaces:**
- Consumes : `synthese.etat()` (tâche 2).
- Produces : `GET /api/admin/services` rend aussi `voix` (`synthese.etat()` ou `null`) ; l'écran affiche une ligne « Voix fon (JML) » : nombre de phrases en réserve et place prise, ou « coupée » ; s'il y a une pause, « en pause après une erreur jusqu'à HH:MM ».

- [ ] **Step 1 : écrire le test** : avec une `synthese` factice dont `etat()` rend `{ en_reserve: 3, octets: 120000, derniere_erreur: null, pause_jusqua: null }`, `services.voix` vaut cet objet ; sans synthèse, `null`.
- [ ] **Step 2 : lancer `node --test test/admin.test.js`.** Attendu : échec, `voix` absent.
- [ ] **Step 3 : modifier le serveur et l'écran ; documenter dans `.env.example` (`VOIX_URL`, `VOIX_NOM`, `VOIX_PHRASES`) et dans `README.md`** : nouvelle voix et repli, réserve et purge, préparation au déploiement, route utilisée et réserve d'usage (route de l'application JML, licence CC BY-NC 4.0), nombre de tests.
- [ ] **Step 4 : relancer.** Attendu : passe ; `npm test` passe en entier.
- [ ] **Step 5 : commit** `feat(admin): show the whole-sentence voice reserve` puis `docs(readme): describe the whole-sentence voice`.
