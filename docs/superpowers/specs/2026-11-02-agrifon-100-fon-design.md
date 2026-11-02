# AgriFon 100 % fon : plus de français pour l'agriculteur

Date : 2 novembre 2026. Statut : relu par un constructeur indépendant, en attente de validation par Elisée.

## Intention

AgriFon est une application pour des agriculteurs qui parlent fon. Aujourd'hui, l'agriculteur voit environ 70 textes en français (boutons, consignes, états du micro, erreurs, étiquettes) et la traduction française sous chaque réponse. Elisée veut une application 100 % fon : plus aucun mot de français sur les écrans de l'agriculteur.

Sans le français, deux risques apparaissent. Un fon mal écrit n'a plus de traduction pour le rattraper. Et des conseils difficiles, comme une préparation à pulvériser, deviennent durs à suivre pour qui lit mal. D'où deux garde-fous voulus par Elisée : il relit et valide lui-même tout le fon affiché avant la mise en ligne, et les conseils difficiles sont illustrés par de petites images numérotées.

## Décisions d'Elisée

- **Prix du marché** : pas de grand changement. On retire seulement le français. Les prix restent en chiffres, compris en fon comme en français.
- **Signalement** : les conseils difficiles reçoivent de petites images, au style choisi sur maquette le 2 novembre (voir « Images des conseils »).
- **Relecture** : Elisée relit tout le fon affiché, dans une page de relecture-validation provisoire, supprimée une fois la relecture finie (voir « Relecture »).
- **Solutions** : elles restent allumées en ligne (`SOLUTIONS_BROUILLON=1` dans le `.env` de production). Elles passent en fon seul quand leurs images et leur fon relu sont prêts.
- **Liste des conseils illustrés** : la liste de « Images des conseils » a été proposée et acceptée telle quelle.
- **Doses des traitements** : les images du Spinosad et de l'extrait d'amande de neem ne montrent aucune dose, comme leur fon, qui renvoie à l'étiquette. Elles montrent le flacon, son étiquette et un œil (« lisez-la »), puis le calendrier des passages (tous les 15 jours pour le Spinosad, 4 fois ; tous les 7 jours pour le neem). Raison : la source donne la dose du Spinosad en matière active (96 g/ha, environ la moitié de la dose en produit si on la lit comme du produit) et celle du neem pour un pulvérisateur à très bas volume (10 L/ha). Le jus d'ail et l'extrait de feuilles de neem gardent leurs quantités de préparation, présentes dans leur fon.
- **Deux PR, l'une après l'autre** : d'abord l'interface, puis les solutions avec leurs images.

## Ce qui reste en français (accepté)

- L'écran du conseiller (`/conseiller`) et le back office (`/admin`) : ils servent à l'équipe, pas à l'agriculteur.
- Le bandeau « Mode simulation » et le bandeau « reconnaissance vocale non configurée » : ils n'apparaissent jamais en ligne.
- Les fenêtres du téléphone lui-même (autorisation du micro et de la position, choix d'un fichier) : elles suivent la langue de l'appareil.
- Les réponses JSON de l'API gardent leurs champs français (`message`, libellés) : l'écran du conseiller s'en sert. Seul le téléphone de l'agriculteur cesse de les afficher.
- Les noms propres et les sigles ne se traduisent pas : noms des marchés, des communes et des départements, `AgriFon`, `F CFA`, `kg`, `L`, `m²`, `h`, `PAM`, `JaimeMaLangue`, `Access Agriculture`, `JML`, `OmniVoice`, `FongLab`, `CC BY-NC 4.0`, `CC BY-IGO`, et les noms de variétés (`BENTO 02`, `BENPIM-01`…).

## PR 1 : l'interface sans français

Tous les écrans de l'agriculteur : accueil, prix du marché, signalement (hors section des solutions), erreurs, page « hors service » (`site/hors-service.html`), manifeste de l'application (`site/manifest.webmanifest`, y compris ses raccourcis).

### Une seule source pour les textes

Tous les textes de l'interface vont dans `data/interface.json`, sur le modèle de `data/reponses.json` : pour chaque clé, `fr` (aide-mémoire pour le développeur, jamais affiché) et `fon`. Le serveur sert déjà `site/` lui-même (pas de serveur de fichiers séparé, voir `server/index.js`) ; la façon dont la page reçoit ces textes est laissée au constructeur, à une condition : aucun français ne doit apparaître, même un instant, pendant le chargement.

Les étiquettes lues par les lecteurs d'écran (`aria-label`, `alt`, `title`) passent aussi en fon. La page déclare `lang="fon"`.

### Ce qui change à l'écran

- **En-tête et pied** : la devise sous le logo, l'étiquette « Démo » et le pied de page disparaissent. Les crédits obligatoires restent, réduits à leurs noms : `JaimeMaLangue` pour la reconnaissance vocale.
- **Navigation et accueil** : en fon, avec les icônes actuelles.
- **Consignes, micro, position, envoi d'un fichier** : en fon. Le lien « ou envoyer un fichier audio » devient une icône avec une étiquette en fon pour les lecteurs d'écran.
- **Réponse de prix** : la phrase fon reste, la traduction française disparaît. La carte garde sa mise en page actuelle et retire ses mots français :
  - le produit est nommé par son nom fon (`nom_fon` de `data/referentiel.json`, présent pour les 33 produits) ;
  - « Marché X · département · prix moyen de septembre 2026 » devient « X · département · 09/2026 » ;
  - l'évolution devient une flèche et un pourcentage, sans mot (« Stable » devient une flèche horizontale) ;
  - « Comparer avec les autres marchés » passe en fon ;
  - la ligne de source devient le lien `PAM · CC BY-IGO`, précédé d'une icône : la licence des relevés du PAM demande cette attribution (choix de Claude).
- **Accusé de signalement** : le titre et le message sont déjà en fon. La référence et l'heure de réception restent, sans libellé français, avec une icône. Le récapitulatif garde la culture (nom fon : premier terme `fon` de la culture dans `data/lexique.json`) et la commune ; la ligne des symptômes disparaît, la phrase dite par l'agriculteur restant affichée. Les étapes « reçu » et « pris en charge » sont déjà en fon dans `data/reponses.json`.
- **Bouton de lecture et mentions de voix** : « Écouter en fongbé », « Je prépare la voix… », « Arrêter », « Réécouter » passent en fon. Les mentions de voix deviennent `JML · OmniVoice · CC BY-NC 4.0` et `FongLab · CC BY-NC 4.0` ; « en attente de relecture par un locuteur » disparaît une fois la relecture faite.
- **Dates et nombres** : en chiffres (`09/2026`, `10:32`, `1 500`).

### Les erreurs

Chaque erreur que voit l'agriculteur a un message fon. Les erreurs du serveur portent déjà un `code` (`audio_trop_court`, `audio_trop_long`, `audio_illisible`, `asr_indisponible`, `asr_injoignable`, `service_sature`, `trop_de_demandes`, `hors_service`…) ; le téléphone choisit le message fon d'après ce code, en réutilisant les phrases fon déjà écrites (`erreur_reessayer`, `erreur_trop_court`, `hors_service` de `data/reponses.json`) quand elles conviennent. Les erreurs du navigateur (micro refusé, absent, adresse non sécurisée, enregistrement impossible) ont aussi leur message fon.

Règle absolue : si un message fon manque, le téléphone affiche le message fon générique « réessayez », jamais le message français du serveur.

### Garde-fou

Un test vérifie qu'aucun texte français n'atteint l'agriculteur : textes visibles et étiquettes de `site/index.html`, de `site/hors-service.html` et du manifeste, chaînes affichées par `site/js/app.js`. Seuls les noms propres et sigles de la liste ci-dessus sont admis. Un autre test vérifie que chaque clé de `data/interface.json` a un `fon` non vide.

## PR 2 : les solutions en fon seul, avec leurs images

### Affichage

La section des solutions n'affiche plus que le fon : titre, problème probable, gestes, traitement, consignes de sécurité, mention « à confirmer avec un conseiller ». L'étiquette « Traitement documenté » devient un badge fon. Les sources restent sous forme de noms propres. Le lien vidéo devient un texte fon suivi de `Access Agriculture`.

### Images des conseils

Style choisi le 2 novembre sur maquette (fichier `.superpowers/brainstorm/474-1793605728/content/style-images-v2.html`, ignoré par git) :

- **Petites illustrations en couleur à plat**, dessinées en SVG : feuilles malades jaune-brun tachées de brun, plantes vertes, sol brun, feu orange et jaune, outils gris, ciseaux à anneaux rouges bien reconnaissables.
- **Étapes numérotées** : une case par étape, numéro blanc dans une pastille verte (`#006828`) en haut à gauche, cases côte à côte, trois par ligne à la largeur d'un téléphone (336 px utiles).
- **Aucun mot dans les images** : seuls les chiffres et les unités internationales (`0,76–1,2 kg`, `15 L`, `2 h`, `400 m²`, `3 m`, `10 %`).
- Le texte fon du conseil reste sous les images.

16 séries d'images, qui couvrent une vingtaine de conseils (identifiants de `data/solutions.json`) :

| Série | Conseils |
| --- | --- |
| Jus d'ail | traitements `amarante-chenilles`, `gboma-chenilles` |
| Extrait de feuilles de neem ou de papayer | traitement `niebe-foreurs-gousses` |
| Extrait d'amande de neem | traitement `coton-pucerons` |
| Spinosad | traitement `tomate-helicoverpa` |
| Couper et brûler loin du champ | `retirer-bruler`, `retirer-pourri`, `plantain-effeuiller` |
| Arracher et sortir du champ | `tomate-arracher-sortir`, `tomate-arracher-viroses`, `manioc-arracher-bruler-tot` |
| Arracher, enfouir, replanter | `plantain-arracher-enfouir` |
| Laver les outils à l'eau de Javel | `manioc-outils-javel` |
| Trier les semences dans l'eau | `riz-tri-semences` |
| Faire cicatriser les ignames sous bâche | `igname-cure` |
| Creuser des rigoles | `drainer` |
| Poser des pièges jaunes | `pieges-jaunes` |
| Espacer les plantains | `plantain-ecartement` |
| Écraser les chenilles dans le cornet | `mais-cla-cornet`, `coton-ecraser-chenilles-cornet` |
| Arracher le striga avant la fleur | `arracher-striga`, `striga-arrachage-collectif` |
| Regarder et montrer au conseiller | `observer-collet`, `observer-dessous` |

Chaque série suit fidèlement son texte fon relu (quantités, ordre des étapes, délais) : une quantité absente du fon n'apparaît pas dans l'image. Aucun texte de traitement ne parle de protections (gants, masque) : les images n'en ajoutent pas, la règle du projet étant de ne donner aucune consigne sans source, et elles ne montrent aucune main au contact d'un produit (choix de Claude). Une série partagée par plusieurs conseils montre ce qu'ils ont en commun ; si un conseil a une étape de plus (enterrer au lieu de brûler, par exemple), le constructeur ajoute la case ou fait une variante.

Les images sont des fichiers du site (pas des données de l'API), chargées seulement quand la section des solutions s'affiche. Le lien entre un conseil et sa série vit dans `data/solutions.json`.

## Relecture

### Ce qu'Elisée relit

Tout le fon que voit l'agriculteur : les messages de `data/interface.json` (une trentaine, nouveaux), les 19 phrases de `data/reponses.json`, les 33 noms fon des produits, les noms fon des cultures du récapitulatif, et les 86 textes fon des solutions. Environ 190 textes en tout.

### La page de relecture-validation

Une page privée sur le compte claude.ai d'Elisée (artefact avec une petite base de données partagée), provisoire :

- une ligne par texte, groupée par partie (interface, réponses, produits, cultures, solutions) : le français en référence, le fon modifiable, et un bouton « Valider » qui enregistre le texte tel qu'il est à l'écran, corrigé ou non ;
- l'état de chaque ligne (à relire, validé tel quel, validé corrigé), un compteur d'avancement, et un filtre « à relire » ;
- une rangée de touches pour insérer les lettres et les tons du fon (ɛ, ɔ, ɖ, ŋ, ɣ, leurs majuscules, et les tons aigu, grave, montant, descendant) ;
- les marques à remplacer (`{produit}`, `{prix}`, `{marche}`…) sont signalées, et la validation est refusée si l'une d'elles a disparu ;
- un champ de note facultatif par ligne, pour une question à Claude.

La page est remplie au début du projet avec tous les textes, y compris les brouillons des messages d'interface, pour qu'Elisée relise en une fois pendant que le code avance. Les corrections sont lues dans la base, puis reportées dans les fichiers du projet ; ensuite la page est supprimée.

Pendant la PR 2, les 16 séries d'images s'ajoutent à la même page, chacune avec son conseil en fon : Elisée valide chaque série ou laisse une note pour la faire reprendre (choix de Claude : seul le style a été validé sur maquette, pas chaque dessin).

### Effets d'une correction

- Le texte `voix` des phrases (`data/reponses.json`, `data/solutions.json`) suit la correction de leur `fon`, découpage en morceaux compris.
- Les extraits audio de l'ancienne voix FongLab n'existent pas pour un morceau corrigé : la voix de repli disparaît pour ces phrases, la voix JML les dit. La préparation à l'avance (`scripts/voix/preparer-phrases.js`) refait leur son au déploiement suivant.
- Une fois les solutions relues, `fon_a_relire` passe à `false` dans `data/solutions.json`.

### Ordre

1. Relecture remplie avec tous les textes. Elisée relit pendant que la PR 1 se construit.
2. PR 1 fusionnée après report des corrections de l'interface, des réponses, des produits et des cultures.
3. PR 2 fusionnée après report des corrections des solutions, validation des 16 séries d'images et passage de `fon_a_relire` à `false`.
4. Page de relecture supprimée.

## Hors de ce projet

- Faire dire à voix haute les consignes et les erreurs (proposé à Elisée, à faire ensuite s'il le souhaite).
- L'écran du conseiller et le back office.
- Des images pour les autres conseils et pour les écrans de prix.

## Laissé au constructeur

- La façon de servir les textes de `data/interface.json` à la page, dans la limite donnée plus haut.
- Le découpage des 16 séries en cases et le dessin de chaque case, dans le style décrit.
- L'organisation des fichiers d'images et du lien conseil-série dans `data/solutions.json`.
- La rédaction des brouillons fon de l'interface, à partir du fon déjà présent dans le projet et de sources publiées ; Elisée les relit tous.
