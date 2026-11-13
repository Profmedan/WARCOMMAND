/**
 * Terrain. Hors de toute zone décrite par le scénario, le terrain est « ouvert ».
 * Les coefficients sont des valeurs de jeu : mobilité (vitesse), protection du défenseur immobile,
 * dissimulation (portée à laquelle l'unité qui s'y trouve est observée).
 */
import { inCircle, type LatLon } from './geo';
import type { SimState, TerrainKind } from './types';

export type Terrain = TerrainKind | 'ouvert';

export const TERRAIN: Record<Terrain, { mobility: number; defence: number; concealment: number }> = {
  ouvert: { mobility: 1, defence: 1, concealment: 1 },
  urbain: { mobility: 0.6, defence: 1.5, concealment: 0.6 },
  foret: { mobility: 0.6, defence: 1.3, concealment: 0.6 },
  montagne: { mobility: 0.4, defence: 1.4, concealment: 0.8 },
  marais: { mobility: 0.4, defence: 0.9, concealment: 1 },
};

/** Terrain en un point : la première zone du scénario qui le contient. */
export function terrainAt(s: SimState, pos: LatLon): Terrain {
  for (const zone of s.terrain) if (inCircle(pos, zone)) return zone.kind;
  return 'ouvert';
}
