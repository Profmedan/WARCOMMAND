import { describe, expect, it } from 'vitest';
import {
  cloneData,
  destination,
  distanceKm,
  getSidePicture,
  isLand,
  stepState,
  type AiMemory,
  type Difficulty,
  type LatLon,
  type SideId,
  type SimState,
} from '@warcommand/simulation-core';
import { observe } from '@warcommand/air-operations';
import { landSystem } from '@warcommand/land-operations';
import { aiDecide, type CommanderOrder } from '@warcommand/ai-commander';
import { applyGameOrder, createInitialState, TETE_DE_PONT, validateGameOrder } from '../src/index';

const fixed = (value: number) => () => value;
const OBJ = TETE_DE_PONT.objective.center;
const R = TETE_DE_PONT.objective.radiusKm;

function state(difficulty: Difficulty = 'standard', time = 300): SimState {
  const s = createInitialState(TETE_DE_PONT, { playerSide: null, difficulty, seed: 1 });
  s.time = time;
  return s;
}

function decide(s: SimState, side: SideId, mem: AiMemory = s.ai[side]!): CommanderOrder[] {
  return aiDecide(cloneData(getSidePicture(s, side)), mem, fixed(0.5));
}

/** Les ordres d'un cycle sont valides s'ils sont acceptés l'un après l'autre, dans l'ordre où l'IA les donne. */
function expectAllValid(s: SimState, orders: CommanderOrder[], side: SideId): void {
  const sim = cloneData(s);
  for (const order of orders) {
    expect(order.side).toBe(side);
    expect(applyGameOrder(sim, order), JSON.stringify(order)).toMatchObject({ ok: true });
  }
}

function applyAll(s: SimState, orders: CommanderOrder[]): void {
  for (const order of orders) expect(applyGameOrder(s, order), JSON.stringify(order)).toMatchObject({ ok: true });
}

const landOrders = (orders: CommanderOrder[]) => orders.filter((o) => o.type === 'LAND_ORDER');
const landOrderFor = (orders: CommanderOrder[], unitId: string) => landOrders(orders).find((o) => o.unitId === unitId);
const routeEnd = (order: { route: LatLon[] }) => order.route[order.route.length - 1]!;
const place = (s: SimState, id: string, pos: LatLon) => {
  s.units[id]!.pos = { ...pos };
};

/** Met le 2e mécanisé rouge au contact du 1er mécanisé bleu, et laisse le système terrestre le constater. */
function engage(s: SimState): void {
  place(s, 'red-meca', destination(OBJ, 90, 3));
  s.units['red-meca']!.land!.posture = 'attack';
  while (s.time % 60 !== 59) s.time += 1;
  stepState(s, [landSystem]);
  expect(s.units['blue-meca']!.land!.inContact).toBe(true);
}

describe('IA interarmées — manœuvre terrestre', () => {
  it('challenger : lance ses formations de mêlée à l’attaque de l’objectif ; appuis et soutiens suivent en arrière', () => {
    const s = state();
    const orders = decide(s, 'RED');
    expectAllValid(s, orders, 'RED');
    for (const id of ['red-blinde', 'red-meca']) {
      const o = landOrderFor(orders, id)!;
      expect(o, id).toBeDefined();
      expect(o.posture).toBe('attack');
      expect(distanceKm(routeEnd(o), OBJ)).toBeLessThan(R * 0.5);
    }
    // Distance à l'objectif du point où l'unité se rend — ou de sa position si elle y est déjà.
    const behind = (id: string) => {
      const o = landOrderFor(orders, id);
      return distanceKm(o && o.route.length > 0 ? routeEnd(o) : s.units[id]!.pos, OBJ);
    };
    expect(landOrderFor(orders, 'red-art')!.posture).toBe('move');
    expect(behind('red-art')).toBeGreaterThan(R);
    expect(behind('red-art')).toBeLessThan(28);
    // La logistique et le PC restent derrière l'artillerie, à portée de commandement et de ravitaillement.
    expect(behind('red-log')).toBeGreaterThan(behind('red-art'));
    expect(behind('red-pc')).toBeGreaterThan(behind('red-log'));
    expect(behind('red-pc')).toBeLessThan(50);
    expect(s.ai.RED!.log.some((d) => d.code === 'GROUND_ATTACK')).toBe(true);

    // Ordres donnés : l'IA ne les répète pas tant qu'ils sont en cours.
    applyAll(s, orders);
    s.time += 130;
    expect(landOrders(decide(s, 'RED'))).toHaveLength(0);
  });

  it('défenseur : garde ses formations retranchées dans l’objectif et y fait monter sa réserve', () => {
    const s = state();
    const orders = decide(s, 'BLUE');
    expectAllValid(s, orders, 'BLUE');
    // Les unités déjà en défense dans la localité n'en bougent pas.
    for (const id of ['blue-meca', 'blue-inf', 'blue-genie']) expect(landOrderFor(orders, id), id).toBeUndefined();
    // La réserve blindée, à 38 km, est appelée dans la zone.
    const reserve = landOrderFor(orders, 'blue-blinde')!;
    expect(reserve).toBeDefined();
    expect(distanceKm(routeEnd(reserve), OBJ)).toBeLessThan(R * 0.6);
    // Aucune formation de mêlée n'est envoyée hors de la zone.
    for (const o of landOrders(orders)) {
      if (o.unitId === 'blue-reco' || o.route.length === 0) continue;
      if (['blue-art', 'blue-log', 'blue-pc'].includes(o.unitId)) continue;
      expect(distanceKm(routeEnd(o), OBJ), o.unitId).toBeLessThan(R);
    }
    // L'artillerie, immobile à bonne distance en arrière, reçoit l'ordre de s'installer.
    expect(landOrderFor(orders, 'blue-art')?.posture ?? 'defend').toBe('defend');
    expect(s.ai.BLUE!.log.some((d) => d.code === 'GROUND_DEFENCE')).toBe(true);
  });

  it('ne dépend que de l’image de son camp : une formation adverse non détectée ne change rien à ses ordres', () => {
    const a = state();
    const b = state();
    place(b, 'blue-blinde', destination(OBJ, 270, 5));
    b.units['blue-meca']!.land!.strength = 0.3;
    b.units['blue-sm']!.pos = { lat: 65.2, lon: -13.0 };
    const ordersA = decide(a, 'RED');
    const ordersB = decide(b, 'RED');
    expect(ordersA.length).toBeGreaterThan(0);
    expect(ordersB).toEqual(ordersA);
    expect(b.ai.RED).toEqual(a.ai.RED);
  });
});

describe('IA interarmées — appui, effets, forces spéciales', () => {
  it('garde dès le départ une paire de chasseurs en alerte pour l’appui : l’IA aérienne ne les engage pas ailleurs', () => {
    const s = state();
    const committed = new Set<string>();
    // Six cycles de décision espacés, sans combat terrestre — de quoi épuiser toutes les attentes de l'IA aérienne.
    // ROUGE n'a que quatre chasseurs : deux au plus partent en mission, deux restent en alerte.
    for (let i = 0; i < 6; i++) {
      const orders = decide(s, 'RED');
      for (const o of orders) if (o.type === 'CREATE_MISSION' && o.draft.type !== 'CAS') for (const id of o.draft.unitIds) committed.add(id);
      applyAll(s, orders);
      s.time += 800;
    }
    expect(committed.size).toBeGreaterThan(0);
    expect(committed.size).toBeLessThanOrEqual(2);
  });

  it('demande un appui aérien pour ses troupes au contact, avec des appareils réservés à cet effet', () => {
    const s = state();
    engage(s);
    const orders = decide(s, 'BLUE');
    const missions = orders.filter((o) => o.type === 'CREATE_MISSION');
    const cas = missions.filter((o) => o.draft.type === 'CAS');
    expect(cas).toHaveLength(1);
    const draft = cas[0]!.draft;
    expect(draft.unitIds).toHaveLength(2);
    expect(distanceKm(draft.waypoints[0]!, s.units['red-meca']!.pos)).toBeLessThan(6);
    expectAllValid(s, orders, 'BLUE');
    // Les appareils de l'appui ne sont pas aussi affectés à une autre mission du même cycle.
    const others = missions.filter((o) => o.draft.type !== 'CAS').flatMap((o) => o.draft.unitIds);
    for (const id of draft.unitIds) expect(others).not.toContain(id);
    expect(s.ai.BLUE!.log.some((d) => d.code === 'CAS')).toBe(true);

    // Un appui déjà ordonné : pas de second tant qu'il court.
    applyAll(s, orders);
    s.time += 200;
    expect(decide(s, 'BLUE').filter((o) => o.type === 'CREATE_MISSION' && o.draft.type === 'CAS')).toHaveLength(0);
  });

  it('sans munition air-surface, ne demande pas d’appui', () => {
    const s = state();
    for (const b of Object.values(s.bases)) b.asmStock = 0;
    engage(s);
    expect(decide(s, 'BLUE').filter((o) => o.type === 'CREATE_MISSION' && o.draft.type === 'CAS')).toHaveLength(0);
  });

  it('emploie ses effets cyber et spatiaux quand le combat terrestre s’engage, une seule fois ; pas au niveau recrue', () => {
    const quiet = state();
    expect(decide(quiet, 'BLUE').filter((o) => o.type === 'USE_EFFECT')).toHaveLength(0);

    const s = state();
    engage(s);
    const orders = decide(s, 'BLUE');
    expect(orders.filter((o) => o.type === 'USE_EFFECT').map((o) => o.effect).sort()).toEqual(['cyber', 'jam']);
    applyAll(s, orders);
    s.time += 200;
    expect(decide(s, 'BLUE').filter((o) => o.type === 'USE_EFFECT')).toHaveLength(0);
    expect(s.ai.BLUE!.log.some((d) => d.code === 'EFFECT')).toBe(true);

    const rookie = state('recrue');
    engage(rookie);
    expect(decide(rookie, 'BLUE').filter((o) => o.type === 'USE_EFFECT')).toHaveLength(0);
  });

  it('infiltre son équipe spéciale une fois, sur un point à terre et à portée, puis la rappelle avant la fin', () => {
    // Sans piste terrestre, l'IA attend vingt minutes avant d'engager son équipe à l'aveugle.
    expect(decide(state(), 'BLUE').filter((o) => o.type === 'SOF_INSERT')).toHaveLength(0);
    for (const side of ['BLUE', 'RED'] as const) {
      const s = state('standard', 1300);
      const orders = decide(s, side);
      const inserts = orders.filter((o) => o.type === 'SOF_INSERT');
      expect(inserts, side).toHaveLength(1);
      expect(isLand(inserts[0]!.target)).toBe(true);
      expect(validateGameOrder(s, inserts[0]!)).toMatchObject({ ok: true });
      applyAll(s, orders);
      s.time += 200;
      expect(decide(s, side).filter((o) => o.type === 'SOF_INSERT')).toHaveLength(0);

      // En observation, à moins de quarante minutes de la fin : rappel.
      const team = Object.values(s.units).find((u) => u.side === side && u.kind === 'sof')!;
      Object.assign(team, { status: 'active' });
      team.sof!.phase = 'observing';
      s.time = s.endTime - 30 * 60;
      const late = decide(s, side).filter((o) => o.type === 'SOF_EXTRACT');
      expect(late, side).toHaveLength(1);
      expect(validateGameOrder(s, late[0]!)).toMatchObject({ ok: true });
    }
    expect(decide(state('recrue', 1300), 'BLUE').filter((o) => o.type === 'SOF_INSERT')).toHaveLength(0);
  });
});

describe('IA interarmées — mer', () => {
  it('amène son navire amphibie à portée d’une plage, puis met le renfort à terre', () => {
    const s = state();
    const amphib = s.units['red-amphib']!;
    const approach = decide(s, 'RED').filter((o) => o.type === 'MOVE_SHIP' && o.unitId === 'red-amphib');
    expect(approach).toHaveLength(1);
    const order = approach[0]!;
    if (order.type !== 'MOVE_SHIP') throw new Error('ordre inattendu');
    expect(validateGameOrder(s, order)).toMatchObject({ ok: true });
    expect(isLand(order.dest)).toBe(false);
    expect(distanceKm(order.dest, amphib.pos)).toBeGreaterThan(1);

    // Arrivé au point d'approche : débarquement.
    place(s, 'red-amphib', order.dest);
    s.time += 400;
    const landing = decide(s, 'RED').filter((o) => o.type === 'LAND_TROOPS');
    expect(landing).toHaveLength(1);
    expect(landing[0]).toMatchObject({ shipId: 'red-amphib', unitId: 'red-meca-2' });
    expect(validateGameOrder(s, landing[0]!)).toMatchObject({ ok: true });
    expect(s.ai.RED!.log.some((d) => d.code === 'LANDING')).toBe(true);
  });

  it('au niveau vétéran, son sous-marin va au-devant d’un bâtiment adverse repéré', () => {
    const hunt = (difficulty: Difficulty) => {
      const s = state(difficulty);
      observe(s, 'RED', s.units['blue-pa']!, true, 'radar');
      return decide(s, 'RED').filter((o) => o.type === 'MOVE_SHIP' && o.unitId === 'red-sm');
    };
    const veteran = hunt('veteran');
    expect(veteran).toHaveLength(1);
    const order = veteran[0]!;
    if (order.type !== 'MOVE_SHIP') throw new Error('ordre inattendu');
    const s = state('veteran');
    expect(distanceKm(order.dest, s.units['blue-pa']!.pos)).toBeLessThan(distanceKm(s.units['red-sm']!.pos, s.units['blue-pa']!.pos));
    expect(validateGameOrder(s, order)).toMatchObject({ ok: true });
    expect(hunt('standard')).toHaveLength(0);
  });
});
