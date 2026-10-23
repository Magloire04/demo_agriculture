# Solutions proposées après un signalement

Date : 22 octobre 2026. Statut : relu par un constructeur indépendant, en attente de validation par Elisée.

## Intention

Aujourd'hui, après un signalement de maladie des cultures, AgriFon affiche ce qui a été entendu, un tableau (culture, ce qui est observé, lieu), confirme que le signalement est transmis au conseiller agricole et dit cette confirmation en fon. L'agriculteur repart sans rien savoir de ce qu'il peut faire en attendant le passage du conseiller.

On ajoute une section qui répond au signalement par quelques solutions adaptées à la culture, au symptôme, à la partie de la plante quand elle est dite, et à la saison quand la localisation est connue. Les solutions sont écrites en fon et en français et peuvent être écoutées en fon. Le conseiller voit, sur son écran, les solutions proposées pour chaque signalement.

## Décisions d'Elisée

- La section se trouve dans l'espace « Signaler », sous la confirmation existante. Elle n'apparaît que si le système a reconnu la culture et au moins un symptôme.
- Les 19 cultures du lexique sont couvertes au même niveau d'exigence.
- Deux niveaux de solution :
  - **Niveau 1** : quand le signalement correspond très bien à un cas connu et documenté dans les sources reconnues, la solution peut nommer un traitement précis (matière active, dose, moment).
  - **Niveau 2** : sinon, seulement des gestes sans risque ; les traitements sont laissés au conseiller.
- Sources reconnues : fiches techniques de l'INRAB et du ministère de l'Agriculture du Bénin (MAEP), FAO, CABI Plantwise / PlantwisePlus, Access Agriculture.
- Un locuteur du fon relira les solutions avant leur mise en ligne.
- Les doses sont toujours écrites en chiffres à l'écran, en fon comme en français : si l'audio les rend mal, la personne les lit.
- L'écran conseiller montre les solutions proposées.
- Le quota de la synthèse vocale FongLab n'est plus une contrainte.
- Pas de validation agronomique avant la mise en ligne : les solutions sont publiées telles qu'elles sont tirées des sources, avec en bas de la section la mention « À confirmer avec un conseiller ».
- Un traitement nommé (niveau 1) ne peut venir que d'un document fait pour le Bénin : fiches et guides de l'INRAB et du MAEP, guides de la FAO. Les fiches Plantwise (aucune n'existe pour le Bénin) et les documents faits pour d'autres pays ne justifient pas un traitement ; ils peuvent justifier un geste de niveau 2.

## Objectifs

1. Pour toute combinaison culture × symptôme reconnue (19 × 8 = 152), proposer au moins deux gestes utiles et sans risque, adaptés à la culture quand les sources le permettent.
2. Pour les cas documentés, nommer le problème probable et, quand une source reconnue le donne, le traitement avec sa dose.
3. Chaque solution porte sa source : aucune solution sans origine vérifiable.
4. Chaque solution est disponible en fon (texte et audio) et en français.
5. Le conseiller voit exactement ce qui a été proposé à l'agriculteur.

## Ce que le projet ne fait pas

- Pas de diagnostic de maladie : le système reconnaît 8 symptômes généraux, pas des maladies. Un problème n'est jamais affirmé : il est présenté comme une hypothèse, « C'est probablement … » quand la combinaison le désigne nettement, « Ce peut être … » sinon. Une hypothèse « possible » ne s'accompagne jamais d'un traitement.
- Pas de photo, pas de météo en temps réel, pas de prix des produits.
- Pas de remplacement du conseiller : il reçoit toujours le signalement et reste la référence pour les traitements.
- Pas de recommandation de variété par zone agroécologique au-delà de ce que les fiches citent déjà.

## Ce qui ferait échouer le projet même s'il fonctionne

- Nommer un produit ou une matière active non autorisé au Bénin.
- Donner une dose qui n'a pas été lue dans la source citée.
- Présenter une supposition comme un diagnostic.
- Conseiller d'arroser en pleine saison des pluies, ou de drainer en saison sèche, quand la localisation permet de savoir que c'est absurde.
- Mettre en ligne du fon non relu par un locuteur.
- Reprendre le contenu des vidéos Access Agriculture dans l'application (leurs droits l'interdisent sans accord écrit).

## Contraintes

- Aucune dépendance npm ajoutée au serveur ni à la PWA. Les outils de préparation (extraction de la liste des pesticides) peuvent tourner sur un poste, hors du serveur.
- Node.js 20.12 minimum, données en JSON dans `data/`, comme le reste du projet.
- Politique de sécurité du contenu (CSP) inchangée : `script-src 'self'`, pas de ressource externe chargée. Un lien externe (Access Agriculture) reste permis.
- Les extraits audio suivent le mécanisme existant : texte fon découpé par `|`, nom de fichier tiré du texte (`server/voix.js`), génération par `scripts/voix/generer.js --point`, relecture par `scripts/voix/evaluer.js`.
- Le registre des signalements reste un fichier JSON.

## Comment ça marche

### Données : `data/solutions.json`

Un nouveau fichier de données, relu par le serveur au démarrage. Son schéma exact est laissé au constructeur ; il doit contenir :

**Les sources**, chacune avec un identifiant, l'éditeur (INRAB, MAEP, FAO, CABI, Access Agriculture), le titre, l'année, l'URL, la page ou le numéro de fiche, et la licence connue. Les solutions y renvoient par identifiant.

**Les gestes** (niveau 2), réutilisables d'une culture à l'autre. Chaque geste a :
- `fr`, `fon`, `voix` (le fon découpé par `|`, les nombres écrits en toutes lettres en fon) ;
- les sources ;
- facultatif : `saison` (`pluies` ou `seche`) quand le geste n'a de sens qu'à une saison.

**Les gestes par symptôme et par culture** : pour chacun des 8 symptômes, une liste de gestes par défaut, et pour chaque culture les gestes qui la remplacent ou la complètent quand une source donne mieux.

**Les cas documentés** (le problème probable, et éventuellement le traitement). Chaque cas a :
- la culture, les symptômes qui le déclenchent, et facultativement les parties de la plante exigées (par exemple `fruits` pour les foreurs des gousses du niébé) ;
- facultatif : des mots déclencheurs propres au cas (`termes`, en fr et en fon, cherchés comme les symptômes, à l'identique), qui doivent figurer dans la transcription pour que la certitude soit `nette`. Exemple : « puceron » pour le coton ; sans ce mot, le cas reste `possible`. Les termes fon sont fournis par le locuteur ;
- le nom du problème probable en fr et en fon (« la chenille légionnaire d'automne ») ;
- la `certitude` : `nette` quand la combinaison désigne ce problème sans ambiguïté sérieuse, `possible` sinon ;
- les gestes propres au cas (souvent : arracher et brûler, matériel sain) ;
- facultatif : un `traitement` avec les matières actives, la dose et le moment tels qu'écrits dans la source, une consigne de sécurité (équipement, délai avant récolte si la source le donne), le tout en fr, fon et voix ;
- les sources ;
- facultatif : un lien vers une vidéo Access Agriculture en fon.

### Choix des solutions

Entrée : la culture, les symptômes et les parties reconnus, la commune (choisie ou entendue) et la date de réception.

1. **Saison.** Si la commune est connue, on en déduit le département, puis la saison du mois de réception (heure de Porto-Novo) selon la règle de Météo-Bénin (normales 1991-2020) :
   - Littoral, Atlantique, Ouémé, Plateau, Mono, Couffo, Zou, Collines : pluies d'avril à juillet et de septembre à octobre ; août est la petite saison sèche (faible dans le Zou et les Collines) ; de mi-novembre à mars, grande saison sèche ;
   - Borgou, Atacora, Donga : pluies de mai à octobre, saison sèche de novembre à avril ;
   - Alibori : pluies de juin à octobre, saison sèche de novembre à mai ;
   - les mois de transition (fin mars, début novembre, avril au Nord, mai dans l'Alibori) sont traités comme « saison inconnue ».
   Sans commune ni saison connue, les gestes marqués d'une saison sont écartés.
2. **Cas documentés.** Un cas s'applique si la culture correspond, si au moins un de ses symptômes a été reconnu et si toutes ses parties exigées ont été dites. Sa certitude est celle des données, rabaissée à `possible` si ses mots déclencheurs manquent.
3. **Traitement.** Le traitement d'un cas n'est montré que si la certitude est `nette`. Sinon, seul le problème possible (« Ce peut être … ») et ses gestes sont montrés, avec le traitement laissé au conseiller.
4. **Plusieurs cas.** Au plus un cas par symptôme reconnu, et au plus deux problèmes nommés en tout : les cas `nette` avant les cas `possible`, puis dans l'ordre des symptômes de la transcription. Au plus un traitement, celui du premier cas `nette`.
5. **Gestes.** On complète avec les gestes de la culture pour chaque symptôme reconnu, puis les gestes par défaut du symptôme, sans doublon.
6. **Ordre et nombre.** D'abord le traitement éventuel, puis les gestes des cas, puis les autres gestes. Au plus 4 éléments affichés en plus des lignes de problème.
7. Si plusieurs symptômes sont reconnus, chacun contribue à tour de rôle, pour qu'aucun ne soit oublié.

### Produits autorisés au Bénin

Les recherches du 22 octobre 2026 l'ont établi :
- Le Bénin homologue les pesticides selon le décret n° 2018-172 et les règlements CEDEAO et UEMOA. La liste nationale (mars 2024) n'est pas publiée en ligne.
- La première liste régionale du COAHP (version 2023, publiée en août 2026, 844 produits) donne pour chaque produit la matière active et les usages autorisés par culture et ravageur. Elle a été construite à partir de la liste béninoise de mars 2024 : https://insah.cilss.int/wp-content/uploads/2026/08/1ere-liste-regionale_COAHP-Version-2023_13-08-2026.pdf
- Cette liste contient des produits interdits au Bénin (exemple : dichlorvos), elle ne suffit donc pas seule.

Règle de construction :
1. Un outil de préparation, lancé sur un poste, extrait de la liste COAHP les matières actives et leurs usages (culture, ravageur) dans `data/pesticides.json`, avec la date et l'URL de la liste.
2. Ce fichier porte aussi une liste d'interdits nationaux avec leur texte : endosulfan (arrêté n° 447 du 5 novembre 2009), dichlorvos (rappel du Conseil des ministres du 1er juillet 2026), polluants organiques persistants (DDT, aldrine, dieldrine, chlordane, heptachlore, mirex, toxaphène).
3. Un test refuse tout traitement de niveau 1 qui ne remplit pas toutes ces conditions : un produit de la liste porte la même matière active **à la même concentration** que celle de la source (la dose en dépend) ; son usage couvre la culture, nommée ou comprise dans un groupe que `data/pesticides.json` relie explicitement aux cultures (par exemple « cultures maraîchères » vers tomate, piment, gombo, oignon, gboma, amarante) ; son usage vise le ravageur ou la maladie du cas ; son autorisation, si elle est provisoire ou datée, est encore valable à la date de la liste ; la matière active ne figure pas parmi les interdits. Si une condition manque, le cas garde ses gestes et perd son traitement.
4. Les préparations faites à la ferme (jus d'ail, extrait de feuilles ou d'amandes de neem) sont des pratiques, pas des produits : elles ne passent pas par cette vérification.
5. La source d'un traitement doit être un document fait pour le Bénin (INRAB, MAEP, guide FAO) ; un test le vérifie à partir du champ éditeur et d'un champ `pour_le_benin` des sources.

### Lexique

Le Striga (plante parasite du maïs et du sorgho) n'est reconnu que si l'agriculteur en parle ; un simple jaunissement ne doit pas déclencher ce cas. On ajoute un 9e symptôme `striga` (« Plante parasite (striga) ») au lexique, avec les termes français (« striga », « plante parasite », « herbe parasite ») et les termes fon fournis par le locuteur. Tant que le fon manque, seul le français déclenche ce cas.

### Serveur et registre

- `POST /api/signalements` ajoute à sa réponse un champ `solutions` : un titre, les éléments (fr, fon, type `traitement` ou `geste` ou `probleme`, sources avec nom court et URL, lien vidéo éventuel) et la liste des extraits audio à enchaîner (`voix`), ou `null` si un extrait manque.
- Les solutions proposées sont enregistrées avec le signalement dans le registre, avec la version du fichier de données. Le conseiller voit ainsi ce qui a été dit, même si le fichier change ensuite.
- `GET /api/signalements` (conseiller) rend les solutions enregistrées. La route publique de suivi (`GET /api/signalements/{référence}`) ne change pas.

### Écran de l'agriculteur

Dans `public/js/app.js`, sous le tableau du signalement et au-dessus de « Vous avez dit » :
- un titre bilingue (proposition : « En attendant le conseiller, vous pouvez : ») ;
- si un cas s'applique, une ligne « Ce peut être : … » avec le nom du problème ;
- une carte par élément : fon en grand, français dessous, comme les réponses existantes. Le traitement est signalé par une étiquette « Traitement documenté », suivi de sa dose en chiffres et de la consigne de sécurité que donne la source ;
- la source en petit sous chaque élément (« Source : INRAB, fiche C-8 ») ;
- en bas de la section, toujours affichée, la mention « À confirmer avec un conseiller », en fon et en français, et dite à la fin de l'écoute ;
- un seul bouton « Écouter en fongbé » pour toute la section, avec la mention de la voix déjà utilisée ;
- s'il existe, un lien « Voir la vidéo en fon (Access Agriculture) » qui s'ouvre dans un nouvel onglet.

### Écran du conseiller

Dans `public/js/conseiller.js`, chaque carte de signalement ajoute un bloc « Solutions proposées » : le français d'abord, le fon dessous, l'étiquette du type, la source avec son lien. Sous un traitement, le conseiller voit aussi les réserves notées dans les données (par exemple « la fiche ne donne pas de délai avant récolte »), puisque c'est à lui de confirmer.

### Audio

- Les morceaux de voix des solutions entrent dans `listerMorceaux` (`server/voix.js`), pour que `lister-voix.js`, `generer.js` et `evaluer.js` les couvrent sans changement de méthode.
- Génération avec `node scripts/voix/generer.js --point`, puis relecture avec `evaluer.js` et régénération des extraits mal compris avec une autre graine.

### Relecture par le locuteur

Un script exporte en CSV, solution par solution : l'identifiant, le français, le fon, le texte de la voix, le type et la source. Le locuteur relit et corrige deux colonnes : le fon affiché (doses en chiffres) et le texte de la voix (nombres, décimales, fractions et unités écrits en toutes lettres en fon, puisque `server/nombres-fon.js` ne couvre que les montants en F CFA). Un second passage réinjecte ses corrections dans `data/solutions.json` et signale toute ligne dont le fon a changé sans que la voix change, ou l'inverse. Les extraits audio des phrases corrigées sont régénérés. La mise en ligne attend la fin de cette relecture.

### Tests

- Choix des solutions : culture, symptômes, parties exigées, saison connue ou non, plusieurs symptômes, plafond de 4, un seul traitement, certitude `possible` sans traitement.
- Données : chaque élément a fr, fon, voix et au moins une source existante ; chacune des 152 combinaisons culture × symptôme donne au moins deux gestes sans saison ; chaque morceau de voix figure dans la liste des extraits.
- Pesticides : chaque traitement passe la règle d'autorisation et d'interdiction.
- Serveur : la réponse d'un signalement contient les solutions, le registre les garde, la liste du conseiller les rend.

## Ce que les recherches ont trouvé

Recherches menées le 22 octobre 2026. Plusieurs sources étaient inaccessibles aux outils automatiques : PlantwisePlus (protection anti-robots), site du MAEP (maintenance), serveur des fiches INRAB `publications-chercheurs.inrab.bj` (hors ligne, lu par archive). Les sources principales lues : recueil INRAB des technologies agricoles prometteuses (2020), guide IITA et INRAB de lutte intégrée en maraîchage (2010), guides FAO (chenille légionnaire, coton, manioc, stockage de l'igname), fiches Plantwise archivées, pages Access Agriculture.

### Traitements documentés (candidats au niveau 1)

| Culture + symptôme (+ partie) | Problème | Traitement selon la source | Source | Point à vérifier |
|---|---|---|---|---|
| Tomate + feuilles mangées (fruits) | Helicoverpa armigera | spinosad 480 g SC, 96 g m.a./ha, 4 applications à 15 jours | INRAB recueil, fiche C-8 (2006) | autorisation COAHP, début des traitements ambigu |
| Amarante + feuilles mangées | chenilles Psara, Spoladea | jus d'ail : 0,76 à 1,2 kg d'ail écrasé dans 15 l d'eau pour 400 m², pulvériser 2 h après filtration | INRAB recueil, fiche C-23 | pas d'intervalle ni de délai avant récolte |
| Gboma + feuilles mangées | chenilles Selepa, Phycita | jus d'ail, même recette | INRAB recueil, fiche C-23 | idem |
| Niébé + ravageurs (fruits) | Maruca, thrips, punaises | extrait de feuilles de neem ou de papayer : 15 kg/ha pilés dans 10 l d'eau + ½ pain de savon, 12 h de repos, 6 traitements tous les 5 jours dès les boutons floraux | INRAB recueil, fiche M-11 | suppose un pulvérisateur à très bas volume |
| Coton + déformation (avec pucerons) | Aphis gossypii | 500 g de poudre d'amande de neem + 10 l d'eau + 200 g de savon + 100 ml d'huile, 10 l/ha tous les 7 jours | FAO, guide coton i3722f, p. 26-27 | certitude `possible` sans mention de pucerons |
| Piment + taches | anthracnose | jus d'ail | INRAB recueil, fiche C-23 | confiance faible : certitude `possible`, donc traitement non affiché |

Écartés comme traitements par la règle « documents faits pour le Bénin » (le cas reste, avec ses gestes) :

| Culture + symptôme | Problème | Traitement de la source | Raison |
|---|---|---|---|
| Plantain + taches (feuilles) | cercosporiose noire (`possible`) | propiconazole 250 EC, 15 ml pour 15 l | fiche CABI Plantwise faite pour le Ghana |
| Anacarde + taches | anthracnose (`possible`) | mancozèbe 80 WP, 2 kg/ha | article d'essai INRAB (Tonon et al. 2017), pas une fiche ni un guide |

Traitements attendus au lancement : spinosad sur tomate (sous réserve de la liste COAHP), jus d'ail sur amarante et sur gboma, extrait de neem ou de papayer sur niébé, extrait d'amande de neem sur coton quand l'agriculteur parle de pucerons.

### Problèmes nommés, gestes documentés, sans produit

| Culture + symptôme | Problème | Gestes documentés | Source |
|---|---|---|---|
| Maïs + ravageurs ou feuilles mangées | chenille légionnaire d'automne | visiter le champ 2 fois par semaine, écraser œufs et jeunes chenilles | FAO i9124fr |
| Maïs, sorgho + striga | Striga | arracher avant floraison, rotation ou association avec une légumineuse, compost | INRAB fiche D-20 |
| Manioc + déformation | mosaïque africaine | arracher et brûler tôt, boutures saines, rotation | Plantwise PMDG, FAO i3278f p.78 |
| Manioc + pourriture (racines) | pourridiés | terrain non inondable, boutures saines, outils à l'eau de Javel, rotation 3 saisons | Plantwise PMDG Ghana, FAO p.79 |
| Igname + pourriture (partie non exigée) | pourriture en stockage | tubercules sans blessure, cure 1 à 4 jours, tri régulier, magasin propre | FAO x5039e, section 11.1 |
| Plantain + croissance | bunchy top (possible) | arracher, rejets sains | INRAB, BRAB 2022 |
| Palmier + flétrissement | fusariose (possible) | replanter avec des plants tolérants | INRAB, BRAB 2021 |
| Tomate + déformation ou jaunissement | virus de l'enroulement (TYLCV) | arracher, pépinière sous filet, variétés BENTO 02 et 04 | Access Agriculture, INRAB recueil |
| Tomate + flétrissement | flétrissement bactérien (possible) | arracher et sortir les plants, rotation, hybrides résistants | guide IITA/INRAB, INRAB recueil |

### Cultures sans traitement documenté dans les sources reconnues

Riz, arachide, soja, ananas, et la plupart des combinaisons d'igname, d'oignon, de gombo et de sorgho : niveau 2 seulement.

### Licences

- FAO : CC BY 4.0 depuis janvier 2025 (citer la référence demandée, aucun endossement suggéré).
- CABI Plantwise, fiches PMDG : CC BY-SA 4.0 d'après les conditions indexées, non vérifié sur la page.
- INRAB, MAEP : aucune licence affichée. On résume en citant la fiche, sans recopier le texte.
- Access Agriculture : tous droits réservés. Lien seulement, aucune reprise de contenu.

## Laissé au constructeur

- Le schéma exact de `data/solutions.json` et de `data/pesticides.json`.
- Le texte des gestes de niveau 2 pour chaque combinaison, à partir des sources ci-dessus et des documents cités.
- La rédaction fon initiale, d'après les textes publiés en fon (comme `data/reponses.json`), avant la relecture du locuteur.
- La mise en page exacte des cartes, dans le style de l'interface actuelle.

## Choix faits par Claude, à vérifier par Elisée

- Placement de la section sous le tableau, au-dessus de « Vous avez dit ».
- Au plus 4 éléments, dont un seul traitement.
- Mois de transition traités comme « saison inconnue ».
- Ajout du symptôme `striga` au lexique.
- Noms commerciaux jamais affichés : seulement la matière active et sa concentration.
- Un seul bouton d'écoute pour toute la section.
- Lien vers la vidéo Access Agriculture en fon quand elle existe.
- Export CSV pour la relecture du locuteur, qui relit le fon affiché et le texte de la voix.
- Problèmes présentés comme hypothèses : « C'est probablement … » (`nette`) ou « Ce peut être … » (`possible`), au plus deux.
- Règle stricte d'autorisation : même matière active et même concentration que la source, culture et ravageur couverts, autorisation valable ; sinon le traitement disparaît et les gestes restent.
- Mots déclencheurs propres à un cas (« puceron » pour le coton) ; partie non exigée pour la pourriture de l'igname et du manioc.
- Les articles d'essai de l'INRAB ne justifient pas un traitement (lecture prudente de « documents faits pour le Bénin ») ; ils peuvent nourrir les gestes.
- La mention « À confirmer avec un conseiller » est la seule réserve vue par l'agriculteur ; le conseiller voit en plus les réserves détaillées de chaque traitement.
- La relecture du fon par le locuteur reste une condition de mise en ligne (décision antérieure d'Elisée, non remise en cause par l'abandon de la validation agronomique).
