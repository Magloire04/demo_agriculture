# AgriFon : tour de présentation à la voix

Date : 4 novembre 2026. Statut : en attente de validation par Elisée.

## Intention

La plupart des agriculteurs qui utilisent AgriFon ne savent pas lire le fon : ils comptent seulement sur ce qu'ils entendent. Au premier accès, rien ne leur dit où appuyer ni quoi dire. Elisée veut qu'en quelques secondes un agriculteur sache, seul, demander le prix d'un produit et demander conseil pour ses cultures, et qu'il prenne en main toute l'application.

D'où un tour de présentation : une voix en fon parcourt l'application, montre chaque bouton, dit à quoi il sert, et fait faire les gestes à l'agriculteur lui-même. Un bouton d'aide permet de refaire ce tour à tout moment.

## Décisions d'Elisée

- **Premier accès** : le tour se lance de lui-même à la première ouverture de l'application sur un téléphone.
- **Bouton d'aide** : visible en haut de tous les écrans de l'agriculteur, il relance le tour quand on veut. Son icône est **la main du tour** (maquette du 4 novembre, choix 3.2).
- **Tour interactif** : la voix demande le geste (« appuyez sur le micro »), une main animée le montre exactement sur l'écran, et l'agriculteur le fait lui-même.
- **Vraies demandes** : pendant le tour, la demande de prix et le signalement partent pour de vrai. Le prix lu est le vrai prix, et le signalement arrive chez le conseiller. Elisée accepte que chaque nouvel utilisateur envoie ainsi un signalement en suivant le tour.
- **100 % compréhensible à l'oreille** : rien à lire. Tout ce qui est utile est dit par la voix et montré par la main.
- **Rendu « projecteur »** (maquette du 4 novembre, choix 2.A) : pendant chaque étape, l'écran s'assombrit et seul le bouton concerné reste éclairé. Un haut-parleur s'anime en haut tant que la voix parle. Une croix arrête le tour. Des points en bas montrent l'avancée.
- **Premier appui** : le téléphone n'accepte de jouer un son qu'après un toucher. Le tour commence donc par un écran vert avec un gros bouton, que la main montre. L'appui lance la voix. Une croix permet de passer le tour.
- **Déroulé** : celui de la section suivante, validé tel quel.
- **Fon** : je rédige les phrases du tour en brouillon, Elisée les relit et les valide avant la mise en ligne, comme pour le reste de l'application.

## Déroulé du tour

| Étape | Ce que dit la voix (sens) | Ce qui est éclairé | Ce qui fait passer à la suite |
| --- | --- | --- | --- |
| 1. Démarrage | Bienvenue dans AgriFon ; « je vais vous montrer comment vous servir de l'application » | Le gros bouton de l'écran vert | L'appui sur le gros bouton (il débloque le son) |
| 2. Accueil | « Ici, le prix d'un produit au marché », puis « ici, demander conseil quand vos cultures sont malades » | La carte des prix, puis la carte du conseil | La fin de chaque phrase |
| 3a. Prix | « Appuyez ici pour connaître un prix » | La carte des prix | L'appui sur la carte |
| 3b. Prix | « Appuyez sur le micro, dites le nom du produit puis celui du marché, et appuyez encore pour finir » | Le micro | L'envoi de l'enregistrement |
| 3c. Prix | (la vraie réponse est lue, comme d'habitude) | Rien : l'écran est normal | La fin de la lecture de la réponse |
| 3d. Prix | « Appuyez ici pour réécouter la réponse », puis « ici pour poser une autre question » | Le bouton de lecture, puis celui de l'autre question | La fin de chaque phrase |
| 4a. Conseil | « Appuyez ici pour demander conseil » | L'onglet « Biɔ nu tuntun » | L'appui sur l'onglet |
| 4b. Conseil | « Appuyez ici pour dire où se trouve votre champ, ou choisissez votre commune dans la liste » | Le bouton de position et la liste des communes | Une position partagée ou une commune choisie |
| 4c. Conseil | « Appuyez sur le micro, dites la culture et ce que vous voyez, et appuyez encore pour finir » | Le micro | L'envoi de l'enregistrement |
| 4d. Conseil | (la vraie réponse et les solutions sont lues, comme d'habitude) | Rien : l'écran est normal | La fin de la lecture |
| 4e. Conseil | « Le conseiller agricole a reçu votre message » | L'accusé de réception | La fin de la phrase |
| 5. Fin | « Pour réentendre ces explications, appuyez ici à tout moment » | Le bouton d'aide (la main) | La fin de la phrase : le tour se ferme |

Le libellé exact de chaque phrase est rédigé en fon puis relu par Elisée. Le sens ci-dessus est ce qui a été validé.

## Comportements

- **Relance** : si le geste demandé n'arrive pas dans les 10 secondes qui suivent la fin de la phrase, la voix répète la consigne. Après trois répétitions, elle se tait, mais la main continue de montrer le geste. *(Mon choix.)*
- **Hors du projecteur** : pendant une étape qui attend un geste, seul l'élément éclairé répond aux appuis. Un appui ailleurs ne fait rien, sauf sur la croix. *(Mon choix : c'est ce qui empêche de se perdre.)*
- **Demande non comprise** : si la demande de prix échoue (produit non reconnu, enregistrement trop court, service lent ou absent), la voix dit une phrase du tour, du type « je n'ai pas compris, recommençons », et revient à l'étape du micro. Les messages d'erreur de l'application s'affichent seulement en texte : sans cette phrase, un agriculteur qui ne lit pas resterait bloqué. Si le service est hors service, le tour s'arrête. *(Mon choix.)*
- **Signalement mal compris** : un signalement enregistré compte comme réussi, même si l'application n'a reconnu ni la culture ni ce qui est observé : il part chez le conseiller, qui écoutera le message. Il n'y a alors pas de solutions à lire, et le tour passe directement à l'étape 4e. Seule une erreur de réseau ou du serveur fait dire « recommençons ». *(Mon choix.)*
- **Point de départ** : le tour commence toujours sur l'écran d'accueil. Relancé depuis un autre écran, il y revient d'abord. Une lecture en cours s'arrête. *(Mon choix.)*
- **Fenêtres du téléphone** : à la première utilisation, le téléphone demande lui-même l'accès au micro, puis à la position. Ces fenêtres sont dans la langue du téléphone et le tour ne peut pas les montrer du doigt. Avant chacune, la voix prévient : « le téléphone va vous demander la permission, acceptez ». *(Limite connue.)*
- **Arrêt** : la croix arrête aussitôt la voix et le tour. Le tour est alors considéré comme vu.
- **Premier accès retenu** : le téléphone garde en mémoire que le tour a été vu, une fois arrivé au bout ou arrêté par la croix. Si cette mémoire est indisponible (navigation privée, stockage bloqué), l'écran de démarrage revient à chaque ouverture : la croix le passe. *(Mon choix : mieux vaut le montrer de trop que jamais.)*
- **Bouton d'aide** : il relance le tour à l'étape 2. L'appui sur le bouton suffit à débloquer le son, l'écran vert n'est donc pas nécessaire.
- **Application mise de côté** : si l'agriculteur quitte l'application pendant le tour (appel, autre application), la voix s'arrête. À son retour, la phrase de l'étape en cours est redite. *(Mon choix.)*
- **Voix absente** : si la phrase d'une étape ne peut pas être jouée (labo de synthèse en panne, plus de 22 secondes d'attente comme pour les réponses), son texte fon s'affiche dans une bulle et la main continue. *(Mon choix : c'est un secours rare ; la règle reste la voix.)*

## Voix

- Les phrases du tour sont dites avec la voix des phrases entières de JML (voix `homme2`), comme les réponses.
- Elles sont préparées à l'avance avec les phrases fixes, par la préparation qui suit chaque import des prix. Elles se jouent donc sans attente.
- Une phrase du tour ne contient aucune valeur variable : sa voix ne change jamais.

## Fon et relecture

- Environ quinze phrases, dont les relances et la phrase « je n'ai pas compris ». Elles sont rédigées en fon avec leur sens en français, dans les données de l'application, comme les autres textes.
- Elisée les relit dans une page de relecture provisoire, du même type que celle de novembre, supprimée une fois les corrections reportées. *(Mon choix : c'est la forme qu'il a utilisée pour tout le reste.)*
- Le contrôle anti-français existant couvre aussi ces nouveaux textes.
- Le bouton d'aide n'a pas de texte visible ; son nom pour les lecteurs d'écran est en fon.

## Non-objectifs

- Pas de vidéo ni de film d'explication : le tour se déroule dans la vraie application.
- Pas de tour pour l'écran du conseiller ni pour le back office.
- Pas de mesure de qui termine le tour ou l'abandonne.
- Pas de nouvelle voix : celle des réponses (JML, `homme2`) sert aussi au tour.

## Laissé au constructeur

- L'organisation du code : un module du téléphone pour le tour, la façon d'y brancher le micro, l'arrivée des réponses et la fin de leur lecture.
- La façon dont le téléphone obtient les identifiants des voix préparées.
- Les durées exactes des animations, tant que la main fait le geste d'appui de la maquette et que le projecteur reste centré sur l'élément.
- La gestion du mouvement réduit : la main reste visible et indique le geste, même sans animation.
- La mise à jour du cache hors ligne.

## Points d'attention

- **Signalements du tour** : le conseiller recevra un signalement par nouvel utilisateur, parfois un simple essai. C'est accepté par Elisée.
- **Durée** : avec les vraies demandes, le tour dure trois à cinq minutes, attente des réponses comprise.
- **iPhone en mode silencieux** : le son peut rester coupé malgré l'appui. Ce cas n'a pas encore été essayé sur un vrai iPhone (déjà noté pour les réponses).
