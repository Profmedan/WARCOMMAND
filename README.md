# WAR COMMAND

Simulateur de commandement d'opérations interarmées, centré sur les opérations aériennes : vous planifiez
des missions sur une carte réelle, vous manœuvrez des formations terrestres et des bâtiments, et une IA
autonome commande le camp adverse avec le même brouillard de guerre que vous.

> Jeu de simulation. Situation, bases, unités et événements sont fictifs ; les valeurs des matériels sont
> des valeurs de jeu documentées, pas des prédictions de performances réelles.

Ce dépôt contient les **phases 1 à 6** du projet : architecture, tranche verticale jouable, simulation
aérienne approfondie, éditeur de missions, opérations interarmées (forces terrestres et navales,
logistique, commandement, effets cyber et spatiaux abstraits, opérations spéciales) et fonctions avancées
(vue 3D sur le globe, rejeu détaillé, analyse approfondie des opérations, campagne persistante, partie à
deux joueurs). Trois scénarios sont livrés, « Bouclier Atlantique », « Brèche Boréale » et « Tête de
pont », ainsi qu'une campagne qui les enchaîne ; l'éditeur permet de composer d'autres scénarios.

## Lancer

Prérequis : Node.js ≥ 22.12 et pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

Puis ouvrir http://localhost:3210.

| Commande | Rôle |
|----------|------|
| `pnpm dev` | Lance le jeu dans le navigateur |
| `pnpm test` | Tests du moteur, des règles, de l'IA, des scénarios et de la reproductibilité |
| `pnpm typecheck` | Typage strict des paquets de simulation, des outils et de l'application |
| `pnpm sim` | Joue une partie IA contre IA **sans navigateur** et affiche le bilan |
| `pnpm sim --scenario breche-boreale --seed 42 --journal` | Autre scénario, graine imposée, journal complet de l'arbitre |
| `pnpm sim --campaign 60 --difficulty veteran` | Soixante parties d'affilée, pour mesurer l'équilibrage |
| `pnpm sim --scenario tete-de-pont` | Une partie interarmées, avec son bilan terrestre et naval |
| `pnpm sim --file mon-scenario.json --campaign 30` | Joue ou mesure un scénario exporté par l'éditeur de missions |
| `pnpm sim --analyse --rejeux 12` | Ajoute l'analyse des opérations et rejoue la partie avec douze autres tirages |
| `pnpm sim --record partie.json` | Écrit l'enregistrement de la partie, à revoir dans le jeu |
| `pnpm serve` | Lance le serveur de parties à deux joueurs, pour cette seule machine (`ws://127.0.0.1:3211`) |
| `pnpm serve --lan` | Le même, ouvert au réseau local ; `--port 4000` change le port |
| `pnpm build` | Construit l'application pour la production |

> `pnpm server` (avec un « r ») est une commande interne de pnpm et ne lance rien : la commande du jeu est
> bien `pnpm serve`.

## Jouer

1. Choisissez le scénario, votre camp, la difficulté de l'IA, la graine et la gestion du temps : continu
   avec pause, ou par tours de 5 ou 10 minutes (ordres simultanés des deux camps).
2. La partie démarre en pause. Sélectionnez une unité, une mission ou un contact pour voir sa fiche et agir.
3. « Nouvelle mission » ouvre le planificateur : type, appareils, cible ou station posée sur la carte,
   altitude, départ, fin de créneau, emport, règles d'engagement, silence radar, ravitaillement. Il affiche
   l'heure d'arrivée, le carburant à l'arrivée et l'autonomie sur zone, et dit aussitôt si l'ordre est
   réalisable — sinon pourquoi.
4. Choisissez une vitesse (pause, ×1, ×5, ×20, ×100 ; barre d'espace : pause). Vos équipages tiennent la
   station, poursuivent, ravitaillent, se dégagent après un tir et rentrent seuls au carburant minimal.
5. Vous ne voyez que ce que vos capteurs détectent : contacts « ? » non identifiés, pistes identifiées,
   pistes connues par la seule écoute de leurs émissions (sans tir possible), informations anciennes
   estompées avec leur cercle d'incertitude.
6. À la fin, le compte rendu révèle le contrôle réel du secteur, chaque tir avec sa probabilité et son
   tirage, les décisions de l'IA avec leurs utilités, l'analyse des opérations et un rejeu
   détaillé de la partie, en vérité-terrain ou du point de vue d'un camp.

### Opérations interarmées (scénario « Tête de pont »)

- **Formation terrestre** : sa fiche montre effectifs, moral, cohésion, fatigue, ravitaillement et
  retranchement. Choisissez une posture (déplacement, attaque, défense, décrochage, attente), tracez
  l'itinéraire sur la carte, à terre : l'ordre est exécuté après un délai de transmission, plus long loin
  d'un poste de commandement ou quand vos réseaux sont perturbés.
- **Appui aérien rapproché** : mission du planificateur, avec emport air-surface. Les appareils tiennent
  une zone d'appui et frappent les formations adverses que vous avez repérées, celles au contact de vos
  troupes d'abord.
- **Bâtiments** : « Déplacer » fait manœuvrer un bâtiment en mer ; son escorte le suit. Frégates et
  destroyers tirent seuls leurs missiles antinavires et leurs armes anti-sous-marines sur les pistes à
  portée, selon vos règles d'engagement ; le sous-marin torpille. « Mettre à terre » débarque une
  formation embarquée sur une plage à moins de 8 km. Le porte-avions est une base aérienne mobile.
- **Effets multi-domaines** (fiche générale, sans sélection) : état de vos réseaux, liaisons et navigation
  par satellite, fenêtres de vos satellites d'observation, et vos effets disponibles — perturbation des
  réseaux adverses, brouillage de ses services spatiaux. Ce sont des jetons de jeu, aux effets temporaires.
- **Équipe spéciale** : « Infiltrer » puis un point à terre ; une fois en observation, elle renseigne sur
  ce qui l'entoure, peut être découverte, et se récupère par « Exfiltrer ».
- La **localité** revient au camp dont les formations de mêlée présentes sont nettement les plus fortes
  (une fois et demie l'adversaire) ; à forces comparables, elle est contestée.

Menu de la partie (icône en haut à droite) : briefing, sauvegarde dans le navigateur, export de la
sauvegarde en JSON. Le menu principal permet de reprendre une sauvegarde ou d'en importer une, et donne
accès à l'éditeur de missions.

### Vue 3D

Le bouton « Vue 3D », en haut à droite de la carte, passe au globe : la Terre est une sphère, un clic droit
(ou Ctrl + glisser) fait tourner et incliner la caméra. Chaque appareil en vol, ami ou piste aérienne
fraîche, est relié à sa position au sol par une colonne à la hauteur de son altitude, exagérée douze fois.
Les ordres se donnent en 3D comme en 2D. Le terrain du scénario apparaît en volumes schématiques : le jeu
n'embarque pas de relief réel.

### Après la mission : analyse et rejeu

Le compte rendu a deux onglets de plus.

- **Analyse** : courbes du rapport de forces (chasseurs disponibles et en vol, qualité de l'image de chaque
  camp, effectifs à terre, coque des bâtiments), efficacité des tirs comparée à ce que le hasard devait
  donner, tirs par distance et selon la surprise, chaîne d'engagement de chaque destruction, bilan de
  chaque mission aérienne, moments clés. « Part du hasard » rejoue la partie douze fois avec d'autres
  tirages et dit si le résultat tient.
- **Rejeu** : la partie revue à tout instant — lecture à trois vitesses, pas à pas, chronologie cliquable.
  Le point de vue se choisit : vérité-terrain des deux camps, ou ce que voyait un camp à cet instant. Un
  clic sur une unité donne son état du moment ; les traces montrent les quinze dernières minutes ; la vue
  3D y est disponible.

« Exporter l'enregistrement » produit un fichier que le menu principal sait relire (« Revoir un
enregistrement ») : la partie est re-simulée et son compte rendu s'ouvre, analyse et rejeu compris.

### Campagne

« Opération Vent du Nord » enchaîne les trois scénarios. Choisissez votre camp et la difficulté, puis
« Commencer la campagne ». L'issue de chaque acte décide du suivant, et ce que vous perdez vous suit :

- un aéronef perdu sur deux est remplacé avant la mission suivante, les autres manquent à l'appel ;
- vos tirs entament la réserve de missiles du théâtre, qui limite les stocks de vos bases ;
- les équipages du vainqueur progressent.

L'écran de campagne annonce ce qui est reporté sur la mission à venir. La campagne est enregistrée dans le
navigateur après chaque mission ; quitter une mission en cours la suspend, pour la reprendre plus tard.
Elle s'exporte et s'importe en JSON.

### Partie à deux joueurs

1. Sur une machine, lancez le serveur de parties : `pnpm serve` (ou `pnpm serve --lan` pour jouer sur le
   réseau local ; il affiche alors l'adresse à donner).
2. Dans le menu, carte « Partie à deux joueurs » : indiquez l'adresse du serveur et votre nom. L'hôte
   choisit le scénario, son camp et la gestion du temps dans le menu, puis « Créer la partie » : il reçoit
   un code de quatre caractères.
3. L'autre joueur saisit ce code et « Rejoindre » : il prend le camp libre.

Chacun ne reçoit que l'image de son camp. Le temps avance à la plus lente des deux vitesses demandées ; il
s'arrête si un joueur se déconnecte, qui retrouve sa place en revenant (« Reprendre ma place »). À la fin,
les deux joueurs ont le compte rendu complet, analyse et rejeu compris.

### Les trois scénarios

- **Bouclier Atlantique** (90 min) — BLEU défend le secteur ALPHA, ROUGE le conteste. Quatre chasseurs par
  camp, avion-radar, ravitailleur bleu, sol-air et frégate. Équilibré.
- **Brèche Boréale** (120 min) — ROUGE tient le secteur BRAVO sous le couvert d'un groupe sol-air et d'une
  frégate ; BLEU, à 560 km de sa base, doit ouvrir une brèche (SEAD), tenir grâce à son ravitailleur et
  composer avec la tombée de la nuit. Drone de reconnaissance, six Rafale, un chasseur rouge en
  maintenance au départ. Volontairement difficile pour l'attaquant.
- **Tête de pont** (210 min) — dans l'est de l'Islande, ROUGE marche sur la localité CHARLIE que BLEU tient
  avec un groupement retranché. Bataillons, artillerie, génie, logistique et postes de commandement,
  groupe aéronaval bleu, groupe amphibie rouge et son renfort embarqué, sous-marins, satellites, effets
  cyber et spatiaux, équipes spéciales. Équilibré en difficulté standard.

### L'éditeur de missions

Depuis le menu principal : « Nouveau scénario », « Modifier une copie de… » (à partir d'un scénario livré)
ou « Modifier » un de vos scénarios.

1. **Scénario** : titre, description, date et heure (elles fixent le jour et la nuit), durée, météo et son
   effet sur les capteurs, graine, difficulté par défaut. Pour changer de région, cadrez la carte où vous
   voulez dans le monde puis « Prendre la vue actuelle de la carte comme région ».
2. **Coalitions** : nom, doctrine et ses six réglages, règles d'engagement par défaut, briefing,
   comportement initial de l'IA (posture imposée pendant une durée choisie), résilience des réseaux et
   nombre d'effets multi-domaines.
3. **Forces** : posez les bases sur la carte, puis ajoutez les matériels de la bibliothèque — aéronefs et
   équipes spéciales à une base, aéronefs déjà en vol, groupes sol-air, formations terrestres (à terre) et
   bâtiments (en mer) sur la carte. Un porte-avions arrive avec son pont d'envol, un navire logistique avec
   son dépôt flottant. La fiche de droite règle le nom, le groupe, la base, l'entraînement, l'état initial,
   les effectifs, le moral, le ravitaillement et la posture d'une formation, son embarquement, le chef de
   file et la patrouille d'un bâtiment, les stocks d'une base (dont le ravitaillement qui en fait un
   dépôt), et ce que l'adversaire sait de l'unité au départ.
4. **Missions** : missions déjà ordonnées au début (patrouille, balayage, surveillance, ravitaillement,
   reconnaissance), avec leurs points posés sur la carte.
5. **Objectif** : nature de l'objectif (secteur aérien ou zone terrestre), défenseur, seuils de victoire,
   zones de manœuvre maritime.
6. **Terrain** : zones urbaines, forêts, reliefs et marais, qui changent vitesse, protection et
   dissimulation ; fenêtres et empreintes des satellites d'observation.
7. **Déclencheurs** : « quand… alors… », sans code — délai écoulé, pertes, entrée dans une zone, groupe
   indisponible, changement de contrôle ; message ou fin de mission.

Le bandeau du bas vérifie le scénario en continu (erreurs, avertissements). « Tester (IA contre IA) » joue
toute la mission et contrôle la cohérence du moteur à chaque seconde ; « Jouer » lance un essai et ramène à
l'éditeur ; « Enregistrer » conserve le scénario dans le navigateur ; « Exporter » en fait un fichier JSON,
que le menu sait réimporter. Un scénario enregistré et sans erreur se joue depuis le menu comme les autres.

## Ce qui est implémenté

- **Moteur de simulation** déterministe, à pas fixe de 1 s, exécutable sans navigateur (moins d'une seconde
  de calcul pour deux heures simulées) ; temps continu ou mode par tours.
- **Neuf missions aériennes** : patrouille, interception, balayage, escorte, attaque des défenses sol-air
  (SEAD), appui aérien rapproché, surveillance aérienne, ravitaillement, reconnaissance par drone ;
  réaffectation en vol, annulation, changement de règles d'engagement, retour à la base.
- **Emports** air-air et air-surface, stocks de base par type de munition, changement d'emport au sol.
- **Carburant** : consommation par régime et altitude, seuil bingo, panne sèche, ravitaillement en vol,
  rayon d'action étendu par le ravitailleur, estimation de l'autonomie sur zone.
- **Disponibilité** : remise en condition, pannes à l'atterrissage, réparation des appareils endommagés,
  indisponibilités initiales.
- **Capteurs** : radar (portée, signature, horizon, secteur balayé), écoute passive des émissions radar,
  silence radar, capteur optronique du drone, jour et nuit, identification progressive, vieillissement des
  pistes, constat de destruction.
- **Engagement** : règles d'engagement, tirs air-air, sol-air et air-surface avec temps de vol, résolution
  probabiliste transparente, neutralisation temporaire ou destruction des défenses sol-air.
- **Formations** en ligne de front.
- **Forces terrestres** : infanterie, infanterie mécanisée, blindés, artillerie, génie, reconnaissance,
  logistique, postes de commandement ; effectifs, moral, fatigue, cohésion, ravitaillement, postures,
  retranchement, terrain, zones de contrôle, rupture et ralliement, engagements abstraits par attrition,
  appui indirect de l'artillerie, demande et réception d'un appui aérien.
- **Forces navales** : porte-avions et aviation embarquée, frégates, destroyers, sous-marins, navires
  amphibies et logistiques ; groupes et escortes, écoute sous-marine, missiles antinavires, torpilles,
  lutte anti-sous-marine, défense rapprochée, avaries, débarquement, recomplètement à la mer.
- **Logistique et commandement** : dépôts, bataillons logistiques qui font la navette, délai de
  transmission des ordres, rayon de commandement des postes de commandement.
- **Effets cyber et spatiaux abstraits** : niveaux de service des réseaux, des liaisons et de la
  navigation par satellite, perturbation temporaire, résilience et rétablissement, satellites
  d'observation fictifs à fenêtres de couverture. Aucune fonction d'attaque informatique réelle.
- **Opérations spéciales** : infiltration, observation en profondeur, comptes rendus de renseignement,
  découverte, exfiltration — résolution abstraite.
- **Masque terre-mer** tiré de Natural Earth : formations à terre, bâtiments en mer, itinéraires contrôlés.
- **Brouillard de guerre** : une image par camp, sans aucun identifiant de vérité-terrain.
- **IA adverse** hiérarchique (stratégique, opérative, tactique), trois niveaux de difficulté, sans privilège
  caché : elle choisit ses postures et ses stations, attaque les défenses qui couvrent le secteur, fait
  escorter son attaque et ses moyens de soutien, attend l'effet de son attaque avant de s'installer,
  anticipe ses relèves, se replie selon sa doctrine. En interarmées, elle attaque ou défend la zone avec
  ses formations, fait suivre appuis et soutiens, garde une paire pour l'appui aérien, débarque son
  renfort, emploie ses effets et son équipe spéciale, et — au niveau vétéran — fait chasser son sous-marin.
- **Doctrines** paramétrables, chaque paramètre classé de 1 (doctrine publique documentée) à 4 (équilibrage).
- **Base de matériels** de 33 fiches, classées par origine, avec provenance et niveau de confiance de
  chaque valeur ; formations terrestres et bâtiments sont des matériels génériques, sans équivalent réel.
- **Scénarios** au format versionné, validés par schéma et par contrôles de cohérence ; déclencheurs sans
  code ; réglages de doctrine et comportement initial de l'IA propres à chaque scénario.
- **Éditeur de missions** : région, coalitions, bases, unités, groupes, missions initiales, objectif et
  conditions de victoire, terrain, satellites, déclencheurs ; toutes les composantes interarmées s'y
  règlent ; vérification en continu, test rapide IA contre IA, essai en jeu, duplication, enregistrement,
  import et export JSON. Chaque geste est une opération testée, qui refuse en disant pourquoi.
- **Sauvegarde, rechargement, rejeu déterministe, compte rendu après action.**
- **Rejeu détaillé** : consultation à tout instant, lecture, pas à pas, chronologie à repères, traces des
  unités, point de vue de l'arbitre ou d'un camp, relecture d'un enregistrement exporté.
- **Analyse approfondie des opérations** : séries temporelles, efficacité des tirs et part de chance,
  distance de tir et surprise, chaîne d'engagement, bilan des missions, moments clés, sensibilité au
  hasard par rejeux ; disponible aussi sans navigateur.
- **Campagne persistante** : missions enchaînées selon leur issue, report des pertes d'aéronefs, des
  stocks de munitions et de l'expérience, points, enregistrement, suspension d'une mission, import et export.
- **Partie à deux joueurs** : serveur de parties faisant autorité (WebSocket), brouillard de guerre
  préservé, temps continu ou par tours, reprise après déconnexion, compte rendu commun.
- **Vue 3D** : globe, caméra libre, altitude des aéronefs en volume, profil de vol des traces.
- **Interface** en français : carte MapLibre sur fond Natural Earth embarqué, arborescence des forces,
  recherche, filtres de domaine et de couches, planificateur, journal, ordre de missions, légende, mesure
  de distance.

## Limites réelles de cette version

- Opérations interarmées : modèle volontairement abstrait. Une formation est un point ; le combat
  terrestre est une attrition proportionnelle aux puissances en présence, sans manœuvre tactique ni tir
  direct détaillé ; les itinéraires sont des segments droits contrôlés à l'ordre, sans recherche de chemin
  ni réseau routier. En mer, un sous-marin est toujours en plongée, le sonar est un tirage par balayage,
  missile antinavire et torpille se résolvent en un tirage à l'impact. Pas d'hélicoptères, de défense
  sol-air d'accompagnement, de mines, de guerre électronique détaillée, de frappe d'objectifs fixes.
- IA interarmées : elle ne manœuvre pas ses bâtiments de surface pour chercher le combat, et ne fait
  chasser son sous-marin qu'au niveau vétéran — en difficulté standard, les engagements navals ne viennent
  que du joueur. Ses itinéraires terrestres contournent la mer par quelques détours simples.
- Estimation du contrôle au sol : une formation adverse perdue de vue reste présumée sur place dix minutes ;
  au-delà, la zone peut vous paraître tenue alors qu'elle est disputée. Le compte rendu donne l'écart.
- Effets cyber et spatiaux : jetons de jeu qui abaissent un niveau de service pour un temps ; aucun réseau,
  aucun système réel n'est modélisé. Satellites fictifs, optiques seulement (jour, temps clair).
- Sauvegardes : une sauvegarde faite avant la phase 5 n'est plus lisible (le jeu le dit en clair).
- Éditeur de missions : deux coalitions et un seul secteur d'objectif, dont la victoire se décide au temps
  de contrôle ; missions initiales limitées aux cinq types à station ou à route (interception, escorte et
  attaque des défenses s'ordonnent en jeu) ; une action par déclencheur ; emports initiaux et règles du
  moteur non réglables ; pas d'annulation des modifications ; formations et bâtiments sont contrôlés
  contre le masque terre-mer, mais c'est à l'auteur de poser les bases à terre et les zones navales en
  mer ; zones de terrain et empreintes de satellites sont des cercles ; la « période » est un libellé, elle
  ne filtre pas les matériels.
- Scénarios personnels conservés dans le stockage local du navigateur (24 au plus) ou en fichier JSON.
- Matériels ajoutés en phases 4 et 5 : valeurs de jeu, toutes étiquetées « estimation » ; les données de
  référence publiques des aéronefs restent à recouper, les formations et bâtiments génériques n'en ont pas.
- Missions aériennes non modélisées : patrouille maritime, lutte antinavire aérienne dédiée, brouillage
  offensif, transport, recherche et sauvetage.
- Pas de relief cartographié ni de météo dynamique (le terrain est décrit par des zones du scénario, la
  météo est un facteur global). Jour et nuit sont évalués en un seul point, le centre du secteur.
- Le résultat d'une attaque n'est connu que s'il peut être constaté : l'IA comme le joueur peuvent
  réattaquer un site déjà détruit.
- Carte : fond Natural Earth au 1:50 000 000, sans satellite, relief, bathymétrie, routes ni aérodromes.
  Les symboles sont des éléments simplifiés inspirés des conventions publiques.
- Vue 3D : le globe et les altitudes sont réels, pas le relief — aucun modèle d'altitude du terrain n'est
  embarqué, et les zones de terrain du scénario y sont des volumes schématiques. Les symboles restent au
  sol, au pied de leur colonne d'altitude. CesiumJS n'a pas été retenu : MapLibre, déjà présent, sait
  afficher le globe.
- Analyse : la « part du hasard » rejoue vos ordres tels quels, aux mêmes instants ; ils ne s'adaptent pas
  à une situation qui tourne autrement. Le temps sur zone d'une mission ne compte que la tenue de station.
- Campagne : une seule campagne livrée, de trois actes ; les reports ne concernent que les aéronefs, les
  missiles et l'entraînement des équipages (ni les formations terrestres, ni les bâtiments) ; pas d'éditeur
  de campagne.
- Partie à deux joueurs : deux joueurs exactement, sans IA ni spectateur ; pas de comptes, pas de
  messagerie ; le serveur garde les parties en mémoire seulement (une partie se perd s'il s'arrête, et se
  ferme dix minutes après le départ des deux joueurs) ; prévu pour une machine ou un réseau local, sans
  chiffrement — ne l'exposez pas à Internet tel quel. Pas de sauvegarde en cours de partie.
- Persistance : stockage local du navigateur et fichiers JSON. PostgreSQL n'a pas été retenu : aucune
  fonction du jeu n'a besoin d'une base de données.
- Pas de tests de bout en bout automatisés de l'écran (Playwright non installé) : l'interface est vérifiée
  à la main dans le navigateur — voir ci-dessous. Le serveur de parties, lui, est testé avec de vraies
  connexions WebSocket.
- La reproductibilité est garantie sur une même plate-forme ; d'un moteur JavaScript à l'autre, les fonctions
  trigonométriques peuvent différer au dernier chiffre.
- Équilibrage en IA contre IA (difficulté standard) : « Bouclier Atlantique », BLEU 33, ROUGE 26, indécis 1
  sur 60 ; « Brèche Boréale », BLEU 5, ROUGE 17, indécis 8 sur 30 ; « Tête de pont », BLEU 13, ROUGE 12,
  indécis 5 sur 30 — mais BLEU 10, ROUGE 2, indécis 4 sur 16 au niveau vétéran, où le sous-marin bleu coule
  souvent le navire logistique et le navire amphibie rouges.
- Doctrine rouge : uniquement des hypothèses de simulation, les sources ouvertes citées restent à dépouiller.

## Vérifications effectuées

- `pnpm test` : 473 tests, écrits avant le code depuis la phase 3 (noyau, astronomie, masque terre-mer,
  ordres, vol et carburant, disponibilité, emports, émissions et reconnaissance, engagement, missions,
  planification, mode par tours, IA, scénarios, reproductibilité, rejeu, sauvegarde, compte rendu,
  bibliothèque des forces, opérations de l'éditeur ; et, pour la phase 5, ordres et combat terrestres,
  appui aérien rapproché, opérations navales, effets multi-domaines et opérations spéciales, IA
  interarmées, scénario « Tête de pont », éditeur interarmées ; pour la phase 6, analyse des opérations,
  rejeu détaillé et relecture d'enregistrements, campagne et ses reports, partie à deux joueurs, salon de
  jeu en réseau, et serveur de parties essayé avec de vraies connexions WebSocket). Six parties complètes sont contrôlées pas
  à pas : invariants, absence de révélation injustifiée, bilan des munitions ; l'image d'un camp ne
  contient jamais l'identifiant d'une unité adverse.
- `pnpm typecheck` et `pnpm build` : sans erreur.
- Parcours manuel dans le navigateur (12/11/2026) : les deux scénarios, en BLEU et en ROUGE ; planification
  d'une patrouille et d'une attaque SEAD (refus motivé hors rayon d'action, estimation, emport) ;
  accélération jusqu'à ×100 ; mode par tours (ordres refusés en cours de tour, arrêt automatique en fin de
  tour) ; fin de mission, compte rendu, mode observateur ; sauvegarde puis reprise après rechargement.
- Parcours manuel de l'éditeur (12/11/2026) : scénario créé de zéro (bases, huit chasseurs, frégate, zone
  navale et patrouille, mission initiale, déclencheur, posture imposée à l'IA, région recadrée) ; refus
  affichés (message vide, patrouille sans zone) ; test rapide ; essai en jeu puis retour à l'éditeur avec
  le brouillon intact ; enregistrement, réouverture, duplication, export, import (y compris un fichier
  refusé), suppression, brouillon incomplet non jouable ; ouverture d'une copie de « Bouclier Atlantique ».
- `pnpm sim --file` : un scénario livré, exporté puis rejoué depuis son fichier, donne la même empreinte
  d'état que l'original.
- Non-régression de la phase 5 : les campagnes de « Bouclier Atlantique » (60 parties) et de « Brèche
  Boréale » (30 parties) donnent exactement les mêmes résultats qu'avant l'ajout des systèmes terrestre,
  naval et multi-domaines.
- Parcours manuel de « Tête de pont » dans le navigateur (13/11/2026) : en BLEU, ordre de déplacement
  d'une formation (délai de transmission, itinéraire tracé), infiltration d'une équipe spéciale (refusée
  en mer, acceptée à terre), emploi d'une perturbation, mission d'appui aérien rapproché planifiée et
  exécutée, partie menée à son terme en ×100, compte rendu (pertes terrestres, effectifs restants, coque
  des bâtiments, décisions interarmées de l'IA) ; en ROUGE, débarquement refusé à plus de 8 km de la
  plage, déplacement naval refusé vers la terre puis accepté en mer.
- Parcours manuel de l'éditeur sur une copie de « Tête de pont » (13/11/2026) : fiches d'un porte-avions
  et de son pont d'envol, d'une frégate, d'un bataillon, d'une équipe spéciale ; zone de terrain et
  satellite posés sur la carte ; embarquement accepté puis refusé au-delà de la capacité ; porte-avions
  refusé à terre puis posé en mer avec son pont ; test rapide IA contre IA sans incohérence.

- Non-régression de la phase 6 : les quatre campagnes de mesure (« Bouclier Atlantique » 33/26/1, « Brèche
  Boréale » 5/17/8, « Tête de pont » 13/12/5 en standard et 10/2/4 au niveau vétéran) donnent exactement
  les mêmes résultats qu'à l'issue de la phase 5 : la phase 6 n'a touché à aucune règle de combat.
- Parcours manuel de la phase 6 dans le navigateur (13/11/2026) : vue 3D en partie (globe, colonnes
  d'altitude, partie menée à son terme en ×100) ; onglet « Analyse » (courbes, infobulle au survol et au
  clavier, tableaux, douze rejeux) ; onglet « Rejeu » (saut dans le temps, image du camp BLEU, fiche d'une
  unité, traces, vue 3D) ; export d'un enregistrement puis relecture depuis le menu, et refus d'une
  sauvegarde présentée comme enregistrement ; campagne (lancement, suspension et reprise de la mission à
  la même heure, fin de mission consignée, réserve et expérience reportées sur l'acte II) ; partie à deux
  joueurs dans deux onglets (création, code refusé puis accepté, ordre planifié par ROUGE avec estimation
  du serveur, vitesse la plus lente des deux, pause, fin de partie et compte rendu des deux côtés, reprise
  de sa place après rechargement de la page).

## Organisation

```
packages/
  simulation-core     état, horloge, RNG à graine, géodésie, astronomie, masque terre-mer, terrain,
                      image par camp, invariants
  unit-database       fiches matériels, emports et provenance des données
  doctrine-engine     profils de doctrine classés
  air-operations      ordres, missions, tactique, mouvement, capteurs, engagement, planification
  land-operations     ordres et système terrestres : mouvement, combat, moral, logistique, commandement
  naval-operations    groupes, écoute sous-marine, lutte antinavire et anti-sous-marine, débarquement
  multi-domain-effects  services cyber et spatiaux, satellites d'observation, opérations spéciales
  ai-commander        IA stratégique et opérative, aérienne et interarmées
  scenario-system     schéma, scénarios, objectifs, déclencheurs, session
  replay-engine       enregistrement, rejeu détaillé, sauvegarde, compte rendu, analyse des opérations
  mission-editor      opérations d'édition, vérification, test rapide, import et export
  campaign-system     campagnes : enchaînement des missions, reports, points, persistance
  net-play            partie à deux joueurs : salon, protocole, brouillard de guerre (sans socket)
apps/web              interface (src/user-interface, dont editor/) et carte (src/world-map)
tools/                exécution sans navigateur, serveur de parties (WebSocket)
docs/                 dossier de conception et modèle de jeu
```

- [Dossier de conception](docs/superpowers/specs/2026-11-12-war-command-design.md) : concept, architecture,
  modèle de données, interfaces, scénarios, risques, plan, matrice de tests, bilans des phases 3 à 6.
- [Modèle de jeu](docs/modele-de-jeu.md) : toutes les règles, probabilités et simplifications.

## Licences des composants

MapLibre GL JS (BSD-3-Clause), Next.js et React (MIT), Zod (MIT), Vitest (MIT), tsx (MIT), ws (MIT),
TypeScript (Apache-2.0), topojson-client et world-atlas (ISC), données Natural Earth (domaine public).
Aucune API payante, aucun service en ligne : le jeu fonctionne hors connexion une fois installé. Le
serveur de parties à deux joueurs tourne sur votre machine.
