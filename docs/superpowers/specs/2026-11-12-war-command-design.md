# WAR COMMAND — Dossier de conception (phase 1) et tranche verticale (phase 2)

- Date : 12 novembre 2026
- Statut : conception validée par le prompt maître ; tranche verticale en cours d'implémentation
- Portée de ce document : les huit livrables demandés par la « méthode de travail » (§21 du prompt maître)
- Document compagnon : [`docs/modele-de-jeu.md`](../../modele-de-jeu.md) — règles, probabilités et simplifications du moteur

> Avertissement permanent : WAR COMMAND est un jeu. Les valeurs, probabilités et comportements sont des
> **modèles ludiques documentés**. Ils ne constituent ni une prédiction de l'efficacité réelle d'un système
> d'armes, ni une reproduction de procédures opérationnelles. Les bases, unités et situations sont fictives.

## Décisions prises par l'implémenteur (à relire en priorité)

Le prompt maître laisse ces points ouverts ; ils ont été tranchés ainsi, et peuvent être révisés :

| # | Décision | Raison |
|---|----------|--------|
| D1 | Monorepo **pnpm workspaces** : 7 paquets de simulation purs + 1 application web | Séparation stricte règles / données / doctrine / IA / affichage, moteur exécutable sans navigateur |
| D2 | Seuls les modules **ayant un contenu réel** sont créés (pas de coquilles vides pour terre, mer, éditeur…) | Exigence « pas de fonctions fictives présentées comme terminées » |
| D3 | Fond de carte **embarqué** Natural Earth (domaine public, via `world-atlas`) ; aucune tuile en ligne dans la tranche | Fonctionne hors ligne, aucune clé d'API, licence claire. Satellite / relief / bathymétrie = phase ultérieure |
| D4 | **PostgreSQL, WebSocket, CesiumJS, Playwright non installés** à ce stade | Aucune fonction de la tranche n'en dépend ; sauvegarde = `localStorage` + fichier JSON versionné |
| D5 | Pas de temps fixe de **1 s** de simulation, horloge découplée de l'affichage | Reproductibilité ; ×100 reste trivial en charge de calcul |
| D6 | Le joueur ne voit que le **contrôle estimé** du secteur (d'après ses propres capteurs) ; le décompte réel est révélé au compte rendu | Sinon le tableau de score révélerait la présence d'unités ennemies non détectées |
| D7 | Scénario situé en **mer de Norvège** (est de l'Islande ↔ Jan Mayen), bases « Bouclier » et « Borée » fictives | Géographie réelle de l'Atlantique Nord, côte à l'ouest comme sur la maquette UX |
| D8 | Matériels sol-air et navals **génériques** (« Groupe sol-air moyenne portée », « Frégate de défense aérienne ») | Évite d'attribuer des performances inventées à des systèmes réels |
| D9 | L'« IA tactique » (comportements élémentaires) est **commune aux deux camps** ; le joueur commande au niveau opératif | Décision de conception n°1 du prompt : le joueur est un commandant d'opérations aériennes, pas un pilote |
| D10 | Une piste qui ouvre le feu peut toujours être engagée en riposte, même non identifiée | Sans cette règle, le camp le mieux renseigné tirait plusieurs salves sans réponse possible (constaté en campagne de test) |
| D11 | Avantage modéré au défenseur accepté (≈ 2 parties sur 3 en IA contre IA) | Proximité de la base, AWACS et ravitailleur : asymétrie voulue du scénario, mesurée et documentée |

---

## 1. Synthèse du concept

WAR COMMAND est un wargame interarmées moderne sur géographie réelle, centré sur le **commandement des
opérations aériennes**. Le joueur dirige une coalition depuis un centre d'opérations aériennes (AOC) :
il planifie des missions (type, appareils, route, altitude, créneau, règles d'engagement), les lance, puis
observe leur exécution dans un moteur de simulation autonome, face à un adversaire IA qui planifie et réagit
avec **le même niveau d'information que lui**.

Ce qui distingue le jeu :

1. **Planifier plutôt que piloter.** Le joueur fixe l'intention ; les équipages (IA tactique) exécutent :
   ils tiennent la station, poursuivent dans la limite d'une laisse, ravitaillent, rentrent au bingo.
2. **Un moteur explicite et rejouable.** Détection → identification → décision d'engagement → résolution →
   dommages → conséquences. Chaque étape est une règle documentée, testée et pilotée par une graine.
3. **Un brouillard de guerre structurel.** Chaque camp possède sa propre image de la situation. L'IA ne
   reçoit que cette image : elle ne peut pas tricher, par construction.
4. **Une doctrine paramétrable**, indépendante du camp et du matériel, dont chaque paramètre porte un niveau
   de fiabilité (doctrine publique / source secondaire / hypothèse / équilibrage).

Positionnement : plus accessible qu'une simulation professionnelle (pas de gestion radar par radar, pas de
pilotage), plus profond qu'un jeu de stratégie classique (carburant, créneaux, capteurs, horizon radar,
règles d'engagement, rotation des patrouilles).

Critère de réussite de la première version : *charger une mission aérienne, organiser ses forces, donner des
ordres sur la carte, affronter une IA autonome, observer les événements et obtenir un résultat cohérent et
reproductible.*

---

## 2. Architecture technique

### 2.1 Pile retenue (versions stables vérifiées le 12/11/2026)

| Brique | Version | Rôle | Licence |
|--------|---------|------|---------|
| TypeScript (strict) | 7.0 | Langage unique, moteur et interface | Apache-2.0 |
| pnpm workspaces | 10 | Monorepo | MIT |
| Zod | 4.6 | Validation des scénarios et sauvegardes | MIT |
| Vitest | 5.1 | Tests unitaires, de règles, d'IA et de reproductibilité | MIT |
| tsx | 4.23 | Exécution du moteur en ligne de commande (sans navigateur) | MIT |
| Next.js / React | 16.4 / 19.3 | Application web | MIT |
| MapLibre GL JS | 6.18 | Carte opérationnelle 2D | BSD-3-Clause |
| world-atlas + topojson-client | 2.0 / 3.1 | Fond de carte Natural Earth embarqué | ISC ; données domaine public |

Reportés (aucune dépendance installée tant qu'aucune fonction ne les utilise) : PostgreSQL (campagnes
persistantes, phase 6), WebSocket (multijoueur, phase 6), CesiumJS (globe 3D, phase 6), Playwright (tests de
bout en bout, phase 3). Aucune API payante, aucun service d'IA externe.

### 2.2 Modules

```
packages/
  simulation-core     Modèle d'état, horloge, RNG à graine, géodésie, journal d'événements,
                      image par camp (brouillard de guerre), arbres de comportement, invariants
  unit-database       Fiches matériels avec provenance de chaque valeur (publique / estimation de jeu)
  doctrine-engine     Profils de doctrine paramétrables, chaque paramètre classé 1 à 4
  air-operations      Règles : ordres, missions, mouvement, carburant, ravitaillement, capteurs,
                      engagement, dommages, IA tactique (comportements élémentaires)
  ai-commander        IA stratégique + opérative (utilités, génération et évaluation de plans)
  scenario-system     Schéma Zod versionné, chargement, objectifs, déclencheurs, session de jeu
  replay-engine       Enregistrement des ordres, rejeu déterministe, empreinte d'état, compte rendu (AAR)
apps/web/src/
  world-map           Carte MapLibre, symboles, couches, outils (waypoints, mesure)
  user-interface      Écran AOC, planificateur, journal, compte rendu, menu, i18n (fr)
tools/                Exécution sans navigateur (`pnpm sim`)
```

Graphe de dépendances (aucun cycle, l'affichage n'est importé par aucun paquet de simulation) :

```
simulation-core ◄── unit-database
       ▲       ◄── doctrine-engine
       ├────────── air-operations
       │                ▲
       ├────────── ai-commander ──► doctrine-engine
       │                ▲
       └────────── scenario-system ──► unit-database, air-operations
                        ▲
                   replay-engine
                        ▲
                    apps/web
```

`mission-editor` a été créé en phase 4 (§10) ; il dépend de `scenario-system` et n'est importé que par
l'application et l'outil sans navigateur.

Modules du prompt maître **non créés** à ce stade, et pourquoi : `land-operations`, `naval-operations`,
`multi-domain-effects`. Le bâtiment naval et les groupes sol-air de la tranche sont des
plates-formes capteur + sol-air ; leur logique vit provisoirement dans `air-operations` et sera extraite en
phase 5. Les types d'état prévoient déjà les domaines `air`, `surface`, `ground`.

### 2.3 Principes structurants

- **État = données pures.** `SimState` est un objet JSON sérialisable (aucune classe, aucune fonction, aucun
  `Map`). Sauvegarder = sérialiser ; l'empreinte d'état = hachage du JSON.
- **Règles = systèmes.** Un pas de simulation applique une suite ordonnée de fonctions
  `(state, ctx) => void` : missions → tactique → mouvement/carburant → capteurs → engagement → objectifs →
  déclencheurs → IA.
- **Déterminisme.** Un seul générateur pseudo-aléatoire (Mulberry32) dont l'état est stocké dans `SimState`,
  en flux nommés (`sim`, `ai:BLUE`, `ai:RED`). Mêmes données + mêmes ordres + même graine = même résultat.
  Aucun `Math.random`, aucun `Date.now` dans les paquets de simulation.
- **Une seule porte d'entrée pour agir.** Le joueur et l'IA émettent des `Order` validés par la même fonction
  `validateOrder` (disponibilité, rayon d'action, cohérence). L'IA n'a aucun autre moyen d'agir.
- **Brouillard de guerre par construction.** `getSidePicture(state, side)` produit l'image d'un camp :
  ses unités, ses missions, ses contacts (sans identifiant de vérité-terrain), ses événements. L'IA a pour
  signature `decide(picture, memory, …)` : elle ne reçoit jamais `SimState`. L'interface en cours de partie
  n'affiche que l'image du joueur ; le mode observateur n'est accessible qu'après la mission.
- **Événements codés, texte côté interface.** Le moteur émet des codes (`CONTACT_IDENTIFIED`, …) avec
  paramètres et visibilité par camp ; l'interface les traduit (français aujourd'hui, autres langues demain).
- **Temps.** Pas fixe de 1 s. L'interface accumule le temps réel × vitesse (pause, ×1, ×5, ×20, ×100) et
  exécute le nombre de pas correspondant. Le mode WEGO est reporté (phase 3).

---

## 3. Modèle de données initial

Types principaux (définis dans `simulation-core/src/types.ts`) :

| Type | Contenu essentiel |
|------|-------------------|
| `SimState` | `time`, `endTime`, `rng`, `units`, `bases`, `missions`, `contacts[side]`, `shots`, `events`, `platforms`, `rules`, `objective`, `ai[side]`, `doctrine[side]`, `stats[side]`, `outcome` |
| `Unit` | camp, plate-forme, groupe, base, position WGS84, altitude, cap, vitesse, état (`ready`, `airborne`, `turnaround`, `maintenance`, `destroyed`, `active`), carburant, munitions, dommages, niveau d'équipage, tâche tactique courante |
| `PlatformPerf` | valeurs de jeu utilisées par le moteur : vitesses, carburant, consommation, portée et secteur radar, signature, portée et nombre de missiles, contre-mesures, délai de remise en condition |
| `Mission` | type (`CAP`, `INTERCEPT`, `AEW`, `TANKER`), appareils, waypoints, altitude, régime de vitesse, heure de lancement, fin de créneau, règles d'engagement, ravitaillement autorisé, contact cible, état (`planned`, `active`, `completed`, `cancelled`) |
| `Contact` | piste propre à un camp : identifiant local (`R01`), dernière position, cap, vitesse, première et dernière détection, progression d'identification, niveau (`detected`, `identified`), péremption, acte hostile |
| `Shot` | tireur, cible, arme, instants de tir et d'impact, facteurs de probabilité figés au tir |
| `SimEvent` | instant, code, visibilité par camp, paramètres |
| `SidePicture` | image d'un camp : unités et missions propres, `ContactView[]`, contrôle estimé, événements visibles |
| `Order` | `CREATE_MISSION`, `CANCEL_MISSION`, `SET_ROE`, `RTB_UNIT`, `MOVE_SHIP` |
| `Scenario` (Zod, `formatVersion: 1`) | identifiant, titre, description, région, date, période, météo, coalitions, groupes, bases, unités, stocks, missions initiales, renseignement initial, zones, objectif et conditions de victoire, déclencheurs, règles d'engagement par défaut, difficulté, graine, sources |
| `Recording` | scénario + options + ordres horodatés du joueur : suffit à rejouer une partie à l'identique |
| `SaveGame` | `Recording` + instantané de `SimState`, versionné |

Fiche matériel (`unit-database`) : chaque caractéristique est un couple
`{ valeur, provenance: 'publique' | 'estimation', source, confiance }`. Le moteur ne lit que la **valeur de
jeu** dérivée ; l'interface affiche la provenance. Aucune valeur n'est présentée comme une donnée réelle si
elle n'a pas de source publique identifiée.

Doctrine (`doctrine-engine`) : un profil est un ensemble de paramètres numériques (centralisation,
autonomie des subordonnés, masse, préservation des forces, tempo de replanification, laisse de poursuite),
chacun accompagné de son **classement** : 1 doctrine publique documentée, 2 interprétation d'une source
secondaire, 3 hypothèse de simulation, 4 équilibrage ludique.

---

## 4. Interfaces principales

Organisation conforme à la maquette UX fournie (thème sombre, tout en français).

**Menu principal** — choix du scénario, du camp (BLEU ou ROUGE), de la difficulté de l'IA, de la graine ;
reprise d'une sauvegarde locale ; import d'une sauvegarde JSON.

**Écran AOC (Air Operations Center)**

| Zone | Contenu |
|------|---------|
| Bandeau supérieur | Titre, contrôle du temps (pause, ×1, ×5, ×20, ×100), horloge Zulu, temps restant, état de la coalition (chasseurs disponibles / en vol / perdus), contrôle estimé du secteur, dernière alerte, menu (sauvegarder, exporter, quitter) |
| Panneau gauche | Arborescence des forces amies (groupes → unités, pastille d'état), liste des contacts adverses, recherche, filtres de domaine, couches (unités, contacts, routes, portées radar, zones sol-air, secteur, graticule) |
| Carte centrale | Fond Natural Earth, graticule WGS84, symboles inspirés des conventions publiques (cadre selon l'affiliation, lettre selon le rôle), vecteur de cap, routes de mission, secteur d'objectif, cercles de portée, tirs en cours, cercles d'incertitude des contacts périmés, coordonnées du curseur, outil de mesure |
| Panneau droit | Fiche de l'unité, de la mission ou du contact sélectionné ; planificateur de mission ; fiche matériel avec provenance des données |
| Panneau inférieur | Journal des opérations horodaté ; ordre de missions (tableau inspiré d'un ATO, adaptation ludique) ; légende des symboles |

**Planificateur de mission** — type, appareils disponibles, altitude, régime, heure de départ, fin de
créneau, règles d'engagement, ravitaillement ; les waypoints se posent en cliquant sur la carte ; le bouton
de validation appelle `validateOrder` et affiche le motif de refus le cas échéant (appareil indisponible,
hors rayon d'action, hors théâtre…). Aucun bouton n'est inactif : ce qui n'est pas implémenté n'est pas affiché.

**Compte rendu après action (AAR)** — résultat, minutes de contrôle réelles, chronologie du contrôle,
pertes, tirs et coups au but, carburant consommé, journal complet des deux camps, **décisions de l'IA avec
leurs utilités**, et mode observateur : carte en vérité-terrain avec curseur temporel (rejeu déterministe).

---

## 5. Premier scénario : « Bouclier Atlantique »

- **Lieu** : mer de Norvège, entre la côte est de l'Islande et Jan Mayen (géographie réelle).
- **Situation** : entièrement fictive. Une coalition BLEUE assure la police d'un secteur aérien, le
  « secteur ALPHA » (cercle de 110 km de rayon centré sur 67,0° N 11,0° O). Une coalition ROUGE entend en
  contester le contrôle.
- **Durée** : 90 minutes simulées, de 08:40 Z à 10:10 Z.
- **Bases fictives** : « Base Bouclier » (BLEU, côte est de l'Islande), « Base Borée » (ROUGE, Jan Mayen).

| Camp | Moyens |
|------|--------|
| BLEU | 4 Rafale (Escadron A), 1 E-3 (AWACS 01, en vol), 1 A330 MRTT (Tanker 01, en vol), 1 groupe sol-air moyenne portée près de la base, 1 frégate de défense aérienne en bordure sud-ouest du secteur |
| ROUGE | 4 Su-35S, 1 A-50U (en vol), 1 groupe sol-air longue portée à la base, 1 frégate en approche de la bordure nord-est |

- **Asymétrie voulue** : BLEU dispose d'un ravitailleur et d'une meilleure image aérienne, mais d'appareils à
  moindre autonomie ; ROUGE a plus de carburant et de portée radar de bord, mais vient de plus loin et sans
  ravitailleur. Aucun camp ne « gagne par sa fiche ».
- **Règle de contrôle** : à chaque seconde, le secteur est BLEU si seuls des chasseurs bleus aptes au combat
  s'y trouvent, ROUGE dans le cas symétrique, CONTESTÉ si les deux sont présents ; s'il est vide, il reste
  acquis à son dernier détenteur (BLEU au départ).
- **Victoire** : BLEU l'emporte avec au moins 60 minutes de contrôle ; ROUGE l'emporte si BLEU en totalise
  moins de 45 ; entre les deux, résultat indécis. Le niveau de victoire (majeure / mineure) dépend des pertes
  du vainqueur. La période va toujours à son terme : une fin anticipée par attrition a été essayée puis
  retirée, car elle donnait la victoire là où le décompte aurait conclu à un résultat indécis.
- **Mission initiale** : CAP-01, 4 × Rafale, départ 09:00 Z, règles d'engagement défensives — comme sur la
  maquette. Le joueur peut l'avancer, la scinder ou la remplacer.
- **Ce que le scénario démontre** : planification, déplacement, détection, brouillard de guerre, décisions de
  l'IA, consommation (carburant, missiles, ravitaillement), interactions (air-air, sol-air, navire-air,
  ravitaillement), conditions de victoire, compte rendu.

---

## 6. Risques techniques

| Risque | Gravité | Parade |
|--------|---------|--------|
| Non-déterminisme entre plates-formes (fonctions trigonométriques différentes d'un moteur JS à l'autre) | Moyenne | Reproductibilité garantie et testée sur une même plate-forme ; en multijoueur (phase 6), simulation autoritaire côté serveur |
| Dérive du périmètre (six domaines, éditeur, 3D) | Haute | Phases strictes ; un module n'existe que s'il a un contenu testé |
| IA perçue comme tricheuse ou passive | Haute | L'IA ne reçoit que `SidePicture` ; test dédié ; journal de décisions consultable après mission |
| Équilibrage : un camp gagne systématiquement | Moyenne | Campagne de parties IA contre IA sur plusieurs graines en test ; paramètres regroupés dans `rules` |
| Données matériels contestables | Moyenne | Provenance et niveau de confiance par valeur ; matériels génériques quand la source manque |
| Affirmations doctrinales non sourcées | Moyenne | Classement 1 à 4 obligatoire ; aucune hypothèse présentée comme doctrine officielle |
| Performance à ×100 avec davantage d'unités | Faible aujourd'hui | Capteurs échantillonnés toutes les 5 s ; index spatial à prévoir au-delà de ~200 unités |
| Fond de carte grossier au zoom tactique (Natural Earth 1:50 M) | Faible | Couches en ligne optionnelles en phase 3 (tuiles libres, licence à vérifier une à une) |
| Compatibilité des versions très récentes (TypeScript 7, MapLibre 6, Next 16) | Moyenne | Versions figées par le fichier de verrouillage ; vérification par compilation, tests et essai réel dans le navigateur |
| Trajets navals traversant la terre | Moyenne | Dans la tranche, déplacement naval limité à une zone de manœuvre maritime définie par le scénario |

---

## 7. Plan d'implémentation ordonné

Phase 1 et 2 (ce lot) :

1. Socle : monorepo, TypeScript strict, Vitest.
2. `simulation-core` : RNG, géodésie, types, événements, image par camp, invariants.
3. `unit-database`, `doctrine-engine` : données et provenance.
4. `air-operations` : ordres et validation → missions → tactique → mouvement et carburant → capteurs →
   engagement.
5. `scenario-system` : schéma, chargement, objectifs, déclencheurs, session ; scénario « Bouclier Atlantique ».
6. `ai-commander` : niveaux stratégique et opératif.
7. `replay-engine` : enregistrement, rejeu, empreinte, compte rendu.
8. Exécution sans navigateur (`pnpm sim`) et tests de reproductibilité.
9. Application web : carte, écran AOC, planificateur, sauvegarde, compte rendu, mode observateur.
10. Vérification réelle dans le navigateur, puis documentation des limites.

Phases 3 (simulation aérienne approfondie) et 4 (éditeur de missions) : réalisées, voir §9 et §10.
Phases suivantes (non commencées) : 5 interarmées ; 6 fonctions avancées.

---

## 8. Matrice de tests et critères de validation

| Domaine | Test | Critère |
|---------|------|---------|
| RNG | Même graine → même suite ; flux indépendants | Égalité stricte |
| Géodésie | Distances et caps sur des cas connus ; horizon radar | Écart < 0,5 % |
| Ordres | Appareil indisponible, détruit, d'un autre camp, hors rayon d'action, hors théâtre | Ordre refusé avec le bon motif, état inchangé |
| Mouvement | Déplacement par pas ≤ vitesse max × dt | Aucune téléportation sur une partie complète |
| Carburant | Jamais négatif ; retour au bingo ; panne sèche = perte | Invariants vérifiés à chaque pas |
| Ravitaillement | Transfert borné par le stock du ravitailleur | Conservation de la masse de carburant transférée |
| Capteurs | Hors portée ou sous l'horizon → jamais détecté ; secteur radar | Probabilité nulle |
| Brouillard | L'image d'un camp ne contient aucune unité adverse non détectée, ni identifiant de vérité-terrain | Test structurel sur partie complète |
| Engagement | Pas de tir sans munition, hors portée, ou contraire aux règles d'engagement | Aucun tir émis |
| IA | N'émet que des ordres valides ; insensible à une unité adverse non détectée ; réagit aux pertes | Tests dédiés |
| Scénario | Le scénario livré passe le schéma ; un scénario corrompu est refusé | Validation Zod |
| Reproductibilité | Trois exécutions complètes, même graine | Empreintes d'état et journaux identiques |
| Rejeu | Rejeu d'un enregistrement avec ordres du joueur | Empreinte identique à la partie d'origine |
| Partie complète | IA contre IA jusqu'à 90 min sur plusieurs graines | Un résultat est produit, invariants respectés |
| Interface | Parcours réel dans le navigateur : lancer, planifier, accélérer, sauvegarder, terminer | Vérification manuelle outillée, consignée dans le README |

Commandes : `pnpm test` (tests), `pnpm typecheck` (typage strict), `pnpm sim` (partie sans navigateur),
`pnpm dev` (jeu).

---

## 9. Phase 3 — Simulation aérienne approfondie (réalisée le 12/11/2026)

Le prompt maître définit la phase 3 par thèmes ; voici ce que chacun est devenu, et les choix faits.

| Thème du prompt | Réalisation |
|-----------------|-------------|
| Missions spécialisées | Balayage, escorte, attaque des défenses sol-air (SEAD), reconnaissance par drone — en plus de la patrouille, de l'interception, de la surveillance et du ravitaillement |
| Formation des groupes | Composition libre des patrouilles, rang dans la formation, vol en ligne de front, réaffectation en vol |
| Carburant | Rayon d'action étendu par le ravitailleur, estimation de l'autonomie sur zone avant l'ordre |
| Disponibilité | Fiabilité par sortie, pannes, réparation des appareils endommagés, indisponibilité initiale ; emports et stocks par type de munition |
| Détection | Écoute passive des émissions radar, silence radar, capteur optronique, jour et nuit, constat de destruction |
| Interactions avec les défenses | Munitions air-surface, passes de tir, neutralisation temporaire ou destruction des sites, mise hors de combat des bâtiments |
| IA aérienne améliorée | Attaque des défenses qui couvrent le secteur, escorte de l'attaque et des moyens de soutien, attente de l'effet de l'attaque, silence radar au niveau vétéran |
| Mode WEGO (§13 du prompt) | Tours de 5 ou 10 minutes, ordres simultanés, l'IA y est soumise comme le joueur |
| Exemples de missions (§11) | Second scénario, « Brèche Boréale » |

### Décisions prises par l'implémenteur

| # | Décision | Raison |
|---|----------|--------|
| D12 | La munition air-surface est **abstraite** (une seule famille, portée de jeu de 70 km) | Ne pas attribuer de performances inventées à des armements réels ; elle surclasse les défenses de courte et moyenne portée, pas la longue portée |
| D13 | Une piste connue par la seule écoute **ne permet pas le tir** | Donne tout son prix à la piste radar et à l'avion-radar ; rend le silence radar utile et risqué |
| D14 | Le résultat d'une attaque n'est connu que s'il est **constaté** | Cohérent avec le brouillard de guerre ; donne un rôle au drone |
| D15 | Un bâtiment touché est **mis hors de combat, pas coulé** | Le combat naval est hors périmètre jusqu'à la phase 5 |
| D16 | Le rayon d'action tient compte d'**un** ravitailleur, sur l'aller seulement | Règle simple, vérifiable, suffisante pour rendre les cibles lointaines accessibles |
| D17 | Jour et nuit évalués **au centre du secteur** | Un seul calcul par balayage ; suffisant à l'échelle d'un théâtre de quelques centaines de kilomètres |
| D18 | « Brèche Boréale » est **difficile pour l'attaquant** (BLEU gagne environ une partie sur six en IA contre IA) | Un assaut contre un secteur défendu ; l'équilibre est mesuré et documenté, les seuils de victoire en tiennent compte |
| D19 | Phase 3 développée **test d'abord** | Chaque règle a été précédée d'un test en échec. Tests, campagnes IA contre IA et essais dans le navigateur ont révélé plusieurs défauts corrigés : présence dans le secteur mal comptée par l'IA, attaque lancée sans escorte, chasseurs tous absorbés par l'escorte, patrouilles installées sous le feu des défenses, va-et-vient d'un moyen de soutien en repli |

### Reporté

Relief et masques de terrain (aucune donnée d'altitude embarquée), météo dynamique, brouillage offensif,
frappe d'autres objectifs, patrouille maritime, transport, recherche et sauvetage, tests de bout en bout
Playwright, couches cartographiques en ligne.

### Matrice de tests ajoutée

| Domaine | Test | Critère |
|---------|------|---------|
| Astronomie | Hauteur du soleil sur des cas connus (équinoxe, solstices, soleil de minuit, nuit polaire) | Écart < 1° |
| Formation | Appareils d'une mission jamais confondus ni dispersés | Entre 1 et 12 km |
| Disponibilité | Panne, réparation, indisponibilité initiale | Durées exactes, ordre refusé avant la remise en ligne |
| Emports | Stocks prélevés et rendus, délai de changement, partage d'un stock insuffisant, refus en vol | Comptes exacts |
| Écoute et silence radar | Détection au-delà de la portée radar, limite du rayon d'écoute, silence, tir impossible sans piste radar | Tests dédiés |
| Optronique | Site silencieux repéré, portée de nuit, constat de destruction | Tests dédiés |
| Missions | Balayage, escorte, SEAD : comportement, fin de mission, validation | Tests dédiés |
| SEAD | Probabilités calculées à la main, destruction, neutralisation et reprise, tir manqué, bâtiment, dégagement, tir à distance de sécurité | Valeurs littérales |
| Planification | Estimation calculée à la main et confrontée au vol réel ; rayon d'action avec ravitailleur | Écart < 4 min |
| Mode par tours | Ordres et décisions de l'IA uniquement entre deux tours ; déterminisme | Tests dédiés |
| IA | Attaque, escorte, séquencement, silence radar, limites d'engagement | Ordres attendus, tous valides |
| Scénario 2 | Validité, parties complètes avec invariants, emploi réel des capacités, reproductibilité | Aucun ordre refusé |

---

## 10. Phase 4 — Éditeur de missions (réalisée le 12/11/2026)

Le prompt maître définit la phase 4 par cinq thèmes (§19) et détaille l'éditeur aux §11 et §16.

| Thème du prompt | Réalisation |
|-----------------|-------------|
| Bibliothèque de forces | 19 fiches classées par origine (occidentale, rouge, générique) puis par rôle ; neuf matériels ajoutés ; la palette de l'éditeur affiche rôle, origine et valeurs de jeu |
| Scénarios personnalisés | Éditeur accessible depuis le menu : région (cadrage libre de la carte), date et période, coalitions, doctrines et leurs réglages, bases, unités, groupes, positions, missions initiales et leurs points, patrouilles navales, objectif et conditions de victoire, renseignement initial, comportement initial de l'IA |
| Déclencheurs | Moteur d'événements sans code : cinq conditions (délai, pertes, entrée dans une zone, groupe indisponible, contrôle du secteur), deux actions (message, fin de mission), décrits en français |
| Import et export | Fichier JSON au format versionné du jeu ; import avec refus motivés ; duplication d'un scénario livré ou personnel |
| Tests de missions | Vérification en continu, test rapide IA contre IA dans l'éditeur, essai en jeu avec retour à l'éditeur, `pnpm sim --file` pour jouer ou mesurer un scénario exporté |

### Décisions prises par l'implémenteur

| # | Décision | Raison |
|---|----------|--------|
| D20 | La logique d'édition est un **paquet pur**, `mission-editor` : chaque geste est une fonction qui retourne un nouveau brouillon ou un refus motivé en français ; l'écran n'en contient aucune | Même séparation que le reste du projet ; tout se teste sans navigateur |
| D21 | Un brouillon **est** un scénario au format du jeu. Un brouillon encore sans unité s'enregistre, s'exporte et se réimporte, mais n'est pas jouable ; `checkScenario` est le seul juge | Pas de second format à maintenir ; ce que l'éditeur écrit est exactement ce que le moteur lit |
| D22 | La vérification **fait accepter les missions initiales par le moteur lui-même**, pour chaque camp joué | Un scénario déclaré valide ne peut pas échouer au lancement |
| D23 | Les incohérences sont **refusées au geste** plutôt que découvertes à la vérification : aéronef sans base, patrouille hors de la zone de manœuvre, zone retirée sous une patrouille, région qui laisserait un élément dehors | L'auteur apprend tout de suite pourquoi, là où il agit |
| D24 | « Comportement initial de l'IA » = **posture imposée** pendant une durée, choisie parmi celles du rôle du camp, et **réglages de doctrine** par scénario. Inverser le défenseur retire les postures imposées | Ce sont les deux leviers que l'IA possède réellement ; elle reste sans privilège et le compte rendu signale la posture « imposée par le scénario » |
| D25 | Missions initiales limitées aux **cinq types à station ou à route** | Interception, escorte et attaque des défenses visent une cible ou un protégé qui n'existe qu'en jeu |
| D26 | Le test rapide joue **une partie entière** avec contrôle des invariants à chaque pas, dans le navigateur | Moins d'une seconde de calcul ; l'auteur voit un résultat et sait que le moteur n'a rien violé |
| D27 | Scénarios personnels dans le **stockage local** (24 au plus) et en fichier ; l'import **n'écrase jamais** : un identifiant déjà pris reçoit un suffixe ; le fichier porte le nom du titre | Cohérent avec D4 ; aucun travail perdu par un import |
| D28 | Les neuf matériels ajoutés n'ont que des **valeurs de jeu étiquetées « estimation »** ; la doctrine reste indépendante du camp et du matériel | Exigence « pas de données techniques inventées » ; un camp bleu peut voler sur matériel « rouge » |
| D29 | **Aucun contrôle du terrain** dans l'éditeur | Le moteur n'embarque ni masque terre-mer ni relief ; c'est dit à l'auteur dans l'interface |
| D30 | Phase 4 développée **test d'abord** pour toute la logique ; l'écran est vérifié à la main | Deux écarts constatés et corrigés : trois opérations écrites avant leurs tests ont été supprimées et réécrites ; la patrouille navale, de même, après qu'un essai dans le navigateur a montré qu'elle était acceptée sans zone de manœuvre |

### Reporté

Plusieurs objectifs ou types d'objectif, plus de deux coalitions, actions de déclencheur supplémentaires
(renforts, changement de règles d'engagement), emports initiaux, réglage des règles du moteur depuis
l'éditeur, annulation des modifications, contrôle terre-mer, filtrage des matériels par période, tests de
bout en bout automatisés de l'écran.

### Matrice de tests ajoutée

| Domaine | Test | Critère |
|---------|------|---------|
| Scénario | Réglages de doctrine par camp ; posture initiale imposée, limitée au rôle, durée bornée | Schéma et effet en partie |
| IA | Posture imposée tenue puis relâchée à l'échéance ; consignée comme imposée | Tests dédiés |
| Bibliothèque | Toute fiche a une origine ; classement par origine puis par rôle ; valeurs de jeu toutes étiquetées | Tests dédiés |
| Édition | Bases, groupes, unités, missions, objectif, zones, déclencheurs, renseignement : ajout, modification, suppression, cascades | Brouillon d'origine jamais modifié |
| Refus | Les refus portent un message en français qui nomme la cause | Les principaux messages sont contrôlés |
| Patrouille navale | Confinée à la zone de manœuvre ; zone ni retirée ni déplacée sous une patrouille | Tests dédiés |
| Région | Recadrage accepté si tout y tient ; refus nommant ce qui resterait dehors | Tests dédiés |
| Inversion des rôles | Les postures imposées sont retirées, le scénario reste valide | Aucune erreur à la vérification |
| Vérification | Scénario vide, mission initiale hors rayon d'action, avertissements (pas de chasseur, secteur hors de portée, appareil en vol sans mission, challenger retenu au sol) | Messages attendus |
| Test rapide | Partie complète, aucun invariant violé, résultat reproductible | Empreinte identique à graine égale |
| Import et export | Aller-retour à l'identique ; brouillon incomplet accepté ; fichier illisible, sauvegarde de partie, autre version, forme incorrecte refusés | Tests dédiés |
| Sans navigateur | Scénario livré exporté puis rejoué par `pnpm sim --file` | Même empreinte d'état que l'original |

