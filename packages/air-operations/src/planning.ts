/**
 * Aide à la planification : rayon d'action et estimation d'une mission avant de l'ordonner.
 * Ces fonctions n'utilisent que des données propres au camp (ses appareils, ses bases, ses pistes).
 */
import { distanceKm, type LatLon, type PlatformPerf, type Rules, type SideId, type SimState } from '@warcommand/simulation-core';
import { baseOf, burnRateKgMin, fuelToFlyKg, perfOf, scrambleDelayS } from './helpers';
import type { MissionDraft } from './orders';

export interface RangeQuery {
  perf: PlatformPerf;
  rules: Rules;
  /** Carburant disponible au départ. */
  fuelKg: number;
  origin: LatLon;
  target: LatLon;
  home: LatLon;
  altM: number;
  /** Positions des ravitailleurs utilisables, ou `null` si le ravitaillement n'est pas autorisé. */
  tankers: LatLon[] | null;
}

/**
 * La mission est-elle dans le rayon d'action ? Aller jusqu'à la cible puis rentrer, avec 10 % de
 * marge et la réserve finale. Avec un ravitailleur : le rejoindre, puis faire cible et retour
 * avec les pleins.
 */
export function missionWithinRange(q: RangeQuery): boolean {
  const reserve = q.perf.fuelCapacityKg * q.rules.fuelReserveFraction;
  const need = (km: number) => fuelToFlyKg(q.perf, km, q.altM, q.rules) * 1.1;
  const home = distanceKm(q.target, q.home);
  if (need(distanceKm(q.origin, q.target) + home) + reserve <= q.fuelKg) return true;
  if (!q.tankers) return false;
  return q.tankers.some(
    (tanker) => need(distanceKm(q.origin, tanker)) <= q.fuelKg && need(distanceKm(tanker, q.target) + home) + reserve <= q.perf.fuelCapacityKg,
  );
}

/** Ravitailleurs en vol, en mission, ayant encore du carburant à céder. */
export function usableTankers(s: SimState, side: SideId): LatLon[] {
  return Object.values(s.units)
    .filter((t) => t.side === side && t.kind === 'tanker' && t.status === 'airborne' && t.task !== 'rtb' && t.transferKg > 0)
    .map((t) => t.pos);
}

/** Premier point visé par une mission : station, piste désignée ou appareil à escorter. */
export function missionDestination(s: SimState, side: SideId, d: MissionDraft): LatLon | null {
  if (d.type === 'INTERCEPT' || d.type === 'SEAD') {
    return (d.targetContactId ? s.contacts[side][d.targetContactId]?.pos : undefined) ?? null;
  }
  if (d.type === 'ESCORT') return (d.escortUnitId ? s.units[d.escortUnitId]?.pos : undefined) ?? null;
  return d.waypoints[0] ?? null;
}

export interface MissionEstimate {
  /** Instant de départ prévu (secondes de simulation). */
  departAt: number;
  arrivalAt: number;
  transitMin: number;
  fuelOnArrivalPct: number;
  /** Minutes sur zone avant le seuil de retour, sans ravitaillement. Négatif : la zone n'est pas tenable. */
  onStationMin: number;
  /** Appareil le plus contraint, sur lequel porte l'estimation. */
  limitingUnitId: string;
}

/** Estimation pour l'appareil le plus limité d'une mission. `null` si la mission n'a pas de destination. */
export function estimateMission(s: SimState, side: SideId, d: MissionDraft): MissionEstimate | null {
  const target = missionDestination(s, side, d);
  if (!target || d.unitIds.length === 0) return null;
  let worst: MissionEstimate | null = null;

  for (const id of d.unitIds) {
    const u = s.units[id];
    if (!u || u.side !== side || u.domain !== 'air') return null;
    const p = perfOf(s, u);
    const base = baseOf(s, u);
    if (!base) return null;
    const airborne = u.status === 'airborne';
    const origin = airborne ? u.pos : base.pos;
    const fuel = airborne ? u.fuelKg : p.fuelCapacityKg;

    let departAt = s.time;
    if (!airborne) {
      const wanted = d.loadoutId ?? (d.type === 'SEAD' ? (p.loadouts.find((l) => l.asm > 0)?.id ?? null) : null);
      const rearm = u.status === 'ready' && wanted !== null && wanted !== u.loadoutId ? s.time + s.rules.rearmDelayS : 0;
      departAt = Math.max(d.launchAt, s.time + scrambleDelayS(s.rules, s.doctrine[side]), u.availableAt, u.readyAt ?? 0, rearm);
    }

    const speed = d.speed === 'dash' ? p.dashKmh : p.cruiseKmh;
    const transitMin = (distanceKm(origin, target) / speed) * 60;
    const arrivalFuel = fuel - transitMin * burnRateKgMin(p, d.speed, d.altM, s.rules);
    const threshold = fuelToFlyKg(p, distanceKm(target, base.pos), d.altM, s.rules) * s.rules.bingoMargin + p.fuelCapacityKg * s.rules.fuelReserveFraction;
    const estimate: MissionEstimate = {
      departAt,
      arrivalAt: departAt + Math.round(transitMin * 60),
      transitMin,
      fuelOnArrivalPct: (100 * arrivalFuel) / p.fuelCapacityKg,
      onStationMin: (arrivalFuel - threshold) / burnRateKgMin(p, 'cruise', d.altM, s.rules),
      limitingUnitId: u.id,
    };
    if (!worst || estimate.onStationMin < worst.onStationMin) worst = estimate;
  }
  return worst;
}
