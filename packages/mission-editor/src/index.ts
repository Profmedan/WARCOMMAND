/**
 * Éditeur de missions — logique d'édition, sans interface.
 *
 * Un brouillon est un scénario au format versionné du jeu. Chaque opération est une fonction
 * pure : elle retourne un nouveau brouillon (ou un refus motivé, en français) et ne modifie
 * jamais celui qu'elle reçoit. L'interface n'a plus qu'à appeler ces opérations et à afficher
 * le résultat de `checkScenario`.
 */
import {
  checkInvariants,
  cloneData,
  distanceKm,
  hashState,
  inCircle,
  opponent,
  SIDES,
  snapshotPositions,
  UNIT_KINDS,
  type Circle,
  type LatLon,
  type MissionType,
  type SideId,
  type UnitKind,
} from '@warcommand/simulation-core';
import { getPlatform, hasPlatform, toPerf, type PlatformRecord } from '@warcommand/unit-database';
import { MISSION_KIND, missionWithinRange, type RejectCode } from '@warcommand/air-operations';
import { DEFAULT_RULES } from '@warcommand/simulation-core';
import { createInitialState, createSession, InitialMissionError, parseScenario, ScenarioSchema, stepSession, type ParseResult, type Scenario } from '@warcommand/scenario-system';

export type EditResult = { ok: true; draft: Scenario; id?: string } | { ok: false; error: string };

type UnitDef = Scenario['units'][number];
type MissionDef = Scenario['missions'][number];
type TriggerDef = Scenario['triggers'][number];
type BaseDef = Scenario['bases'][number];

const fail = (error: string): EditResult => ({ ok: false, error });
const done = (draft: Scenario, id?: string): EditResult => ({ ok: true, draft, id });

export const SIDE_NAME: Record<SideId, string> = { BLUE: 'BLEU', RED: 'ROUGE' };
const SIDE_ADJECTIVE: Record<SideId, string> = { BLUE: 'bleue', RED: 'rouge' };

/** Altitude initiale habituelle d'un aéronef placé en vol, et de ses missions. */
export const DEFAULT_ALTITUDE_M: Record<UnitKind, number> = {
  ...(Object.fromEntries(UNIT_KINDS.map((kind) => [kind, 0])) as Record<UnitKind, number>),
  fighter: 9000,
  aew: 8800,
  tanker: 8000,
  drone: 7500,
};

export const INITIAL_MISSION_TYPES = ['CAP', 'SWEEP', 'AEW', 'TANKER', 'RECON'] as const;
export type InitialMissionType = (typeof INITIAL_MISSION_TYPES)[number];

const LAND_GROUP = { slug: 'terre', name: 'Groupement terrestre' };
const NAVAL_GROUP = { slug: 'naval', name: 'Groupe naval' };
const GROUP_FOR_KIND: Record<UnitKind, { slug: string; name: string }> = {
  fighter: { slug: 'chasse', name: 'Chasse' },
  aew: { slug: 'soutien', name: 'Soutien aérien' },
  tanker: { slug: 'soutien', name: 'Soutien aérien' },
  drone: { slug: 'soutien', name: 'Soutien aérien' },
  sam: { slug: 'sol-air', name: 'Défense sol-air' },
  ship: NAVAL_GROUP,
  carrier: NAVAL_GROUP,
  sub: NAVAL_GROUP,
  amphib: NAVAL_GROUP,
  supply: NAVAL_GROUP,
  infantry: LAND_GROUP,
  mech: LAND_GROUP,
  armor: LAND_GROUP,
  artillery: LAND_GROUP,
  engineer: LAND_GROUP,
  recon: LAND_GROUP,
  logistics: LAND_GROUP,
  hq: LAND_GROUP,
  sof: { slug: 'speciales', name: 'Forces spéciales' },
};

const REJECT_FR: Partial<Record<RejectCode, string>> = {
  OUT_OF_RANGE: 'hors rayon d’action de ses appareils',
  BAD_ALTITUDE: 'altitude hors du domaine de vol de ses appareils',
  OUT_OF_THEATER: 'un point est hors de la région du scénario',
  BAD_TIME: 'horaire incohérent',
  UNIT_UNAVAILABLE: 'un appareil est indisponible à l’heure de départ',
  WRONG_KIND: 'un appareil ne peut pas effectuer ce type de mission',
  NO_WAYPOINT: 'aucun point de station',
  TOO_MANY_WAYPOINTS: 'plus de huit points',
};

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'scenario';
}

/** Plus petit entier ≥ 1 pour lequel `make(n)` n'est pas déjà pris. */
function firstFree(taken: ReadonlySet<string>, make: (n: number) => string): string {
  for (let n = 1; ; n++) {
    const candidate = make(n);
    if (!taken.has(candidate)) return candidate;
  }
}

const isPos = (p: LatLon | undefined | null): p is LatLon =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/* ------------------------------------------------------------------ Création */

export interface BlankOptions {
  title: string;
  seed: number;
  /** Centre de la région ; par défaut la mer de Norvège, comme les scénarios livrés. */
  center?: LatLon;
}

export function createBlankScenario(options: BlankOptions): Scenario {
  const center = options.center ?? { lat: 67.0, lon: -11.0 };
  const bounds = options.center
    ? {
        west: Math.max(-180, center.lon - 18),
        east: Math.min(180, center.lon + 18),
        south: Math.max(-85, center.lat - 7),
        north: Math.min(85, center.lat + 7),
      }
    : { west: -26, south: 61, east: 4, north: 74 };
  const side = (name: string, doctrineId: string): Scenario['sides']['BLUE'] => ({
    name,
    description: '',
    doctrineId,
    doctrineOverrides: {},
    defaultRoe: 'defensive',
    briefing: '',
    aiInitialPosture: null,
    aiPostureLockMin: 0,
    resilience: 0.5,
    effects: { cyber: 0, jam: 0 },
  });
  return {
    formatVersion: 1,
    id: slugify(options.title),
    title: options.title,
    description: 'Scénario personnel. Situation, bases et unités fictives.',
    region: { name: 'Région du scénario', bounds, center: { ...center }, zoom: 4.6 },
    date: '2031-03-14T08:40:00Z',
    period: 'Contemporaine, situation fictive',
    durationMin: 90,
    weather: { label: 'Ciel dégagé, bonne visibilité', sensorFactor: 1 },
    seed: options.seed,
    sides: { BLUE: side('Coalition BLEUE', 'coalition-occidentale'), RED: side('Coalition ROUGE', 'rouge-centralisee') },
    groups: [
      { id: 'blue-chasse', side: 'BLUE', name: 'Chasse' },
      { id: 'red-chasse', side: 'RED', name: 'Chasse' },
    ],
    bases: [],
    units: [],
    missions: [],
    intel: [],
    objective: {
      type: 'SECTOR_CONTROL',
      kind: 'air',
      id: 'objectif',
      name: 'Secteur ALPHA',
      center: { ...center },
      radiusKm: 100,
      defender: 'BLUE',
      defenderWinsAtMin: 60,
      challengerWinsBelowMin: 45,
    },
    navalZones: { BLUE: null, RED: null },
    terrain: [],
    satellites: [],
    triggers: [],
    difficulty: 'standard',
    rules: {},
    sources: [{ title: 'Situation, bases, unités et événements', note: 'Entièrement fictifs' }],
  };
}

/** Identifiant libre : `base`, ou `base-2`, `base-3`… s'il est déjà pris. */
export function uniqueScenarioId(base: string, existingIds: Iterable<string>): string {
  return firstFree(new Set(existingIds), (n) => (n === 1 ? base : `${base}-${n}`));
}

/**
 * Relit un brouillon enregistré par l'éditeur. Un brouillon peut être incomplet — sans unité ou
 * sans groupe — mais doit avoir, pour tout le reste, la forme exacte d'un scénario.
 */
export function readDraft(data: unknown): Scenario | null {
  const parsed = ScenarioSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  const onlyEmptyLists = parsed.error.issues.every((issue) => issue.path.length === 1 && (issue.path[0] === 'units' || issue.path[0] === 'groups'));
  if (!onlyEmptyLists || typeof data !== 'object' || data === null) return null;
  // Tout est en forme, hormis une liste encore vide : on revalide avec un contenu provisoire pour
  // obtenir les valeurs par défaut, puis on rend au brouillon ses listes vides.
  const record = data as { units: unknown; groups: unknown };
  const filler = createBlankScenario({ title: 'x', seed: 0 });
  const padded = ScenarioSchema.safeParse({
    ...record,
    units: Array.isArray(record.units) && record.units.length === 0 ? [{ id: 'x', side: 'BLUE', name: 'x', platformId: 'x', groupId: 'x' }] : record.units,
    groups: Array.isArray(record.groups) && record.groups.length === 0 ? filler.groups : record.groups,
  });
  if (!padded.success) return null;
  return {
    ...padded.data,
    units: Array.isArray(record.units) && record.units.length === 0 ? [] : padded.data.units,
    groups: Array.isArray(record.groups) && record.groups.length === 0 ? [] : padded.data.groups,
  };
}

/** Copie indépendante, sous un identifiant et un titre nouveaux. */
export function duplicateScenario(scenario: Scenario, existingIds: Iterable<string>): Scenario {
  const taken = new Set(existingIds);
  const copy = cloneData(scenario);
  copy.id = firstFree(taken, (n) => (n === 1 ? `${scenario.id}-copie` : `${scenario.id}-copie-${n}`));
  copy.title = `${scenario.title} (copie)`;
  return copy;
}

/* ------------------------------------------------------------------ Réglages généraux */

export interface MetaPatch {
  title?: string;
  description?: string;
  /** Date-heure de début, ISO 8601 en UTC. */
  date?: string;
  period?: string;
  durationMin?: number;
  weatherLabel?: string;
  sensorFactor?: number;
  seed?: number;
  difficulty?: Scenario['difficulty'];
  regionName?: string;
}

/** Réglages généraux. L'identifiant du scénario ne change pas quand on le renomme. */
export function setMeta(d: Scenario, patch: MetaPatch): EditResult {
  const text = (value: string | undefined, what: string): string | null => (value !== undefined && value.trim() === '' ? `${what} ne peut pas être vide.` : null);
  const empty =
    text(patch.title, 'Le titre') ?? text(patch.description, 'La description') ?? text(patch.period, 'La période') ?? text(patch.weatherLabel, 'La météo') ?? text(patch.regionName, 'Le nom de la région');
  if (empty) return fail(empty);
  if (patch.date !== undefined && Number.isNaN(Date.parse(patch.date))) return fail('Date et heure de début invalides.');
  if (patch.durationMin !== undefined) {
    if (!(patch.durationMin > 0 && patch.durationMin <= 24 * 60)) return fail('La durée doit être comprise entre 1 minute et 24 heures.');
    if (patch.durationMin < d.objective.defenderWinsAtMin) return fail('La durée ne peut pas être inférieure au seuil de victoire du défenseur.');
  }
  if (patch.sensorFactor !== undefined && !(patch.sensorFactor >= 0.3 && patch.sensorFactor <= 1.2)) {
    return fail('Le facteur météo des capteurs doit être compris entre 0,3 et 1,2.');
  }
  if (patch.seed !== undefined && !(Number.isInteger(patch.seed) && patch.seed >= 0 && patch.seed <= 0xffffffff)) {
    return fail('La graine doit être un entier positif.');
  }
  const next = cloneData(d);
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.date !== undefined) next.date = patch.date;
  if (patch.period !== undefined) next.period = patch.period;
  if (patch.durationMin !== undefined) next.durationMin = patch.durationMin;
  if (patch.weatherLabel !== undefined) next.weather.label = patch.weatherLabel;
  if (patch.sensorFactor !== undefined) next.weather.sensorFactor = patch.sensorFactor;
  if (patch.seed !== undefined) next.seed = patch.seed;
  if (patch.difficulty !== undefined) next.difficulty = patch.difficulty;
  if (patch.regionName !== undefined) next.region.name = patch.regionName;
  return done(next);
}

export interface RegionInput {
  bounds: Scenario['region']['bounds'];
  center: LatLon;
  zoom: number;
}

/** Recadre la région du scénario. Tout ce qui est déjà posé doit y tenir. */
export function setRegion(d: Scenario, region: RegionInput): EditResult {
  const b = region.bounds;
  if (!(b.west < b.east) || !(b.south < b.north)) return fail('Emprise invalide.');
  const inside = (p: LatLon) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
  if (!inside(region.center)) return fail('Le centre doit se trouver dans l’emprise.');
  const left: string[] = [];
  for (const base of d.bases) if (!inside(base.pos)) left.push(base.name);
  for (const u of d.units) {
    const pos = u.airborne?.pos ?? u.pos;
    if (pos && !inside(pos)) left.push(u.name);
  }
  if (!inside(d.objective.center)) left.push(d.objective.name);
  if (left.length > 0) return fail(`Cette région laisserait dehors : ${left.slice(0, 4).join(', ')}${left.length > 4 ? '…' : ''}.`);
  const next = cloneData(d);
  next.region = { name: next.region.name, bounds: { ...b }, center: { ...region.center }, zoom: Math.max(0, Math.min(18, region.zoom)) };
  return done(next);
}

export type SidePatch = Partial<Pick<Scenario['sides']['BLUE'], 'name' | 'description' | 'doctrineId' | 'doctrineOverrides' | 'defaultRoe' | 'briefing' | 'aiInitialPosture' | 'aiPostureLockMin'>>;

/** Réglages d'une coalition : identité, doctrine, règles d'engagement, briefing, comportement initial de l'IA. */
export function setSide(d: Scenario, side: SideId, patch: SidePatch): EditResult {
  if (patch.name !== undefined && patch.name.trim() === '') return fail('Le nom de la coalition ne peut pas être vide.');
  if (patch.aiPostureLockMin !== undefined && !(patch.aiPostureLockMin >= 0 && patch.aiPostureLockMin <= 600)) {
    return fail('La durée de maintien de la posture est comprise entre 0 et 600 minutes.');
  }
  for (const value of Object.values(patch.doctrineOverrides ?? {})) {
    if (value !== undefined && !(value >= 0 && value <= 1)) return fail('Un réglage de doctrine est compris entre 0 et 100 %.');
  }
  const next = cloneData(d);
  next.sides[side] = { ...next.sides[side], ...cloneData(patch) };
  // Sans posture imposée, la durée de maintien n'a plus d'objet.
  if (next.sides[side].aiInitialPosture === null) next.sides[side].aiPostureLockMin = 0;
  return done(next);
}

/* ------------------------------------------------------------------ Bases et groupes */

export function addBase(d: Scenario, input: { side: SideId; pos: LatLon; name?: string }): EditResult {
  if (!isPos(input.pos)) return fail('Position invalide.');
  const next = cloneData(d);
  const prefix = `${input.side.toLowerCase()}-base-`;
  const id = firstFree(new Set(next.bases.map((b) => b.id)), (n) => `${prefix}${n}`);
  const names = new Set(next.bases.map((b) => b.name));
  const name = input.name?.trim() || firstFree(names, (n) => `Base ${SIDE_ADJECTIVE[input.side]} ${n}`);
  next.bases.push({ id, side: input.side, name, pos: { ...input.pos }, weaponStock: 24, asmStock: 0, fuelStockKg: 250000, supplyStock: 0 });
  return done(next, id);
}

export type BasePatch = Partial<Pick<BaseDef, 'name' | 'pos' | 'weaponStock' | 'asmStock' | 'fuelStockKg'>>;

export function updateBase(d: Scenario, id: string, patch: BasePatch): EditResult {
  const next = cloneData(d);
  const base = next.bases.find((b) => b.id === id);
  if (!base) return fail('Base inconnue.');
  if (patch.name !== undefined) {
    if (patch.name.trim() === '') return fail('Le nom de la base ne peut pas être vide.');
    base.name = patch.name;
  }
  if (patch.pos !== undefined) {
    if (!isPos(patch.pos)) return fail('Position invalide.');
    base.pos = { ...patch.pos };
  }
  for (const key of ['weaponStock', 'asmStock'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) return fail('Un stock de munitions est un entier positif ou nul.');
    base[key] = value;
  }
  if (patch.fuelStockKg !== undefined) {
    if (!(patch.fuelStockKg >= 0)) return fail('Le stock de carburant ne peut pas être négatif.');
    base.fuelStockKg = patch.fuelStockKg;
  }
  return done(next, id);
}

export function removeBase(d: Scenario, id: string): EditResult {
  const base = d.bases.find((b) => b.id === id);
  if (!base) return fail('Base inconnue.');
  const n = d.units.filter((u) => u.baseId === id).length;
  if (n > 0) {
    return fail(`Impossible de supprimer ${base.name} : ${n} aéronef${n > 1 ? 's y sont rattachés' : ' y est rattaché'}.`);
  }
  const next = cloneData(d);
  next.bases = next.bases.filter((b) => b.id !== id);
  return done(next);
}

export function addGroup(d: Scenario, input: { side: SideId; name?: string }): EditResult {
  const next = cloneData(d);
  const prefix = `${input.side.toLowerCase()}-groupe-`;
  const id = firstFree(new Set(next.groups.map((g) => g.id)), (n) => `${prefix}${n}`);
  const names = new Set(next.groups.filter((g) => g.side === input.side).map((g) => g.name));
  next.groups.push({ id, side: input.side, name: input.name?.trim() || firstFree(names, (n) => `Groupe ${n}`) });
  return done(next, id);
}

export function renameGroup(d: Scenario, id: string, name: string): EditResult {
  if (name.trim() === '') return fail('Le nom du groupe ne peut pas être vide.');
  const next = cloneData(d);
  const group = next.groups.find((g) => g.id === id);
  if (!group) return fail('Groupe inconnu.');
  group.name = name.trim();
  return done(next, id);
}

export function removeGroup(d: Scenario, id: string): EditResult {
  const group = d.groups.find((g) => g.id === id);
  if (!group) return fail('Groupe inconnu.');
  const n = d.units.filter((u) => u.groupId === id).length;
  if (n > 0) return fail(`Impossible de supprimer ${group.name} : ${n} unité${n > 1 ? 's en font partie' : ' en fait partie'}.`);
  const next = cloneData(d);
  next.groups = next.groups.filter((g) => g.id !== id);
  next.triggers = next.triggers.filter((t) => !(t.condition.type === 'GROUP_UNAVAILABLE' && t.condition.groupId === id));
  return done(next);
}

/* ------------------------------------------------------------------ Unités */

function shortName(record: PlatformRecord): string {
  if (!record.generic) return record.name;
  return record.kind === 'ship' ? 'Frégate' : 'Sol-air';
}

export interface AddUnitInput {
  side: SideId;
  platformId: string;
  /** Où poser l'unité ; pour un aéronef au sol, sert à choisir la base amie la plus proche. */
  pos: LatLon;
  groupId?: string;
  baseId?: string;
  /** Aéronef déjà en vol au début du scénario, à la position indiquée. */
  airborne?: boolean;
}

export function addUnit(d: Scenario, input: AddUnitInput): EditResult {
  if (!hasPlatform(input.platformId)) return fail(`Matériel inconnu : ${input.platformId}.`);
  if (!isPos(input.pos)) return fail('Position invalide.');
  const record = getPlatform(input.platformId);
  const perf = toPerf(record);
  const next = cloneData(d);
  const isAir = record.domain === 'air';

  let baseId: string | undefined;
  if (isAir) {
    const own = next.bases.filter((b) => b.side === input.side);
    if (input.baseId !== undefined) {
      if (!own.some((b) => b.id === input.baseId)) return fail('Cette base n’appartient pas à ce camp.');
      baseId = input.baseId;
    } else {
      if (own.length === 0) return fail('Ajoutez d’abord une base pour ce camp : un aéronef doit être rattaché à une base.');
      baseId = own.reduce((best, b) => (distanceKm(b.pos, input.pos) < distanceKm(best.pos, input.pos) ? b : best)).id;
    }
  }

  let groupId = input.groupId;
  if (groupId !== undefined) {
    if (!next.groups.some((g) => g.id === groupId && g.side === input.side)) return fail('Ce groupe n’appartient pas à ce camp.');
  } else {
    const kindGroup = GROUP_FOR_KIND[record.kind];
    groupId = `${input.side.toLowerCase()}-${kindGroup.slug}`;
    if (!next.groups.some((g) => g.id === groupId)) next.groups.push({ id: groupId, side: input.side, name: kindGroup.name });
  }

  const id = firstFree(new Set(next.units.map((u) => u.id)), (n) => `${input.side.toLowerCase()}-${record.id}-${n}`);
  const names = new Set(next.units.filter((u) => u.side === input.side).map((u) => u.name));
  const unit: UnitDef = {
    id,
    side: input.side,
    name: firstFree(names, (n) => `${shortName(record)} ${n}`),
    platformId: record.id,
    groupId,
    crew: 0.7,
  };
  if (isAir) {
    unit.baseId = baseId;
    if (input.airborne) {
      unit.airborne = { pos: { ...input.pos }, altM: Math.min(DEFAULT_ALTITUDE_M[record.kind], perf.ceilingM), fuelFraction: 0.9 };
    }
  } else {
    unit.pos = { ...input.pos };
  }
  next.units.push(unit);
  return done(next, id);
}

export function moveUnit(d: Scenario, id: string, pos: LatLon): EditResult {
  if (!isPos(pos)) return fail('Position invalide.');
  const next = cloneData(d);
  const unit = next.units.find((u) => u.id === id);
  if (!unit) return fail('Unité inconnue.');
  if (getPlatform(unit.platformId).domain === 'air') {
    if (!unit.airborne) return fail('Un aéronef au sol se trouve à sa base : déplacez la base, ou mettez l’appareil en vol.');
    unit.airborne.pos = { ...pos };
  } else {
    unit.pos = { ...pos };
  }
  return done(next, id);
}

export interface UnitPatch {
  name?: string;
  crew?: number;
  groupId?: string;
  baseId?: string;
  /** `null` : au sol, à sa base. Sinon en vol ; les champs absents gardent leur valeur ou prennent la valeur habituelle. */
  airborne?: { pos?: LatLon; altM?: number; fuelFraction?: number } | null;
  /** Minutes d'indisponibilité au départ ; `null` : disponible. */
  unavailableForMin?: number | null;
  /** Itinéraire de patrouille d'un bâtiment ; `null` : immobile. */
  patrol?: LatLon[] | null;
}

export function updateUnit(d: Scenario, id: string, patch: UnitPatch): EditResult {
  const next = cloneData(d);
  const unit = next.units.find((u) => u.id === id);
  if (!unit) return fail('Unité inconnue.');
  const record = getPlatform(unit.platformId);
  const perf = toPerf(record);
  const isAir = record.domain === 'air';

  if (patch.name !== undefined) {
    if (patch.name.trim() === '') return fail('Le nom de l’unité ne peut pas être vide.');
    unit.name = patch.name;
  }
  if (patch.crew !== undefined) {
    if (!(patch.crew >= 0 && patch.crew <= 1)) return fail('Le niveau d’entraînement est compris entre 0 et 100 %.');
    unit.crew = patch.crew;
  }
  if (patch.groupId !== undefined) {
    if (!next.groups.some((g) => g.id === patch.groupId && g.side === unit.side)) return fail('Ce groupe n’appartient pas au camp de l’unité.');
    unit.groupId = patch.groupId;
  }
  if (patch.baseId !== undefined) {
    if (!isAir) return fail('Seul un aéronef est rattaché à une base.');
    if (!next.bases.some((b) => b.id === patch.baseId && b.side === unit.side)) return fail('Cette base n’appartient pas au camp de l’unité.');
    unit.baseId = patch.baseId;
  }
  if (patch.airborne !== undefined) {
    if (!isAir) return fail('Seul un aéronef peut être en vol.');
    if (patch.airborne === null) {
      delete unit.airborne;
    } else {
      const base = next.bases.find((b) => b.id === unit.baseId);
      const pos = patch.airborne.pos ?? unit.airborne?.pos ?? base?.pos;
      if (!isPos(pos)) return fail('Position de vol invalide.');
      const altM = patch.airborne.altM ?? unit.airborne?.altM ?? Math.min(DEFAULT_ALTITUDE_M[record.kind], perf.ceilingM);
      if (!(altM > 0 && altM <= perf.ceilingM)) return fail(`Altitude hors du domaine de vol (plafond ${perf.ceilingM.toLocaleString('fr-FR')} m).`);
      const fuelFraction = patch.airborne.fuelFraction ?? unit.airborne?.fuelFraction ?? 0.9;
      if (!(fuelFraction >= 0.05 && fuelFraction <= 1)) return fail('Le carburant initial est compris entre 5 et 100 %.');
      unit.airborne = { pos: { ...pos }, altM, fuelFraction };
      delete unit.unavailableForMin;
    }
  }
  if (patch.unavailableForMin !== undefined) {
    if (patch.unavailableForMin === null) {
      delete unit.unavailableForMin;
    } else {
      if (!isAir) return fail('Seul un aéronef peut être en maintenance.');
      if (unit.airborne) return fail('Un aéronef en vol ne peut pas être indisponible.');
      if (!(patch.unavailableForMin > 0)) return fail('La durée d’indisponibilité doit être positive.');
      unit.unavailableForMin = patch.unavailableForMin;
    }
  }
  if (patch.patrol !== undefined) {
    if (patch.patrol === null || patch.patrol.length === 0) {
      delete unit.patrol;
    } else {
      if (record.kind !== 'ship') return fail('Seul un bâtiment de surface patrouille.');
      if (patch.patrol.length > 8 || !patch.patrol.every(isPos)) return fail('Une patrouille compte huit points valides au plus.');
      const zone = next.navalZones[unit.side];
      if (!zone) return fail(`Définissez d’abord la zone de manœuvre maritime du camp ${SIDE_NAME[unit.side]} (onglet Objectif) : une patrouille y est confinée.`);
      if (patch.patrol.some((p) => !inCircle(p, zone))) return fail('Un point de la patrouille est hors de la zone de manœuvre maritime du camp.');
      unit.patrol = patch.patrol.map((p) => ({ ...p }));
    }
  }
  return done(next, id);
}

/** Supprime une unité et tout ce qui s'y rapportait : sa place dans les missions, le renseignement qui la visait. */
export function removeUnit(d: Scenario, id: string): EditResult {
  if (!d.units.some((u) => u.id === id)) return fail('Unité inconnue.');
  const next = cloneData(d);
  next.units = next.units.filter((u) => u.id !== id);
  next.missions = next.missions.map((m) => ({ ...m, unitIds: m.unitIds.filter((uid) => uid !== id) })).filter((m) => m.unitIds.length > 0);
  next.intel = next.intel.filter((k) => k.unitId !== id);
  return done(next);
}

/** Renseignement initial : `side` connaît-il l'unité adverse au départ, et depuis quand ? `null` l'efface. */
export function setIntel(d: Scenario, side: SideId, unitId: string, ageMin: number | null): EditResult {
  const unit = d.units.find((u) => u.id === unitId);
  if (!unit) return fail('Unité inconnue.');
  if (unit.side === side) return fail('Le renseignement porte sur une unité adverse.');
  if (ageMin !== null && !(ageMin >= 0)) return fail('L’âge du renseignement ne peut pas être négatif.');
  const next = cloneData(d);
  next.intel = next.intel.filter((k) => !(k.side === side && k.unitId === unitId));
  if (ageMin !== null) next.intel.push({ side, unitId, ageMin });
  return done(next);
}

/* ------------------------------------------------------------------ Missions initiales */

export interface MissionInput {
  side: SideId;
  type: InitialMissionType;
  unitIds: string[];
  waypoints: LatLon[];
  name?: string;
  altM?: number;
  speed?: MissionDef['speed'];
  launchAtMin?: number;
  endAtMin?: number;
  roe?: MissionDef['roe'];
  allowRefuel?: boolean;
  emcon?: boolean;
  humanOnly?: boolean;
}

function missionProblem(d: Scenario, m: Pick<MissionDef, 'side' | 'type' | 'unitIds' | 'waypoints' | 'launchAtMin' | 'endAtMin' | 'altM'>): string | null {
  if (m.unitIds.length === 0) return 'Affectez au moins un appareil à la mission.';
  if (new Set(m.unitIds).size !== m.unitIds.length) return 'Un appareil est affecté deux fois.';
  if (m.waypoints.length === 0) return 'Placez au moins un point sur la carte.';
  if (m.waypoints.length > 8 || !m.waypoints.every(isPos)) return 'Une mission compte huit points valides au plus.';
  if (!(m.altM > 0)) return 'Altitude invalide.';
  if (!(m.launchAtMin >= 0)) return 'L’heure de départ ne peut pas être négative.';
  if (m.endAtMin !== undefined && !(m.endAtMin > m.launchAtMin)) return 'La fin de créneau doit suivre le départ.';
  const kind = MISSION_KIND[m.type as MissionType];
  for (const id of m.unitIds) {
    const unit = d.units.find((u) => u.id === id);
    if (!unit) return 'Un appareil de la mission n’existe plus.';
    if (unit.side !== m.side) return `${unit.name} appartient à l’autre camp.`;
    if (getPlatform(unit.platformId).kind !== kind) return `${unit.name} ne peut pas effectuer une mission de ce type.`;
  }
  return null;
}

export function addMission(d: Scenario, input: MissionInput): EditResult {
  const combat = input.type === 'CAP' || input.type === 'SWEEP';
  const mission: MissionDef = {
    type: input.type,
    side: input.side,
    unitIds: [...input.unitIds],
    waypoints: input.waypoints.map((w) => ({ ...w })),
    altM: input.altM ?? DEFAULT_ALTITUDE_M[MISSION_KIND[input.type]],
    speed: input.speed ?? 'cruise',
    launchAtMin: input.launchAtMin ?? 0,
    roe: input.roe ?? (combat ? d.sides[input.side].defaultRoe : 'hold'),
    allowRefuel: input.allowRefuel ?? false,
    emcon: input.emcon ?? false,
    humanOnly: input.humanOnly ?? false,
  };
  if (input.name?.trim()) mission.name = input.name.trim();
  if (input.endAtMin !== undefined) mission.endAtMin = input.endAtMin;
  const problem = missionProblem(d, mission);
  if (problem) return fail(problem);
  const next = cloneData(d);
  next.missions.push(mission);
  return done(next, String(next.missions.length - 1));
}

export type MissionPatch = Partial<Omit<MissionDef, 'side'>> & { endAtMin?: number | undefined; name?: string | undefined };

export function updateMission(d: Scenario, index: number, patch: MissionPatch): EditResult {
  const current = d.missions[index];
  if (!current) return fail('Mission inconnue.');
  const mission: MissionDef = { ...cloneData(current), ...cloneData(patch) };
  if ('endAtMin' in patch && patch.endAtMin === undefined) delete mission.endAtMin;
  if ('name' in patch && !patch.name?.trim()) delete mission.name;
  const problem = missionProblem(d, mission);
  if (problem) return fail(problem);
  const next = cloneData(d);
  next.missions[index] = mission;
  return done(next, String(index));
}

export function removeMission(d: Scenario, index: number): EditResult {
  if (!d.missions[index]) return fail('Mission inconnue.');
  const next = cloneData(d);
  next.missions.splice(index, 1);
  return done(next);
}

/* ------------------------------------------------------------------ Objectif, zones, déclencheurs */

export type ObjectivePatch = Partial<Pick<Scenario['objective'], 'name' | 'center' | 'radiusKm' | 'defender' | 'defenderWinsAtMin' | 'challengerWinsBelowMin'>>;

export function setObjective(d: Scenario, patch: ObjectivePatch): EditResult {
  const next = cloneData(d);
  const o = { ...next.objective, ...cloneData(patch) };
  if (o.name.trim() === '') return fail('L’objectif doit être nommé.');
  if (!isPos(o.center)) return fail('Position invalide.');
  if (!(o.radiusKm > 0)) return fail('Le rayon du secteur doit être positif.');
  if (!(o.defenderWinsAtMin > 0) || !(o.challengerWinsBelowMin > 0)) return fail('Les seuils de victoire doivent être positifs.');
  if (o.defenderWinsAtMin > next.durationMin) return fail('Le seuil de victoire du défenseur dépasse la durée du scénario.');
  if (o.challengerWinsBelowMin > o.defenderWinsAtMin) return fail('Le seuil du challenger ne peut pas dépasser celui du défenseur.');
  if (o.defender !== next.objective.defender) {
    // Les rôles s'inversent : une posture imposée à l'IA ne vaut que pour le rôle qu'avait son camp.
    for (const side of SIDES) {
      next.sides[side].aiInitialPosture = null;
      next.sides[side].aiPostureLockMin = 0;
    }
  }
  next.objective = o;
  return done(next);
}

export function setNavalZone(d: Scenario, side: SideId, zone: Circle | null): EditResult {
  if (zone !== null && (!isPos(zone.center) || !(zone.radiusKm > 0))) return fail('Zone de manœuvre invalide.');
  // Une patrouille est confinée à la zone de son camp : la zone ne peut pas la laisser dehors.
  const stranded = d.units.filter((u) => u.side === side && u.patrol && u.patrol.length > 0 && (zone === null || u.patrol.some((p) => !inCircle(p, zone))));
  if (stranded.length > 0) {
    return fail(`La patrouille de ${stranded.map((u) => u.name).join(', ')} sortirait de la zone de manœuvre : effacez-la ou retracez-la d’abord.`);
  }
  const next = cloneData(d);
  next.navalZones[side] = zone ? { center: { ...zone.center }, radiusKm: zone.radiusKm } : null;
  return done(next);
}

export function addTrigger(d: Scenario, input: { condition: TriggerDef['condition']; actions: TriggerDef['actions']; id?: string }): EditResult {
  if (input.actions.length === 0) return fail('Un déclencheur doit avoir au moins une action.');
  if (input.actions.some((a) => a.type === 'MESSAGE' && a.text.trim() === '')) return fail('Le message d’un déclencheur ne peut pas être vide.');
  const c = input.condition;
  if (c.type === 'GROUP_UNAVAILABLE' && !d.groups.some((g) => g.id === c.groupId)) return fail('Ce déclencheur vise un groupe qui n’existe pas.');
  if (c.type === 'TIME_ELAPSED' && !(c.atMin >= 0 && c.atMin <= d.durationMin)) return fail('Le délai du déclencheur doit tomber pendant le scénario.');
  if (c.type === 'LOSSES_AT_LEAST' && !(Number.isInteger(c.count) && c.count > 0)) return fail('Le nombre de pertes doit être un entier positif.');
  const next = cloneData(d);
  const taken = new Set(next.triggers.map((t) => t.id));
  const id = input.id && !taken.has(input.id) ? input.id : firstFree(taken, (n) => `declencheur-${n}`);
  next.triggers.push({ id, condition: cloneData(c), actions: cloneData(input.actions) });
  return done(next, id);
}

export function removeTrigger(d: Scenario, id: string): EditResult {
  if (!d.triggers.some((t) => t.id === id)) return fail('Déclencheur inconnu.');
  const next = cloneData(d);
  next.triggers = next.triggers.filter((t) => t.id !== id);
  return done(next);
}

/* ------------------------------------------------------------------ Vérification */

export interface ScenarioCheck {
  /** Empêchent de jouer le scénario. */
  errors: string[];
  /** N'empêchent pas de jouer, mais méritent un coup d'œil. */
  warnings: string[];
}

function warningsOf(d: Scenario): string[] {
  const warnings: string[] = [];
  const kindOf = (u: UnitDef) => getPlatform(u.platformId).kind;

  for (const side of SIDES) {
    const fighters = d.units.filter((u) => u.side === side && kindOf(u) === 'fighter');
    if (fighters.length === 0) {
      warnings.push(`Le camp ${SIDE_NAME[side]} n’a aucun chasseur : il ne pourra pas disputer le secteur.`);
      continue;
    }
    // Portée : sans ravitailleur dans ce camp, au moins un chasseur doit pouvoir aller au secteur et rentrer.
    const hasTanker = d.units.some((u) => u.side === side && kindOf(u) === 'tanker');
    if (hasTanker) continue;
    const reachable = fighters.some((u) => {
      const base = d.bases.find((b) => b.id === u.baseId);
      if (!base) return false;
      const perf = toPerf(getPlatform(u.platformId));
      const rules = { ...DEFAULT_RULES, ...d.rules };
      return missionWithinRange({ perf, rules, fuelKg: perf.fuelCapacityKg, origin: base.pos, target: d.objective.center, home: base.pos, altM: DEFAULT_ALTITUDE_M.fighter, tankers: null });
    });
    if (!reachable) {
      const role = d.objective.defender === side ? 'défenseur' : 'challenger';
      warnings.push(`Le secteur est hors de portée des chasseurs du camp ${SIDE_NAME[side]} (${role}), qui n’a pas de ravitailleur.`);
    }
  }

  const tasked = new Set(d.missions.flatMap((m) => m.unitIds));
  for (const u of d.units) {
    if (u.airborne && !tasked.has(u.id)) warnings.push(`${u.name} est en vol sans mission initiale : il rentrera aussitôt à sa base.`);
  }
  // Un challenger qui ne décolle jamais ne peut pas disputer le secteur : le scénario est joué d'avance.
  const challenger = opponent(d.objective.defender);
  if (d.sides[challenger].aiInitialPosture === 'WITHDRAW' && d.sides[challenger].aiPostureLockMin >= d.durationMin) {
    warnings.push(`L’IA du camp ${SIDE_NAME[challenger]} est retenue au sol pendant tout le scénario.`);
  }
  return warnings;
}

/** Vérifie un brouillon : forme, cohérence, et acceptation des missions initiales par le moteur. */
export function checkScenario(d: Scenario): ScenarioCheck {
  const errors: string[] = [];
  if (d.units.length === 0) errors.push('Ajoutez au moins une unité.');
  if (d.groups.length === 0) errors.push('Ajoutez au moins un groupe.');

  const parsed = parseScenario(d);
  if (!parsed.ok) {
    for (const e of parsed.errors) {
      // Ces deux cas sont déjà signalés ci-dessus, en clair.
      if (/^(units|groups) : /.test(e) && (d.units.length === 0 || d.groups.length === 0)) continue;
      errors.push(e);
    }
    return { errors, warnings: [] };
  }

  // Les missions initiales doivent être acceptées par le moteur, quel que soit le camp joué.
  const seen = new Set<string>();
  for (const playerSide of SIDES) {
    try {
      createInitialState(parsed.scenario, { playerSide, difficulty: parsed.scenario.difficulty, seed: parsed.scenario.seed });
    } catch (error) {
      const message =
        error instanceof InitialMissionError
          ? `Mission initiale ${error.missionName} : ${REJECT_FR[error.code] ?? `refusée par le moteur (${error.code})`}.`
          : error instanceof Error
            ? error.message
            : String(error);
      if (!seen.has(message)) {
        seen.add(message);
        errors.push(message);
      }
    }
  }
  return { errors, warnings: errors.length === 0 ? warningsOf(parsed.scenario) : [] };
}

/* ------------------------------------------------------------------ Test rapide */

export type QuickTestResult =
  | {
      ok: true;
      winner: SideId | 'DRAW';
      level: 'major' | 'minor' | 'draw';
      endedAtMin: number;
      controlMin: { BLUE: number; RED: number; CONTESTED: number };
      sorties: Record<SideId, number>;
      shots: Record<SideId, number>;
      fightersLost: Record<SideId, number>;
      events: number;
      /** Violations des contrôles de cohérence du moteur (aucune attendue). */
      violations: string[];
      hash: string;
    }
  | { ok: false; errors: string[] };

/** Joue le scénario de bout en bout, IA contre IA, en contrôlant la cohérence du moteur à chaque pas. */
export function quickTest(d: Scenario, options: { seed?: number; difficulty?: Scenario['difficulty'] } = {}): QuickTestResult {
  const check = checkScenario(d);
  if (check.errors.length > 0) return { ok: false, errors: check.errors };
  const parsed = parseScenario(d);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  try {
    const session = createSession(parsed.scenario, { playerSide: null, seed: options.seed ?? parsed.scenario.seed, difficulty: options.difficulty ?? parsed.scenario.difficulty });
    const s = session.state;
    const violations: string[] = [];
    let previous = snapshotPositions(s);
    while (!s.outcome) {
      stepSession(session, 1);
      if (violations.length < 10) violations.push(...checkInvariants(s, previous).slice(0, 10 - violations.length));
      previous = snapshotPositions(s);
    }
    const o = s.objective;
    return {
      ok: true,
      winner: s.outcome.winner,
      level: s.outcome.level,
      endedAtMin: s.outcome.endedAt / 60,
      controlMin: { BLUE: o.sec.BLUE / 60, RED: o.sec.RED / 60, CONTESTED: o.sec.CONTESTED / 60 },
      sorties: { BLUE: s.stats.BLUE.sorties, RED: s.stats.RED.sorties },
      shots: { BLUE: s.stats.BLUE.shotsFired, RED: s.stats.RED.shotsFired },
      fightersLost: { BLUE: s.stats.BLUE.losses.fighter, RED: s.stats.RED.losses.fighter },
      events: s.events.length,
      violations,
      hash: hashState(s),
    };
  } catch (error) {
    return { ok: false, errors: [`Le moteur a échoué pendant le test : ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/* ------------------------------------------------------------------ Import et export */

export function exportScenarioJson(d: Scenario): string {
  return JSON.stringify(d, null, 2);
}

/**
 * Lit un scénario exporté. Les refus sont expliqués en français.
 * Un brouillon incomplet exporté par l'éditeur est accepté tel quel : c'est `checkScenario` qui dit
 * s'il est jouable.
 */
export function importScenarioJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Ce fichier n’est pas un JSON lisible.'] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['Ce fichier ne contient pas un scénario WAR COMMAND.'] };
  }
  const record = data as Record<string, unknown>;
  if (record.format === 'warcommand-save' || record.format === 'warcommand-recording') {
    return { ok: false, errors: ['Ce fichier est une sauvegarde de partie, pas un scénario : chargez-le depuis « Reprendre une partie ».'] };
  }
  if (typeof record.formatVersion === 'number' && record.formatVersion !== 1) {
    return { ok: false, errors: [`Format de scénario non pris en charge : version ${record.formatVersion}. Cette version du jeu lit la version 1.`] };
  }
  const parsed = parseScenario(data);
  if (parsed.ok) return parsed;
  const draft = readDraft(data);
  return draft ? { ok: true, scenario: draft } : parsed;
}
