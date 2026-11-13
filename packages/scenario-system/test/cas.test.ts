import { describe, expect, it } from 'vitest';
import { destination, type LatLon, type Shot, type SimState, type Unit } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, asmHitProbability, strikeFormation, validateOrder } from '@warcommand/air-operations';
import { landSystem } from '@warcommand/land-operations';
import { draft } from './helpers';
import { east, jointState, keep, OBJ, runJoint, west } from './joint-helpers';

const SYSTEMS = [...AIR_SYSTEMS, landSystem];
const MIN = 60;

const place = (s: SimState, id: string, pos: LatLon) => {
  s.units[id]!.pos = { ...pos };
};

/** Met un chasseur en vol près du champ de bataille, en emport air-surface. */
function striker(s: SimState, id: string, pos: LatLon): Unit {
  const u = s.units[id]!;
  Object.assign(u, { status: 'airborne', pos: { ...pos }, altM: 6000, speedKmh: 900, loadoutId: 'sead', weapons: 2, asm: 4 });
  return u;
}

const cas = (s: SimState, unitIds: string[], station: LatLon) =>
  applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ type: 'CAS', unitIds, waypoints: [station], altM: 6000, launchAt: s.time }) });

const shotsFired = (s: SimState) => s.events.filter((e) => e.code === 'SHOT_FIRED' && e.p.weapon === 'asm');
const resolved = (s: SimState) => s.events.filter((e) => e.code === 'SHOT_RESOLVED' && e.p.weapon === 'asm');

/** Un blindé rouge isolé, observé à 10 km par la reconnaissance bleue : aucun combat terrestre. */
function observedArmor(seed = 11): SimState {
  const s = jointState((sc) => keep(sc, ['b-hq', 'b-rec', 'r-arm', 'r-hq', 'b-raf-1', 'b-raf-2']), seed);
  place(s, 'r-arm', east(25));
  return s;
}

describe('appui aérien rapproché — ordre', () => {
  it('accepte une mission d’appui pour des chasseurs disposant de munitions air-surface, sur une zone', () => {
    const s = jointState();
    const order = (over: Partial<ReturnType<typeof draft>>) =>
      validateOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ type: 'CAS', unitIds: ['b-raf-1'], waypoints: [east(5)], altM: 6000, ...over }) });
    expect(order({})).toEqual({ ok: true });
    expect(order({ waypoints: [] })).toMatchObject({ ok: false, code: 'NO_WAYPOINT' });
    // Sans munition air-surface, ni à bord ni à la base : pas d'appui.
    s.bases['b-airbase']!.asmStock = 0;
    expect(order({})).toMatchObject({ ok: false, code: 'NO_ORDNANCE' });
    // En vol avec le seul emport air-air : pas davantage.
    const u = s.units['b-raf-1']!;
    Object.assign(u, { status: 'airborne', pos: west(60), altM: 6000 });
    expect(order({})).toMatchObject({ ok: false, code: 'NO_ORDNANCE' });
    u.asm = 4;
    expect(order({})).toEqual({ ok: true });
  });
});

describe('appui aérien rapproché — exécution', () => {
  it('attaque une formation adverse identifiée dans sa zone ; chaque coup au but lui coûte des effectifs', () => {
    const s = observedArmor();
    striker(s, 'b-raf-1', west(60));
    expect(cas(s, ['b-raf-1'], east(20)).ok).toBe(true);
    runJoint(s, SYSTEMS, 25 * MIN);

    expect(shotsFired(s)).toHaveLength(4);
    expect(s.stats.BLUE.asmFired).toBe(4);
    const hits = resolved(s).filter((e) => e.p.result === 'attrition').length;
    expect(resolved(s)).toHaveLength(4);
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(s.units['r-arm']!.land!.strength).toBeCloseTo(1 - hits * s.rules.casStrengthLoss, 6);
    expect(s.stats.RED.landStrengthLost).toBeCloseTo(hits * s.rules.casStrengthLoss, 6);
    expect(s.units['r-arm']!.land!.morale).toBeLessThan(0.8);
    // Munitions épuisées : l'appareil rentre (il peut déjà s'être posé à la fin de l'essai).
    expect(s.events.some((e) => e.code === 'UNIT_RTB' && e.p.unit === 'Rafale 1' && e.p.reason === 'weapons')).toBe(true);
    // Les troupes qui observent la cible constatent le résultat des tirs.
    const results = s.events.filter((e) => e.code === 'SHOT_RESULT' && e.vis.includes('BLUE')).map((e) => e.p.result);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r === 'attrition' || r === 'miss')).toBe(true);
  });

  it('sans cible observée, tient sa station ; ni un renseignement ancien ni un site sol-air ne sont des cibles d’appui', () => {
    const s = observedArmor();
    place(s, 'r-arm', east(60));
    striker(s, 'b-raf-1', west(60));
    cas(s, ['b-raf-1'], east(20));
    runJoint(s, SYSTEMS, 12 * MIN);
    expect(shotsFired(s)).toHaveLength(0);
    expect(s.units['b-raf-1']!.task).toBe('station');

    // Une piste ancienne sur le blindé, dans la zone : la position n'est plus sûre, on ne tire pas.
    const stale = {
      id: 'R01', unitId: 'r-arm', domain: 'ground' as const, pos: east(22), altM: 0, headingDeg: 0, speedKmh: 0, firstSeen: 0, lastSeen: 0,
      idProgress: 1, identified: true, kind: 'armor' as const, label: 'Bataillon blindé', stale: true, hostileAct: false, damaged: false,
      radarSeenAt: -1e9, source: 'intel' as const, fixed: false,
    };
    s.contacts.BLUE['R01'] = stale;
    // Un site sol-air identifié et frais, dans la zone : ce n'est pas l'affaire de l'appui rapproché.
    s.contacts.BLUE['R02'] = { ...stale, id: 'R02', unitId: 'b-hq', kind: 'sam', label: 'Sol-air', stale: false, lastSeen: s.time + 1e6, fixed: true };
    runJoint(s, SYSTEMS, 3 * MIN);
    expect(shotsFired(s)).toHaveLength(0);
  });

  it('ignore une formation hors du rayon d’appui de sa station', () => {
    const s = observedArmor();
    striker(s, 'b-raf-1', west(60));
    cas(s, ['b-raf-1'], west(10));
    runJoint(s, SYSTEMS, 12 * MIN);
    expect(shotsFired(s)).toHaveLength(0);
  });

  it('donne la priorité à l’adversaire au contact des troupes amies', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'b-rec', 'r-hq', 'r-mech', 'r-arm', 'b-raf-1']));
    place(s, 'r-hq', east(40));
    // Un mécanisé rouge au contact du mécanisé bleu ; un blindé rouge plus près de la station, mais libre.
    place(s, 'r-mech', east(3));
    s.units['r-mech']!.land!.posture = 'attack';
    place(s, 'r-arm', east(25));
    striker(s, 'b-raf-1', west(60));
    cas(s, ['b-raf-1'], east(22));
    runJoint(s, SYSTEMS, 20 * MIN);
    const first = shotsFired(s)[0]!;
    expect(first).toBeDefined();
    expect(s.contacts.BLUE[String(first.p.contact)]?.unitId ?? 'r-mech').toBe('r-mech');
    const targets = s.events.filter((e) => e.code === 'SHOT_RESOLVED' && e.p.weapon === 'asm').map((e) => e.p.target);
    expect(targets[0]).toBe('2e mécanisé');
  });

  it('une formation déjà très entamée est mise hors de combat par l’appui', () => {
    const s = observedArmor();
    s.units['r-arm']!.land!.strength = 0.25;
    striker(s, 'b-raf-1', west(60));
    striker(s, 'b-raf-2', west(62));
    cas(s, ['b-raf-1', 'b-raf-2'], east(20));
    runJoint(s, SYSTEMS, 25 * MIN);
    expect(s.units['r-arm']!.status).toBe('destroyed');
    expect(s.stats.RED.losses.armor).toBe(1);
    expect(s.events.some((e) => e.code === 'UNIT_DESTROYED' && e.vis.includes('RED') && e.p.unit === '1er blindé')).toBe(true);
  });
});

describe('appui aérien rapproché — effet d’un coup', () => {
  it('un coup au but entame effectifs, cohésion et moral ; le retranchement en protège', () => {
    const s = jointState();
    const open = s.units['r-arm']!;
    expect(strikeFormation(s, open)).toBe('attrition');
    expect(open.land).toMatchObject({ strength: 1 - 0.1, cohesion: 1 - 0.12 });
    expect(open.land!.morale).toBeCloseTo(0.8 - 0.08, 9);

    const dug = s.units['b-mech']!;
    dug.land!.dugIn = 0.5;
    strikeFormation(s, dug);
    // 0,1 / (1 + 0,6 × 0,5) = 0,0769.
    expect(dug.land!.strength).toBeCloseTo(1 - 0.1 / 1.3, 9);

    const weak = s.units['r-mech']!;
    weak.land!.strength = 0.22;
    expect(strikeFormation(s, weak)).toBe('destroyed');
    expect(weak.status).toBe('destroyed');
  });

  it('une formation abritée par le terrain est plus difficile à toucher', () => {
    const s = jointState();
    const shot = (target: Unit): Shot => ({
      id: 1, side: 'BLUE', shooterId: 'b-raf-1', shooterName: 'Rafale 1', targetId: target.id, contactId: 'R01', weapon: 'asm',
      firedAt: 0, impactAt: 60, launchRangeKm: 50, maxRangeKm: 70, shooterCrew: 0.7, intelStale: false, targetAware: true,
      from: destination(target.pos, 270, 50),
    });
    const armor = s.units['r-arm']!;
    const inOpen = asmHitProbability(s, shot(armor), armor);
    place(s, 'r-arm', OBJ);
    // En localité : dissimulation 0,6.
    expect(asmHitProbability(s, shot(armor), armor)).toBeCloseTo(inOpen * 0.6, 9);
  });
});
