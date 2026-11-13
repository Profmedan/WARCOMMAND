/**
 * Ordres : la seule porte d'entrée pour agir sur la simulation.
 * Le joueur et l'IA passent par `applyOrder`, qui valide avant d'appliquer.
 */
import {
  destination,
  emit,
  inBounds,
  inCircle,
  isLand,
  isNaval,
  isSurfaceShip,
  pathAtSea,
  type LatLon,
  type Loadout,
  type Mission,
  type MissionType,
  type Roe,
  type SideId,
  type SimState,
  type SpeedMode,
  type Unit,
  type UnitKind,
} from '@warcommand/simulation-core';
import { airOrderDelayS, baseOf, membersOf, orderRtb, perfOf } from './helpers';
import { missionWithinRange, usableTankers } from './planning';

export interface MissionDraft {
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
  name?: string;
  /** Emport demandé ; par défaut l'emport en cours, ou l'emport air-surface pour une mission SEAD. */
  loadoutId?: string | null;
  /** Silence radar pendant la mission. */
  emcon?: boolean;
  /** Unité amie à protéger (mission d'escorte). */
  escortUnitId?: string | null;
}

export type Order =
  | { type: 'CREATE_MISSION'; side: SideId; draft: MissionDraft }
  | { type: 'CANCEL_MISSION'; side: SideId; missionId: string }
  | { type: 'SET_ROE'; side: SideId; missionId: string; roe: Roe }
  | { type: 'RTB_UNIT'; side: SideId; unitId: string }
  | { type: 'MOVE_SHIP'; side: SideId; unitId: string; dest: LatLon };

export type RejectCode =
  | 'MISSION_OVER'
  | 'NO_UNITS'
  | 'DUPLICATE_UNIT'
  | 'UNKNOWN_UNIT'
  | 'WRONG_SIDE'
  | 'WRONG_KIND'
  | 'UNIT_UNAVAILABLE'
  | 'NO_WAYPOINT'
  | 'TOO_MANY_WAYPOINTS'
  | 'OUT_OF_THEATER'
  | 'BAD_ALTITUDE'
  | 'BAD_TIME'
  | 'OUT_OF_RANGE'
  | 'UNKNOWN_CONTACT'
  | 'UNKNOWN_MISSION'
  | 'NOT_AIRBORNE'
  | 'NOT_A_SHIP'
  | 'OUT_OF_NAVAL_ZONE'
  | 'NOT_AT_SEA'
  | 'BASE_CLOSED'
  | 'NO_ORDNANCE'
  | 'BAD_LOADOUT'
  | 'BAD_ESCORT'
  | 'NOT_PLANNING_PHASE';

export type OrderResult = { ok: true; missionId?: string } | { ok: false; code: RejectCode; unitId?: string };

export const MISSION_KIND: Record<MissionType, UnitKind> = {
  CAP: 'fighter',
  INTERCEPT: 'fighter',
  SWEEP: 'fighter',
  ESCORT: 'fighter',
  SEAD: 'fighter',
  CAS: 'fighter',
  AEW: 'aew',
  TANKER: 'tanker',
  RECON: 'drone',
};

export const MISSION_PREFIX: Record<MissionType, string> = {
  CAP: 'CAP',
  INTERCEPT: 'INT',
  SWEEP: 'BAL',
  ESCORT: 'ESC',
  SEAD: 'SEAD',
  CAS: 'APP',
  AEW: 'AEW',
  TANKER: 'RAV',
  RECON: 'REC',
};

/** Missions qui délivrent des munitions air-surface : attaque des défenses ou des bâtiments, appui rapproché. */
export const isStrikeMission = (type: MissionType): boolean => type === 'SEAD' || type === 'CAS';

export const MAX_WAYPOINTS = 8;
export const MIN_ALTITUDE_M = 150;

const reject = (code: RejectCode, unitId?: string): OrderResult => ({ ok: false, code, unitId });

/**
 * Emport qu'un ordre impose à un appareil. `change` est l'emport à monter (appareil au sol
 * uniquement), ou `null` s'il garde le sien.
 */
function loadoutPlan(s: SimState, u: Unit, d: MissionDraft): { change: Loadout | null } | RejectCode {
  const p = perfOf(s, u);
  const strike = isStrikeMission(d.type);
  const wantedId = d.loadoutId ?? (strike ? (p.loadouts.find((l) => l.asm > 0)?.id ?? null) : null);
  if (wantedId === null) return strike ? 'NO_ORDNANCE' : { change: null };
  const wanted = p.loadouts.find((l) => l.id === wantedId);
  if (!wanted) return 'BAD_LOADOUT';

  if (u.status === 'airborne') {
    // En vol, on fait avec ce que l'on emporte.
    if (strike) return u.asm > 0 ? { change: null } : 'NO_ORDNANCE';
    return wantedId === u.loadoutId ? { change: null } : 'BAD_LOADOUT';
  }
  const base = baseOf(s, u);
  const carried = u.loadoutId === wantedId ? u.asm : 0;
  if (strike && carried + (base?.asmStock ?? 0) <= 0) return 'NO_ORDNANCE';
  return { change: wantedId === u.loadoutId ? null : wanted };
}

/**
 * Monte un nouvel emport sur un appareil au sol : l'ancien retourne au stock, le nouveau en sort.
 * `sharers` est le nombre d'appareils de la mission qui attendent encore des munitions air-surface
 * de cette base : un stock insuffisant est réparti entre eux.
 */
function swapLoadout(s: SimState, u: Unit, loadout: Loadout, sharers: number): void {
  const base = baseOf(s, u);
  if (!base) return;
  base.weaponStock += u.weapons;
  base.asmStock += u.asm;
  u.weapons = Math.min(loadout.aam, base.weaponStock);
  base.weaponStock -= u.weapons;
  u.asm = Math.min(loadout.asm, Math.ceil(base.asmStock / Math.max(1, sharers)));
  base.asmStock -= u.asm;
  u.loadoutId = loadout.id;
  if (u.status === 'ready') u.availableAt = s.time + s.rules.rearmDelayS;
}

function validateMission(s: SimState, side: SideId, d: MissionDraft): OrderResult {
  if (d.unitIds.length === 0) return reject('NO_UNITS');
  if (new Set(d.unitIds).size !== d.unitIds.length) return reject('DUPLICATE_UNIT');
  if (!Number.isFinite(d.launchAt) || d.launchAt >= s.endTime) return reject('BAD_TIME');
  if (d.endAt !== null && (!Number.isFinite(d.endAt) || d.endAt <= Math.max(d.launchAt, s.time))) return reject('BAD_TIME');

  let target: LatLon;
  if (d.type === 'INTERCEPT') {
    const contact = d.targetContactId ? s.contacts[side][d.targetContactId] : undefined;
    if (!contact || contact.domain !== 'air') return reject('UNKNOWN_CONTACT');
    target = contact.pos;
  } else if (d.type === 'SEAD') {
    const contact = d.targetContactId ? s.contacts[side][d.targetContactId] : undefined;
    // Cible d'une attaque : un site sol-air, ou un bâtiment de surface quel qu'il soit.
    if (!contact || !contact.identified || contact.kind === null || (contact.kind !== 'sam' && !isSurfaceShip(contact.kind))) return reject('UNKNOWN_CONTACT');
    target = contact.pos;
  } else if (d.type === 'ESCORT') {
    const escorted = d.escortUnitId ? s.units[d.escortUnitId] : undefined;
    const valid =
      escorted !== undefined &&
      escorted.side === side &&
      escorted.domain === 'air' &&
      !d.unitIds.includes(escorted.id) &&
      escorted.status !== 'destroyed' &&
      escorted.status !== 'maintenance' &&
      (escorted.status === 'airborne' || escorted.missionId !== null);
    if (!valid) return reject('BAD_ESCORT');
    target = escorted.pos;
  } else {
    if (d.waypoints.length === 0) return reject('NO_WAYPOINT');
    if (d.waypoints.length > MAX_WAYPOINTS) return reject('TOO_MANY_WAYPOINTS');
    for (const wp of d.waypoints) {
      if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon) || !inBounds(wp, s.theater)) return reject('OUT_OF_THEATER');
    }
    target = d.waypoints[0]!;
  }

  for (const id of d.unitIds) {
    const u = s.units[id];
    if (!u) return reject('UNKNOWN_UNIT', id);
    if (u.side !== side) return reject('WRONG_SIDE', id);
    if (u.kind !== MISSION_KIND[d.type]) return reject('WRONG_KIND', id);
    if (u.damaged || u.status === 'destroyed' || u.status === 'maintenance' || u.status === 'active') {
      return reject('UNIT_UNAVAILABLE', id);
    }
    if (u.status === 'turnaround' && (u.readyAt === null || u.readyAt > Math.max(d.launchAt, s.time))) {
      return reject('UNIT_UNAVAILABLE', id);
    }
    if (u.status === 'airborne' && u.task === 'rtb' && u.rtbReason !== 'order' && u.rtbReason !== 'mission_end') {
      return reject('UNIT_UNAVAILABLE', id);
    }
    const p = perfOf(s, u);
    if (!Number.isFinite(d.altM) || d.altM < MIN_ALTITUDE_M || d.altM > p.ceilingM) return reject('BAD_ALTITUDE', id);
    const plan = loadoutPlan(s, u, d);
    if (typeof plan === 'string') return reject(plan, id);

    // Rayon d'action : aller jusqu'au premier point puis rentrer — au besoin en passant par un ravitailleur.
    const base = baseOf(s, u);
    if (!base) return reject('UNIT_UNAVAILABLE', id);
    const airborne = u.status === 'airborne';
    // Un pont d'envol fermé ne lance plus personne.
    if (!airborne && base.closed) return reject('BASE_CLOSED', id);
    const reachable = missionWithinRange({
      perf: p,
      rules: s.rules,
      fuelKg: airborne ? u.fuelKg : p.fuelCapacityKg,
      origin: airborne ? u.pos : base.pos,
      target,
      home: base.pos,
      altM: d.altM,
      tankers: d.allowRefuel ? usableTankers(s, side) : null,
    });
    if (!reachable) return reject('OUT_OF_RANGE', id);
  }
  return { ok: true };
}

/** Vérifie un ordre sans rien modifier. */
export function validateOrder(s: SimState, order: Order): OrderResult {
  if (s.outcome) return reject('MISSION_OVER');
  switch (order.type) {
    case 'CREATE_MISSION':
      return validateMission(s, order.side, order.draft);
    case 'CANCEL_MISSION':
    case 'SET_ROE': {
      const m = s.missions[order.missionId];
      if (!m || m.side !== order.side || (m.status !== 'planned' && m.status !== 'active')) return reject('UNKNOWN_MISSION');
      return { ok: true };
    }
    case 'RTB_UNIT': {
      const u = s.units[order.unitId];
      if (!u) return reject('UNKNOWN_UNIT', order.unitId);
      if (u.side !== order.side) return reject('WRONG_SIDE', order.unitId);
      if (u.status !== 'airborne') return reject('NOT_AIRBORNE', order.unitId);
      return { ok: true };
    }
    case 'MOVE_SHIP': {
      const u = s.units[order.unitId];
      if (!u) return reject('UNKNOWN_UNIT', order.unitId);
      if (u.side !== order.side) return reject('WRONG_SIDE', order.unitId);
      if (!isNaval(u.kind)) return reject('NOT_A_SHIP', order.unitId);
      if (u.status !== 'active') return reject('UNIT_UNAVAILABLE', order.unitId);
      const zone = s.navalZones[order.side];
      if (!zone || !Number.isFinite(order.dest.lat) || !Number.isFinite(order.dest.lon) || !inCircle(order.dest, zone)) {
        return reject('OUT_OF_NAVAL_ZONE', order.unitId);
      }
      // Pas de trajet physiquement impossible : un bâtiment reste en mer, de bout en bout.
      if (isLand(order.dest) || !pathAtSea(u.pos, order.dest)) return reject('NOT_AT_SEA', order.unitId);
      return { ok: true };
    }
  }
}

/** Clôt une mission qui n'a plus aucun appareil affecté. */
export function closeMissionIfEmpty(s: SimState, m: Mission): void {
  if (m.status !== 'planned' && m.status !== 'active') return;
  if (membersOf(s, m).length > 0) return;
  if (m.status === 'planned') {
    m.status = 'cancelled';
    emit(s, 'MISSION_CANCELLED', [m.side], { mission: m.name });
  } else {
    m.status = 'completed';
    emit(s, 'MISSION_ENDED', [m.side], { mission: m.name });
  }
}

/** Un point unique devient un circuit d'attente est-ouest de deux points. */
function stationPattern(s: SimState, waypoints: LatLon[]): LatLon[] {
  if (waypoints.length !== 1) return waypoints.map((w) => ({ lat: w.lat, lon: w.lon }));
  const c = waypoints[0]!;
  const half = s.rules.racetrackHalfKm;
  return [destination(c, 270, half), destination(c, 90, half)];
}

/** Valide puis applique un ordre. En cas de refus, l'état n'est pas modifié. */
export function applyOrder(s: SimState, order: Order): OrderResult {
  const check = validateOrder(s, order);
  if (!check.ok) return check;

  switch (order.type) {
    case 'CREATE_MISSION': {
      const d = order.draft;
      const side = order.side;
      const seq = (s.missionSeq[side][d.type] += 1);
      const id = `${side}-${d.type}-${seq}`;
      const units = d.unitIds.map((uid) => s.units[uid]!);
      const targeted = d.type === 'INTERCEPT' || d.type === 'SEAD';
      const routed = !targeted && d.type !== 'ESCORT';
      const loop = d.type !== 'SWEEP';
      const changes = units.map((u) => {
        const plan = loadoutPlan(s, u, d);
        return typeof plan === 'string' ? null : plan.change;
      });
      const waiting = new Map<string, number>();
      units.forEach((u, i) => {
        if (changes[i] && changes[i].asm > 0 && u.baseId) waiting.set(u.baseId, (waiting.get(u.baseId) ?? 0) + 1);
      });
      units.forEach((u, i) => {
        const change = changes[i];
        if (!change) return;
        const sharers = u.baseId ? (waiting.get(u.baseId) ?? 1) : 1;
        swapLoadout(s, u, change, sharers);
        if (change.asm > 0 && u.baseId) waiting.set(u.baseId, sharers - 1);
      });
      const onGround = units.filter((u) => u.status !== 'airborne');
      const earliest =
        onGround.length > 0 ? Math.max(s.time + airOrderDelayS(s, side), ...onGround.map((u) => u.availableAt)) : s.time;
      const mission: Mission = {
        id,
        side,
        name: d.name ?? `${MISSION_PREFIX[d.type]}-${String(seq).padStart(2, '0')}`,
        type: d.type,
        unitIds: [...d.unitIds],
        waypoints: !routed ? [] : loop ? stationPattern(s, d.waypoints) : d.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
        altM: d.altM,
        speed: d.speed,
        launchAt: Math.max(d.launchAt, earliest),
        endAt: d.endAt,
        roe: d.roe,
        allowRefuel: d.allowRefuel,
        targetContactId: targeted ? d.targetContactId : null,
        status: 'planned',
        createdAt: s.time,
        onStationAnnounced: false,
        emcon: d.emcon ?? false,
        loop,
        escortUnitId: d.type === 'ESCORT' ? (d.escortUnitId ?? null) : null,
      };
      s.missions[id] = mission;

      const previous = new Set<string>();
      units.forEach((u, index) => {
        u.slot = index;
      });
      for (const u of units) {
        if (u.missionId) previous.add(u.missionId);
        u.missionId = id;
        if (u.status === 'airborne') {
          u.task = 'transit';
          u.wpIndex = 0;
          u.rtbReason = null;
          u.targetContactId = null;
          u.refuelFromId = null;
        }
      }
      for (const pid of previous) {
        const pm = s.missions[pid];
        if (pm) closeMissionIfEmpty(s, pm);
      }
      emit(s, 'MISSION_PLANNED', [side], { mission: mission.name, type: d.type, n: units.length, at: mission.launchAt });
      return { ok: true, missionId: id };
    }

    case 'CANCEL_MISSION': {
      const m = s.missions[order.missionId]!;
      for (const u of membersOf(s, m)) {
        if (u.status === 'airborne') orderRtb(s, u, 'order');
        u.missionId = null;
      }
      m.status = 'cancelled';
      emit(s, 'MISSION_CANCELLED', [m.side], { mission: m.name });
      return { ok: true, missionId: m.id };
    }

    case 'SET_ROE': {
      const m = s.missions[order.missionId]!;
      if (m.roe !== order.roe) {
        m.roe = order.roe;
        emit(s, 'ROE_CHANGED', [m.side], { mission: m.name, roe: order.roe });
      }
      return { ok: true, missionId: m.id };
    }

    case 'RTB_UNIT': {
      const u = s.units[order.unitId]!;
      const m = u.missionId ? s.missions[u.missionId] : undefined;
      if (u.task === 'rtb') {
        u.rtbReason = u.rtbReason ?? 'order';
      } else {
        orderRtb(s, u, 'order');
      }
      u.missionId = null;
      if (m) closeMissionIfEmpty(s, m);
      return { ok: true };
    }

    case 'MOVE_SHIP': {
      const u = s.units[order.unitId]!;
      u.route = [{ lat: order.dest.lat, lon: order.dest.lon }];
      u.routeLoop = false;
      u.wpIndex = 0;
      u.task = 'move';
      emit(s, 'SHIP_MOVING', [u.side], { unit: u.name });
      return { ok: true };
    }
  }
}
