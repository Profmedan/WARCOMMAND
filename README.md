# WAR COMMAND

Simulateur de commandement d'opérations aériennes : vous planifiez des missions sur une carte réelle, vos
équipages les exécutent, et une IA autonome commande le camp adverse avec le même brouillard de guerre que
vous.

> Jeu de simulation. Situation, bases, unités et événements sont fictifs ; les valeurs des matériels sont
> des valeurs de jeu documentées, pas des prédictions de performances réelles.

Ce dépôt contient les **phases 1 à 4** du projet : architecture, tranche verticale jouable, simulation
aérienne approfondie et éditeur de missions. Deux scénarios sont livrés, « Bouclier Atlantique » et
« Brèche Boréale » ; l'éditeur permet d'en composer d'autres.

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
| `pnpm sim --file mon-scenario.json --campaign 30` | Joue ou mesure un scénario exporté par l'éditeur de missions |
| `pnpm build` | Construit l'application pour la production |

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
   tirage, les décisions de l'IA avec leurs utilités, et un mode observateur qui rejoue la partie en
   vérité-terrain.

Menu de la partie (icône en haut à droite) : briefing, sauvegarde dans le navigateur, export de la
sauvegarde en JSON. Le menu principal permet de reprendre une sauvegarde ou d'en importer une, et donne
accès à l'éditeur de missions.

### Les deux scénarios

- **Bouclier Atlantique** (90 min) — BLEU défend le secteur ALPHA, ROUGE le conteste. Quatre chasseurs par
  camp, avion-radar, ravitailleur bleu, sol-air et frégate. Équilibré.
- **Brèche Boréale** (120 min) — ROUGE tient le secteur BRAVO sous le couvert d'un groupe sol-air et d'une
  frégate ; BLEU, à 560 km de sa base, doit ouvrir une brèche (SEAD), tenir grâce à son ravitailleur et
  composer avec la tombée de la nuit. Drone de reconnaissance, six Rafale, un chasseur rouge en
  maintenance au départ. Volontairement difficile pour l'attaquant.

### L'éditeur de missions

Depuis le menu principal : « Nouveau scénario », « Modifier une copie de… » (à partir d'un scénario livré)
ou « Modifier » un de vos scénarios.

1. **Scénario** : titre, description, date et heure (elles fixent le jour et la nuit), durée, météo et son
   effet sur les capteurs, graine, difficulté par défaut. Pour changer de région, cadrez la carte où vous
   voulez dans le monde puis « Prendre la vue actuelle de la carte comme région ».
2. **Coalitions** : nom, doctrine et ses six réglages, règles d'engagement par défaut, briefing, et
   comportement initial de l'IA (posture imposée pendant une durée choisie).
3. **Forces** : posez les bases sur la carte, puis ajoutez les matériels de la bibliothèque — aéronefs à
   une base ou déjà en vol, groupes sol-air et bâtiments sur la carte. La fiche de droite règle le nom, le
   groupe, la base, l'entraînement, l'état initial, la patrouille d'un bâtiment et ce que l'adversaire sait
   de l'unité au départ.
4. **Missions** : missions déjà ordonnées au début (patrouille, balayage, surveillance, ravitaillement,
   reconnaissance), avec leurs points posés sur la carte.
5. **Objectif** : secteur, défenseur, seuils de victoire, zones de manœuvre maritime.
6. **Déclencheurs** : « quand… alors… », sans code — délai écoulé, pertes, entrée dans une zone, groupe
   indisponible, changement de contrôle ; message ou fin de mission.

Le bandeau du bas vérifie le scénario en continu (erreurs, avertissements). « Tester (IA contre IA) » joue
toute la mission et contrôle la cohérence du moteur à chaque seconde ; « Jouer » lance un essai et ramène à
l'éditeur ; « Enregistrer » conserve le scénario dans le navigateur ; « Exporter » en fait un fichier JSON,
que le menu sait réimporter. Un scénario enregistré et sans erreur se joue depuis le menu comme les autres.

## Ce qui est implémenté

- **Moteur de simulation** déterministe, à pas fixe de 1 s, exécutable sans navigateur (moins d'une seconde
  de calcul pour deux heures simulées) ; temps continu ou mode par tours.
- **Huit missions** : patrouille, interception, balayage, escorte, attaque des défenses sol-air (SEAD),
  surveillance aérienne, ravitaillement, reconnaissance par drone ; réaffectation en vol, annulation,
  changement de règles d'engagement, retour à la base, déplacement du bâtiment naval.
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
- **Brouillard de guerre** : une image par camp, sans aucun identifiant de vérité-terrain.
- **IA adverse** hiérarchique (stratégique, opérative, tactique), trois niveaux de difficulté, sans privilège
  caché : elle choisit ses postures et ses stations, attaque les défenses qui couvrent le secteur, fait
  escorter son attaque et ses moyens de soutien, attend l'effet de son attaque avant de s'installer,
  anticipe ses relèves, se replie selon sa doctrine.
- **Doctrines** paramétrables, chaque paramètre classé de 1 (doctrine publique documentée) à 4 (équilibrage).
- **Base de matériels** de 19 fiches, classées par origine, avec provenance et niveau de confiance de
  chaque valeur.
- **Scénarios** au format versionné, validés par schéma et par contrôles de cohérence ; déclencheurs sans
  code ; réglages de doctrine et comportement initial de l'IA propres à chaque scénario.
- **Éditeur de missions** : région, coalitions, bases, unités, groupes, missions initiales, objectif et
  conditions de victoire, déclencheurs ; vérification en continu, test rapide IA contre IA, essai en jeu,
  duplication, enregistrement, import et export JSON. Chaque geste est une opération testée, qui refuse en
  disant pourquoi.
- **Sauvegarde, rechargement, rejeu déterministe, compte rendu après action, mode observateur.**
- **Interface** en français : carte MapLibre sur fond Natural Earth embarqué, arborescence des forces,
  recherche, filtres de domaine et de couches, planificateur, journal, ordre de missions, légende, mesure
  de distance.

## Limites réelles de cette version

- Domaine aérien uniquement. Le bâtiment naval et les groupes sol-air sont des plates-formes radar et
  sol-air, cibles possibles d'une attaque SEAD ; il n'y a ni combat naval, ni frappe d'autres objectifs, ni
  forces terrestres, ni espace, ni cyber, ni opérations spéciales.
- Éditeur de missions : deux coalitions et un seul secteur d'objectif, dont la victoire se décide au temps
  de contrôle ; missions initiales limitées aux cinq types à station ou à route (interception, escorte et
  attaque des défenses s'ordonnent en jeu) ; une action par déclencheur ; emports initiaux et règles du
  moteur non réglables ; pas d'annulation des modifications ; aucun contrôle du terrain — c'est à l'auteur
  de poser les bases à terre et les zones navales en mer ; la « période » est un libellé, elle ne filtre
  pas les matériels.
- Scénarios personnels conservés dans le stockage local du navigateur (24 au plus) ou en fichier JSON.
- Matériels ajoutés en phase 4 : valeurs de jeu, toutes étiquetées « estimation » ; leurs données de
  référence publiques restent à recouper.
- Missions non modélisées : appui rapproché, patrouille maritime, brouillage offensif, transport,
  recherche et sauvetage.
- Pas de relief ni de météo dynamique (la météo est un facteur global du scénario). Jour et nuit sont
  évalués en un seul point, le centre du secteur.
- Le résultat d'une attaque n'est connu que s'il peut être constaté : l'IA comme le joueur peuvent
  réattaquer un site déjà détruit.
- Carte : fond Natural Earth au 1:50 000 000, sans satellite, relief, bathymétrie, routes ni aérodromes ;
  pas de vue 3D. Les symboles sont des éléments simplifiés inspirés des conventions publiques.
- Sauvegardes dans le stockage local du navigateur ou en fichier JSON ; pas de base de données, pas de
  multijoueur.
- Pas de tests de bout en bout automatisés (Playwright non installé) : l'interface est vérifiée à la main
  dans le navigateur — voir ci-dessous.
- La reproductibilité est garantie sur une même plate-forme ; d'un moteur JavaScript à l'autre, les fonctions
  trigonométriques peuvent différer au dernier chiffre.
- Équilibrage en IA contre IA (difficulté standard) : « Bouclier Atlantique », BLEU 33, ROUGE 26, indécis 1
  sur 60 ; « Brèche Boréale », BLEU 5, ROUGE 17, indécis 8 sur 30.
- Doctrine rouge : uniquement des hypothèses de simulation, les sources ouvertes citées restent à dépouiller.

## Vérifications effectuées

- `pnpm test` : 213 tests, écrits avant le code depuis la phase 3 (noyau, astronomie, ordres, vol et
  carburant, disponibilité, emports, émissions et reconnaissance, engagement, missions, planification, mode
  par tours, IA, scénarios, reproductibilité, rejeu, sauvegarde, compte rendu, bibliothèque des forces,
  opérations de l'éditeur). Cinq parties complètes sont contrôlées pas à pas : invariants, absence de
  révélation injustifiée, bilan des munitions.
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

## Organisation

```
packages/
  simulation-core     état, horloge, RNG à graine, géodésie, astronomie, image par camp, invariants
  unit-database       fiches matériels, emports et provenance des données
  doctrine-engine     profils de doctrine classés
  air-operations      ordres, missions, tactique, mouvement, capteurs, engagement, planification
  ai-commander        IA stratégique et opérative
  scenario-system     schéma, scénarios, objectifs, déclencheurs, session
  replay-engine       enregistrement, rejeu, sauvegarde, compte rendu
  mission-editor      opérations d'édition, vérification, test rapide, import et export
apps/web              interface (src/user-interface, dont editor/) et carte (src/world-map)
tools/                exécution sans navigateur
docs/                 dossier de conception et modèle de jeu
```

- [Dossier de conception](docs/superpowers/specs/2026-11-12-war-command-design.md) : concept, architecture,
  modèle de données, interfaces, scénarios, risques, plan, matrice de tests, bilans des phases 3 et 4.
- [Modèle de jeu](docs/modele-de-jeu.md) : toutes les règles, probabilités et simplifications.

## Licences des composants

MapLibre GL JS (BSD-3-Clause), Next.js et React (MIT), Zod (MIT), Vitest (MIT), tsx (MIT),
TypeScript (Apache-2.0), topojson-client et world-atlas (ISC), données Natural Earth (domaine public).
Aucune API payante, aucun service en ligne : le jeu fonctionne hors connexion une fois installé.
