import {
  bearingDeg,
  centroid,
  destination,
  distanceKm,
  emit,
  opponent,
  type Base,
  type Contact,
  type DoctrineParams,
  type LatLon,
  type Mission,
  type PlatformPerf,
  type Roe,
  type RtbReason,
  type Rules,
  type SimState,
  type SpeedMode,
  type Unit,
} from '@warcommand/simulation-core';

export function perfOf(s: SimState, u: Unit): PlatformPerf {
  const p = s.platforms[u.platformId];
  if (!p) throw new Error(`Plate-forme inconnue : ${u.platformId}`);
  return p;
}

export function baseOf(s: SimState, u: Unit): Base | null {
  return u.baseId ? (s.bases[u.baseId] ?? null) : null;
}

export function missionOf(s: SimState, u: Unit): Mission | null {
  return u.missionId ? (s.missions[u.missionId] ?? null) : null;
}

export function membersOf(s: SimState, m: Mission): Unit[] {
  return Object.values(s.units).filter((u) => u.missionId === m.id);
}

/**
 * Le radar de l'unité émet-il ? Non s'il n'y a pas de radar, si l'unité n'est pas en service,
 * si elle est neutralisée, ou si sa mission impose le silence radar.
 */
export function radarEmitting(s: SimState, u: Unit): boolean {
  if (u.status !== 'airborne' && u.status !== 'active') return false;
  if (perfOf(s, u).radarRangeKm <= 0) return false;
  if (u.domain !== 'air') return !u.damaged && s.time >= u.suppressedUntil;
  return !(missionOf(s, u)?.emcon ?? false);
}

export function inSector(s: SimState, pos: LatLon): boolean {
  return distanceKm(pos, s.objective.center) <= s.objective.radiusKm;
}

/** Consommation instantanée (kg/min) selon le régime et l'altitude. */
export function burnRateKgMin(p: PlatformPerf, mode: SpeedMode, altM: number, rules: Rules): number {
  const base = mode === 'dash' ? p.burnDashKgMin : p.burnCruiseKgMin;
  return altM < rules.lowAltBelowM ? base * rules.lowAltBurnFactor : base;
}

/** Carburant nécessaire pour parcourir `distKm` en croisière à l'altitude donnée. */
export function fuelToFlyKg(p: PlatformPerf, distKm: number, altM: number, rules: Rules): number {
  if (p.cruiseKmh <= 0) return 0;
  return (distKm / p.cruiseKmh) * 60 * burnRateKgMin(p, 'cruise', altM, rules);
}

/** Seuil « bingo » : carburant du retour à la base, avec marge, plus la réserve finale. */
export function bingoFuelKg(s: SimState, u: Unit): number {
  const p = perfOf(s, u);
  const base = baseOf(s, u);
  const reserve = p.fuelCapacityKg * s.rules.fuelReserveFraction;
  if (!base) return reserve;
  return fuelToFlyKg(p, distanceKm(u.pos, base.pos), u.altM, s.rules) * s.rules.bingoMargin + reserve;
}

/** Distance maximale, depuis sa station, à laquelle une patrouille poursuit de sa propre initiative. */
export function leashKm(d: DoctrineParams): number {
  return 60 + 120 * d.autonomie;
}

/** Délai entre l'ordre et le décollage des appareils au sol. */
export function scrambleDelayS(rules: Rules, d: DoctrineParams): number {
  return Math.round(rules.scrambleBaseS * (0.5 + d.centralisation));
}

/** Les règles d'engagement autorisent-elles à engager cette piste ? */
export function roeAllows(s: SimState, shooter: Unit, roe: Roe, c: Contact): boolean {
  // Une piste qui a ouvert le feu est hostile, identifiée ou non : la riposte est toujours permise.
  if (c.hostileAct) return true;
  if (roe === 'hold') return false;
  if (!c.identified) return false;
  if (roe === 'free') return true;
  if (inSector(s, c.pos)) return true;
  const radius = s.rules.defensiveRadiusKm;
  if (distanceKm(c.pos, shooter.pos) <= radius) return true;
  for (const u of Object.values(s.units)) {
    if (u.side !== shooter.side || u.status === 'destroyed') continue;
    if (u.kind === 'fighter') continue;
    if (distanceKm(c.pos, u.pos) <= radius) return true;
  }
  for (const b of Object.values(s.bases)) {
    if (b.side === shooter.side && distanceKm(c.pos, b.pos) <= radius) return true;
  }
  return false;
}

/**
 * Point visé par un appareil selon son rang dans la formation (ligne de front) : le leader vise
 * le point lui-même, les ailiers un point décalé perpendiculairement à l'axe de la mission,
 * alternativement à droite et à gauche.
 */
export function formationPoint(point: LatLon, slot: number, spacingKm: number, axisDeg: number): LatLon {
  if (slot <= 0) return point;
  return destination(point, axisDeg + (slot % 2 === 1 ? 90 : -90), spacingKm * Math.ceil(slot / 2));
}

/** Axe d'une mission : cap de la base de l'appareil vers le centre de sa station. */
export function missionAxisDeg(s: SimState, u: Unit, m: Mission): number {
  const base = baseOf(s, u);
  if (!base || m.waypoints.length === 0) return 0;
  return bearingDeg(base.pos, centroid(m.waypoints));
}

/** Nombre de tirs d'un camp encore en vol vers une unité. */
export function shotsInFlightOn(s: SimState, side: Unit['side'], targetUnitId: string): number {
  let n = 0;
  for (const shot of s.shots) if (shot.side === side && shot.targetId === targetUnitId) n += 1;
  return n;
}

/** Ordonne le retour à la base : l'appareil quitte sa mission. */
export function orderRtb(s: SimState, u: Unit, reason: RtbReason): void {
  if (u.status !== 'airborne' || u.task === 'rtb') return;
  u.task = 'rtb';
  u.rtbReason = reason;
  u.targetContactId = null;
  u.refuelFromId = null;
  u.missionId = null;
  emit(s, 'UNIT_RTB', [u.side], { unit: u.name, reason });
}

export function destroyUnit(s: SimState, u: Unit): void {
  if (u.status === 'destroyed') return;
  u.status = 'destroyed';
  u.speedKmh = 0;
  u.missionId = null;
  u.task = 'ground';
  u.targetContactId = null;
  u.refuelFromId = null;
  s.stats[u.side].losses[u.kind] += 1;
  // Si l'adversaire tenait une piste fraîche, la destruction est constatée ; sinon l'information vieillit.
  const enemy = opponent(u.side);
  for (const c of Object.values(s.contacts[enemy])) {
    if (c.unitId === u.id && !c.stale) {
      delete s.contacts[enemy][c.id];
      emit(s, 'CONTACT_DESTROYED', [enemy], { contact: c.id });
    }
  }
}
