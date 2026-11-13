# WAR COMMAND — Modèle de jeu

Ce document décrit les règles réellement appliquées par le moteur, les probabilités utilisées et les
simplifications assumées, à l'issue de la phase 6. Tout ce qui suit est un **modèle ludique** : aucune
valeur ne prétend prédire l'efficacité réelle d'un système d'armes, d'une tactique ou d'une doctrine.

Les paramètres numériques sont regroupés dans `packages/simulation-core/src/rules.ts` (`DEFAULT_RULES`) et
peuvent être surchargés par un scénario (`rules`). Les valeurs des matériels sont dans
`packages/unit-database/src/index.ts`, chacune étiquetée « donnée publique » ou « estimation de jeu ».

## 1. Temps et ordre de résolution

- Pas fixe de **1 seconde** de simulation, indépendant de l'affichage.
- À chaque pas, dans cet ordre : missions → tactique → mouvement et carburant → capteurs (toutes les 5 s) →
  engagement → opérations terrestres → opérations navales → effets multi-domaines → objectif →
  déclencheurs → IA (éveil toutes les 10 s).
- Les systèmes terrestre, naval et multi-domaines ne font rien, et ne consomment aucun nombre aléatoire,
  dans un scénario qui n'engage pas ces composantes : les scénarios aériens se rejouent à l'identique.
- Un seul générateur pseudo-aléatoire (Mulberry32), trois flux : `sim`, `ai:BLUE`, `ai:RED`. Son état fait
  partie de l'état de la partie : même graine + mêmes ordres = même partie.
- **Mode par tours (WEGO)**, optionnel : tours de 5 ou 10 minutes. Le joueur et l'IA ne donnent leurs
  ordres qu'entre deux tours ; un ordre émis en cours de tour est refusé. La résolution s'arrête
  exactement à la fin du tour.

## 2. Ordres et validation

Le joueur et l'IA agissent uniquement par des ordres (`CREATE_MISSION`, `CANCEL_MISSION`, `SET_ROE`,
`RTB_UNIT`, `MOVE_SHIP`, et depuis la phase 5 `LAND_ORDER`, `LAND_TROOPS`, `USE_EFFECT`, `SOF_INSERT`,
`SOF_EXTRACT` — sections 16 à 21). Un ordre refusé ne modifie rien. Motifs de refus : appareil d'un autre camp,
d'un type inadapté, détruit, endommagé, en maintenance, en panne ou pas encore remis en condition ; aucun
point ; point hors du théâtre ; altitude hors du domaine de vol ; horaire invalide ; hors rayon d'action ;
piste inconnue ou qui n'est pas une défense sol-air identifiée (attaque) ; appareil à escorter invalide ;
emport inconnu ou changement d'emport en vol ; aucune munition air-surface ; destination navale hors de la
zone de manœuvre ; ordre hors phase de planification (mode par tours).

Un camp confié à l'IA ne reçoit d'ordres que de l'IA. En partie à deux joueurs (section 26), aucun camp ne
lui est confié : chaque joueur commande le sien, et c'est le serveur qui vérifie que nul ne commande l'autre.

**Rayon d'action** : carburant de l'aller jusqu'au premier point et du retour, +10 %, + réserve finale de
5 %. Si le ravitaillement est autorisé et qu'un ravitailleur ami est en vol avec du carburant à céder, la
mission est aussi acceptée si l'appareil peut rejoindre le ravitailleur puis, avec les pleins, aller à la
cible et rentrer.

**Délai de mise en œuvre** : un appareil au sol ne décolle pas avant `120 s × (0,5 + centralisation)`
après l'ordre (paramètre de doctrine). Un appareil déjà en vol est réaffecté immédiatement.

**Estimation** : avant de valider, le planificateur donne pour l'appareil le plus contraint l'heure de
départ, le transit, le carburant à l'arrivée et l'autonomie sur zone sans ravitaillement.

## 3. Missions

| Mission | Appareils | Comportement |
|---------|-----------|--------------|
| Patrouille (CAP) | chasseurs | tient une station (un point = circuit d'attente automatique), poursuit dans la limite de sa laisse |
| Interception | chasseurs | rejoint et engage la piste désignée |
| Balayage | chasseurs | parcourt une route une seule fois en poursuivant autour de lui-même, puis rentre |
| Escorte | chasseurs | suit un aéronef ami, engage ce qui le menace à moins de 100 km ; prend fin si le protégé se pose ou est perdu |
| Attaque des défenses (SEAD) | chasseurs en emport air-surface | attaque par passes le site sol-air ou le bâtiment désigné, puis rentre munitions épuisées |
| Appui aérien rapproché | chasseurs en emport air-surface | tient une zone d'appui et frappe les formations adverses repérées (section 18) |
| Surveillance aérienne | avion-radar | tient une station |
| Ravitaillement | ravitailleur | tient une station |
| Reconnaissance | drone | tient une station d'observation optronique |

**Formation** : les appareils d'une mission volent en ligne de front, décalés de 3 km par rang
perpendiculairement à l'axe base → station.

## 4. Emports et munitions

- Un chasseur porte un emport : « air-air » ou « air-surface » (moins de missiles air-air, quatre munitions
  air-surface). Les nombres sont des valeurs de jeu.
- Une mission SEAD impose l'emport air-surface ; les autres gardent l'emport en cours, sauf demande
  explicite. Changer d'emport n'est possible qu'au sol : l'ancien retourne au stock de la base, le nouveau
  en sort, et l'appareil est immobilisé **10 minutes**.
- Stocks de base distincts : missiles air-air et munitions air-surface. Un stock insuffisant est réparti
  entre les appareils de la mission. La remise en condition réarme selon l'emport en cours.

## 5. Mouvement et carburant

- Terre sphérique (rayon 6 371 km), trajectoires orthodromiques.
- Deux régimes : croisière et rapide. Le régime rapide est pris en poursuite (à moins de 160 km de la
  cible et au-delà de la moitié de la portée de tir), par un moyen de soutien qui se replie, par une
  escorte qui rejoint, ou en transit si la mission le prescrit.
- Consommation par minute selon le régime ; ×1,5 en dessous de 3 000 m.
- **Bingo** : retour à la base dès que le carburant restant ≤ carburant du trajet retour × 1,25 + 5 % de la
  capacité. Si le ravitaillement est autorisé et qu'un ravitailleur est joignable, l'appareil va
  ravitailler au lieu de rentrer. Panne sèche = perte de l'appareil.
- **Ravitaillement** : déclenché sous 35 % de carburant ; transfert de 900 kg/min à moins de 5 km du
  ravitailleur, jusqu'à 97 % ; le carburant transférable du ravitailleur est une réserve distincte de son
  carburant de vol.

Simplifications : cap instantané (pas de rayon de virage), montée et descente instantanées, pas de vent,
pas de profil de consommation selon la masse.

## 6. Disponibilité

- Atterrissage : remise en condition (25 min pour un chasseur), puis pleins et réarmement prélevés sur les
  stocks de la base.
- **Fiabilité** : à chaque atterrissage, tirage contre la fiabilité du matériel (0,9 pour un chasseur).
  En cas de panne, l'immobilisation s'allonge de 20 à 45 minutes.
- **Dommages** : un appareil endommagé est réparé en 3 heures, puis de nouveau disponible.
- Un scénario peut déclarer un appareil indisponible au départ pour une durée donnée.

## 7. Capteurs et brouillard de guerre

Toutes les 5 s, pour chaque unité adverse en service, un seul tirage, dans cet ordre :

1. **Radar** — impossible si le radar de l'observateur est coupé, si la cible est au-delà de la portée
   efficace `portée radar × signature^(1/4) × facteur météo`, au-delà de l'horizon radar
   `4,12 × (√h_capteur + √h_cible)` km, hors du secteur balayé (120° vers l'avant pour un radar de nez),
   ou si c'est une unité au sol. Sinon `p = 0,9 × (1 − (distance / portée efficace)³)`.
   Chaque détection ajoute `0,1 × (1 − distance / portée efficace)` à l'identification ; identification
   immédiate à moins de 25 km de jour, 7,5 km de nuit.
2. **Écoute des émissions** — tout radar qui émet (aéronef hors silence radar, bâtiment, site sol-air non
   neutralisé) peut être capté jusqu'à 1,2 fois sa propre portée radar, en visibilité directe, par les
   unités dotées d'un détecteur d'émissions (chasseurs, avions-radar, bâtiments). `p = 0,7` ; l'émetteur
   est reconnu après quatre détections. **Une piste connue par l'écoute seule ne permet pas le tir.**
3. **Optronique** — le drone repère et identifie d'emblée les unités de surface et au sol, même
   silencieuses, à moins de 70 km (42 km de nuit), `p = 0,6`.

**Silence radar** (option de mission) : l'appareil n'émet pas — il ne détecte rien par son propre radar et
n'est pas repérable à l'écoute ; il dépend de l'avion-radar ami pour voir et pour tirer.

**Vieillissement** : sans détection pendant 30 s, la piste devient « ancienne » ; sa position n'est plus
mise à jour et son incertitude croît (vitesse × âge). Abandon après 10 min (air) ou 30 min (surface). Un
site fixe vieillit mais n'est jamais abandonné.

**Constat de destruction** : la piste d'un site détruit n'est retirée que si un capteur optronique, ou un
appareil ami à moins de 25 km (7,5 km de nuit), est là pour le constater.

**Jour et nuit** : hauteur du soleil calculée au centre du secteur d'objectif (formules astronomiques
publiques) ; nuit en dessous de −6°.

Simplifications : liaison de données parfaite au sein d'un camp, pas de relief ni de masques, pas de
brouillage offensif, pas d'erreur de mesure, jour et nuit évalués en un seul point.

## 8. Engagement air-air et sol-air

**Règles d'engagement** (par mission ; les unités de surface appliquent celles de leur camp) :

| Règle | Autorise le tir sur |
|-------|---------------------|
| riposte seule | une piste qui a ouvert le feu |
| défensives | une piste identifiée hostile située dans le secteur d'objectif, à moins de 80 km du tireur, ou à moins de 80 km d'un moyen ami (soutien, navire, sol-air, base) |
| tir libre | toute piste identifiée hostile |

Une piste qui a ouvert le feu peut toujours être engagée en riposte, même non identifiée. Une piste non
identifiée, ancienne, ou sans **piste radar fraîche** n'est jamais engagée.

**Conditions de tir** : munition disponible, appareil non endommagé et non en ravitaillement, cible à moins
de 85 % de la portée, dans le secteur avant (chasseur) ou au-dessus de l'horizon de son propre radar
(surface), 20 s au moins depuis le tir précédent, deux missiles amis en vol au plus par cible. Une unité de
surface neutralisée ne tire pas.

**Probabilité de coup au but**, bornée à [0,05 ; 0,90] :

```
p = base × distance × équipage × autoprotection × surprise × cible × état
```

| Facteur | Valeur |
|---------|--------|
| base | 0,45 (air-air), 0,40 (sol-air) |
| distance | 1,15 − 0,5 × (distance de tir / portée) |
| équipage | 0,8 + 0,4 × niveau d'entraînement du tireur |
| autoprotection | 1 − contre-mesures de la cible |
| surprise | 1,25 si le camp visé ne tenait aucune piste fraîche sur le tireur, sinon 0,8 ; un tir sol-air est toujours détecté |
| cible | 1,4 pour un gros porteur, 1 pour un chasseur |
| état | 1,2 si la cible est déjà endommagée |

Un coup au but détruit la cible dans 65 % des cas, sinon l'endommage. Un second coup au but détruit
toujours.

## 9. Attaque des défenses sol-air (SEAD)

- Un chasseur en mission SEAD tire ses munitions air-surface sur la piste désignée (site sol-air ou
  bâtiment identifié) à moins de 85 % de leur portée (70 km, valeur de jeu), deux munitions en vol au plus
  par cible, vol à 1 800 km/h.
- Un site fixe peut être tiré sur renseignement ancien ; un bâtiment exige une position fraîche.
- **Passes de tir** : après avoir tiré, l'appareil s'éloigne jusqu'à 25 km au-delà de sa portée de tir
  tant qu'il ne peut pas tirer de nouveau, puis revient.
- Probabilité de coup au but : `0,5 × distance × équipage × (0,6 contre un bâtiment : défense rapprochée)
  × (0,6 sur renseignement ancien)`.
- Effets : coup au but décisif (une fois sur deux) → site détruit, ou bâtiment mis hors de combat (ni radar
  ni tir, mais à flot) ; sinon → neutralisation de **10 minutes** ; tir manqué → **2 minutes** de silence
  imposé. Une unité neutralisée ne détecte ni ne tire.
- Le résultat n'est connu du tireur que s'il peut être constaté (§7) ; sinon « résultat non observé ».

Simplifications : pas de frappe d'autres objectifs (bases, navires en tant que tels), pas de combat naval
de surface, pas de leurres ni de brouilleurs, pas de déplacement des sites sol-air.

## 10. IA tactique (équipages, commune aux deux camps)

Arbre de comportement à priorités, réévalué à chaque pas : retour base déjà décidé → dommages → plus de
mission → bingo → munitions utiles à la mission épuisées → repli d'un moyen de soutien menacé → ravitaillement
→ poursuite d'un hostile autorisé (autour de la station en patrouille, autour de soi en balayage, autour du
protégé en escorte, à 60 km en autodéfense sinon) → interception de la piste désignée → attaque du site
désigné → escorte → tenue de station ou suite de la route.

Laisse de patrouille : `60 + 120 × autonomie` km autour de la station. Repli d'un avion-radar, d'un
ravitailleur ou d'un drone : dès qu'un chasseur hostile est à moins de 140 km, et jusqu'à ce qu'il soit
à plus de 182 km.

## 11. Objectif et victoire

- À chaque seconde, le secteur appartient au camp dont seuls des chasseurs aptes au combat (en vol, non
  endommagés, armés en air-air) s'y trouvent ; CONTESTÉ si les deux ; s'il est vide, il reste acquis à son
  dernier détenteur.
- « Bouclier Atlantique » (90 min) : BLEU défend, gagne avec au moins 60 min de contrôle ; ROUGE gagne si
  BLEU en totalise moins de 45.
- « Brèche Boréale » (120 min) : ROUGE défend, gagne avec au moins 95 min ; BLEU gagne si ROUGE en totalise
  moins de 80.
- **Objectif terrestre** (« Tête de pont ») : seules comptent les formations de mêlée (infanterie,
  mécanisés, blindés, reconnaissance, génie) présentes dans la zone, en service et non rompues. Chaque camp
  y additionne la puissance de combat de ses formations (section 16) ; le camp dont le total atteint
  **1,5 fois** celui de l'adversaire tient la zone ; sinon elle est CONTESTÉE ; vide, elle reste à son
  dernier détenteur. La chasse n'y joue aucun rôle direct.
- « Tête de pont » (210 min) : BLEU défend la localité CHARLIE, gagne avec au moins 130 min de contrôle ;
  ROUGE gagne si BLEU en totalise moins de 115.
- Victoire « majeure » si le vainqueur a perdu au plus un chasseur.
- Pendant la partie, le joueur ne voit qu'un **contrôle estimé**, calculé avec ses seules pistes. Le décompte
  réel n'apparaît qu'au compte rendu.
- Estimation d'un objectif terrestre : chaque camp connaît l'état réel de ses formations, mais estime
  l'adversaire d'après ses pistes — une formation de mêlée identifiée à sa valeur nominale (infanterie 1,
  mécanisés 1,6, blindés 2,2, reconnaissance 0,6, génie 0,5), une piste non identifiée comme de
  l'infanterie. Une formation perdue de vue reste présumée là où elle a été vue pendant **10 minutes**
  (`groundTrackMemoryS`) : sans cette mémoire, l'estimation basculait à chaque observation manquée.

## 12. IA adverse (stratégique et opérative)

- Ne reçoit que l'image de son camp ; n'agit que par des ordres validés comme ceux du joueur.
- Attend 150 s que ses capteurs établissent une première image.
- **Stratégique** : compare les utilités des postures (patrouille permanente, patrouille renforcée, présence
  par rotation, balayage en masse, chasse aux moyens de soutien, repli) selon la doctrine, les pertes, le
  temps restant et le renseignement ; aléa selon la difficulté ; légère prime à la posture en cours.
- **Opératif** :
  - choix de station par utilité (menaces sol-air connues, couverture d'un navire ami, doctrine) ;
    changement de station si une menace est identifiée à proximité ; relèves anticipées ;
  - **attaque des défenses** qui mordent sur le secteur, si elle a des munitions air-surface : une seule
    attaque à la fois, à basse altitude si le rayon d'action le permet, en gardant toujours une paire pour
    le secteur ; avec assez de chasseurs, une paire **escorte l'attaque** ;
  - **séquencement** : si toutes les stations étudiées sont sous la menace, elle attend (une fois, 45 min au
    plus) l'effet de son attaque avant d'installer une patrouille ;
  - **escorte** d'un avion-radar ou d'un ravitailleur menacé — une seule à la fois, jamais avec sa dernière
    paire ;
  - passage en tir libre après un acte hostile constaté.
- **Interarmées** (objectif terrestre), toujours par des ordres validés et d'après la seule image du camp :
  - *challenger* : ses formations de mêlée attaquent la zone selon un axe d'approche stable ; artillerie,
    logistique et poste de commandement suivent à distance d'appui ; les itinéraires contournent la mer
    par quelques détours simples ;
  - *défenseur* : les formations de mêlée se répartissent autour du centre de la zone, face à la menace,
    et s'y retranchent ; celles du dehors y sont appelées, en attaque si une formation adverse y est
    repérée ; une formation fraîche, pas encore retranchée, contre-attaque ce qui a pénétré si sa doctrine
    est assez agressive ; artillerie et logistique se placent en arrière de la zone ;
  - une paire de chasseurs en emport air-surface est **réservée à l'appui aérien** (la moitié des
    chasseurs disponibles au plus) et lancée dès que des troupes amies sont au contact d'un adversaire
    repéré ;
  - le navire amphibie approche d'une plage et **met à terre** son renfort ;
  - dès qu'une de ses formations est au contact, elle emploie tous ses **effets** disponibles,
    perturbation et brouillage ;
  - l'**équipe spéciale** est infiltrée une fois, après 5 min si le camp tient des pistes terrestres,
    après 20 min sinon : le défenseur la place sur l'axe d'approche adverse, l'attaquant sur les
    arrières de la défense ; elle est rappelée 40 min avant la fin ;
  - au niveau *recrue*, l'IA n'emploie ni effets ni équipe spéciale ; au niveau *vétéran* seulement, son
    sous-marin va au-devant des bâtiments adverses repérés. L'IA ne manœuvre pas ses bâtiments de surface
    pour chercher le combat.
- **Difficulté** : ne modifie que l'aléa, la fréquence de décision, l'étendue des options étudiées et, au
  niveau vétéran, l'emploi du silence radar lorsque son avion-radar couvre la station et la chasse au
  sous-marin. Aucune visibilité ni ressource supplémentaire.
- Hypothèse de planification : l'IA suppose une portée de 80 km pour une défense sol-air adverse dont elle
  ignore les caractéristiques.
- **Réglages propres à un scénario** (éditeur de missions) :
  - *réglages de doctrine* : chacun des six paramètres du profil d'un camp peut être remplacé par une
    valeur de 0 à 100 % ; le profil lui-même n'est pas modifié ;
  - *posture initiale imposée* : le scénario peut imposer à l'IA d'un camp une posture de son rôle
    (défenseur : patrouille permanente, patrouille renforcée, repli ; challenger : présence par rotation,
    balayage en masse, repli) pendant une durée de 600 min au plus. Tant qu'elle court, la posture
    imposée remplace le choix par utilité ; à l'échéance, l'IA reprend la main. Le compte rendu la signale
    comme imposée. Sans effet si le camp est joué par un humain ;
  - ces réglages ne donnent à l'IA ni visibilité ni ressource : elle reste soumise aux mêmes ordres validés.

## 13. Équilibrage mesuré (IA contre IA)

| Scénario | Difficulté | Parties | BLEU | ROUGE | Indécis |
|----------|------------|---------|------|-------|---------|
| Bouclier Atlantique | standard | 60 | 33 | 26 | 1 |
| Bouclier Atlantique | vétéran | 40 | 24 | 16 | 0 |
| Brèche Boréale | standard | 30 | 5 | 17 | 8 |
| Brèche Boréale | vétéran | 20 | 6 | 3 | 11 |
| Tête de pont | standard | 30 | 13 | 12 | 5 |
| Tête de pont | vétéran | 16 | 10 | 2 | 4 |

« Brèche Boréale » est un assaut contre un secteur défendu : il est volontairement difficile pour
l'attaquant. « Tête de pont » est équilibré en difficulté standard ; au niveau vétéran, le sous-marin bleu
coule souvent le navire logistique et le navire amphibie rouges, ce qui favorise le défenseur. Les
campagnes des deux premiers scénarios donnent exactement les mêmes résultats qu'avant la phase 5. La phase 6
n'a touché à aucune règle de combat : les quatre mesures ci-dessus sont inchangées. Ces chiffres mesurent le jeu, pas la réalité ; ils se reproduisent avec
`pnpm sim --campaign N --scenario … --difficulty …`.

## 14. Contrôles de cohérence

Vérifiés à chaque pas par les tests (`checkInvariants`) : carburant et munitions jamais négatifs ni
supérieurs à la capacité ; stocks de base jamais négatifs ; déplacement par pas borné par la vitesse
(pas de téléportation) ; aucune unité hors service en mouvement ; aucune mission attribuée à un appareil
détruit ou en maintenance ; somme des temps de contrôle égale au temps écoulé ; toute piste rafraîchie est
justifiée par un radar, une écoute, une observation optronique ou un tir sol-air adverse ; bilan des
missiles air-air et des munitions air-surface tirés égal aux munitions manquantes. Depuis la phase 5 :
effectifs, moral, cohésion, fatigue, ravitaillement et retranchement d'une formation entre 0 et 1 ;
chargement d'un bataillon logistique dans sa capacité ; coque, missiles antinavires et torpilles d'un
bâtiment entre zéro et la dotation ; stock d'un dépôt jamais négatif ; une unité embarquée ou posée sur
un pont se déplace avec son bâtiment sans que cela compte pour une téléportation.

## 15. Scénarios personnels : ce que vérifie l'éditeur

Un scénario personnel est lu par le moteur exactement comme un scénario livré. Avant de le déclarer jouable,
l'éditeur contrôle :

- **la forme** : schéma versionné du jeu (identifiants, bornes numériques, durée, seuils de victoire) ;
- **la cohérence** : chaque unité appartient à un groupe de son camp ; un aéronef est rattaché à une base de
  son camp ; une unité de surface ou au sol a une position ; tout tient dans la région ; une patrouille
  navale reste dans la zone de manœuvre de son camp ; une posture imposée convient au rôle du camp ;
- **la cohérence interarmées** : une formation terrestre est à terre et un bâtiment en mer (masque
  terre-mer, section 22) ; une formation n'embarque que sur un bâtiment de son camp qui transporte des
  troupes, dans la limite de sa capacité ; une base portée l'est par un porte-avions ou un navire
  logistique de son camp, et n'accueille que des appareils embarquables, dans la limite du pont ; une
  équipe spéciale part d'une base à terre ; une escorte suit un bâtiment de son camp qui ne suit
  lui-même personne ; la fenêtre d'un satellite tient dans la durée du scénario ;
- **les missions initiales** : elles sont soumises au moteur, pour chaque camp joué, avec les mêmes règles
  que les ordres donnés en jeu (appareils du bon type, rayon d'action, altitude dans le domaine de vol) ;
- **des avertissements**, qui n'empêchent pas de jouer : camp sans chasseur ; secteur hors de portée des
  chasseurs d'un camp sans ravitailleur ; appareil en vol sans mission initiale (il rentre aussitôt) ;
  IA du challenger retenue au sol pendant tout le scénario ; pour un objectif terrestre, camp sans
  formation de mêlée (les avertissements sur la chasse ne s'appliquent alors pas).

Ce que l'éditeur **ne vérifie pas** : l'emplacement des bases et des zones navales (une base peut être
posée en mer, une zone navale à terre), la vraisemblance d'un ordre de bataille, l'équilibre du scénario. Pour ce dernier, le test rapide
joue une partie IA contre IA et `pnpm sim --file … --campaign N` en joue autant qu'on veut.

Les matériels ajoutés à la bibliothèque en phases 4 et 5 portent, comme les autres, des **valeurs de jeu** :
toutes sont étiquetées « estimation », aucune ne prétend décrire les performances réelles d'un appareil.
Les formations terrestres et les bâtiments sont des matériels **génériques**, sans équivalent réel.


## 16. Forces terrestres

Une formation (bataillon, groupe, compagnie, escadron) est un point sur la carte. Elle porte six jauges de
0 à 1 : **effectifs**, **moral**, **cohésion**, **fatigue**, **ravitaillement**, **retranchement**.

| Formation | Puissance de combat | Vitesse | Observation | Particularité |
|-----------|--------------------:|--------:|------------:|---------------|
| Infanterie | 1 | 15 km/h | 4 km | |
| Infanterie mécanisée | 1,6 | 30 km/h | 5 km | |
| Blindés | 2,2 | 35 km/h | 5 km | |
| Reconnaissance | 0,6 | 45 km/h | 12 km | |
| Génie | 0,5 | 25 km/h | 3 km | réduit de moitié la gêne du terrain et double le retranchement à moins de 5 km |
| Artillerie | 0,4 | 25 km/h | 3 km | appui indirect de puissance 1,4 jusqu'à 30 km |
| Logistique | 0,2 | 30 km/h | 3 km | transporte 120 points de ravitaillement |
| Poste de commandement | 0,2 | 30 km/h | 3 km | rayon de commandement de 60 km |

Seules les cinq premières sont des formations de mêlée : elles seules tiennent le terrain et comptent pour
le contrôle d'un objectif. Toutes ces valeurs sont des estimations de jeu, exprimées en « équivalent bataillon d'infanterie ».

- **Ordre** (`LAND_ORDER`) : une posture — déplacement, attaque, défense, décrochage, attente — et, pour les
  trois premières, un itinéraire de huit points au plus. L'itinéraire doit rester à terre : chaque segment
  est contrôlé contre le masque terre-mer ; il n'y a pas de recherche de chemin.
- **Délai de transmission** : `120 s × (0,5 + centralisation)`, multiplié par le facteur de commandement
  (section 20) et **doublé** hors du rayon d'un poste de commandement ami.
- **Mouvement** : vitesse × mobilité du terrain × (1 − 0,3 × fatigue), divisée par deux sans ravitaillement.
  En *déplacement*, la formation s'arrête à 6 km d'une formation adverse qui tient le terrain (zone de
  contrôle) ; en *attaque*, elle avance jusqu'au contact. Arrivée, l'attaquant passe en défense.
- **Observation** : une formation repère et identifie toute formation ou site sol-air adverse à moins de sa
  portée d'observation, multipliée par la dissimulation du terrain où se trouve la cible.
- **Combat**, chaque minute, entre formations distantes de moins de 4 km. La puissance d'une formation vaut
  `combat × effectifs × (0,4 + 0,6 × cohésion) × (0,5 + 0,5 × moral) × (1 − 0,4 × fatigue)`, réduite si le
  ravitaillement passe sous 25 %, multipliée par 0,8 hors commandement et par 0,3 si elle est rompue. Elle
  se répartit entre ses adversaires au contact. Chaque artillerie libre ajoute son appui sur la formation
  adverse au contact la plus proche à sa portée.
- **Pertes** par minute : `0,6 % × puissance reçue ÷ résistance`, à ±25 % d'aléa. La résistance vaut la
  puissance de base (0,5 au moins) ; immobile, elle est multipliée par la protection du terrain et par
  `1 + 0,6 × retranchement` ; en déplacement, par 0,8. Les pertes entament aussi le moral (×1,5) et la
  cohésion (×1,5 en mouvement).
- **Retranchement** : +1 % par minute en défense, perdu au premier mouvement.
- **Fatigue, moral, cohésion** : la fatigue monte au contact et en mouvement, redescend à l'arrêt ; moral et
  cohésion se refont hors du contact, deux fois plus vite en attente et sous commandement.
- **Rupture** : sous 25 % de moral ou 20 % de cohésion, la formation est rompue : elle décroche vers le
  poste de commandement ami le plus proche, perd son ordre en cours et ne peut plus attaquer. Elle se
  rallie hors du contact, à 45 % de cohésion et 35 % de moral.
- **Destruction** : sous 20 % d'effectifs.

## 17. Logistique et commandement

- **Consommation** par minute : 0,05 % à l'arrêt, 0,15 % en mouvement, 0,6 % au contact, 0,8 % pour une
  artillerie qui tire. Sous 25 %, la puissance de combat décroît ; à zéro, la vitesse est divisée par deux
  et l'artillerie se tait.
- **Dépôt** : toute base dont le stock de ravitaillement est positif, à terre ou portée par un navire
  logistique.
- **Bataillon logistique** : il se recharge à moins de 10 km d'un dépôt (10 points par minute, pris sur le
  stock), distribue aux formations amies à moins de 15 km (2 % par minute chacune, les plus démunies
  d'abord ; 100 points pour un plein), et fait seul la navette entre son point de distribution — la fin de
  son dernier itinéraire — et le dépôt le plus proche.
- **Commandement** : une formation hors du rayon de tout poste de commandement ami voit son délai d'ordre
  doubler, sa puissance réduite de 20 % et sa cohésion se refaire deux fois moins vite.

## 18. Appui aérien rapproché

- Une formation au contact d'un adversaire émet une **demande d'appui**.
- La mission d'appui tient une zone ; ses appareils frappent, à la munition air-surface, les formations
  adverses **repérées et identifiées** à moins de 25 km du centre de la zone, celles au contact de troupes
  amies d'abord. Sans piste, ils attendent.
- La probabilité de coup au but est celle d'un tir air-surface, réduite par la dissimulation du terrain de
  la cible et par une navigation par satellite dégradée. Un coup au but retire 10 % d'effectifs, 12 % de
  cohésion et 8 % de moral.
- Le résultat n'est connu du tireur que si un capteur ou une formation amie voit la cible.

## 19. Forces navales

| Bâtiment | Coque | Armement de jeu |
|----------|------:|-----------------|
| Frégate de défense aérienne | 2 | missiles sol-air, sonar 15 km |
| Frégate | 2 | missiles sol-air, 4 missiles antinavires de 120 km, sonar 25 km |
| Destroyer | 2 | missiles sol-air, 8 missiles antinavires de 150 km, sonar 30 km |
| Porte-avions | 4 | autodéfense, pont d'envol pour 12 appareils embarquables |
| Sous-marin | 1 | 6 torpilles de 15 km, sonar 35 km |
| Navire amphibie | 2 | autodéfense, transporte 2 formations |
| Navire logistique | 2 | dépôt flottant |

- **Déplacement** (`MOVE_SHIP`) : destination et trajet en mer, dans la zone de manœuvre du camp. Une
  **escorte** garde son poste autour de son chef de file, qui règle son allure sur 90 % de celle du plus
  lent ; un bâtiment avarié navigue à mi-vitesse.
- **Base portée** : le pont d'envol suit le porte-avions, avec ses appareils au parking ; le dépôt suit le
  navire logistique. Si le bâtiment est avarié, sa base ferme : ni décollage ni atterrissage, les
  appareils en vol sont déroutés vers une autre base. S'il coule, ce qu'il porte est perdu.
- **Détection** : un bâtiment de surface se voit au radar et à l'optronique ; un sous-marin, toujours en
  plongée, ne se détecte qu'au **sonar**. Un bâtiment de surface n'entend que les sous-marins, un
  sous-marin entend tout ce qui navigue. La portée d'écoute est multipliée par 1,5 si la cible file à
  plus de 15 km/h, par 0,6 si elle est immobile, par 2 pendant 10 minutes après un tir ; à portée, la
  détection réussit une fois sur quatre à chaque balayage.
- **Missiles antinavires** : salve de 2 sur la piste de bâtiment la plus proche, à 85 % de la portée au
  plus, si les règles d'engagement le permettent ; 3 minutes entre deux salves. Probabilité de coup au but
  0,6, multipliée par 0,6 si la navigation par satellite du tireur est dégradée et par 0,6 si la cible ou
  une escorte à moins de 15 km oppose une défense antimissile (un missile sol-air consommé).
- **Torpilles** : le sous-marin tire une salve de 2 sur une piste identifiée de bâtiment de surface à moins
  de 15 km ; 5 minutes entre deux salves ; probabilité 0,5 ; une torpille retire 2 points de coque, un
  missile 1. Un sous-marin n'engage pas un autre sous-marin.
- **Lutte anti-sous-marine** : frégates et destroyers engagent une piste sonar identifiée à moins de 20 km ;
  probabilité 0,35 ; 3 minutes entre deux tirs.
- **Avaries** : à la moitié de sa coque, un bâtiment est avarié — il ne tire plus, navigue à mi-vitesse et
  sa base ferme ; à zéro, il coule avec ses troupes embarquées et ses appareils au parking.
- **Débarquement** (`LAND_TROOPS`) : le navire à moins de 8 km de la plage, 20 minutes d'opération ; la
  formation arrive à terre avec 60 % de cohésion au plus. Interrompu si le navire s'éloigne ou est avarié.
- **Recomplètement à la mer** : à moins de 3 km d'un navire logistique, un bâtiment reçoit une munition par
  minute, prise sur le dépôt flottant.

## 20. Effets cyber et spatiaux (abstraits)

Rien ici ne décrit ni ne met en œuvre une attaque informatique : ce sont des jetons de jeu.

- Chaque camp a trois **services**, de niveau 0 à 1 : réseaux de commandement, liaisons par satellite,
  navigation par satellite. Un service est *dégradé* sous 50 %.
- Le scénario accorde à chaque camp de 0 à 5 **perturbations des réseaux adverses** et **brouillages des
  services spatiaux adverses**. Employer un effet (`USE_EFFECT`) ramène le ou les services visés à 30 %
  pendant `15 min × (1,5 − résilience du camp visé)`, puis ils remontent de `10 % × (0,5 + résilience)`
  par minute.
- **Conséquences** : le délai d'exécution des ordres, aériens et terrestres, est multiplié par
  `1 + 2 × (1 − niveau des réseaux)` ; navigation dégradée, les tirs air-surface et antinavires perdent
  40 % de leur probabilité ; liaisons dégradées, satellites et équipes spéciales ne transmettent plus rien.
- **Satellites d'observation** fictifs : pendant sa fenêtre, un satellite repère et identifie les
  formations, sites sol-air et bâtiments de surface adverses dans son empreinte — de jour, par temps
  assez clair, et si les liaisons de son camp ne sont pas dégradées. Il ne voit ni les sous-marins, ni les
  équipes spéciales, ni les aéronefs.

## 21. Opérations spéciales

- Une équipe part d'une base à terre. **Infiltration** (`SOF_INSERT`) vers un point à terre, à 400 km au
  plus : 10 minutes de préparation puis trajet à 180 km/h. Elle réussit 85 fois sur 100, moins si une
  formation adverse se trouve à moins de 5 km du point ; manquée, l'équipe rentre sans risque.
- **En observation**, elle repère et identifie ce qui se trouve dans son rayon (15 km) et signale par un
  compte rendu de renseignement les postes de commandement, bataillons logistiques, artilleries et sites
  sol-air qu'elle découvre. Invisible aux capteurs, elle risque chaque minute d'être **découverte** : 1 %,
  plus 5 % par formation adverse à moins de 5 km (une unité de reconnaissance compte double).
- **Exfiltration** (`SOF_EXTRACT`, ou d'office si elle est découverte) : elle réussit 90 fois sur 100,
  60 si l'équipe a été découverte ; sinon l'équipe est perdue. Rentrée, elle se reconditionne avant de
  pouvoir repartir.

## 22. Terrain et masque terre-mer

- **Masque terre-mer** : les terres émergées de Natural Earth au 1:50 000 000. Il décide où une formation
  peut aller, où un bâtiment peut naviguer, où une plage et un point d'infiltration sont valables. À cette
  échelle, les petites îles, les fjords étroits et le trait de côte fin n'existent pas.
- **Zones de terrain** : cercles décrits par le scénario ; ailleurs le terrain est ouvert.

| Terrain | Vitesse | Protection du défenseur immobile | Distance d'observation |
|---------|--------:|---------------------------------:|-----------------------:|
| Ouvert | ×1 | ×1 | ×1 |
| Zone urbaine | ×0,6 | ×1,5 | ×0,6 |
| Forêt | ×0,6 | ×1,3 | ×0,6 |
| Relief | ×0,4 | ×1,4 | ×0,8 |
| Marais | ×0,4 | ×0,9 | ×1 |

## 23. Analyse des opérations

L'analyse ne stocke rien pendant la partie : elle **re-simule** l'enregistrement (scénario, graine, ordres)
et relève ses mesures à chaque pas. Elle lit la vérité-terrain et n'est donc accessible qu'après la mission.

**Séries temporelles** (un échantillon par minute, plus l'état final), pour chaque camp :

| Mesure | Définition |
|--------|------------|
| Chasseurs disponibles | Chasseurs ni détruits ni en réparation |
| Chasseurs en vol | Chasseurs en l'air à cet instant |
| Qualité de l'image | Part des unités adverses en opération (en vol ou en service) que le camp tient en piste fraîche ; sans objet si l'adversaire n'a rien en opération |
| Effectifs à terre | Somme des effectifs des formations terrestres non détruites, troupes embarquées comprises |
| Coque des bâtiments | Somme des points de coque des bâtiments à flot |

**Tirs.** Chaque tir résolu est consigné par l'arbitre avec son camp, sa distance de tir, la portée de
l'arme, l'état d'alerte de la cible, sa probabilité, son tirage et son résultat. L'analyse en tire, par camp
et par arme : tirs, coups au but, destructions, et **coups au but attendus** — la somme des probabilités,
c'est-à-dire ce que le hasard devait donner en moyenne. L'écart entre obtenus et attendus mesure la chance.
Les tirs sont aussi répartis en trois tranches de distance (moins d'un tiers de la portée, d'un à deux
tiers, au-delà) et, pour l'air-air et le sol-air, selon que la cible était **alertée** (son camp tenait une
piste fraîche sur le tireur au moment du tir) ou **surprise**.

**Chaîne d'engagement.** Pour chaque destruction obtenue par un tir : première détection de la cible par le
camp qui l'a détruite (négative si elle figurait au renseignement initial), identification, premier tir,
destruction. Les délais médians « détection → premier tir » et « premier tir → destruction » sont donnés
par camp. Les pertes sans tir (panne sèche, attrition au sol, équipe spéciale perdue) n'y figurent pas.

**Missions aériennes.** Appareils affectés, heure du premier décollage, **temps sur zone** (secondes
pendant lesquelles au moins un appareil tenait la station — une patrouille qui passe du transit à la
poursuite n'en accumule pas), tirs et coups au but de ses appareils, pertes. Un tir est attribué à la
mission de son tireur à l'instant du tir.

**Moments clés** : premier contact et premier tir de chaque camp, chaque perte, chaque changement de
contrôle, débarquements, effets employés, formations rompues, fin de mission.

**Part du hasard.** La partie est rejouée avec d'autres graines — douze dans l'interface, dérivées de la
graine d'origine, toujours les mêmes pour une partie donnée : mêmes forces, mêmes ordres du joueur aux mêmes
instants, autres tirages. Le résumé donne les victoires par camp, le nombre de rejeux au même vainqueur et
l'étendue du contrôle du défenseur. **Limite** : les ordres ne s'adaptent pas à la nouvelle situation ; un
ordre devenu irrecevable (piste absente, appareil perdu) est ignoré et compté. Pour une partie entre IA,
c'est un tirage de Monte-Carlo exact.

## 24. Rejeu détaillé

Le rejeu re-simule la partie une fois, en gardant une image-clé toutes les cinq minutes et la position de
chaque unité en opération toutes les trente secondes. Consulter un instant re-simule au plus cinq minutes ;
la lecture en continu avance d'un état au suivant. L'état restitué est exactement celui de la partie
(empreinte identique, vérifiée par test).

- **Points de vue** : vérité-terrain des deux camps, ou image d'un camp — ses unités, ses pistes et leur
  fraîcheur, telles que `getSidePicture` les lui donnait à cet instant.
- **Chronologie** : contrôle réel du secteur et repères cliquables (pertes, changements de contrôle,
  débarquements, effets, formations rompues), filtrés par le point de vue.
- **Traces** : quinze dernières minutes de chaque unité visible.
- **Enregistrement** : un fichier ne contient que le scénario, les options et les ordres horodatés. À la
  relecture, le scénario est revalidé et les ordres ne sont contrôlés que dans leur forme : le moteur
  refuse de lui-même ceux qu'il ne peut pas exécuter, sans interrompre le rejeu.

## 25. Campagne

Une campagne est une suite de missions ; l'issue de chacune décide de la suivante. « Opération Vent du
Nord » enchaîne les trois scénarios livrés : si BLEU gagne le premier acte ou si le résultat est indécis,
il mène sa contre-offensive (acte II) avant l'acte III ; si ROUGE le gagne, il exploite aussitôt et la
campagne passe à l'acte III.

**Points** : victoire majeure 3, victoire mineure 2, résultat indécis 1 pour chaque camp. La campagne
revient au camp qui en totalise le plus.

**Reports d'une mission à la suivante** — valeurs d'équilibrage (classe 4), sans prétention de réalisme :

| Report | Règle |
|--------|-------|
| Aéronefs | Les aéronefs détruits s'ajoutent aux manquants du camp, par matériel. Entre deux missions, la moitié des manquants est remplacée, arrondie en faveur du camp (1 → 1, 2 → 1, 3 → 2). À la mission suivante, les derniers appareils de la dotation de ce matériel restent au sol, sans jamais amputer une dotation de plus de la moitié : un moyen unique (avion-radar, ravitailleur) revient toujours |
| Munitions | Réserve de théâtre initiale : 60 missiles air-air et 30 munitions air-surface par camp. Après chaque mission, la réserve perd ce qui a été tiré ou perdu avec son porteur (stocks des bases et emports des aéronefs, avant et après), puis reçoit 16 air-air et 8 air-surface. Si la réserve est inférieure aux stocks que le scénario prévoit dans les bases, ceux-ci sont réduits dans la même proportion |
| Expérience | Les équipages du vainqueur gagnent 0,05 d'entraînement pour les missions suivantes, 0,15 au plus en cumul |

Le scénario ainsi modifié est revérifié par le moteur avant d'être joué, comme un scénario d'auteur. La
graine de chaque mission est dérivée de celle de la campagne et du rang de la mission : une campagne se
rejoue à l'identique. Le joueur ne voit que ses propres moyens ; ceux de l'adversaire ne lui sont connus
que par le compte rendu des missions jouées.

## 26. Partie à deux joueurs

Les deux camps sont tenus par des joueurs ; aucune IA de commandement n'est créée (option `versus`). La
simulation tourne sur un **serveur de parties**, seul à détenir l'état ; chaque navigateur reçoit l'image
de son camp, les événements qu'il a le droit de voir et les fiches de ses seuls matériels — exactement ce
que reçoit l'IA en partie solitaire. La vérité-terrain n'est envoyée qu'à la fin, pour le compte rendu.

| Règle | Détail |
|-------|--------|
| Temps | La partie avance à **la plus lente des deux vitesses demandées** ; chacun peut donc mettre en pause |
| Mode par tours | À la fin de chaque tour, les deux demandes reviennent à la pause : la résolution suivante attend les deux joueurs |
| Absence | Tant qu'un joueur manque ou est déconnecté, le temps est arrêté. Il revient à sa place avec le jeton reçu à son installation, et retrouve tout son journal |
| Ordres | Un ordre n'atteint le moteur que s'il a la forme d'un ordre et vise le camp de son auteur ; il passe ensuite par la même validation qu'en partie solitaire |
| Vérification | Le planificateur interroge le serveur : la faisabilité et l'estimation affichées sont celles du moteur qui fait autorité |
| Fin | Les ordres des deux camps sont consignés : la partie se rejoue à l'identique à partir de son enregistrement |

Une partie abandonnée par ses deux joueurs est fermée après dix minutes. Rien n'est conservé sur disque.

## 27. Vue 3D

Vue complémentaire de la carte : la Terre devient une sphère, la caméra s'incline et tourne. Chaque mobile
en vol — unité amie, piste aérienne fraîche — est relié à sa projection au sol par une colonne dont la
hauteur est son altitude **multipliée par 12**, pour rester lisible à l'échelle d'un théâtre de plusieurs
centaines de kilomètres. En rejeu, les traces deviennent des rideaux qui montrent le profil de vol.

Le jeu n'embarque **aucun modèle d'altitude du terrain** : les zones de terrain du scénario sont dessinées
en volumes de hauteur conventionnelle (relief 1 800 m, ville 300 m, forêt 250 m, marais 40 m, exagérés de
même). C'est une représentation schématique du modèle de jeu, pas un relief réel. La vue 3D n'ajoute
aucune règle : tout ce qui s'y voit vient de la même scène que la carte 2D.
