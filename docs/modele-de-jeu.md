# WAR COMMAND — Modèle de jeu

Ce document décrit les règles réellement appliquées par le moteur, les probabilités utilisées et les
simplifications assumées, à l'issue de la phase 4. Tout ce qui suit est un **modèle ludique** : aucune
valeur ne prétend prédire l'efficacité réelle d'un système d'armes, d'une tactique ou d'une doctrine.

Les paramètres numériques sont regroupés dans `packages/simulation-core/src/rules.ts` (`DEFAULT_RULES`) et
peuvent être surchargés par un scénario (`rules`). Les valeurs des matériels sont dans
`packages/unit-database/src/index.ts`, chacune étiquetée « donnée publique » ou « estimation de jeu ».

## 1. Temps et ordre de résolution

- Pas fixe de **1 seconde** de simulation, indépendant de l'affichage.
- À chaque pas, dans cet ordre : missions → tactique → mouvement et carburant → capteurs (toutes les 5 s) →
  engagement → objectif → déclencheurs → IA (éveil toutes les 10 s).
- Un seul générateur pseudo-aléatoire (Mulberry32), trois flux : `sim`, `ai:BLUE`, `ai:RED`. Son état fait
  partie de l'état de la partie : même graine + mêmes ordres = même partie.
- **Mode par tours (WEGO)**, optionnel : tours de 5 ou 10 minutes. Le joueur et l'IA ne donnent leurs
  ordres qu'entre deux tours ; un ordre émis en cours de tour est refusé. La résolution s'arrête
  exactement à la fin du tour.

## 2. Ordres et validation

Le joueur et l'IA agissent uniquement par des ordres (`CREATE_MISSION`, `CANCEL_MISSION`, `SET_ROE`,
`RTB_UNIT`, `MOVE_SHIP`). Un ordre refusé ne modifie rien. Motifs de refus : appareil d'un autre camp,
d'un type inadapté, détruit, endommagé, en maintenance, en panne ou pas encore remis en condition ; aucun
point ; point hors du théâtre ; altitude hors du domaine de vol ; horaire invalide ; hors rayon d'action ;
piste inconnue ou qui n'est pas une défense sol-air identifiée (attaque) ; appareil à escorter invalide ;
emport inconnu ou changement d'emport en vol ; aucune munition air-surface ; destination navale hors de la
zone de manœuvre ; ordre hors phase de planification (mode par tours).

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
- Victoire « majeure » si le vainqueur a perdu au plus un chasseur.
- Pendant la partie, le joueur ne voit qu'un **contrôle estimé**, calculé avec ses seules pistes. Le décompte
  réel n'apparaît qu'au compte rendu.

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
- **Difficulté** : ne modifie que l'aléa, la fréquence de décision, l'étendue des options étudiées et, au
  niveau vétéran, l'emploi du silence radar lorsque son avion-radar couvre la station. Aucune visibilité ni
  ressource supplémentaire.
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

« Brèche Boréale » est un assaut contre un secteur défendu : il est volontairement difficile pour
l'attaquant. Ces chiffres mesurent le jeu, pas la réalité ; ils se reproduisent avec
`pnpm sim --campaign N --scenario … --difficulty …`.

## 14. Contrôles de cohérence

Vérifiés à chaque pas par les tests (`checkInvariants`) : carburant et munitions jamais négatifs ni
supérieurs à la capacité ; stocks de base jamais négatifs ; déplacement par pas borné par la vitesse
(pas de téléportation) ; aucune unité hors service en mouvement ; aucune mission attribuée à un appareil
détruit ou en maintenance ; somme des temps de contrôle égale au temps écoulé ; toute piste rafraîchie est
justifiée par un radar, une écoute, une observation optronique ou un tir sol-air adverse ; bilan des
missiles air-air et des munitions air-surface tirés égal aux munitions manquantes.

## 15. Scénarios personnels : ce que vérifie l'éditeur

Un scénario personnel est lu par le moteur exactement comme un scénario livré. Avant de le déclarer jouable,
l'éditeur contrôle :

- **la forme** : schéma versionné du jeu (identifiants, bornes numériques, durée, seuils de victoire) ;
- **la cohérence** : chaque unité appartient à un groupe de son camp ; un aéronef est rattaché à une base de
  son camp ; une unité de surface ou au sol a une position ; tout tient dans la région ; une patrouille
  navale reste dans la zone de manœuvre de son camp ; une posture imposée convient au rôle du camp ;
- **les missions initiales** : elles sont soumises au moteur, pour chaque camp joué, avec les mêmes règles
  que les ordres donnés en jeu (appareils du bon type, rayon d'action, altitude dans le domaine de vol) ;
- **des avertissements**, qui n'empêchent pas de jouer : camp sans chasseur ; secteur hors de portée des
  chasseurs d'un camp sans ravitailleur ; appareil en vol sans mission initiale (il rentre aussitôt) ;
  IA du challenger retenue au sol pendant tout le scénario.

Ce que l'éditeur **ne vérifie pas** : la nature du terrain (une base peut être posée en mer, une zone navale
à terre), la vraisemblance d'un ordre de bataille, l'équilibre du scénario. Pour ce dernier, le test rapide
joue une partie IA contre IA et `pnpm sim --file … --campaign N` en joue autant qu'on veut.

Les matériels ajoutés à la bibliothèque en phase 4 portent, comme les autres, des **valeurs de jeu** : toutes
sont étiquetées « estimation », aucune ne prétend décrire les performances réelles de l'appareil.

