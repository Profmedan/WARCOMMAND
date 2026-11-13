import { describe, expect, it } from 'vitest';
import { destination, distanceKm, type LatLon, type SimState } from '@warcommand/simulation-core';
import { sensorSystem } from '@warcommand/air-operations';
import { applyLandOrder, isInCommand, landOrderDelayS, landSystem, terrainAt, validateLandOrder } from '@warcommand/land-operations';
import { east, jointState, keep, OBJ, runJoint, SEA, west } from './joint-helpers';

const place = (s: SimState, id: string, pos: LatLon) => {
  s.units[id]!.pos = { ...pos };
};

const move = (s: SimState, unitId: string, route: LatLon[], posture: 'move' | 'attack' | 'withdraw' = 'move') =>
  applyLandOrder(s, { type: 'LAND_ORDER', side: s.units[unitId]!.side, unitId, posture, route });

describe('ordres aux formations terrestres', () => {
  it('accepte un déplacement à terre et refuse, en disant pourquoi, ce qui est impossible', () => {
    const s = jointState();
    const order = (unitId: string, route: LatLon[], posture: 'move' | 'attack' | 'withdraw' | 'hold' | 'defend' = 'move', side: 'BLUE' | 'RED' = 'BLUE') =>
      validateLandOrder(s, { type: 'LAND_ORDER', side, unitId, posture, route });

    expect(order('b-mech', [east(10)])).toEqual({ ok: true });
    // Tenir ou défendre sur place ne demande aucun itinéraire.
    expect(order('b-mech', [], 'defend')).toEqual({ ok: true });
    expect(order('b-mech', [], 'hold')).toEqual({ ok: true });

    expect(order('fantome', [east(10)])).toMatchObject({ ok: false, code: 'UNKNOWN_UNIT' });
    expect(order('r-arm', [east(50)])).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    // Ni un aéronef, ni un bâtiment, ni une équipe spéciale ne reçoivent d'ordre terrestre.
    expect(order('b-raf-1', [east(10)])).toMatchObject({ ok: false, code: 'NOT_A_GROUND_UNIT' });
    expect(order('b-frig', [east(10)])).toMatchObject({ ok: false, code: 'NOT_A_GROUND_UNIT' });
    expect(order('b-sof', [east(10)])).toMatchObject({ ok: false, code: 'NOT_A_GROUND_UNIT' });
    // Une troupe embarquée n'est pas à terre.
    expect(order('r-inf', [east(60)], 'move', 'RED')).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });

    expect(order('b-mech', [], 'move')).toMatchObject({ ok: false, code: 'NO_WAYPOINT' });
    expect(order('b-mech', Array.from({ length: 9 }, () => east(5)))).toMatchObject({ ok: false, code: 'TOO_MANY_WAYPOINTS' });
    expect(order('b-mech', [{ lat: 50, lon: 20 }])).toMatchObject({ ok: false, code: 'OUT_OF_THEATER' });
    // Un itinéraire terrestre ne traverse pas la mer : ni son arrivée, ni un point de passage.
    expect(order('b-mech', [SEA.blueFrigate])).toMatchObject({ ok: false, code: 'NOT_ON_LAND' });
    // Le Groenland est dans la région, mais on n'y va pas à pied.
    expect(order('b-mech', [east(10), { lat: 71.0, lon: -24.0 }])).toMatchObject({ ok: false, code: 'NOT_ON_LAND' });

    s.outcome = { winner: 'DRAW', level: 'draw', reason: 'time', endedAt: 0 };
    expect(order('b-mech', [east(10)])).toMatchObject({ ok: false, code: 'MISSION_OVER' });
  });

  it('un ordre met du temps à parvenir à l’unité : elle ne bouge qu’après le délai de commandement', () => {
    const s = jointState();
    const rec = s.units['b-rec']!;
    const start = { ...rec.pos };
    const delay = landOrderDelayS(s, rec);
    expect(delay).toBe(Math.round(s.rules.landOrderDelayS * (0.5 + s.doctrine.BLUE.centralisation)));

    expect(move(s, 'b-rec', [east(30)])).toEqual({ ok: true });
    expect(rec.land!.pending).toMatchObject({ at: delay, posture: 'move' });
    expect(s.events.some((e) => e.code === 'LAND_ORDER' && e.vis.includes('BLUE') && !e.vis.includes('RED'))).toBe(true);

    runJoint(s, [landSystem], delay - 1);
    expect(rec.pos).toEqual(start);
    expect(rec.land!.posture).toBe('hold');
    runJoint(s, [landSystem], 10);
    expect(rec.land!.pending).toBeNull();
    expect(rec.land!.posture).toBe('move');
    expect(distanceKm(rec.pos, start)).toBeGreaterThan(0.05);
  });

  it('hors du rayon de son poste de commandement, ou sans poste de commandement, le délai double', () => {
    const s = jointState();
    const mech = s.units['b-mech']!;
    const base = landOrderDelayS(s, mech);
    expect(isInCommand(s, mech)).toBe(true);

    // Le PC est à 40 km ; son rayon est de 60 km. À 70 km, l'unité n'est plus commandée.
    place(s, 'b-mech', east(30));
    expect(isInCommand(s, mech)).toBe(false);
    expect(landOrderDelayS(s, mech)).toBe(base * 2);

    place(s, 'b-mech', OBJ);
    s.units['b-hq']!.status = 'destroyed';
    expect(isInCommand(s, mech)).toBe(false);
    expect(landOrderDelayS(s, mech)).toBe(base * 2);
    // Un PC adverse à portée ne commande évidemment pas l'unité.
    place(s, 'r-hq', west(1));
    expect(isInCommand(s, mech)).toBe(false);
  });

  it('des réseaux dégradés allongent le délai de commandement', () => {
    const s = jointState();
    const mech = s.units['b-mech']!;
    const base = landOrderDelayS(s, mech);
    s.services.BLUE.level.network = 0.5;
    expect(landOrderDelayS(s, mech)).toBe(base * 2);
    s.services.BLUE.level.network = 0;
    expect(landOrderDelayS(s, mech)).toBe(base * 3);
    // Les réseaux adverses n'y changent rien.
    s.services.BLUE.level.network = 1;
    s.services.RED.level.network = 0;
    expect(landOrderDelayS(s, mech)).toBe(base);
  });
});

describe('mouvement terrestre', () => {
  it('parcourt son itinéraire à sa vitesse, puis s’arrête et tient', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-rec']));
    const rec = s.units['b-rec']!;
    const delay = landOrderDelayS(s, rec);
    move(s, 'b-rec', [east(22), east(30)]);
    // 15 km à 45 km/h : vingt minutes. À mi-parcours, l'unité est à mi-chemin.
    runJoint(s, [landSystem], delay + 600);
    expect(distanceKm(rec.pos, east(15))).toBeGreaterThan(7.3);
    expect(distanceKm(rec.pos, east(15))).toBeLessThan(7.6);
    expect(rec.speedKmh).toBeGreaterThan(44);
    runJoint(s, [landSystem], 640);
    expect(distanceKm(rec.pos, east(30))).toBeLessThan(0.05);
    expect(rec.land!.posture).toBe('hold');
    expect(rec.route).toEqual([]);
    expect(rec.speedKmh).toBe(0);
  });

  it('le terrain difficile ralentit ; le génie réduit de moitié cette pénalité', () => {
    const forest = east(30, 14);
    const run = (withEngineer: boolean): number => {
      const s = jointState((sc) => keep(sc, withEngineer ? ['b-hq', 'b-rec', 'b-eng'] : ['b-hq', 'b-rec']));
      place(s, 'b-hq', east(10));
      place(s, 'b-rec', forest);
      if (withEngineer) place(s, 'b-eng', destination(forest, 180, 3));
      expect(terrainAt(s, forest)).toBe('foret');
      expect(terrainAt(s, OBJ)).toBe('urbain');
      expect(terrainAt(s, east(15))).toBe('ouvert');
      const rec = s.units['b-rec']!;
      const delay = landOrderDelayS(s, rec);
      move(s, 'b-rec', [destination(forest, 90, 4)]);
      runJoint(s, [landSystem], delay + 300);
      return distanceKm(rec.pos, forest);
    };
    // En forêt : 45 km/h × 0,6 = 27 km/h, soit 2,25 km en cinq minutes ; avec le génie, 36 km/h, soit 3 km.
    expect(run(false)).toBeGreaterThan(2.2);
    expect(run(false)).toBeLessThan(2.27);
    expect(run(true)).toBeGreaterThan(2.94);
    expect(run(true)).toBeLessThan(3.02);
  });

  it('s’arrête à la limite de la zone de contrôle d’une formation adverse', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-rec', 'r-arm']));
    place(s, 'b-hq', east(20));
    const rec = s.units['b-rec']!;
    const arm = s.units['r-arm']!;
    move(s, 'b-rec', [east(58)]);
    runJoint(s, [landSystem], 70 * 60);
    const gap = distanceKm(rec.pos, arm.pos);
    expect(gap).toBeGreaterThan(s.rules.zocKm - 0.1);
    expect(gap).toBeLessThan(s.rules.zocKm + 0.1);
    expect(rec.land!.posture).toBe('move');
    expect(rec.speedKmh).toBe(0);
    expect(rec.land!.inContact).toBe(false);

    // Dans une zone de contrôle, un simple déplacement ne permet pas de se dégager : il faut décrocher.
    move(s, 'b-rec', [east(20)], 'move');
    runJoint(s, [landSystem], 10 * 60);
    expect(distanceKm(rec.pos, arm.pos)).toBeLessThan(s.rules.zocKm + 0.1);
    move(s, 'b-rec', [east(20)], 'withdraw');
    runJoint(s, [landSystem], 15 * 60);
    expect(distanceKm(rec.pos, arm.pos)).toBeGreaterThan(s.rules.zocKm + 3);
  });

  it('une unité qui attaque avance jusqu’au contact', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'r-arm', 'r-hq']));
    place(s, 'r-hq', east(40));
    place(s, 'r-arm', east(12));
    const arm = s.units['r-arm']!;
    move(s, 'r-arm', [OBJ], 'attack');
    runJoint(s, [landSystem], 40 * 60);
    const gap = distanceKm(arm.pos, s.units['b-mech']!.pos);
    expect(gap).toBeLessThanOrEqual(s.rules.landContactKm);
    expect(gap).toBeGreaterThan(1);
    expect(arm.land!.inContact).toBe(true);
    expect(s.units['b-mech']!.land!.inContact).toBe(true);
    expect(arm.land!.posture).toBe('attack');
  });
});

describe('observation terrestre', () => {
  it('une formation voit les formations adverses à portée d’observation, et les identifie', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-rec', 'r-arm']));
    place(s, 'r-arm', destination(s.units['b-rec']!.pos, 90, 10));
    runJoint(s, [landSystem], s.rules.sensorIntervalS);
    const contacts = Object.values(s.contacts.BLUE);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ unitId: 'r-arm', domain: 'ground', identified: true, kind: 'armor', source: 'ground', fixed: false, stale: false });
    // Le blindé, lui, ne voit qu'à 5 km : il ignore l'escadron de reconnaissance.
    expect(Object.values(s.contacts.RED)).toHaveLength(0);
  });

  it('ne voit rien au-delà de sa portée, et moins loin une unité abritée par le terrain', () => {
    const far = jointState((sc) => keep(sc, ['b-hq', 'b-rec', 'r-arm']));
    place(far, 'r-arm', destination(far.units['b-rec']!.pos, 90, 20));
    runJoint(far, [landSystem], 60);
    expect(Object.values(far.contacts.BLUE)).toHaveLength(0);

    const forest = east(30, 14);
    const hidden = jointState((sc) => keep(sc, ['b-hq', 'b-rec', 'r-arm']));
    place(hidden, 'r-arm', forest);
    // À 10 km d'une unité en forêt : 12 km × 0,6 = 7,2 km de portée utile, elle reste invisible.
    place(hidden, 'b-rec', destination(forest, 180, 10));
    runJoint(hidden, [landSystem], 60);
    expect(Object.values(hidden.contacts.BLUE)).toHaveLength(0);
    place(hidden, 'b-rec', destination(forest, 180, 6.5));
    runJoint(hidden, [landSystem], 60);
    expect(Object.values(hidden.contacts.BLUE)).toHaveLength(1);
  });

  it('la piste d’une formation mobile vieillit puis est abandonnée ; celle d’un site sol-air reste au dossier', () => {
    const s = jointState((sc) => {
      keep(sc, ['b-hq', 'b-rec', 'r-arm']);
      sc.units.push({ id: 'r-sam', side: 'RED', name: 'Sol-air rouge', platformId: 'sam-mr-generic', groupId: 'r-land', pos: east(24) });
    });
    // Le site sol-air n'émet pas : il n'est vu que par l'observation terrestre.
    s.units['r-sam']!.suppressedUntil = 1e9;
    place(s, 'r-arm', east(25));
    runJoint(s, [sensorSystem, landSystem], 10);
    const tracks = () => Object.values(s.contacts.BLUE);
    expect(tracks().map((c) => [c.unitId, c.fixed]).sort()).toEqual([['r-arm', false], ['r-sam', true]]);

    // L'escadron s'éloigne : plus aucune observation.
    place(s, 'b-rec', west(20));
    runJoint(s, [sensorSystem, landSystem], s.rules.staleAfterS + 10);
    expect(tracks().every((c) => c.stale)).toBe(true);
    runJoint(s, [sensorSystem, landSystem], s.rules.dropSurfaceAfterS);
    expect(tracks().map((c) => c.unitId)).toEqual(['r-sam']);
  });
});
