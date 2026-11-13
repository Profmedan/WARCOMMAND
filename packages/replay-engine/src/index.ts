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
  type SofPhase,
  type UnitKind,
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
      applyRecorded(session, orders[next]!.order);
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

/** Position passée d'une unité, relevée pendant la re-simulation. */
export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  altM: number;
}

export interface ReplayCursor {
  /** Instant de fin de la partie enregistrée. */
  endTime: number;
  /** État complet (vérité-terrain) à l'instant demandé. L'objet rendu appartient à l'appelant : il n'est plus modifié. */
  stateAt(t: number): SimState;
  /** Trace d'une unité : ses positions relevées entre `t - spanS` et `t`, tant qu'elle était en opération. */
  trail(unitId: string, t: number, spanS: number): TrackPoint[];
  /** Journal complet de la partie (les deux camps et l'arbitre), pour la chronologie. */
  events: SimEvent[];
}

/** Applique un ordre enregistré. Un ordre que le moteur ne sait pas lire est refusé, sans interrompre le rejeu. */
function applyRecorded(session: Session, order: TimedOrder['order']): boolean {
  try {
    return issueOrder(session, cloneData(order)).ok;
  } catch {
    return false;
  }
}

/**
 * Prépare la consultation d'une partie à n'importe quel instant (rejeu détaillé).
 * Une passe complète mémorise des images-clés et la trace des unités ; une consultation re-simule au plus
 * `keyframeEveryS` pas, et la lecture en continu avance d'un état au suivant sans repartir d'une image-clé.
 */
export function createReplayCursor(recording: Recording, keyframeEveryS = 300, trackEveryS = 30): ReplayCursor {
  const orders = recording.orders;
  const applyDue = (session: Session, from: number): number => {
    let next = from;
    while (next < orders.length && orders[next]!.t <= session.state.time) {
      applyRecorded(session, orders[next]!.order);
      next += 1;
    }
    return next;
  };

  const tracks = new Map<string, TrackPoint[]>();
  const track = (s: SimState) => {
    for (const u of Object.values(s.units)) {
      if (u.status !== 'airborne' && u.status !== 'active') continue;
      let points = tracks.get(u.id);
      if (!points) tracks.set(u.id, (points = []));
      points.push({ t: s.time, lat: u.pos.lat, lon: u.pos.lon, altM: u.altM });
    }
  };

  const session = createSession(recording.scenario, recording.options);
  const frames: { t: number; state: SimState; next: number }[] = [{ t: 0, state: cloneData(session.state), next: 0 }];
  track(session.state);
  let next = 0;
  while (!session.state.outcome) {
    next = applyDue(session, next);
    stepSession(session, 1);
    if (!session.state.outcome && session.state.time % keyframeEveryS === 0) {
      frames.push({ t: session.state.time, state: cloneData(session.state), next });
    }
    if (session.state.outcome || session.state.time % trackEveryS === 0) track(session.state);
  }
  const endTime = session.state.time;
  const final = cloneData(session.state);

  // État de travail : la lecture en continu le fait avancer au lieu de repartir d'une image-clé.
  let work: { session: Session; next: number } | null = null;

  return {
    endTime,
    events: final.events,
    stateAt(t: number): SimState {
      const target = Math.max(0, Math.min(endTime, Math.round(t)));
      if (target >= endTime) return final;
      if (!work || work.session.state.time > target || target - work.session.state.time > keyframeEveryS) {
        let frame = frames[0]!;
        for (const f of frames) if (f.t <= target) frame = f;
        work = { session: { scenario: recording.scenario, options: recording.options, state: cloneData(frame.state), orders: [] }, next: frame.next };
      }
      const s = work.session;
      while (s.state.time < target && !s.state.outcome) {
        work.next = applyDue(s, work.next);
        stepSession(s, 1);
      }
      // Comme `replay` : les ordres émis à l'instant demandé font partie de l'état restitué.
      if (!s.state.outcome) work.next = applyDue(s, work.next);
      return cloneData(s.state);
    },
    trail(unitId: string, t: number, spanS: number): TrackPoint[] {
      const points = tracks.get(unitId);
      if (!points) return [];
      return points.filter((p) => p.t <= t && p.t >= t - spanS);
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

export type RecordingResult = { ok: true; recording: Recording } | { ok: false; errors: string[] };

const DIFFICULTIES: readonly string[] = ['recrue', 'standard', 'veteran'];

/**
 * Relit un enregistrement exporté (objet issu d'un JSON). Le scénario embarqué est revalidé ; les ordres ne sont
 * contrôlés que dans leur forme : au rejeu, le moteur refuse de lui-même ceux qu'il ne peut pas exécuter.
 */
export function loadRecording(data: unknown): RecordingResult {
  const fail = (...errors: string[]): RecordingResult => ({ ok: false, errors });
  if (typeof data !== 'object' || data === null) return fail('Enregistrement illisible');
  const rec = data as { format?: unknown; version?: unknown; scenario?: unknown; options?: unknown; orders?: unknown };
  if (rec.format === 'warcommand-save') return fail('Ce fichier est une sauvegarde de partie : reprenez-la par « Importer une sauvegarde ».');
  if (rec.format !== 'warcommand-recording') return fail('Ce fichier n’est pas un enregistrement WAR COMMAND');
  if (rec.version !== RECORDING_VERSION) return fail(`Version d’enregistrement non prise en charge : ${String(rec.version)}`);
  const parsed = parseScenario(rec.scenario);
  if (!parsed.ok) return fail(...parsed.errors);

  const o = rec.options as Partial<Record<keyof SetupOptions, unknown>> | null | undefined;
  if (typeof o !== 'object' || o === null) return fail('Enregistrement incomplet : options absentes');
  if (o.playerSide !== null && o.playerSide !== 'BLUE' && o.playerSide !== 'RED') return fail('Camp du joueur inconnu');
  if (typeof o.difficulty !== 'string' || !DIFFICULTIES.includes(o.difficulty)) return fail('Difficulté inconnue');
  if (typeof o.seed !== 'number' || !Number.isInteger(o.seed) || o.seed < 0 || o.seed > 0xffffffff) return fail('Graine invalide');
  if (o.wegoTurnMin !== undefined && (typeof o.wegoTurnMin !== 'number' || !(o.wegoTurnMin >= 0))) return fail('Durée de tour invalide');
  if (o.versus !== undefined && typeof o.versus !== 'boolean') return fail('Mode de jeu invalide');

  if (!Array.isArray(rec.orders)) return fail('Enregistrement incomplet : ordres absents');
  let previous = 0;
  for (let i = 0; i < rec.orders.length; i++) {
    const entry = rec.orders[i] as { t?: unknown; order?: { type?: unknown; side?: unknown } | null } | null;
    const order = entry?.order;
    const wellFormed =
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.t === 'number' &&
      Number.isFinite(entry.t) &&
      entry.t >= previous &&
      typeof order === 'object' &&
      order !== null &&
      typeof order.type === 'string' &&
      (order.side === 'BLUE' || order.side === 'RED');
    if (!wellFormed) return fail(`Ordre n° ${i + 1} mal formé`);
    previous = entry.t as number;
  }
  return {
    ok: true,
    recording: cloneData({
      format: 'warcommand-recording' as const,
      version: 1 as const,
      scenario: parsed.scenario,
      options: o as unknown as SetupOptions,
      orders: rec.orders as TimedOrder[],
    }),
  };
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
  kind: UnitKind;
  status: UnitStatus;
  damaged: boolean;
  fuelPct: number | null;
  weapons: number;
  /** Formation terrestre : effectifs restants, en % ; `null` pour les autres unités. */
  strengthPct: number | null;
  /** Bâtiment : points de coque restants et d'origine ; `null` pour les autres unités. */
  hull: { left: number; of: number } | null;
  /** Équipe spéciale : où elle en est ; `null` pour les autres unités. */
  sofPhase: SofPhase | null;
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
          kind: u.kind,
          status: u.status,
          damaged: u.damaged,
          fuelPct: p.fuelCapacityKg > 0 ? Math.round((100 * u.fuelKg) / p.fuelCapacityKg) : null,
          weapons: u.weapons,
          strengthPct: u.land ? Math.round(u.land.strength * 100) : null,
          hull: u.naval ? { left: u.naval.hull, of: p.hull } : null,
          sofPhase: u.sof ? u.sof.phase : null,
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
export * from './analysis';
