/**
 * Masque terre-mer : savoir si un point est à terre, si un trajet reste à terre ou en mer.
 *
 * Donnée : trait de côte Natural Earth au 1:50 000 000 (domaine public), distribué par `world-atlas`.
 * C'est une donnée statique, comme la base de matériels : elle n'entre pas dans l'état de la partie.
 *
 * Simplifications documentées : la précision est celle du trait de côte (quelques kilomètres) ; les
 * lacs comptent comme de la terre ; un trajet est contrôlé par échantillonnage, tous les deux
 * kilomètres par défaut ; le calcul est plan en longitude-latitude. Les contours qui franchissent
 * l'antiméridien sont déroulés (longitudes continues) avant le test.
 */
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-50m.json';
import { bearingDeg, destination, distanceKm, type LatLon } from './geo';

type Ring = number[][];
interface LandPolygon {
  west: number;
  south: number;
  east: number;
  north: number;
  /** Premier anneau : contour ; suivants : trous. */
  rings: Ring[];
}

let cache: LandPolygon[] | null = null;

function polygons(): LandPolygon[] {
  if (cache) return cache;
  const topology = landTopology as unknown as Parameters<typeof feature>[0];
  const land = feature(topology, topology.objects.land!) as unknown as {
    features?: { geometry: { type: string; coordinates: unknown } }[];
    geometry?: { type: string; coordinates: unknown };
  };
  const geometries = land.features ? land.features.map((f) => f.geometry) : land.geometry ? [land.geometry] : [];
  const out: LandPolygon[] = [];
  for (const g of geometries) {
    const list = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as Ring[][];
    for (const raw of list) {
      const rings = raw.map(unwrap);
      const outer = rings[0];
      if (!outer || outer.length < 4) continue;
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const [lon, lat] of outer as [number, number][]) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
      out.push({ west, south, east, north, rings });
    }
  }
  cache = out;
  return out;
}

/** Déroule un anneau qui franchit l'antiméridien : ses longitudes deviennent continues (au-delà de ±180 au besoin). */
function unwrap(ring: Ring): Ring {
  const out: Ring = [];
  let offset = 0;
  let previous: number | null = null;
  for (const [lon, lat] of ring as [number, number][]) {
    if (previous !== null) {
      if (lon - previous > 180) offset -= 360;
      else if (lon - previous < -180) offset += 360;
    }
    previous = lon;
    out.push([lon + offset, lat]);
  }
  return out;
}

/** Test du rayon horizontal : le point est-il à l'intérieur de l'anneau ? */
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lon: number, lat: number, poly: LandPolygon): boolean {
  if (lon < poly.west || lon > poly.east || lat < poly.south || lat > poly.north) return false;
  if (!inRing(lon, lat, poly.rings[0]!)) return false;
  for (let i = 1; i < poly.rings.length; i++) if (inRing(lon, lat, poly.rings[i]!)) return false;
  return true;
}

export function isLand(p: LatLon): boolean {
  for (const poly of polygons()) {
    // Un contour déroulé peut déborder de ±180° : on teste aussi la longitude décalée d'un tour.
    if (inPolygon(p.lon, p.lat, poly) || inPolygon(p.lon + 360, p.lat, poly) || inPolygon(p.lon - 360, p.lat, poly)) return true;
  }
  return false;
}

/** Points d'échantillonnage du trajet, extrémités comprises. */
function samples(a: LatLon, b: LatLon, stepKm: number): LatLon[] {
  const total = distanceKm(a, b);
  const n = Math.max(1, Math.ceil(total / stepKm));
  const bearing = bearingDeg(a, b);
  const out: LatLon[] = [a];
  for (let i = 1; i < n; i++) out.push(destination(a, bearing, (total * i) / n));
  out.push(b);
  return out;
}

/** Le trajet direct reste-t-il entièrement à terre ? */
export function pathOnLand(a: LatLon, b: LatLon, stepKm = 2): boolean {
  return samples(a, b, stepKm).every(isLand);
}

/** Le trajet direct reste-t-il entièrement en mer ? */
export function pathAtSea(a: LatLon, b: LatLon, stepKm = 2): boolean {
  return samples(a, b, stepKm).every((p) => !isLand(p));
}

/** Premier point à terre rencontré en allant de `from` vers `to` ; `null` si le trajet reste en mer. */
export function firstLandToward(from: LatLon, to: LatLon, stepKm = 1): LatLon | null {
  for (const p of samples(from, to, stepKm)) if (isLand(p)) return p;
  return null;
}
