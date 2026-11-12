/**
 * Schéma versionné des scénarios (format 1) et validation automatique.
 *
 * Deux niveaux de contrôle :
 *  1. la forme (types, bornes) par Zod ;
 *  2. la cohérence (références croisées, matériels connus, géographie, seuils) par `crossCheck`.
 */
import { z } from 'zod';
import { DEFAULT_RULES, inBounds, inCircle, isGroundForce, isLand, isNaval, UNIT_KINDS, type Bounds, type UnitKind } from '@warcommand/simulation-core';
import { getPlatform, hasPlatform } from '@warcommand/unit-database';
import { hasDoctrine } from '@warcommand/doctrine-engine';
import { MISSION_KIND } from '@warcommand/air-operations';
import { INITIAL_POSTURES } from '@warcommand/ai-commander';

export const SCENARIO_FORMAT_VERSION = 1;

const Side = z.enum(['BLUE', 'RED']);
const Roe = z.enum(['hold', 'defensive', 'free']);
const Kind = z.enum(UNIT_KINDS as unknown as [UnitKind, ...UnitKind[]]);
const Id = z.string().min(1).max(64);
const Text = z.string().min(1);
const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const Circle = z.object({ center: LatLon, radiusKm: z.number().positive() });

const Fraction = z.number().min(0).max(1);

/** Réglages de doctrine propres au scénario, par-dessus le profil choisi. */
const DoctrineOverrides = z.strictObject({
  centralisation: Fraction.optional(),
  autonomie: Fraction.optional(),
  masse: Fraction.optional(),
  preservation: Fraction.optional(),
  tempo: Fraction.optional(),
  agressivite: Fraction.optional(),
});

const SideDef = z.object({
  name: Text,
  description: z.string().default(''),
  doctrineId: Id,
  doctrineOverrides: DoctrineOverrides.default({}),
  defaultRoe: Roe,
  briefing: z.string().default(''),
  /** Comportement initial de l'IA si ce camp lui est confié : posture imposée… */
  aiInitialPosture: z.enum(['STANDING_CAP', 'REINFORCED_CAP', 'ROTATING_PRESENCE', 'MASS_SWEEP', 'WITHDRAW']).nullable().default(null),
  /** … et durée, en minutes, pendant laquelle elle la tient avant de décider librement. */
  aiPostureLockMin: z.number().min(0).max(600).default(0),
  /** Résilience des réseaux et des services du camp : raccourcit les perturbations, accélère le rétablissement. */
  resilience: Fraction.default(0.5),
  /** Effets multi-domaines dont le camp dispose : perturbation des réseaux adverses, brouillage des services spatiaux adverses. */
  effects: z
    .object({ cyber: z.number().int().min(0).max(5).default(0), jam: z.number().int().min(0).max(5).default(0) })
    .default({ cyber: 0, jam: 0 }),
});

const UnitDef = z.object({
  id: Id,
  side: Side,
  name: Text,
  platformId: Id,
  groupId: Id,
  /** Base de rattachement (obligatoire pour un aéronef). */
  baseId: Id.optional(),
  /** Position initiale (obligatoire pour une unité de surface ou au sol). */
  pos: LatLon.optional(),
  /** Niveau d'entraînement de l'équipage, 0 à 1. */
  crew: z.number().min(0).max(1).default(0.7),
  /** Aéronef déjà en vol au début du scénario. */
  airborne: z
    .object({ pos: LatLon, altM: z.number().positive(), fuelFraction: z.number().min(0.05).max(1).default(1) })
    .optional(),
  /** Aéronef indisponible au début (maintenance) : minutes avant sa remise en ligne. */
  unavailableForMin: z.number().positive().optional(),
  /** Itinéraire de patrouille d'une unité navale. */
  patrol: z.array(LatLon).max(8).optional(),
  /** Formation terrestre : effectifs, moral et ravitaillement initiaux (par défaut 1 ; 0,8 ; 1) et posture de départ. */
  strength: Fraction.optional(),
  morale: Fraction.optional(),
  supply: Fraction.optional(),
  posture: z.enum(['hold', 'defend']).optional(),
  /** Formation terrestre à bord d'un bâtiment au début du scénario. */
  embarkedIn: Id.optional(),
  /** Bâtiment suivi en formation (escorte). */
  leaderId: Id.optional(),
});

const MissionDef = z.object({
  type: z.enum(['CAP', 'SWEEP', 'AEW', 'TANKER', 'RECON']),
  side: Side,
  name: z.string().min(1).optional(),
  unitIds: z.array(Id).min(1),
  waypoints: z.array(LatLon).min(1).max(8),
  altM: z.number().positive(),
  speed: z.enum(['cruise', 'dash']).default('cruise'),
  /** Minutes après le début du scénario. */
  launchAtMin: z.number().min(0),
  endAtMin: z.number().positive().optional(),
  roe: Roe,
  allowRefuel: z.boolean().default(false),
  /** Silence radar. */
  emcon: z.boolean().default(false),
  /** Mission proposée au joueur humain ; ignorée si ce camp est confié à l'IA, qui planifie elle-même. */
  humanOnly: z.boolean().default(false),
});

const Condition = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TIME_ELAPSED'), atMin: z.number().min(0) }),
  z.object({ type: z.literal('LOSSES_AT_LEAST'), side: Side, kind: Kind, count: z.number().int().positive() }),
  z.object({ type: z.literal('UNIT_IN_ZONE'), side: Side, kind: Kind, zone: Circle }),
  z.object({ type: z.literal('GROUP_UNAVAILABLE'), groupId: Id }),
  z.object({ type: z.literal('CONTROL_IS'), status: z.enum(['BLUE', 'RED', 'CONTESTED']) }),
]);

const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MESSAGE'), text: Text, vis: z.array(Side) }),
  z.object({ type: z.literal('END_MISSION'), winner: z.enum(['BLUE', 'RED', 'DRAW']) }),
]);

const TriggerDef = z.object({ id: Id, condition: Condition, actions: z.array(Action).min(1) });

export const ScenarioSchema = z.object({
  formatVersion: z.literal(SCENARIO_FORMAT_VERSION),
  id: Id,
  title: Text,
  description: Text,
  region: z.object({
    name: Text,
    bounds: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
    center: LatLon,
    zoom: z.number().min(0).max(18),
  }),
  /** Date-heure fictive de début, ISO 8601 en UTC. */
  date: z.string(),
  period: Text,
  durationMin: z.number().positive().max(24 * 60),
  weather: z.object({ label: Text, sensorFactor: z.number().min(0.3).max(1.2) }),
  seed: z.number().int().min(0).max(0xffffffff),
  sides: z.object({ BLUE: SideDef, RED: SideDef }),
  groups: z.array(z.object({ id: Id, side: Side, name: Text })).min(1),
  bases: z.array(
    z.object({
      id: Id,
      side: Side,
      name: Text,
      pos: LatLon,
      /** Stock de missiles air-air. */
      weaponStock: z.number().int().min(0),
      /** Stock de munitions air-surface. */
      asmStock: z.number().int().min(0).default(0),
      fuelStockKg: z.number().min(0),
      /** Ravitaillement des forces terrestres et navales, en points : fait de la base un dépôt. */
      supplyStock: z.number().min(0).default(0),
      /** Bâtiment qui porte la base : pont d'envol d'un porte-avions, dépôt d'un navire logistique. */
      hostUnitId: Id.optional(),
    }),
  ),
  units: z.array(UnitDef).min(1),
  missions: z.array(MissionDef),
  /** Renseignement initial : unités adverses connues au début, avec l'âge de l'information. */
  intel: z.array(z.object({ side: Side, unitId: Id, ageMin: z.number().min(0) })),
  objective: z.object({
    type: z.literal('SECTOR_CONTROL'),
    /** air : secteur disputé entre chasseurs · ground : zone tenue par des formations terrestres. */
    kind: z.enum(['air', 'ground']).default('air'),
    id: Id,
    name: Text,
    center: LatLon,
    radiusKm: z.number().positive(),
    defender: Side,
    defenderWinsAtMin: z.number().positive(),
    challengerWinsBelowMin: z.number().positive(),
  }),
  /** Zone de manœuvre maritime de chaque camp (les ordres de déplacement naval y sont confinés). */
  navalZones: z.object({ BLUE: Circle.nullable(), RED: Circle.nullable() }),
  /** Zones de terrain particulier (mobilité, protection) ; ailleurs, le terrain est ouvert. */
  terrain: z
    .array(z.object({ id: Id, name: Text, kind: z.enum(['urbain', 'foret', 'montagne', 'marais']), center: LatLon, radiusKm: z.number().positive() }))
    .default([]),
  /** Fenêtres de couverture de satellites d'observation fictifs. */
  satellites: z
    .array(z.object({ id: Id, side: Side, name: Text, startMin: z.number().min(0), endMin: z.number().positive(), footprint: Circle }))
    .default([]),
  triggers: z.array(TriggerDef),
  difficulty: z.enum(['recrue', 'standard', 'veteran']),
  /** Surcharges des paramètres de jeu par défaut. */
  rules: z.record(z.string(), z.number()).default({}),
  sources: z.array(z.object({ title: Text, note: z.string().optional(), url: z.string().optional() })),
});

export type Scenario = z.output<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/** Contrôles de cohérence au-delà de la forme. Retourne la liste des erreurs. */
export function crossCheck(sc: Scenario): string[] {
  const errors: string[] = [];
  const bounds: Bounds = sc.region.bounds;
  const where = (label: string, pos: { lat: number; lon: number }) => {
    if (!inBounds(pos, bounds)) errors.push(`${label} : position hors de la région du scénario`);
  };

  if (Number.isNaN(Date.parse(sc.date))) errors.push('date : date-heure ISO 8601 invalide');
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) errors.push('region.bounds : emprise invalide');
  where('region.center', sc.region.center);

  for (const d of duplicates(sc.units.map((u) => u.id))) errors.push(`units : identifiant en double « ${d} »`);
  for (const d of duplicates(sc.bases.map((b) => b.id))) errors.push(`bases : identifiant en double « ${d} »`);
  for (const d of duplicates(sc.groups.map((g) => g.id))) errors.push(`groups : identifiant en double « ${d} »`);
  for (const d of duplicates(sc.triggers.map((t) => t.id))) errors.push(`triggers : identifiant en double « ${d} »`);

  for (const side of ['BLUE', 'RED'] as const) {
    const def = sc.sides[side];
    if (!hasDoctrine(def.doctrineId)) errors.push(`sides.${side} : doctrine inconnue « ${def.doctrineId} »`);
    const role = sc.objective.defender === side ? 'defender' : 'challenger';
    if (def.aiInitialPosture !== null && !INITIAL_POSTURES[role].includes(def.aiInitialPosture)) {
      errors.push(`sides.${side} : la posture initiale « ${def.aiInitialPosture} » ne convient pas à un camp ${role === 'defender' ? 'défenseur' : 'challenger'}`);
    }
    if (def.aiInitialPosture === null && def.aiPostureLockMin > 0) {
      errors.push(`sides.${side} : une durée de maintien est fixée sans posture initiale`);
    }
  }

  const groups = new Map(sc.groups.map((g) => [g.id, g]));
  const bases = new Map(sc.bases.map((b) => [b.id, b]));
  const units = new Map(sc.units.map((u) => [u.id, u]));
  for (const b of sc.bases) where(`base ${b.id}`, b.pos);

  for (const u of sc.units) {
    const tag = `unité ${u.id}`;
    if (!hasPlatform(u.platformId)) {
      errors.push(`${tag} : matériel inconnu « ${u.platformId} »`);
      continue;
    }
    const platform = getPlatform(u.platformId);
    const group = groups.get(u.groupId);
    if (!group) errors.push(`${tag} : groupe inconnu « ${u.groupId} »`);
    else if (group.side !== u.side) errors.push(`${tag} : groupe d'un autre camp`);

    const ground = isGroundForce(platform.kind);
    const naval = isNaval(platform.kind);
    if (!ground && (u.strength !== undefined || u.morale !== undefined || u.supply !== undefined || u.posture !== undefined)) {
      errors.push(`${tag} : effectifs, moral, ravitaillement et posture sont réservés aux formations terrestres`);
    }
    if (u.leaderId !== undefined) {
      const leader = units.get(u.leaderId);
      const leaderNaval = leader !== undefined && hasPlatform(leader.platformId) && isNaval(getPlatform(leader.platformId).kind);
      if (!naval) errors.push(`${tag} : escorte invalide — seul un bâtiment suit un chef de file`);
      else if (!leader || !leaderNaval || leader.side !== u.side || leader.id === u.id) errors.push(`${tag} : escorte invalide — chef de file inconnu, adverse ou non naval`);
      else if (leader.leaderId !== undefined) errors.push(`${tag} : escorte invalide — le chef de file « ${leader.id} » suit lui-même un autre bâtiment`);
    }
    if (u.embarkedIn !== undefined) {
      const carrier = units.get(u.embarkedIn);
      if (!ground) errors.push(`${tag} : seule une formation terrestre peut embarquer`);
      else if (!carrier || carrier.side !== u.side || !hasPlatform(carrier.platformId)) errors.push(`${tag} : bâtiment d'embarquement inconnu ou adverse`);
      else if ((getPlatform(carrier.platformId).joint?.lift?.value ?? 0) <= 0) errors.push(`${tag} : le bâtiment « ${carrier.id} » ne transporte pas de troupes`);
    }

    if (platform.kind === 'sof') {
      const base = u.baseId ? bases.get(u.baseId) : undefined;
      if (!base || base.side !== u.side) errors.push(`${tag} : une équipe spéciale doit être rattachée à une base de son camp`);
      if (u.airborne || u.patrol || u.unavailableForMin !== undefined) errors.push(`${tag} : « airborne », « patrol » et « unavailableForMin » ne s'appliquent pas à une équipe spéciale`);
    } else if (platform.domain === 'air') {
      const base = u.baseId ? bases.get(u.baseId) : undefined;
      if (!base) errors.push(`${tag} : un aéronef doit être rattaché à une base existante`);
      else if (base.side !== u.side) errors.push(`${tag} : base d'un autre camp`);
      else if (base.hostUnitId !== undefined && !platform.carrierCapable) errors.push(`${tag} : cet aéronef ne peut pas opérer depuis un porte-avions`);
      if (u.airborne) {
        where(tag, u.airborne.pos);
        if (u.airborne.altM > platform.game.ceilingM.value) errors.push(`${tag} : altitude initiale au-dessus du plafond`);
      }
      if (u.patrol) errors.push(`${tag} : « patrol » est réservé aux unités navales`);
      if (u.airborne && u.unavailableForMin !== undefined) errors.push(`${tag} : un aéronef en vol ne peut pas être indisponible`);
    } else {
      if (u.unavailableForMin !== undefined) errors.push(`${tag} : « unavailableForMin » est réservé aux aéronefs`);
      if (!u.pos) errors.push(`${tag} : une unité de surface ou au sol doit avoir une position`);
      else {
        where(tag, u.pos);
        // Le masque terre-mer ne s'applique qu'aux unités qui se déplacent : formations terrestres et bâtiments.
        if (ground && u.embarkedIn === undefined && !isLand(u.pos)) errors.push(`${tag} : une formation terrestre doit être à terre`);
        if (naval && isLand(u.pos)) errors.push(`${tag} : un bâtiment doit être en mer`);
      }
      if (u.airborne) errors.push(`${tag} : « airborne » est réservé aux aéronefs`);
      if (u.patrol) {
        const zone = sc.navalZones[u.side];
        if (!naval) errors.push(`${tag} : « patrol » est réservé aux unités navales`);
        else if (!zone) errors.push(`${tag} : patrouille navale sans zone de manœuvre pour ce camp`);
        else if (u.patrol.some((p) => !inCircle(p, zone))) errors.push(`${tag} : patrouille hors de la zone de manœuvre`);
        else if (u.patrol.some((p) => isLand(p))) errors.push(`${tag} : un point de la patrouille est à terre`);
      }
    }
  }

  // Capacité de transport des bâtiments.
  const aboard = new Map<string, number>();
  for (const u of sc.units) if (u.embarkedIn !== undefined) aboard.set(u.embarkedIn, (aboard.get(u.embarkedIn) ?? 0) + 1);
  for (const [shipId, count] of aboard) {
    const carrier = units.get(shipId);
    const lift = carrier && hasPlatform(carrier.platformId) ? (getPlatform(carrier.platformId).joint?.lift?.value ?? 0) : 0;
    if (lift > 0 && count > lift) errors.push(`unité ${shipId} : capacité de transport dépassée (${count} formations pour ${lift})`);
  }

  // Bases embarquées : pont d'envol d'un porte-avions ou dépôt d'un navire logistique.
  for (const b of sc.bases) {
    if (b.hostUnitId === undefined) continue;
    const host = units.get(b.hostUnitId);
    const tag = `base ${b.id}`;
    if (!host || host.side !== b.side || !hasPlatform(host.platformId)) {
      errors.push(`${tag} : bâtiment porteur inconnu ou adverse`);
      continue;
    }
    const platform = getPlatform(host.platformId);
    const deck = platform.joint?.deck?.value ?? 0;
    const based = sc.units.filter((u) => u.baseId === b.id && hasPlatform(u.platformId) && getPlatform(u.platformId).domain === 'air');
    if (deck <= 0 && platform.kind !== 'supply') errors.push(`${tag} : le bâtiment porteur doit être un porte-avions ou un navire logistique`);
    else if (deck <= 0 && based.length > 0) errors.push(`${tag} : un navire logistique ne met pas d'aéronefs en œuvre`);
    else if (based.length > deck && deck > 0) errors.push(`${tag} : ${based.length} aéronefs pour ${deck} places sur le pont d'envol`);
  }

  for (const t of sc.terrain) where(`terrain ${t.id}`, t.center);
  for (const d of duplicates(sc.terrain.map((t) => t.id))) errors.push(`terrain : identifiant en double « ${d} »`);
  for (const d of duplicates(sc.satellites.map((p) => p.id))) errors.push(`satellites : identifiant en double « ${d} »`);
  for (const p of sc.satellites) {
    if (p.endMin <= p.startMin || p.endMin > sc.durationMin) errors.push(`satellite ${p.id} : fenêtre de couverture invalide`);
    where(`satellite ${p.id}`, p.footprint.center);
  }

  sc.missions.forEach((m, i) => {
    const tag = `mission ${m.name ?? `n° ${i + 1}`}`;
    if (m.launchAtMin >= sc.durationMin) errors.push(`${tag} : départ après la fin du scénario`);
    if (m.endAtMin !== undefined && m.endAtMin <= m.launchAtMin) errors.push(`${tag} : fin de créneau avant le départ`);
    for (const wp of m.waypoints) where(tag, wp);
    for (const id of m.unitIds) {
      const u = units.get(id);
      if (!u) {
        errors.push(`${tag} : unité inconnue « ${id} »`);
        continue;
      }
      if (u.side !== m.side) errors.push(`${tag} : l'unité « ${id} » appartient à l'autre camp`);
      if (hasPlatform(u.platformId) && getPlatform(u.platformId).kind !== MISSION_KIND[m.type]) {
        errors.push(`${tag} : l'unité « ${id} » ne peut pas effectuer une mission ${m.type}`);
      }
    }
  });

  for (const k of sc.intel) {
    const u = units.get(k.unitId);
    if (!u) errors.push(`intel : unité inconnue « ${k.unitId} »`);
    else if (u.side === k.side) errors.push(`intel : « ${k.unitId} » appartient au camp renseigné`);
  }

  const o = sc.objective;
  where('objective.center', o.center);
  if (o.kind === 'ground' && !isLand(o.center)) errors.push('objective : le centre d’un objectif terrestre doit être à terre');
  if (o.defenderWinsAtMin > sc.durationMin) errors.push('objective : seuil de victoire du défenseur supérieur à la durée');
  if (o.challengerWinsBelowMin > o.defenderWinsAtMin) errors.push('objective : les seuils de victoire se chevauchent');

  for (const t of sc.triggers) {
    if (t.condition.type === 'GROUP_UNAVAILABLE' && !groups.has(t.condition.groupId)) {
      errors.push(`déclencheur ${t.id} : groupe inconnu « ${t.condition.groupId} »`);
    }
    if (t.condition.type === 'TIME_ELAPSED' && t.condition.atMin > sc.durationMin) {
      errors.push(`déclencheur ${t.id} : délai supérieur à la durée du scénario`);
    }
  }

  for (const key of Object.keys(sc.rules)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_RULES, key)) errors.push(`rules : paramètre inconnu « ${key} »`);
    else if (key === 'dtS' && sc.rules[key] !== 1) errors.push('rules.dtS : seul le pas de 1 s est pris en charge');
  }
  return errors;
}

export type ParseResult = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

/** Valide une donnée quelconque (par exemple un JSON importé) comme scénario. */
export function parseScenario(input: unknown): ParseResult {
  const parsed = ScenarioSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'scénario'} : ${issue.message}`),
    };
  }
  const errors = crossCheck(parsed.data);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scenario: parsed.data };
}

/** Exporte un scénario au format JSON versionné. */
export function exportScenario(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}
