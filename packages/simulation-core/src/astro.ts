/**
 * Hauteur du soleil au-dessus de l'horizon — formules astronomiques publiques de basse précision
 * (anomalie et longitude moyennes du soleil, obliquité, temps sidéral de Greenwich), exactes à
 * mieux qu'un degré : largement suffisant pour distinguer le jour de la nuit.
 */
import type { LatLon } from './geo';

const D2R = Math.PI / 180;
/** 1er janvier 2000 à 12:00 UTC, en millisecondes Unix. */
const J2000_MS = 946728000000;

export function solarElevationDeg(dateMs: number, pos: LatLon): number {
  const d = (dateMs - J2000_MS) / 86400000;
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const epsilon = (23.439 - 0.00000036 * d) * D2R;
  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmstHours = 18.697374558 + 24.06570982441908 * d;
  const hourAngle = (gmstHours * 15 + pos.lon) * D2R - rightAscension;
  const lat = pos.lat * D2R;
  const sinAltitude = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAltitude))) / D2R;
}

/** Fait-il nuit à cet endroit, à cet instant de simulation ? */
export function isNight(startIso: string, timeS: number, pos: LatLon, thresholdDeg: number): boolean {
  return solarElevationDeg(Date.parse(startIso) + timeS * 1000, pos) < thresholdDeg;
}
