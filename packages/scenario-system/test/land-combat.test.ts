import { describe, expect, it } from 'vitest';
import { checkInvariants, destination, distanceKm, stepState, type LatLon, type SimState } from '@warcommand/simulation-core';
import { combatPower, landSystem, validateLandOrder } from '@warcommand/land-operations';
import { objectiveSystem } from '../src/index';
import { east, jointState, keep, OBJ, runJoint, west } from './joint-helpers';

const place = (s: SimState, id: string, pos: LatLon) => {
  s.units[id]!.pos = { ...pos };
};
const land = (s: SimState, id: string) => s.units[id]!.land!;
const MIN = 60;

/** Duel : un mécanisé rouge au contact d'un mécanisé bleu qui défend la localité, chacun commandé par son PC. */
function duel(extra: string[] = [], seed = 11): SimState {
  const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'r-hq', 'r-mech', ...extra]), seed);
  place(s, 'r-hq', east(40));
  place(s, 'r-mech', east(3));
  land(s, 'r-mech').posture = 'attack';
  land(s, 'b-mech').posture = 'defend';
  return s;
}

describe('puissance de combat', () => {
  it('se calcule à partir des effectifs, de la cohésion, du moral, de la fatigue, du ravitaillement et du commandement', () => {
    const s = jointState();
    const mech = s.units['b-mech']!;
    // 1,6 × effectifs 1 × cohésion (0,4 + 0,6) × moral (0,5 + 0,5 × 0,8) = 1,44.
    expect(combatPower(s, mech)).toBeCloseTo(1.44, 6);

    Object.assign(mech.land!, { strength: 0.5, cohesion: 0.5, morale: 0.4, fatigue: 0.5, supply: 0.1 });
    s.units['b-hq']!.status = 'destroyed';
    // 1,6 × 0,5 × 0,7 × 0,7 × 0,8 × (0,4 + 2,4 × 0,1) × 0,8 (hors commandement).
    expect(combatPower(s, mech)).toBeCloseTo(0.1605632, 6);

    // Une unité rompue ne vaut plus que trois dixièmes d'elle-même.
    const armor = s.units['r-arm']!;
    const whole = combatPower(s, armor);
    armor.land!.broken = true;
    expect(combatPower(s, armor)).toBeCloseTo(whole * 0.3, 6);
  });
});

describe('engagement terrestre', () => {
  it('au contact, chaque camp subit des pertes proportionnelles à la puissance adverse ; le défenseur abrité en subit moins', () => {
    const s = duel();
    runJoint(s, [landSystem], MIN);
    expect(land(s, 'b-mech').inContact).toBe(true);
    expect(land(s, 'r-mech').inContact).toBe(true);
    // Défenseur en localité : 0,006 × 1,44 / (1,6 × 1,5) = 0,0036, à ± 25 % d'aléa.
    const blueLoss = 1 - land(s, 'b-mech').strength;
    expect(blueLoss).toBeGreaterThanOrEqual(0.0036 * 0.75 - 1e-9);
    expect(blueLoss).toBeLessThanOrEqual(0.0036 * 1.25 + 1e-9);
    // Attaquant à découvert : 0,006 × 1,44 / 1,6 = 0,0054, à ± 25 %.
    const redLoss = 1 - land(s, 'r-mech').strength;
    expect(redLoss).toBeGreaterThanOrEqual(0.0054 * 0.75 - 1e-9);
    expect(redLoss).toBeLessThanOrEqual(0.0054 * 1.25 + 1e-9);
    // Les pertes entament le moral et la cohésion, et sont comptées.
    expect(land(s, 'r-mech').morale).toBeCloseTo(0.8 - 1.5 * redLoss, 6);
    expect(land(s, 'r-mech').cohesion).toBeLessThan(1);
    expect(s.stats.RED.landStrengthLost).toBeCloseTo(redLoss, 9);
    expect(s.stats.BLUE.landStrengthLost).toBeCloseTo(blueLoss, 9);
  });

  it('signale l’entrée au contact et la demande d’appui aérien, à chaque camp pour ses seules unités', () => {
    const s = duel();
    runJoint(s, [landSystem], MIN);
    const seen = (code: string, side: 'BLUE' | 'RED', unit: string) =>
      s.events.some((e) => e.code === code && e.vis.length === 1 && e.vis[0] === side && e.p.unit === unit);
    expect(seen('LAND_IN_CONTACT', 'BLUE', '1er mécanisé')).toBe(true);
    expect(seen('LAND_IN_CONTACT', 'RED', '2e mécanisé')).toBe(true);
    expect(seen('CAS_REQUEST', 'BLUE', '1er mécanisé')).toBe(true);
    expect(land(s, 'b-mech').casSince).toBe(MIN);
    // Le contact rompu, la demande d'appui tombe.
    place(s, 'r-mech', east(30));
    runJoint(s, [landSystem], MIN);
    expect(land(s, 'b-mech').inContact).toBe(false);
    expect(land(s, 'b-mech').casSince).toBe(-1);
  });

  it('sur la durée, à forces égales, l’attaquant s’use plus vite que le défenseur retranché', () => {
    const s = duel();
    runJoint(s, [landSystem], 40 * MIN);
    const blueLoss = 1 - land(s, 'b-mech').strength;
    const redLoss = 1 - land(s, 'r-mech').strength;
    expect(redLoss).toBeGreaterThan(blueLoss * 1.5);
    expect(land(s, 'b-mech').dugIn).toBeGreaterThan(0.3);
  });

  it('l’artillerie à portée appuie l’unité au contact : l’adversaire perd davantage', () => {
    const without = duel();
    runJoint(without, [landSystem], 20 * MIN);
    const withArtillery = duel(['b-art']);
    runJoint(withArtillery, [landSystem], 20 * MIN);
    expect(1 - land(withArtillery, 'r-mech').strength).toBeGreaterThan((1 - land(without, 'r-mech').strength) * 1.5);
    // L'artillerie tire : elle consomme plus que si elle était restée inactive.
    expect(land(withArtillery, 'b-art').supply).toBeLessThan(1 - 20 * 0.0005 - 0.05);

    // Hors de portée (30 km), elle n'apporte rien.
    const tooFar = duel(['b-art']);
    place(tooFar, 'b-art', west(40));
    runJoint(tooFar, [landSystem], 20 * MIN);
    expect(land(tooFar, 'r-mech').strength).toBeCloseTo(land(without, 'r-mech').strength, 9);
  });

  it('une unité dont le moral cède décroche vers son poste de commandement, puis se reconstitue hors du contact', () => {
    const s = duel();
    land(s, 'b-mech').morale = 0.26;
    const before = distanceKm(s.units['b-mech']!.pos, s.units['r-mech']!.pos);
    runJoint(s, [landSystem], 5 * MIN);
    expect(land(s, 'b-mech').broken).toBe(true);
    expect(land(s, 'b-mech').posture).toBe('withdraw');
    expect(s.events.some((e) => e.code === 'LAND_BROKEN' && e.vis[0] === 'BLUE' && e.p.unit === '1er mécanisé')).toBe(true);
    // Rompue, elle ne peut plus recevoir l'ordre d'attaquer.
    expect(validateLandOrder(s, { type: 'LAND_ORDER', side: 'BLUE', unitId: 'b-mech', posture: 'attack', route: [east(1)] })).toMatchObject({ ok: false, code: 'UNIT_BROKEN' });
    runJoint(s, [landSystem], 15 * MIN);
    expect(distanceKm(s.units['b-mech']!.pos, s.units['r-mech']!.pos)).toBeGreaterThan(before + 3);
    expect(distanceKm(s.units['b-mech']!.pos, s.units['b-hq']!.pos)).toBeLessThan(40);

    // Hors du contact, moral et cohésion revenus : l'unité se reconstitue.
    Object.assign(land(s, 'b-mech'), { morale: 0.6, cohesion: 0.9 });
    runJoint(s, [landSystem], MIN);
    expect(land(s, 'b-mech').broken).toBe(false);
    expect(s.events.some((e) => e.code === 'LAND_RALLIED' && e.p.unit === '1er mécanisé')).toBe(true);
  });

  it('une formation réduite sous le seuil est hors de combat : perte comptée, plus aucun combat', () => {
    const s = duel();
    land(s, 'b-mech').strength = 0.201;
    runJoint(s, [landSystem], 2 * MIN);
    expect(s.units['b-mech']!.status).toBe('destroyed');
    expect(s.stats.BLUE.losses.mech).toBe(1);
    expect(s.events.some((e) => e.code === 'UNIT_DESTROYED' && e.vis.includes('BLUE') && e.p.unit === '1er mécanisé')).toBe(true);
    const redAfter = land(s, 'r-mech').strength;
    runJoint(s, [landSystem], 5 * MIN);
    expect(land(s, 'r-mech').strength).toBe(redAfter);
    expect(land(s, 'r-mech').inContact).toBe(false);
  });
});

describe('retranchement et fatigue', () => {
  it('une unité qui défend sur place se retranche ; le génie double la cadence ; tout mouvement l’annule', () => {
    const alone = jointState((sc) => keep(sc, ['b-hq', 'b-mech']));
    land(alone, 'b-mech').posture = 'defend';
    runJoint(alone, [landSystem], 30 * MIN);
    expect(land(alone, 'b-mech').dugIn).toBeCloseTo(0.3, 6);

    const helped = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'b-eng']));
    land(helped, 'b-mech').posture = 'defend';
    runJoint(helped, [landSystem], 30 * MIN);
    expect(land(helped, 'b-mech').dugIn).toBeCloseTo(0.6, 6);

    // En simple attente (« tenir »), l'unité se repose mais ne se retranche pas.
    const resting = jointState((sc) => keep(sc, ['b-hq', 'b-mech']));
    runJoint(resting, [landSystem], 30 * MIN);
    expect(land(resting, 'b-mech').dugIn).toBe(0);

    land(helped, 'b-mech').pending = { at: helped.time + 1, posture: 'move', route: [west(5)] };
    runJoint(helped, [landSystem], 2 * MIN);
    expect(land(helped, 'b-mech').dugIn).toBe(0);
  });

  it('la fatigue monte en mouvement et retombe au repos, deux fois plus vite en attente qu’en défense', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-rec']));
    land(s, 'b-rec').pending = { at: 1, posture: 'move', route: [east(40)] };
    runJoint(s, [landSystem], 30 * MIN);
    expect(land(s, 'b-rec').fatigue).toBeCloseTo(30 * 0.002, 6);
    land(s, 'b-rec').pending = { at: s.time + 1, posture: 'defend', route: [] };
    runJoint(s, [landSystem], 10 * MIN);
    expect(land(s, 'b-rec').fatigue).toBeCloseTo(0.06 - 10 * 0.004, 6);
    land(s, 'b-rec').fatigue = 0.5;
    land(s, 'b-rec').pending = { at: s.time + 1, posture: 'hold', route: [] };
    runJoint(s, [landSystem], 10 * MIN);
    expect(land(s, 'b-rec').fatigue).toBeCloseTo(0.5 - 10 * 0.008, 6);
  });
});

describe('logistique terrestre', () => {
  it('une unité consomme son ravitaillement : peu au repos, beaucoup au contact, et le signale quand il devient bas', () => {
    const idle = jointState((sc) => keep(sc, ['b-hq', 'b-mech']));
    runJoint(idle, [landSystem], 60 * MIN);
    expect(land(idle, 'b-mech').supply).toBeCloseTo(1 - 60 * 0.0005, 6);

    const fighting = duel();
    runJoint(fighting, [landSystem], 10 * MIN);
    expect(land(fighting, 'b-mech').supply).toBeCloseTo(1 - 10 * 0.006, 6);

    land(fighting, 'b-mech').supply = 0.253;
    runJoint(fighting, [landSystem], 3 * MIN);
    expect(fighting.events.filter((e) => e.code === 'SUPPLY_LOW' && e.p.unit === '1er mécanisé')).toHaveLength(1);
    // Jamais négatif.
    land(fighting, 'b-mech').supply = 0.004;
    runJoint(fighting, [landSystem], 3 * MIN);
    expect(land(fighting, 'b-mech').supply).toBe(0);
  });

  it('à court de ravitaillement, une unité avance deux fois moins vite', () => {
    const run = (supply: number): number => {
      const s = jointState((sc) => keep(sc, ['b-hq', 'b-rec']));
      const rec = s.units['b-rec']!;
      const start = { ...rec.pos };
      rec.land!.supply = supply;
      rec.land!.pending = { at: 1, posture: 'move', route: [east(40)] };
      runJoint(s, [landSystem], 4 * MIN);
      return distanceKm(rec.pos, start);
    };
    expect(run(0)).toBeCloseTo(run(1) / 2, 1);
  });

  it('une unité logistique ravitaille les formations amies à sa portée, jusqu’à épuisement de son chargement', () => {
    const s = jointState((sc) => keep(sc, ['b-inf', 'b-log']));
    const log = s.units['b-log']!;
    place(s, 'b-inf', destination(log.pos, 90, 10));
    land(s, 'b-inf').supply = 0.5;
    runJoint(s, [landSystem], 10 * MIN);
    // Chaque minute : 0,0005 consommé, 0,02 reçu ; deux points de chargement par minute.
    expect(land(s, 'b-inf').supply).toBeCloseTo(0.5 + 10 * (0.02 - 0.0005), 6);
    expect(land(s, 'b-log').cargo).toBeCloseTo(120 - 10 * 2, 6);

    // Chargement épuisé : plus rien n'est distribué.
    land(s, 'b-log').cargo = 1;
    land(s, 'b-log').supplyPoint = null;
    const before = land(s, 'b-inf').supply;
    runJoint(s, [landSystem], 3 * MIN);
    expect(land(s, 'b-log').cargo).toBe(0);
    expect(land(s, 'b-inf').supply).toBeCloseTo(before + 0.01 - 3 * 0.0005, 6);

    // Hors de portée (15 km) : rien.
    const far = jointState((sc) => keep(sc, ['b-inf', 'b-log']));
    place(far, 'b-inf', destination(far.units['b-log']!.pos, 90, 20));
    land(far, 'b-inf').supply = 0.5;
    runJoint(far, [landSystem], 5 * MIN);
    expect(land(far, 'b-inf').supply).toBeCloseTo(0.5 - 5 * 0.0005, 6);
    expect(land(far, 'b-log').cargo).toBe(120);
  });

  it('une unité logistique se recomplète à un dépôt ami à sa portée, sans jamais le vider au-delà de son stock', () => {
    const s = jointState((sc) => keep(sc, ['b-log']));
    const depot = s.bases['b-depot']!;
    place(s, 'b-log', destination(depot.pos, 90, 5));
    land(s, 'b-log').supplyPoint = { ...s.units['b-log']!.pos };
    land(s, 'b-log').cargo = 20;
    runJoint(s, [landSystem], 5 * MIN);
    expect(land(s, 'b-log').cargo).toBe(70);
    expect(depot.supplyStock).toBe(550);
    runJoint(s, [landSystem], 10 * MIN);
    expect(land(s, 'b-log').cargo).toBe(120);
    expect(depot.supplyStock).toBe(500);

    // Dépôt presque vide : on ne prend que ce qu'il reste.
    land(s, 'b-log').cargo = 0;
    depot.supplyStock = 4;
    runJoint(s, [landSystem], 3 * MIN);
    expect(land(s, 'b-log').cargo).toBe(4);
    expect(depot.supplyStock).toBe(0);
    // Un dépôt adverse ne sert à rien.
    place(s, 'b-log', destination(s.bases['r-depot']!.pos, 270, 5));
    runJoint(s, [landSystem], 3 * MIN);
    expect(s.bases['r-depot']!.supplyStock).toBe(600);
  });

  it('une unité logistique vide fait d’elle-même la navette : dépôt, recomplètement, retour à son point de distribution', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-log']));
    const log = s.units['b-log']!;
    const point = { ...log.pos };
    log.land!.cargo = 0;
    runJoint(s, [landSystem], 30 * MIN);
    // À 30 km/h, elle a parcouru l'essentiel des 20 km qui la séparent du dépôt et a commencé à se recompléter.
    expect(distanceKm(log.pos, s.bases['b-depot']!.pos)).toBeLessThan(s.rules.depotKm);
    expect(log.land!.cargo).toBeGreaterThan(0);
    runJoint(s, [landSystem], 70 * MIN);
    expect(distanceKm(log.pos, point)).toBeLessThan(0.1);
    expect(log.land!.cargo).toBeGreaterThan(110);
    expect(log.land!.posture).toBe('hold');
  });
});

describe('objectif terrestre', () => {
  /** Un pas du seul système d'objectif, invariants contrôlés (dont le décompte de contrôle). */
  const tick = (s: SimState) => {
    stepState(s, [objectiveSystem]);
    expect(checkInvariants(s, null)).toEqual([]);
  };
  const control = (s: SimState) => {
    tick(s);
    return s.objective.status;
  };

  it('se tient avec des formations de mêlée : la présence adverse le conteste, puis le prend', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'b-art', 'r-arm']));
    expect(control(s)).toBe('BLUE');
    place(s, 'r-arm', east(5));
    expect(control(s)).toBe('CONTESTED');
    // Le défenseur rompu ne tient plus rien.
    land(s, 'b-mech').broken = true;
    expect(control(s)).toBe('RED');
    land(s, 'b-mech').broken = false;
    s.units['b-mech']!.status = 'destroyed';
    expect(control(s)).toBe('RED');
    // Zone vide : elle reste au dernier détenteur.
    place(s, 'r-arm', east(40));
    expect(control(s)).toBe('RED');
  });

  it('revient au camp nettement le plus fort : un adversaire très affaibli dans la zone ne suffit plus à la contester', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'b-inf', 'b-eng', 'r-hq', 'r-mech']));
    place(s, 'r-hq', east(40));
    place(s, 'r-mech', east(3));
    // Trois formations bleues contre un mécanisé rouge intact : 2,79 contre 1,44, plus d'une fois et demie.
    expect(control(s)).toBe('BLUE');
    // Deux mécanisés face à face : contesté.
    s.units['b-inf']!.status = 'destroyed';
    s.units['b-eng']!.status = 'destroyed';
    expect(control(s)).toBe('CONTESTED');
    // Le mécanisé rouge, saigné : BLEU reprend la main sans l'avoir chassé.
    land(s, 'r-mech').strength = 0.5;
    expect(control(s)).toBe('BLUE');
    // Et l'inverse : le défenseur saigné, l'attaquant intact.
    land(s, 'r-mech').strength = 1;
    land(s, 'b-mech').strength = 0.5;
    expect(control(s)).toBe('RED');
    expect(s.rules.groundControlRatio).toBe(1.5);
  });

  it('ni l’artillerie, ni un poste de commandement, ni des chasseurs en vol ne tiennent une zone terrestre', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'r-art', 'r-hq', 'r-su-1']));
    place(s, 'b-mech', west(30));
    place(s, 'r-art', east(2));
    place(s, 'r-hq', east(3));
    const jet = s.units['r-su-1']!;
    Object.assign(jet, { status: 'airborne', pos: { ...OBJ }, altM: 9000 });
    expect(control(s)).toBe('BLUE');
    place(s, 'b-mech', OBJ);
    expect(control(s)).toBe('BLUE');
  });

  it('chaque camp estime le contrôle d’après ses propres pistes terrestres', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'r-arm']));
    place(s, 'b-mech', west(30));
    place(s, 'r-arm', east(5));
    // ROUGE tient réellement la zone ; BLEU, sans piste, la croit encore sienne.
    tick(s);
    expect(s.objective.status).toBe('RED');
    expect(s.objective.perceived.BLUE.status).toBe('BLUE');
    expect(s.objective.perceived.RED.status).toBe('RED');
    // Une piste identifiée sur le blindé, dans la zone : BLEU sait.
    s.contacts.BLUE['R01'] = {
      id: 'R01', unitId: 'r-arm', domain: 'ground', pos: { ...s.units['r-arm']!.pos }, altM: 0, headingDeg: 0, speedKmh: 0,
      firstSeen: 0, lastSeen: s.time, idProgress: 1, identified: true, kind: 'armor', label: 'Bataillon blindé', stale: false,
      hostileAct: false, damaged: false, radarSeenAt: -1e9, source: 'ground', fixed: false,
    };
    tick(s);
    expect(s.objective.perceived.BLUE.status).toBe('RED');
    // Revenu dans la zone, le mécanisé bleu fait face à un blindé dont il ignore l'état : il l'estime à sa valeur nominale.
    place(s, 'b-mech', OBJ);
    s.units['r-arm']!.land!.strength = 0.3;
    tick(s);
    expect(s.objective.status).toBe('BLUE');
    expect(s.objective.perceived.BLUE.status).not.toBe('BLUE');
  });
});

describe('estimation du contrôle : mémoire des pistes terrestres', () => {
  const track = (s: ReturnType<typeof jointState>, lastSeen: number) => {
    s.contacts.BLUE['R01'] = {
      id: 'R01', unitId: 'r-arm', domain: 'ground', pos: { ...s.units['r-arm']!.pos }, altM: 0, headingDeg: 0, speedKmh: 0,
      firstSeen: 0, lastSeen, idProgress: 1, identified: true, kind: 'armor', label: 'Bataillon blindé', stale: true,
      hostileAct: false, damaged: false, radarSeenAt: -1e9, source: 'ground', fixed: false,
    };
  };

  it('une formation vue dans la zone il y a quelques minutes y est encore présumée, même perdue de vue', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'r-arm']));
    place(s, 'b-mech', west(30));
    place(s, 'r-arm', east(5));
    s.time = 3000;
    track(s, s.time - 300);
    objectiveSystem(s);
    expect(s.objective.perceived.BLUE.status).toBe('RED');
  });

  it('au-delà de la mémoire des pistes terrestres, elle ne compte plus', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-mech', 'r-arm']));
    place(s, 'b-mech', west(30));
    place(s, 'r-arm', east(5));
    s.time = 3000;
    track(s, s.time - s.rules.groundTrackMemoryS - 1);
    objectiveSystem(s);
    expect(s.objective.perceived.BLUE.status).toBe('BLUE');
    expect(s.rules.groundTrackMemoryS).toBe(600);
  });
});

describe('contrôles de cohérence terrestres', () => {
  it('relèvent un état terrestre impossible', () => {
    const s = jointState();
    s.objective.sec.BLUE = s.time;
    expect(checkInvariants(s, null)).toEqual([]);
    land(s, 'b-mech').strength = 1.2;
    land(s, 'b-inf').supply = -0.1;
    land(s, 'b-log').cargo = 500;
    s.bases['b-depot']!.supplyStock = -1;
    const errors = checkInvariants(s, null).join('\n');
    expect(errors).toMatch(/b-mech.*effectifs/);
    expect(errors).toMatch(/b-inf.*ravitaillement/);
    expect(errors).toMatch(/b-log.*chargement/);
    expect(errors).toMatch(/b-depot.*ravitaillement/);
  });

  it('une formation terrestre ne se téléporte pas, mais une troupe embarquée suit son bâtiment', () => {
    const s = jointState();
    s.objective.sec.BLUE = s.time;
    const before = Object.fromEntries(Object.values(s.units).map((u) => [u.id, { pos: { ...u.pos }, status: u.status }]));
    place(s, 'b-mech', east(2));
    place(s, 'r-inf', destination(s.units['r-inf']!.pos, 90, 5));
    const errors = checkInvariants(s, before).join('\n');
    expect(errors).toMatch(/b-mech.*téléportation/);
    expect(errors).not.toMatch(/r-inf/);
  });
});
