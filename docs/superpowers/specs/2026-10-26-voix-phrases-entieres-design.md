# Voix d'AgriFon : des phrases entières avec la voix JML

Date : 26 octobre 2026. Statut : relu par un constructeur indépendant, en attente de validation par Elisée.

## Intention

Aujourd'hui, la réponse en fongbé est dite par 577 petits extraits préparés à l'avance avec l'ancienne API de synthèse FongLab (VITS), que le téléphone enchaîne. Deux choses gênent Elisée : la voix elle-même, et le fait d'entendre la phrase en morceaux recollés.

Le labo sert désormais une voix bien meilleure (OmniVoice affiné sur le fon, « voix P1 » de l'application JML Traduction). AgriFon doit dire chaque réponse d'un seul tenant, comme une vraie phrase, avec cette voix. L'ancienne voix en morceaux reste en réserve pour les moments où la nouvelle ne répond pas.

## Décisions d'Elisée

- **Voix** : `homme2` de la route de synthèse de JML, choisie à l'écoute le 26 octobre parmi `homme`, `homme2` et `femme`, sur une réponse de prix d'AgriFon.
- **Phrases entières** : chaque réponse fon est synthétisée en une fois, plus en morceaux.
- **Repli** : si la nouvelle voix n'est pas prête (GPU occupé, lent ou en panne), AgriFon joue l'ancienne voix en morceaux.
- **Le chemin, le déroulé, la préparation à l'avance et le poids** décrits dans « Fonctionnement » ont été proposés à Elisée et acceptés tels quels.

## Ce que l'on sait de la route de synthèse

Relevé le 26 octobre 2026, la route n'ayant pas de documentation publique.

- Adresse : `POST https://51-159-167-70.sslip.io/app/api/tts-fon-p1`, sur le serveur de l'API de reconnaissance qu'AgriFon utilise déjà.
- Authentification : la même que l'API de reconnaissance (Basic, `ASR_ID` et `ASR_MDP` du `.env`). Le serveur AgriFon la joint (vérifié depuis le serveur de production : 200 en 3,6 s pour une phrase courte).
- Corps JSON : `{ "texte": "<fon>", "voix": "homme2" }`. L'application JML ajoute `langue: "fr"` pour du français : AgriFon ne l'envoie pas.
- Réponse : `audio/wav`, PCM 16 bits, mono, 24 kHz, avec les en-têtes `X-Duree-Audio-s` et `X-Calcul-s`.
- Temps mesurés le 26/10 pour une réponse de prix de 8 à 11 s de son : 10 à 29 s d'attente selon la charge. La synthèse est partagée avec JML Traduction et traite une requête à la fois.
- La synthèse ne retarde pas la reconnaissance vocale : mesuré le 26/10, une transcription lancée pendant une synthèse de 23 s a pris 2,4 s, comme au repos. La voix a donc sa propre file, indépendante de celle de `server/asr.js`, et la préparation à l'avance peut se faire hors de l'application.
- Longueur maximale du texte : inconnue. L'application JML découpe ses textes en morceaux de 300 caractères au plus.
- Licence des poids OmniVoice : CC BY-NC 4.0, non commerciale. AgriFon est une démonstration.

Cette route sert d'abord à l'application JML Traduction et peut changer sans prévenir. Elisée en informe le labo. L'adresse et le nom de la voix sont des réglages du `.env`, pour qu'un changement ne demande pas de toucher au code.

L'autre API de synthèse du labo (`http://151.115.149.1:8090`, voix l51) n'est pas utilisée : l'hébergement Spaceship interdit les sorties vers le port 8090 (vérifié le 26/10).

## Fonctionnement

### Côté serveur

1. Quand AgriFon compose une réponse qui a une voix (prix, accusé de réception d'un signalement, solutions proposées), il garde comme aujourd'hui la liste des anciens extraits. Il calcule aussi le **texte à dire d'un seul tenant** : les morceaux de voix mis bout à bout, montants en toutes lettres (kpɔ́nwun, ɖɔ̌la, caki, comme aujourd'hui), sans majuscule au début d'un morceau qui ne commence pas une phrase.
2. Ce texte reçoit un **identifiant** : son empreinte, calculée comme celle des extraits actuels (texte normalisé NFC). La réponse JSON porte cet identifiant à côté de la liste des anciens extraits, sans retirer celle-ci.
3. **Seuls les textes produits par AgriFon peuvent être synthétisés.** Le serveur tient la liste des identifiants qu'il a émis. Une route qui accepterait n'importe quel texte ferait d'AgriFon un relais gratuit vers le GPU du labo.
4. Une nouvelle route rend le son d'un identifiant :
   - s'il est déjà dans la réserve : le son, aussitôt, avec un en-tête de cache longue durée (le contenu d'un identifiant ne change jamais) ;
   - sinon : AgriFon lance la synthèse, si elle n'est pas déjà en cours, et attend le résultat un temps borné. Prêt à temps, le son est rendu ; sinon, une réponse dit « pas encore prêt ». La synthèse continue et le son rejoint la réserve pour la fois suivante.
   - identifiant inconnu : 404.
5. **Appels au labo** : un seul à la fois, dans une file bornée. File pleine, la réponse est « pas encore prêt » et le téléphone se replie. Après un échec (erreur, délai dépassé), AgriFon cesse d'appeler le labo quelques minutes, puis réessaie.
6. **Textes longs** : un texte de plus de 300 caractères est coupé entre deux phrases en morceaux de 300 caractères au plus. Chaque morceau est synthétisé à son tour, puis les sons sont recollés avec un court silence. Le texte reste dit en phrases entières : seules les coutures entre phrases changent.
7. **Poids** : avant d'entrer dans la réserve, le son passe de 24 à 16 kHz, en JavaScript, avec un filtrage qui évite le repliement. Il pèse un tiers de moins. Le MP3 pourra être demandé au labo plus tard.
8. **Réserve** : un fichier par identifiant, sous `stockage/` (le dossier des données, conservé d'un déploiement à l'autre). Un son non servi depuis 30 jours est effacé, et la réserve est plafonnée en taille, les plus anciens partant les premiers.
9. **Phrases préparées à l'avance**, après chaque déploiement : les accusés de réception de signalement (avec chacune des 77 communes, et la variante GPS), la phrase « produit non compris » et les phrases « marché compris sans produit ». Elles sont générées une à la fois, avec une pause entre deux, pour ne pas accaparer le GPU partagé, et une phrase déjà en réserve n'est pas refaite. Les phrases de prix (qui changent à chaque import) et de solutions (trop de combinaisons) sont générées à la première demande.
10. **Mode simulation** (`ASR_SIMULATION=1`) : aucun appel au labo, toujours l'ancienne voix.

### Côté téléphone

1. Dès qu'une réponse avec un identifiant de voix arrive, le téléphone demande le son en arrière-plan, pendant que l'agriculteur lit le texte.
2. À l'appui sur « Écouter en fongbé » :
   - nouvelle voix prête : elle est jouée ;
   - en cours : le bouton indique « Je prépare la voix… » et le téléphone attend au plus 5 secondes de plus ; prête à temps, elle est jouée, sinon l'ancienne voix en morceaux ;
   - « pas encore prêt », erreur ou pas d'identifiant : l'ancienne voix en morceaux, aussitôt.
3. La lecture part toujours du geste de l'agriculteur (contrainte de l'iPhone) : le lecteur est débloqué à l'appui, avant toute attente.
4. Après un « pas encore prêt », le téléphone redemande le son en arrière-plan, à intervalles réguliers et un nombre limité de fois, tant que la réponse reste à l'écran. Ces demandes restent sous les limites par visiteur.
5. Un second appui pendant la lecture l'arrête, comme aujourd'hui. Un nouvel appui plus tard joue la nouvelle voix si elle est arrivée entre-temps.
6. La mention sous le bouton nomme la voix effectivement jouée et sa licence (CC BY-NC 4.0). Pour la nouvelle voix : voix de synthèse JML (OmniVoice).

## Objectifs

- Les réponses en fongbé sont dites d'un seul tenant avec la voix `homme2` dès qu'elle est disponible.
- L'agriculteur n'attend jamais plus de 5 secondes après son appui pour entendre une voix.
- Une phrase déjà dite revient aussitôt.

## Non-objectifs

- Faire lire le français à voix haute.
- Changer le texte fon des réponses ou la façon de dire les montants.
- Supprimer les 577 anciens extraits ou leur outil de génération : ils restent la voix de repli.
- Exposer une synthèse libre, pour n'importe quel texte.

## Anti-objectifs

- Faire attendre une réponse de prix ou de signalement à cause de la voix : le texte s'affiche toujours aussitôt.
- Accaparer le GPU partagé du labo (rafales d'appels, nouvelles tentatives en boucle).
- Laisser un visiteur ou un robot déclencher des synthèses pour des textes qu'AgriFon n'a pas produits.

## Contraintes

- Node 20.12 au moins, sans dépendance npm (comme tout le projet) ; pas de `ffmpeg` sur le serveur de production.
- Les règles de protection en place (robots refusés, même origine, limites par visiteur) s'appliquent à la nouvelle route.
- Les identifiants de l'API ne quittent jamais le serveur.
- L'hébergement redémarre l'application quand il veut : la réserve est sur disque, et la liste des identifiants émis peut se perdre sans casser le téléphone, qui se replie alors sur l'ancienne voix.
- Tests `node --test` pour le serveur, sans appel réel au labo.

## Choix faits pendant la conception (à vérifier par Elisée)

- **Demande du son dès l'arrivée de la réponse, attente de 5 s au plus après l'appui** : la voix se lance à l'appui, pas toute seule. Commencer la synthèse pendant la lecture du texte laisse à la nouvelle voix le temps d'arriver.
- **Nouvelles demandes du son en arrière-plan** après un « pas encore prêt » (point 4 du téléphone) : sans elles, une réponse arrivée pendant que la file attend ne serait jamais dite avec la nouvelle voix.
- **Les « r » restent des « r »** : l'ancien générateur remplace « r » par « l », parce que le modèle VITS ne savait pas le dire. Le texte envoyé à la nouvelle voix est celui des morceaux, tel qu'écrit, avec ses « r » (16 communes, 2 marchés, 3 produits). La phrase écoutée par Elisée le 26/10 contenait « Houndjro », envoyé avec son « r ».
- **300 caractères par morceau**, comme l'application JML.
- **16 kHz** plutôt que 24 kHz.
- **Réserve purgée après 30 jours sans usage**, avec un plafond de taille.
- **Préparation à l'avance lancée par le script de déploiement**, en tâche de fond, plutôt qu'au démarrage de l'application (l'hébergement redémarre l'application à volonté) ou par une tâche planifiée (le crontab est partagé avec d'autres sites).

## Laissé au constructeur

- Les noms : modules, route, champs JSON, réglages du `.env` (adresse de la route, nom de la voix, interrupteur de la nouvelle voix).
- Le délai d'attente côté serveur, les délais d'appel au labo, la taille de la file, la durée de la pause après un échec, le plafond de la réserve.
- La conservation de la liste des identifiants émis (mémoire seule, ou aussi sur disque).
- Le filtre de rééchantillonnage, pourvu qu'il évite le repliement et soit testé.
- La place de la nouvelle voix dans le back office (état des services, journal), si elle s'y intègre simplement.
