/**
 * Construit l'état initial de la simulation à partir d'un scénario validé.
 */
import {
  createStreams,
  DEFAULT_RULES,
  emit,
  isGroundForce,
  isNaval,
  MISSION_TYPES,
  SIDES,
  UNIT_KINDS,
  type Difficulty,
  type MissionType,
  type Rules,
  type SideId,
  type SideStats,
  type SimState,
  type Trigger,
  type TriggerCondition,
  type Unit,
  type UnitKind,
} from '@warcommand/simulation-core';
import { getPlatform, toPerf } from '@warcommand/unit-database';
import { resolveDoctrine } from '@warcommand/doctrine-engine';
import { applyOrder, type RejectCode } from '@warcommand/air-operations';
import { createAiMemory } from '@warcommand/ai-commander';
import type { Scenario } from './schema';

export interface SetupOptions {
  /** Camp du joueur humain ; `null` = les deux camps sont confiés à l'IA. */
  playerSide: SideId | null;
  difficulty: Difficulty;
  seed: number;
  /** Mode par tours (WEGO) : durée d'un tour en minutes ; 0 ou absent = temps continu. */
  wegoTurnMin?: number;
  /** Partie à deux joueurs humains : aucun camp n'est confié à l'IA. */
  versus?: boolean;
}

/** Une mission initiale du scénario est refusée par le moteur (hors rayon d'action, altitude…). */
export class InitialMissionError extends Error {
  readonly missionName: string;
  readonly code: RejectCode;

  constructor(scenarioId: string, missionName: string, code: RejectCode) {
    super(`Scénario « ${scenarioId} » : mission initiale ${missionName} refusée (${code})`);
    this.name = 'InitialMissionError';
    this.missionName = missionName;
    this.code = code;
  }
}

function emptyStats(): SideStats {
  return {
    sorties: 0,
    shotsFired: 0,
    asmFired: 0,
    hits: 0,
    kills: 0,
    fuelBurnedKg: 0,
    fuelTransferredKg: 0,
    losses: Object.fromEntries(UNIT_KINDS.map((kind) => [kind, 0])) as Record<UnitKind, number>,
    damaged: 0,
    landStrengthLost: 0,
    ssmFired: 0,
    torpedoesFired: 0,
    effectsUsed: 0,
  };
}

const emptyMissionSeq = () => Object.fromEntries(MISSION_TYPES.map((type) => [type, 0])) as Record<MissionType, number>;

function toCondition(c: Scenario['triggers'][number]['condition']): TriggerCondition {
  return c.type === 'TIME_ELAPSED' ? { type: 'TIME_ELAPSED', atSec: Math.round(c.atMin * 60) } : c;
}

export function createInitialState(scenario: Scenario, options: SetupOptions): SimState {
  const rules: Rules = { ...DEFAULT_RULES, ...(scenario.rules as Partial<Rules>) };
  const o = scenario.objective;
  const ledger = () => ({ BLUE: 0, RED: 0, CONTESTED: 0 });

  const state: SimState = {
    formatVersion: 2,
    scenarioId: scenario.id,
    seed: options.seed,
    time: 0,
    endTime: Math.round(scenario.durationMin * 60),
    startIso: scenario.date,
    wegoTurnS: Math.max(0, Math.round((options.wegoTurnMin ?? 0) * 60)),
    rng: createStreams(options.seed, ['sim', 'ai:BLUE', 'ai:RED']),
    theater: { ...scenario.region.bounds },
    weather: { ...scenario.weather },
    rules,
    platforms: {},
    sideNames: { BLUE: scenario.sides.BLUE.name, RED: scenario.sides.RED.name },
    groups: {},
    bases: {},
    units: {},
    missions: {},
    missionSeq: { BLUE: emptyMissionSeq(), RED: emptyMissionSeq() },
    contacts: { BLUE: {}, RED: {} },
    contactSeq: { BLUE: 0, RED: 0 },
    shots: [],
    shotSeq: 0,
    events: [],
    objective: {
      id: o.id,
      name: o.name,
      kind: o.kind,
      center: { ...o.center },
      radiusKm: o.radiusKm,
      defender: o.defender,
      defenderWinsAtSec: Math.round(o.defenderWinsAtMin * 60),
      challengerWinsBelowSec: Math.round(o.challengerWinsBelowMin * 60),
      controller: o.defender,
      status: o.defender,
      sec: ledger(),
      timeline: [{ t: 0, status: o.defender }],
      perceived: {
        BLUE: { controller: o.defender, status: o.defender, sec: ledger() },
        RED: { controller: o.defender, status: o.defender, sec: ledger() },
      },
    },
    navalZones: {
      BLUE: scenario.navalZones.BLUE ? { center: { ...scenario.navalZones.BLUE.center }, radiusKm: scenario.navalZones.BLUE.radiusKm } : null,
      RED: scenario.navalZones.RED ? { center: { ...scenario.navalZones.RED.center }, radiusKm: scenario.navalZones.RED.radiusKm } : null,
    },
    doctrine: {
      BLUE: resolveDoctrine(scenario.sides.BLUE.doctrineId, scenario.sides.BLUE.doctrineOverrides),
      RED: resolveDoctrine(scenario.sides.RED.doctrineId, scenario.sides.RED.doctrineOverrides),
    },
    defaultRoe: { BLUE: scenario.sides.BLUE.defaultRoe, RED: scenario.sides.RED.defaultRoe },
    ai: { BLUE: null, RED: null },
    triggers: scenario.triggers.map(
      (t): Trigger => ({ id: t.id, condition: toCondition(t.condition), actions: t.actions.map((a) => ({ ...a })), fired: false }),
    ),
    stats: { BLUE: emptyStats(), RED: emptyStats() },
    outcome: null,
    terrain: scenario.terrain.map((t) => ({ ...t, center: { ...t.center } })),
    services: {
      BLUE: { level: { network: 1, satcom: 1, nav: 1 }, disruptedUntil: { network: 0, satcom: 0, nav: 0 }, resilience: scenario.sides.BLUE.resilience },
      RED: { level: { network: 1, satcom: 1, nav: 1 }, disruptedUntil: { network: 0, satcom: 0, nav: 0 }, resilience: scenario.sides.RED.resilience },
    },
    effects: { BLUE: { ...scenario.sides.BLUE.effects }, RED: { ...scenario.sides.RED.effects } },
    satellites: scenario.satellites.map((p) => ({
      id: p.id,
      side: p.side,
      name: p.name,
      startS: Math.round(p.startMin * 60),
      endS: Math.round(p.endMin * 60),
      footprint: { center: { ...p.footprint.center }, radiusKm: p.footprint.radiusKm },
      phase: 'start' as const,
    })),
  };

  for (const g of scenario.groups) state.groups[g.id] = { ...g };
  for (const b of scenario.bases) {
    state.bases[b.id] = {
      id: b.id,
      side: b.side,
      name: b.name,
      pos: { ...b.pos },
      weaponStock: b.weaponStock,
      asmStock: b.asmStock,
      fuelStockKg: b.fuelStockKg,
      supplyStock: b.supplyStock,
      hostUnitId: b.hostUnitId ?? null,
      closed: false,
    };
  }


  for (const def of scenario.units) {
    const perf = (state.platforms[def.platformId] ??= toPerf(getPlatform(def.platformId)));
    const isAir = perf.domain === 'air';
    const isSof = perf.kind === 'sof';
    const ground = isGroundForce(perf.kind);
    const base = def.baseId ? state.bases[def.baseId] : undefined;
    const flying = isAir && def.airborne !== undefined;
    // Une équipe spéciale attend à sa base, comme un aéronef au sol.
    const pos = flying ? def.airborne!.pos : isAir || isSof ? base!.pos : def.pos!;
    const patrol = !isAir && def.patrol ? def.patrol.map((p) => ({ ...p })) : [];
    const loadout = perf.loadouts[0];
    const grounded = isAir && !flying && def.unavailableForMin !== undefined;
    const unit: Unit = {
      id: def.id,
      side: def.side,
      name: def.name,
      platformId: def.platformId,
      kind: perf.kind,
      domain: perf.domain,
      groupId: def.groupId,
      baseId: isAir || isSof ? (def.baseId ?? null) : null,
      pos: { lat: pos.lat, lon: pos.lon },
      altM: flying ? def.airborne!.altM : 0,
      headingDeg: 0,
      speedKmh: flying ? perf.cruiseKmh : 0,
      status: isAir ? (flying ? 'airborne' : grounded ? 'turnaround' : 'ready') : isSof ? 'ready' : 'active',
      damaged: false,
      fuelKg: isAir ? perf.fuelCapacityKg * (flying ? def.airborne!.fuelFraction : 1) : 0,
      weapons: loadout ? loadout.aam : perf.weaponCount,
      transferKg: perf.transferFuelKg,
      crew: def.crew,
      missionId: null,
      task: isAir ? (flying ? 'transit' : 'ground') : patrol.length > 0 ? 'move' : 'hold',
      wpIndex: 0,
      rtbReason: null,
      targetContactId: null,
      refuelFromId: null,
      route: patrol,
      routeLoop: patrol.length > 1,
      readyAt: grounded ? Math.round(def.unavailableForMin! * 60) : null,
      lastShotAt: -1e9,
      asm: loadout ? loadout.asm : 0,
      loadoutId: loadout ? loadout.id : '',
      slot: 0,
      availableAt: 0,
      suppressedUntil: 0,
      fault: grounded,
      land: ground
        ? {
            strength: def.strength ?? 1,
            morale: def.morale ?? 0.8,
            fatigue: 0,
            cohesion: 1,
            supply: def.supply ?? 1,
            posture: def.posture ?? 'hold',
            dugIn: 0,
            cargo: perf.cargo,
            inContact: false,
            broken: false,
            inCommand: true,
            pending: null,
            supplyPoint: perf.kind === 'logistics' ? { lat: pos.lat, lon: pos.lon } : null,
            casSince: -1,
          }
        : null,
      naval: isNaval(perf.kind)
        ? {
            hull: perf.hull,
            ssm: perf.ssmCount,
            torpedoes: perf.torpedoCount,
            leaderId: def.leaderId ?? null,
            lastSsmAt: -1e9,
            lastTorpedoAt: -1e9,
            lastAswAt: -1e9,
            datumUntil: 0,
            troops: [],
            landing: null,
          }
        : null,
      sof: isSof ? { phase: 'ready', target: null, arriveAt: 0, compromised: false } : null,
    };
    state.units[unit.id] = unit;
  }

  // Troupes embarquées : hors carte, à bord de leur bâtiment.
  for (const def of scenario.units) {
    if (def.embarkedIn === undefined) continue;
    const unit = state.units[def.id]!;
    const carrier = state.units[def.embarkedIn]!;
    unit.status = 'embarked';
    unit.pos = { lat: carrier.pos.lat, lon: carrier.pos.lon };
    carrier.naval!.troops.push(unit.id);
  }
  // Bases embarquées : elles suivent leur bâtiment.
  for (const b of Object.values(state.bases)) {
    const host = b.hostUnitId ? state.units[b.hostUnitId] : undefined;
    if (host) b.pos = { lat: host.pos.lat, lon: host.pos.lon };
  }

  for (const side of SIDES) {
    // À deux joueurs humains, aucun camp n'est confié à l'IA.
    if (side !== options.playerSide && !options.versus) {
      const def = scenario.sides[side];
      const forced = def.aiInitialPosture !== null ? { posture: def.aiInitialPosture, untilS: Math.round(def.aiPostureLockMin * 60) } : null;
      state.ai[side] = createAiMemory(side === o.defender ? 'defender' : 'challenger', options.difficulty, forced);
    }
  }

  for (const m of scenario.missions) {
    if (m.humanOnly && state.ai[m.side] !== null) continue;
    const result = applyOrder(state, {
      type: 'CREATE_MISSION',
      side: m.side,
      draft: {
        type: m.type,
        name: m.name,
        unitIds: m.unitIds,
        waypoints: m.waypoints,
        altM: m.altM,
        speed: m.speed,
        launchAt: Math.round(m.launchAtMin * 60),
        endAt: m.endAtMin !== undefined ? Math.round(m.endAtMin * 60) : null,
        roe: m.roe,
        allowRefuel: m.allowRefuel,
        targetContactId: null,
      },
    });
    if (!result.ok) throw new InitialMissionError(scenario.id, m.name ?? m.type, result.code);
  }

  // Renseignement initial : pistes anciennes, identifiées, sur des sites fixes ou des unités connues.
  for (const k of scenario.intel) {
    const target = state.units[k.unitId]!;
    const seq = (state.contactSeq[k.side] += 1);
    const id = `${target.side === 'RED' ? 'R' : 'B'}${String(seq).padStart(2, '0')}`;
    const seen = -Math.round(k.ageMin * 60);
    state.contacts[k.side][id] = {
      id,
      unitId: target.id,
      domain: target.domain,
      pos: { ...target.pos },
      altM: target.altM,
      headingDeg: 0,
      speedKmh: 0,
      firstSeen: seen,
      lastSeen: seen,
      idProgress: 1,
      identified: true,
      kind: target.kind,
      label: state.platforms[target.platformId]!.label,
      stale: true,
      hostileAct: false,
      damaged: false,
      radarSeenAt: -1e9,
      source: 'intel',
      fixed: target.kind === 'sam',
    };
  }

  for (const side of SIDES) {
    const text = scenario.sides[side].briefing;
    if (text) emit(state, 'TRIGGER_MESSAGE', [side], { text });
  }
  return state;
}
