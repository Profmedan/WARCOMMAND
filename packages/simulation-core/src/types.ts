/**
 * Modèle d'état de la simulation.
 *
 * Tout ce qui est ici est une donnée pure, sérialisable en JSON : aucune classe, aucune
 * fonction, aucun Map/Set. C'est ce qui rend la sauvegarde, le rejeu et l'empreinte d'état
 * triviaux et fiables.
 */
import type { Bounds, Circle, LatLon } from './geo';
import type { RngStreams } from './rng';

export type SideId = 'BLUE' | 'RED';
export const SIDES: readonly SideId[] = ['BLUE', 'RED'];

export function opponent(side: SideId): SideId {
  return side === 'BLUE' ? 'RED' : 'BLUE';
}

export type Domain = 'air' | 'surface' | 'ground';
export type UnitKind =
  | 'fighter'
  | 'aew'
  | 'tanker'
  | 'drone'
  | 'sam'
  | 'ship'
  // Formations terrestres (phase 5)
  | 'infantry'
  | 'mech'
  | 'armor'
  | 'artillery'
  | 'engineer'
  | 'recon'
  | 'logistics'
  | 'hq'
  | 'sof'
  // Bâtiments (phase 5) ; `ship` reste le bâtiment de combat de surface (frégate, destroyer)
  | 'carrier'
  | 'sub'
  | 'amphib'
  | 'supply';

export const UNIT_KINDS: readonly UnitKind[] = [
  'fighter', 'aew', 'tanker', 'drone', 'sam', 'ship',
  'infantry', 'mech', 'armor', 'artillery', 'engineer', 'recon', 'logistics', 'hq', 'sof',
  'carrier', 'sub', 'amphib', 'supply',
];
/** Formations terrestres, hors défense sol-air et forces spéciales. */
export const GROUND_FORCE_KINDS: readonly UnitKind[] = ['infantry', 'mech', 'armor', 'artillery', 'engineer', 'recon', 'logistics', 'hq'];
/** Formations de mêlée : elles tiennent le terrain, exercent une zone de contrôle et comptent pour un objectif terrestre. */
export const MANEUVER_KINDS: readonly UnitKind[] = ['infantry', 'mech', 'armor', 'recon', 'engineer'];
export const NAVAL_KINDS: readonly UnitKind[] = ['ship', 'carrier', 'sub', 'amphib', 'supply'];

export const isGroundForce = (kind: UnitKind): boolean => GROUND_FORCE_KINDS.includes(kind);
export const isManeuver = (kind: UnitKind): boolean => MANEUVER_KINDS.includes(kind);
export const isNaval = (kind: UnitKind): boolean => NAVAL_KINDS.includes(kind);
/** Bâtiment de surface : tout bâtiment sauf le sous-marin. */
export const isSurfaceShip = (kind: UnitKind): boolean => kind !== 'sub' && NAVAL_KINDS.includes(kind);

/**
 * ready : au sol, disponible · airborne : en vol · turnaround : remise en condition ·
 * maintenance : indisponible (dommages) · destroyed : perdu · active : unité de surface ou au sol en service ·
 * embarked : hors carte (troupe à bord d'un bâtiment, équipe spéciale en cours d'infiltration ou d'exfiltration)
 */
export type UnitStatus = 'ready' | 'airborne' | 'turnaround' | 'maintenance' | 'destroyed' | 'active' | 'embarked';

/** hold : tir en riposte uniquement · defensive : défense du secteur et des moyens amis · free : tout hostile identifié */
export type Roe = 'hold' | 'defensive' | 'free';
export type MissionType = 'CAP' | 'INTERCEPT' | 'SWEEP' | 'ESCORT' | 'SEAD' | 'CAS' | 'AEW' | 'TANKER' | 'RECON';
export const MISSION_TYPES: readonly MissionType[] = ['CAP', 'INTERCEPT', 'SWEEP', 'ESCORT', 'SEAD', 'CAS', 'AEW', 'TANKER', 'RECON'];
export type MissionStatus = 'planned' | 'active' | 'completed' | 'cancelled';
export type SpeedMode = 'cruise' | 'dash';
export type UnitTask = 'ground' | 'transit' | 'station' | 'pursue' | 'attack' | 'escort' | 'refuel' | 'refueling' | 'evade' | 'rtb' | 'hold' | 'move';
export type RtbReason = 'fuel' | 'weapons' | 'damage' | 'order' | 'mission_end';
export type Difficulty = 'recrue' | 'standard' | 'veteran';
export type ControlStatus = SideId | 'CONTESTED';
export type WeaponKind = 'aam' | 'sam' | 'none';
/**
 * aam : air-air · sam : sol-air · asm : air-surface (munition de précision, représentée abstraitement) ·
 * ssm : missile antinavire tiré d'un bâtiment · torpedo : torpille de sous-marin · asw : arme anti-sous-marine.
 */
export type ShotWeapon = 'aam' | 'sam' | 'asm' | 'ssm' | 'torpedo' | 'asw';
/**
 * Origine de la dernière mise à jour d'une piste. ground : observation par une unité terrestre ·
 * sat : passage d'un satellite d'observation · sonar : écoute sous-marine · sof : équipe spéciale.
 */
export type ContactSource = 'radar' | 'esm' | 'eo' | 'fire' | 'intel' | 'ground' | 'sat' | 'sonar' | 'sof';

/** Emport simplifié d'un aéronef de combat. */
export interface Loadout {
  id: string;
  label: string;
  /** Missiles air-air. */
  aam: number;
  /** Munitions air-surface. */
  asm: number;
}

/** Valeurs de jeu d'une plate-forme, telles que le moteur les utilise (voir unit-database pour leur provenance). */
export interface PlatformPerf {
  id: string;
  label: string;
  kind: UnitKind;
  domain: Domain;
  cruiseKmh: number;
  dashKmh: number;
  ceilingM: number;
  fuelCapacityKg: number;
  burnCruiseKgMin: number;
  burnDashKgMin: number;
  /** Carburant transférable par un ravitailleur (réserve distincte du carburant de vol : simplification). */
  transferFuelKg: number;
  /** Portée radar contre une cible de signature 1. 0 = pas de radar. */
  radarRangeKm: number;
  /** Secteur balayé, centré sur le cap (360 = tous azimuts). */
  radarArcDeg: number;
  /** Hauteur d'antenne pour les unités de surface et au sol. */
  antennaHeightM: number;
  signature: number;
  /** Contre-mesures, 0 (aucune) à 0,3. */
  ecm: number;
  weapon: WeaponKind;
  weaponRangeKm: number;
  weaponCount: number;
  turnaroundMin: number;
  /** Emports possibles ; le premier est l'emport par défaut. Vide si l'emport n'est pas variable. */
  loadouts: Loadout[];
  /** Portée des munitions air-surface. */
  asmRangeKm: number;
  /** Capteur optronique : portée contre les unités de surface et au sol. 0 = aucun. */
  eoRangeKm: number;
  /** Détecteur d'émissions radar (écoute passive). */
  esm: boolean;
  /** Probabilité de rentrer d'une sortie sans panne. */
  reliability: number;
  // --- Phase 5 : valeurs de jeu interarmées, 0 lorsqu'elles sont sans objet ---
  /** Puissance de combat au contact d'une formation terrestre (bataillon d'infanterie = 1). */
  combat: number;
  /** Appui indirect (artillerie) : portée et puissance. */
  supportKm: number;
  support: number;
  /** Portée d'observation terrestre. */
  spotKm: number;
  /** Ravitaillement transporté par une unité logistique, en points. */
  cargo: number;
  /** Rayon de commandement d'un poste de commandement. */
  commandKm: number;
  /** Portée d'écoute sous-marine. */
  sonarKm: number;
  /** Missiles antinavires. */
  ssmRangeKm: number;
  ssmCount: number;
  /** Torpilles. */
  torpedoKm: number;
  torpedoCount: number;
  /** Points de coque d'un bâtiment. */
  hull: number;
  /** Aéronefs qu'un bâtiment peut mettre en œuvre (porte-avions). */
  deck: number;
  /** Formations terrestres qu'un bâtiment peut transporter. */
  lift: number;
  /** Aéronef apte à opérer depuis un porte-avions. */
  carrierCapable: boolean;
}

export type LandPosture = 'hold' | 'move' | 'attack' | 'defend' | 'withdraw';

/** État propre à une formation terrestre. Toutes les grandeurs vont de 0 à 1. */
export interface LandState {
  /** Effectifs et matériels restants. */
  strength: number;
  morale: number;
  fatigue: number;
  cohesion: number;
  /** Ravitaillement disponible dans l'unité. */
  supply: number;
  posture: LandPosture;
  /** Retranchement, acquis en restant sur place. */
  dugIn: number;
  /** Ravitaillement transporté (unité logistique), en points. */
  cargo: number;
  inContact: boolean;
  /** Unité rompue : elle décroche et ne peut plus attaquer avant de s'être reconstituée. */
  broken: boolean;
  /** Dans le rayon d'un poste de commandement ami. */
  inCommand: boolean;
  /** Ordre en cours de transmission, appliqué à l'instant `at`. */
  pending: { at: number; posture: LandPosture; route: LatLon[] } | null;
  /** Point de distribution d'une unité logistique : elle y revient après chaque recomplètement. */
  supplyPoint: LatLon | null;
  /** Demande d'appui aérien en cours depuis cet instant ; -1 = aucune. */
  casSince: number;
}

/** État propre à un bâtiment. */
export interface NavalState {
  /** Points de coque restants. */
  hull: number;
  ssm: number;
  torpedoes: number;
  /** Bâtiment suivi en formation (escorte) ; `null` : navigue de son propre chef. */
  leaderId: string | null;
  lastSsmAt: number;
  lastTorpedoAt: number;
  lastAswAt: number;
  /** Sous-marin : un tir récent le rend plus facile à détecter jusqu'à cet instant. */
  datumUntil: number;
  /** Formations terrestres à bord. */
  troops: string[];
  /** Débarquement en cours. */
  landing: { unitId: string; beach: LatLon; doneAt: number } | null;
}

export type SofPhase = 'ready' | 'inserting' | 'observing' | 'extracting';

/** État propre à une équipe d'opérations spéciales. */
export interface SofState {
  phase: SofPhase;
  target: LatLon | null;
  /** Fin de l'infiltration ou de l'exfiltration en cours. */
  arriveAt: number;
  compromised: boolean;
}

export type TerrainKind = 'urbain' | 'foret' | 'montagne' | 'marais';

/** Zone de terrain particulier ; hors de toute zone, le terrain est « ouvert ». */
export interface TerrainZone {
  id: string;
  name: string;
  kind: TerrainKind;
  center: LatLon;
  radiusKm: number;
}

/** Services dont dépend le commandement : réseaux, liaisons par satellite, navigation par satellite. */
export type ServiceId = 'network' | 'satcom' | 'nav';
export const SERVICE_IDS: readonly ServiceId[] = ['network', 'satcom', 'nav'];

export interface SideServices {
  /** Niveau de chaque service, de 0 (indisponible) à 1 (nominal). */
  level: Record<ServiceId, number>;
  /** Fin de la perturbation en cours ; au-delà, le service se rétablit progressivement. */
  disruptedUntil: Record<ServiceId, number>;
  /** Résilience : raccourcit les perturbations et accélère le rétablissement. */
  resilience: number;
}

/** cyber : perturbation des réseaux adverses · jam : brouillage des services spatiaux adverses. */
export type EffectId = 'cyber' | 'jam';
export const EFFECT_IDS: readonly EffectId[] = ['cyber', 'jam'];

/** Fenêtre de couverture d'un satellite d'observation fictif. */
export interface SatellitePass {
  id: string;
  side: SideId;
  name: string;
  startS: number;
  endS: number;
  footprint: Circle;
  /** start : pas commencée · open : en cours · done : terminée. */
  phase: 'start' | 'open' | 'done';
}

export interface Unit {
  id: string;
  side: SideId;
  name: string;
  platformId: string;
  kind: UnitKind;
  domain: Domain;
  groupId: string;
  baseId: string | null;
  pos: LatLon;
  altM: number;
  headingDeg: number;
  speedKmh: number;
  status: UnitStatus;
  damaged: boolean;
  fuelKg: number;
  weapons: number;
  transferKg: number;
  /** Niveau d'entraînement de l'équipage, 0 à 1. */
  crew: number;
  missionId: string | null;
  task: UnitTask;
  wpIndex: number;
  rtbReason: RtbReason | null;
  /** Identifiant de piste (propre au camp) de la cible poursuivie. Jamais un identifiant de vérité-terrain. */
  targetContactId: string | null;
  refuelFromId: string | null;
  /** Itinéraire des unités navales. */
  route: LatLon[];
  routeLoop: boolean;
  readyAt: number | null;
  lastShotAt: number;
  /** Munitions air-surface emportées. */
  asm: number;
  loadoutId: string;
  /** Rang dans la formation de sa mission (0 = leader). */
  slot: number;
  /** Instant avant lequel l'appareil ne peut pas décoller (changement d'emport). */
  availableAt: number;
  /** Unité de surface ou sol-air : radar et tirs neutralisés jusqu'à cet instant. */
  suppressedUntil: number;
  /** Panne constatée à l'atterrissage : réparation en cours. */
  fault: boolean;
  /** États propres à un domaine ; `null` pour les unités qui n'en relèvent pas. */
  land: LandState | null;
  naval: NavalState | null;
  sof: SofState | null;
}

export interface Base {
  id: string;
  side: SideId;
  name: string;
  pos: LatLon;
  /** Stock de missiles air-air. */
  weaponStock: number;
  /** Stock de munitions air-surface. */
  asmStock: number;
  fuelStockKg: number;
  /** Ravitaillement des forces terrestres et navales, en points (dépôt). */
  supplyStock: number;
  /** Bâtiment qui porte cette base (pont d'envol d'un porte-avions, dépôt d'un navire logistique) ; `null` : base à terre. */
  hostUnitId: string | null;
  /** Base hors service : aucun décollage, aucun atterrissage. */
  closed: boolean;
}

export interface Group {
  id: string;
  side: SideId;
  name: string;
}

export interface Mission {
  id: string;
  side: SideId;
  name: string;
  type: MissionType;
  unitIds: string[];
  waypoints: LatLon[];
  altM: number;
  speed: SpeedMode;
  /** Secondes depuis le début du scénario. */
  launchAt: number;
  endAt: number | null;
  roe: Roe;
  allowRefuel: boolean;
  targetContactId: string | null;
  status: MissionStatus;
  createdAt: number;
  onStationAnnounced: boolean;
  /** Silence radar : les appareils de la mission n'émettent pas. */
  emcon: boolean;
  /** Circuit bouclé (tenue de station) ou route parcourue une seule fois. */
  loop: boolean;
  /** Unité amie protégée par une mission d'escorte. */
  escortUnitId: string | null;
}

/** Piste tenue par un camp sur une unité adverse. `unitId` reste interne au moteur. */
export interface Contact {
  id: string;
  unitId: string;
  domain: Domain;
  pos: LatLon;
  altM: number;
  headingDeg: number;
  speedKmh: number;
  firstSeen: number;
  lastSeen: number;
  idProgress: number;
  identified: boolean;
  kind: UnitKind | null;
  label: string | null;
  stale: boolean;
  hostileAct: boolean;
  /** Dommage constaté par ce camp (résultat de tir observé). */
  damaged: boolean;
  /** Dernière détection par un radar : seule une piste radar fraîche permet un tir air-air ou sol-air. */
  radarSeenAt: number;
  source: ContactSource;
  /** Renseignement sur un site fixe : ne périme pas en position, n'est jamais abandonné. */
  fixed: boolean;
}

export interface Shot {
  id: number;
  side: SideId;
  shooterId: string;
  shooterName: string;
  targetId: string;
  contactId: string;
  weapon: ShotWeapon;
  firedAt: number;
  impactAt: number;
  launchRangeKm: number;
  maxRangeKm: number;
  shooterCrew: number;
  /** Tir air-surface sur un renseignement ancien (position non rafraîchie). */
  intelStale: boolean;
  /** Le camp visé tenait-il une piste fraîche sur le tireur au moment du tir ? */
  targetAware: boolean;
  from: LatLon;
}

export type EventCode =
  | 'MISSION_PLANNED'
  | 'MISSION_LAUNCHED'
  | 'MISSION_ON_STATION'
  | 'MISSION_ENDED'
  | 'MISSION_CANCELLED'
  | 'ROE_CHANGED'
  | 'UNIT_RTB'
  | 'UNIT_LANDED'
  | 'UNIT_READY'
  | 'REFUEL_START'
  | 'REFUEL_END'
  | 'CONTACT_NEW'
  | 'CONTACT_IDENTIFIED'
  | 'CONTACT_LOST'
  | 'CONTACT_DESTROYED'
  | 'SHOT_FIRED'
  | 'MISSILE_WARNING'
  | 'SHOT_RESULT'
  | 'UNIT_DESTROYED'
  | 'UNIT_DAMAGED'
  | 'MISSILE_EVADED'
  | 'UNIT_LOST_FUEL'
  | 'UNIT_FAULT'
  | 'UNIT_SUPPRESSED'
  | 'UNIT_RECOVERED'
  | 'UNIT_EVADING'
  | 'SHIP_MOVING'
  | 'PERCEIVED_CONTROL'
  | 'CONTROL_CHANGED'
  | 'SHOT_RESOLVED'
  | 'TRIGGER_MESSAGE'
  | 'AI_DECISION'
  | 'MISSION_END'
  // --- Phase 5 ---
  | 'LAND_ORDER'
  | 'LAND_IN_CONTACT'
  | 'LAND_BROKEN'
  | 'LAND_RALLIED'
  | 'CAS_REQUEST'
  | 'SUPPLY_LOW'
  | 'TROOPS_LANDING'
  | 'TROOPS_LANDED'
  | 'BASE_CLOSED'
  | 'UNIT_DIVERTED'
  | 'EFFECT_USED'
  | 'SERVICE_DEGRADED'
  | 'SERVICE_RESTORED'
  | 'SAT_PASS_START'
  | 'SAT_PASS_END'
  | 'SOF_INSERTING'
  | 'SOF_ON_STATION'
  | 'SOF_ABORTED'
  | 'SOF_COMPROMISED'
  | 'SOF_RECOVERED'
  | 'SOF_LOST'
  | 'INTEL_REPORT';

/** Événement horodaté. `vis` liste les camps autorisés à le voir ; vide = observateur uniquement. */
export interface SimEvent {
  t: number;
  code: EventCode;
  vis: SideId[];
  p: Record<string, string | number>;
}

export interface ControlLedger {
  BLUE: number;
  RED: number;
  CONTESTED: number;
}

export interface PerceivedControl {
  controller: SideId;
  status: ControlStatus;
  sec: ControlLedger;
}

export interface SectorObjective {
  id: string;
  name: string;
  /** air : le secteur se dispute entre chasseurs · ground : la zone se tient avec des formations terrestres. */
  kind: 'air' | 'ground';
  center: LatLon;
  radiusKm: number;
  defender: SideId;
  /** Le défenseur gagne s'il totalise au moins ce temps de contrôle. */
  defenderWinsAtSec: number;
  /** Le challenger gagne si le défenseur totalise moins que ce temps. */
  challengerWinsBelowSec: number;
  controller: SideId;
  status: ControlStatus;
  sec: ControlLedger;
  timeline: { t: number; status: ControlStatus }[];
  /** Contrôle tel que chaque camp le perçoit par ses propres capteurs. */
  perceived: Record<SideId, PerceivedControl>;
}

export interface DoctrineParams {
  id: string;
  /** Allonge le délai de mise en œuvre des ordres. */
  centralisation: number;
  /** Allonge la laisse de poursuite des patrouilles. */
  autonomie: number;
  /** Préférence pour l'engagement groupé des moyens. */
  masse: number;
  /** Propension à rompre le combat pour préserver les forces. */
  preservation: number;
  /** Fréquence de réévaluation du plan. */
  tempo: number;
  /** Goût pour les postures offensives. */
  agressivite: number;
}

export interface AiDecision {
  t: number;
  level: 'strategic' | 'operative';
  code: string;
  p: Record<string, string | number>;
  /** Utilités comparées lors du choix (transparence après mission). */
  utilities: Record<string, number>;
}

export interface AiMemory {
  difficulty: Difficulty;
  role: 'defender' | 'challenger';
  posture: string | null;
  nextWakeAt: number;
  nextStrategicAt: number;
  nextOperativeAt: number;
  knownLosses: number;
  knownHostileAct: boolean;
  /** Posture initiale imposée par le scénario, tenue jusqu'à `forcedUntil` ; `null` = IA libre. */
  forcedPosture: string | null;
  forcedUntil: number;
  notes: Record<string, number>;
  log: AiDecision[];
}

export type TriggerCondition =
  | { type: 'TIME_ELAPSED'; atSec: number }
  | { type: 'LOSSES_AT_LEAST'; side: SideId; kind: UnitKind; count: number }
  | { type: 'UNIT_IN_ZONE'; side: SideId; kind: UnitKind; zone: Circle }
  | { type: 'GROUP_UNAVAILABLE'; groupId: string }
  | { type: 'CONTROL_IS'; status: ControlStatus };

export type TriggerAction =
  | { type: 'MESSAGE'; text: string; vis: SideId[] }
  | { type: 'END_MISSION'; winner: SideId | 'DRAW' };

export interface Trigger {
  id: string;
  condition: TriggerCondition;
  actions: TriggerAction[];
  fired: boolean;
}

export interface SideStats {
  sorties: number;
  shotsFired: number;
  /** Dont munitions air-surface. */
  asmFired: number;
  hits: number;
  kills: number;
  fuelBurnedKg: number;
  fuelTransferredKg: number;
  losses: Record<UnitKind, number>;
  damaged: number;
  /** Effectifs terrestres perdus, en équivalents de formation (somme des fractions perdues). */
  landStrengthLost: number;
  ssmFired: number;
  torpedoesFired: number;
  effectsUsed: number;
}

export interface Outcome {
  winner: SideId | 'DRAW';
  level: 'major' | 'minor' | 'draw';
  reason: 'time' | 'attrition' | 'trigger';
  endedAt: number;
}

/** Paramètres de jeu du moteur. Tous sont des valeurs ludiques documentées dans docs/modele-de-jeu.md. */
export interface Rules {
  dtS: number;
  sensorIntervalS: number;
  pDetectMax: number;
  detectExponent: number;
  idRate: number;
  visualIdKm: number;
  staleAfterS: number;
  dropAirAfterS: number;
  dropSurfaceAfterS: number;
  aamSpeedKmh: number;
  samSpeedKmh: number;
  shotCooldownS: number;
  maxShotsPerTarget: number;
  fireRangeFraction: number;
  pkBaseAam: number;
  pkBaseSam: number;
  pkSurpriseFactor: number;
  pkAwareFactor: number;
  pkLargeTargetFactor: number;
  pkDamagedTargetFactor: number;
  pkMin: number;
  pkMax: number;
  killGivenHit: number;
  refuelRateKgMin: number;
  refuelJoinKm: number;
  refuelTriggerFraction: number;
  bingoMargin: number;
  fuelReserveFraction: number;
  lowAltBelowM: number;
  lowAltBurnFactor: number;
  hvaThreatKm: number;
  defensiveRadiusKm: number;
  scrambleBaseS: number;
  racetrackHalfKm: number;
  surfaceTargetHeightM: number;
  aiWakeS: number;
  // --- Phase 3 ---
  esmRangeFactor: number;
  esmDetectP: number;
  esmIdRate: number;
  eoDetectP: number;
  nightSunElevationDeg: number;
  nightVisualFactor: number;
  nightEoFactor: number;
  asmSpeedKmh: number;
  pkBaseAsm: number;
  asmKillGivenHit: number;
  shipDefenceFactor: number;
  staleIntelFactor: number;
  suppressHitS: number;
  suppressMissS: number;
  bdaRangeKm: number;
  rearmDelayS: number;
  formationSpacingKm: number;
  faultDelayMinS: number;
  faultDelayMaxS: number;
  repairS: number;
  escortRadiusKm: number;
  // --- Phase 5 : terre ---
  landIntervalS: number;
  landContactKm: number;
  zocKm: number;
  landAttritionPerMin: number;
  landBreakMorale: number;
  landBreakCohesion: number;
  landRallyCohesion: number;
  landDestroyedBelow: number;
  landOrderDelayS: number;
  digInPerMin: number;
  dugInBonus: number;
  engineerKm: number;
  resupplyKm: number;
  depotKm: number;
  resupplyPerMin: number;
  cargoPerSupply: number;
  reloadCargoPerMin: number;
  casRadiusKm: number;
  casStrengthLoss: number;
  casCohesionLoss: number;
  casMoraleLoss: number;
  /** Une zone terrestre revient au camp dont la puissance présente vaut au moins ce multiple de celle de l'adversaire. */
  groundControlRatio: number;
  /** Durée, en secondes, pendant laquelle une formation adverse perdue de vue reste présumée là où elle a été vue (estimation du contrôle). */
  groundTrackMemoryS: number;
  // --- Phase 5 : mer ---
  ssmSpeedKmh: number;
  pkBaseSsm: number;
  ssmSalvo: number;
  ssmCooldownS: number;
  pointDefenceKm: number;
  sonarDetectP: number;
  subFastKmh: number;
  subFastFactor: number;
  subQuietFactor: number;
  datumS: number;
  datumFactor: number;
  torpedoSpeedKmh: number;
  pkTorpedo: number;
  torpedoCooldownS: number;
  aswRangeKm: number;
  pkAsw: number;
  aswCooldownS: number;
  formationKm: number;
  landingRangeKm: number;
  landingS: number;
  landedCohesion: number;
  replenishKm: number;
  replenishIntervalS: number;
  // --- Phase 5 : effets cyber et spatiaux ---
  effectDurationS: number;
  effectStrength: number;
  serviceRecoveryPerMin: number;
  degradedBelow: number;
  navDegradedFactor: number;
  // --- Phase 5 : opérations spéciales ---
  sofInsertKmh: number;
  sofPrepS: number;
  sofRangeKm: number;
  sofInsertP: number;
  sofNearKm: number;
  sofCompromiseBaseP: number;
  sofCompromisePerUnitP: number;
  sofExtractP: number;
  sofExtractCompromisedP: number;
}

export interface SimState {
  formatVersion: 2;
  scenarioId: string;
  seed: number;
  /** Secondes écoulées depuis le début du scénario. */
  time: number;
  endTime: number;
  /** Date-heure fictive du début (ISO 8601, UTC). */
  startIso: string;
  /** Mode par tours (WEGO) : durée d'un tour en secondes ; 0 = temps continu. */
  wegoTurnS: number;
  rng: RngStreams;
  theater: Bounds;
  weather: { label: string; sensorFactor: number };
  rules: Rules;
  platforms: Record<string, PlatformPerf>;
  sideNames: Record<SideId, string>;
  groups: Record<string, Group>;
  bases: Record<string, Base>;
  units: Record<string, Unit>;
  missions: Record<string, Mission>;
  missionSeq: Record<SideId, Record<MissionType, number>>;
  contacts: Record<SideId, Record<string, Contact>>;
  contactSeq: Record<SideId, number>;
  shots: Shot[];
  shotSeq: number;
  events: SimEvent[];
  objective: SectorObjective;
  navalZones: Record<SideId, Circle | null>;
  doctrine: Record<SideId, DoctrineParams>;
  defaultRoe: Record<SideId, Roe>;
  ai: Record<SideId, AiMemory | null>;
  triggers: Trigger[];
  stats: Record<SideId, SideStats>;
  outcome: Outcome | null;
  // --- Phase 5 ---
  terrain: TerrainZone[];
  services: Record<SideId, SideServices>;
  /** Effets multi-domaines encore disponibles pour chaque camp. */
  effects: Record<SideId, Record<EffectId, number>>;
  satellites: SatellitePass[];
}
