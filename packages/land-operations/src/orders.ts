/**
 * Ordres aux formations terrestres. Comme pour l'aérien, c'est la seule porte d'entrée : le joueur
 * et l'IA passent par `applyLandOrder`, qui valide avant d'appliquer.
 *
 * Un ordre n'agit pas tout de suite : il est transmis, et l'unité ne l'exécute qu'après le délai de
 * commandement (doctrine, état des réseaux, présence d'un poste de commandement à portée).
 */
import {
  c2DelayFactor,
  distanceKm,
  emit,
  inBounds,
  isGroundForce,
  pathOnLand,
  type LandPosture,
  type LatLon,
  type SideId,
  type SimState,
  type Unit,
} from '@warcommand/simulation-core';
import { perfOf } from '@warcommand/air-operations';

export type LandOrder = { type: 'LAND_ORDER'; side: SideId; unitId: string; posture: LandPosture; route: LatLon[] };

export type LandRejectCode =
  | 'MISSION_OVER'
  | 'UNKNOWN_UNIT'
  | 'WRONG_SIDE'
  | 'NOT_A_GROUND_UNIT'
  | 'UNIT_UNAVAILABLE'
  | 'UNIT_BROKEN'
  | 'NO_WAYPOINT'
  | 'TOO_MANY_WAYPOINTS'
  | 'OUT_OF_THEATER'
  | 'NOT_ON_LAND';

export type LandOrderResult = { ok: true } | { ok: false; code: LandRejectCode; unitId?: string };

export const MAX_LAND_WAYPOINTS = 8;

const reject = (code: LandRejectCode, unitId?: string): LandOrderResult => ({ ok: false, code, unitId });

export const isMovingPosture = (posture: LandPosture): boolean => posture === 'move' || posture === 'attack' || posture === 'withdraw';

/** L'unité est-elle dans le rayon de commandement d'un poste de commandement ami en service ? */
export function isInCommand(s: SimState, u: Unit): boolean {
  for (const hq of Object.values(s.units)) {
    if (hq.side !== u.side || hq.kind !== 'hq' || hq.status !== 'active') continue;
    if (distanceKm(hq.pos, u.pos) <= perfOf(s, hq).commandKm) return true;
  }
  return false;
}

/** Délai entre un ordre et son exécution par la formation. */
export function landOrderDelayS(s: SimState, u: Unit): number {
  const base = Math.round(s.rules.landOrderDelayS * (0.5 + s.doctrine[u.side].centralisation));
  return Math.round(base * c2DelayFactor(s, u.side) * (isInCommand(s, u) ? 1 : 2));
}

export function validateLandOrder(s: SimState, order: LandOrder): LandOrderResult {
  if (s.outcome) return reject('MISSION_OVER');
  const u = s.units[order.unitId];
  if (!u) return reject('UNKNOWN_UNIT', order.unitId);
  if (u.side !== order.side) return reject('WRONG_SIDE', u.id);
  if (!isGroundForce(u.kind) || !u.land) return reject('NOT_A_GROUND_UNIT', u.id);
  if (u.status !== 'active') return reject('UNIT_UNAVAILABLE', u.id);
  if (!isMovingPosture(order.posture)) return { ok: true };

  if (order.posture === 'attack' && u.land.broken) return reject('UNIT_BROKEN', u.id);
  if (order.route.length === 0) return reject('NO_WAYPOINT', u.id);
  if (order.route.length > MAX_LAND_WAYPOINTS) return reject('TOO_MANY_WAYPOINTS', u.id);
  for (const wp of order.route) {
    if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon) || !inBounds(wp, s.theater)) return reject('OUT_OF_THEATER', u.id);
  }
  // Pas de trajet physiquement impossible : chaque tronçon reste à terre.
  let from = u.pos;
  for (const wp of order.route) {
    if (!pathOnLand(from, wp)) return reject('NOT_ON_LAND', u.id);
    from = wp;
  }
  return { ok: true };
}

export function applyLandOrder(s: SimState, order: LandOrder): LandOrderResult {
  const check = validateLandOrder(s, order);
  if (!check.ok) return check;
  const u = s.units[order.unitId]!;
  const at = s.time + landOrderDelayS(s, u);
  const route = isMovingPosture(order.posture) ? order.route.map((p) => ({ lat: p.lat, lon: p.lon })) : [];
  u.land!.pending = { at, posture: order.posture, route };
  emit(s, 'LAND_ORDER', [u.side], { unit: u.name, posture: order.posture, at });
  return { ok: true };
}
