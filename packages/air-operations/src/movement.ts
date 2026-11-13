/**
 * Mouvement continu, consommation de carburant, ravitaillement en vol, atterrissage.
 *
 * Simplifications documentées : cap instantané (pas de rayon de virage), montée et descente
 * instantanées, vitesse constante par régime. En revanche aucune unité ne se téléporte :
 * le déplacement par pas est borné par la vitesse du régime en cours.
 */
import {
  bearingDeg,
  destination,
  distanceKm,
  emit,
  isNaval,
  moveToward,
  rand,
  type LatLon,
  type SimState,
  type SpeedMode,
  type System,
  type Unit,
} from '@warcommand/simulation-core';
import { baseOf, burnRateKgMin, destroyUnit, formationPoint, missionAxisDeg, missionOf, orderRtb, perfOf, shotsInFlightOn } from './helpers';
import { escortedUnit } from './tactics';

/** En poursuite, le régime rapide n'est pris qu'à moins de cette distance de la cible. */
const DASH_WITHIN_KM = 160;
/** Après un tir air-surface, l'appareil s'éloigne jusqu'à cette distance au-delà de sa portée de tir. */
const ATTACK_EGRESS_MARGIN_KM = 25;
/** Une escorte se place à cette distance en avant de l'appareil protégé. */
const ESCORT_LEAD_KM = 8;
/** Au-delà de cette distance de sa position d'escorte, l'escorteur rejoint au régime rapide. */
const ESCORT_DASH_BEYOND_KM = 40;
/** Vitesse d'un appareil endommagé, en fraction de la croisière. */
const DAMAGED_SPEED_FACTOR = 0.85;
/** Vitesse d'un bâtiment avarié. */
const DAMAGED_SHIP_SPEED_FACTOR = 0.5;
/** Fraction de la vitesse de son escorte la plus lente à laquelle navigue un chef de file. */
const ESCORT_SPEED_MARGIN = 0.9;

function land(s: SimState, u: Unit): void {
  const p = perfOf(s, u);
  u.altM = 0;
  u.speedKmh = 0;
  u.task = 'ground';
  u.missionId = null;
  u.rtbReason = null;
  u.targetContactId = null;
  u.refuelFromId = null;
  if (u.damaged) {
    u.status = 'maintenance';
    u.readyAt = s.time + s.rules.repairS;
    emit(s, 'UNIT_LANDED', [u.side], { unit: u.name, state: 'maintenance', readyAt: u.readyAt });
    return;
  }
  u.status = 'turnaround';
  u.readyAt = s.time + p.turnaroundMin * 60;
  emit(s, 'UNIT_LANDED', [u.side], { unit: u.name, state: 'turnaround', readyAt: u.readyAt });
  // Fiabilité : une sortie peut se terminer par une panne, qui allonge l'immobilisation.
  if (rand(s.rng, 'sim') >= p.reliability) {
    const span = s.rules.faultDelayMaxS - s.rules.faultDelayMinS;
    u.readyAt += Math.round(s.rules.faultDelayMinS + rand(s.rng, 'sim') * span);
    u.fault = true;
    emit(s, 'UNIT_FAULT', [u.side], { unit: u.name, readyAt: u.readyAt });
  }
}

function moveAircraft(s: SimState, u: Unit): void {
  const dt = s.rules.dtS;
  const p = perfOf(s, u);
  const m = missionOf(s, u);
  let target: LatLon | null = null;
  let mode: SpeedMode = 'cruise';
  let factor = 1;

  switch (u.task) {
    case 'rtb': {
      target = baseOf(s, u)?.pos ?? null;
      if (u.damaged) factor = DAMAGED_SPEED_FACTOR;
      break;
    }
    case 'transit':
    case 'station': {
      if (m && m.waypoints.length > 0) {
        target = formationPoint(m.waypoints[u.wpIndex % m.waypoints.length]!, u.slot, s.rules.formationSpacingKm, missionAxisDeg(s, u, m));
        if (u.task === 'transit') mode = m.speed;
      }
      break;
    }
    case 'pursue': {
      const c = u.targetContactId ? s.contacts[u.side][u.targetContactId] : undefined;
      if (c) {
        target = c.pos;
        const d = distanceKm(u.pos, c.pos);
        const closing = d <= DASH_WITHIN_KM && d > 0.5 * p.weaponRangeKm;
        if (closing || (m?.type === 'INTERCEPT' && m.speed === 'dash')) mode = 'dash';
      }
      break;
    }
    case 'attack': {
      const c = u.targetContactId ? s.contacts[u.side][u.targetContactId] : undefined;
      if (c) {
        // Passe de tir : on vient à portée, on tire, puis on s'éloigne tant que l'on ne peut pas
        // tirer de nouveau (cadence, missiles déjà en vol), pour ne pas rester sous le feu de la cible.
        const fireKm = p.asmRangeKm * s.rules.fireRangeFraction;
        const armed =
          u.asm > 0 && s.time - u.lastShotAt >= s.rules.shotCooldownS && shotsInFlightOn(s, u.side, c.unitId) < s.rules.maxShotsPerTarget;
        const egress = !armed && distanceKm(u.pos, c.pos) <= fireKm + ATTACK_EGRESS_MARGIN_KM;
        target = egress ? destination(u.pos, bearingDeg(c.pos, u.pos), 20) : c.pos;
      }
      break;
    }
    case 'escort': {
      const escorted = m ? escortedUnit(s, m) : null;
      if (escorted) {
        // En avant de l'appareil protégé s'il vole, à sa verticale sinon ; les escorteurs se répartissent de part et d'autre.
        const lead = escorted.status === 'airborne' ? destination(escorted.pos, escorted.headingDeg, ESCORT_LEAD_KM) : escorted.pos;
        target = formationPoint(lead, u.slot + 1, s.rules.formationSpacingKm, escorted.headingDeg);
        if (distanceKm(u.pos, target) > ESCORT_DASH_BEYOND_KM) mode = 'dash';
      }
      break;
    }
    case 'refuel':
    case 'refueling': {
      const t = u.refuelFromId ? s.units[u.refuelFromId] : undefined;
      if (t && t.status === 'airborne') target = t.pos;
      break;
    }
    case 'evade': {
      const c = u.targetContactId ? s.contacts[u.side][u.targetContactId] : undefined;
      if (c) target = destination(u.pos, bearingDeg(c.pos, u.pos), 40);
      mode = 'dash';
      break;
    }
    default:
      break;
  }

  const speed = (mode === 'dash' ? p.dashKmh : p.cruiseKmh) * factor;
  let arrived = false;
  if (target) {
    const r = moveToward(u.pos, target, (speed * dt) / 3600, u.headingDeg);
    u.pos = r.pos;
    u.headingDeg = r.headingDeg;
    arrived = r.arrived;
  }
  u.speedKmh = speed;

  const burn = Math.min(u.fuelKg, (burnRateKgMin(p, mode, u.altM, s.rules) * dt) / 60);
  u.fuelKg -= burn;
  s.stats[u.side].fuelBurnedKg += burn;
  if (u.fuelKg <= 0) {
    u.fuelKg = 0;
    emit(s, 'UNIT_LOST_FUEL', [u.side], { unit: u.name });
    destroyUnit(s, u);
    return;
  }

  if (arrived) {
    if (u.task === 'rtb') {
      // Base fermée : impossible de se poser, l'appareil attend à la verticale (jusqu'à un déroutement ou la panne sèche).
      if (baseOf(s, u)?.closed) return;
      land(s, u);
      return;
    }
    if ((u.task === 'transit' || u.task === 'station') && m && m.waypoints.length > 0) {
      // Route non bouclée (balayage) : au dernier point, la mission est accomplie.
      if (!m.loop && u.wpIndex >= m.waypoints.length - 1) {
        orderRtb(s, u, 'mission_end');
        return;
      }
      if (u.task === 'transit') {
        u.task = 'station';
        if (!m.onStationAnnounced) {
          m.onStationAnnounced = true;
          emit(s, 'MISSION_ON_STATION', [u.side], { mission: m.name });
        }
      }
      u.wpIndex = (u.wpIndex + 1) % m.waypoints.length;
    }
  }

  if (u.task === 'refuel' || u.task === 'refueling') {
    const t = u.refuelFromId ? s.units[u.refuelFromId] : undefined;
    if (!t || t.status !== 'airborne') return;
    const d = distanceKm(u.pos, t.pos);
    if (u.task === 'refuel' && d <= s.rules.refuelJoinKm) {
      u.task = 'refueling';
      emit(s, 'REFUEL_START', [u.side], { unit: u.name, tanker: t.name });
    } else if (u.task === 'refueling' && d > s.rules.refuelJoinKm * 2) {
      u.task = 'refuel';
    }
    if (u.task === 'refueling') {
      const give = Math.max(0, Math.min((s.rules.refuelRateKgMin * dt) / 60, p.fuelCapacityKg - u.fuelKg, t.transferKg));
      u.fuelKg += give;
      t.transferKg -= give;
      s.stats[u.side].fuelTransferredKg += give;
    }
  }
}

/**
 * Vitesse d'un bâtiment : la sienne, réduite de moitié s'il est avarié. Un chef de file règle son allure
 * sur son escorte la plus lente, avec une marge qui lui permet de tenir son poste.
 */
function shipSpeedKmh(s: SimState, u: Unit): number {
  let speed = perfOf(s, u).cruiseKmh;
  for (const f of Object.values(s.units)) {
    if (f.naval?.leaderId === u.id && f.status === 'active') speed = Math.min(speed, perfOf(s, f).cruiseKmh * ESCORT_SPEED_MARGIN);
  }
  return u.damaged ? speed * DAMAGED_SHIP_SPEED_FACTOR : speed;
}

function moveShip(s: SimState, u: Unit): void {
  if (u.route.length === 0) {
    u.speedKmh = 0;
    return;
  }
  const speed = shipSpeedKmh(s, u);
  const target = u.route[u.wpIndex % u.route.length]!;
  const r = moveToward(u.pos, target, (speed * s.rules.dtS) / 3600, u.headingDeg);
  u.pos = r.pos;
  u.headingDeg = r.headingDeg;
  u.speedKmh = speed;
  if (!r.arrived) return;
  if (u.routeLoop) {
    u.wpIndex = (u.wpIndex + 1) % u.route.length;
  } else if (u.wpIndex + 1 < u.route.length) {
    u.wpIndex += 1;
  } else {
    u.route = [];
    u.wpIndex = 0;
    u.task = 'hold';
    u.speedKmh = 0;
  }
}

export const movementSystem: System = (s) => {
  for (const u of Object.values(s.units)) {
    if (u.status === 'airborne') moveAircraft(s, u);
    else if (u.status === 'active' && isNaval(u.kind)) moveShip(s, u);
  }
};
