/**
 * Ordres propres aux bâtiments. Le déplacement d'un bâtiment reste l'ordre `MOVE_SHIP` des opérations
 * aériennes (zone de manœuvre, trajet en mer) ; ici, la mise à terre des troupes embarquées.
 */
import { distanceKm, emit, inBounds, isLand, type LatLon, type SideId, type SimState } from '@warcommand/simulation-core';
import { perfOf } from '@warcommand/air-operations';

export type NavalOrder = { type: 'LAND_TROOPS'; side: SideId; shipId: string; unitId: string; beach: LatLon };

export type NavalRejectCode =
  | 'MISSION_OVER'
  | 'UNKNOWN_UNIT'
  | 'WRONG_SIDE'
  | 'NOT_A_TRANSPORT'
  | 'NOT_ABOARD'
  | 'UNIT_UNAVAILABLE'
  | 'OUT_OF_THEATER'
  | 'OUT_OF_RANGE'
  | 'NOT_ON_LAND';

export type NavalOrderResult = { ok: true } | { ok: false; code: NavalRejectCode; unitId?: string };

const reject = (code: NavalRejectCode, unitId?: string): NavalOrderResult => ({ ok: false, code, unitId });

export function validateNavalOrder(s: SimState, order: NavalOrder): NavalOrderResult {
  if (s.outcome) return reject('MISSION_OVER');
  const ship = s.units[order.shipId];
  if (!ship || !ship.naval) return ship ? reject('NOT_A_TRANSPORT', ship.id) : reject('UNKNOWN_UNIT', order.shipId);
  if (ship.side !== order.side) return reject('WRONG_SIDE', ship.id);
  if (perfOf(s, ship).lift <= 0) return reject('NOT_A_TRANSPORT', ship.id);
  // Un bâtiment avarié, coulé, ou déjà occupé à débarquer ne peut pas lancer de nouvelle opération.
  if (ship.status !== 'active' || ship.damaged || ship.naval.landing) return reject('UNIT_UNAVAILABLE', ship.id);
  if (!ship.naval.troops.includes(order.unitId)) return reject('NOT_ABOARD', order.unitId);
  const beach = order.beach;
  if (!Number.isFinite(beach.lat) || !Number.isFinite(beach.lon) || !inBounds(beach, s.theater)) return reject('OUT_OF_THEATER', ship.id);
  if (distanceKm(ship.pos, beach) > s.rules.landingRangeKm) return reject('OUT_OF_RANGE', ship.id);
  if (!isLand(beach)) return reject('NOT_ON_LAND', ship.id);
  return { ok: true };
}

export function applyNavalOrder(s: SimState, order: NavalOrder): NavalOrderResult {
  const check = validateNavalOrder(s, order);
  if (!check.ok) return check;
  const ship = s.units[order.shipId]!;
  const troop = s.units[order.unitId]!;
  // Le bâtiment stoppe pour la durée de l'opération.
  ship.route = [];
  ship.wpIndex = 0;
  ship.task = 'hold';
  ship.naval!.landing = { unitId: troop.id, beach: { lat: order.beach.lat, lon: order.beach.lon }, doneAt: s.time + s.rules.landingS };
  emit(s, 'TROOPS_LANDING', [ship.side], { ship: ship.name, unit: troop.name, at: s.time + s.rules.landingS });
  return { ok: true };
}
