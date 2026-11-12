import { describe, expect, it } from 'vitest';
import { isLand } from '@warcommand/simulation-core';
import { BOUCLIER_ATLANTIQUE, BRECHE_BOREALE, parseScenario, type ScenarioInput } from '../src/index';
import { jointInput, jointState, SEA } from './joint-helpers';

function errorsOf(mutate: (sc: ScenarioInput) => void): string[] {
  const input = jointInput();
  mutate(input);
  const parsed = parseScenario(input);
  return parsed.ok ? [] : parsed.errors;
}

const unit = (sc: ScenarioInput, id: string) => sc.units.find((u) => u.id === id)!;

describe('format de scénario interarmées', () => {
  it('le scénario d’essai est valide, et ses formations terrestres sont bien à terre', () => {
    const input = jointInput();
    const parsed = parseScenario(input);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    for (const u of input.units) {
      if (u.id.endsWith('-hq') || u.id.endsWith('-log') || u.id.endsWith('-art')) expect(isLand(u.pos!), u.id).toBe(true);
    }
  });

  it('les scénarios livrés avant la phase 5 restent valides sans rien y changer', () => {
    expect(parseScenario(BOUCLIER_ATLANTIQUE).ok).toBe(true);
    expect(parseScenario(BRECHE_BOREALE).ok).toBe(true);
    // Les champs nouveaux prennent leur valeur par défaut : objectif aérien, aucun effet, aucun satellite.
    expect(BOUCLIER_ATLANTIQUE.objective.kind).toBe('air');
    expect(BOUCLIER_ATLANTIQUE.sides.BLUE.effects).toEqual({ cyber: 0, jam: 0 });
    expect(BOUCLIER_ATLANTIQUE.satellites).toEqual([]);
    expect(BOUCLIER_ATLANTIQUE.terrain).toEqual([]);
  });

  it('refuse une formation terrestre en mer, un bâtiment à terre, un objectif terrestre en mer', () => {
    expect(errorsOf((sc) => (unit(sc, 'b-mech').pos = { ...SEA.blueFrigate })).join('\n')).toMatch(/b-mech.*à terre/);
    expect(errorsOf((sc) => (unit(sc, 'b-frig').pos = { lat: 64.9, lon: -18.5 })).join('\n')).toMatch(/b-frig.*en mer/);
    expect(errorsOf((sc) => (sc.objective.center = { ...SEA.blueFrigate })).join('\n')).toMatch(/objectif terrestre/);
  });

  it('refuse un embarquement incohérent', () => {
    // À bord d'un bâtiment qui ne transporte pas de troupes.
    expect(errorsOf((sc) => (unit(sc, 'r-inf').embarkedIn = 'r-dd')).join('\n')).toMatch(/r-inf.*transporte/);
    // À bord d'un bâtiment adverse ou inconnu.
    expect(errorsOf((sc) => (unit(sc, 'r-inf').embarkedIn = 'b-cv')).length).toBeGreaterThan(0);
    expect(errorsOf((sc) => (unit(sc, 'r-inf').embarkedIn = 'nulle-part')).length).toBeGreaterThan(0);
    // Au-delà de la capacité du bâtiment.
    const over = errorsOf((sc) => {
      for (const id of ['r-arm', 'r-mech', 'r-art']) unit(sc, id).embarkedIn = 'r-lst';
    });
    expect(over.join('\n')).toMatch(/r-lst.*capacité/);
    // Seule une formation terrestre embarque.
    expect(errorsOf((sc) => (unit(sc, 'r-sub').embarkedIn = 'r-lst')).length).toBeGreaterThan(0);
  });

  it('refuse une base embarquée incohérente', () => {
    const base = (sc: ScenarioInput, id: string) => sc.bases.find((b) => b.id === id)!;
    // Un pont d'envol sur un bâtiment qui n'est pas un porte-avions.
    expect(errorsOf((sc) => (base(sc, 'b-deck').hostUnitId = 'b-frig')).join('\n')).toMatch(/b-deck/);
    // Un aéronef non apte à l'appontage.
    expect(errorsOf((sc) => (unit(sc, 'b-rafm-1').platformId = 'f16c')).join('\n')).toMatch(/b-rafm-1.*porte-avions/);
    // Bâtiment porteur inconnu ou adverse.
    expect(errorsOf((sc) => (base(sc, 'b-deck').hostUnitId = 'r-dd')).length).toBeGreaterThan(0);
    expect(errorsOf((sc) => (base(sc, 'r-afloat').hostUnitId = 'fantome')).length).toBeGreaterThan(0);
  });

  it('refuse une équipe spéciale sans base, une escorte en boucle, une fenêtre satellite retournée', () => {
    expect(errorsOf((sc) => delete unit(sc, 'b-sof').baseId).join('\n')).toMatch(/b-sof.*base/);
    const loop = errorsOf((sc) => {
      unit(sc, 'b-frig').leaderId = 'b-cv';
      unit(sc, 'b-cv').leaderId = 'b-frig';
    });
    expect(loop.join('\n')).toMatch(/escorte/);
    expect(errorsOf((sc) => (unit(sc, 'b-frig').leaderId = 'r-dd')).length).toBeGreaterThan(0);
    expect(errorsOf((sc) => (sc.satellites![0]!.endMin = 5)).join('\n')).toMatch(/satellite/);
  });
});

describe('état initial interarmées', () => {
  it('donne à chaque formation terrestre son état : effectifs, moral, cohésion, ravitaillement', () => {
    const s = jointState();
    const mech = s.units['b-mech']!;
    expect(mech.status).toBe('active');
    expect(mech.domain).toBe('ground');
    expect(mech.naval).toBeNull();
    expect(mech.sof).toBeNull();
    expect(mech.land).toMatchObject({ strength: 1, morale: 0.8, cohesion: 1, fatigue: 0, supply: 1, posture: 'hold', dugIn: 0, inContact: false, broken: false, pending: null, casSince: -1 });
    // Une unité logistique part chargée ; son point de distribution est sa position de départ.
    const log = s.units['b-log']!;
    expect(log.land!.cargo).toBe(s.platforms[log.platformId]!.cargo);
    expect(log.land!.supplyPoint).toEqual(log.pos);
    expect(mech.land!.cargo).toBe(0);
    // Les aéronefs n'ont aucun de ces états.
    expect(s.units['b-raf-1']!.land).toBeNull();
    expect(s.units['b-raf-1']!.naval).toBeNull();
  });

  it('applique les effectifs, le moral et le ravitaillement initiaux fixés par le scénario', () => {
    const s = jointState((sc) => Object.assign(sc.units.find((u) => u.id === 'r-arm')!, { strength: 0.7, morale: 0.5, supply: 0.4, posture: 'defend' }));
    expect(s.units['r-arm']!.land).toMatchObject({ strength: 0.7, morale: 0.5, supply: 0.4, posture: 'defend' });
  });

  it('donne à chaque bâtiment sa coque et ses armes, et place les escortes derrière leur chef de file', () => {
    const s = jointState((sc) => (sc.units.find((u) => u.id === 'b-frig')!.leaderId = 'b-cv'));
    const dd = s.units['r-dd']!;
    const perf = s.platforms[dd.platformId]!;
    expect(dd.naval).toMatchObject({ hull: perf.hull, ssm: perf.ssmCount, torpedoes: 0, leaderId: null, troops: [], landing: null });
    expect(s.units['r-sub']!.naval).toMatchObject({ hull: 1, torpedoes: 6, ssm: 0 });
    expect(s.units['b-frig']!.naval!.leaderId).toBe('b-cv');
    expect(dd.land).toBeNull();
  });

  it('embarque les troupes : hors carte, à bord, à la position du bâtiment', () => {
    const s = jointState();
    const inf = s.units['r-inf']!;
    expect(inf.status).toBe('embarked');
    expect(inf.pos).toEqual(s.units['r-lst']!.pos);
    expect(s.units['r-lst']!.naval!.troops).toEqual(['r-inf']);
  });

  it('attache les bases embarquées à leur bâtiment', () => {
    const s = jointState();
    expect(s.bases['b-deck']).toMatchObject({ hostUnitId: 'b-cv', closed: false });
    expect(s.bases['b-deck']!.pos).toEqual(s.units['b-cv']!.pos);
    expect(s.bases['r-afloat']).toMatchObject({ hostUnitId: 'r-aor', supplyStock: 400 });
    expect(s.bases['b-depot']).toMatchObject({ hostUnitId: null, supplyStock: 600, closed: false });
    // Une base aérienne ordinaire n'est pas un dépôt.
    expect(s.bases['b-airbase']!.supplyStock).toBe(0);
  });

  it('place une équipe spéciale en attente à sa base', () => {
    const s = jointState();
    const team = s.units['b-sof']!;
    expect(team.status).toBe('ready');
    expect(team.baseId).toBe('b-airbase');
    expect(team.pos).toEqual(s.bases['b-airbase']!.pos);
    expect(team.sof).toEqual({ phase: 'ready', target: null, arriveAt: 0, compromised: false });
  });

  it('installe les services, les effets, les satellites, le terrain et la nature de l’objectif', () => {
    const s = jointState();
    expect(s.formatVersion).toBe(2);
    expect(s.objective.kind).toBe('ground');
    expect(s.services.BLUE).toEqual({ level: { network: 1, satcom: 1, nav: 1 }, disruptedUntil: { network: 0, satcom: 0, nav: 0 }, resilience: 0.5 });
    expect(s.effects).toEqual({ BLUE: { cyber: 1, jam: 1 }, RED: { cyber: 1, jam: 1 } });
    expect(s.satellites.map((p) => [p.id, p.side, p.startS, p.endS, p.phase])).toEqual([
      ['sat-b', 'BLUE', 600, 1200, 'start'],
      ['sat-r', 'RED', 1800, 2400, 'start'],
    ]);
    expect(s.terrain.map((t) => t.kind)).toEqual(['urbain', 'foret']);
    expect(s.stats.BLUE).toMatchObject({ landStrengthLost: 0, ssmFired: 0, torpedoesFired: 0, effectsUsed: 0 });
    expect(s.stats.BLUE.losses.armor).toBe(0);
    expect(s.missionSeq.BLUE.CAS).toBe(0);
  });
});
