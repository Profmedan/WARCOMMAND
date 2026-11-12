/**
 * Géodésie simplifiée : Terre sphérique, coordonnées WGS84 en degrés décimaux.
 * Simplification documentée : l'aplatissement de l'ellipsoïde est ignoré (écart < 0,5 %).
 */
export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Circle {
  center: LatLon;
  radiusKm: number;
}

export const EARTH_RADIUS_KM = 6371.0088;
const D2R = Math.PI / 180;

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Distance orthodromique (formule de haversine), en kilomètres. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cap initial de a vers b, en degrés [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const p1 = a.lat * D2R;
  const p2 = b.lat * D2R;
  const dl = (b.lon - a.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

/** Point atteint depuis `a` en suivant le cap `bearing` sur `distKm`. */
export function destination(a: LatLon, bearing: number, distKm: number): LatLon {
  const d = distKm / EARTH_RADIUS_KM;
  const t = bearing * D2R;
  const p1 = a.lat * D2R;
  const l1 = a.lon * D2R;
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sinP2)));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sinP2);
  return { lat: p2 / D2R, lon: normalizeLon(l2 / D2R) };
}

/** Écart angulaire absolu entre deux caps, en degrés [0, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/**
 * Horizon radar entre deux hauteurs (mètres), en kilomètres.
 * Formule publique usuelle (réfraction standard 4/3) : d ≈ 4,12 × (√h1 + √h2).
 */
export function radarHorizonKm(h1M: number, h2M: number): number {
  return 4.12 * (Math.sqrt(Math.max(0, h1M)) + Math.sqrt(Math.max(0, h2M)));
}

export interface MoveResult {
  pos: LatLon;
  headingDeg: number;
  arrived: boolean;
  movedKm: number;
}

/** Avance de `stepKm` au plus vers `to` ; s'arrête exactement sur `to` si la distance le permet. */
export function moveToward(from: LatLon, to: LatLon, stepKm: number, currentHeading: number): MoveResult {
  const d = distanceKm(from, to);
  if (d <= stepKm || d < 1e-6) {
    return { pos: { lat: to.lat, lon: to.lon }, headingDeg: d < 1e-6 ? currentHeading : bearingDeg(from, to), arrived: true, movedKm: d };
  }
  const brg = bearingDeg(from, to);
  return { pos: destination(from, brg, stepKm), headingDeg: brg, arrived: false, movedKm: stepKm };
}

export function inCircle(p: LatLon, c: Circle): boolean {
  return distanceKm(p, c.center) <= c.radiusKm;
}

export function inBounds(p: LatLon, b: Bounds): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
}

/** Barycentre plan d'un petit ensemble de points proches (suffisant à l'échelle d'un circuit d'attente). */
export function centroid(points: readonly LatLon[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  const n = Math.max(1, points.length);
  return { lat: lat / n, lon: lon / n };
}

/** Polygone approchant un cercle géodésique (pour l'affichage). */
export function circlePolygon(c: Circle, segments = 72): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= segments; i++) pts.push(destination(c.center, (i * 360) / segments, c.radiusKm));
  return pts;
}
