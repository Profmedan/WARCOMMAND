/**
 * Enregistrement, rejeu déterministe, sauvegarde et compte rendu après action (AAR).
 *
 * Un enregistrement ne contient que le scénario, les options (dont la graine) et les ordres
 * horodatés du joueur. Rejouer, c'est re-simuler : les décisions de l'IA et tous les tirages
 * se reproduisent à l'identique.
 */
import {
  cloneData,
  hashState,
  SIDES,
  type AiDecision,
  type ControlLedger,
  type ControlStatus,
  type Outcome,
  type SideId,
  type SideStats,
  type SimEvent,
  type SimState,
  type UnitStatus,
} from '@warcommand/simulation-core';
import {
  createSession,
  issueOrder,
  parseScenario,
  stepSession,
  type Scenario,
  type Session,
  type SetupOptions,
  type TimedOrder,
} from '@warcommand/scenario-system';

export const RECORDING_VERSION = 1;
export const SAVE_VERSION = 1;

export interface Recording {
  format: 'warcommand-recording';
  version: 1;
  scenario: Scenario;
  options: SetupOptions;
  orders: TimedOrder[];
}

export interface SaveGame {
  format: 'warcommand-save';
  version: 1;
  /** Empreinte de l'état au moment de la sauvegarde. */
  hash: string;
  recording: Recording;
  state: SimState;
}

export function recordingOf(session: Session): Recording {
  return cloneData({
    format: 'warcommand-recording' as const,
    version: 1 as const,
    scenario: session.scenario,
    options: session.options,
    orders: session.orders,
  });
}

/** Re-simule un enregistrement jusqu'à `untilTime` (secondes) ou jusqu'à la fin de la mission. */
export function replay(recording: Recording, untilTime = Infinity): Session {
  const session = createSession(recording.scenario, recording.options);
  const orders = recording.orders;
  let next = 0;
  const applyDue = () => {
    while (next < orders.length && orders[next]!.t <= session.state.time) {
      issueOrder(session, cloneData(orders[next]!.order));
      next += 1;
    }
  };
  while (!session.state.outcome && session.state.time < untilTime) {
    applyDue();
    stepSession(session, 1);
  }
  if (!session.state.outcome) applyDue();
  return session;
}

export interface ReplayCursor {
  /** Instant de fin de la partie enregistrée. */
  endTime: number;
  /** État complet (vérité-terrain) à l'instant demandé, obtenu par re-simulation depuis l'image-clé précédente. */
  stateAt(t: number): SimState;
}

/**
 * Prépare la consultation d'une partie à n'importe quel instant (mode observateur).
 * Une passe complète mémorise des images-clés ; chaque consultation re-simule au plus `keyframeEveryS` pas.
 */
export function createReplayCursor(recording: Recording, keyframeEveryS = 300): ReplayCursor {
  const orders = recording.orders;
  const applyDue = (session: Session, from: number): number => {
    let next = from;
    while (next < orders.length && orders[next]!.t <= session.state.time) {
      issueOrder(session, cloneData(orders[next]!.order));
      next += 1;
    }
    return next;
  };

  const session = createSession(recording.scenario, recording.options);
  const frames: { t: number; state: SimState; next: number }[] = [{ t: 0, state: cloneData(session.state), next: 0 }];
  let next = 0;
  while (!session.state.outcome) {
    next = applyDue(session, next);
    stepSession(session, 1);
    if (!session.state.outcome && session.state.time % keyframeEveryS === 0) {
      frames.push({ t: session.state.time, state: cloneData(session.state), next });
    }
  }
  const endTime = session.state.time;
  const final = cloneData(session.state);

  return {
    endTime,
    stateAt(t: number): SimState {
      const target = Math.max(0, Math.min(endTime, Math.round(t)));
      if (target >= endTime) return final;
      let frame = frames[0]!;
      for (const f of frames) if (f.t <= target) frame = f;
      const s: Session = { scenario: recording.scenario, options: recording.options, state: cloneData(frame.state), orders: [] };
      let idx = frame.next;
      while (s.state.time < target && !s.state.outcome) {
        idx = applyDue(s, idx);
        stepSession(s, 1);
      }
      // Comme `replay` : les ordres émis à l'instant demandé font partie de l'état restitué.
      if (!s.state.outcome) applyDue(s, idx);
      return s.state;
    },
  };
}

export function saveGame(session: Session): SaveGame {
  return {
    format: 'warcommand-save',
    version: 1,
    hash: hashState(session.state),
    recording: recordingOf(session),
    state: cloneData(session.state),
  };
}

export type LoadResult = { ok: true; session: Session } | { ok: false; errors: string[] };

/** Recharge une sauvegarde (objet issu d'un JSON). Le scénario embarqué est revalidé. */
/** Version du format d'état que ce moteur produit et sait reprendre. */
const STATE_FORMAT_VERSION: SimState['formatVersion'] = 2;

export function loadGame(data: unknown): LoadResult {
  if (typeof data !== 'object' || data === null) return { ok: false, errors: ['Sauvegarde illisible'] };
  const save = data as Partial<SaveGame>;
  if (save.format !== 'warcommand-save') return { ok: false, errors: ['Ce fichier n’est pas une sauvegarde WAR COMMAND'] };
  if (save.version !== SAVE_VERSION) return { ok: false, errors: [`Version de sauvegarde non prise en charge : ${String(save.version)}`] };
  const rec = save.recording;
  const state = save.state;
  if (!rec || !state || !Array.isArray(rec.orders) || !rec.options) return { ok: false, errors: ['Sauvegarde incomplète'] };
  const parsed = parseScenario(rec.scenario);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  // L'état d'une partie change de forme avec le moteur : une sauvegarde plus ancienne ne peut pas être reprise.
  if ((state.formatVersion as number) !== STATE_FORMAT_VERSION) {
    return { ok: false, errors: ['Cette sauvegarde a été faite avec une version antérieure du jeu : elle ne peut pas être reprise par celle-ci.'] };
  }
  if (state.scenarioId !== parsed.scenario.id) {
    return { ok: false, errors: ['L’état sauvegardé ne correspond pas au scénario'] };
  }
  if (save.hash !== hashState(state)) return { ok: false, errors: ['Sauvegarde altérée : l’empreinte ne correspond pas'] };
  return {
    ok: true,
    session: { scenario: parsed.scenario, options: cloneData(rec.options), state: cloneData(state), orders: cloneData(rec.orders) },
  };
}

/** Rejoue un enregistrement et vérifie qu'il reproduit l'état attendu. */
export function verifyReplay(recording: Recording, expected: SimState): boolean {
  return hashState(replay(recording, expected.time).state) === hashState(expected);
}

export interface ControlSegment {
  from: number;
  to: number;
  status: ControlStatus;
}

export interface ShotRecord {
  t: number;
  shooter: string;
  target: string;
  weapon: string;
  pk: number;
  roll: number;
  result: string;
}

export interface AarUnit {
  name: string;
  platform: string;
  status: UnitStatus;
  damaged: boolean;
  fuelPct: number | null;
  weapons: number;
}

export interface AarSide {
  name: string;
  controlledByAi: boolean;
  stats: SideStats;
  units: AarUnit[];
  missions: { name: string; type: string; status: string; aircraft: number }[];
  /** Décompte du contrôle tel que ce camp le percevait. */
  perceivedSec: ControlLedger;
  aiDecisions: AiDecision[];
}

export interface AfterActionReport {
  scenarioId: string;
  seed: number;
  outcome: Outcome | null;
  elapsedSec: number;
  defender: SideId;
  defenderWinsAtSec: number;
  challengerWinsBelowSec: number;
  controlSec: ControlLedger;
  controlTimeline: ControlSegment[];
  sides: Record<SideId, AarSide>;
  shots: ShotRecord[];
  events: SimEvent[];
  hash: string;
}

/** Compte rendu après action : vérité-terrain des deux camps. À n'afficher qu'une fois la mission terminée. */
export function buildAar(state: SimState): AfterActionReport {
  const o = state.objective;
  const timeline: ControlSegment[] = o.timeline.map((seg, i) => ({
    from: seg.t,
    to: i + 1 < o.timeline.length ? o.timeline[i + 1]!.t : state.time,
    status: seg.status,
  }));

  const side = (id: SideId): AarSide => ({
    name: state.sideNames[id],
    controlledByAi: state.ai[id] !== null,
    stats: cloneData(state.stats[id]),
    units: Object.values(state.units)
      .filter((u) => u.side === id)
      .map((u) => {
        const p = state.platforms[u.platformId]!;
        return {
          name: u.name,
          platform: p.label,
          status: u.status,
          damaged: u.damaged,
          fuelPct: p.fuelCapacityKg > 0 ? Math.round((100 * u.fuelKg) / p.fuelCapacityKg) : null,
          weapons: u.weapons,
        };
      }),
    missions: Object.values(state.missions)
      .filter((m) => m.side === id)
      .map((m) => ({ name: m.name, type: m.type, status: m.status, aircraft: m.unitIds.length })),
    perceivedSec: { ...o.perceived[id].sec },
    aiDecisions: cloneData(state.ai[id]?.log ?? []),
  });

  const shots: ShotRecord[] = state.events
    .filter((e) => e.code === 'SHOT_RESOLVED')
    .map((e) => ({
      t: e.t,
      shooter: String(e.p.shooter),
      target: String(e.p.target),
      weapon: String(e.p.weapon),
      pk: Number(e.p.pk),
      roll: Number(e.p.roll),
      result: String(e.p.result),
    }));

  return {
    scenarioId: state.scenarioId,
    seed: state.seed,
    outcome: state.outcome,
    elapsedSec: state.time,
    defender: o.defender,
    defenderWinsAtSec: o.defenderWinsAtSec,
    challengerWinsBelowSec: o.challengerWinsBelowSec,
    controlSec: { ...o.sec },
    controlTimeline: timeline,
    sides: { BLUE: side('BLUE'), RED: side('RED') },
    shots,
    events: cloneData(state.events),
    hash: hashState(state),
  };
}

export { SIDES };
