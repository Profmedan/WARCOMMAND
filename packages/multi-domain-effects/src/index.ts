/**
 * Effets multi-domaines, modélisés abstraitement (prompt maître §8) :
 *
 *  - cyber : disponibilité des réseaux d'un camp, perturbation et rétablissement, résilience ;
 *  - espace : liaisons et navigation par satellite, brouillage, fenêtres de satellites d'observation ;
 *  - opérations spéciales : infiltration, observation en profondeur, découverte, exfiltration.
 *
 * Ce sont des règles de jeu. Rien ici ne décrit ni ne met en œuvre une attaque informatique réelle :
 * une « perturbation » est un jeton que le scénario accorde à un camp et qui abaisse, pour un temps,
 * un niveau de service de l'adversaire.
 */
import {
  distanceKm,
  emit,
  inBounds,
  inCircle,
  isGroundForce,
  isLand,
  isSurfaceShip,
  opponent,
  rand,
  SERVICE_IDS,
  serviceDegraded,
  SIDES,
  type EffectId,
  type LatLon,
  type ServiceId,
  type SideId,
  type SimState,
  type System,
  type Unit,
} from '@warcommand/simulation-core';
import { destroyUnit, nightNow, observe, perfOf } from '@warcommand/air-operations';

export type EffectOrder =
  | { type: 'USE_EFFECT'; side: SideId; effect: EffectId }
  | { type: 'SOF_INSERT'; side: SideId; unitId: string; target: LatLon }
  | { type: 'SOF_EXTRACT'; side: SideId; unitId: string };

export type EffectRejectCode =
  | 'MISSION_OVER'
  | 'NO_EFFECT_LEFT'
  | 'UNKNOWN_UNIT'
  | 'WRONG_SIDE'
  | 'NOT_SOF'
  | 'UNIT_UNAVAILABLE'
  | 'OUT_OF_THEATER'
  | 'NOT_ON_LAND'
  | 'OUT_OF_RANGE';

export type EffectOrderResult = { ok: true } | { ok: false; code: EffectRejectCode; unitId?: string };

const reject = (code: EffectRejectCode, unitId?: string): EffectOrderResult => ({ ok: false, code, unitId });

/** Services visés par chaque effet. */
export const EFFECT_TARGETS: Record<EffectId, readonly ServiceId[]> = {
  cyber: ['network'],
  jam: ['satcom', 'nav'],
};

/** Repos imposé à une équipe récupérée avant qu'elle puisse repartir. */
const SOF_REST_S = 3600;
/** Types de formations dont la localisation vaut un compte rendu de renseignement. */
const INTEL_KINDS = new Set(['hq', 'logistics', 'artillery', 'sam']);
/** Malus d'infiltration quand une formation adverse est proche du point visé. */
const SOF_INSERT_NEAR_PENALTY = 0.3;
/** Sous ce facteur de capteurs (couverture nuageuse), un satellite optique ne voit rien. */
const SAT_MIN_SENSOR_FACTOR = 0.6;

/* ------------------------------------------------------------------ Opérations spéciales : probabilités */

function enemyFormationsNear(s: SimState, side: SideId, pos: LatLon, km: number): Unit[] {
  return Object.values(s.units).filter((u) => u.side !== side && u.status === 'active' && isGroundForce(u.kind) && distanceKm(u.pos, pos) <= km);
}

/** Probabilité de réussir l'infiltration sur le point visé. */
export function sofInsertP(s: SimState, team: Unit, target: LatLon): number {
  const near = enemyFormationsNear(s, team.side, target, s.rules.sofNearKm).length > 0;
  return Math.max(0, s.rules.sofInsertP - (near ? SOF_INSERT_NEAR_PENALTY : 0));
}

/** Probabilité, par minute, que l'équipe en observation soit découverte. Une unité de reconnaissance compte double. */
export function sofCompromiseP(s: SimState, team: Unit): number {
  let weight = 0;
  for (const u of enemyFormationsNear(s, team.side, team.pos, s.rules.sofNearKm)) weight += u.kind === 'recon' ? 2 : 1;
  return Math.min(1, s.rules.sofCompromiseBaseP + s.rules.sofCompromisePerUnitP * weight);
}

/* ------------------------------------------------------------------ Ordres */

export function validateEffectOrder(s: SimState, order: EffectOrder): EffectOrderResult {
  if (s.outcome) return reject('MISSION_OVER');
  if (order.type === 'USE_EFFECT') {
    return s.effects[order.side][order.effect] > 0 ? { ok: true } : reject('NO_EFFECT_LEFT');
  }
  const team = s.units[order.unitId];
  if (!team) return reject('UNKNOWN_UNIT', order.unitId);
  if (team.side !== order.side) return reject('WRONG_SIDE', team.id);
  if (team.kind !== 'sof' || !team.sof) return reject('NOT_SOF', team.id);

  if (order.type === 'SOF_EXTRACT') {
    return team.status === 'active' && team.sof.phase === 'observing' ? { ok: true } : reject('UNIT_UNAVAILABLE', team.id);
  }
  if (team.status !== 'ready' || team.sof.phase !== 'ready' || s.time < team.availableAt) return reject('UNIT_UNAVAILABLE', team.id);
  const target = order.target;
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon) || !inBounds(target, s.theater)) return reject('OUT_OF_THEATER', team.id);
  if (!isLand(target)) return reject('NOT_ON_LAND', team.id);
  if (distanceKm(team.pos, target) > s.rules.sofRangeKm) return reject('OUT_OF_RANGE', team.id);
  return { ok: true };
}

function travelS(s: SimState, from: LatLon, to: LatLon): number {
  return Math.round((distanceKm(from, to) / s.rules.sofInsertKmh) * 3600);
}

function homeOf(s: SimState, team: Unit): LatLon {
  return (team.baseId ? s.bases[team.baseId]?.pos : undefined) ?? team.pos;
}

function startExtraction(s: SimState, team: Unit): void {
  const sof = team.sof!;
  sof.phase = 'extracting';
  sof.arriveAt = s.time + travelS(s, team.pos, homeOf(s, team));
  team.status = 'embarked';
}

export function applyEffectOrder(s: SimState, order: EffectOrder): EffectOrderResult {
  const check = validateEffectOrder(s, order);
  if (!check.ok) return check;

  if (order.type === 'USE_EFFECT') {
    const enemy = opponent(order.side);
    const services = s.services[enemy];
    s.effects[order.side][order.effect] -= 1;
    s.stats[order.side].effectsUsed += 1;
    emit(s, 'EFFECT_USED', [order.side], { effect: order.effect });
    // Plus le camp visé est résilient, plus la perturbation est brève.
    const until = s.time + Math.round(s.rules.effectDurationS * (1.5 - services.resilience));
    for (const service of EFFECT_TARGETS[order.effect]) {
      services.level[service] = Math.min(services.level[service], 1 - s.rules.effectStrength);
      services.disruptedUntil[service] = Math.max(services.disruptedUntil[service], until);
      emit(s, 'SERVICE_DEGRADED', [enemy], { service, level: services.level[service], until });
    }
    return { ok: true };
  }

  const team = s.units[order.unitId]!;
  const sof = team.sof!;
  if (order.type === 'SOF_INSERT') {
    sof.phase = 'inserting';
    sof.target = { lat: order.target.lat, lon: order.target.lon };
    sof.arriveAt = s.time + s.rules.sofPrepS + travelS(s, team.pos, order.target);
    sof.compromised = false;
    team.status = 'embarked';
    emit(s, 'SOF_INSERTING', [team.side], { unit: team.name, at: sof.arriveAt });
    return { ok: true };
  }
  startExtraction(s, team);
  return { ok: true };
}

/* ------------------------------------------------------------------ Services */

function recoverServices(s: SimState): void {
  const perSecond = s.rules.serviceRecoveryPerMin / 60;
  for (const side of SIDES) {
    const services = s.services[side];
    for (const service of SERVICE_IDS) {
      if (services.level[service] >= 1 || s.time <= services.disruptedUntil[service]) continue;
      services.level[service] = Math.min(1, services.level[service] + perSecond * (0.5 + services.resilience));
      // Pour éviter une dérive d'arrondi, on considère le service rétabli à un millionième près.
      if (services.level[service] > 1 - 1e-6) {
        services.level[service] = 1;
        emit(s, 'SERVICE_RESTORED', [side], { service });
      }
    }
  }
}

/* ------------------------------------------------------------------ Satellites d'observation */

function runSatellites(s: SimState): void {
  for (const pass of s.satellites) {
    if (pass.phase === 'done') continue;
    if (pass.phase === 'start') {
      if (s.time < pass.startS) continue;
      pass.phase = 'open';
      emit(s, 'SAT_PASS_START', [pass.side], { sat: pass.name, until: pass.endS });
    }
    if (s.time >= pass.endS) {
      pass.phase = 'done';
      emit(s, 'SAT_PASS_END', [pass.side], { sat: pass.name });
      continue;
    }
    if (s.time % s.rules.sensorIntervalS !== 0) continue;
    // Satellite optique : il lui faut le jour, un ciel assez dégagé, et une liaison pour transmettre.
    if (serviceDegraded(s, pass.side, 'satcom') || s.weather.sensorFactor < SAT_MIN_SENSOR_FACTOR || nightNow(s)) continue;
    for (const target of Object.values(s.units)) {
      if (target.side === pass.side || target.status !== 'active' || !inCircle(target.pos, pass.footprint)) continue;
      const visible = isSurfaceShip(target.kind) || (target.domain === 'ground' && target.kind !== 'sof');
      if (visible) observe(s, pass.side, target, true, 'sat');
    }
  }
}

/* ------------------------------------------------------------------ Opérations spéciales */

function sofReport(s: SimState, team: Unit): void {
  // Sans liaison par satellite, l'équipe observe mais ne transmet rien.
  if (serviceDegraded(s, team.side, 'satcom')) return;
  const range = perfOf(s, team).spotKm;
  for (const target of Object.values(s.units)) {
    if (target.side === team.side || target.status !== 'active') continue;
    const visible = isSurfaceShip(target.kind) || (target.domain === 'ground' && target.kind !== 'sof');
    if (!visible || distanceKm(team.pos, target.pos) > range) continue;
    const known = Object.values(s.contacts[team.side]).some((c) => c.unitId === target.id && c.identified);
    const contact = observe(s, team.side, target, true, 'sof');
    if (!known && INTEL_KINDS.has(target.kind)) {
      emit(s, 'INTEL_REPORT', [team.side], { unit: team.name, contact: contact.id, label: contact.label ?? '' });
    }
  }
}

function recover(s: SimState, team: Unit): void {
  const sof = team.sof!;
  team.status = 'ready';
  team.pos = { ...homeOf(s, team) };
  team.availableAt = s.time + SOF_REST_S;
  sof.phase = 'ready';
  sof.target = null;
  sof.compromised = false;
}

function runSof(s: SimState, team: Unit): void {
  const sof = team.sof!;
  if (sof.phase === 'inserting') {
    if (s.time < sof.arriveAt || !sof.target) return;
    if (rand(s.rng, 'sim') < sofInsertP(s, team, sof.target)) {
      team.status = 'active';
      team.pos = { lat: sof.target.lat, lon: sof.target.lon };
      sof.phase = 'observing';
      emit(s, 'SOF_ON_STATION', [team.side], { unit: team.name });
      sofReport(s, team);
      return;
    }
    // Infiltration manquée : l'équipe n'a pas touché terre, elle fait demi-tour sans risque.
    emit(s, 'SOF_ABORTED', [team.side], { unit: team.name });
    sof.phase = 'extracting';
    sof.arriveAt = s.time + travelS(s, sof.target, homeOf(s, team));
    sof.target = null;
    return;
  }

  if (sof.phase === 'observing') {
    if (s.time % s.rules.sensorIntervalS === 0) sofReport(s, team);
    if (s.time % s.rules.landIntervalS === 0 && rand(s.rng, 'sim') < sofCompromiseP(s, team)) {
      sof.compromised = true;
      emit(s, 'SOF_COMPROMISED', [team.side], { unit: team.name });
      startExtraction(s, team);
    }
    return;
  }

  if (sof.phase === 'extracting' && s.time >= sof.arriveAt) {
    // `target` est vide après une infiltration manquée : retour sans tirage. Sinon, l'exfiltration se joue.
    const p = sof.target === null ? 1 : sof.compromised ? s.rules.sofExtractCompromisedP : s.rules.sofExtractP;
    if (p >= 1 || rand(s.rng, 'sim') < p) {
      const aborted = sof.target === null;
      recover(s, team);
      if (!aborted) emit(s, 'SOF_RECOVERED', [team.side], { unit: team.name });
      else team.availableAt = s.time;
      return;
    }
    emit(s, 'SOF_LOST', [team.side], { unit: team.name });
    emit(s, 'UNIT_DESTROYED', [team.side], { unit: team.name });
    destroyUnit(s, team);
  }
}

/** Système des effets multi-domaines. Il ne tire un nombre aléatoire que pour une équipe spéciale engagée. */
export const effectsSystem: System = (s) => {
  recoverServices(s);
  if (s.satellites.length > 0) runSatellites(s);
  for (const u of Object.values(s.units)) {
    if (u.sof && u.status !== 'destroyed' && u.sof.phase !== 'ready') runSof(s, u);
  }
};
