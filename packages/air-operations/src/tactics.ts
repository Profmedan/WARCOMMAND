/**
 * IA tactique : comportements élémentaires des appareils en vol, communs aux deux camps.
 *
 * Le commandant (joueur ou IA) fixe la mission ; l'équipage décide de sa tâche immédiate
 * avec un arbre de comportement à priorités, réévalué à chaque pas :
 *
 *   1. retour base déjà décidé            7. ravitaillement en vol
 *   2. dommages → retour base             8. poursuite d'un hostile (règles d'engagement, rayon d'action)
 *   3. plus de mission → retour base      9. interception de la piste désignée
 *   4. carburant « bingo »               10. attaque du site désigné (SEAD)
 *   5. munitions épuisées → retour base  11. appui des troupes au contact (CAS)
 *   6. repli d'un moyen de soutien       12. escorte de l'appareil protégé
 *                                        13. tenue de station ou suite de la route
 *
 * L'équipage ne connaît que les pistes de son camp : jamais la vérité-terrain.
 */
import {
  action,
  centroid,
  condition,
  distanceKm,
  emit,
  isGroundForce,
  selector,
  sequence,
  type BtNode,
  type Contact,
  type LatLon,
  type Mission,
  type PlatformPerf,
  type SimState,
  type System,
  type Unit,
} from '@warcommand/simulation-core';
import { bingoFuelKg, fuelToFlyKg, leashKm, missionOf, orderRtb, perfOf, roeAllows } from './helpers';
import { isStrikeMission } from './orders';

interface Ctx {
  s: SimState;
  u: Unit;
  p: PlatformPerf;
  m: Mission | null;
}

const REFUEL_FULL_FRACTION = 0.97;
/** Une piste sensiblement plus proche que la cible actuelle justifie d'en changer. */
const RETARGET_RATIO = 0.7;
/** Un moyen de soutien en repli ne reprend sa station que si la menace est à plus de 1,3 fois le seuil de repli. */
const EVADE_RELEASE_FACTOR = 1.3;
/** En interception ou en attaque, autodéfense contre un hostile dans ce rayon. */
const SELF_DEFENCE_KM = 60;

function findTanker(c: Ctx): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const t of Object.values(c.s.units)) {
    if (t.side !== c.u.side || t.kind !== 'tanker' || t.status !== 'airborne') continue;
    if (t.task === 'rtb' || t.transferKg <= 0 || t.id === c.u.id) continue;
    const d = distanceKm(c.u.pos, t.pos);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function canReach(c: Ctx, target: Unit): boolean {
  return fuelToFlyKg(c.p, distanceKm(c.u.pos, target.pos), c.u.altM, c.s.rules) * 1.1 < c.u.fuelKg;
}

function stopRefuel(c: Ctx): void {
  if (c.u.task === 'refueling') {
    emit(c.s, 'REFUEL_END', [c.u.side], { unit: c.u.name, pct: Math.round((100 * c.u.fuelKg) / c.p.fuelCapacityKg) });
  }
  c.u.task = 'transit';
  c.u.refuelFromId = null;
}

/** L'unité protégée par une mission d'escorte, si elle est encore à protéger. */
export function escortedUnit(s: SimState, m: Mission): Unit | null {
  const unit = m.escortUnitId ? s.units[m.escortUnitId] : undefined;
  if (!unit || unit.status === 'destroyed' || unit.status === 'maintenance') return null;
  return unit.status === 'airborne' || unit.missionId !== null ? unit : null;
}

const fuelNode: BtNode<Ctx> = (c) => {
  if (c.u.fuelKg > bingoFuelKg(c.s, c.u)) return 'failure';
  if (c.u.task === 'refueling') return 'failure';
  if (c.m?.allowRefuel && c.u.kind !== 'tanker') {
    const tanker = findTanker(c);
    if (tanker && canReach(c, tanker)) {
      c.u.task = 'refuel';
      c.u.refuelFromId = tanker.id;
      c.u.targetContactId = null;
      return 'success';
    }
  }
  orderRtb(c.s, c.u, 'fuel');
  return 'success';
};

/** Munitions utiles à la mission épuisées : air-surface pour une attaque, air-air sinon. */
function outOfOrdnance(c: Ctx): boolean {
  if (c.u.kind !== 'fighter') return false;
  return c.m && isStrikeMission(c.m.type) ? c.u.asm <= 0 : c.u.weapons <= 0;
}

const evadeNode: BtNode<Ctx> = (c) => {
  if (c.u.kind !== 'aew' && c.u.kind !== 'tanker' && c.u.kind !== 'drone') return 'failure';
  let threat: Contact | null = null;
  // Hystérésis : le repli commence au seuil, et ne cesse qu'une fois la menace nettement éloignée,
  // sans quoi l'appareil ferait la navette entre sa station et son repli.
  let threatD = c.s.rules.hvaThreatKm * (c.u.task === 'evade' ? EVADE_RELEASE_FACTOR : 1);
  for (const k of Object.values(c.s.contacts[c.u.side])) {
    if (k.domain !== 'air' || k.stale) continue;
    if (!k.hostileAct && !(k.identified && k.kind === 'fighter')) continue;
    const d = distanceKm(c.u.pos, k.pos);
    if (d <= threatD) {
      threat = k;
      threatD = d;
    }
  }
  if (!threat) {
    if (c.u.task === 'evade') {
      c.u.task = 'transit';
      c.u.targetContactId = null;
    }
    return 'failure';
  }
  if (c.u.task !== 'evade') emit(c.s, 'UNIT_EVADING', [c.u.side], { unit: c.u.name, contact: threat.id });
  c.u.task = 'evade';
  c.u.targetContactId = threat.id;
  return 'success';
};

const refuelNode: BtNode<Ctx> = (c) => {
  if (!c.m?.allowRefuel || c.u.kind === 'tanker') return 'failure';
  const capacity = c.p.fuelCapacityKg;
  const active = c.u.task === 'refuel' || c.u.task === 'refueling';
  if (!active && c.u.fuelKg >= c.s.rules.refuelTriggerFraction * capacity) return 'failure';
  if (active && c.u.fuelKg >= REFUEL_FULL_FRACTION * capacity) {
    stopRefuel(c);
    return 'failure';
  }
  const current = c.u.refuelFromId ? c.s.units[c.u.refuelFromId] : undefined;
  const currentOk = current && current.status === 'airborne' && current.task !== 'rtb' && current.transferKg > 0;
  const tanker = active && currentOk ? current : findTanker(c);
  if (!tanker || (!active && !canReach(c, tanker))) {
    if (active) stopRefuel(c);
    return 'failure';
  }
  if (!active || c.u.refuelFromId !== tanker.id) {
    c.u.task = 'refuel';
    c.u.refuelFromId = tanker.id;
    c.u.targetContactId = null;
  }
  return 'success';
};

/**
 * Zone dans laquelle l'équipage poursuit de sa propre initiative : autour de la station
 * (patrouille), autour de lui-même (balayage), autour de l'appareil protégé (escorte),
 * ou en simple autodéfense (interception, attaque).
 */
function pursuitZone(c: Ctx, m: Mission): { center: LatLon; radiusKm: number } {
  const leash = leashKm(c.s.doctrine[c.u.side]);
  if (m.type === 'CAP' && m.waypoints.length > 0) return { center: centroid(m.waypoints), radiusKm: leash };
  if (m.type === 'SWEEP') return { center: c.u.pos, radiusKm: leash };
  if (m.type === 'ESCORT') {
    const protectedUnit = escortedUnit(c.s, m);
    if (protectedUnit) return { center: protectedUnit.pos, radiusKm: c.s.rules.escortRadiusKm };
  }
  return { center: c.u.pos, radiusKm: SELF_DEFENCE_KM };
}

const pursueNode: BtNode<Ctx> = (c) => {
  const { s, u, m } = c;
  if (u.kind !== 'fighter' || u.weapons <= 0 || !m) return 'failure';
  const contacts = s.contacts[u.side];
  const designated = m.type === 'INTERCEPT' && m.targetContactId ? contacts[m.targetContactId] : undefined;
  const zone = pursuitZone(c, m);

  let best: Contact | null = null;
  let bestD = Infinity;
  for (const k of Object.values(contacts)) {
    if (k.domain !== 'air' || k.stale || k === designated) continue;
    if (!roeAllows(s, u, m.roe, k)) continue;
    if (distanceKm(zone.center, k.pos) > zone.radiusKm) continue;
    const d = distanceKm(u.pos, k.pos);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }

  const current = u.task === 'pursue' && u.targetContactId ? contacts[u.targetContactId] : undefined;
  if (current && current !== designated && best && current !== best) {
    const stillValid = !current.stale && roeAllows(s, u, m.roe, current);
    if (stillValid && distanceKm(u.pos, current.pos) * RETARGET_RATIO <= bestD) best = current;
  }

  if (!best) {
    if (u.task === 'pursue' && !designated) {
      u.task = 'transit';
      u.targetContactId = null;
    }
    return 'failure';
  }
  u.task = 'pursue';
  u.targetContactId = best.id;
  return 'success';
};

const interceptNode: BtNode<Ctx> = (c) => {
  const { s, u, m } = c;
  if (!m || m.type !== 'INTERCEPT' || !m.targetContactId) return 'failure';
  const contact = s.contacts[u.side][m.targetContactId];
  if (!contact) return 'failure';
  u.task = 'pursue';
  u.targetContactId = contact.id;
  return 'success';
};

const attackNode: BtNode<Ctx> = (c) => {
  const { s, u, m } = c;
  if (!m || m.type !== 'SEAD' || !m.targetContactId) return 'failure';
  const contact = s.contacts[u.side][m.targetContactId];
  if (!contact) return 'failure';
  u.task = 'attack';
  u.targetContactId = contact.id;
  return 'success';
};

/**
 * Cible d'appui rapproché : une formation terrestre adverse identifiée, à position fraîche, dans le
 * rayon d'appui de la station — de préférence celle qui est au contact des troupes amies.
 */
function casTarget(c: Ctx, m: Mission): Contact | null {
  const { s, u } = c;
  const center = centroid(m.waypoints);
  const engaged = Object.values(s.units).filter((f) => f.side === u.side && f.status === 'active' && f.land?.inContact);
  let best: Contact | null = null;
  let bestScore = Infinity;
  for (const k of Object.values(s.contacts[u.side])) {
    if (k.domain !== 'ground' || k.stale || !k.identified || k.kind === null || !isGroundForce(k.kind)) continue;
    const d = distanceKm(center, k.pos);
    if (d > s.rules.casRadiusKm) continue;
    const pressing = engaged.some((f) => distanceKm(f.pos, k.pos) <= s.rules.landContactKm + 1);
    // Les adversaires au contact passent avant tous les autres, quelle que soit la distance.
    const score = d + (pressing ? 0 : 1e6);
    if (score < bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}

const casNode: BtNode<Ctx> = (c) => {
  const { u, m } = c;
  if (!m || m.type !== 'CAS' || m.waypoints.length === 0 || u.asm <= 0) return 'failure';
  // Pendant le transit, l'équipage ne cherche une cible qu'une fois à distance de tir de sa zone d'appui.
  if (u.task === 'transit' && distanceKm(u.pos, centroid(m.waypoints)) > c.p.asmRangeKm + c.s.rules.casRadiusKm) return 'failure';
  const target = casTarget(c, m);
  if (!target) {
    if (u.task === 'attack') {
      u.task = 'station';
      u.targetContactId = null;
    }
    return 'failure';
  }
  u.task = 'attack';
  u.targetContactId = target.id;
  return 'success';
};

const escortNode: BtNode<Ctx> = (c) => {
  if (!c.m || c.m.type !== 'ESCORT' || !escortedUnit(c.s, c.m)) return 'failure';
  c.u.task = 'escort';
  c.u.targetContactId = null;
  return 'success';
};

const stationNode: BtNode<Ctx> = (c) => {
  if (!c.m || c.m.waypoints.length === 0) {
    orderRtb(c.s, c.u, 'mission_end');
    return 'success';
  }
  if (c.u.task !== 'station' && c.u.task !== 'transit') {
    c.u.task = 'transit';
    c.u.targetContactId = null;
    c.u.refuelFromId = null;
  }
  return 'success';
};

const tacticalTree: BtNode<Ctx> = selector(
  condition((c) => c.u.task === 'rtb'),
  sequence(
    condition((c) => c.u.damaged),
    action((c) => orderRtb(c.s, c.u, 'damage')),
  ),
  sequence(
    condition((c) => !c.m || c.m.status !== 'active'),
    action((c) => orderRtb(c.s, c.u, 'order')),
  ),
  fuelNode,
  sequence(
    condition(outOfOrdnance),
    action((c) => orderRtb(c.s, c.u, 'weapons')),
  ),
  evadeNode,
  refuelNode,
  pursueNode,
  interceptNode,
  attackNode,
  casNode,
  escortNode,
  stationNode,
);

export const tacticalSystem: System = (s) => {
  for (const u of Object.values(s.units)) {
    if (u.status !== 'airborne') continue;
    tacticalTree({ s, u, p: perfOf(s, u), m: missionOf(s, u) });
  }
};
