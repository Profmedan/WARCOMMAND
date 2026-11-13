/**
 * Campagnes : une suite de missions dont l'issue décide de la suivante, et dont les pertes, les stocks et
 * l'expérience se reportent d'une mission à l'autre.
 *
 * Tout est fonction pure : une campagne est une donnée, l'état d'une campagne en est une autre, et chaque
 * opération rend un nouvel état. Le stockage (navigateur, fichier) est l'affaire de l'appelant.
 */
import { z } from 'zod';
import { cloneData, hashState, SIDES, type ControlLedger, type Difficulty, type Outcome, type SideId, type SimState } from '@warcommand/simulation-core';
import { createInitialState, type Scenario, type SetupOptions } from '@warcommand/scenario-system';
import { checkScenario, removeUnit } from '@warcommand/mission-editor';
import { getPlatform, hasPlatform } from '@warcommand/unit-database';

export type MissionWinner = SideId | 'DRAW';
export type MunitionId = 'aam' | 'asm';

/** Missiles air-air et munitions air-surface. */
export interface Munitions {
  aam: number;
  asm: number;
}

export interface CampaignMissionDef {
  id: string;
  scenarioId: string;
  title: string;
  /** Situation générale, lue avant la mission. */
  intro: string;
  /** Mission suivante selon le vainqueur ; `null` : la campagne s'achève. */
  next: Record<MissionWinner, string | null>;
}

/** Règles de report d'une mission à la suivante. Valeurs d'équilibrage, sans prétention de réalisme. */
export interface CarryRules {
  /** Part des aéronefs manquants remplacés entre deux missions, arrondie en faveur du camp. */
  replacementRate: number;
  /** Part maximale d'une dotation qu'un manque peut amputer. */
  maxShortfall: number;
  /** Réserve de théâtre au début de la campagne. */
  reserves: Record<SideId, Munitions>;
  /** Recomplètement de la réserve après chaque mission. */
  resupply: Record<SideId, Munitions>;
  /** Gain d'entraînement des équipages du vainqueur, et plafond du gain cumulé. */
  experienceGain: number;
  experienceMax: number;
}

export interface CampaignDef {
  id: string;
  title: string;
  description: string;
  first: string;
  missions: CampaignMissionDef[];
  carry: CarryRules;
}

export interface MissionRecord {
  missionId: string;
  scenarioId: string;
  seed: number;
  winner: MissionWinner;
  level: Outcome['level'];
  points: Record<SideId, number>;
  /** Aéronefs perdus, par matériel. */
  aircraftLost: Record<SideId, Record<string, number>>;
  /** Munitions tirées, ou perdues avec leur porteur. */
  expended: Record<SideId, Munitions>;
  controlSec: ControlLedger;
  elapsedSec: number;
  /** Empreinte de l'état final de la mission. */
  hash: string;
}

export interface CampaignState {
  format: 'warcommand-campaign';
  version: 1;
  /** Identifiant de l'emplacement de sauvegarde. */
  slotId: string;
  campaignId: string;
  playerSide: SideId;
  difficulty: Difficulty;
  seed: number;
  /** Mission à jouer ; `null` : campagne terminée. */
  current: string | null;
  history: MissionRecord[];
  /** Aéronefs manquants, par camp et par matériel : les pertes qui n'ont pas encore été remplacées. */
  shortfall: Record<SideId, Record<string, number>>;
  /** Réserve de munitions du théâtre. */
  reserves: Record<SideId, Munitions>;
  /** Gain d'entraînement acquis par les équipages de chaque camp. */
  experience: Record<SideId, number>;
  startedAt: string;
  updatedAt: string;
}

/** Ce que le report change à la mission, pour l'annoncer au joueur. */
export type CarryNote =
  | { kind: 'shortfall'; side: SideId; platformId: string; missing: number; planned: number }
  | { kind: 'stock'; side: SideId; munition: MunitionId; pct: number }
  | { kind: 'experience'; side: SideId; pct: number };

export interface PreparedMission {
  ok: true;
  mission: CampaignMissionDef;
  /** Le scénario de la mission, reports appliqués : c'est lui que le moteur joue. */
  scenario: Scenario;
  options: SetupOptions;
  notes: CarryNote[];
}

export type PrepareResult = PreparedMission | { ok: false; errors: string[] };
export type RecordResult = { ok: true; state: CampaignState } | { ok: false; error: string };

export const POINTS: Record<Outcome['level'], number> = { major: 3, minor: 2, draw: 1 };

/**
 * « Opération Vent du Nord » : les trois scénarios livrés, enchaînés. Situation entièrement fictive.
 * Si ROUGE gagne le premier acte, il exploite aussitôt : BLEU n'a pas sa contre-offensive.
 */
const VENT_DU_NORD: CampaignDef = {
  id: 'vent-du-nord',
  title: 'Opération Vent du Nord',
  description:
    'Trois actes en mer de Norvège puis dans l’est de l’Islande. Vos pertes, vos stocks de missiles et l’expérience de vos équipages vous suivent d’une mission à l’autre, et l’issue de chaque acte décide du suivant.',
  first: 'acte-1',
  missions: [
    {
      id: 'acte-1',
      scenarioId: 'bouclier-atlantique',
      title: 'Acte I — Bouclier Atlantique',
      intro: 'La coalition ROUGE conteste la police du ciel au-dessus de la mer de Norvège. Le camp qui sort vainqueur de ce premier accrochage prend l’initiative.',
      next: { BLUE: 'acte-2', DRAW: 'acte-2', RED: 'acte-3' },
    },
    {
      id: 'acte-2',
      scenarioId: 'breche-boreale',
      title: 'Acte II — Brèche Boréale',
      intro: 'BLEU porte le combat vers le secteur BRAVO, que ROUGE tient sous le couvert de ses défenses sol-air.',
      next: { BLUE: 'acte-3', DRAW: 'acte-3', RED: 'acte-3' },
    },
    {
      id: 'acte-3',
      scenarioId: 'tete-de-pont',
      title: 'Acte III — Tête de pont',
      intro: 'ROUGE débarque dans l’est de l’Islande et marche sur la localité CHARLIE, que BLEU tient avec un groupement retranché.',
      next: { BLUE: null, DRAW: null, RED: null },
    },
  ],
  carry: {
    replacementRate: 0.5,
    maxShortfall: 0.5,
    reserves: { BLUE: { aam: 60, asm: 30 }, RED: { aam: 60, asm: 30 } },
    resupply: { BLUE: { aam: 16, asm: 8 }, RED: { aam: 16, asm: 8 } },
    experienceGain: 0.05,
    experienceMax: 0.15,
  },
};

export const CAMPAIGNS: readonly CampaignDef[] = [VENT_DU_NORD];

export function getCampaign(id: string): CampaignDef | undefined {
  return CAMPAIGNS.find((c) => c.id === id);
}

export interface StartOptions {
  slotId: string;
  playerSide: SideId;
  difficulty: Difficulty;
  seed: number;
  /** Date-heure réelle, fournie par l'appelant (ISO 8601). */
  now: string;
}

export function startCampaign(def: CampaignDef, options: StartOptions): CampaignState {
  return {
    format: 'warcommand-campaign',
    version: 1,
    slotId: options.slotId,
    campaignId: def.id,
    playerSide: options.playerSide,
    difficulty: options.difficulty,
    seed: options.seed >>> 0,
    current: def.first,
    history: [],
    shortfall: { BLUE: {}, RED: {} },
    reserves: cloneData(def.carry.reserves),
    experience: { BLUE: 0, RED: 0 },
    startedAt: options.now,
    updatedAt: options.now,
  };
}

/** Graine de la mission à jouer : dérivée de la graine de la campagne et du rang de la mission. */
export function missionSeed(state: CampaignState): number {
  return (state.seed + Math.imul(state.history.length + 1, 0x9e3779b1)) >>> 0;
}

const isAircraft = (platformId: string): boolean => hasPlatform(platformId) && getPlatform(platformId).domain === 'air';
const STOCK_FIELD: Record<MunitionId, 'weaponStock' | 'asmStock'> = { aam: 'weaponStock', asm: 'asmStock' };
const MUNITIONS: readonly MunitionId[] = ['aam', 'asm'];

/**
 * Prépare la mission en cours : le scénario livré, auquel s'appliquent les reports de la campagne —
 * aéronefs manquants, stocks des bases limités par la réserve, équipages aguerris.
 */
export function prepareMission(def: CampaignDef, state: CampaignState, lookup: (scenarioId: string) => Scenario | undefined): PrepareResult {
  if (state.current === null) return { ok: false, errors: ['La campagne est terminée.'] };
  const mission = def.missions.find((m) => m.id === state.current);
  if (!mission) return { ok: false, errors: [`Mission inconnue dans cette campagne : ${state.current}.`] };
  const base = lookup(mission.scenarioId);
  if (!base) return { ok: false, errors: [`Scénario introuvable : ${mission.scenarioId}.`] };

  let scenario = cloneData(base);
  const notes: CarryNote[] = [];

  for (const side of SIDES) {
    for (const [platformId, missing] of Object.entries(state.shortfall[side])) {
      const planned = scenario.units.filter((u) => u.side === side && u.platformId === platformId);
      const remove = Math.min(missing, Math.floor(planned.length * def.carry.maxShortfall));
      let removed = 0;
      // Les derniers de la dotation restent au sol : ce sont eux qui manquent.
      for (const unit of planned.slice(planned.length - remove).reverse()) {
        const result = removeUnit(scenario, unit.id);
        if (!result.ok) continue;
        scenario = result.draft;
        removed += 1;
      }
      if (removed > 0) notes.push({ kind: 'shortfall', side, platformId, missing: removed, planned: planned.length });
    }

    for (const munition of MUNITIONS) {
      const field = STOCK_FIELD[munition];
      const bases = scenario.bases.filter((b) => b.side === side);
      const planned = bases.reduce((n, b) => n + b[field], 0);
      const reserve = state.reserves[side][munition];
      if (planned <= 0 || reserve >= planned) continue;
      const factor = reserve / planned;
      for (const b of bases) b[field] = Math.floor(b[field] * factor);
      notes.push({ kind: 'stock', side, munition, pct: Math.round(100 * factor) });
    }

    const gain = state.experience[side];
    if (gain > 0) {
      let upgraded = 0;
      for (const u of scenario.units) {
        if (u.side !== side || !isAircraft(u.platformId)) continue;
        u.crew = Math.min(1, u.crew + gain);
        upgraded += 1;
      }
      if (upgraded > 0) notes.push({ kind: 'experience', side, pct: Math.round(gain * 100) });
    }
  }

  // Le scénario modifié doit rester jouable : c'est le moteur qui en juge, comme pour un scénario d'auteur.
  const check = checkScenario(scenario);
  if (check.errors.length > 0) return { ok: false, errors: check.errors };

  return {
    ok: true,
    mission,
    scenario,
    options: { playerSide: state.playerSide, difficulty: state.difficulty, seed: missionSeed(state), wegoTurnMin: 0 },
    notes,
  };
}

/** Missiles et munitions d'un camp : stocks de ses bases et emports de ses aéronefs encore en état. */
function munitionsOf(s: SimState, side: SideId): Munitions {
  const total: Munitions = { aam: 0, asm: 0 };
  for (const b of Object.values(s.bases)) {
    if (b.side !== side) continue;
    total.aam += b.weaponStock;
    total.asm += b.asmStock;
  }
  for (const u of Object.values(s.units)) {
    if (u.side !== side || u.domain !== 'air' || u.status === 'destroyed') continue;
    total.aam += u.weapons;
    total.asm += u.asm;
  }
  return total;
}

/**
 * Consigne la mission qui vient de se terminer et fait avancer la campagne : points, pertes à reporter,
 * réserves, expérience, mission suivante. L'état reçu n'est pas modifié.
 */
export function recordMission(def: CampaignDef, state: CampaignState, prepared: PreparedMission, final: SimState, now: string): RecordResult {
  if (state.current === null) return { ok: false, error: 'La campagne est terminée.' };
  if (prepared.mission.id !== state.current) return { ok: false, error: 'Cette mission n’est pas la mission en cours de la campagne.' };
  if (final.scenarioId !== prepared.scenario.id) return { ok: false, error: 'L’état transmis n’est pas celui de la mission en cours.' };
  const outcome = final.outcome;
  if (!outcome) return { ok: false, error: 'La mission n’est pas terminée.' };

  const start = createInitialState(prepared.scenario, prepared.options);
  const next = cloneData(state);
  const record: MissionRecord = {
    missionId: prepared.mission.id,
    scenarioId: prepared.scenario.id,
    seed: prepared.options.seed,
    winner: outcome.winner,
    level: outcome.level,
    points: { BLUE: 0, RED: 0 },
    aircraftLost: { BLUE: {}, RED: {} },
    expended: { BLUE: { aam: 0, asm: 0 }, RED: { aam: 0, asm: 0 } },
    controlSec: { ...final.objective.sec },
    elapsedSec: final.time,
    hash: hashState(final),
  };

  if (outcome.winner === 'DRAW') record.points = { BLUE: POINTS.draw, RED: POINTS.draw };
  else record.points[outcome.winner] = POINTS[outcome.level];

  for (const u of Object.values(final.units)) {
    if (u.domain !== 'air' || u.status !== 'destroyed') continue;
    const lost = record.aircraftLost[u.side];
    lost[u.platformId] = (lost[u.platformId] ?? 0) + 1;
  }

  for (const side of SIDES) {
    const before = munitionsOf(start, side);
    const after = munitionsOf(final, side);
    for (const munition of MUNITIONS) {
      const expended = Math.max(0, before[munition] - after[munition]);
      record.expended[side][munition] = expended;
      next.reserves[side][munition] = Math.max(0, state.reserves[side][munition] - expended) + def.carry.resupply[side][munition];
    }

    const shortfall: Record<string, number> = {};
    for (const platformId of new Set([...Object.keys(state.shortfall[side]), ...Object.keys(record.aircraftLost[side])])) {
      const outstanding = (state.shortfall[side][platformId] ?? 0) + (record.aircraftLost[side][platformId] ?? 0);
      const left = outstanding - Math.ceil(outstanding * def.carry.replacementRate);
      if (left > 0) shortfall[platformId] = left;
    }
    next.shortfall[side] = shortfall;
  }

  if (outcome.winner !== 'DRAW') {
    next.experience[outcome.winner] = Math.min(def.carry.experienceMax, state.experience[outcome.winner] + def.carry.experienceGain);
  }

  next.history.push(record);
  next.current = prepared.mission.next[outcome.winner];
  next.updatedAt = now;
  return { ok: true, state: next };
}

export interface CampaignStanding {
  played: number;
  points: Record<SideId, number>;
  finished: boolean;
  /** Vainqueur de la campagne aux points ; `null` tant qu'elle n'est pas terminée. */
  verdict: MissionWinner | null;
}

export function campaignStanding(_def: CampaignDef, state: CampaignState): CampaignStanding {
  const points: Record<SideId, number> = { BLUE: 0, RED: 0 };
  for (const record of state.history) for (const side of SIDES) points[side] += record.points[side];
  const finished = state.current === null;
  const verdict: MissionWinner | null = !finished ? null : points.BLUE > points.RED ? 'BLUE' : points.RED > points.BLUE ? 'RED' : 'DRAW';
  return { played: state.history.length, points, finished, verdict };
}

/* ------------------------------------------------------------------ Persistance */

const bySide = <T extends z.ZodType>(value: T) => z.object({ BLUE: value, RED: value });
const count = z.number().int().min(0);
const munitionsSchema = z.object({ aam: z.number().min(0), asm: z.number().min(0) });

const recordSchema = z.object({
  missionId: z.string().min(1),
  scenarioId: z.string().min(1),
  seed: count,
  winner: z.enum(['BLUE', 'RED', 'DRAW']),
  level: z.enum(['major', 'minor', 'draw']),
  points: bySide(count),
  aircraftLost: bySide(z.record(z.string(), count)),
  expended: bySide(munitionsSchema),
  controlSec: z.object({ BLUE: z.number().min(0), RED: z.number().min(0), CONTESTED: z.number().min(0) }),
  elapsedSec: z.number().min(0),
  hash: z.string(),
});

const stateSchema = z.object({
  format: z.literal('warcommand-campaign'),
  version: z.literal(1),
  slotId: z.string().min(1),
  campaignId: z.string().min(1),
  playerSide: z.enum(['BLUE', 'RED']),
  difficulty: z.enum(['recrue', 'standard', 'veteran']),
  seed: count.max(0xffffffff),
  current: z.string().min(1).nullable(),
  history: z.array(recordSchema),
  shortfall: bySide(z.record(z.string(), count)),
  reserves: bySide(munitionsSchema),
  experience: bySide(z.number().min(0).max(1)),
  startedAt: z.string(),
  updatedAt: z.string(),
});

export type CampaignParseResult = { ok: true; state: CampaignState } | { ok: false; errors: string[] };

/** Relit un état de campagne (objet issu d'un JSON) : forme, version, campagne et mission en cours connues. */
export function parseCampaignState(data: unknown): CampaignParseResult {
  const fail = (...errors: string[]): CampaignParseResult => ({ ok: false, errors });
  if (typeof data !== 'object' || data === null) return fail('Campagne illisible');
  const head = data as { format?: unknown; version?: unknown };
  if (head.format !== 'warcommand-campaign') return fail('Ce fichier n’est pas une campagne WAR COMMAND');
  if (head.version !== 1) return fail(`Version de campagne non prise en charge : ${String(head.version)}`);
  const parsed = stateSchema.safeParse(data);
  if (!parsed.success) return fail(...parsed.error.issues.map((issue) => `${issue.path.join('.') || 'campagne'} : ${issue.message}`));
  const def = getCampaign(parsed.data.campaignId);
  if (!def) return fail(`Campagne inconnue : ${parsed.data.campaignId}`);
  if (parsed.data.current !== null && !def.missions.some((m) => m.id === parsed.data.current)) {
    return fail(`Mission inconnue dans cette campagne : ${parsed.data.current}`);
  }
  return { ok: true, state: parsed.data };
}
