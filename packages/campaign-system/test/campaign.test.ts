import { describe, expect, it } from 'vitest';
import { cloneData, hashState, type SideId, type SimState } from '@warcommand/simulation-core';
import { createSession, runToEnd, SCENARIOS, type Scenario, type Session } from '@warcommand/scenario-system';
import { checkScenario } from '@warcommand/mission-editor';
import {
  CAMPAIGNS,
  campaignStanding,
  getCampaign,
  missionSeed,
  parseCampaignState,
  prepareMission,
  recordMission,
  startCampaign,
  type CampaignState,
  type PreparedMission,
} from '../src/index';

const DEF = getCampaign('vent-du-nord')!;
const lookup = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);
const NOW = '2031-03-14T08:00:00.000Z';
const LATER = '2031-03-14T10:00:00.000Z';

function fresh(playerSide: SideId = 'BLUE', seed = 4242): CampaignState {
  return startCampaign(DEF, { slotId: 'essai', playerSide, difficulty: 'standard', seed, now: NOW });
}

function prepared(state: CampaignState): PreparedMission {
  const p = prepareMission(DEF, state, lookup);
  if (!p.ok) throw new Error(p.errors.join(' ; '));
  return p;
}

/** État de fin de mission fabriqué : la mission n'est pas jouée, on en fixe l'issue et, au besoin, les pertes. */
function ended(p: PreparedMission, winner: SideId | 'DRAW', level: 'major' | 'minor' | 'draw', destroyed: string[] = []): SimState {
  const session: Session = createSession(p.scenario, p.options);
  for (const id of destroyed) session.state.units[id]!.status = 'destroyed';
  session.state.outcome = { winner, level, reason: 'time', endedAt: session.state.endTime };
  return session.state;
}

function advance(state: CampaignState, winner: SideId | 'DRAW', level: 'major' | 'minor' | 'draw', destroyed: string[] = []): CampaignState {
  const p = prepared(state);
  const result = recordMission(DEF, state, p, ended(p, winner, level, destroyed), LATER);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('campagne livrée', () => {
  it('ne renvoie qu’à des scénarios et à des missions qui existent, et se termine toujours', () => {
    expect(CAMPAIGNS.length).toBeGreaterThan(0);
    for (const def of CAMPAIGNS) {
      const ids = new Set(def.missions.map((m) => m.id));
      expect(ids.size).toBe(def.missions.length);
      expect(ids.has(def.first)).toBe(true);
      for (const m of def.missions) {
        expect(lookup(m.scenarioId)).toBeDefined();
        for (const next of Object.values(m.next)) if (next !== null) expect(ids.has(next)).toBe(true);
      }
      // Aucun chemin ne revient sur une mission déjà jouée.
      const walk = (id: string, seen: string[]): void => {
        expect(seen).not.toContain(id);
        const m = def.missions.find((x) => x.id === id)!;
        for (const next of new Set(Object.values(m.next))) if (next !== null) walk(next, [...seen, id]);
      };
      walk(def.first, []);
    }
  });
});

describe('début de campagne', () => {
  it('place le joueur devant la première mission, réserves pleines, sans passif', () => {
    const state = fresh();
    expect(state.current).toBe(DEF.first);
    expect(state.history).toEqual([]);
    expect(state.reserves).toEqual(DEF.carry.reserves);
    expect(state.shortfall).toEqual({ BLUE: {}, RED: {} });
    expect(state.experience).toEqual({ BLUE: 0, RED: 0 });
    expect(state.startedAt).toBe(NOW);
  });

  it('la première mission est le scénario tel qu’il est livré, sans report', () => {
    const p = prepared(fresh());
    expect(p.mission.id).toBe(DEF.first);
    expect(p.scenario).toEqual(lookup(p.mission.scenarioId));
    expect(p.notes).toEqual([]);
    expect(p.options).toEqual({ playerSide: 'BLUE', difficulty: 'standard', seed: missionSeed(fresh()), wegoTurnMin: 0 });
  });

  it('donne à chaque mission sa graine, dérivée de celle de la campagne', () => {
    const first = fresh();
    const second = advance(first, 'BLUE', 'minor');
    expect(missionSeed(first)).not.toBe(missionSeed(second));
    expect(missionSeed(first)).toBe(missionSeed(fresh()));
    expect(missionSeed(fresh('BLUE', 1))).not.toBe(missionSeed(fresh('BLUE', 2)));
  });
});

describe('fin de mission : ce qui est consigné', () => {
  it('consigne une mission réellement jouée : issue, pertes d’aéronefs et munitions consommées', () => {
    const state = fresh();
    const p = prepared(state);
    const session = createSession(p.scenario, p.options);
    const start = cloneData(session.state);
    runToEnd(session);
    const result = recordMission(DEF, state, p, session.state, LATER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const record = result.state.history[0]!;
    expect(result.state.history).toHaveLength(1);
    expect(record.missionId).toBe(DEF.first);
    expect(record.winner).toBe(session.state.outcome!.winner);
    expect(record.hash).toBe(hashState(session.state));
    expect(result.state.updatedAt).toBe(LATER);

    for (const side of ['BLUE', 'RED'] as const) {
      const air = Object.values(session.state.units).filter((u) => u.side === side && u.domain === 'air');
      const lost = air.filter((u) => u.status === 'destroyed');
      expect(Object.values(record.aircraftLost[side]).reduce((a, b) => a + b, 0)).toBe(lost.length);
      const total = (s: SimState) =>
        Object.values(s.bases).filter((b) => b.side === side).reduce((n, b) => n + b.weaponStock, 0) +
        Object.values(s.units).filter((u) => u.side === side && u.domain === 'air' && u.status !== 'destroyed').reduce((n, u) => n + u.weapons, 0);
      expect(record.expended[side].aam).toBe(Math.max(0, total(start) - total(session.state)));
      expect(result.state.reserves[side].aam).toBe(Math.max(0, DEF.carry.reserves[side].aam - record.expended[side].aam) + DEF.carry.resupply[side].aam);
    }
  });

  it('compte les points : trois pour une victoire majeure, deux pour une mineure, un chacun pour un résultat indécis', () => {
    expect(advance(fresh(), 'BLUE', 'major').history[0]!.points).toEqual({ BLUE: 3, RED: 0 });
    expect(advance(fresh(), 'RED', 'minor').history[0]!.points).toEqual({ BLUE: 0, RED: 2 });
    expect(advance(fresh(), 'DRAW', 'draw').history[0]!.points).toEqual({ BLUE: 1, RED: 1 });
  });

  it('refuse de consigner une mission qui n’est pas terminée', () => {
    const state = fresh();
    const p = prepared(state);
    const result = recordMission(DEF, state, p, createSession(p.scenario, p.options).state, LATER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/terminée/);
  });

  it('refuse de consigner une autre mission que celle en cours', () => {
    const state = fresh();
    const p = prepared(state);
    const next = advance(state, 'BLUE', 'minor');
    const result = recordMission(DEF, next, p, ended(p, 'BLUE', 'minor'), LATER);
    expect(result.ok).toBe(false);
  });

  it('ne modifie jamais l’état de campagne qu’on lui confie', () => {
    const state = fresh();
    const before = cloneData(state);
    advance(state, 'RED', 'major', ['blue-raf-1', 'blue-raf-2']);
    expect(state).toEqual(before);
  });
});

describe('enchaînement des missions', () => {
  it('BLEU vainqueur ou résultat indécis : la contre-offensive ; ROUGE vainqueur : il exploite aussitôt', () => {
    const first = DEF.missions.find((m) => m.id === DEF.first)!;
    expect(advance(fresh(), 'BLUE', 'minor').current).toBe(first.next.BLUE);
    expect(advance(fresh(), 'DRAW', 'draw').current).toBe(first.next.DRAW);
    expect(advance(fresh(), 'RED', 'minor').current).toBe(first.next.RED);
    expect(first.next.RED).not.toBe(first.next.BLUE);
  });

  it('la campagne se termine après la dernière mission, et le vainqueur est celui qui a le plus de points', () => {
    let state = advance(fresh(), 'RED', 'major');
    expect(campaignStanding(DEF, state).finished).toBe(false);
    while (state.current !== null) state = advance(state, 'BLUE', 'minor');
    const standing = campaignStanding(DEF, state);
    expect(standing.finished).toBe(true);
    expect(standing.played).toBe(state.history.length);
    expect(standing.points.RED).toBe(3);
    expect(standing.points.BLUE).toBe(2 * (state.history.length - 1));
    expect(standing.verdict).toBe(standing.points.BLUE > standing.points.RED ? 'BLUE' : standing.points.BLUE < standing.points.RED ? 'RED' : 'DRAW');

    const p = prepareMission(DEF, state, lookup);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join(' ')).toMatch(/terminée/);
  });
});

describe('report des pertes d’aéronefs', () => {
  const lost = ['blue-raf-1', 'blue-raf-2', 'blue-raf-3'];

  it('remplace un appareil perdu sur deux, arrondi en faveur du camp', () => {
    const state = advance(fresh(), 'BLUE', 'minor', lost);
    expect(state.history[0]!.aircraftLost.BLUE).toEqual({ rafale: 3 });
    // Trois perdus, deux remplacés : il en manque un.
    expect(state.shortfall.BLUE).toEqual({ rafale: 1 });
    expect(state.shortfall.RED).toEqual({});
  });

  it('retire les appareils manquants de la mission suivante, missions initiales et renseignement compris', () => {
    const state = advance(fresh(), 'BLUE', 'minor', lost);
    const p = prepared(state);
    const base = lookup(p.mission.scenarioId)!;
    const planned = base.units.filter((u) => u.side === 'BLUE' && u.platformId === 'rafale');
    const present = p.scenario.units.filter((u) => u.side === 'BLUE' && u.platformId === 'rafale');
    expect(present).toHaveLength(planned.length - 1);
    const removed = planned.at(-1)!.id;
    expect(p.scenario.units.some((u) => u.id === removed)).toBe(false);
    expect(p.scenario.missions.some((m) => m.unitIds.includes(removed))).toBe(false);
    expect(p.scenario.intel.some((k) => k.unitId === removed)).toBe(false);
    expect(p.notes).toContainEqual({ kind: 'shortfall', side: 'BLUE', platformId: 'rafale', missing: 1, planned: planned.length });
    expect(checkScenario(p.scenario).errors).toEqual([]);
    // Le camp adverse garde sa dotation.
    expect(p.scenario.units.filter((u) => u.side === 'RED')).toEqual(base.units.filter((u) => u.side === 'RED'));
  });

  it('n’ampute jamais une dotation de plus de la moitié, et rend toujours un moyen unique', () => {
    const state: CampaignState = { ...fresh(), shortfall: { BLUE: { rafale: 10, e3: 4 }, RED: {} } };
    const p = prepared(state);
    const base = lookup(p.mission.scenarioId)!;
    const count = (sc: Scenario, platformId: string) => sc.units.filter((u) => u.side === 'BLUE' && u.platformId === platformId).length;
    expect(count(p.scenario, 'rafale')).toBe(Math.ceil(count(base, 'rafale') / 2));
    expect(count(p.scenario, 'e3')).toBe(count(base, 'e3'));
    expect(checkScenario(p.scenario).errors).toEqual([]);
  });

  it('un manque sans emploi dans la mission suivante continue de se résorber', () => {
    const state: CampaignState = { ...fresh(), shortfall: { BLUE: { 'materiel-absent': 4 }, RED: {} } };
    expect(advance(state, 'BLUE', 'minor').shortfall.BLUE).toEqual({ 'materiel-absent': 2 });
  });
});

describe('report des stocks de munitions', () => {
  it('une réserve suffisante laisse les stocks de la mission intacts', () => {
    const p = prepared(fresh());
    expect(p.scenario.bases).toEqual(lookup(p.mission.scenarioId)!.bases);
  });

  it('une réserve entamée réduit les stocks des bases dans la même proportion, et le dit', () => {
    const base = lookup(DEF.missions.find((m) => m.id === DEF.first)!.scenarioId)!;
    const planned = base.bases.filter((b) => b.side === 'BLUE').reduce((n, b) => n + b.weaponStock, 0);
    const state: CampaignState = { ...fresh(), reserves: { BLUE: { aam: planned / 2, asm: 0 }, RED: fresh().reserves.RED } };
    const p = prepared(state);
    const got = p.scenario.bases.filter((b) => b.side === 'BLUE').reduce((n, b) => n + b.weaponStock, 0);
    expect(got).toBeLessThanOrEqual(planned / 2);
    expect(got).toBeGreaterThan(planned / 2 - p.scenario.bases.length);
    expect(p.notes).toContainEqual({ kind: 'stock', side: 'BLUE', munition: 'aam', pct: 50 });
    expect(p.scenario.bases.filter((b) => b.side === 'RED')).toEqual(base.bases.filter((b) => b.side === 'RED'));
    expect(checkScenario(p.scenario).errors).toEqual([]);
  });
});

describe('report de l’expérience', () => {
  it('les équipages du vainqueur progressent à la mission suivante, sans dépasser le plafond', () => {
    const state = advance(fresh(), 'BLUE', 'major');
    expect(state.experience).toEqual({ BLUE: DEF.carry.experienceGain, RED: 0 });
    const p = prepared(state);
    const base = lookup(p.mission.scenarioId)!;
    const truth = createSession(base, { playerSide: null }).state.units;
    let upgraded = 0;
    for (const u of p.scenario.units) {
      const original = base.units.find((x) => x.id === u.id)!;
      if (u.side === 'BLUE' && truth[u.id]!.domain === 'air') {
        expect(u.crew).toBeCloseTo(Math.min(1, original.crew + DEF.carry.experienceGain), 9);
        upgraded += 1;
      } else expect(u.crew).toBe(original.crew);
    }
    expect(upgraded).toBeGreaterThan(0);
    expect(p.notes).toContainEqual({ kind: 'experience', side: 'BLUE', pct: Math.round(DEF.carry.experienceGain * 100) });

    let long = state;
    for (let i = 0; i < 40; i++) long = { ...long, experience: { ...long.experience, BLUE: Math.min(DEF.carry.experienceMax, long.experience.BLUE + DEF.carry.experienceGain) } };
    expect(long.experience.BLUE).toBe(DEF.carry.experienceMax);
  });
});

describe('persistance', () => {
  it('un état de campagne survit à un aller-retour en JSON', () => {
    const state = advance(fresh(), 'BLUE', 'minor', ['blue-raf-1']);
    const back = parseCampaignState(JSON.parse(JSON.stringify(state)));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state).toEqual(state);
  });

  it.each<[string, unknown, RegExp]>([
    ['une donnée qui n’est pas un objet', 'campagne', /illisible/i],
    ['un autre fichier', { format: 'warcommand-save', version: 1 }, /campagne WAR COMMAND/i],
    ['une autre version', { ...fresh(), version: 7 }, /version/i],
    ['une campagne inconnue', { ...fresh(), campaignId: 'inconnue' }, /inconnue/i],
    ['une mission en cours inconnue', { ...fresh(), current: 'acte-99' }, /mission/i],
    ['un état incomplet', { format: 'warcommand-campaign', version: 1, campaignId: 'vent-du-nord' }, /./],
    ['des réserves négatives', { ...fresh(), reserves: { BLUE: { aam: -1, asm: 0 }, RED: { aam: 0, asm: 0 } } }, /./],
  ])('refuse %s', (_label, data, message) => {
    const result = parseCampaignState(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(message);
  });
});

describe('campagne jouée de bout en bout', () => {
  function play(seed: number): CampaignState {
    let state = fresh('BLUE', seed);
    while (state.current !== null) {
      const p = prepared(state);
      expect(checkScenario(p.scenario).errors).toEqual([]);
      const session = createSession(p.scenario, p.options);
      runToEnd(session);
      const result = recordMission(DEF, state, p, session.state, LATER);
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    }
    return state;
  }

  it('va à son terme, mission après mission, et se rejoue à l’identique avec la même graine', () => {
    const state = play(77);
    expect(state.history.length).toBeGreaterThanOrEqual(2);
    expect(campaignStanding(DEF, state).finished).toBe(true);
    for (const record of state.history) expect(record.elapsedSec).toBeGreaterThan(0);
    expect(play(77)).toEqual(state);
  });
});
