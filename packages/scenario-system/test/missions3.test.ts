import { describe, expect, it } from 'vitest';
import { destination, distanceKm, stepState, type Shot, type SimState, type Unit } from '@warcommand/simulation-core';
import {
  AIR_SYSTEMS,
  applyOrder,
  asmHitProbability,
  engagementSystem,
  missionSystem,
  movementSystem,
  observe,
  radarEmitting,
  tacticalSystem,
  type Order,
} from '@warcommand/air-operations';
import { draft, freshState } from './helpers';

const run = (s: SimState, steps: number, each?: () => void) => {
  for (let i = 0; i < steps; i++) {
    stepState(s, AIR_SYSTEMS);
    each?.();
  }
};

function fly(s: SimState, id: string, pos: { lat: number; lon: number }, headingDeg = 0, altM = 9000): Unit {
  const u = s.units[id]!;
  u.status = 'airborne';
  u.pos = { ...pos };
  u.altM = altM;
  u.headingDeg = headingDeg;
  return u;
}

const mission = (over: Parameters<typeof draft>[0], side: 'BLUE' | 'RED' = 'BLUE'): Order => ({ type: 'CREATE_MISSION', side, draft: draft(over) });

/** Crée la mission pour des appareils déjà en vol et la rend active. */
function start(s: SimState, order: Order): string {
  const res = applyOrder(s, order);
  expect(res).toMatchObject({ ok: true });
  missionSystem(s);
  return (res as { missionId: string }).missionId;
}

describe('balayage (supériorité aérienne)', () => {
  const A = { lat: 66.3, lon: -12.5 };
  const B = { lat: 66.8, lon: -11.5 };

  it('parcourt sa route une seule fois, puis rentre', () => {
    const s = freshState();
    const id = start(s, mission({ type: 'SWEEP', unitIds: ['blue-raf-1'], waypoints: [A, B], roe: 'free', launchAt: 0 }));
    const u = s.units['blue-raf-1']!;
    let reachedB = false;
    let wentBackToA = false;
    run(s, 40 * 60, () => {
      if (u.status !== 'airborne') return;
      if (distanceKm(u.pos, B) < 1) reachedB = true;
      if (reachedB && u.task !== 'rtb' && distanceKm(u.pos, A) < 5) wentBackToA = true;
    });
    expect(reachedB).toBe(true);
    expect(wentBackToA).toBe(false);
    expect(s.events.some((e) => e.code === 'UNIT_RTB' && e.p.unit === 'Rafale A1' && e.p.reason === 'mission_end')).toBe(true);
    expect(s.missions[id]!.status).toBe('completed');
  });

  it('garde la route telle que tracée : un point unique ne devient pas un circuit d’attente', () => {
    const s = freshState();
    const id = start(s, mission({ type: 'SWEEP', unitIds: ['blue-raf-1'], waypoints: [B], launchAt: 0 }));
    expect(s.missions[id]!.waypoints).toEqual([B]);
    expect(s.missions[id]!.loop).toBe(false);
  });

  it('poursuit autour de l’appareil, et non autour d’une station', () => {
    const pursues = (type: 'SWEEP' | 'CAP') => {
      const s = freshState();
      const here = { lat: 64.0, lon: -6.0 };
      const u = fly(s, 'blue-raf-1', here, 90);
      start(s, mission({ type, unitIds: [u.id], waypoints: [{ lat: 64.0, lon: -2.0 }], roe: 'free', launchAt: 0 }));
      // Hostile à 100 km de l'appareil, mais à plus de 200 km du point de la mission.
      const red = fly(s, 'red-su-1', destination(here, 180, 100), 0);
      observe(s, 'BLUE', red, true);
      tacticalSystem(s);
      return u.task === 'pursue';
    };
    expect(pursues('SWEEP')).toBe(true);
    expect(pursues('CAP')).toBe(false);
  });
});

describe('repli des moyens de soutien', () => {
  it('ne fait pas la navette : il se replie à 140 km d’une menace et ne reprend sa station qu’au-delà de 180 km', () => {
    const s = freshState();
    const awacs = s.units['blue-awacs']!;
    const red = fly(s, 'red-su-1', destination(awacs.pos, 20, 139), 200);
    const c = observe(s, 'BLUE', red, true);
    missionSystem(s);
    const place = (km: number) => {
      red.pos = destination(awacs.pos, 20, km);
      c.pos = { ...red.pos };
      tacticalSystem(s);
    };
    const alerts = () => s.events.filter((e) => e.code === 'UNIT_EVADING' && e.p.unit === awacs.name).length;

    place(139);
    expect(awacs.task).toBe('evade');
    expect(alerts()).toBe(1);

    // La menace s'éloigne un peu : le repli continue, sans nouvelle alerte.
    place(150);
    expect(awacs.task).toBe('evade');
    place(170);
    expect(awacs.task).toBe('evade');
    expect(alerts()).toBe(1);

    // Nettement éloignée : retour en station.
    place(190);
    expect(awacs.task).not.toBe('evade');

    // Une menace à 150 km ne déclenche pas de repli tant qu'elle n'est pas repassée sous 140 km.
    place(150);
    expect(awacs.task).not.toBe('evade');
    expect(alerts()).toBe(1);
  });
});

describe('escorte', () => {
  it('rejoint l’appareil protégé puis le suit', () => {
    const s = freshState();
    start(s, mission({ type: 'ESCORT', unitIds: ['blue-raf-1', 'blue-raf-2'], waypoints: [], escortUnitId: 'blue-awacs', launchAt: 0 }));
    const awacs = s.units['blue-awacs']!;
    const escorts = [s.units['blue-raf-1']!, s.units['blue-raf-2']!];
    run(s, 14 * 60);
    for (let minute = 0; minute < 12; minute++) {
      run(s, 60);
      for (const e of escorts) {
        expect(e.task).toBe('escort');
        expect(distanceKm(e.pos, awacs.pos), `${e.name} à t=${s.time}`).toBeLessThan(20);
      }
    }
    expect(distanceKm(escorts[0]!.pos, escorts[1]!.pos)).toBeGreaterThan(1);
  });

  it('engage, sous règles défensives, un chasseur hostile proche de l’appareil protégé — et lui seul', () => {
    const engaged = (km: number) => {
      const s = freshState();
      const awacs = s.units['blue-awacs']!;
      const escort = fly(s, 'blue-raf-1', destination(awacs.pos, 200, 10), 20);
      start(s, mission({ type: 'ESCORT', unitIds: [escort.id], waypoints: [], escortUnitId: awacs.id, roe: 'defensive', launchAt: 0 }));
      const red = fly(s, 'red-su-1', destination(awacs.pos, 20, km), 200);
      const c = observe(s, 'BLUE', red, true);
      tacticalSystem(s);
      return escort.task === 'pursue' && escort.targetContactId === c.id;
    };
    expect(engaged(70)).toBe(true);
    // Au-delà du rayon d'escorte (100 km), l'escorte ne quitte pas son protégé.
    expect(engaged(150)).toBe(false);
  });

  it('prend fin quand l’appareil protégé est perdu', () => {
    const s = freshState();
    const awacs = s.units['blue-awacs']!;
    const escort = fly(s, 'blue-raf-1', destination(awacs.pos, 200, 10), 20);
    const id = start(s, mission({ type: 'ESCORT', unitIds: [escort.id], waypoints: [], escortUnitId: awacs.id, launchAt: 0 }));
    tacticalSystem(s);
    expect(escort.task).toBe('escort');
    awacs.status = 'destroyed';
    s.time += 1;
    missionSystem(s);
    tacticalSystem(s);
    expect(escort.task).toBe('rtb');
    expect(escort.rtbReason).toBe('mission_end');
    expect(s.missions[id]!.status).toBe('completed');
  });

  it('refuse d’escorter un adversaire, une unité de surface, soi-même ou un appareil au sol sans mission', () => {
    // Camp BLEU confié à l'IA : ses chasseurs n'ont pas de mission initiale.
    const s = freshState('RED');
    const escort = (escortUnitId: string | null, unitIds = ['blue-raf-1']) =>
      applyOrder(s, mission({ type: 'ESCORT', unitIds, waypoints: [], escortUnitId, launchAt: 0 }));
    for (const target of ['red-aew', 'blue-frg', 'blue-raf-1', 'blue-raf-2', 'inconnu', null]) {
      expect(escort(target), String(target)).toMatchObject({ ok: false, code: 'BAD_ESCORT' });
    }
    expect(escort('blue-tanker').ok).toBe(true);
  });
});

/** Rafale en emport air-surface, en vol, à `km` au sud du site sol-air rouge, cap sur lui. */
function seadSetup(km: number, asm = 4) {
  const s = freshState();
  const sam = s.units['red-sam']!;
  const u = fly(s, 'blue-raf-1', destination(sam.pos, 180, km), 0, 500);
  u.loadoutId = 'sead';
  u.weapons = 2;
  u.asm = asm;
  const contact = Object.values(s.contacts.BLUE).find((c) => c.unitId === sam.id)!;
  start(s, mission({ type: 'SEAD', unitIds: [u.id], waypoints: [], targetContactId: contact.id, altM: 500, roe: 'free', launchAt: 0 }));
  tacticalSystem(s);
  return { s, u, sam, contact };
}

const asmShot = (s: SimState, targetId: string, over: Partial<Shot> = {}): Shot => ({
  id: 99,
  side: 'BLUE',
  shooterId: 'blue-raf-1',
  shooterName: 'Rafale A1',
  targetId,
  contactId: 'R01',
  weapon: 'asm',
  firedAt: s.time,
  impactAt: s.time + 1,
  launchRangeKm: 25,
  maxRangeKm: 50,
  shooterCrew: 0.7,
  intelStale: false,
  targetAware: true,
  from: { lat: 70, lon: -8.6 },
  ...over,
});

/** Force l'issue des tirs air-surface : coup au but certain ou impossible, destruction certaine ou impossible. */
function rig(s: SimState, hit: boolean, kill: boolean): void {
  s.rules.pkMin = hit ? 1 : 0;
  s.rules.pkMax = hit ? 1 : 0;
  s.rules.asmKillGivenHit = kill ? 1 : 0;
}

describe('SEAD — attaque des défenses sol-air', () => {
  it('se met en attaque et tire une munition air-surface à portée du site désigné', () => {
    const { s, u, sam } = seadSetup(40);
    expect(u.task).toBe('attack');
    engagementSystem(s);
    expect(s.shots).toHaveLength(1);
    expect(s.shots[0]).toMatchObject({ weapon: 'asm', targetId: sam.id, intelStale: true });
    expect([u.asm, u.weapons]).toEqual([3, 2]);
    expect(s.stats.BLUE.asmFired).toBe(1);
  });

  it('ne tire pas hors de portée', () => {
    const { s, u } = seadSetup(80);
    engagementSystem(s);
    expect(s.shots).toHaveLength(0);
    expect(u.asm).toBe(4);
  });

  it('rentre une fois ses munitions air-surface épuisées, même s’il lui reste des missiles air-air', () => {
    const { s, u } = seadSetup(40, 1);
    engagementSystem(s);
    expect(u.asm).toBe(0);
    tacticalSystem(s);
    expect(u.task).toBe('rtb');
    expect(u.rtbReason).toBe('weapons');
  });

  it('après avoir tiré, s’éloigne de la cible tant qu’il ne peut pas tirer de nouveau, puis revient à l’attaque', () => {
    const { s, u, sam } = seadSetup(40);
    const advance = (seconds: number) => {
      for (let i = 0; i < seconds; i++) {
        s.time += 1;
        tacticalSystem(s);
        movementSystem(s);
      }
    };
    engagementSystem(s);
    expect(u.asm).toBe(3);
    const atFire = distanceKm(u.pos, sam.pos);

    advance(12);
    const afterEgress = distanceKm(u.pos, sam.pos);
    expect(afterEgress).toBeGreaterThan(atFire + 1.5);

    // Cadence de tir écoulée et plus aucun missile en vol : il revient vers la cible.
    s.shots = [];
    s.time += 30;
    advance(12);
    expect(distanceKm(u.pos, sam.pos)).toBeLessThan(afterEgress - 1.5);
  });

  it('un coup au but décisif détruit le site', () => {
    const s = freshState();
    const sam = s.units['red-sam']!;
    rig(s, true, true);
    s.shots.push(asmShot(s, sam.id));
    s.time += 1;
    engagementSystem(s);
    expect(sam.status).toBe('destroyed');
    expect(s.stats.RED.losses.sam).toBe(1);
    expect(s.stats.BLUE.kills).toBe(1);
    expect(s.events.some((e) => e.code === 'UNIT_DESTROYED' && e.vis.includes('RED') && e.p.unit === sam.name)).toBe(true);
  });

  it('un coup au but non décisif neutralise le site dix minutes : ni radar, ni tir, puis reprise', () => {
    const s = freshState();
    const sam = s.units['red-sam']!;
    rig(s, true, false);
    s.shots.push(asmShot(s, sam.id));
    s.time += 1;
    engagementSystem(s);
    const hitAt = s.time;
    expect(sam.status).toBe('active');
    expect(sam.suppressedUntil).toBe(hitAt + 600);
    expect(radarEmitting(s, sam)).toBe(false);
    expect(s.events.some((e) => e.code === 'UNIT_SUPPRESSED' && e.vis.includes('RED'))).toBe(true);

    // Un chasseur hostile identifié à 40 km : le site neutralisé ne tire pas.
    const intruder = fly(s, 'blue-raf-2', destination(sam.pos, 180, 40), 0);
    const c = observe(s, 'RED', intruder, true);
    engagementSystem(s);
    expect(s.shots.filter((x) => x.shooterId === sam.id)).toHaveLength(0);

    s.time = hitAt + 600;
    c.lastSeen = s.time;
    c.radarSeenAt = s.time;
    engagementSystem(s);
    expect(radarEmitting(s, sam)).toBe(true);
    expect(s.events.some((e) => e.code === 'UNIT_RECOVERED' && e.vis.includes('RED'))).toBe(true);
    expect(s.shots.filter((x) => x.shooterId === sam.id)).toHaveLength(1);
  });

  it('un tir manqué impose tout de même deux minutes de silence', () => {
    const s = freshState();
    const sam = s.units['red-sam']!;
    rig(s, false, false);
    s.shots.push(asmShot(s, sam.id));
    s.time += 1;
    engagementSystem(s);
    expect(sam.status).toBe('active');
    expect(sam.suppressedUntil).toBe(s.time + 120);
  });

  it('un bâtiment touché est neutralisé pour de bon, mais pas coulé', () => {
    const s = freshState();
    const ship = s.units['red-frg']!;
    rig(s, true, true);
    s.shots.push(asmShot(s, ship.id));
    s.time += 1;
    engagementSystem(s);
    expect(ship.status).toBe('active');
    expect(ship.damaged).toBe(true);
    expect(radarEmitting(s, ship)).toBe(false);
    expect(s.stats.RED.losses.ship).toBe(0);
  });

  it('la probabilité de coup au but dépend de la cible et de la fraîcheur du renseignement', () => {
    const s = freshState();
    const sam = s.units['red-sam']!;
    const ship = s.units['red-frg']!;
    // base 0,5 × distance (1,15 − 0,5 × 25/50 = 0,9) × équipage (0,8 + 0,4 × 0,7 = 1,08) = 0,486
    expect(asmHitProbability(s, asmShot(s, sam.id), sam)).toBeCloseTo(0.486, 3);
    // défense rapprochée d'un bâtiment : × 0,6
    expect(asmHitProbability(s, asmShot(s, ship.id), ship)).toBeCloseTo(0.2916, 3);
    // renseignement ancien : × 0,6
    expect(asmHitProbability(s, asmShot(s, sam.id, { intelStale: true }), sam)).toBeCloseTo(0.2916, 3);
    // tir à bout de portée : distance 1,15 − 0,5 = 0,65
    expect(asmHitProbability(s, asmShot(s, sam.id, { launchRangeKm: 50 }), sam)).toBeCloseTo(0.351, 3);
  });

  it('une mission complète décolle, va au contact à basse altitude et tire', () => {
    const s = freshState();
    s.bases['base-bouclier']!.asmStock = 8;
    const contact = observe(s, 'BLUE', s.units['red-frg']!, true);
    const res = applyOrder(s, mission({ type: 'SEAD', unitIds: ['blue-raf-1', 'blue-raf-2'], waypoints: [], targetContactId: contact.id, altM: 500, roe: 'free', launchAt: 0 }));
    expect(res.ok).toBe(true);
    run(s, 50 * 60);
    expect(s.events.some((e) => e.code === 'MISSION_LAUNCHED' && e.p.mission === 'SEAD-01' && e.p.n === 2)).toBe(true);
    expect(s.stats.BLUE.asmFired).toBeGreaterThanOrEqual(1);
  });

  it('tire à distance de sécurité d’une frégate : la munition part avant que le bâtiment puisse ouvrir le feu', () => {
    const s = freshState();
    s.bases['base-bouclier']!.asmStock = 8;
    const contact = observe(s, 'BLUE', s.units['red-frg']!, true);
    applyOrder(s, mission({ type: 'SEAD', unitIds: ['blue-raf-1', 'blue-raf-2'], waypoints: [], targetContactId: contact.id, altM: 500, roe: 'free', launchAt: 0 }));
    run(s, 50 * 60);
    const fired = s.events.filter((e) => e.code === 'SHOT_FIRED');
    const firstStrike = fired.findIndex((e) => e.vis.includes('BLUE') && e.p.weapon === 'asm');
    const firstDefence = fired.findIndex((e) => e.vis.includes('RED') && e.p.weapon === 'sam');
    expect(firstStrike).toBeGreaterThanOrEqual(0);
    expect(firstDefence === -1 || firstDefence > firstStrike).toBe(true);
  });
});
