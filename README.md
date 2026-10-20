# AgriFon — démo agriculture en fongbé

Application web (PWA, mobile d'abord) pour la journée de démonstration de la reconnaissance vocale du fongbé. Elle couvre les deux démos de la section **Agriculture** du catalogue :

| Démo | La personne dit (en fongbé) | Ce qui est extrait | Ce que fait le système |
| --- | --- | --- | --- |
| **Prix du marché** | « Combien coûte le maïs au marché de Glazoué ? » | le produit et le marché | cherche le prix dans la base et l'affiche |
| **Signalement d'une maladie des cultures** | « Les feuilles de mon maïs jaunissent. » | la culture et le symptôme | transmet le signalement localisé au conseiller agricole et confirme la réception |

La reconnaissance vocale est faite par l'API JaimeMaLangue : `POST /marche` (mode marché) pour les prix, `POST /transcribe` (modèle général) pour les signalements.

## Démarrer

Il faut Node.js 20.12 ou plus récent. Aucune dépendance à installer.

```bash
cp .env.example .env      # puis renseigner ASR_ID et ASR_MDP
npm start                 # http://localhost:3000
```

- Application citoyen : `http://localhost:3000`
- Espace conseiller (signalements reçus) : `http://localhost:3000/conseiller`

Sans identifiants, `npm run simulation` lance l'application avec des réponses factices (un bandeau « Mode simulation » l'indique) pour essayer l'interface.

### Sur un téléphone

Le navigateur n'autorise le micro que sur une adresse **https** (ou `localhost`). Pour la démo, servir l'application derrière un certificat, par exemple :

- un tunnel : `cloudflared tunnel --url http://localhost:3000` donne une adresse https publique ;
- ou un reverse proxy (Caddy, nginx) avec un certificat sur un serveur.

Une fois ouverte en https, l'application peut être ajoutée à l'écran d'accueil (« Installer l'application »).

## Déroulé conseillé pour la démo

1. Sur un écran de la salle, ouvrir `/conseiller`.
2. Sur le téléphone, **Prix du marché** : appuyer sur le micro, dire la phrase, appuyer de nouveau. La réponse écrite s'affiche (« Au marché de Glazoué, le maïs coûte 250 F CFA le kilo. »), avec le prix en gros et la comparaison avec les autres marchés.
3. **Signaler** : partager la position (ou choisir la commune), dire la phrase. L'écran confirme la réception avec une référence ; le signalement apparaît aussitôt sur l'écran conseiller, avec la transcription et le message vocal.
4. Sur l'écran conseiller, cliquer « Prendre en charge » : le téléphone affiche « Pris en charge par le conseiller » dans les secondes qui suivent.

Le bouton « ou envoyer un fichier audio » permet de rejouer un enregistrement préparé si la salle est bruyante.

## À faire avant le jour J : caler le vocabulaire fon

L'application retrouve les mots attendus dans la transcription (sans tenir compte des tons, avec une petite tolérance). Plusieurs listes sont à **valider et compléter par des locuteurs du fongbé** :

- **Symptômes** (`data/lexique.json`, champ `fon` des `symptomes`) : vides pour l'instant, seuls les mots français sont reconnus. Quand le symptôme n'est pas reconnu, le signalement part quand même, marqué « à préciser », et le conseiller a la transcription et le message vocal.
- **Cultures** (`data/lexique.json`) et **produits** (`data/prix.json`, `termes_fon`) : quelques noms fon courants (gbadé, mɔlikun, ayikun, azin, timati, takin…), à vérifier.
- **Marchés** (`data/prix.json`, `termes`) : variantes de prononciation des noms de lieux.

Méthode : répéter chaque phrase de démonstration dans l'application, lire la ligne « Vous avez dit : … », et ajouter les mots entendus dans le bon fichier. Redémarrer le serveur pour les prendre en compte.

## Fonctionnement

```
Téléphone (PWA) ──audio──▶ serveur AgriFon ──audio + identifiants──▶ API JaimeMaLangue
                ◀─réponse─                 ◀──────transcription─────
```

Les identifiants de l'API restent sur le serveur (exigence de la documentation de l'API). Le serveur n'envoie qu'une requête à la fois à l'API, qui ne traite qu'une phrase à la fois.

**Prix du marché** (`server/prix.js`) : le mode marché de l'API rend la liste des produits reconnus dans son lexique (153 produits) ; le terme rendu est rapproché d'un produit de la base. Le marché est cherché dans la transcription (et ses variantes de diagnostic). Sans marché, l'application donne la fourchette de prix et le marché le moins cher ; sans produit mais avec un marché, tous les prix de ce marché.

**Signalement** (`server/signalement.js`) : la transcription générale est analysée (culture, partie de la plante, symptôme, commune). La position GPS (si partagée) et la commune choisie accompagnent le signalement, qui est enregistré dans `stockage/` avec son audio et transmis à l'espace conseiller. Si une commune est choisie, les communes de son département sont passées à l'API (paramètre `noms`) pour mieux reconnaître un nom de lieu.

**Base de prix** (`data/prix.json`) : **données de démonstration**, fictives mais vraisemblables (13 produits, 13 marchés, prix de la semaine et de la semaine précédente). L'application l'indique sous chaque réponse. À remplacer par un vrai relevé de prix.

### API du serveur

| Méthode | Adresse | Rôle |
| --- | --- | --- |
| `POST` | `/api/prix` | corps : l'audio (`Content-Type: audio/…`) ; réponse : produit, marché, prix, phrase de réponse |
| `POST` | `/api/signalements?lat=&lon=&precision=&commune=` | corps : l'audio ; enregistre et renvoie le signalement |
| `GET` | `/api/signalements/{référence}` | statut d'un signalement (suivi côté citoyen) |
| `GET` | `/api/signalements` | liste (conseiller) |
| `POST` | `/api/signalements/{référence}/prise-en-charge` | prise en charge (conseiller) |
| `GET` | `/api/signalements/{référence}/audio` | message vocal (conseiller) |
| `GET` | `/api/prix/base`, `/api/communes`, `/api/etat` | données de référence, état du service |

Si `CODE_CONSEILLER` est défini, les routes « conseiller » demandent ce code (en-tête `X-Code-Conseiller` ou paramètre `code`) ; la page `/conseiller` le demande à l'ouverture.

## Charte graphique

L'interface suit la charte graphique du Gouvernement du Bénin (DA_gouvBJ) :

- police **Montserrat** (Light pour les accroches en capitales, Regular pour le texte), incluse dans `public/fonts/` ;
- couleurs du drapeau : vert `#006828`, jaune `#FFBE00`, rouge `#EB0000`, et noir ;
- logotype de ministère : armoiries, libellé de l'institution, bande tricolore, « République du Bénin » ;
- bande tricolore courte (1/3 de la largeur) centrée en bas de page, comme pour les documents des ministères ;
- mise en page inspirée du « site internet ministère » de la charte (logo en haut à gauche, barre de rubriques grise).

Les armoiries (`public/img/armoiries.png`) sont extraites telles quelles du PDF de la charte. La charte demande d'utiliser les fichiers officiels de la Direction de la Communication : les substituer à ce fichier dès qu'ils sont disponibles. Le libellé de l'institution est écrit dans `public/index.html` et `public/conseiller.html`.

## Structure

```
server/        serveur Node sans dépendance (index.js), client de l'API (asr.js),
               prix (prix.js), signalement (signalement.js), comparaison de texte (texte.js)
data/          base de prix de démonstration, lexique du signalement, 77 communes
public/        PWA : index.html, conseiller.html, css/, js/, manifeste, service worker, icônes
test/          tests (node --test)
```

## Tests

```bash
npm test
```

## Limites connues

- Le vocabulaire fon des symptômes reste à fournir (voir plus haut).
- Les prix sont fictifs.
- Les signalements sont gardés dans un fichier JSON : suffisant pour une démo, pas pour un service réel.
- Les nombres dits en français et les noms propres rares sont les points faibles connus de la reconnaissance (documentation de l'API).
