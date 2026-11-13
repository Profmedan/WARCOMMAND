/**
 * IA adverse — niveaux stratégique et opératif.
 *
 * Garantie structurelle : `aiDecide` ne reçoit que l'image de son camp (`SidePicture`), jamais
 * l'état complet. Elle ne peut donc ni voir une unité non détectée, ni agir autrement qu'en
 * émettant des ordres, validés par la même fonction que ceux du joueur.
 *
 *  - Stratégique : choisit une posture en comparant des utilités (doctrine, pertes, temps restant,
 *    renseignement), avec une part d'aléa qui dépend de la difficulté.
 *  - Opératif    : traduit la posture en missions (choix de station par utilité, relèves, chasse
 *    aux moyens de soutien, protection des siens, règles d'engagement).
 *  - Tactique    : comportements élémentaires des appareils, dans `air-operations` (communs aux deux camps).
 *
 * La difficulté ne donne à l'IA ni visibilité supplémentaire ni ressource cachée : elle ne
 * modifie que la qualité et la fréquence de ses décisions.
 */
import {
  bearingDeg,
  centroid,
  destination,
  distanceKm,
  type AiDecision,
  type AiMemory,
  type ContactView,
  type Difficulty,
  type LatLon,
  type Mission,
  type Roe,
  type SidePicture,
  type Unit,
} from '@warcommand/simulation-core';
import { missionWithinRange, scrambleDelayS, type Order } from '@warcommand/air-operations';
import type { LandOrder } from '@warcommand/land-operations';
import type { NavalOrder } from '@warcommand/naval-operations';
import type { EffectOrder } from '@warcommand/multi-domain-effects';
import { planJoint } from './joint';

export * from './joint';

/** Tout ordre qu'un commandant — joueur ou IA — peut donner, toutes composantes confondues. */
export type CommanderOrder = Order | LandOrder | NavalOrder | EffectOrder;

export interface AiTuning {
  /** Amplitude de l'aléa ajouté aux utilités. */
  noise: number;
  strategicIntervalS: number;
  operativeIntervalS: number;
  /** Nombre de stations candidates étudiées. */
  stations: 'center' | 'basic' | 'full';
  /** Chasse aux moyens de soutien adverses et protection des siens. */
  hvaPlay: boolean;
  /** Anticipation des relèves. */
  planRelief: boolean;
  /** Prise en compte des menaces sol-air connues : choix de station, et attaque de celles qui couvrent le secteur. */
  weighThreats: boolean;
  /** Patrouilles en silence radar lorsque l'avion-radar ami couvre la station. */
  emcon: boolean;
}

export const AI_TUNING: Record<Difficulty, AiTuning> = {
  recrue: { noise: 0.5, strategicIntervalS: 600, operativeIntervalS: 120, stations: 'center', hvaPlay: false, planRelief: false, weighThreats: false, emcon: false },
  standard: { noise: 0.2, strategicIntervalS: 300, operativeIntervalS: 60, stations: 'basic', hvaPlay: true, planRelief: true, weighThreats: true, emcon: false },
  veteran: { noise: 0.05, strategicIntervalS: 180, operativeIntervalS: 30, stations: 'full', hvaPlay: true, planRelief: true, weighThreats: true, emcon: true },
};

/** Hypothèse de planification de l'IA sur la portée d'une défense sol-air adverse qu'elle ne connaît pas. */
export const ASSUMED_SAM_RANGE_KM = 80;
/** Délai de prise de situation : l'IA laisse ses capteurs établir une première image avant de décider. */
export const INITIAL_ASSESSMENT_S = 150;
/** Une station est déplacée si une menace sol-air connue se trouve à moins de cette distance. */
const RESTATION_MIN_SHIFT_KM = 25;
const CAP_ALTITUDE_M = 9000;
/** Altitude d'approche d'une attaque de défense sol-air, sous l'horizon du radar visé. */
const SEAD_LOW_ALTITUDE_M = 500;
/** Délai avant de relancer une attaque sur la même défense. */
const SEAD_RETRY_S = 900;
/** Délai avant de relancer une escorte pour le même appareil. */
const ESCORT_RETRY_S = 600;
/** Un avion-radar ami « couvre » une station située à moins de cette fraction de sa portée. */
const AEW_COVER_FRACTION = 0.8;
/** En deçà de cette menace, une station est considérée comme tenable. */
const HOLD_THREAT_THRESHOLD = 0.05;
/** Attente maximale de l'effet d'une attaque avant d'installer une patrouille malgré tout. */
const HOLD_MAX_S = 2700;
const PAIR = 2;
const LOG_LIMIT = 300;

export type Posture = 'STANDING_CAP' | 'REINFORCED_CAP' | 'ROTATING_PRESENCE' | 'MASS_SWEEP' | 'HVA_HUNT' | 'WITHDRAW';

/** Postures qu'un scénario peut imposer à l'IA en début de partie, selon le rôle de son camp. */
export const INITIAL_POSTURES: Record<AiMemory['role'], readonly Posture[]> = {
  defender: ['STANDING_CAP', 'REINFORCED_CAP', 'WITHDRAW'],
  challenger: ['ROTATING_PRESENCE', 'MASS_SWEEP', 'WITHDRAW'],
};

export interface ForcedPosture {
  posture: string;
  /** Instant (secondes) jusqu'auquel la posture est tenue. */
  untilS: number;
}

export function createAiMemory(role: AiMemory['role'], difficulty: Difficulty, forced: ForcedPosture | null = null): AiMemory {
  return {
    difficulty,
    role,
    posture: null,
    nextWakeAt: INITIAL_ASSESSMENT_S,
    nextStrategicAt: 0,
    nextOperativeAt: 0,
    knownLosses: 0,
    knownHostileAct: false,
    forcedPosture: forced && forced.untilS > 0 ? forced.posture : null,
    forcedUntil: forced ? forced.untilS : 0,
    notes: {},
    log: [],
  };
}

interface Situation {
  fighters: Unit[];
  alive: Unit[];
  freeReady: Unit[];
  /** Chasseurs affectés à une mission, quelle qu'elle soit. */
  committed: Unit[];
  /** Chasseurs dont la mission dispute le secteur (patrouille, balayage, interception) : ni attaque, ni escorte. */
  presence: Unit[];
  lost: number;
  lossRatio: number;
  enemyFighters: ContactView[];
  enemyHva: ContactView[];
  enemyAirInSector: ContactView[];
  threatSites: ContactView[];
  hostileActSeen: boolean;
  timeLeft: number;
  secured: boolean;
  tankerAvailable: boolean;
  /** Positions des ravitailleurs amis utilisables. */
  tankers: LatLon[];
  /** Munitions air-surface disponibles : stocks des bases et emports des chasseurs prêts. */
  asmAvailable: number;
}

function assess(pic: SidePicture, mem: AiMemory): Situation {
  const fighters = pic.units.filter((u) => u.kind === 'fighter');
  const alive = fighters.filter((u) => u.status !== 'destroyed' && u.status !== 'maintenance' && !u.damaged);
  const lost = fighters.length - alive.length;
  const fresh = pic.contacts.filter((c) => !c.stale && c.domain === 'air');
  const o = pic.objective;
  const timeLeft = Math.max(0, pic.endTime - pic.time);
  const defenderSec = o.perceived.sec[o.defender];
  const freeReady = alive.filter((u) => u.status === 'ready' && u.missionId === null);
  const committed = alive.filter((u) => u.missionId !== null && u.task !== 'rtb');
  const tankers = pic.units.filter((u) => u.kind === 'tanker' && u.status === 'airborne' && u.task !== 'rtb' && u.transferKg > 0).map((u) => u.pos);
  return {
    fighters,
    alive,
    freeReady,
    committed,
    presence: committed.filter((u) => {
      const type = pic.missions.find((m) => m.id === u.missionId)?.type;
      return type === 'CAP' || type === 'SWEEP' || type === 'INTERCEPT';
    }),
    lost,
    lossRatio: fighters.length > 0 ? lost / fighters.length : 1,
    enemyFighters: fresh.filter((c) => c.identified && c.kind === 'fighter'),
    enemyHva: fresh.filter((c) => c.identified && (c.kind === 'aew' || c.kind === 'tanker')),
    enemyAirInSector: fresh.filter((c) => c.inSector && !c.damaged && (!c.identified || c.kind === 'fighter')),
    threatSites: pic.contacts.filter((c) => c.identified && (c.kind === 'ship' || c.kind === 'sam')),
    hostileActSeen: lost > 0 || pic.contacts.some((c) => c.hostileAct),
    timeLeft,
    secured:
      mem.role === 'defender' ? defenderSec >= o.defenderWinsAtSec : defenderSec + timeLeft < o.challengerWinsBelowSec,
    tankerAvailable: tankers.length > 0,
    tankers,
    asmAvailable: pic.bases.reduce((n, b) => n + b.asmStock, 0) + freeReady.reduce((n, u) => n + u.asm, 0),
  };
}

function record(mem: AiMemory, entry: AiDecision): void {
  mem.log.push(entry);
  if (mem.log.length > LOG_LIMIT) mem.log.splice(0, mem.log.length - LOG_LIMIT);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Niveau stratégique : utilité de chaque posture. Exporté pour les tests et la transparence. */
export function postureUtilities(pic: SidePicture, sit: Situation, mem: AiMemory, tuning: AiTuning): Record<string, number> {
  const d = pic.doctrine;
  const late = sit.timeLeft < 40 * 60 ? 1 : 0;
  const early = sit.timeLeft > 50 * 60 ? 1 : 0;
  const none = sit.alive.length === 0 ? 1 : 0;
  const secured = sit.secured ? 1 : 0;
  // Les pertes rendent toute posture de combat moins attrayante, d'autant plus que la doctrine
  // valorise la préservation des forces ; elles rendent le repli plus attrayant.
  const lossPenalty = sit.lossRatio * (0.3 + 0.5 * d.preservation);
  const withdraw = 0.05 + 0.9 * secured + sit.lossRatio ** 2 * (0.3 + 0.6 * d.preservation) + none;

  if (mem.role === 'defender') {
    const pressure = sit.enemyAirInSector.length >= 2 || sit.enemyFighters.length >= 3 ? 1 : 0;
    return {
      STANDING_CAP: 0.5 + 0.25 * (1 - d.masse) + 0.15 * d.preservation - lossPenalty,
      REINFORCED_CAP: 0.25 + 0.3 * d.masse + 0.45 * pressure + 0.1 * late - lossPenalty,
      WITHDRAW: withdraw,
    };
  }

  const outnumbered = sit.enemyFighters.length > sit.alive.length ? 1 : 0;
  const utilities: Record<string, number> = {
    MASS_SWEEP: 0.3 + 0.35 * d.masse + 0.2 * d.agressivite + 0.1 * late - lossPenalty - 0.15 * outnumbered,
    ROTATING_PRESENCE: 0.45 + 0.3 * (1 - d.masse) + 0.15 * d.preservation + 0.1 * early - lossPenalty,
    WITHDRAW: withdraw,
  };
  if (tuning.hvaPlay && sit.enemyHva.length > 0 && sit.freeReady.length >= PAIR) {
    utilities.HVA_HUNT = 0.25 + 0.45 * d.agressivite + (mem.difficulty === 'veteran' ? 0.15 : 0) - lossPenalty;
  }
  return utilities;
}

function chooseBest(utilities: Record<string, number>, noise: number, current: string | null, random: () => number): { choice: string; scored: Record<string, number> } {
  const scored: Record<string, number> = {};
  let choice = '';
  let best = -Infinity;
  for (const key of Object.keys(utilities)) {
    const value = utilities[key]! + (random() - 0.5) * noise + (key === current ? 0.08 : 0);
    scored[key] = round3(value);
    if (value > best) {
      best = value;
      choice = key;
    }
  }
  return { choice, scored };
}

interface Station {
  key: string;
  center: LatLon;
  waypoints: LatLon[];
}

function enemyAxis(pic: SidePicture): number {
  const c = pic.objective.center;
  const enemyBase = pic.enemyBases[0];
  if (enemyBase) return bearingDeg(c, enemyBase.pos);
  const ownBase = pic.bases[0];
  return ownBase ? (bearingDeg(c, ownBase.pos) + 180) % 360 : 0;
}

/** Menace que les défenses sol-air connues, non neutralisées, font peser sur un point (0 = aucune). */
function stationThreat(sit: Situation, point: LatLon): number {
  const reach = ASSUMED_SAM_RANGE_KM + 15;
  let threat = 0;
  for (const site of sit.threatSites) {
    if (site.damaged) continue;
    const dist = distanceKm(point, site.pos);
    if (dist < reach) threat += 0.8 * (1 - dist / reach);
  }
  return threat;
}

/** Stations candidates dans le secteur, selon l'étendue d'étude permise par la difficulté. */
function stationCandidates(pic: SidePicture, tuning: AiTuning): Record<string, LatLon> {
  const o = pic.objective;
  const axis = enemyAxis(pic);
  const r = o.radiusKm;
  const all: Record<string, LatLon> = {
    center: o.center,
    back: destination(o.center, axis + 180, 0.45 * r),
    forward: destination(o.center, axis, 0.4 * r),
    left: destination(o.center, axis - 90, 0.45 * r),
    right: destination(o.center, axis + 90, 0.45 * r),
  };
  const keys = tuning.stations === 'center' ? ['center'] : tuning.stations === 'basic' ? ['center', 'back', 'forward'] : Object.keys(all);
  return Object.fromEntries(keys.map((k) => [k, all[k]!]));
}

/** Niveau opératif : choix de la station de patrouille par utilité. */
function chooseStation(pic: SidePicture, sit: Situation, tuning: AiTuning, random: () => number): { station: Station; scored: Record<string, number> } {
  const axis = enemyAxis(pic);
  const all = stationCandidates(pic, tuning);
  const keys = Object.keys(all);
  const d = pic.doctrine;
  const ownShips = pic.units.filter((u) => u.kind === 'ship' && u.status === 'active');

  const utilities: Record<string, number> = {};
  for (const key of keys) {
    const p = all[key]!;
    let u = 1;
    if (tuning.weighThreats) u -= stationThreat(sit, p) * (0.5 + d.preservation);
    for (const ship of ownShips) {
      const cover = pic.platforms[ship.platformId]?.weaponRangeKm ?? 0;
      if (distanceKm(p, ship.pos) < cover) u += 0.3;
    }
    if (key === 'forward') u += 0.15 * d.agressivite - 0.1 * d.preservation;
    if (key === 'back') u += 0.1 * d.preservation;
    utilities[key] = u;
  }
  const { choice, scored } = chooseBest(utilities, tuning.noise * 0.5, null, random);
  const center = all[choice]!;
  const half = pic.rules.racetrackHalfKm;
  return {
    station: { key: choice, center, waypoints: [destination(center, axis + 90, half), destination(center, axis - 90, half)] },
    scored,
  };
}

function combatMissions(pic: SidePicture): Mission[] {
  return pic.missions.filter((m) => (m.type === 'CAP' || m.type === 'INTERCEPT') && (m.status === 'planned' || m.status === 'active'));
}

function members(pic: SidePicture, m: Mission): Unit[] {
  return pic.units.filter((u) => u.missionId === m.id);
}

function currentRoe(pic: SidePicture, mem: AiMemory, offensive: boolean): Roe {
  return offensive || mem.knownHostileAct ? 'free' : pic.defaultRoe;
}

/** Minutes de vol restantes avant le seuil de retour, pour un appareil en vol. */
function enduranceMin(pic: SidePicture, u: Unit): number {
  const p = pic.platforms[u.platformId];
  const base = pic.bases.find((b) => b.id === u.baseId);
  if (!p || !base || p.burnCruiseKgMin <= 0) return Infinity;
  const home = (distanceKm(u.pos, base.pos) / p.cruiseKmh) * 60 * p.burnCruiseKgMin * pic.rules.bingoMargin;
  const reserve = p.fuelCapacityKg * pic.rules.fuelReserveFraction;
  return (u.fuelKg - home - reserve) / p.burnCruiseKgMin;
}

function transitMin(pic: SidePicture, u: Unit, to: LatLon): number {
  const p = pic.platforms[u.platformId];
  const base = pic.bases.find((b) => b.id === u.baseId);
  if (!p || !base) return 0;
  return (distanceKm(base.pos, to) / p.cruiseKmh) * 60 + scrambleDelayS(pic.rules, pic.doctrine) / 60;
}

interface Plan {
  pic: SidePicture;
  sit: Situation;
  mem: AiMemory;
  tuning: AiTuning;
  random: () => number;
  orders: Order[];
  /** Chasseurs prêts non encore affectés par ce cycle de décision. */
  pool: Unit[];
}

function launchCap(plan: Plan, n: number, offensive: boolean, reason: string, reuse: Mission | null): void {
  const units = plan.pool.splice(0, n);
  if (units.length === 0) return;
  let waypoints: LatLon[];
  let stationKey = 'reprise';
  let scored: Record<string, number> = {};
  if (reuse && reuse.waypoints.length > 0) {
    waypoints = reuse.waypoints;
  } else {
    const pick = chooseStation(plan.pic, plan.sit, plan.tuning, plan.random);
    waypoints = pick.station.waypoints;
    stationKey = pick.station.key;
    scored = pick.scored;
  }
  // Silence radar si la difficulté le prévoit et qu'un avion-radar ami voit pour la patrouille.
  const emcon = plan.tuning.emcon && aewCovers(plan.pic, centroid(waypoints));
  plan.orders.push({
    type: 'CREATE_MISSION',
    side: plan.pic.side,
    draft: {
      type: 'CAP',
      unitIds: units.map((u) => u.id),
      waypoints,
      altM: CAP_ALTITUDE_M,
      speed: 'cruise',
      launchAt: plan.pic.time,
      endAt: null,
      roe: currentRoe(plan.pic, plan.mem, offensive),
      allowRefuel: plan.sit.tankerAvailable,
      targetContactId: null,
      emcon,
    },
  });
  plan.mem.notes.lastLaunchAt = plan.pic.time;
  record(plan.mem, { t: plan.pic.time, level: 'operative', code: 'LAUNCH_CAP', p: { n: units.length, station: stationKey, reason, emcon: emcon ? 1 : 0 }, utilities: scored });
}

/** Un avion-radar ami en vol couvre-t-il ce point ? */
function aewCovers(pic: SidePicture, point: LatLon): boolean {
  return pic.units.some((u) => {
    if (u.kind !== 'aew' || u.status !== 'airborne' || u.task === 'rtb') return false;
    const range = pic.platforms[u.platformId]?.radarRangeKm ?? 0;
    return distanceKm(u.pos, point) <= range * AEW_COVER_FRACTION;
  });
}

/**
 * Altitude à laquelle ces appareils peuvent atteindre la cible et rentrer : basse si possible
 * (sous l'horizon du radar visé), haute sinon ; `null` si la cible est hors de portée.
 */
function reachableAltitude(plan: Plan, units: Unit[], target: LatLon): number | null {
  const { pic, sit } = plan;
  for (const altM of [SEAD_LOW_ALTITUDE_M, CAP_ALTITUDE_M]) {
    const ok = units.every((u) => {
      const perf = pic.platforms[u.platformId];
      const base = pic.bases.find((b) => b.id === u.baseId);
      if (!perf || !base) return false;
      return missionWithinRange({
        perf,
        rules: pic.rules,
        fuelKg: perf.fuelCapacityKg,
        origin: base.pos,
        target,
        home: base.pos,
        altM,
        tankers: sit.tankerAvailable ? sit.tankers : null,
      });
    });
    if (ok) return altM;
  }
  return null;
}

/**
 * Attaque d'une défense sol-air connue dont la portée supposée mord sur le secteur.
 * L'IA garde toujours une paire pour disputer le secteur lui-même.
 */
function planSead(plan: Plan): void {
  const { pic, sit, mem, tuning } = plan;
  if (!tuning.weighThreats || sit.asmAvailable < PAIR) return;
  // Une seule attaque à la fois : le reste des chasseurs sert à disputer le secteur.
  if (seadInProgress(pic)) return;
  const keepsPresence = plan.pool.length >= 2 * PAIR || (plan.pool.length >= PAIR && sit.presence.length >= PAIR);
  if (!keepsPresence) return;

  const o = pic.objective;
  const target = sit.threatSites
    .filter((c) => !c.damaged && (c.kind === 'sam' || !c.stale))
    .filter((c) => distanceKm(c.pos, o.center) < o.radiusKm + ASSUMED_SAM_RANGE_KM)
    .filter((c) => {
      const last = mem.notes[`sead:${c.id}`];
      return last === undefined || pic.time - last >= SEAD_RETRY_S;
    })
    .sort((a, b) => distanceKm(a.pos, o.center) - distanceKm(b.pos, o.center))[0];
  if (!target) return;

  const units = plan.pool.slice(0, PAIR);
  if (!units.every((u) => pic.platforms[u.platformId]?.loadouts.some((l) => l.asm > 0))) return;
  mem.notes[`sead:${target.id}`] = pic.time;
  const altM = reachableAltitude(plan, units, target.pos);
  if (altM === null) return;

  plan.pool.splice(0, PAIR);
  plan.orders.push({
    type: 'CREATE_MISSION',
    side: pic.side,
    draft: {
      type: 'SEAD',
      unitIds: units.map((u) => u.id),
      waypoints: [],
      altM,
      speed: 'cruise',
      launchAt: pic.time,
      endAt: null,
      roe: 'free',
      allowRefuel: sit.tankerAvailable,
      targetContactId: target.id,
    },
  });
  mem.notes.lastLaunchAt = pic.time;
  record(mem, { t: pic.time, level: 'operative', code: 'LAUNCH_SEAD', p: { n: units.length, contact: target.id, altitude: altM }, utilities: {} });

  // Coordination : s'il reste assez de chasseurs, une paire accompagne l'attaque (tir libre) et part
  // en même temps qu'elle ; une autre paire reste en réserve pour le secteur.
  if (plan.pool.length >= 2 * PAIR) {
    const rearm = units.some((u) => (pic.platforms[u.platformId]?.loadouts.find((l) => l.id === u.loadoutId)?.asm ?? 0) === 0);
    launchEscort(plan, units[0]!, PAIR, { roe: 'free', launchAt: pic.time + (rearm ? pic.rules.rearmDelayS : 0), reason: 'attaque' });
  }
}

function seadInProgress(pic: SidePicture): boolean {
  return pic.missions.some((m) => m.type === 'SEAD' && (m.status === 'planned' || m.status === 'active'));
}

/**
 * Séquencement : si toutes les stations étudiées sont sous la menace de défenses connues et qu'une
 * attaque de ces défenses est en cours, l'IA n'installe pas de nouvelle patrouille avant qu'elle
 * ait porté — une seule fois par partie, et dans la limite d'un délai d'attente.
 */
function holdForSead(plan: Plan): boolean {
  const { pic, sit, mem, tuning } = plan;
  if (!tuning.weighThreats || plan.pool.length === 0 || mem.notes.holdDone !== undefined) return false;
  const inProgress = seadInProgress(pic);
  // L'attaque attendue est terminée : on n'attendra plus, même si une autre est lancée ensuite.
  if (mem.notes.holdSince !== undefined && !inProgress) {
    mem.notes.holdDone = pic.time;
    return false;
  }
  const justOrdered = plan.orders.some((o) => o.type === 'CREATE_MISSION' && o.draft.type === 'SEAD');
  if (!inProgress && !justOrdered) return false;
  const safest = Math.min(...Object.values(stationCandidates(pic, tuning)).map((p) => stationThreat(sit, p)));
  if (safest <= HOLD_THREAT_THRESHOLD) return false;
  const since = (mem.notes.holdSince ??= pic.time);
  if (pic.time - since > HOLD_MAX_S) return false;
  if (mem.notes.holdLogged === undefined) {
    mem.notes.holdLogged = pic.time;
    record(mem, { t: pic.time, level: 'operative', code: 'HOLD_FOR_SEAD', p: { waiting: plan.pool.length }, utilities: {} });
  }
  return true;
}

interface EscortOptions {
  roe: Roe;
  launchAt: number;
  /** soutien : protection d'un avion-radar ou d'un ravitailleur menacé · attaque : accompagnement d'une attaque. */
  reason: 'soutien' | 'attaque';
}

function launchEscort(plan: Plan, asset: Unit, n: number, options: EscortOptions): void {
  const units = plan.pool.splice(0, n);
  if (units.length === 0) return;
  plan.orders.push({
    type: 'CREATE_MISSION',
    side: plan.pic.side,
    draft: {
      type: 'ESCORT',
      unitIds: units.map((u) => u.id),
      waypoints: [],
      altM: CAP_ALTITUDE_M,
      speed: 'cruise',
      launchAt: options.launchAt,
      endAt: null,
      roe: options.roe,
      allowRefuel: plan.sit.tankerAvailable,
      targetContactId: null,
      escortUnitId: asset.id,
    },
  });
  plan.mem.notes[`escort:${asset.id}`] = plan.pic.time;
  plan.mem.notes.lastLaunchAt = plan.pic.time;
  record(plan.mem, { t: plan.pic.time, level: 'operative', code: 'LAUNCH_ESCORT', p: { n: units.length, unit: asset.name, reason: options.reason }, utilities: {} });
}

function launchIntercept(plan: Plan, contact: ContactView, n: number, reason: string): void {
  const units = plan.pool.splice(0, n);
  if (units.length === 0) return;
  plan.orders.push({
    type: 'CREATE_MISSION',
    side: plan.pic.side,
    draft: {
      type: 'INTERCEPT',
      unitIds: units.map((u) => u.id),
      waypoints: [],
      altM: CAP_ALTITUDE_M,
      speed: 'cruise',
      launchAt: plan.pic.time,
      endAt: null,
      roe: 'free',
      allowRefuel: plan.sit.tankerAvailable,
      targetContactId: contact.id,
    },
  });
  plan.mem.notes[`intercept:${contact.id}`] = plan.pic.time;
  plan.mem.notes.lastLaunchAt = plan.pic.time;
  record(plan.mem, { t: plan.pic.time, level: 'operative', code: 'LAUNCH_INTERCEPT', p: { n: units.length, contact: contact.id, reason }, utilities: {} });
}

/** Présence continue : maintenir `desired` chasseurs engagés et préparer les relèves. */
function sustainPresence(plan: Plan, desired: number, offensive: boolean): void {
  const { pic, sit, mem, tuning } = plan;
  const caps = combatMissions(pic).filter((m) => m.type === 'CAP');
  const engaged = sit.presence.length;

  if (engaged < desired && plan.pool.length > 0) {
    launchCap(plan, Math.min(desired - engaged, plan.pool.length), offensive, engaged === 0 ? 'presence' : 'complement', caps[0] ?? null);
    return;
  }
  if (!tuning.planRelief || plan.pool.length === 0) return;

  for (const m of caps) {
    if (m.status !== 'active' || mem.notes[`relief:${m.id}`] !== undefined) continue;
    const flying = members(pic, m).filter((u) => u.status === 'airborne');
    if (flying.length === 0) continue;
    const station = centroid(m.waypoints);
    const lead = flying[0]!;
    const capacity = pic.platforms[lead.platformId]?.fuelCapacityKg ?? 1;
    const lowFuel = m.allowRefuel
      ? flying.some((u) => u.fuelKg / capacity < pic.rules.refuelTriggerFraction + 0.07)
      : Math.min(...flying.map((u) => enduranceMin(pic, u))) < transitMin(pic, lead, station) + 3;
    const lowWeapons = flying.every((u) => u.weapons <= 1);
    if (lowFuel || lowWeapons) {
      mem.notes[`relief:${m.id}`] = pic.time;
      launchCap(plan, Math.min(PAIR, plan.pool.length), offensive, lowWeapons ? 'releve_munitions' : 'releve_carburant', m);
      return;
    }
  }
}

function protectSupport(plan: Plan): void {
  const { pic, sit, mem } = plan;
  if (!plan.tuning.hvaPlay || plan.pool.length === 0) return;
  // L'avion-radar passe avant le ravitailleur ; une seule escorte de soutien à la fois, et jamais
  // au prix de la dernière paire, qui doit rester disponible pour le secteur.
  const assets = pic.units
    .filter((u) => (u.kind === 'aew' || u.kind === 'tanker') && u.status === 'airborne' && u.task !== 'rtb')
    .sort((a, b) => (a.kind === 'aew' ? 0 : 1) - (b.kind === 'aew' ? 0 : 1));
  const supportIds = new Set(assets.map((u) => u.id));
  const alreadyEscorting = pic.missions.some(
    (m) => m.type === 'ESCORT' && m.escortUnitId !== null && supportIds.has(m.escortUnitId) && (m.status === 'planned' || m.status === 'active'),
  );
  const keepsPresence = plan.pool.length >= 2 * PAIR || (plan.pool.length >= PAIR && sit.presence.length >= PAIR);
  if (alreadyEscorting || !keepsPresence) return;
  for (const asset of assets) {
    const last = mem.notes[`escort:${asset.id}`];
    if (last !== undefined && pic.time - last < ESCORT_RETRY_S) continue;
    const threat = sit.enemyFighters.find((c) => distanceKm(asset.pos, c.pos) <= 220);
    if (!threat) continue;
    const covered = sit.committed.some((u) => u.status === 'airborne' && distanceKm(u.pos, asset.pos) < 120);
    if (covered) continue;
    launchEscort(plan, asset, Math.min(PAIR, plan.pool.length), { roe: currentRoe(pic, mem, false), launchAt: pic.time, reason: 'soutien' });
    return;
  }
}

/**
 * Réaction au renseignement : si une défense sol-air adverse identifiée menace la station d'une
 * patrouille, l'IA cherche une meilleure station et y renvoie les appareils en vol.
 */
function restation(plan: Plan): void {
  const { pic, sit, mem, tuning } = plan;
  if (!tuning.weighThreats || sit.threatSites.length === 0) return;
  const reach = ASSUMED_SAM_RANGE_KM + 15;
  for (const m of combatMissions(pic)) {
    if (m.type !== 'CAP' || m.status !== 'active' || m.waypoints.length === 0) continue;
    const station = centroid(m.waypoints);
    const threat = sit.threatSites.find((site) => distanceKm(station, site.pos) < reach && mem.notes[`restation:${m.id}:${site.id}`] === undefined);
    if (!threat) continue;
    mem.notes[`restation:${m.id}:${threat.id}`] = pic.time;
    const flying = members(pic, m).filter((u) => u.status === 'airborne' && u.task !== 'rtb' && !u.damaged);
    if (flying.length === 0) continue;
    const pick = chooseStation(pic, sit, tuning, plan.random);
    if (distanceKm(pick.station.center, station) < RESTATION_MIN_SHIFT_KM) continue;
    plan.orders.push({
      type: 'CREATE_MISSION',
      side: pic.side,
      draft: {
        type: 'CAP',
        unitIds: flying.map((u) => u.id),
        waypoints: pick.station.waypoints,
        altM: m.altM,
        speed: 'cruise',
        launchAt: pic.time,
        endAt: m.endAt,
        roe: m.roe,
        allowRefuel: m.allowRefuel,
        targetContactId: null,
      },
    });
    record(mem, { t: pic.time, level: 'operative', code: 'RESTATION', p: { mission: m.name, station: pick.station.key, threat: threat.id }, utilities: pick.scored });
  }
}

function withdraw(plan: Plan): void {
  const active = combatMissions(plan.pic);
  if (active.length === 0) return;
  for (const m of active) plan.orders.push({ type: 'CANCEL_MISSION', side: plan.pic.side, missionId: m.id });
  record(plan.mem, { t: plan.pic.time, level: 'operative', code: 'WITHDRAW', p: { missions: active.length }, utilities: {} });
}

function planOperations(plan: Plan): void {
  const { pic, sit, mem } = plan;
  const posture = mem.posture as Posture;

  if (posture === 'WITHDRAW') {
    withdraw(plan);
    return;
  }

  // Après un acte hostile constaté, les missions de combat passent en tir libre.
  if (mem.knownHostileAct) {
    for (const m of combatMissions(pic)) {
      if (m.roe !== 'free') plan.orders.push({ type: 'SET_ROE', side: pic.side, missionId: m.id, roe: 'free' });
    }
  }

  restation(plan);
  protectSupport(plan);
  planSead(plan);
  if (holdForSead(plan)) return;

  switch (posture) {
    case 'STANDING_CAP':
      sustainPresence(plan, PAIR, false);
      break;
    case 'ROTATING_PRESENCE':
      sustainPresence(plan, PAIR, false);
      break;
    case 'REINFORCED_CAP':
    case 'MASS_SWEEP': {
      const offensive = posture === 'MASS_SWEEP';
      const enough = plan.pool.length >= Math.min(PAIR, sit.alive.length) || sit.presence.length > 0;
      if (plan.pool.length > 0 && enough) {
        const caps = combatMissions(pic).filter((m) => m.type === 'CAP');
        launchCap(plan, plan.pool.length, offensive, sit.presence.length === 0 ? 'masse' : 'renfort', caps[0] ?? null);
      }
      break;
    }
    case 'HVA_HUNT': {
      const target = sit.enemyHva.find((c) => mem.notes[`intercept:${c.id}`] === undefined);
      if (target && plan.pool.length >= PAIR) launchIntercept(plan, target, PAIR, 'chasse_soutien');
      sustainPresence(plan, PAIR, true);
      break;
    }
  }
}

/**
 * Cycle de décision de l'IA. `mem` est modifiée (mémoire et journal des décisions) ;
 * les ordres retournés doivent être soumis à `applyOrder`.
 */
export function aiDecide(pic: SidePicture, mem: AiMemory, random: () => number): CommanderOrder[] {
  if (pic.ended) return [];
  const tuning = AI_TUNING[mem.difficulty];
  const tempo = 1.4 - 0.8 * pic.doctrine.tempo;
  const sit = assess(pic, mem);

  const newLoss = sit.lost > mem.knownLosses;
  mem.knownLosses = sit.lost;
  const newHostility = sit.hostileActSeen && !mem.knownHostileAct;
  if (newHostility) {
    mem.knownHostileAct = true;
    record(mem, { t: pic.time, level: 'operative', code: 'ROE_FREE', p: {}, utilities: {} });
  }

  // Posture imposée par le scénario : tenue jusqu'à son échéance, puis l'IA reprend sa liberté.
  const lockExpired = mem.forcedPosture !== null && pic.time >= mem.forcedUntil;
  if (lockExpired) mem.forcedPosture = null;

  let postureChanged = false;
  if (mem.posture === null || pic.time >= mem.nextStrategicAt || newLoss || lockExpired) {
    const utilities = postureUtilities(pic, sit, mem, tuning);
    const free = chooseBest(utilities, tuning.noise, mem.posture, random);
    const forced = mem.forcedPosture;
    const choice = forced ?? free.choice;
    if (choice !== mem.posture) {
      postureChanged = true;
      mem.posture = choice;
      record(mem, { t: pic.time, level: 'strategic', code: 'POSTURE', p: forced ? { posture: choice, forced: 1 } : { posture: choice }, utilities: free.scored });
    }
    mem.nextStrategicAt = pic.time + Math.round(tuning.strategicIntervalS * tempo);
  }

  // Composantes terrestre, navale et multi-domaines ; les chasseurs retenus pour l'appui sortent du vivier aérien.
  const joint = planJoint(pic, mem, (entry) => record(mem, entry));

  const orders: Order[] = [];
  if (postureChanged || newLoss || newHostility || pic.time >= mem.nextOperativeAt) {
    planOperations({ pic, sit, mem, tuning, random, orders, pool: sit.freeReady.filter((u) => !joint.reserved.includes(u.id)) });
    mem.nextOperativeAt = pic.time + Math.round(tuning.operativeIntervalS * tempo);
  }
  return [...joint.orders, ...orders];
}
