# WAR COMMAND — Dossier de conception (phase 1) et tranche verticale (phase 2)

- Date : 12 novembre 2026
- Statut : phases 1 à 6 réalisées (bilans des phases 3 à 6 aux §9 à §12) ; les sections 1 à 8 décrivent la
  conception d'origine et la tranche verticale
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

Ajouté en phase 6 : `ws` 8.23 (MIT), serveur WebSocket de la partie à deux joueurs. Envisagés par le
prompt maître et **non retenus** (§12) : CesiumJS — MapLibre, déjà présent, affiche le globe ; PostgreSQL —
aucune fonction du jeu n'a besoin d'une base de données. Toujours reporté : Playwright (tests de bout en
bout de l'écran). Aucune API payante, aucun service d'IA externe.

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

`campaign-system` et `net-play` ont été créés en phase 6 (§12) : le premier dépend de `scenario-system` et
de `mission-editor`, le second de `scenario-system` et de `replay-engine`. Aucun des deux ne connaît le
navigateur ; le transport WebSocket et son minuteur sont dans `tools/`.

`land-operations`, `naval-operations` et `multi-domain-effects` ont été créés en phase 5 (§11). Ils
dépendent de `simulation-core` et de `air-operations` (observation, tirs, destruction d'unité) ;
`ai-commander` et `scenario-system` en dépendent. Le sol-air et le déplacement des bâtiments, écrits dès la
tranche verticale, sont restés dans `air-operations` : les extraire aurait déplacé du code éprouvé sans
rien changer au jeu.

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
Phases 5 (interarmées) et 6 (fonctions avancées) : réalisées, voir §11 et §12.

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


## 11. Phase 5 — Interarmées (réalisée le 13/11/2026)

Le prompt maître définit la phase 5 par six thèmes (§19) et les détaille aux §6, §7 et §8.

| Thème du prompt | Réalisation |
|-----------------|-------------|
| Forces terrestres | Huit types de formation ; effectifs, moral, fatigue, cohésion, ravitaillement, retranchement ; cinq postures ; terrain, zones de contrôle, rupture et ralliement ; combat par attrition, appui d'artillerie ; demande et réception d'un appui aérien rapproché (neuvième mission aérienne) |
| Forces navales | Porte-avions et aviation embarquée, frégates, destroyers, sous-marins, navires amphibies et logistiques ; groupes et escortes ; écoute sous-marine, missiles antinavires, torpilles, lutte anti-sous-marine, défense rapprochée, avaries ; débarquement ; recomplètement à la mer |
| Logistique | Dépôts à terre et flottants, bataillons logistiques en navette, consommation selon l'activité, effets du manque de ravitaillement |
| Commandement | Délai de transmission des ordres selon la doctrine, l'état des réseaux et la proximité d'un poste de commandement ; effets d'une formation hors commandement |
| Effets cyber et spatiaux abstraits | Trois services par camp (réseaux, liaisons, navigation), perturbation temporaire, résilience, rétablissement ; satellites d'observation fictifs à fenêtres de couverture |
| Opérations spéciales | Équipes spécialisées : infiltration, observation, comptes rendus de renseignement, découverte, exfiltration, résolution abstraite |

Troisième scénario livré : **« Tête de pont »** (est de l'Islande, 210 min), qui réunit toutes ces
composantes dans les deux camps. Situation, bases et unités fictives ; aucune position réelle de forces.

### Décisions prises par l'implémenteur

| # | Décision | Raison |
|---|----------|--------|
| D31 | Trois **paquets** nouveaux, chacun avec ses ordres et son système ; l'ordre de résolution devient air → terre → mer → effets → objectif → déclencheurs → IA | Noms imposés par le prompt (§15) ; séparation règles / IA / affichage conservée |
| D32 | Les nouveaux systèmes **ne font rien et ne tirent aucun nombre aléatoire** dans un scénario sans ces composantes | Les deux scénarios aériens et leurs campagnes de mesure se rejouent à l'identique (vérifié) |
| D33 | **Masque terre-mer** tiré de Natural Earth 1:50 000 000 (`world-atlas`, déjà présent pour la carte) : formations à terre, bâtiments en mer, itinéraires contrôlés segment par segment, sans recherche de chemin | Aucune dépendance nouvelle ; un refus motivé vaut mieux qu'un chemin deviné |
| D34 | Combat terrestre **abstrait** : une formation est un point, les pertes sont une attrition proportionnelle à la puissance reçue ; la puissance s'exprime en « équivalent bataillon d'infanterie » | Demandé « abstrait » par le prompt ; des valeurs relatives n'affirment rien sur des matériels réels |
| D35 | Formations et bâtiments sont des **matériels génériques**, sans équivalent réel, aux valeurs toutes étiquetées « estimation » | Exigence « pas de données techniques inventées » |
| D36 | **Objectif terrestre** : la zone revient au camp dont les formations de mêlée présentes pèsent 1,5 fois l'adversaire ; la simple présence ne suffit pas | Avec la seule présence, la zone restait « contestée » toute la partie |
| D37 | Estimation du contrôle : une formation perdue de vue reste **présumée sur place dix minutes** | Constaté en jouant : sans cette mémoire, l'estimation basculait à chaque observation manquée et le joueur croyait tenir une zone disputée |
| D38 | Cyber et espace : des **niveaux de service** et des **jetons** accordés par le scénario, aux effets temporaires sur les délais d'ordre, la précision des tirs guidés et la transmission du renseignement | Le prompt exclut toute fonction d'attaque informatique réelle ; le modèle ne décrit aucun système ni aucune technique |
| D39 | Une base peut être **portée par un bâtiment** (pont d'envol, dépôt flottant) : elle le suit, ferme s'il est avarié, disparaît s'il coule | Réutilise tout le modèle des bases (stocks, remise en condition, déroutement) sans cas particulier |
| D40 | L'IA interarmées est un **module à part** (`joint.ts`) qui rend des ordres ; elle réserve une paire de chasseurs à l'appui aérien avant que l'IA aérienne ne répartisse le reste | Constaté : sans réserve, l'IA aérienne engageait tous ses chasseurs et l'appui ne partait jamais |
| D41 | L'IA ne fait chasser son **sous-marin** qu'au niveau vétéran et ne manœuvre pas ses bâtiments de surface pour combattre | Choix de périmètre ; dit dans les limites — en difficulté standard, le combat naval vient du joueur |
| D42 | Format de **sauvegarde** porté à la version 2 ; une sauvegarde antérieure est refusée avec un message clair. Le format de **scénario** reste en version 1, avec des champs facultatifs | L'état a changé de forme ; les scénarios personnels de la phase 4 restent lisibles |
| D43 | **Éditeur** : toutes les composantes interarmées s'y règlent ; un porte-avions arrive avec son pont, un navire logistique avec son dépôt ; un onglet « Terrain » porte zones de terrain et satellites | Un scénario interarmées doit pouvoir être écrit sans toucher au JSON |
| D44 | Le réglage d'**entraînement** n'est plus proposé pour une formation terrestre ou une équipe spéciale | Il ne pèse que sur le tir des missiles : ailleurs, le curseur aurait été décoratif |

### Défauts trouvés en vérifiant, et corrigés

Escorte incapable de rejoindre son poste (le chef de file règle désormais son allure) ; unités de
reconnaissance de l'IA recevant des dizaines d'ordres contradictoires (axe stable, hystérésis) ; objectif
terrestre toujours contesté (D36) ; appui aérien jamais lancé par l'IA (D40) ; scénario déséquilibré dans
les deux sens avant réglage ; estimation du contrôle instable (D37) ; équipes spéciales rattachées à une
base trop lointaine pour arriver à temps ; compte rendu muet sur les pertes terrestres et navales ;
libellés de refus et accords du journal.

### Reporté

Recherche de chemin et réseau routier ; manœuvre offensive des bâtiments de surface par l'IA ; hélicoptères,
défense sol-air d'accompagnement, mines, frappe d'objectifs fixes, lutte antinavire aérienne dédiée ;
relief cartographié ; satellites radar ; plusieurs objectifs ; tests de bout en bout automatisés de l'écran.

### Matrice de tests ajoutée

| Domaine | Test | Critère |
|---------|------|---------|
| Masque terre-mer | Points à terre et en mer, antiméridien, trajets à terre et en mer, première côte | Tests dédiés |
| Bibliothèque | Fiches interarmées : valeurs toutes étiquetées, statistiques propres à chaque type | Tests dédiés |
| Mise en place | États terrestre, naval et spécial ; troupes embarquées ; bases portées ; services, effets, satellites ; refus du schéma (terre et mer, capacité, pont, escorte, fenêtre) | 13 tests |
| Ordres terrestres | Validation, délai de transmission, commandement, postures, itinéraire à terre | 11 tests |
| Session | Ordres de tous les paquets acheminés par la même porte, refus motivés, enregistrement et rejeu | 5 tests |
| Combat terrestre | Contact, attrition, terrain, retranchement, artillerie, logistique, rupture et ralliement, contrôle par rapport de forces, estimation et mémoire des pistes, invariants | 22 tests |
| Appui aérien | Demande, choix de cible, effets, terrain, navigation dégradée, constat | 8 tests |
| Naval | Escorte, base portée, déroutement, sonar, missiles antinavires et défense rapprochée, torpilles, lutte anti-sous-marine, avaries, débarquement, recomplètement | 19 tests |
| Effets et opérations spéciales | Jetons, durée selon la résilience, rétablissement, conséquences, satellites, infiltration, découverte, exfiltration, renseignement | 15 tests |
| IA interarmées | Attaque, défense, réserve d'appui, effets, équipe spéciale, débarquement, sous-marin, aucun ordre refusé | 10 tests |
| Scénario « Tête de pont » | Validité, composantes, géographie, partie complète sous invariants, reproductibilité, aucune fuite d'identifiant adverse | 7 tests |
| Compte rendu | Effectifs restants, coque, phase des équipes | 3 tests |
| Éditeur | Formations, bâtiments, escortes, embarquement, pont d'envol, dépôt flottant, équipes, dépôts, effets, objectif terrestre, terrain, satellites, brouillon complet joué au test rapide | 37 tests |
| Non-régression | Campagnes de 60 et 30 parties des deux premiers scénarios | Résultats identiques à ceux de la phase 4 |


## 12. Phase 6 — Fonctions avancées (réalisée le 13/11/2026)

Le prompt maître définit la phase 6 par cinq thèmes (§19).

| Thème du prompt | Réalisation |
|-----------------|-------------|
| Globe 3D | Vue 3D de la carte, en partie comme en rejeu : Terre sphérique, caméra libre, altitude des aéronefs et des pistes aériennes en volume, profil de vol des traces, terrain du scénario en volumes schématiques |
| Replay détaillé | Consultation à tout instant, lecture à trois vitesses, pas à pas, chronologie à repères cliquables, traces des unités, point de vue de l'arbitre ou d'un camp, fiche d'une unité à l'instant observé, relecture d'un enregistrement exporté |
| Campagnes persistantes | « Opération Vent du Nord » : trois actes enchaînés selon leur issue ; report des pertes d'aéronefs, des stocks de munitions et de l'expérience ; points ; enregistrement après chaque mission, suspension d'une mission, import et export |
| Multijoueur | Partie à deux joueurs : serveur de parties faisant autorité, WebSocket, brouillard de guerre préservé, temps continu ou par tours, reprise après déconnexion, compte rendu commun |
| Analyse approfondie des opérations | Séries temporelles du rapport de forces et de la qualité de l'image, efficacité des tirs et part de chance, distance de tir et surprise, chaîne d'engagement, bilan des missions, moments clés, sensibilité au hasard par rejeux ; aussi sans navigateur |

### Décisions prises par l'implémenteur

| # | Décision | Raison |
|---|----------|--------|
| D45 | **Globe 3D avec MapLibre**, sans CesiumJS | MapLibre 6, déjà installé, a une projection « globe », l'inclinaison et l'extrusion : une seconde bibliothèque de carte aurait dupliqué symboles, couches et interactions. Exigence « pas de dépendances non nécessaires » |
| D46 | La vue 3D est **une autre vue de la même scène** : aucune règle, aucune donnée nouvelle | Le prompt demande que la 3D ne bloque jamais la simulation ; la scène 2D porte déjà positions et altitudes |
| D47 | **Pas de relief réel** : les zones de terrain du scénario sont des volumes de hauteur conventionnelle, et c'est écrit sur la carte | Aucun modèle d'altitude n'est embarqué (D3) ; un relief en ligne aurait ajouté une dépendance réseau et une licence à vérifier. Présenter des volumes comme du relief aurait été une fonction fictive |
| D48 | Altitudes **exagérées douze fois** ; les symboles restent au sol, au pied de leur colonne | À l'échelle d'un théâtre de 600 km, 9 000 m sont invisibles. MapLibre ne place pas d'élément d'interface en altitude sans couche personnalisée : la colonne dit l'altitude, le symbole reste cliquable |
| D49 | L'analyse **re-simule** l'enregistrement et ne stocke rien pendant la partie | Même principe que le rejeu : la partie tient dans sa graine et ses ordres. Aucune mesure ne peut diverger de ce qui s'est joué |
| D50 | Chaque tir résolu porte ses **faits** (camp, distance, portée, alerte de la cible, coup au but), visibles du seul arbitre | L'analyse a besoin du camp et des conditions du tir ; l'événement n'étant pas visible des camps, il peut porter des identifiants de vérité-terrain sans rien révéler |
| D51 | La « part du hasard » rejoue **les mêmes ordres aux mêmes instants** avec d'autres graines, et le dit | Mesure simple et reproductible de la robustesse d'un plan. Sa limite — des ordres qui ne s'adaptent pas — est annoncée à côté du résultat |
| D52 | Le rejeu propose **le point de vue d'un camp**, par la même fonction que celle qui sert l'IA et l'écran de jeu | Voir ce que l'adversaire savait est la leçon la plus utile d'une partie ; aucune seconde logique de brouillard à maintenir |
| D53 | Un enregistrement relu est **revalidé pour le scénario, contrôlé en forme pour les ordres** ; un ordre illisible est refusé au rejeu sans l'interrompre | Le moteur est le seul juge d'un ordre ; un fichier altéré ne doit ni planter le jeu ni être deviné |
| D54 | Campagne = **données + fonctions pures** (`campaign-system`) ; le stockage est une affaire d'interface | Même séparation règles / persistance que le reste ; tout se teste sans navigateur |
| D55 | Les reports **modifient le scénario** de la mission suivante par les opérations de l'éditeur, puis le font revérifier par le moteur | Pas de second chemin vers l'état initial : une mission de campagne est un scénario comme un autre, rejouable et enregistrable tel quel |
| D56 | Reports limités aux **aéronefs, missiles et équipages**, avec des valeurs d'équilibrage (classe 4) | Ce sont les grandeurs communes aux trois scénarios. Une dotation n'est jamais amputée de plus de la moitié : une mission doit rester jouable |
| D57 | Persistance : **stockage local et fichiers JSON validés par schéma**, sans PostgreSQL | Un jeu solitaire dans un navigateur n'a pas de serveur de données ; l'imposer aurait rendu l'installation plus lourde sans rien apporter. Un état de campagne relu est revalidé (forme, version, campagne et mission connues) |
| D58 | Multijoueur : **simulation autoritaire sur un serveur**, les clients n'ont jamais l'état | Annoncé au §6 (déterminisme entre plates-formes) et seul moyen de garder le brouillard de guerre entre deux humains |
| D59 | Le salon (`net-play`) est **sans socket ni horloge** : il reçoit messages et durées, rend des messages | Tout le protocole se teste de façon déterministe ; le serveur n'est qu'un adaptateur d'une centaine de lignes, essayé à part avec de vraies connexions |
| D60 | Chaque joueur reçoit **l'image de son camp**, ses événements et les fiches de ses seuls matériels ; la vérité-terrain n'est envoyée qu'à la fin | Même contrat que l'IA. Les fiches adverses sont retirées : leur liste aurait révélé la dotation ennemie |
| D61 | Le temps avance à **la plus lente des deux vitesses demandées** ; il s'arrête si un joueur manque | Règle sans arbitre : chacun peut mettre en pause, personne ne peut accélérer seul |
| D62 | Le planificateur d'un joueur **interroge le serveur** (faisabilité, estimation) au lieu de valider localement | Le client n'a pas l'état : toute validation locale aurait été une seconde logique, ou une fuite |
| D63 | L'écran de jeu dépend d'une **interface commune** (`GameLink`) à la partie locale et à la partie en réseau | Un seul écran, deux sources ; la sauvegarde, l'avance manuelle et « rejouer » disparaissent là où ils n'ont pas de sens, au lieu de rester inactifs |
| D64 | Serveur en écoute sur **cette seule machine** par défaut ; `--lan` l'ouvre au réseau local. Taille des messages, débit et nombre de connexions bornés | Pas de chiffrement ni de comptes : ce n'est pas un service Internet, et c'est dit dans les limites |
| D65 | Le script s'appelle `pnpm serve` | `pnpm server` est une commande interne de pnpm : elle masquait le script sans rien lancer (constaté à l'essai) |
| D66 | Phase 6 développée **test d'abord** pour toute la logique ; écrans vérifiés à la main, graphiques soumis à un contrôle de palette | Les teintes des camps de l'interface sortaient de la bande de clarté conseillée sur fond sombre : les tracés utilisent des teintes assombries d'un cran, contrôlées |

### Défauts trouvés en vérifiant, et corrigés

Le test du temps sur zone supposait qu'une patrouille atteint toujours sa station : dans la partie d'essai
elle passait du transit à la poursuite (test corrigé, la mesure est documentée) ; `pnpm server` ne lançait
rien (D65) ; la légende de la vue 3D recouvrait le crédit de la carte ; les teintes des courbes (D66) ;
une ligne du README collée à la précédente.

### Reporté

Relief réel et couches cartographiques en ligne ; symboles placés en altitude ; éditeur de campagne et
campagnes à embranchements plus riches ; report des formations terrestres et des bâtiments ; plus de deux
joueurs, spectateurs, IA d'appoint en réseau, sauvegarde d'une partie en réseau, chiffrement et comptes ;
conservation des parties sur le serveur ; analyse comparée de plusieurs parties ; tests de bout en bout
automatisés de l'écran.

### Matrice de tests ajoutée

| Domaine | Test | Critère |
|---------|------|---------|
| Faits de tir | Numéro, camp, distance, portée, alerte, coup au but sur chaque tir résolu ; total par camp égal au bilan | 2 tests |
| Analyse | Séries (début, fin, état final, bornes, reproductibilité), engagements, distances et surprise, chaîne d'engagement, missions, moments clés, composantes interarmées | 13 tests |
| Sensibilité | Graine d'origine redonne le résultat d'origine ; graines distinctes et stables ; résumé | 3 tests |
| Rejeu détaillé | État identique à la re-simulation directe en avant, en arrière et pas à pas ; états rendus jamais modifiés ; journal ; traces | 6 tests |
| Enregistrement | Aller-retour à l'identique ; dix refus motivés ; ordre illisible refusé au rejeu sans l'interrompre | 12 tests |
| Deux joueurs (moteur) | Aucune IA, ordres des deux camps consignés, partie ordinaire inchangée, partie complète sans décision d'IA | 5 tests |
| Campagne | Cohérence de la campagne livrée, début, consignation d'une mission réellement jouée, points, refus, enchaînement, fin, reports (aéronefs, plancher, munitions, expérience), persistance et sept refus, campagne complète rejouée à l'identique | 27 tests |
| Salon | Création, arrivée, dix refus, scénario personnel, vitesse la plus lente, mode par tours, ordres et vérification, déconnexion, reprise, fermeture, brouillard de guerre sur une partie entière, sauvegarde finale rejouée à l'identique | 27 tests |
| Serveur | Vraies connexions WebSocket : état de santé, partie à deux, message illisible, message démesuré, inondation | 5 tests |
| Non-régression | Campagnes de mesure des trois scénarios | Résultats identiques à ceux de la phase 5 |
