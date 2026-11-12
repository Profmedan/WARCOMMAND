import type { System } from '@warcommand/simulation-core';
import { engagementSystem } from './engagement';
import { missionSystem } from './missions';
import { movementSystem } from './movement';
import { sensorSystem } from './sensors';
import { tacticalSystem } from './tactics';

export * from './helpers';
export * from './orders';
export * from './missions';
export * from './tactics';
export * from './movement';
export * from './sensors';
export * from './engagement';
export * from './planning';

/** Systèmes des opérations aériennes, dans leur ordre d'application à chaque pas. */
export const AIR_SYSTEMS: readonly System[] = [
  missionSystem,
  tacticalSystem,
  movementSystem,
  sensorSystem,
  engagementSystem,
];
