import { expect } from 'vitest';
import type { LatLon, Roe, SimState, Unit } from '@warcommand/simulation-core';
import { applyOrder, missionSystem, type MissionDraft } from '@warcommand/air-operations';
import { BOUCLIER_ATLANTIQUE, createInitialState } from '../src/index';

/** État initial du scénario de démonstration. Par défaut le joueur est BLEU et l'IA dirige ROUGE. */
export function freshState(playerSide: 'BLUE' | 'RED' | null = 'BLUE', seed = 1): SimState {
  return createInitialState(BOUCLIER_ATLANTIQUE, { playerSide, difficulty: 'standard', seed });
}

export const SECTOR: LatLon = { lat: 67.0, lon: -11.0 };

export function draft(over: Partial<MissionDraft> & Pick<MissionDraft, 'unitIds'>): MissionDraft {
  return {
    type: 'CAP',
    waypoints: [SECTOR],
    altM: 9000,
    speed: 'cruise',
    launchAt: 0,
    endAt: null,
    roe: 'defensive',
    allowRefuel: false,
    targetContactId: null,
    ...over,
  };
}

/** Place un chasseur en vol, en patrouille active autour de `pos`, avec les règles d'engagement données. */
export function putOnCap(s: SimState, unitId: string, pos: LatLon, headingDeg: number, roe: Roe): Unit {
  const u = s.units[unitId]!;
  u.status = 'airborne';
  u.pos = { ...pos };
  u.altM = 9000;
  u.headingDeg = headingDeg;
  const res = applyOrder(s, { type: 'CREATE_MISSION', side: u.side, draft: draft({ unitIds: [unitId], waypoints: [pos], roe, launchAt: s.time }) });
  expect(res.ok).toBe(true);
  missionSystem(s);
  u.task = 'station';
  return u;
}
