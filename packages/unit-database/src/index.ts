/**
 * Base de données des matériels.
 *
 * Règle d'or (prompt maître §5.1) : ne jamais inventer une caractéristique technique précise.
 * Chaque fiche sépare donc :
 *  - `reference` : des données publiques, avec leur source et un niveau de confiance ;
 *  - `game` : les valeurs utilisées par le moteur, chacune étiquetée « publique » (reprise telle
 *    quelle d'une source) ou « estimation » (valeur de jeu, arrondie ou d'équilibrage).
 *
 * Les valeurs de jeu ne prétendent pas décrire les performances réelles des systèmes.
 * Les matériels marqués `generic` ne correspondent à aucun système réel.
 */
import type { Domain, Loadout, PlatformPerf, UnitKind, WeaponKind } from '@warcommand/simulation-core';

export type Provenance = 'publique' | 'estimation';
/** Origine du matériel, pour le classement de la bibliothèque. N'interdit aucun emploi : un scénario peut donner n'importe quel matériel à n'importe quel camp. */
export type Coalition = 'occidentale' | 'rouge' | 'générique';
export type Confidence = 'élevée' | 'moyenne' | 'faible';

export interface ReferenceDatum {
  label: string;
  value: string;
  source: string;
  confidence: Confidence;
}

export interface GameDatum {
  value: number;
  provenance: Provenance;
  /** Justification courte : d'où vient la valeur, ou pourquoi elle a été choisie. */
  basis: string;
}

export type GameStatKey =
  | 'cruiseKmh'
  | 'dashKmh'
  | 'ceilingM'
  | 'fuelCapacityKg'
  | 'burnCruiseKgMin'
  | 'burnDashKgMin'
  | 'transferFuelKg'
  | 'radarRangeKm'
  | 'radarArcDeg'
  | 'antennaHeightM'
  | 'signature'
  | 'ecm'
  | 'weaponRangeKm'
  | 'weaponCount'
  | 'turnaroundMin'
  | 'asmRangeKm'
  | 'eoRangeKm'
  | 'reliability';

/** Valeurs de jeu interarmées (phase 5) : absentes d'une fiche, elles valent 0. */
export type JointStatKey =
  | 'combat'
  | 'supportKm'
  | 'support'
  | 'spotKm'
  | 'cargo'
  | 'commandKm'
  | 'sonarKm'
  | 'ssmRangeKm'
  | 'ssmCount'
  | 'torpedoKm'
  | 'torpedoCount'
  | 'hull'
  | 'deck'
  | 'lift';

export interface PlatformRecord {
  id: string;
  name: string;
  country: string;
  manufacturer: string;
  servicePeriod: string;
  role: string;
  kind: UnitKind;
  domain: Domain;
  weapon: WeaponKind;
  coalition: Coalition;
  /** Matériel générique : aucun système réel n'est représenté. */
  generic: boolean;
  /** Dispose d'un détecteur d'émissions radar (représentation de jeu). */
  esm: boolean;
  /** Emports de jeu ; le premier est l'emport par défaut. */
  loadouts: Loadout[];
  /** Date à laquelle les données ont été rassemblées. */
  dataDate: string;
  sources: string[];
  reference: ReferenceDatum[];
  game: Record<GameStatKey, GameDatum>;
  /** Valeurs de jeu terrestres et navales ; toujours des estimations. */
  joint?: Partial<Record<JointStatKey, GameDatum>>;
  /** Aéronef apte à opérer depuis un porte-avions (fait public, non une valeur de jeu). */
  carrierCapable?: boolean;
}

const EST = (value: number, basis: string): GameDatum => ({ value, provenance: 'estimation', basis });
const PUB = (value: number, basis: string): GameDatum => ({ value, provenance: 'publique', basis });
const NA = EST(0, 'Sans objet pour ce matériel');

const DATA_DATE = '2026-11-12';
const BALANCE = 'Équilibrage ludique';
const GENERIC_BASIS = 'Matériel générique : valeur de jeu sans équivalent réel';


const UNPUBLISHED: ReferenceDatum[] = [
  { label: 'Performances', value: 'non publiées de façon vérifiable', source: 'Aucune source publique retenue', confidence: 'faible' },
];

interface FighterInput {
  id: string;
  name: string;
  country: string;
  manufacturer: string;
  servicePeriod: string;
  role?: string;
  coalition: Coalition;
  sources: string[];
  reference: ReferenceDatum[];
  dashKmh: number;
  ceilingM: number;
  fuelKg: number;
  fuelBasis: string;
  burnCruise: number;
  burnDash: number;
  radarKm: number;
  signature: number;
  signatureBasis: string;
  ecm: number;
  aamRangeKm: number;
  aamCount: number;
  /** Emport air-surface, s'il existe : [missiles air-air, munitions air-surface]. */
  strike?: [number, number];
  reliability?: number;
}

/** Fiche d'un chasseur : toutes les valeurs de jeu sont des estimations, sauf mention dans `fuelBasis`. */
function fighter(i: FighterInput): PlatformRecord {
  const loadouts: Loadout[] = [{ id: 'air-air', label: 'Air-air', aam: i.aamCount, asm: 0 }];
  if (i.strike) loadouts.push({ id: 'sead', label: 'Air-surface', aam: i.strike[0], asm: i.strike[1] });
  return {
    id: i.id,
    name: i.name,
    country: i.country,
    manufacturer: i.manufacturer,
    servicePeriod: i.servicePeriod,
    role: i.role ?? 'Chasseur multirôle',
    kind: 'fighter',
    domain: 'air',
    weapon: 'aam',
    coalition: i.coalition,
    generic: false,
    esm: true,
    loadouts,
    dataDate: DATA_DATE,
    sources: i.sources,
    reference: i.reference,
    game: {
      cruiseKmh: EST(900, 'Régime de croisière de jeu, commun aux chasseurs'),
      dashKmh: EST(i.dashKmh, 'Régime rapide de jeu, inférieur à la vitesse maximale connue'),
      ceilingM: EST(i.ceilingM, 'Valeur de jeu, arrondie du plafond connu lorsqu’il est publié'),
      fuelCapacityKg: EST(i.fuelKg, i.fuelBasis),
      burnCruiseKgMin: EST(i.burnCruise, 'Choisi pour une endurance de jeu réaliste en croisière'),
      burnDashKgMin: EST(i.burnDash, 'Régime rapide très coûteux (postcombustion), valeur de jeu'),
      transferFuelKg: NA,
      radarRangeKm: EST(i.radarKm, 'Portée de jeu contre une cible de signature 1'),
      radarArcDeg: EST(120, 'Radar de nez : secteur avant uniquement, valeur de jeu'),
      antennaHeightM: NA,
      signature: EST(i.signature, `${BALANCE} : ${i.signatureBasis}`),
      ecm: EST(i.ecm, `${BALANCE} : système d’autoprotection représenté abstraitement`),
      weaponRangeKm: EST(i.aamRangeKm, 'Enveloppe de tir de jeu pour un missile air-air'),
      weaponCount: EST(i.aamCount, 'Emport de jeu simplifié'),
      turnaroundMin: EST(25, 'Délai de remise en condition de jeu'),
      asmRangeKm: i.strike ? EST(70, 'Portée de jeu d’une munition air-surface tirée à distance de sécurité, représentée abstraitement') : NA,
      eoRangeKm: NA,
      reliability: EST(i.reliability ?? 0.9, 'Fiabilité de jeu par sortie'),
    },
  };
}

interface SupportInput {
  id: string;
  name: string;
  country: string;
  manufacturer: string;
  servicePeriod: string;
  kind: 'aew' | 'tanker';
  coalition: Coalition;
  sources: string[];
  reference: ReferenceDatum[];
  cruiseKmh: number;
  dashKmh: number;
  ceilingM: number;
  fuelKg: number;
  burnCruise: number;
  burnDash: number;
  /** Avion-radar : portée de jeu. */
  radarKm?: number;
  /** Ravitailleur : carburant de jeu transférable. */
  transferKg?: number;
}

/** Fiche d'un avion-radar ou d'un ravitailleur : toutes les valeurs de jeu sont des estimations. */
function support(i: SupportInput): PlatformRecord {
  const g = (v: number, basis = 'Valeur de jeu') => EST(v, basis);
  return {
    id: i.id,
    name: i.name,
    country: i.country,
    manufacturer: i.manufacturer,
    servicePeriod: i.servicePeriod,
    role: i.kind === 'aew' ? 'Détection et commandement aéroportés' : 'Ravitaillement en vol',
    kind: i.kind,
    domain: 'air',
    weapon: 'none',
    coalition: i.coalition,
    generic: false,
    esm: i.kind === 'aew',
    loadouts: [],
    dataDate: DATA_DATE,
    sources: i.sources,
    reference: i.reference,
    game: {
      cruiseKmh: g(i.cruiseKmh, 'Régime de croisière de jeu'),
      dashKmh: g(i.dashKmh, 'Régime rapide de jeu'),
      ceilingM: g(i.ceilingM),
      fuelCapacityKg: g(i.fuelKg, 'Ordre de grandeur de jeu, part réservée au vol'),
      burnCruiseKgMin: g(i.burnCruise, 'Choisi pour une endurance de jeu de plusieurs heures'),
      burnDashKgMin: g(i.burnDash),
      transferFuelKg: i.transferKg ? g(i.transferKg, 'Part de jeu transférable ; réserve distincte du carburant de vol (simplification)') : NA,
      radarRangeKm: i.radarKm ? g(i.radarKm, 'Portée de jeu, faute de donnée publique vérifiable') : NA,
      radarArcDeg: i.radarKm ? g(360, 'Radar tous azimuts') : NA,
      antennaHeightM: NA,
      signature: g(i.kind === 'aew' ? 3.5 : 4, `${BALANCE} : gros porteur`),
      ecm: g(0, 'Non représenté'),
      weaponRangeKm: NA,
      weaponCount: NA,
      turnaroundMin: g(60, 'Délai de remise en condition de jeu'),
      asmRangeKm: NA,
      eoRangeKm: NA,
      reliability: g(0.95, 'Fiabilité de jeu par sortie'),
    },
  };
}

export const PLATFORMS: Record<string, PlatformRecord> = {
  rafale: {
    id: 'rafale',
    name: 'Rafale',
    country: 'France',
    manufacturer: 'Dassault Aviation',
    servicePeriod: 'Depuis 2001 (Marine), 2006 (Armée de l’Air)',
    role: 'Chasseur multirôle',
    kind: 'fighter',
    domain: 'air',
    weapon: 'aam',
    coalition: 'occidentale',
    generic: false,
    esm: true,
    // La version embarquée (Rafale M) est en service dans la Marine : fait public, rappelé dans `servicePeriod`.
    carrierCapable: true,
    loadouts: [
      { id: 'air-air', label: 'Air-air', aam: 6, asm: 0 },
      { id: 'sead', label: 'Air-surface', aam: 2, asm: 4 },
    ],
    dataDate: DATA_DATE,
    sources: ['Dassault Aviation — fiche technique publique du Rafale'],
    reference: [
      { label: 'Vitesse maximale', value: 'Mach 1,8', source: 'Dassault Aviation', confidence: 'élevée' },
      { label: 'Plafond pratique', value: '50 000 ft (≈ 15 240 m)', source: 'Dassault Aviation', confidence: 'élevée' },
      { label: 'Carburant interne', value: '4,7 t', source: 'Dassault Aviation', confidence: 'élevée' },
      { label: 'Carburant externe', value: 'jusqu’à 6,7 t', source: 'Dassault Aviation', confidence: 'élevée' },
    ],
    game: {
      cruiseKmh: EST(900, 'Régime de croisière de jeu, commun aux chasseurs'),
      dashKmh: EST(1500, 'Régime rapide de jeu, inférieur à la vitesse maximale publique (Mach 1,8)'),
      ceilingM: PUB(15240, 'Plafond publié par le constructeur (50 000 ft)'),
      fuelCapacityKg: PUB(4700, 'Carburant interne publié ; configuration de jeu sans réservoir externe'),
      burnCruiseKgMin: EST(50, 'Choisi pour une endurance de jeu d’environ 1 h 30 en croisière'),
      burnDashKgMin: EST(230, 'Régime rapide très coûteux (postcombustion), valeur de jeu'),
      transferFuelKg: NA,
      radarRangeKm: EST(160, 'Portée de jeu contre une cible de signature 1'),
      radarArcDeg: EST(120, 'Radar de nez : secteur avant uniquement, valeur de jeu'),
      antennaHeightM: NA,
      signature: EST(0.6, `${BALANCE} : signature réduite`),
      ecm: EST(0.2, `${BALANCE} : système d’autoprotection représenté abstraitement`),
      weaponRangeKm: EST(90, 'Enveloppe de tir de jeu pour un missile air-air moyenne portée'),
      weaponCount: EST(6, 'Emport de jeu simplifié'),
      turnaroundMin: EST(25, 'Délai de remise en condition de jeu'),
      asmRangeKm: EST(70, 'Portée de jeu d’une munition air-surface tirée à distance de sécurité, représentée abstraitement'),
      eoRangeKm: NA,
      reliability: EST(0.9, 'Fiabilité de jeu : une sortie sur dix se termine par une panne à réparer'),
    },
  },

  su35s: {
    id: 'su35s',
    name: 'Su-35S',
    country: 'Russie',
    manufacturer: 'Soukhoï (KnAAZ)',
    servicePeriod: 'Depuis 2014',
    role: 'Chasseur de supériorité aérienne',
    kind: 'fighter',
    domain: 'air',
    weapon: 'aam',
    coalition: 'rouge',
    generic: false,
    esm: true,
    loadouts: [
      { id: 'air-air', label: 'Air-air', aam: 8, asm: 0 },
      { id: 'sead', label: 'Air-surface', aam: 4, asm: 4 },
    ],
    dataDate: DATA_DATE,
    sources: ['Données constructeur publiques (Soukhoï / UAC), reprises par la presse spécialisée'],
    reference: [
      { label: 'Vitesse maximale', value: 'Mach 2,25', source: 'Données constructeur publiques', confidence: 'moyenne' },
      { label: 'Plafond pratique', value: '18 000 m', source: 'Données constructeur publiques', confidence: 'moyenne' },
      { label: 'Carburant interne', value: '11,5 t', source: 'Données constructeur publiques', confidence: 'moyenne' },
      { label: 'Distance franchissable', value: '3 600 km en altitude', source: 'Données constructeur publiques', confidence: 'moyenne' },
    ],
    game: {
      cruiseKmh: EST(900, 'Régime de croisière de jeu, commun aux chasseurs'),
      dashKmh: EST(1600, 'Régime rapide de jeu, inférieur à la vitesse maximale publique (Mach 2,25)'),
      ceilingM: PUB(18000, 'Plafond publié'),
      fuelCapacityKg: PUB(11500, 'Carburant interne publié'),
      burnCruiseKgMin: EST(95, 'Choisi pour une endurance de jeu d’environ 2 h en croisière'),
      burnDashKgMin: EST(320, 'Régime rapide très coûteux (postcombustion), valeur de jeu'),
      transferFuelKg: NA,
      radarRangeKm: EST(190, 'Portée de jeu contre une cible de signature 1'),
      radarArcDeg: EST(120, 'Radar de nez : secteur avant uniquement, valeur de jeu'),
      antennaHeightM: NA,
      signature: EST(1.3, `${BALANCE} : cellule de grande taille`),
      ecm: EST(0.15, `${BALANCE} : système d’autoprotection représenté abstraitement`),
      weaponRangeKm: EST(95, 'Enveloppe de tir de jeu pour un missile air-air moyenne portée'),
      weaponCount: EST(8, 'Emport de jeu simplifié : cellule lourde, davantage de points d’emport'),
      turnaroundMin: EST(25, 'Délai de remise en condition de jeu'),
      asmRangeKm: EST(70, 'Portée de jeu d’une munition air-surface tirée à distance de sécurité, représentée abstraitement'),
      eoRangeKm: NA,
      reliability: EST(0.9, 'Fiabilité de jeu : une sortie sur dix se termine par une panne à réparer'),
    },
  },

  e3: {
    id: 'e3',
    name: 'E-3 Sentry',
    country: 'États-Unis',
    manufacturer: 'Boeing',
    servicePeriod: 'Depuis 1977',
    role: 'Détection et commandement aéroportés',
    kind: 'aew',
    domain: 'air',
    weapon: 'none',
    coalition: 'occidentale',
    generic: false,
    esm: true,
    loadouts: [],
    dataDate: DATA_DATE,
    sources: ['US Air Force — fiche d’information publique « E-3 Sentry (AWACS) »'],
    reference: [
      { label: 'Vitesse de croisière optimale', value: '360 mph (≈ 580 km/h)', source: 'US Air Force', confidence: 'élevée' },
      { label: 'Plafond', value: 'au-dessus de 29 000 ft (≈ 8 800 m)', source: 'US Air Force', confidence: 'élevée' },
      { label: 'Endurance', value: 'plus de 8 h sans ravitaillement', source: 'US Air Force', confidence: 'élevée' },
      { label: 'Portée radar', value: 'plus de 250 miles (≈ 375 km) sur cible à basse altitude', source: 'US Air Force', confidence: 'élevée' },
    ],
    game: {
      cruiseKmh: EST(600, 'Arrondi de la vitesse de croisière publiée (≈ 580 km/h)'),
      dashKmh: EST(780, 'Régime rapide de jeu'),
      ceilingM: EST(9000, 'Arrondi du plafond publié (« au-dessus de 29 000 ft »)'),
      fuelCapacityKg: EST(65000, 'Ordre de grandeur de jeu'),
      burnCruiseKgMin: EST(125, 'Choisi pour une endurance de jeu d’environ 8 h 30, cohérente avec « plus de 8 h »'),
      burnDashKgMin: EST(190, 'Valeur de jeu'),
      transferFuelKg: NA,
      radarRangeKm: EST(400, 'Portée de jeu ; la source publie « plus de 375 km » sur cible basse'),
      radarArcDeg: EST(360, 'Radar rotatif tous azimuts'),
      antennaHeightM: NA,
      signature: EST(4, `${BALANCE} : gros porteur`),
      ecm: EST(0, 'Non représenté'),
      weaponRangeKm: NA,
      weaponCount: NA,
      turnaroundMin: EST(60, 'Délai de remise en condition de jeu'),
      asmRangeKm: NA,
      eoRangeKm: NA,
      reliability: EST(0.95, 'Fiabilité de jeu'),
    },
  },

  a50u: {
    id: 'a50u',
    name: 'A-50U',
    country: 'Russie',
    manufacturer: 'Beriev',
    servicePeriod: 'Depuis 2011 (version U)',
    role: 'Détection et commandement aéroportés',
    kind: 'aew',
    domain: 'air',
    weapon: 'none',
    coalition: 'rouge',
    generic: false,
    esm: true,
    loadouts: [],
    dataDate: DATA_DATE,
    sources: ['Presse spécialisée — données publiques peu détaillées, à recouper'],
    reference: [
      { label: 'Cellule', value: 'dérivée de l’Il-76', source: 'Presse spécialisée', confidence: 'élevée' },
      { label: 'Performances radar', value: 'non publiées de façon vérifiable', source: '—', confidence: 'faible' },
    ],
    game: {
      cruiseKmh: EST(750, 'Régime de croisière de jeu'),
      dashKmh: EST(820, 'Régime rapide de jeu'),
      ceilingM: EST(10000, 'Valeur de jeu'),
      fuelCapacityKg: EST(60000, 'Ordre de grandeur de jeu'),
      burnCruiseKgMin: EST(150, 'Choisi pour une endurance de jeu d’environ 6 h 30'),
      burnDashKgMin: EST(210, 'Valeur de jeu'),
      transferFuelKg: NA,
      radarRangeKm: EST(360, 'Portée de jeu, faute de donnée publique vérifiable'),
      radarArcDeg: EST(360, 'Radar rotatif tous azimuts'),
      antennaHeightM: NA,
      signature: EST(4, `${BALANCE} : gros porteur`),
      ecm: EST(0, 'Non représenté'),
      weaponRangeKm: NA,
      weaponCount: NA,
      turnaroundMin: EST(60, 'Délai de remise en condition de jeu'),
      asmRangeKm: NA,
      eoRangeKm: NA,
      reliability: EST(0.95, 'Fiabilité de jeu'),
    },
  },

  a330mrtt: {
    id: 'a330mrtt',
    name: 'A330 MRTT',
    country: 'Europe',
    manufacturer: 'Airbus',
    servicePeriod: 'Depuis 2011',
    role: 'Ravitaillement en vol et transport',
    kind: 'tanker',
    domain: 'air',
    weapon: 'none',
    coalition: 'occidentale',
    generic: false,
    esm: false,
    loadouts: [],
    dataDate: DATA_DATE,
    sources: ['Airbus — fiche publique de l’A330 MRTT'],
    reference: [
      { label: 'Capacité de carburant', value: '111 t', source: 'Airbus', confidence: 'élevée' },
      { label: 'Cellule', value: 'dérivée de l’A330-200', source: 'Airbus', confidence: 'élevée' },
    ],
    game: {
      cruiseKmh: EST(860, 'Régime de croisière de jeu'),
      dashKmh: EST(900, 'Régime rapide de jeu'),
      ceilingM: EST(12500, 'Valeur de jeu'),
      fuelCapacityKg: EST(70000, 'Part de jeu réservée au vol (la capacité totale publiée est de 111 t)'),
      burnCruiseKgMin: EST(95, 'Valeur de jeu'),
      burnDashKgMin: EST(120, 'Valeur de jeu'),
      transferFuelKg: EST(40000, 'Part de jeu transférable ; réserve distincte du carburant de vol (simplification)'),
      radarRangeKm: NA,
      radarArcDeg: NA,
      antennaHeightM: NA,
      signature: EST(4, `${BALANCE} : gros porteur`),
      ecm: EST(0, 'Non représenté'),
      weaponRangeKm: NA,
      weaponCount: NA,
      turnaroundMin: EST(60, 'Délai de remise en condition de jeu'),
      asmRangeKm: NA,
      eoRangeKm: NA,
      reliability: EST(0.95, 'Fiabilité de jeu'),
    },
  },

  mq9: {
    id: 'mq9',
    name: 'MQ-9 Reaper',
    country: 'États-Unis',
    manufacturer: 'General Atomics Aeronautical Systems',
    servicePeriod: 'Depuis 2007',
    role: 'Drone de surveillance et de reconnaissance',
    kind: 'drone',
    domain: 'air',
    weapon: 'none',
    coalition: 'occidentale',
    generic: false,
    esm: false,
    loadouts: [],
    dataDate: DATA_DATE,
    sources: ['US Air Force — fiche d’information publique « MQ-9 Reaper » (valeurs à recouper)'],
    reference: [
      { label: 'Vitesse de croisière', value: 'environ 230 mph (≈ 370 km/h)', source: 'US Air Force', confidence: 'moyenne' },
      { label: 'Plafond', value: 'jusqu’à 50 000 ft (≈ 15 240 m)', source: 'US Air Force', confidence: 'moyenne' },
      { label: 'Carburant', value: '4 000 lb (≈ 1 800 kg)', source: 'US Air Force', confidence: 'moyenne' },
    ],
    game: {
      cruiseKmh: EST(300, 'Régime de surveillance de jeu, inférieur à la croisière publiée'),
      dashKmh: EST(370, 'Arrondi de la vitesse de croisière publiée'),
      ceilingM: EST(15000, 'Arrondi du plafond publié'),
      fuelCapacityKg: EST(1800, 'Arrondi de la capacité publiée'),
      burnCruiseKgMin: EST(1.5, 'Choisi pour une endurance de jeu d’environ 20 h'),
      burnDashKgMin: EST(2.2, 'Valeur de jeu'),
      transferFuelKg: NA,
      radarRangeKm: NA,
      radarArcDeg: NA,
      antennaHeightM: NA,
      signature: EST(0.4, `${BALANCE} : cellule de petite taille`),
      ecm: EST(0, 'Non représenté'),
      weaponRangeKm: NA,
      weaponCount: NA,
      turnaroundMin: EST(45, 'Délai de remise en condition de jeu'),
      asmRangeKm: NA,
      eoRangeKm: EST(70, 'Portée de jeu du capteur optronique contre une unité de surface ou au sol'),
      reliability: EST(0.92, 'Fiabilité de jeu'),
    },
  },

  f16c: fighter({
    id: 'f16c',
    name: 'F-16C Fighting Falcon',
    country: 'États-Unis',
    manufacturer: 'Lockheed Martin',
    servicePeriod: 'Depuis 1984 (version C)',
    coalition: 'occidentale',
    sources: ['US Air Force — fiche d’information publique « F-16 Fighting Falcon » (valeurs à recouper)'],
    reference: [
      { label: 'Vitesse maximale', value: 'Mach 2 en altitude', source: 'US Air Force', confidence: 'moyenne' },
      { label: 'Plafond', value: 'au-dessus de 50 000 ft (≈ 15 240 m)', source: 'US Air Force', confidence: 'moyenne' },
      { label: 'Carburant interne', value: '7 000 lb (≈ 3 175 kg)', source: 'US Air Force', confidence: 'moyenne' },
    ],
    dashKmh: 1450,
    ceilingM: 15000,
    fuelKg: 5000,
    fuelBasis: 'Configuration de jeu : carburant interne (≈ 3,2 t publié) plus réservoirs externes',
    burnCruise: 45,
    burnDash: 200,
    radarKm: 130,
    signature: 1,
    signatureBasis: 'cellule de taille moyenne',
    ecm: 0.15,
    aamRangeKm: 80,
    aamCount: 6,
    strike: [2, 4],
  }),

  f35a: fighter({
    id: 'f35a',
    name: 'F-35A Lightning II',
    country: 'États-Unis',
    manufacturer: 'Lockheed Martin',
    servicePeriod: 'Depuis 2016',
    role: 'Chasseur multirôle furtif',
    coalition: 'occidentale',
    sources: ['US Air Force — fiche d’information publique « F-35A Lightning II » (valeurs à recouper)'],
    reference: [
      { label: 'Vitesse maximale', value: 'Mach 1,6', source: 'US Air Force', confidence: 'moyenne' },
      { label: 'Carburant interne', value: '18 498 lb (≈ 8 390 kg)', source: 'US Air Force', confidence: 'moyenne' },
    ],
    dashKmh: 1300,
    ceilingM: 15000,
    fuelKg: 8400,
    fuelBasis: 'Arrondi du carburant interne publié',
    burnCruise: 70,
    burnDash: 260,
    radarKm: 170,
    signature: 0.15,
    signatureBasis: 'très faible signature',
    ecm: 0.2,
    aamRangeKm: 90,
    aamCount: 4,
    strike: [2, 2],
    reliability: 0.85,
  }),

  typhoon: fighter({
    id: 'typhoon',
    name: 'Eurofighter Typhoon',
    country: 'Europe',
    manufacturer: 'Eurofighter GmbH',
    servicePeriod: 'Depuis 2003',
    role: 'Chasseur de supériorité aérienne multirôle',
    coalition: 'occidentale',
    sources: ['Eurofighter — données constructeur publiques (valeurs à recouper)'],
    reference: [
      { label: 'Vitesse maximale', value: 'Mach 2,0', source: 'Eurofighter', confidence: 'moyenne' },
      { label: 'Plafond', value: '55 000 ft (≈ 16 760 m)', source: 'Eurofighter', confidence: 'moyenne' },
    ],
    dashKmh: 1550,
    ceilingM: 16700,
    fuelKg: 5000,
    fuelBasis: 'Ordre de grandeur de jeu du carburant interne',
    burnCruise: 55,
    burnDash: 240,
    radarKm: 160,
    signature: 0.8,
    signatureBasis: 'signature modérée',
    ecm: 0.2,
    aamRangeKm: 90,
    aamCount: 6,
    strike: [2, 4],
  }),

  kc46a: support({
    id: 'kc46a',
    name: 'KC-46A Pegasus',
    country: 'États-Unis',
    manufacturer: 'Boeing',
    servicePeriod: 'Depuis 2019',
    kind: 'tanker',
    coalition: 'occidentale',
    sources: ['US Air Force — fiche d’information publique « KC-46A Pegasus » (valeurs à recouper)'],
    reference: [{ label: 'Capacité de carburant', value: '212 299 lb (≈ 96 300 kg)', source: 'US Air Force', confidence: 'moyenne' }],
    cruiseKmh: 850,
    dashKmh: 900,
    ceilingM: 12000,
    fuelKg: 60000,
    burnCruise: 90,
    burnDash: 115,
    transferKg: 36000,
  }),

  su30sm: fighter({
    id: 'su30sm',
    name: 'Su-30SM',
    country: 'Russie',
    manufacturer: 'Soukhoï (Irkout)',
    servicePeriod: 'Depuis 2012',
    coalition: 'rouge',
    sources: ['Données constructeur publiques, reprises par la presse spécialisée (valeurs à recouper)'],
    reference: [{ label: 'Vitesse maximale', value: 'Mach 2,0', source: 'Données constructeur publiques', confidence: 'moyenne' }],
    dashKmh: 1500,
    ceilingM: 17000,
    fuelKg: 9600,
    fuelBasis: 'Ordre de grandeur de jeu du carburant interne',
    burnCruise: 90,
    burnDash: 310,
    radarKm: 150,
    signature: 1.5,
    signatureBasis: 'cellule de grande taille',
    ecm: 0.1,
    aamRangeKm: 85,
    aamCount: 8,
    strike: [4, 4],
  }),

  mig31bm: fighter({
    id: 'mig31bm',
    name: 'MiG-31BM',
    country: 'Russie',
    manufacturer: 'Mikoyan',
    servicePeriod: 'Depuis 1981 ; version BM depuis 2011',
    role: 'Intercepteur à long rayon d’action',
    coalition: 'rouge',
    sources: ['Données publiques largement reprises par la presse spécialisée (valeurs à recouper)'],
    reference: [
      { label: 'Vitesse maximale', value: 'Mach 2,83', source: 'Presse spécialisée', confidence: 'moyenne' },
      { label: 'Plafond', value: '≈ 20 600 m', source: 'Presse spécialisée', confidence: 'moyenne' },
    ],
    dashKmh: 2200,
    ceilingM: 20000,
    fuelKg: 16000,
    fuelBasis: 'Ordre de grandeur de jeu du carburant interne',
    burnCruise: 130,
    burnDash: 480,
    radarKm: 220,
    signature: 2,
    signatureBasis: 'très grande cellule',
    ecm: 0.1,
    aamRangeKm: 130,
    aamCount: 4,
    reliability: 0.85,
  }),

  j20: fighter({
    id: 'j20',
    name: 'J-20',
    country: 'Chine',
    manufacturer: 'Chengdu',
    servicePeriod: 'Depuis 2017',
    role: 'Chasseur furtif de supériorité aérienne',
    coalition: 'rouge',
    sources: ['Aucune donnée constructeur vérifiable : valeurs de jeu uniquement'],
    reference: UNPUBLISHED,
    dashKmh: 1500,
    ceilingM: 18000,
    fuelKg: 11000,
    fuelBasis: 'Ordre de grandeur de jeu, faute de donnée publique vérifiable',
    burnCruise: 85,
    burnDash: 300,
    radarKm: 180,
    signature: 0.2,
    signatureBasis: 'très faible signature',
    ecm: 0.15,
    aamRangeKm: 100,
    aamCount: 6,
    reliability: 0.85,
  }),

  kj500: support({
    id: 'kj500',
    name: 'KJ-500',
    country: 'Chine',
    manufacturer: 'Shaanxi',
    servicePeriod: 'Depuis 2015',
    kind: 'aew',
    coalition: 'rouge',
    sources: ['Aucune donnée constructeur vérifiable : valeurs de jeu uniquement'],
    reference: UNPUBLISHED,
    cruiseKmh: 550,
    dashKmh: 620,
    ceilingM: 9500,
    fuelKg: 20000,
    burnCruise: 55,
    burnDash: 75,
    radarKm: 380,
  }),

  il78m: support({
    id: 'il78m',
    name: 'Il-78M',
    country: 'Russie',
    manufacturer: 'Iliouchine',
    servicePeriod: 'Depuis 1987',
    kind: 'tanker',
    coalition: 'rouge',
    sources: ['Presse spécialisée — données publiques peu détaillées, à recouper'],
    reference: [{ label: 'Cellule', value: 'dérivée de l’Il-76', source: 'Presse spécialisée', confidence: 'élevée' }],
    cruiseKmh: 750,
    dashKmh: 800,
    ceilingM: 11000,
    fuelKg: 55000,
    burnCruise: 140,
    burnDash: 180,
    transferKg: 30000,
  }),

  'sam-mr-generic': genericSurface({
    id: 'sam-mr-generic',
    name: 'Groupe sol-air moyenne portée (générique)',
    role: 'Défense sol-air de zone',
    kind: 'sam',
    domain: 'ground',
    radarRangeKm: 150,
    antennaHeightM: 15,
    weaponRangeKm: 60,
    weaponCount: 8,
    cruiseKmh: 0,
  }),

  'sam-lr-generic': genericSurface({
    id: 'sam-lr-generic',
    name: 'Groupe sol-air longue portée (générique)',
    role: 'Défense sol-air de zone',
    kind: 'sam',
    domain: 'ground',
    radarRangeKm: 220,
    antennaHeightM: 20,
    weaponRangeKm: 100,
    weaponCount: 8,
    cruiseKmh: 0,
  }),

  'frigate-aaw-generic': genericSurface({
    id: 'frigate-aaw-generic',
    name: 'Frégate de défense aérienne (générique)',
    role: 'Bâtiment de surface — défense aérienne',
    kind: 'ship',
    domain: 'surface',
    radarRangeKm: 200,
    antennaHeightM: 30,
    weaponRangeKm: 60,
    weaponCount: 16,
    cruiseKmh: 46,
    joint: { hull: 2, sonarKm: 15 },
  }),

  'frigate-generic': genericSurface({
    id: 'frigate-generic',
    name: 'Frégate (générique)',
    role: 'Bâtiment de surface polyvalent',
    kind: 'ship',
    domain: 'surface',
    radarRangeKm: 180,
    antennaHeightM: 28,
    weaponRangeKm: 55,
    weaponCount: 16,
    cruiseKmh: 46,
    joint: { hull: 2, sonarKm: 25, ssmRangeKm: 120, ssmCount: 4 },
  }),

  'destroyer-generic': genericSurface({
    id: 'destroyer-generic',
    name: 'Destroyer (générique)',
    role: 'Bâtiment de surface — défense de zone et lutte antinavire',
    kind: 'ship',
    domain: 'surface',
    radarRangeKm: 250,
    antennaHeightM: 32,
    weaponRangeKm: 100,
    weaponCount: 32,
    cruiseKmh: 52,
    joint: { hull: 2, sonarKm: 30, ssmRangeKm: 150, ssmCount: 8 },
  }),

  'carrier-generic': genericSurface({
    id: 'carrier-generic',
    name: 'Porte-avions (générique)',
    role: 'Porte-avions — base aérienne mobile, autodéfense à courte portée',
    kind: 'carrier',
    domain: 'surface',
    radarRangeKm: 250,
    antennaHeightM: 40,
    weaponRangeKm: 25,
    weaponCount: 24,
    cruiseKmh: 50,
    joint: { hull: 4, deck: 12 },
  }),

  'submarine-generic': genericSurface({
    id: 'submarine-generic',
    name: 'Sous-marin d’attaque (générique)',
    role: 'Sous-marin — lutte antinavire à la torpille',
    kind: 'sub',
    domain: 'surface',
    radarRangeKm: 0,
    antennaHeightM: 0,
    weaponRangeKm: 0,
    weaponCount: 0,
    cruiseKmh: 22,
    weapon: 'none',
    joint: { hull: 1, sonarKm: 35, torpedoKm: 15, torpedoCount: 6 },
  }),

  'amphib-generic': genericSurface({
    id: 'amphib-generic',
    name: 'Navire amphibie (générique)',
    role: 'Navire amphibie — transport et mise à terre de formations terrestres',
    kind: 'amphib',
    domain: 'surface',
    radarRangeKm: 60,
    antennaHeightM: 25,
    weaponRangeKm: 10,
    weaponCount: 8,
    cruiseKmh: 36,
    joint: { hull: 2, lift: 2 },
  }),

  'supply-ship-generic': genericSurface({
    id: 'supply-ship-generic',
    name: 'Navire logistique (générique)',
    role: 'Navire logistique — dépôt flottant, recomplètement à la mer',
    kind: 'supply',
    domain: 'surface',
    radarRangeKm: 40,
    antennaHeightM: 25,
    weaponRangeKm: 0,
    weaponCount: 0,
    cruiseKmh: 30,
    weapon: 'none',
    joint: { hull: 2 },
  }),

  'infantry-bn-generic': genericGround({
    id: 'infantry-bn-generic',
    name: 'Bataillon d’infanterie (générique)',
    role: 'Infanterie — tient le terrain, étalon de puissance de combat',
    kind: 'infantry',
    cruiseKmh: 15,
    joint: { combat: 1, spotKm: 4 },
  }),

  'mech-bn-generic': genericGround({
    id: 'mech-bn-generic',
    name: 'Bataillon d’infanterie mécanisée (générique)',
    role: 'Infanterie mécanisée — mêlée mobile',
    kind: 'mech',
    cruiseKmh: 30,
    joint: { combat: 1.6, spotKm: 5 },
  }),

  'armor-bn-generic': genericGround({
    id: 'armor-bn-generic',
    name: 'Bataillon blindé (générique)',
    role: 'Blindés — choc et rupture',
    kind: 'armor',
    cruiseKmh: 35,
    joint: { combat: 2.2, spotKm: 5 },
  }),

  'artillery-bn-generic': genericGround({
    id: 'artillery-bn-generic',
    name: 'Groupe d’artillerie (générique)',
    role: 'Artillerie — appui indirect des unités au contact',
    kind: 'artillery',
    cruiseKmh: 25,
    joint: { combat: 0.4, spotKm: 3, supportKm: 30, support: 1.4 },
  }),

  'engineer-coy-generic': genericGround({
    id: 'engineer-coy-generic',
    name: 'Compagnie du génie (générique)',
    role: 'Génie — mobilité en terrain difficile, retranchement accéléré',
    kind: 'engineer',
    cruiseKmh: 25,
    joint: { combat: 0.5, spotKm: 3 },
  }),

  'recon-sqn-generic': genericGround({
    id: 'recon-sqn-generic',
    name: 'Escadron de reconnaissance (générique)',
    role: 'Reconnaissance — observation lointaine, rapide et légère',
    kind: 'recon',
    cruiseKmh: 45,
    joint: { combat: 0.6, spotKm: 12 },
  }),

  'logistics-bn-generic': genericGround({
    id: 'logistics-bn-generic',
    name: 'Bataillon logistique (générique)',
    role: 'Logistique — navette entre un dépôt et les unités à ravitailler',
    kind: 'logistics',
    cruiseKmh: 30,
    joint: { combat: 0.2, spotKm: 3, cargo: 120 },
  }),

  'hq-generic': genericGround({
    id: 'hq-generic',
    name: 'Poste de commandement (générique)',
    role: 'Commandement — rayon de commandement des formations terrestres',
    kind: 'hq',
    cruiseKmh: 30,
    joint: { combat: 0.2, spotKm: 3, commandKm: 60 },
  }),

  'sof-team-generic': genericGround({
    id: 'sof-team-generic',
    name: 'Équipe d’opérations spéciales (générique)',
    role: 'Opérations spéciales — reconnaissance en profondeur, résolue abstraitement',
    kind: 'sof',
    cruiseKmh: 0,
    joint: { combat: 0.05, spotKm: 15 },
  }),
};

interface GenericSurfaceInput {
  id: string;
  name: string;
  role: string;
  kind: UnitKind;
  domain: Domain;
  radarRangeKm: number;
  antennaHeightM: number;
  weaponRangeKm: number;
  weaponCount: number;
  cruiseKmh: number;
  /** Par défaut : missiles sol-air. */
  weapon?: WeaponKind;
  joint?: Partial<Record<JointStatKey, number>>;
}

function jointData(values: Partial<Record<JointStatKey, number>> | undefined): Partial<Record<JointStatKey, GameDatum>> | undefined {
  if (!values) return undefined;
  const out: Partial<Record<JointStatKey, GameDatum>> = {};
  for (const [key, value] of Object.entries(values)) out[key as JointStatKey] = EST(value, GENERIC_BASIS);
  return out;
}

function genericSurface(i: GenericSurfaceInput): PlatformRecord {
  const g = (v: number) => EST(v, GENERIC_BASIS);
  return {
    id: i.id,
    name: i.name,
    country: '—',
    manufacturer: '—',
    servicePeriod: 'Fictif',
    role: i.role,
    kind: i.kind,
    domain: i.domain,
    weapon: i.weapon ?? 'sam',
    coalition: 'générique',
    generic: true,
    // Un bâtiment de surface écoute les émissions radar ; un sous-marin en plongée, non.
    esm: i.domain === 'surface' && i.kind !== 'sub',
    joint: jointData(i.joint),
    loadouts: [],
    dataDate: DATA_DATE,
    sources: ['Aucune : matériel générique conçu pour le jeu'],
    reference: [],
    game: {
      cruiseKmh: g(i.cruiseKmh),
      dashKmh: g(i.cruiseKmh),
      ceilingM: NA,
      fuelCapacityKg: NA,
      burnCruiseKgMin: NA,
      burnDashKgMin: NA,
      transferFuelKg: NA,
      radarRangeKm: g(i.radarRangeKm),
      radarArcDeg: g(360),
      antennaHeightM: g(i.antennaHeightM),
      signature: g(i.domain === 'surface' ? 30 : 1),
      ecm: g(0),
      weaponRangeKm: g(i.weaponRangeKm),
      weaponCount: g(i.weaponCount),
      turnaroundMin: NA,
      asmRangeKm: NA,
      eoRangeKm: NA,
      reliability: g(1),
    },
  };
}

interface GenericGroundInput {
  id: string;
  name: string;
  role: string;
  kind: UnitKind;
  /** Vitesse de déplacement tout terrain, valeur de jeu. */
  cruiseKmh: number;
  joint: Partial<Record<JointStatKey, number>>;
}

/** Formation terrestre générique : ni radar ni missiles, elle se bat au contact (voir land-operations). */
function genericGround(i: GenericGroundInput): PlatformRecord {
  return genericSurface({
    id: i.id,
    name: i.name,
    role: i.role,
    kind: i.kind,
    domain: 'ground',
    radarRangeKm: 0,
    antennaHeightM: 0,
    weaponRangeKm: 0,
    weaponCount: 0,
    cruiseKmh: i.cruiseKmh,
    weapon: 'none',
    joint: i.joint,
  });
}

const COALITION_LABEL: Record<Coalition, string> = {
  occidentale: 'Matériels occidentaux',
  rouge: 'Matériels russes et chinois',
  générique: 'Matériels génériques (navals, sol-air, terrestres)',
};

const KIND_ORDER: readonly UnitKind[] = [
  'fighter', 'aew', 'tanker', 'drone',
  'carrier', 'ship', 'sub', 'amphib', 'supply',
  'sam', 'infantry', 'mech', 'armor', 'artillery', 'engineer', 'recon', 'logistics', 'hq', 'sof',
];
const KIND_RANK = Object.fromEntries(KIND_ORDER.map((kind, rank) => [kind, rank])) as Record<UnitKind, number>;

export interface LibraryGroup {
  coalition: Coalition;
  label: string;
  records: PlatformRecord[];
}

/** Bibliothèque classée pour une palette : par origine, puis par rôle, puis par nom. */
export function libraryGroups(): LibraryGroup[] {
  return (['occidentale', 'rouge', 'générique'] as const).map((coalition) => ({
    coalition,
    label: COALITION_LABEL[coalition],
    records: Object.values(PLATFORMS)
      .filter((r) => r.coalition === coalition)
      .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name, 'fr')),
  }));
}

export function getPlatform(id: string): PlatformRecord {
  const record = PLATFORMS[id];
  if (!record) throw new Error(`Matériel inconnu : ${id}`);
  return record;
}

export function hasPlatform(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLATFORMS, id);
}

/** Valeurs de jeu d'une fiche, sous la forme attendue par le moteur. */
export function toPerf(record: PlatformRecord): PlatformPerf {
  const g = record.game;
  const j = (key: JointStatKey): number => record.joint?.[key]?.value ?? 0;
  return {
    id: record.id,
    label: record.name,
    kind: record.kind,
    domain: record.domain,
    cruiseKmh: g.cruiseKmh.value,
    dashKmh: g.dashKmh.value,
    ceilingM: g.ceilingM.value,
    fuelCapacityKg: g.fuelCapacityKg.value,
    burnCruiseKgMin: g.burnCruiseKgMin.value,
    burnDashKgMin: g.burnDashKgMin.value,
    transferFuelKg: g.transferFuelKg.value,
    radarRangeKm: g.radarRangeKm.value,
    radarArcDeg: g.radarArcDeg.value,
    antennaHeightM: g.antennaHeightM.value,
    signature: g.signature.value,
    ecm: g.ecm.value,
    weapon: record.weapon,
    weaponRangeKm: g.weaponRangeKm.value,
    weaponCount: g.weaponCount.value,
    turnaroundMin: g.turnaroundMin.value,
    loadouts: record.loadouts.map((l) => ({ ...l })),
    asmRangeKm: g.asmRangeKm.value,
    eoRangeKm: g.eoRangeKm.value,
    esm: record.esm,
    reliability: g.reliability.value,
    combat: j('combat'),
    supportKm: j('supportKm'),
    support: j('support'),
    spotKm: j('spotKm'),
    cargo: j('cargo'),
    commandKm: j('commandKm'),
    sonarKm: j('sonarKm'),
    ssmRangeKm: j('ssmRangeKm'),
    ssmCount: j('ssmCount'),
    torpedoKm: j('torpedoKm'),
    torpedoCount: j('torpedoCount'),
    hull: j('hull'),
    deck: j('deck'),
    lift: j('lift'),
    carrierCapable: record.carrierCapable ?? false,
  };
}

export const JOINT_STAT_LABELS: Record<JointStatKey, { label: string; unit: string }> = {
  combat: { label: 'Puissance de combat (infanterie = 1)', unit: '' },
  supportKm: { label: 'Portée de l’appui indirect', unit: 'km' },
  support: { label: 'Puissance de l’appui indirect', unit: '' },
  spotKm: { label: 'Portée d’observation terrestre', unit: 'km' },
  cargo: { label: 'Ravitaillement transporté', unit: 'points' },
  commandKm: { label: 'Rayon de commandement', unit: 'km' },
  sonarKm: { label: 'Portée d’écoute sous-marine', unit: 'km' },
  ssmRangeKm: { label: 'Portée des missiles antinavires', unit: 'km' },
  ssmCount: { label: 'Missiles antinavires', unit: '' },
  torpedoKm: { label: 'Portée des torpilles', unit: 'km' },
  torpedoCount: { label: 'Torpilles', unit: '' },
  hull: { label: 'Points de coque', unit: '' },
  deck: { label: 'Aéronefs mis en œuvre', unit: '' },
  lift: { label: 'Formations transportables', unit: '' },
};

export const GAME_STAT_LABELS: Record<GameStatKey, { label: string; unit: string }> = {
  cruiseKmh: { label: 'Vitesse de croisière', unit: 'km/h' },
  dashKmh: { label: 'Vitesse rapide', unit: 'km/h' },
  ceilingM: { label: 'Plafond', unit: 'm' },
  fuelCapacityKg: { label: 'Carburant', unit: 'kg' },
  burnCruiseKgMin: { label: 'Consommation en croisière', unit: 'kg/min' },
  burnDashKgMin: { label: 'Consommation en régime rapide', unit: 'kg/min' },
  transferFuelKg: { label: 'Carburant transférable', unit: 'kg' },
  radarRangeKm: { label: 'Portée radar (signature 1)', unit: 'km' },
  radarArcDeg: { label: 'Secteur radar', unit: '°' },
  antennaHeightM: { label: 'Hauteur d’antenne', unit: 'm' },
  signature: { label: 'Signature relative', unit: '' },
  ecm: { label: 'Autoprotection', unit: '' },
  weaponRangeKm: { label: 'Portée des missiles', unit: 'km' },
  weaponCount: { label: 'Missiles emportés', unit: '' },
  turnaroundMin: { label: 'Remise en condition', unit: 'min' },
  asmRangeKm: { label: 'Portée des munitions air-surface', unit: 'km' },
  eoRangeKm: { label: 'Portée du capteur optronique', unit: 'km' },
  reliability: { label: 'Fiabilité par sortie', unit: '' },
};
