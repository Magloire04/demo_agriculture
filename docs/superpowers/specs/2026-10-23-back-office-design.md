# Back office d'AgriFon

Date : 23 octobre 2026. Statut : relu par un constructeur indépendant, en attente de validation par Elisée.

## Intention

Elisée veut savoir si AgriFon est utilisé, pour en déduire, et montrer, que la plateforme est utile. Aujourd'hui, le site ne garde aucune trace des visites : seuls les signalements sont enregistrés, les questions de prix ne laissent rien. Il veut aussi pouvoir couper le site d'un bouton, au besoin, et garder la main sur le reste (appels à l'API, refus, état des services, réglages) sans passer par le serveur en SSH.

Le back office est un écran réservé à Elisée, sur ordinateur comme sur téléphone, qui montre l'usage réel du site et permet de le piloter.

## Décisions d'Elisée

- **Un seul administrateur** : Elisée.
- **Trois chiffres en tête**, qui disent ensemble que le service est utilisé, qu'il comprend et qu'il sert :
  1. les personnes qui utilisent AgriFon, avec la part de celles qui reviennent un autre jour ;
  2. les demandes vocales (prix et signalements), avec la part comprise (voir « Définitions des mesures ») ;
  3. les signalements, avec la part prise en charge par un conseiller et le délai moyen de prise en charge.
- En dessous : les produits et les marchés les plus demandés, les communes des signalements, les heures d'utilisation.
- **Journal des appels** : chaque demande vocale avec l'heure, le service, le temps de réponse de l'API, le résultat (compris, non compris, erreur) et la phrase transcrite en fon. Aucune adresse IP. 90 jours d'historique.
- **Refus** : par jour, combien de robots, de demandes en trop et de codes faux ont été bloqués.
- **État des services** : l'API JaimeMaLangue répond-elle et en combien de temps ; date du dernier import des prix, avec un bouton « Importer maintenant » ; place prise par les messages vocaux ; version du code en ligne.
- **Réglages** : le bouton hors service ; l'affichage des solutions en brouillon (aujourd'hui `SOLUTIONS_BROUILLON` dans `.env`), activable ou coupable depuis le back office.
- **Mode hors service** :
  - un bouton le déclenche, avec une confirmation ; le même bouton remet le site en service ; le réglage survit à un redémarrage ;
  - toute page du site affiche alors une page d'attente : l'onde de la voix (maquette « C », voir plus bas), la phrase fon « Mǐ ma sixú yí gbe nú mi din ǎ. » (déjà dans `data/reponses.json`, phrase `erreur_reessayer`) puis « AgriFon est momentanément hors service. Revenez un peu plus tard. » ;
  - les demandes vocales reçoivent le même message, en fon et en français ;
  - le back office et l'écran conseiller restent ouverts ;
  - chaque coupure est gardée : début, fin, durée ;
  - pas de message personnalisé ni d'heure de retour annoncée.
- **Accès** :
  - adresse `/admin`, citée nulle part sur le site ;
  - mot de passe propre à l'administrateur, distinct du code conseiller, dont le serveur ne garde qu'une empreinte ;
  - blocage de 10 minutes après 3 mots de passe faux (par visiteur : voir « Choix faits pendant la conception ») ;
  - session de 10 minutes sans activité : seuls les clics et les frappes d'Elisée comptent comme activité ; les mises à jour automatiques de l'écran (onde, appels en direct) ne prolongent pas la session. Après 10 minutes sans y toucher, l'écran redemande le mot de passe, même resté ouvert ;
  - pas de double authentification pour l'instant.
- **Comptage des personnes** : à sa première visite, le téléphone tire au hasard un identifiant anonyme et le garde. Il ne contient rien sur la personne. Le serveur ne garde que lui ; il disparaît si l'on efface les données du navigateur. Aucune adresse IP n'est enregistrée.
- **Disposition** : un même écran, menu sur le côté sur ordinateur, onglets en haut sur téléphone.
- **Motion design** : la direction validée est la maquette `.superpowers/brainstorm/1912-1792761711/content/back-office-motion.html` (non versionnée, gardée sur le poste), dans sa dernière version, sans phrase d'accueil, les trois chiffres affichés seuls.

## La maquette validée, décrite

À reproduire fidèlement ; la maquette fait foi en cas de doute.

- **Bande du haut, toujours visible** : marque « AgriFon » et « Administration » ; état du site (« En service, depuis … » ou « Hors service, depuis … ») ; l'**onde du site** ; le bouton « Mettre hors service » ou « Remettre en service ».
- **L'onde du site** est le seul élément spectaculaire de l'écran. Barres verticales fines, arrondies, symétriques autour de l'axe, qui défilent de droite à gauche comme un enregistrement. Au repos, elle respire doucement. Chaque nouvel appel réel fait passer un pic. Le site coupé, son amplitude retombe en environ une seconde et demie jusqu'à une ligne plate, la couleur passe du vert au rouge et la bande au rouge pâle ; remis en service, elle repart. Les bords de l'onde s'estompent.
- **Confirmation** de la coupure : se déroule sous la bande, en réponse au clic. Texte : « Couper AgriFon maintenant ? Les téléphones afficheront la page d'attente jusqu'à ce que vous remettiez le site en service. L'écran conseiller reste ouvert. » Boutons « Couper le site » et « Annuler ». La remise en service ne demande pas de confirmation.
- **Chargement** : un seul moment orchestré. L'onde se dessine de gauche à droite (environ 1,3 s), puis les trois chiffres montent de zéro à leur valeur (environ 0,9 s). Rien d'autre n'entre en animation.
- **Les trois chiffres** : grands, en Montserrat Light, chiffres à chasse fixe, séparés par un filet vertical sur ordinateur, empilés sur téléphone ; sous chacun, un libellé court en gras et une précision (« dont 21 revenues un autre jour », « 163 demandes vocales sur 209 », « en 2 h 10 en moyenne ») ; sous l'ensemble, la période (« Du 17 au 23 octobre 2026 »).
- **Graphique** « Personnes par jour, sur 14 jours » : barres vertes, un seul vert, extrémités arrondies, 2 px d'écart ; au survol ou au focus, une bulle donne le jour et la valeur.
- **Classements** (produits, et dans le même esprit marchés et communes) : liste avec une jauge fine sous chaque ligne.
- **Derniers appels, en direct** : chaque ligne porte une petite onde (longueur selon la durée de l'audio), la phrase fon, une ligne de détail (service, ce qui a été compris, heure, temps de réponse de l'API) et le résultat avec icône et libellé (« Compris », « Non compris », « Erreur de l'API »). Une nouvelle ligne entre par le haut, sa petite onde s'anime une fois.
- **Couleurs** : papier `#F4F7F3`, surface `#FFFFFF`, encre `#102A1C`, encre douce `#4B5E52`, filet `#DCE4DC`, vert `#006828`, rouge `#C3261B` (état coupé), jaune `#FFBE00` (contour de focus). Police Montserrat, déjà servie par le site.
- **Accessibilité** : avec « réduire les animations », tout est immobile (onde fixe, chiffres directs) ; focus visible ; l'état du site est annoncé (`role="status"`) ; l'information n'est jamais portée par la couleur seule.

La page d'attente reprend la maquette « C » (`.superpowers/brainstorm/1912-1792761711/content/hors-service.html`) : fond blanc, marque AgriFon en haut à gauche, six barres vert-vert-jaune-rouge-vert-vert qui ondulent lentement l'une après l'autre, la phrase fon en grand, le français dessous, la bande tricolore courte en bas. Immobile si les animations sont réduites.

## Objectifs

1. Elisée voit, à tout moment et sans SSH, combien de personnes utilisent AgriFon, si elles reviennent, si elles sont comprises, et ce que deviennent les signalements.
2. Il peut couper le site et le remettre en service en deux clics, et les agriculteurs voient alors une page claire, en fon et en français.
3. Chaque demande vocale laisse une trace exploitable pendant 90 jours, sans donnée identifiante.
4. Le back office est utilisable sur téléphone comme sur ordinateur.

## Ce que le projet ne fait pas

- Pas de comptes multiples, pas de rôles.
- Pas de modification des contenus depuis le back office : phrases, lexique, produits, solutions et voix restent dans les fichiers du dépôt.
- Pas de traitement des signalements depuis le back office : l'écran conseiller existe pour cela.
- Pas d'outil de mesure tiers (Google Analytics ou autre) : tout reste sur le serveur TECHNUM.
- Pas d'export de données dans cette version.

## Ce qui ferait échouer le projet, même s'il marche

- Enregistrer une adresse IP, une position GPS ou toute donnée qui identifie une personne dans le journal ou les mesures.
- Ralentir ou fragiliser le site pour les agriculteurs : une erreur de mesure ne doit jamais faire échouer une demande vocale.
- Un back office que l'on peut atteindre sans mot de passe, ou dont les données fuient par une route non protégée.
- Un mode hors service qui bloque aussi le back office : il serait impossible de remettre le site en service.
- Des animations dispersées partout au lieu du seul moment orchestré et de l'onde.

## Contraintes

- Node.js sans dépendance externe, comme le reste du projet ; tests avec `node --test`, écrits avant le code.
- Toutes les requêtes passent par le serveur (les fichiers sont dans `site/`, jamais dans `public/`) ; la protection de `server/protection.js` s'applique aussi au back office et à ses routes.
- Hébergement mutualisé : pas de base de données, fichiers dans `stockage/` (hors Git) ; un seul processus Node.
- Loi n° 2017-20 portant code du numérique (APDP) : données minimales, durée limitée.
- Charte de l'application : Montserrat, vert, jaune et rouge du drapeau.
- Heure de référence : Porto-Novo (UTC+1, sans heure d'été) pour les jours et les heures affichés.

## Définitions des mesures

- **Personne** : un identifiant anonyme. Le téléphone le crée au hasard (par exemple `crypto.randomUUID()`) et le garde dans `localStorage` ; il l'envoie dans un en-tête (par exemple `X-Visiteur`) avec ses appels à l'API du serveur. Une personne est comptée une fois par jour dès qu'elle ouvre l'application. Si le stockage du navigateur est indisponible, l'identifiant vaut pour la session : la personne est comptée, mais son retour ne peut pas l'être. L'écran conseiller et le back office ne comptent pas.
- **Revenue un autre jour** : identifiant vu au moins deux jours différents sur la période.
- **Demande comprise** (libellé à l'écran : « demandes comprises », sans « du premier coup », qui laisserait croire que l'on suit les essais successifs d'une même personne) :
  - prix : le serveur a reconnu au moins un produit ou un marché (statuts `ok`, `sans_prix`, `marche_seul`) ; `non_compris` ne l'est pas ;
  - signalement : la culture et au moins un symptôme reconnus.
  - Les demandes qui finissent en erreur (API, audio trop court…) sont comptées à part et n'entrent pas dans le taux. Les demandes refusées par la protection n'y entrent pas non plus.
- **Signalement pris en charge** : statut `pris_en_charge` ; délai = `pris_en_charge_le` moins `recu_le`, moyenne sur la période.
- **Période** : 7 derniers jours par défaut.

## Journal des appels

Une entrée par demande vocale arrivée au serveur (prix ou signalement) : date et heure, service, durée totale, durée de l'appel à l'API, résultat (compris, non compris, ou le code d'erreur), transcription fon, ce qui a été reconnu (produits et marché, ou culture, parties, symptômes et commune), référence du signalement le cas échéant. Ni adresse IP, ni position GPS, ni audio : l'audio d'un signalement reste là où il est déjà, dans `stockage/audio/`.

**Le journal ne contient pas l'identifiant anonyme.** Sinon, pendant 90 jours, un même identifiant relierait toutes les questions d'une personne et, par la référence, la position GPS de ses signalements. Les identifiants ne servent qu'au comptage : pour chaque jour, l'ensemble des identifiants vus, sans rien d'autre. C'est assez pour compter les personnes et les retours.

Les entrées de plus de 90 jours sont supprimées automatiquement, comme les ensembles d'identifiants par jour.

## Refus

Compteurs par jour et par motif, à partir de la protection existante : robot, autre site, origine, trop de demandes, service saturé, code conseiller faux, mot de passe administrateur faux.

## Ce qui reste au constructeur

- Le découpage en fichiers, le format exact de stockage (un fichier par jour, JSON par ligne, ou autre), les noms des routes de l'API d'administration.
- La façon dont l'écran se met à jour (relève périodique de quelques secondes, comme l'écran conseiller, ou autre), tant que l'onde réagit aux vrais appels.
- La mise en œuvre de « Importer maintenant » (lancer l'import des prix existant) et de la mesure de l'API (`/health`).
- La façon de lire la version du code en ligne.
- La façon dont Elisée définit son mot de passe sur le serveur, à condition qu'il ne passe jamais par le chat ni par Git.
- Les périodes proposées en plus des 7 derniers jours, s'il y en a.

## Choix faits pendant la conception (par l'assistant, à vérifier par Elisée)

- **Rétention de 90 jours** pour le journal et les compteurs de refus.
- **Journal sans identifiant anonyme** : les identifiants ne sont gardés que par jour, pour le comptage (voir « Journal des appels »). Suit directement « Ce qui ferait échouer le projet ».
- **« Demandes comprises » plutôt que « comprises du premier coup »** : le taux est la part des demandes comprises, demande par demande. Mesurer le premier essai demanderait de suivre les essais d'une même personne, ce que le journal ne fait plus.
- **Blocage du mot de passe par visiteur**, comme le code conseiller : 3 essais faux depuis une même adresse la bloquent 10 minutes, sans gêner les autres. Le blocage est gardé en mémoire : un redémarrage de l'application (cPanel) le lève, ce qui laisse toujours à Elisée un moyen de reprendre la main. Si l'adresse du visiteur est inconnue (l'en-tête `X-Forwarded-For` manque, ce qui n'arrive pas en production au 23 octobre 2026), pas de blocage commun, qui permettrait à n'importe qui d'enfermer Elisée dehors : chaque essai faux est alors retardé de 2 secondes.
- **Le réglage « solutions en brouillon » du back office** prend le pas sur la variable `SOLUTIONS_BROUILLON` du `.env`, qui ne sert plus que de valeur de départ.
- **La page d'attente** est servie avec le statut HTTP 503 et un en-tête `Retry-After`, pour que ni le cache de l'application ni un moteur ne la gardent comme page normale.
- **Pendant une coupure**, restent ouverts : le back office et ses routes, l'écran conseiller et ses routes, `robots.txt`, `/api/etat` (vérification du déploiement) et les fichiers dont la page d'attente a besoin.
