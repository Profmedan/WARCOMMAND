import { describe, expect, it } from 'vitest';
import { checkInvariants, destination, distanceKm, firstLandToward, isLand, pathAtSea, type LatLon, type SimState } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, hitShip, observe, validateOrder } from '@warcommand/air-operations';
import { landSystem } from '@warcommand/land-operations';
import { applyNavalOrder, navalSystem, validateNavalOrder } from '@warcommand/naval-operations';
import type { ScenarioInput } from '../src/index';
import { draft } from './helpers';
import { jointState, keep, OBJ, runJoint, SEA } from './joint-helpers';

const SYSTEMS = [...AIR_SYSTEMS, navalSystem];
const MIN = 60;

const place = (s: SimState, id: string, pos: LatLon) => {
  s.units[id]!.pos = { ...pos };
};
const naval = (s: SimState, id: string) => s.units[id]!.naval!;

/** Zones de manœuvre maritime assez larges pour tous les essais. */
function zones(sc: ScenarioInput): void {
  sc.navalZones = { BLUE: { center: { lat: 64.5, lon: -11.5 }, radiusKm: 600 }, RED: { center: { lat: 65.5, lon: -11 }, radiusKm: 600 } };
}

const fired = (s: SimState, weapon: string) => s.events.filter((e) => e.code === 'SHOT_FIRED' && e.p.weapon === weapon);
const resolved = (s: SimState, weapon: string) => s.events.filter((e) => e.code === 'SHOT_RESOLVED' && e.p.weapon === weapon);

describe('déplacement des bâtiments', () => {
  it('tout bâtiment se déplace en mer, dans la zone de manœuvre de son camp', () => {
    const s = jointState(zones);
    const go = (unitId: string, dest: LatLon, side: 'BLUE' | 'RED' = 'BLUE') => validateOrder(s, { type: 'MOVE_SHIP', side, unitId, dest });
    expect(go('b-cv', { lat: 63.8, lon: -11.5 })).toEqual({ ok: true });
    expect(go('r-sub', { lat: 65.5, lon: -10.0 }, 'RED')).toEqual({ ok: true });
    expect(go('r-lst', { lat: 65.2, lon: -12.0 }, 'RED')).toEqual({ ok: true });
    expect(go('r-aor', { lat: 65.2, lon: -12.0 }, 'RED')).toEqual({ ok: true });
    // Ni un aéronef ni une formation terrestre ne prennent la mer.
    expect(go('b-raf-1', { lat: 63.8, lon: -11.5 })).toMatchObject({ ok: false, code: 'NOT_A_SHIP' });
    expect(go('b-mech', { lat: 63.8, lon: -11.5 })).toMatchObject({ ok: false, code: 'NOT_A_SHIP' });

    // Une destination à terre, ou un trajet qui coupe la terre : refusés.
    const ashore = { lat: 65.0, lon: -14.5 };
    expect(isLand(ashore)).toBe(true);
    expect(go('b-frig', ashore)).toMatchObject({ ok: false, code: 'NOT_AT_SEA' });
    const beyond = { lat: 67.0, lon: -18.0 };
    expect(isLand(beyond)).toBe(false);
    expect(pathAtSea(s.units['b-frig']!.pos, beyond)).toBe(false);
    expect(go('b-frig', beyond)).toMatchObject({ ok: false, code: 'NOT_AT_SEA' });
    // Hors de la zone de manœuvre : refusé, comme avant.
    expect(go('b-frig', { lat: 72.5, lon: 2 })).toMatchObject({ ok: false, code: 'OUT_OF_NAVAL_ZONE' });
  });

  it('une escorte suit son chef de file en formation ; troupes embarquées et bases embarquées suivent leur bâtiment', () => {
    const s = jointState((sc) => {
      zones(sc);
      sc.units.find((u) => u.id === 'b-frig')!.leaderId = 'b-cv';
      sc.units.find((u) => u.id === 'r-aor')!.leaderId = 'r-lst';
    });
    place(s, 'b-frig', destination(s.units['b-cv']!.pos, 0, 4));
    const start = { ...s.units['b-cv']!.pos };
    expect(applyOrder(s, { type: 'MOVE_SHIP', side: 'BLUE', unitId: 'b-cv', dest: destination(start, 90, 60) }).ok).toBe(true);
    expect(applyOrder(s, { type: 'MOVE_SHIP', side: 'RED', unitId: 'r-lst', dest: destination(s.units['r-lst']!.pos, 90, 30) }).ok).toBe(true);
    runJoint(s, SYSTEMS, 60 * MIN);

    const cv = s.units['b-cv']!;
    // Le groupe se règle sur son bâtiment le plus lent, avec une marge : 0,9 × 46 km/h, soit 41,4 km en une heure.
    expect(distanceKm(cv.pos, start)).toBeGreaterThan(40.5);
    expect(distanceKm(cv.pos, start)).toBeLessThan(42);
    const gap = distanceKm(s.units['b-frig']!.pos, cv.pos);
    expect(gap).toBeGreaterThan(1);
    expect(gap).toBeLessThan(s.rules.formationKm + 1.5);
    expect(s.bases['b-deck']!.pos).toEqual(cv.pos);
    expect(s.units['r-inf']!.pos).toEqual(s.units['r-lst']!.pos);
    expect(s.units['r-inf']!.status).toBe('embarked');
    expect(s.bases['r-afloat']!.pos).toEqual(s.units['r-aor']!.pos);
    expect(distanceKm(s.units['r-aor']!.pos, s.units['r-lst']!.pos)).toBeLessThan(s.rules.formationKm + 1.5);

    // Chef de file coulé : l'escorte reprend sa liberté.
    hitShip(s, cv, 4);
    runJoint(s, SYSTEMS, 5);
    expect(naval(s, 'b-frig').leaderId).toBeNull();
  });
});

describe('aviation embarquée', () => {
  it('décolle d’un porte-avions en route et s’y repose', () => {
    const s = jointState((sc) => {
      zones(sc);
      keep(sc, ['b-cv', 'b-rafm-1', 'b-rafm-2']);
    });
    const cv = s.units['b-cv']!;
    applyOrder(s, { type: 'MOVE_SHIP', side: 'BLUE', unitId: 'b-cv', dest: destination(cv.pos, 90, 80) });
    const station = destination(cv.pos, 0, 120);
    expect(applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['b-rafm-1'], waypoints: [station], launchAt: 0 }) }).ok).toBe(true);
    runJoint(s, SYSTEMS, 20 * MIN);
    const jet = s.units['b-rafm-1']!;
    expect(jet.status).toBe('airborne');
    expect(applyOrder(s, { type: 'RTB_UNIT', side: 'BLUE', unitId: 'b-rafm-1' }).ok).toBe(true);
    runJoint(s, SYSTEMS, 20 * MIN);
    expect(jet.status).toBe('turnaround');
    expect(distanceKm(jet.pos, cv.pos)).toBeLessThan(1);
    expect(s.bases['b-deck']!.pos).toEqual(cv.pos);
  });

  it('un porte-avions gravement touché ferme son pont : plus de décollage, les appareils en vol se déroutent', () => {
    const s = jointState(zones);
    const cv = s.units['b-cv']!;
    const flying = s.units['b-rafm-2']!;
    Object.assign(flying, { status: 'airborne', pos: destination(cv.pos, 0, 50), altM: 9000, task: 'rtb', rtbReason: 'order' });

    // Un premier coup : le bâtiment encaisse (quatre points de coque).
    expect(hitShip(s, cv, 1)).toBe('hit');
    expect(cv.damaged).toBe(false);
    expect(s.bases['b-deck']!.closed).toBe(false);
    // Le deuxième le met hors de combat sans le couler.
    expect(hitShip(s, cv, 1)).toBe('damaged');
    expect(cv.damaged).toBe(true);
    expect(cv.status).toBe('active');
    expect(s.bases['b-deck']!.closed).toBe(true);
    expect(s.events.some((e) => e.code === 'BASE_CLOSED' && e.vis.includes('BLUE'))).toBe(true);
    expect(validateOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['b-rafm-1'], waypoints: [destination(cv.pos, 0, 80)] }) })).toMatchObject({
      ok: false,
      code: 'BASE_CLOSED',
    });

    runJoint(s, SYSTEMS, 2);
    expect(flying.baseId).toBe('b-airbase');
    expect(s.events.some((e) => e.code === 'UNIT_DIVERTED' && e.p.unit === 'Rafale Marine 2')).toBe(true);

    // Coulé : les appareils restés à bord sont perdus avec lui.
    expect(hitShip(s, cv, 2)).toBe('sunk');
    expect(cv.status).toBe('destroyed');
    expect(s.units['b-rafm-1']!.status).toBe('destroyed');
    expect(s.stats.BLUE.losses.carrier).toBe(1);
    expect(s.stats.BLUE.losses.fighter).toBe(1);
  });

  it('sans autre terrain, un appareil dont le pont est fermé ne peut pas se poser', () => {
    const s = jointState((sc) => {
      zones(sc);
      keep(sc, ['b-cv', 'b-rafm-1']);
      sc.bases = sc.bases.filter((b) => b.id === 'b-deck');
    });
    const cv = s.units['b-cv']!;
    const jet = s.units['b-rafm-1']!;
    Object.assign(jet, { status: 'airborne', pos: destination(cv.pos, 0, 5), altM: 3000, task: 'rtb', rtbReason: 'order' });
    hitShip(s, cv, 2);
    runJoint(s, SYSTEMS, 5 * MIN);
    expect(jet.status).toBe('airborne');
    expect(jet.baseId).toBe('b-deck');
  });
});

describe('lutte antinavire', () => {
  /** Destroyer rouge et frégate bleue à 100 km l'un de l'autre ; ROUGE tient une piste fraîche sur la frégate. */
  function standoff(): SimState {
    const s = jointState((sc) => keep(sc, ['r-dd', 'b-frig']));
    place(s, 'b-frig', destination(s.units['r-dd']!.pos, 180, 100));
    s.defaultRoe.RED = 'free';
    return s;
  }

  it('un bâtiment tire une salve de missiles antinavires sur une piste de surface identifiée et fraîche, à portée', () => {
    const s = standoff();
    observe(s, 'RED', s.units['b-frig']!, true, 'radar');
    runJoint(s, SYSTEMS, 1);
    expect(fired(s, 'ssm')).toHaveLength(2);
    expect(fired(s, 'ssm').every((e) => e.vis.length === 1 && e.vis[0] === 'RED')).toBe(true);
    expect(naval(s, 'r-dd').ssm).toBe(6);
    expect(s.stats.RED.ssmFired).toBe(2);
    expect(s.shots.filter((x) => x.weapon === 'ssm')).toHaveLength(2);
    // 100 km à 900 km/h : 400 s de vol.
    expect(s.shots[0]!.impactAt - s.shots[0]!.firedAt).toBe(400);

    // Pas de nouvelle salve avant la fin de la cadence, même sur une piste entretenue.
    observe(s, 'RED', s.units['b-frig']!, true, 'radar');
    runJoint(s, SYSTEMS, 20);
    expect(fired(s, 'ssm')).toHaveLength(2);
  });

  it('à l’impact, la cible se défend tant que son radar veille ; chaque coup lui retire un point de coque', () => {
    const s = standoff();
    const frigate = s.units['b-frig']!;
    observe(s, 'RED', frigate, true, 'radar');
    runJoint(s, SYSTEMS, 405);
    const shots = resolved(s, 'ssm');
    expect(shots).toHaveLength(2);
    // Première arrivée : la frégate intacte se défend — 0,6 × 0,6. Ensuite, selon qu'elle a été touchée ou non.
    expect(shots[0]!.p.pk).toBe(0.36);
    expect([0.36, 0.6]).toContain(shots[1]!.p.pk);
    const hits = shots.filter((e) => e.p.result !== 'miss').length;
    expect(naval(s, 'b-frig').hull).toBe(Math.max(0, 2 - hits));
    expect(frigate.damaged || frigate.status === 'destroyed').toBe(hits >= 1);
    expect(frigate.status === 'destroyed').toBe(hits >= 2);
    expect(s.stats.BLUE.losses.ship).toBe(hits >= 2 ? 1 : 0);
    // Elle a tiré un missile sol-air par assaillant engagé.
    const defended = shots.filter((e) => e.p.pk === 0.36).length;
    expect(frigate.weapons).toBe(16 - defended);
    expect(s.stats.RED.hits).toBe(hits);
  });

  it('ne tire ni sur une piste ancienne ou non identifiée, ni hors de portée, ni sous règles d’engagement restrictives, ni hors de combat', () => {
    const none = (prepare: (s: SimState) => void) => {
      const s = standoff();
      prepare(s);
      runJoint(s, SYSTEMS, 5);
      return fired(s, 'ssm').length;
    };
    const track = (s: SimState, identify = true) => observe(s, 'RED', s.units['b-frig']!, identify, 'radar');
    expect(none(() => undefined)).toBe(0);
    expect(none((s) => (track(s).stale = true))).toBe(0);
    expect(none((s) => track(s, false))).toBe(0);
    expect(none((s) => {
      place(s, 'b-frig', destination(s.units['r-dd']!.pos, 180, 200));
      track(s);
    })).toBe(0);
    expect(none((s) => {
      s.defaultRoe.RED = 'hold';
      track(s);
    })).toBe(0);
    expect(none((s) => {
      s.units['r-dd']!.damaged = true;
      track(s);
    })).toBe(0);
    // Règles défensives : la piste est loin de tout moyen ami, on ne tire pas ; si elle a ouvert le feu, on riposte.
    expect(none((s) => {
      s.defaultRoe.RED = 'defensive';
      track(s);
    })).toBe(0);
    expect(none((s) => {
      s.defaultRoe.RED = 'hold';
      track(s).hostileAct = true;
    })).toBe(2);
  });

  it('un bâtiment sans défense propre est couvert par une escorte proche', () => {
    const run = (escorted: boolean) => {
      const s = jointState((sc) => keep(sc, escorted ? ['b-frig', 'r-aor', 'r-dd'] : ['b-frig', 'r-aor']));
      const aor = s.units['r-aor']!;
      place(s, 'b-frig', destination(aor.pos, 180, 80));
      if (escorted) place(s, 'r-dd', destination(aor.pos, 0, 10));
      s.defaultRoe.BLUE = 'free';
      observe(s, 'BLUE', aor, true, 'radar');
      runJoint(s, SYSTEMS, 330);
      return s;
    };
    const alone = run(false);
    expect(resolved(alone, 'ssm').map((e) => e.p.pk)).toEqual([0.6, 0.6]);
    const covered = run(true);
    expect(resolved(covered, 'ssm').map((e) => e.p.pk)).toEqual([0.36, 0.36]);
    expect(covered.units['r-dd']!.weapons).toBe(32 - 2);
  });

  it('un bâtiment coulé emporte ses troupes ; son dépôt flottant ferme', () => {
    const s = jointState();
    expect(hitShip(s, s.units['r-lst']!, 2)).toBe('sunk');
    expect(s.units['r-inf']!.status).toBe('destroyed');
    expect(s.stats.RED.losses.amphib).toBe(1);
    expect(s.stats.RED.losses.infantry).toBe(1);
    expect(hitShip(s, s.units['r-aor']!, 2)).toBe('sunk');
    expect(s.bases['r-afloat']!.closed).toBe(true);
  });
});

describe('sous-marins', () => {
  it('un radar ne voit jamais un sous-marin ; un sonar l’entend s’il fait du bruit, pas s’il est immobile', () => {
    const s = jointState((sc) => {
      zones(sc);
      keep(sc, ['b-frig', 'r-sub']);
    });
    const sub = s.units['r-sub']!;
    // Immobile à 20 km : portée du sonar de la frégate 25 km × 0,6 = 15 km.
    place(s, 'r-sub', destination(s.units['b-frig']!.pos, 0, 20));
    runJoint(s, SYSTEMS, 5 * MIN);
    expect(Object.values(s.contacts.BLUE)).toHaveLength(0);

    // En route à 22 km/h : 25 km × 1,5.
    applyOrder(s, { type: 'MOVE_SHIP', side: 'RED', unitId: 'r-sub', dest: destination(sub.pos, 90, 30) });
    runJoint(s, SYSTEMS, 3 * MIN);
    const tracks = Object.values(s.contacts.BLUE);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ unitId: 'r-sub', kind: 'sub', identified: true, source: 'sonar' });
  });

  it('un sous-marin entend les bâtiments de surface et les torpille à courte distance', () => {
    const s = jointState((sc) => keep(sc, ['b-frig', 'r-sub']));
    s.defaultRoe.RED = 'free';
    place(s, 'r-sub', destination(s.units['b-frig']!.pos, 0, 12));
    runJoint(s, [...SYSTEMS], 2 * MIN);
    expect(Object.values(s.contacts.RED).map((c) => [c.unitId, c.source])).toEqual([['b-frig', 'sonar']]);
    expect(fired(s, 'torpedo')).toHaveLength(2);
    expect(naval(s, 'r-sub').torpedoes).toBe(4);
    expect(s.stats.RED.torpedoesFired).toBe(2);
    expect(naval(s, 'r-sub').datumUntil).toBeGreaterThan(s.time);

    // 12 km à 80 km/h : neuf minutes. Une torpille au but retire deux points de coque : la frégate coule.
    runJoint(s, SYSTEMS, 10 * MIN);
    const shots = resolved(s, 'torpedo');
    expect(shots).toHaveLength(2);
    expect(shots.every((e) => e.p.pk === 0.5 || e.p.result === 'lost')).toBe(true);
    const hits = shots.filter((e) => e.p.result === 'sunk' || e.p.result === 'damaged' || e.p.result === 'hit').length;
    expect(s.units['b-frig']!.status === 'destroyed').toBe(hits >= 1);
  });

  it('un bâtiment de lutte anti-sous-marine attaque le sous-marin qu’il tient au sonar', () => {
    const s = jointState((sc) => {
      zones(sc);
      keep(sc, ['b-frig', 'r-sub']);
    });
    const sub = s.units['r-sub']!;
    place(s, 'r-sub', destination(s.units['b-frig']!.pos, 0, 14));
    applyOrder(s, { type: 'MOVE_SHIP', side: 'RED', unitId: 'r-sub', dest: destination(sub.pos, 90, 40) });
    runJoint(s, SYSTEMS, 30 * MIN);
    expect(fired(s, 'asw').length).toBeGreaterThanOrEqual(1);
    const shots = resolved(s, 'asw');
    expect(shots.length).toBeGreaterThanOrEqual(1);
    expect(shots.every((e) => e.p.pk === 0.35 || e.p.result === 'lost')).toBe(true);
    const killed = shots.some((e) => e.p.result === 'sunk');
    expect(sub.status === 'destroyed').toBe(killed);
    expect(s.stats.RED.losses.sub).toBe(killed ? 1 : 0);
  });
});

describe('opérations amphibies', () => {
  /** Navire amphibie rouge à 5 km d'une plage de la côte est. */
  function offshore(): { s: SimState; beach: LatLon } {
    const s = jointState((sc) => keep(sc, ['r-lst', 'r-inf', 'r-dd']));
    const beach = firstLandToward(SEA.redAmphib, OBJ)!;
    const inland = destination(beach, 270, 1.5);
    expect(isLand(inland)).toBe(true);
    const ship = destination(beach, 90, 5);
    expect(isLand(ship)).toBe(false);
    place(s, 'r-lst', ship);
    place(s, 'r-inf', ship);
    return { s, beach: inland };
  }
  const landOrder = (beach: LatLon, over: Partial<{ shipId: string; unitId: string }> = {}) =>
    ({ type: 'LAND_TROOPS', side: 'RED', shipId: 'r-lst', unitId: 'r-inf', beach, ...over }) as const;

  it('refuse un débarquement impossible', () => {
    const { s, beach } = offshore();
    expect(validateNavalOrder(s, landOrder(beach))).toEqual({ ok: true });
    expect(validateNavalOrder(s, landOrder(beach, { shipId: 'r-dd' }))).toMatchObject({ ok: false, code: 'NOT_A_TRANSPORT' });
    expect(validateNavalOrder(s, landOrder(beach, { unitId: 'r-dd' }))).toMatchObject({ ok: false, code: 'NOT_ABOARD' });
    expect(validateNavalOrder(s, landOrder(s.units['r-lst']!.pos))).toMatchObject({ ok: false, code: 'NOT_ON_LAND' });
    expect(validateNavalOrder(s, landOrder(destination(beach, 270, 30)))).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    expect(validateNavalOrder(s, { ...landOrder(beach), side: 'BLUE' })).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    s.units['r-lst']!.damaged = true;
    expect(validateNavalOrder(s, landOrder(beach))).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });
  });

  it('met la troupe à terre après le délai de débarquement, désorganisée, prête à recevoir des ordres', () => {
    const { s, beach } = offshore();
    expect(applyNavalOrder(s, landOrder(beach))).toEqual({ ok: true });
    expect(s.events.some((e) => e.code === 'TROOPS_LANDING' && e.vis[0] === 'RED')).toBe(true);
    // Un seul débarquement à la fois.
    expect(validateNavalOrder(s, landOrder(beach))).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });
    const systems = [...SYSTEMS, landSystem];
    runJoint(s, systems, s.rules.landingS - 5);
    expect(s.units['r-inf']!.status).toBe('embarked');
    runJoint(s, systems, 10);
    const inf = s.units['r-inf']!;
    expect(inf.status).toBe('active');
    expect(inf.pos).toEqual(beach);
    // Désorganisée par la mise à terre (elle commence aussitôt à se remettre en ordre).
    expect(inf.land!.cohesion).toBeGreaterThanOrEqual(s.rules.landedCohesion);
    expect(inf.land!.cohesion).toBeLessThan(s.rules.landedCohesion + 0.02);
    expect(inf.land!.posture).toBe('hold');
    expect(naval(s, 'r-lst').troops).toEqual([]);
    expect(naval(s, 'r-lst').landing).toBeNull();
    expect(s.events.some((e) => e.code === 'TROOPS_LANDED' && e.p.unit === '3e d’infanterie')).toBe(true);
  });

  it('un bâtiment mis hors de combat pendant l’opération ne débarque personne', () => {
    const { s, beach } = offshore();
    applyNavalOrder(s, landOrder(beach));
    runJoint(s, SYSTEMS, 5 * MIN);
    hitShip(s, s.units['r-lst']!, 1);
    runJoint(s, SYSTEMS, s.rules.landingS);
    expect(s.units['r-inf']!.status).toBe('embarked');
    expect(naval(s, 'r-lst').landing).toBeNull();
  });
});

describe('recomplètement', () => {
  it('un navire logistique recomplète à la mer les bâtiments amis tout proches, sur le stock de son dépôt', () => {
    const s = jointState((sc) => keep(sc, ['r-aor', 'r-dd']));
    place(s, 'r-dd', destination(s.units['r-aor']!.pos, 0, 2));
    const dd = s.units['r-dd']!;
    dd.weapons = 29;
    naval(s, 'r-dd').ssm = 6;
    runJoint(s, SYSTEMS, 3 * MIN);
    // D'abord les missiles sol-air : un par minute, deux points chacun.
    expect(dd.weapons).toBe(32);
    expect(s.bases['r-afloat']!.supplyStock).toBe(400 - 6);
    runJoint(s, SYSTEMS, 2 * MIN);
    // Puis les missiles antinavires : cinq points chacun.
    expect(naval(s, 'r-dd').ssm).toBe(8);
    expect(s.bases['r-afloat']!.supplyStock).toBe(400 - 6 - 10);
    runJoint(s, SYSTEMS, 5 * MIN);
    expect(s.bases['r-afloat']!.supplyStock).toBe(400 - 16);

    // Trop loin : rien.
    place(s, 'r-dd', destination(s.units['r-aor']!.pos, 0, 10));
    dd.weapons = 20;
    runJoint(s, SYSTEMS, 3 * MIN);
    expect(dd.weapons).toBe(20);
  });

  it('une unité logistique à terre se recomplète au dépôt flottant d’un navire mouillé près de la côte', () => {
    const s = jointState((sc) => keep(sc, ['r-aor', 'r-log']));
    const beach = firstLandToward(SEA.redSupply, OBJ)!;
    place(s, 'r-aor', destination(beach, 90, 4));
    place(s, 'r-log', destination(beach, 270, 2));
    s.units['r-log']!.land!.supplyPoint = { ...s.units['r-log']!.pos };
    s.units['r-log']!.land!.cargo = 50;
    s.bases['r-depot']!.supplyStock = 0;
    runJoint(s, [...SYSTEMS, landSystem], 3 * MIN);
    expect(s.units['r-log']!.land!.cargo).toBe(80);
    expect(s.bases['r-afloat']!.supplyStock).toBe(370);
  });
});

describe('contrôles de cohérence navals', () => {
  it('relèvent une coque ou un armement impossibles', () => {
    const s = jointState();
    s.objective.sec.BLUE = s.time;
    expect(checkInvariants(s, null)).toEqual([]);
    naval(s, 'b-frig').hull = 5;
    naval(s, 'r-dd').ssm = 99;
    naval(s, 'r-sub').torpedoes = -1;
    const errors = checkInvariants(s, null).join('\n');
    expect(errors).toMatch(/b-frig.*coque/);
    expect(errors).toMatch(/r-dd.*antinavires/);
    expect(errors).toMatch(/r-sub.*torpilles/);
  });
});
