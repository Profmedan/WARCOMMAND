/**
 * Opérations terrestres : mouvement, zones de contrôle, observation, engagements abstraits,
 * moral, fatigue, cohésion, ravitaillement et commandement.
 *
 * Tout est un modèle ludique documenté dans docs/modele-de-jeu.md. À chaque seconde : exécution des
 * ordres parvenus et mouvement. À chaque balayage des capteurs : observation terrestre. À chaque
 * « tour terrestre » (`landIntervalS`, une minute par défaut), dans cet ordre : commandement,
 * contacts, combat, récupération et retranchement, consommation, logistique, rupture et pertes.
 *
 * Simplifications : une formation est un point ; le combat est une attrition proportionnelle à la
 * puissance adverse ; l'artillerie appuie une seule cible par tour ; les itinéraires sont des
 * segments droits contrôlés à l'ordre (terre ferme), sans recherche de chemin.
 */
import {
  distanceKm,
  emit,
  isGroundForce,
  isManeuver,
  moveToward,
  pathOnLand,
  rand,
  TERRAIN,
  terrainAt,
  type ControlStatus,
  type LatLon,
  type SideId,
  type SimState,
  type System,
  type Unit,
  type UnitKind,
} from '@warcommand/simulation-core';
import { destroyUnit, observe, perfOf } from '@warcommand/air-operations';
import { isInCommand, isMovingPosture } from './orders';

/** Sous ce niveau de ravitaillement, la puissance de combat décroît. */
const SUPPLY_COMBAT_FLOOR = 0.25;
/** Une unité qui attaque s'arrête à cette fraction de la distance de contact. */
const ATTACK_STANDOFF = 0.75;
const BROKEN_POWER = 0.3;
const OUT_OF_COMMAND_POWER = 0.8;
/** Protection d'une unité surprise en déplacement. */
const MOVING_TOUGHNESS = 0.8;
/** Une unité logistique repart au dépôt sous ce niveau de chargement, et revient au-dessus de celui-ci. */
const CARGO_EMPTY = 0.05;
const CARGO_FULL = 0.95;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Formation terrestre en service (ni détruite, ni embarquée). */
export function isActiveFormation(u: Unit): boolean {
  return u.land !== null && u.status === 'active' && isGroundForce(u.kind);
}

/** Formation qui tient effectivement le terrain : de mêlée, en service, non rompue, encore en état de combattre. */
export function holdsGround(s: SimState, u: Unit): boolean {
  return isActiveFormation(u) && isManeuver(u.kind) && !u.land!.broken && u.land!.strength >= s.rules.landDestroyedBelow;
}

function supplyCombatFactor(supply: number): number {
  return supply >= SUPPLY_COMBAT_FLOOR ? 1 : 0.4 + 2.4 * supply;
}

/**
 * Puissance de combat d'une formation : sa valeur de base, pondérée par ses effectifs, sa cohésion,
 * son moral, sa fatigue, son ravitaillement, son commandement, et effondrée si elle est rompue.
 */
export function combatPower(s: SimState, u: Unit): number {
  const l = u.land;
  if (!l) return 0;
  return (
    perfOf(s, u).combat *
    l.strength *
    (0.4 + 0.6 * l.cohesion) *
    (0.5 + 0.5 * l.morale) *
    (1 - 0.4 * l.fatigue) *
    supplyCombatFactor(l.supply) *
    (isInCommand(s, u) ? 1 : OUT_OF_COMMAND_POWER) *
    (l.broken ? BROKEN_POWER : 1)
  );
}

function engineerNear(s: SimState, u: Unit, formations: Unit[]): boolean {
  for (const e of formations) {
    if (e.side === u.side && e.kind === 'engineer' && e.id !== u.id && distanceKm(e.pos, u.pos) <= s.rules.engineerKm) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ Ordres et mouvement */

function applyPending(s: SimState, u: Unit): void {
  const l = u.land!;
  if (!l.pending || s.time < l.pending.at) return;
  const { posture, route } = l.pending;
  l.pending = null;
  // Une unité rompue ne reprend pas l'offensive : l'ordre, donné avant la rupture, est perdu.
  if (posture === 'attack' && l.broken) return;
  l.posture = posture;
  u.route = route.map((p) => ({ lat: p.lat, lon: p.lon }));
  u.wpIndex = 0;
  u.task = isMovingPosture(posture) ? 'move' : 'hold';
  if (isMovingPosture(posture)) l.dugIn = 0;
  if (u.kind === 'logistics') {
    const end = route[route.length - 1] ?? u.pos;
    l.supplyPoint = { lat: end.lat, lon: end.lon };
  }
}

function halt(u: Unit): void {
  u.speedKmh = 0;
}

function moveFormation(s: SimState, u: Unit, formations: Unit[]): void {
  const l = u.land!;
  if (!isMovingPosture(l.posture) || u.route.length === 0) return halt(u);

  // Zone de contrôle et arrêt au contact.
  let nearestHolder = Infinity;
  let nearestFoe = Infinity;
  for (const e of formations) {
    if (e.side === u.side) continue;
    const d = distanceKm(u.pos, e.pos);
    if (d < nearestFoe) nearestFoe = d;
    if (d < nearestHolder && holdsGround(s, e)) nearestHolder = d;
  }
  if (l.posture === 'move' && nearestHolder <= s.rules.zocKm) return halt(u);
  if (l.posture === 'attack' && nearestFoe <= s.rules.landContactKm * ATTACK_STANDOFF) return halt(u);

  let mobility = TERRAIN[terrainAt(s, u.pos)].mobility;
  if (mobility < 1 && engineerNear(s, u, formations)) mobility = 1 - (1 - mobility) / 2;
  const speed = perfOf(s, u).cruiseKmh * mobility * (l.supply > 0 ? 1 : 0.5) * (1 - 0.3 * l.fatigue);
  const r = moveToward(u.pos, u.route[0]!, (speed * s.rules.dtS) / 3600, u.headingDeg);
  u.pos = r.pos;
  u.headingDeg = r.headingDeg;
  u.speedKmh = speed;
  if (!r.arrived) return;
  u.route.shift();
  if (u.route.length > 0) return;
  // Arrivée : l'attaquant s'installe en défense, les autres tiennent.
  l.posture = l.posture === 'attack' ? 'defend' : 'hold';
  u.task = 'hold';
  halt(u);
}

/* ------------------------------------------------------------------ Observation terrestre */

function observeGround(s: SimState, formations: Unit[]): void {
  for (const target of Object.values(s.units)) {
    // Cibles : formations et sites sol-air en service. Une équipe spéciale ne se laisse pas observer ainsi.
    if (target.status !== 'active' || target.domain !== 'ground' || target.kind === 'sof') continue;
    const concealment = TERRAIN[terrainAt(s, target.pos)].concealment;
    for (const o of formations) {
      if (o.side === target.side) continue;
      if (distanceKm(o.pos, target.pos) <= perfOf(s, o).spotKm * concealment) {
        observe(s, o.side, target, true, 'ground');
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ Tour terrestre */

function toughness(s: SimState, u: Unit): number {
  const l = u.land!;
  const base = Math.max(0.5, perfOf(s, u).combat);
  if (l.posture === 'hold' || l.posture === 'defend') return base * TERRAIN[terrainAt(s, u.pos)].defence * (1 + s.rules.dugInBonus * l.dugIn);
  return l.posture === 'attack' ? base : base * MOVING_TOUGHNESS;
}

function resolveCombat(s: SimState, formations: Unit[], firing: Set<string>, dtMin: number): void {
  // Contacts : toute formation adverse à moins de la distance de contact.
  const foes = new Map<string, Unit[]>();
  const link = (a: Unit, b: Unit) => {
    const list = foes.get(a.id);
    if (list) list.push(b);
    else foes.set(a.id, [b]);
  };
  for (let i = 0; i < formations.length; i++) {
    for (let j = i + 1; j < formations.length; j++) {
      const a = formations[i]!;
      const b = formations[j]!;
      if (a.side === b.side || distanceKm(a.pos, b.pos) > s.rules.landContactKm) continue;
      link(a, b);
      link(b, a);
    }
  }
  for (const u of formations) {
    const l = u.land!;
    const now = foes.has(u.id);
    if (now && !l.inContact) {
      emit(s, 'LAND_IN_CONTACT', [u.side], { unit: u.name });
      l.casSince = s.time;
      emit(s, 'CAS_REQUEST', [u.side], { unit: u.name });
    }
    if (!now) l.casSince = -1;
    l.inContact = now;
  }

  // Puissance reçue : chaque formation au contact répartit la sienne entre ses adversaires.
  const incoming = new Map<string, number>();
  const add = (id: string, power: number) => incoming.set(id, (incoming.get(id) ?? 0) + power);
  for (const u of formations) {
    const list = foes.get(u.id);
    if (!list) continue;
    const share = combatPower(s, u) / list.length;
    for (const foe of list) add(foe.id, share);
  }
  // Appui indirect : chaque artillerie libre appuie, sur la formation adverse au contact la plus proche à sa portée.
  for (const a of formations) {
    const p = perfOf(s, a);
    const l = a.land!;
    if (p.supportKm <= 0 || l.inContact || l.broken || l.supply <= 0) continue;
    let target: Unit | null = null;
    let best = Infinity;
    for (const e of formations) {
      if (e.side === a.side || !foes.has(e.id)) continue;
      const d = distanceKm(a.pos, e.pos);
      if (d <= p.supportKm && d < best) {
        best = d;
        target = e;
      }
    }
    if (!target) continue;
    add(target.id, p.support * l.strength * supplyCombatFactor(l.supply));
    firing.add(a.id);
  }

  for (const u of formations) {
    const received = incoming.get(u.id);
    if (!received) continue;
    const l = u.land!;
    const roll = 0.75 + 0.5 * rand(s.rng, 'sim');
    const loss = Math.min(l.strength, ((s.rules.landAttritionPerMin * dtMin * received) / toughness(s, u)) * roll);
    l.strength -= loss;
    s.stats[u.side].landStrengthLost += loss;
    l.morale = clamp01(l.morale - 1.5 * loss);
    l.cohesion = clamp01(l.cohesion - loss * (l.posture === 'move' || l.posture === 'withdraw' ? 1.5 : 1));
  }
}

function recover(s: SimState, u: Unit, formations: Unit[], firing: Set<string>, dtMin: number): void {
  const l = u.land!;
  const moving = isMovingPosture(l.posture) && u.route.length > 0;

  if (l.inContact) l.fatigue = clamp01(l.fatigue + 0.004 * dtMin);
  else if (moving) l.fatigue = clamp01(l.fatigue + 0.002 * dtMin);
  else l.fatigue = clamp01(l.fatigue - (l.posture === 'hold' ? 0.008 : 0.004) * dtMin);

  if (!l.inContact) {
    l.morale = clamp01(l.morale + 0.002 * dtMin);
    l.cohesion = clamp01(l.cohesion + 0.004 * dtMin * (l.inCommand ? 1 : 0.5) * (l.posture === 'hold' ? 2 : 1));
  }

  if (moving) l.dugIn = 0;
  else if (l.posture === 'defend') l.dugIn = clamp01(l.dugIn + s.rules.digInPerMin * dtMin * (engineerNear(s, u, formations) ? 2 : 1));

  // Consommation : une unité logistique transporte le ravitaillement, elle n'en manque pas elle-même.
  if (u.kind === 'logistics') return;
  const rate = firing.has(u.id) ? 0.008 : l.inContact ? 0.006 : moving ? 0.0015 : 0.0005;
  const before = l.supply;
  l.supply = Math.max(0, l.supply - rate * dtMin);
  if (before >= SUPPLY_COMBAT_FLOOR && l.supply < SUPPLY_COMBAT_FLOOR) emit(s, 'SUPPLY_LOW', [u.side], { unit: u.name });
}

function nearestDepot(s: SimState, u: Unit, withinKm: number): { pos: LatLon; id: string; d: number } | null {
  let best: { pos: LatLon; id: string; d: number } | null = null;
  for (const b of Object.values(s.bases)) {
    if (b.side !== u.side || b.closed || b.supplyStock <= 0) continue;
    const d = distanceKm(u.pos, b.pos);
    if (d <= withinKm && (!best || d < best.d)) best = { pos: b.pos, id: b.id, d };
  }
  return best;
}

function runLogistics(s: SimState, u: Unit, formations: Unit[], dtMin: number): void {
  const l = u.land!;
  if (l.broken) return;
  const capacity = perfOf(s, u).cargo;

  // 1. Recomplètement à un dépôt ami à portée.
  const depot = nearestDepot(s, u, s.rules.depotKm);
  if (depot) {
    const base = s.bases[depot.id]!;
    const take = Math.max(0, Math.min(s.rules.reloadCargoPerMin * dtMin, capacity - l.cargo, base.supplyStock));
    l.cargo += take;
    base.supplyStock -= take;
  }

  // 2. Distribution aux formations amies à portée, les plus démunies d'abord.
  const needy = formations
    .filter((f) => f.side === u.side && f.kind !== 'logistics' && f.land!.supply < 1 && distanceKm(f.pos, u.pos) <= s.rules.resupplyKm)
    .sort((a, b) => a.land!.supply - b.land!.supply || a.id.localeCompare(b.id));
  for (const f of needy) {
    if (l.cargo <= 0) break;
    const give = Math.min(s.rules.resupplyPerMin * dtMin, 1 - f.land!.supply, l.cargo / s.rules.cargoPerSupply);
    f.land!.supply += give;
    l.cargo -= give * s.rules.cargoPerSupply;
    if (l.cargo < 1e-9) l.cargo = 0;
  }

  // 3. Navette : vide, elle part au dépôt ; pleine, elle revient à son point de distribution.
  if (!l.supplyPoint || l.pending || l.inContact) return;
  const goTo = (dest: LatLon) => {
    u.route = [{ lat: dest.lat, lon: dest.lon }];
    u.wpIndex = 0;
    u.task = 'move';
    l.posture = 'move';
    l.dugIn = 0;
  };
  const heading = u.route[0];
  if (l.cargo < capacity * CARGO_EMPTY) {
    const far = nearestDepot(s, u, Infinity);
    const already = far !== null && heading !== undefined && distanceKm(heading, far.pos) < 0.01;
    if (far && !already && far.d > 0.5 && pathOnLand(u.pos, far.pos)) goTo(far.pos);
  } else if (l.cargo >= capacity * CARGO_FULL && distanceKm(u.pos, l.supplyPoint) > 0.05) {
    const already = heading !== undefined && distanceKm(heading, l.supplyPoint) < 0.01;
    if (!already && pathOnLand(u.pos, l.supplyPoint)) goTo(l.supplyPoint);
  }
}

/** Point de ralliement d'une unité rompue : le poste de commandement ami le plus proche, à défaut une base amie. */
function rallyPoint(s: SimState, u: Unit): LatLon | null {
  let best: LatLon | null = null;
  let bestD = Infinity;
  for (const hq of Object.values(s.units)) {
    if (hq.side !== u.side || hq.kind !== 'hq' || hq.status !== 'active' || hq.id === u.id) continue;
    const d = distanceKm(u.pos, hq.pos);
    if (d < bestD) {
      bestD = d;
      best = hq.pos;
    }
  }
  if (best) return best;
  for (const b of Object.values(s.bases)) {
    if (b.side !== u.side || b.hostUnitId !== null) continue;
    const d = distanceKm(u.pos, b.pos);
    if (d < bestD) {
      bestD = d;
      best = b.pos;
    }
  }
  return best;
}

function breakOrRally(s: SimState, u: Unit): void {
  const l = u.land!;
  const r = s.rules;
  if (l.strength < r.landDestroyedBelow) {
    l.inContact = false;
    l.casSince = -1;
    emit(s, 'UNIT_DESTROYED', [u.side], { unit: u.name });
    destroyUnit(s, u);
    return;
  }
  if (!l.broken && (l.morale < r.landBreakMorale || l.cohesion < r.landBreakCohesion)) {
    l.broken = true;
    l.pending = null;
    l.dugIn = 0;
    const rally = rallyPoint(s, u);
    if (rally && distanceKm(u.pos, rally) > 0.5 && pathOnLand(u.pos, rally)) {
      l.posture = 'withdraw';
      u.route = [{ lat: rally.lat, lon: rally.lon }];
      u.wpIndex = 0;
      u.task = 'move';
    } else {
      l.posture = 'hold';
      u.route = [];
    }
    emit(s, 'LAND_BROKEN', [u.side], { unit: u.name });
    return;
  }
  if (l.broken && !l.inContact && l.cohesion >= r.landRallyCohesion && l.morale >= r.landBreakMorale + 0.1) {
    l.broken = false;
    emit(s, 'LAND_RALLIED', [u.side], { unit: u.name });
  }
}

function landTick(s: SimState, formations: Unit[]): void {
  const dtMin = s.rules.landIntervalS / 60;
  for (const u of formations) u.land!.inCommand = isInCommand(s, u);
  const firing = new Set<string>();
  resolveCombat(s, formations, firing, dtMin);
  for (const u of formations) recover(s, u, formations, firing, dtMin);
  for (const u of formations) if (u.kind === 'logistics') runLogistics(s, u, formations, dtMin);
  for (const u of formations) breakOrRally(s, u);
}

/** Système des opérations terrestres. Sans formation terrestre, il ne fait rien et ne tire aucun nombre aléatoire. */
export const landSystem: System = (s) => {
  const formations = Object.values(s.units).filter(isActiveFormation);
  if (formations.length === 0) return;
  for (const u of formations) applyPending(s, u);
  for (const u of formations) moveFormation(s, u, formations);
  if (s.time % s.rules.sensorIntervalS === 0) observeGround(s, formations);
  if (s.time % s.rules.landIntervalS === 0) landTick(s, formations);
};

/** Puissance de combat de chaque camp sur un objectif terrestre : seules comptent les formations qui tiennent le terrain. */
export function groundPower(s: SimState): Record<SideId, number> {
  const power = { BLUE: 0, RED: 0 };
  const o = s.objective;
  for (const u of Object.values(s.units)) {
    if (holdsGround(s, u) && distanceKm(u.pos, o.center) <= o.radiusKm) power[u.side] += combatPower(s, u);
  }
  return power;
}

/** Valeur nominale d'une formation de mêlée : ce qu'un camp suppose d'une formation adverse dont il ignore l'état. */
export const NOMINAL_COMBAT: Partial<Record<UnitKind, number>> = { infantry: 1, mech: 1.6, armor: 2.2, recon: 0.6, engineer: 0.5 };

/**
 * Puissance adverse qu'un camp croit présente sur l'objectif terrestre, d'après ses seules pistes récentes :
 * chaque formation de mêlée identifiée à sa valeur nominale, une piste non identifiée comme de l'infanterie.
 */
export function perceivedEnemyGroundPower(s: SimState, side: SideId): number {
  const o = s.objective;
  let power = 0;
  for (const c of Object.values(s.contacts[side])) {
    // Une formation ne s'évanouit pas : perdue de vue, elle reste présumée sur place le temps de la mémoire des pistes.
    if (c.domain !== 'ground' || s.time - c.lastSeen > s.rules.groundTrackMemoryS || distanceKm(c.pos, o.center) > o.radiusKm) continue;
    power += !c.identified || c.kind === null ? 1 : (NOMINAL_COMBAT[c.kind] ?? 0);
  }
  return power;
}

/**
 * Détenteur d'une zone terrestre selon le rapport des forces présentes : le camp nettement le plus fort
 * la contrôle ; à forces comparables elle est contestée ; vide, elle reste à son dernier détenteur.
 */
export function groundControl(s: SimState, own: number, enemy: number, ownSide: SideId, previous: SideId): ControlStatus {
  if (own <= 0 && enemy <= 0) return previous;
  const ratio = s.rules.groundControlRatio;
  if (own >= ratio * enemy) return ownSide;
  if (enemy >= ratio * own) return ownSide === 'BLUE' ? 'RED' : 'BLUE';
  return 'CONTESTED';
}
