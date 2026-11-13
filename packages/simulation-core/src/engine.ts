import type { EventCode, Shot, SideId, SimEvent, SimState } from './types';

/** Un système applique une famille de règles à l'état, pour un pas de temps. */
export type System = (state: SimState) => void;

export function emit(
  state: SimState,
  code: EventCode,
  vis: readonly SideId[],
  p: Record<string, string | number> = {},
): void {
  state.events.push({ t: state.time, code, vis: [...vis], p });
}

/**
 * Faits d'un tir consignés à sa résolution. L'événement n'est visible que de l'arbitre : il peut porter les
 * identifiants de vérité-terrain dont l'analyse après action a besoin.
 */
export function shotFacts(shot: Shot, targetName: string): Record<string, string | number> {
  return {
    shot: shot.id,
    side: shot.side,
    shooter: shot.shooterName,
    shooterId: shot.shooterId,
    target: targetName,
    targetId: shot.targetId,
    weapon: shot.weapon,
    firedAt: shot.firedAt,
    rangeKm: Math.round(shot.launchRangeKm),
    maxKm: Math.round(shot.maxRangeKm),
    aware: shot.targetAware ? 1 : 0,
  };
}

/**
 * Avance la simulation d'un pas fixe (`rules.dtS`) en appliquant les systèmes dans l'ordre.
 * Ne fait rien une fois la mission terminée.
 */
export function stepState(state: SimState, systems: readonly System[]): void {
  if (state.outcome) return;
  state.time += state.rules.dtS;
  for (const system of systems) {
    system(state);
    if (state.outcome) return;
  }
}

/** Événements visibles par un camp (ou tous les événements pour l'observateur). */
export function visibleEvents(state: SimState, side: SideId | 'OBSERVER', fromIndex = 0): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = fromIndex; i < state.events.length; i++) {
    const e = state.events[i]!;
    if (side === 'OBSERVER' || e.vis.includes(side)) out.push(e);
  }
  return out;
}

/** Empreinte 64 bits (FNV-1a double) du JSON de l'état : deux états identiques ont la même empreinte. */
export function hashState(state: unknown): string {
  const json = JSON.stringify(state);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x27d4eb2f) >>> 0;
    h2 = (h2 ^ (h2 >>> 15)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Copie profonde d'une donnée pure. */
export function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Heure Zulu « HH:MM:SS » correspondant à un instant de simulation. */
export function clockZ(startIso: string, timeS: number, withSeconds = true): string {
  const d = new Date(Date.parse(startIso) + timeS * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}
