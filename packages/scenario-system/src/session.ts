/**
 * Session de jeu : un scénario, des options, un état, et la liste horodatée des ordres du joueur.
 * Cette liste, avec la graine, suffit à rejouer la partie à l'identique.
 */
import {
  cloneData,
  emit,
  getSidePicture,
  rand,
  SIDES,
  stepState,
  type Difficulty,
  type SideId,
  type SimState,
  type System,
} from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, validateOrder } from '@warcommand/air-operations';
import { applyLandOrder, landSystem, validateLandOrder } from '@warcommand/land-operations';
import { applyNavalOrder, navalSystem, validateNavalOrder } from '@warcommand/naval-operations';
import { applyEffectOrder, effectsSystem, validateEffectOrder } from '@warcommand/multi-domain-effects';
import { aiDecide, type CommanderOrder } from '@warcommand/ai-commander';
import { objectiveSystem, triggerSystem } from './objectives';
import { createInitialState, type SetupOptions } from './setup';
import type { Scenario } from './schema';

/** Ordre de jeu : aérien, terrestre, naval ou multi-domaines. */
export type GameOrder = CommanderOrder;
/** Résultat d'un ordre de jeu ; `code` est le motif du refus, propre à chaque composante. */
export type GameOrderResult = { ok: true; missionId?: string } | { ok: false; code: string; unitId?: string };

/** Vérifie un ordre de jeu sans rien modifier, en le confiant à la composante qui en a la charge. */
export function validateGameOrder(s: SimState, order: GameOrder): GameOrderResult {
  switch (order.type) {
    case 'LAND_ORDER':
      return validateLandOrder(s, order);
    case 'LAND_TROOPS':
      return validateNavalOrder(s, order);
    case 'USE_EFFECT':
    case 'SOF_INSERT':
    case 'SOF_EXTRACT':
      return validateEffectOrder(s, order);
    default:
      return validateOrder(s, order);
  }
}

/** Applique un ordre de jeu : la seule porte d'entrée du joueur comme de l'IA. */
export function applyGameOrder(s: SimState, order: GameOrder): GameOrderResult {
  switch (order.type) {
    case 'LAND_ORDER':
      return applyLandOrder(s, order);
    case 'LAND_TROOPS':
      return applyNavalOrder(s, order);
    case 'USE_EFFECT':
    case 'SOF_INSERT':
    case 'SOF_EXTRACT':
      return applyEffectOrder(s, order);
    default:
      return applyOrder(s, order);
  }
}

export interface TimedOrder {
  t: number;
  order: GameOrder;
}

export interface Session {
  scenario: Scenario;
  options: SetupOptions;
  state: SimState;
  /** Ordres acceptés du joueur humain, dans l'ordre d'émission. */
  orders: TimedOrder[];
}

/**
 * L'IA de chaque camp qui lui est confié s'éveille périodiquement, reçoit une copie de l'image
 * de son camp et soumet ses ordres à `applyOrder`, comme le joueur.
 */
export const aiSystem: System = (s) => {
  for (const side of SIDES) {
    const mem = s.ai[side];
    if (!mem || s.time < mem.nextWakeAt) continue;
    // En mode par tours, l'IA ne décide — comme le joueur — qu'à la fin d'un tour.
    if (s.wegoTurnS > 0 && s.time % s.wegoTurnS !== 0) continue;
    mem.nextWakeAt = s.time + s.rules.aiWakeS;

    const picture = cloneData(getSidePicture(s, side));
    const logged = mem.log.length;
    const orders = aiDecide(picture, mem, () => rand(s.rng, `ai:${side}`));
    for (const order of orders) {
      if (order.side !== side) continue;
      const result = applyGameOrder(s, order);
      if (!result.ok) {
        mem.log.push({ t: s.time, level: 'operative', code: 'ORDER_REJECTED', p: { order: order.type, reason: result.code }, utilities: {} });
      }
    }
    for (let i = Math.min(logged, mem.log.length); i < mem.log.length; i++) {
      const d = mem.log[i]!;
      emit(s, 'AI_DECISION', [], { side, level: d.level, code: d.code, ...d.p });
    }
  }
};

/**
 * Ordre d'application des systèmes à chaque pas : opérations aériennes (missions, tactique, mouvement,
 * capteurs, engagement), terrestres, navales, effets multi-domaines, puis objectif, déclencheurs et IA.
 */
export const SYSTEMS: readonly System[] = [...AIR_SYSTEMS, landSystem, navalSystem, effectsSystem, objectiveSystem, triggerSystem, aiSystem];

export const DEFAULT_DIFFICULTY: Difficulty = 'standard';

export function createSession(scenario: Scenario, options: Partial<SetupOptions> = {}): Session {
  const full: SetupOptions = {
    playerSide: options.playerSide === undefined ? 'BLUE' : options.playerSide,
    difficulty: options.difficulty ?? scenario.difficulty,
    seed: options.seed ?? scenario.seed,
    wegoTurnMin: options.wegoTurnMin ?? 0,
    ...(options.versus ? { versus: true } : {}),
  };
  return { scenario, options: full, state: createInitialState(scenario, full), orders: [] };
}

/** Avance la session de `steps` pas (1 s de simulation chacun). */
export function stepSession(session: Session, steps = 1): void {
  for (let i = 0; i < steps && !session.state.outcome; i++) stepState(session.state, SYSTEMS);
}

/** Avance la session jusqu'à la fin de la mission. */
export function runToEnd(session: Session): void {
  while (!session.state.outcome) stepState(session.state, SYSTEMS);
}

/**
 * Ordre d'un joueur humain. Refusé s'il vise un camp qui n'est pas tenu par un humain :
 * un camp confié à l'IA ne reçoit d'ordres que de l'IA. À deux joueurs, les deux camps en reçoivent ;
 * c'est à l'hôte de la partie de vérifier que chacun ne commande que le sien.
 */
export function issueOrder(session: Session, order: GameOrder): GameOrderResult {
  if (!session.options.versus && order.side !== session.options.playerSide) return { ok: false, code: 'WRONG_SIDE' };
  const turn = session.state.wegoTurnS;
  if (turn > 0 && session.state.time % turn !== 0) return { ok: false, code: 'NOT_PLANNING_PHASE' };
  const result = applyGameOrder(session.state, order);
  if (result.ok) session.orders.push({ t: session.state.time, order: cloneData(order) });
  return result;
}

export function isAiSide(session: Session, side: SideId): boolean {
  return session.state.ai[side] !== null;
}
