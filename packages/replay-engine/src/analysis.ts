/**
 * Analyse approfondie des opérations.
 *
 * Tout est recalculé par re-simulation de l'enregistrement : aucune mesure n'est stockée pendant la partie.
 * L'analyse lit la vérité-terrain ; elle n'est à montrer qu'une fois la mission terminée.
 */
import {
  SIDES,
  type ControlStatus,
  type MissionStatus,
  type MissionType,
  type Outcome,
  type ShotWeapon,
  type SideId,
  type SimEvent,
  type SimState,
  type UnitKind,
} from '@warcommand/simulation-core';
import { cloneData } from '@warcommand/simulation-core';
import { createSession, issueOrder, stepSession, type Session } from '@warcommand/scenario-system';
import type { Recording } from './index';

export interface SideSeries {
  /** Chasseurs ni détruits ni en réparation. */
  fightersAvailable: number[];
  fightersAirborne: number[];
  /** Somme des effectifs des formations terrestres, en équivalents de formation. */
  landStrength: number[];
  /** Somme des points de coque des bâtiments à flot. */
  hull: number[];
  /** Part des unités adverses en opération tenues en piste fraîche ; `null` si l'adversaire n'a rien en opération. */
  awareness: (number | null)[];
}

export interface EngagementLine {
  side: SideId;
  weapon: ShotWeapon;
  shots: number;
  hits: number;
  kills: number;
  /** Somme des probabilités de coup au but : ce que le hasard « devait » donner. */
  expectedHits: number;
}

export type RangeBandId = 'near' | 'mid' | 'far';

export interface RangeBand {
  /** near : moins d'un tiers de la portée · mid : moins des deux tiers · far : au-delà. */
  band: RangeBandId;
  shots: number;
  hits: number;
  expectedHits: number;
}

export interface AlertSplit {
  /** Tirs air-air et sol-air sur une cible qui suivait le tireur. */
  aware: { shots: number; hits: number };
  /** Tirs sur une cible surprise. */
  surprised: { shots: number; hits: number };
}

export interface KillChain {
  killer: SideId;
  target: string;
  kind: UnitKind;
  /** Première détection de la cible par le camp qui l'a détruite ; négatif pour un renseignement antérieur à la mission. */
  detectedAt: number | null;
  identifiedAt: number | null;
  firstShotAt: number;
  destroyedAt: number;
}

export interface MissionReport {
  side: SideId;
  name: string;
  type: MissionType;
  status: MissionStatus;
  /** Appareils affectés à la mission au cours de la partie. */
  aircraft: number;
  launchedAt: number | null;
  /** Temps pendant lequel au moins un appareil tenait la station. */
  onStationS: number;
  shots: number;
  hits: number;
  kills: number;
  lost: number;
}

export type KeyMomentKind = 'contact' | 'shot' | 'loss' | 'control' | 'landing' | 'effect' | 'broken' | 'end';

export interface KeyMoment {
  t: number;
  kind: KeyMomentKind;
  /** Camp concerné : celui qui détecte, tire, emploie ou débarque — ou celui qui subit la perte. */
  side: SideId | null;
  p: Record<string, string | number>;
}

export interface OperationsAnalysis {
  sampleEveryS: number;
  times: number[];
  control: ControlStatus[];
  sides: Record<SideId, SideSeries>;
  engagements: EngagementLine[];
  ranges: Record<SideId, RangeBand[]>;
  alert: Record<SideId, AlertSplit>;
  killChains: KillChain[];
  /** Délais médians de la chaîne d'engagement, en secondes ; `null` sans destruction obtenue par un tir. */
  chainMedians: Record<SideId, { detectToShotS: number | null; shotToKillS: number | null }>;
  missions: MissionReport[];
  keyMoments: KeyMoment[];
}

/** Re-simule un enregistrement en appelant `visit` sur l'état initial puis après chaque pas. */
export function scanRecording(recording: Recording, visit: (state: SimState) => void): Session {
  const session = createSession(recording.scenario, recording.options);
  const orders = recording.orders;
  let next = 0;
  const applyDue = () => {
    while (next < orders.length && orders[next]!.t <= session.state.time) {
      issueOrder(session, cloneData(orders[next]!.order));
      next += 1;
    }
  };
  visit(session.state);
  while (!session.state.outcome) {
    applyDue();
    stepSession(session, 1);
    visit(session.state);
  }
  return session;
}

const BANDS: readonly RangeBandId[] = ['near', 'mid', 'far'];
const KILLING = new Set(['destroyed', 'sunk']);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface MissionTally {
  members: Set<string>;
  launchedAt: number | null;
  onStationS: number;
  shots: number;
  hits: number;
  kills: number;
  lost: number;
}

export function analyzeRecording(recording: Recording, sampleEveryS = 60): OperationsAnalysis {
  const emptySeries = (): SideSeries => ({ fightersAvailable: [], fightersAirborne: [], landStrength: [], hull: [], awareness: [] });
  const times: number[] = [];
  const control: ControlStatus[] = [];
  const series: Record<SideId, SideSeries> = { BLUE: emptySeries(), RED: emptySeries() };

  const tallies = new Map<string, MissionTally>();
  const lastMission = new Map<string, string>();
  const shotMission = new Map<number, string | null>();
  const firstShotAt = new Map<string, number>();
  const detectedAt = new Map<string, number>();
  const identifiedAt = new Map<string, number>();
  const destroyedSeen = new Set<string>();
  const losses: KeyMoment[] = [];
  let shotsSeen = 0;

  const sample = (s: SimState) => {
    times.push(s.time);
    control.push(s.objective.status);
    const units = Object.values(s.units);
    for (const side of SIDES) {
      const own = units.filter((u) => u.side === side);
      const fighters = own.filter((u) => u.kind === 'fighter');
      const out = series[side];
      out.fightersAvailable.push(fighters.filter((u) => u.status !== 'destroyed' && u.status !== 'maintenance').length);
      out.fightersAirborne.push(fighters.filter((u) => u.status === 'airborne').length);
      out.landStrength.push(own.reduce((sum, u) => sum + (u.land && u.status !== 'destroyed' ? u.land.strength : 0), 0));
      out.hull.push(own.reduce((sum, u) => sum + (u.naval && u.status !== 'destroyed' ? u.naval.hull : 0), 0));
      const fresh = new Set(
        Object.values(s.contacts[side])
          .filter((c) => !c.stale)
          .map((c) => c.unitId),
      );
      const targets = units.filter((u) => u.side !== side && (u.status === 'airborne' || u.status === 'active'));
      out.awareness.push(targets.length === 0 ? null : targets.filter((u) => fresh.has(u.id)).length / targets.length);
    }
  };

  const visit = (s: SimState) => {
    for (const m of Object.values(s.missions)) {
      if (!tallies.has(m.id)) tallies.set(m.id, { members: new Set(m.unitIds), launchedAt: null, onStationS: 0, shots: 0, hits: 0, kills: 0, lost: 0 });
    }
    const onStation = new Set<string>();
    for (const u of Object.values(s.units)) {
      if (u.missionId) {
        lastMission.set(u.id, u.missionId);
        const tally = tallies.get(u.missionId);
        if (tally) {
          tally.members.add(u.id);
          if (u.status === 'airborne' && tally.launchedAt === null) tally.launchedAt = s.time;
          if (u.task === 'station') onStation.add(u.missionId);
        }
      }
      if (u.status === 'destroyed' && !destroyedSeen.has(u.id)) {
        destroyedSeen.add(u.id);
        losses.push({ t: s.time, kind: 'loss', side: u.side, p: { unit: u.name, kind: u.kind } });
        const mission = u.domain === 'air' ? lastMission.get(u.id) : undefined;
        const tally = mission ? tallies.get(mission) : undefined;
        if (tally) tally.lost += 1;
      }
    }
    if (s.time > 0) for (const id of onStation) tallies.get(id)!.onStationS += s.rules.dtS;

    for (const shot of s.shots) {
      if (shot.id <= shotsSeen) continue;
      shotMission.set(shot.id, s.units[shot.shooterId]?.missionId ?? lastMission.get(shot.shooterId) ?? null);
      const key = `${shot.side}|${shot.targetId}`;
      if (!firstShotAt.has(key)) firstShotAt.set(key, shot.firedAt);
    }
    shotsSeen = s.shotSeq;

    for (const side of SIDES) {
      for (const c of Object.values(s.contacts[side])) {
        const key = `${side}|${c.unitId}`;
        const known = detectedAt.get(key);
        if (known === undefined || c.firstSeen < known) detectedAt.set(key, c.firstSeen);
        if (c.identified && !identifiedAt.has(key)) identifiedAt.set(key, Math.max(c.firstSeen, s.time));
      }
    }

    if (s.time % sampleEveryS === 0 || s.outcome) sample(s);
  };

  const state = scanRecording(recording, visit).state;

  const lines = new Map<string, EngagementLine>();
  const ranges: Record<SideId, RangeBand[]> = {
    BLUE: BANDS.map((band) => ({ band, shots: 0, hits: 0, expectedHits: 0 })),
    RED: BANDS.map((band) => ({ band, shots: 0, hits: 0, expectedHits: 0 })),
  };
  const alert: Record<SideId, AlertSplit> = {
    BLUE: { aware: { shots: 0, hits: 0 }, surprised: { shots: 0, hits: 0 } },
    RED: { aware: { shots: 0, hits: 0 }, surprised: { shots: 0, hits: 0 } },
  };
  const killChains: KillChain[] = [];
  const moments: KeyMoment[] = [...losses];
  const firstContact = new Set<SideId>();
  const firstShot = new Set<SideId>();
  let end: KeyMoment | null = null;

  const onResolved = (e: SimEvent) => {
    const side = e.p.side as SideId;
    const weapon = e.p.weapon as ShotWeapon;
    const hit = e.p.hit === 1 ? 1 : 0;
    const pk = typeof e.p.pk === 'number' ? e.p.pk : 0;
    const kill = KILLING.has(String(e.p.result)) ? 1 : 0;

    const lineKey = `${side}|${weapon}`;
    const line = lines.get(lineKey) ?? { side, weapon, shots: 0, hits: 0, kills: 0, expectedHits: 0 };
    line.shots += 1;
    line.hits += hit;
    line.kills += kill;
    line.expectedHits += pk;
    lines.set(lineKey, line);

    const fraction = Number(e.p.maxKm) > 0 ? Number(e.p.rangeKm) / Number(e.p.maxKm) : 0;
    const band = ranges[side][fraction < 1 / 3 ? 0 : fraction < 2 / 3 ? 1 : 2]!;
    band.shots += 1;
    band.hits += hit;
    band.expectedHits += pk;

    if (weapon === 'aam' || weapon === 'sam') {
      const bucket = e.p.aware === 1 ? alert[side].aware : alert[side].surprised;
      bucket.shots += 1;
      bucket.hits += hit;
    }

    const shooterId = String(e.p.shooterId);
    const shotId = Number(e.p.shot);
    const mission = shotMission.has(shotId) ? shotMission.get(shotId)! : (lastMission.get(shooterId) ?? null);
    const tally = (weapon === 'aam' || weapon === 'asm') && mission ? tallies.get(mission) : undefined;
    if (tally) {
      tally.shots += 1;
      tally.hits += hit;
      tally.kills += kill;
    }

    if (kill) {
      const targetId = String(e.p.targetId);
      const key = `${side}|${targetId}`;
      const target = state.units[targetId];
      killChains.push({
        killer: side,
        target: String(e.p.target),
        kind: target ? target.kind : 'fighter',
        detectedAt: detectedAt.get(key) ?? null,
        identifiedAt: identifiedAt.get(key) ?? null,
        firstShotAt: Math.min(firstShotAt.get(key) ?? Number(e.p.firedAt), Number(e.p.firedAt)),
        destroyedAt: e.t,
      });
    }
  };

  for (const e of state.events) {
    const side = e.vis[0] ?? null;
    switch (e.code) {
      case 'SHOT_RESOLVED':
        onResolved(e);
        break;
      case 'CONTACT_NEW':
        if (side && !firstContact.has(side)) {
          firstContact.add(side);
          moments.push({ t: e.t, kind: 'contact', side, p: { ...e.p } });
        }
        break;
      case 'SHOT_FIRED':
        if (side && !firstShot.has(side)) {
          firstShot.add(side);
          moments.push({ t: e.t, kind: 'shot', side, p: { ...e.p } });
        }
        break;
      case 'CONTROL_CHANGED':
        moments.push({ t: e.t, kind: 'control', side: null, p: { ...e.p } });
        break;
      case 'TROOPS_LANDED':
        moments.push({ t: e.t, kind: 'landing', side, p: { ...e.p } });
        break;
      case 'EFFECT_USED':
        moments.push({ t: e.t, kind: 'effect', side, p: { ...e.p } });
        break;
      case 'LAND_BROKEN':
        moments.push({ t: e.t, kind: 'broken', side, p: { ...e.p } });
        break;
      case 'MISSION_END':
        end = { t: e.t, kind: 'end', side: null, p: { ...e.p } };
        break;
      default:
        break;
    }
  }
  // Tri stable : à instant égal, l'ordre de relevé est conservé ; la fin de mission ferme la liste.
  moments.sort((a, b) => a.t - b.t);
  if (end) moments.push(end);

  const chainMedians = Object.fromEntries(
    SIDES.map((side) => {
      const mine = killChains.filter((c) => c.killer === side);
      return [
        side,
        {
          detectToShotS: median(mine.filter((c) => c.detectedAt !== null).map((c) => c.firstShotAt - Math.max(0, c.detectedAt!))),
          shotToKillS: median(mine.map((c) => c.destroyedAt - c.firstShotAt)),
        },
      ];
    }),
  ) as OperationsAnalysis['chainMedians'];

  const missions: MissionReport[] = Object.values(state.missions).map((m) => {
    const tally = tallies.get(m.id)!;
    return {
      side: m.side,
      name: m.name,
      type: m.type,
      status: m.status,
      aircraft: tally.members.size,
      launchedAt: tally.launchedAt,
      onStationS: tally.onStationS,
      shots: tally.shots,
      hits: tally.hits,
      kills: tally.kills,
      lost: tally.lost,
    };
  });

  return {
    sampleEveryS,
    times,
    control,
    sides: series,
    engagements: [...lines.values()],
    ranges,
    alert,
    killChains,
    chainMedians,
    missions,
    keyMoments: moments,
  };
}

/* ------------------------------------------------------------------ Sensibilité au hasard */

export interface RerunResult {
  seed: number;
  winner: SideId | 'DRAW';
  level: Outcome['level'];
  /** Temps de contrôle du défenseur. */
  defenderControlSec: number;
  /** Unités perdues par chaque camp. */
  losses: Record<SideId, number>;
  /** Ordres du joueur que la nouvelle situation a rendus irrecevables. */
  refusedOrders: number;
}

/**
 * Rejoue la partie avec une autre graine : mêmes forces, mêmes ordres aux mêmes instants, autres tirages.
 * Un ordre que la nouvelle situation rend irrecevable (piste absente, appareil perdu) est compté et ignoré.
 */
export function rerunWithSeed(recording: Recording, seed: number): RerunResult {
  const session = createSession(recording.scenario, { ...recording.options, seed });
  const orders = recording.orders;
  let next = 0;
  let refusedOrders = 0;
  const applyDue = () => {
    while (next < orders.length && orders[next]!.t <= session.state.time) {
      if (!issueOrder(session, cloneData(orders[next]!.order)).ok) refusedOrders += 1;
      next += 1;
    }
  };
  while (!session.state.outcome) {
    applyDue();
    stepSession(session, 1);
  }
  const s = session.state;
  const lost = (side: SideId) => Object.values(s.stats[side].losses).reduce((a, b) => a + b, 0);
  return {
    seed,
    winner: s.outcome!.winner,
    level: s.outcome!.level,
    defenderControlSec: s.objective.sec[s.objective.defender],
    losses: { BLUE: lost('BLUE'), RED: lost('RED') },
    refusedOrders,
  };
}

/** Graines de rejeu dérivées de la graine d'origine : distinctes entre elles, distinctes de l'origine, toujours les mêmes. */
export function rerunSeeds(seed: number, n: number): number[] {
  const seeds: number[] = [];
  for (let i = 1; i <= n; i++) seeds.push((seed + Math.imul(i, 0x9e3779b1)) >>> 0);
  return seeds;
}

export interface SensitivitySummary {
  runs: number;
  wins: Record<SideId | 'DRAW', number>;
  defenderControlSec: { min: number; median: number; max: number };
  /** Rejeux qui donnent le même vainqueur que la partie d'origine. */
  sameAsOriginal: number;
  refusedOrders: number;
}

export function summarizeReruns(results: readonly RerunResult[], original: Outcome | null): SensitivitySummary {
  const wins: SensitivitySummary['wins'] = { BLUE: 0, RED: 0, DRAW: 0 };
  for (const r of results) wins[r.winner] += 1;
  const control = results.map((r) => r.defenderControlSec);
  return {
    runs: results.length,
    wins,
    defenderControlSec: { min: control.length ? Math.min(...control) : 0, median: median(control) ?? 0, max: control.length ? Math.max(...control) : 0 },
    sameAsOriginal: original ? results.filter((r) => r.winner === original.winner).length : 0,
    refusedOrders: results.reduce((n, r) => n + r.refusedOrders, 0),
  };
}
