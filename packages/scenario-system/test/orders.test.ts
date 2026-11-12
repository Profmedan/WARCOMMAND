import { describe, expect, it } from 'vitest';
import { distanceKm, hashState, stepState } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, scrambleDelayS, validateOrder, type Order } from '@warcommand/air-operations';
import { BOUCLIER_ATLANTIQUE, createSession, issueOrder } from '../src/index';
import { draft, freshState, SECTOR } from './helpers';

const create = (over: Parameters<typeof draft>[0], side: 'BLUE' | 'RED' = 'BLUE'): Order => ({
  type: 'CREATE_MISSION',
  side,
  draft: draft(over),
});

describe('validation des ordres', () => {
  it('refuse sans modifier l’état, avec le bon motif', () => {
    const s = freshState();
    const before = hashState(s);
    const cases: [Order, string][] = [
      [create({ unitIds: [] }), 'NO_UNITS'],
      [create({ unitIds: ['blue-raf-1', 'blue-raf-1'] }), 'DUPLICATE_UNIT'],
      [create({ unitIds: ['inconnu'] }), 'UNKNOWN_UNIT'],
      [create({ unitIds: ['red-su-1'] }), 'WRONG_SIDE'],
      [create({ unitIds: ['blue-awacs'] }), 'WRONG_KIND'],
      [create({ unitIds: ['blue-raf-1'], type: 'AEW' }), 'WRONG_KIND'],
      [create({ unitIds: ['blue-raf-1'], waypoints: [] }), 'NO_WAYPOINT'],
      [create({ unitIds: ['blue-raf-1'], waypoints: Array.from({ length: 9 }, () => SECTOR) }), 'TOO_MANY_WAYPOINTS'],
      [create({ unitIds: ['blue-raf-1'], waypoints: [{ lat: 40, lon: 10 }] }), 'OUT_OF_THEATER'],
      [create({ unitIds: ['blue-raf-1'], altM: 30000 }), 'BAD_ALTITUDE'],
      [create({ unitIds: ['blue-raf-1'], altM: 20 }), 'BAD_ALTITUDE'],
      [create({ unitIds: ['blue-raf-1'], launchAt: 999999 }), 'BAD_TIME'],
      [create({ unitIds: ['blue-raf-1'], launchAt: 600, endAt: 300 }), 'BAD_TIME'],
      [create({ unitIds: ['blue-raf-1'], waypoints: [{ lat: 62, lon: 3 }] }), 'OUT_OF_RANGE'],
      [create({ unitIds: ['blue-raf-1'], type: 'INTERCEPT', targetContactId: 'R99' }), 'UNKNOWN_CONTACT'],
      [{ type: 'CANCEL_MISSION', side: 'BLUE', missionId: 'nulle' }, 'UNKNOWN_MISSION'],
      [{ type: 'RTB_UNIT', side: 'BLUE', unitId: 'blue-raf-1' }, 'NOT_AIRBORNE'],
      [{ type: 'MOVE_SHIP', side: 'BLUE', unitId: 'blue-raf-1', dest: SECTOR }, 'NOT_A_SHIP'],
      [{ type: 'MOVE_SHIP', side: 'BLUE', unitId: 'blue-frg', dest: { lat: 70, lon: -5 } }, 'OUT_OF_NAVAL_ZONE'],
      [{ type: 'MOVE_SHIP', side: 'BLUE', unitId: 'red-frg', dest: SECTOR }, 'WRONG_SIDE'],
    ];
    for (const [order, code] of cases) {
      const res = applyOrder(s, order);
      expect(res.ok, `${order.type} → ${code}`).toBe(false);
      if (!res.ok) expect(res.code).toBe(code);
    }
    expect(hashState(s)).toBe(before);
  });

  it('refuse un appareil détruit, en maintenance, endommagé ou pas encore remis en condition', () => {
    const s = freshState();
    const u = s.units['blue-raf-1']!;
    for (const mutate of [
      () => void (u.status = 'destroyed'),
      () => void (u.status = 'maintenance'),
      () => void ((u.status = 'ready'), (u.damaged = true)),
      () => void ((u.damaged = false), (u.status = 'turnaround'), (u.readyAt = 3000)),
    ]) {
      mutate();
      const res = validateOrder(s, create({ unitIds: ['blue-raf-1'], launchAt: 600 }));
      expect(res).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });
    }
    // Remise en condition terminée avant le départ demandé : accepté.
    expect(validateOrder(s, create({ unitIds: ['blue-raf-1'], launchAt: 3600 })).ok).toBe(true);
  });

  it('refuse tout ordre une fois la mission terminée', () => {
    const s = freshState();
    s.outcome = { winner: 'DRAW', level: 'draw', reason: 'time', endedAt: 0 };
    expect(validateOrder(s, create({ unitIds: ['blue-raf-1'] }))).toMatchObject({ ok: false, code: 'MISSION_OVER' });
  });
});

describe('application des ordres', () => {
  it('crée une mission planifiée, nommée, avec délai de mise en œuvre et circuit d’attente', () => {
    const s = freshState('RED');
    const res = applyOrder(s, create({ unitIds: ['red-su-1', 'red-su-2'], waypoints: [SECTOR], launchAt: 0, roe: 'free' }, 'RED'));
    expect(res.ok).toBe(true);
    const m = s.missions[(res as { missionId: string }).missionId]!;
    expect(m.name).toBe('CAP-01');
    expect(m.status).toBe('planned');
    expect(m.launchAt).toBe(scrambleDelayS(s.rules, s.doctrine.RED));
    expect(m.waypoints).toHaveLength(2);
    expect(distanceKm(m.waypoints[0]!, m.waypoints[1]!)).toBeCloseTo(2 * s.rules.racetrackHalfKm, 0);
    expect(s.units['red-su-1']!.missionId).toBe(m.id);
    expect(s.events.some((e) => e.code === 'MISSION_PLANNED' && e.vis.length === 1 && e.vis[0] === 'RED')).toBe(true);
  });

  it('réaffecter un appareil le retire de sa mission précédente, close si elle est vide', () => {
    const s = freshState();
    const cap01 = Object.values(s.missions).find((m) => m.name === 'CAP-01')!;
    const res = applyOrder(s, create({ unitIds: ['blue-raf-1', 'blue-raf-2', 'blue-raf-3', 'blue-raf-4'], launchAt: 60 }));
    expect(res.ok).toBe(true);
    expect(cap01.status).toBe('cancelled');
    expect(s.units['blue-raf-3']!.missionId).toBe((res as { missionId: string }).missionId);
  });

  it('annuler une mission active renvoie les appareils à la base', () => {
    const s = freshState();
    const res = applyOrder(s, create({ unitIds: ['blue-raf-1', 'blue-raf-2'], launchAt: 0 }));
    const id = (res as { missionId: string }).missionId;
    for (let i = 0; i < 400; i++) stepState(s, AIR_SYSTEMS);
    expect(s.units['blue-raf-1']!.status).toBe('airborne');
    expect(applyOrder(s, { type: 'CANCEL_MISSION', side: 'BLUE', missionId: id }).ok).toBe(true);
    expect(s.missions[id]!.status).toBe('cancelled');
    expect(s.units['blue-raf-1']!.task).toBe('rtb');
    expect(s.units['blue-raf-1']!.missionId).toBeNull();
  });

  it('déplace un navire dans sa zone de manœuvre, sans téléportation', () => {
    const s = freshState();
    const ship = s.units['blue-frg']!;
    const dest = { lat: 66.2, lon: -12.9 };
    expect(applyOrder(s, { type: 'MOVE_SHIP', side: 'BLUE', unitId: 'blue-frg', dest }).ok).toBe(true);
    const start = { ...ship.pos };
    for (let i = 0; i < 600; i++) stepState(s, AIR_SYSTEMS);
    const speed = s.platforms[ship.platformId]!.cruiseKmh;
    expect(distanceKm(start, ship.pos)).toBeLessThanOrEqual((speed * 600) / 3600 + 1e-6);
    expect(distanceKm(ship.pos, dest)).toBeLessThan(distanceKm(start, dest));
  });

  it('un camp confié à l’IA ne reçoit aucun ordre du joueur', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 3 });
    const res = issueOrder(session, create({ unitIds: ['red-su-1'] }, 'RED'));
    expect(res).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    expect(session.orders).toHaveLength(0);
    expect(issueOrder(session, create({ unitIds: ['blue-raf-1'] })).ok).toBe(true);
    expect(session.orders).toHaveLength(1);
  });
});
