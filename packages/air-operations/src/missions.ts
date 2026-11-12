/**
 * Cycle de vie des missions et des appareils au sol :
 * remise en condition → décollage à l'heure prévue → fin de créneau → clôture.
 */
import { bearingDeg, emit, type Mission, type SimState, type System, type Unit } from '@warcommand/simulation-core';
import { baseOf, membersOf, orderRtb, perfOf } from './helpers';
import { escortedUnit } from './tactics';

function completeTurnaround(s: SimState, u: Unit): void {
  const p = perfOf(s, u);
  const base = baseOf(s, u);
  if (base) {
    const fuel = Math.min(base.fuelStockKg, Math.max(0, p.fuelCapacityKg - u.fuelKg));
    u.fuelKg += fuel;
    base.fuelStockKg -= fuel;
    const loadout = p.loadouts.find((l) => l.id === u.loadoutId);
    const weapons = Math.min(base.weaponStock, Math.max(0, (loadout ? loadout.aam : p.weaponCount) - u.weapons));
    u.weapons += weapons;
    base.weaponStock -= weapons;
    const asm = Math.min(base.asmStock, Math.max(0, (loadout ? loadout.asm : 0) - u.asm));
    u.asm += asm;
    base.asmStock -= asm;
  }
  u.status = 'ready';
  u.readyAt = null;
  u.damaged = false;
  u.fault = false;
  emit(s, 'UNIT_READY', [u.side], { unit: u.name });
}

function takeOff(s: SimState, u: Unit, m: Mission): void {
  const p = perfOf(s, u);
  u.status = 'airborne';
  u.altM = Math.min(m.altM, p.ceilingM);
  u.task = 'transit';
  u.wpIndex = 0;
  u.rtbReason = null;
  u.targetContactId = null;
  u.refuelFromId = null;
  u.speedKmh = p.cruiseKmh;
  const first = m.waypoints[0];
  if (first) u.headingDeg = bearingDeg(u.pos, first);
  s.stats[u.side].sorties += 1;
}

function endMission(s: SimState, m: Mission, members: Unit[]): void {
  for (const u of members) {
    if (u.status === 'airborne') orderRtb(s, u, 'mission_end');
    u.missionId = null;
  }
  m.status = 'completed';
  emit(s, 'MISSION_ENDED', [m.side], { mission: m.name });
}

export const missionSystem: System = (s) => {
  for (const u of Object.values(s.units)) {
    const grounded = u.status === 'turnaround' || u.status === 'maintenance';
    if (grounded && u.readyAt !== null && s.time >= u.readyAt) completeTurnaround(s, u);
  }

  for (const m of Object.values(s.missions)) {
    if (m.status !== 'planned' && m.status !== 'active') continue;
    const members = membersOf(s, m);

    if (members.length === 0) {
      if (m.status === 'planned') {
        m.status = 'cancelled';
        emit(s, 'MISSION_CANCELLED', [m.side], { mission: m.name });
      } else {
        m.status = 'completed';
        emit(s, 'MISSION_ENDED', [m.side], { mission: m.name });
      }
      continue;
    }

    // Une mission démarre à l'heure prévue, ou tout de suite pour des appareils déjà en vol.
    if (m.status === 'planned' && (s.time >= m.launchAt || members.some((u) => u.status === 'airborne'))) {
      m.status = 'active';
    }
    if (m.status !== 'active') continue;

    if (m.endAt !== null && s.time >= m.endAt) {
      endMission(s, m, members);
      continue;
    }
    const targeted = m.type === 'INTERCEPT' || m.type === 'SEAD';
    if (targeted && (!m.targetContactId || !s.contacts[m.side][m.targetContactId])) {
      endMission(s, m, members);
      continue;
    }
    if (m.type === 'ESCORT' && !escortedUnit(s, m)) {
      endMission(s, m, members);
      continue;
    }

    if (s.time >= m.launchAt) {
      let launched = 0;
      for (const u of members) {
        if (u.status === 'ready' && s.time >= u.availableAt) {
          takeOff(s, u, m);
          launched += 1;
        }
      }
      if (launched > 0) emit(s, 'MISSION_LAUNCHED', [m.side], { mission: m.name, n: launched });
    }
  }
};
