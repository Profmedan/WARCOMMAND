import { describe, expect, it } from 'vitest';
import { SIDES, type SideId, type SimEvent } from '@warcommand/simulation-core';
import { BOUCLIER_ATLANTIQUE, createSession, runToEnd, TETE_DE_PONT, type Session } from '@warcommand/scenario-system';
import { analyzeRecording, recordingOf, rerunSeeds, rerunWithSeed, summarizeReruns } from '../src/index';

/** Partie où le joueur BLEU ne donne aucun ordre : sa patrouille initiale CAP-01 part seule, l'IA commande ROUGE. */
function passiveBlueGame(seed = 20310314): Session {
  const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed, difficulty: 'standard' });
  runToEnd(session);
  return session;
}

function aiGame(seed: number): Session {
  const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: null, seed, difficulty: 'standard' });
  runToEnd(session);
  return session;
}

const resolved = (s: Session): SimEvent[] => s.state.events.filter((e) => e.code === 'SHOT_RESOLVED');

describe('tirs résolus : les faits utiles à l’analyse', () => {
  it('chaque tir résolu porte son numéro, son camp, sa distance de tir et l’état d’alerte de la cible', () => {
    const shots = resolved(aiGame(7));
    expect(shots.length).toBeGreaterThan(0);
    for (const e of shots) {
      expect(typeof e.p.shot).toBe('number');
      expect(SIDES).toContain(e.p.side);
      expect(Number(e.p.rangeKm)).toBeGreaterThanOrEqual(0);
      expect(Number(e.p.maxKm)).toBeGreaterThan(0);
      expect([0, 1]).toContain(e.p.aware);
      expect([0, 1]).toContain(e.p.hit);
    }
    expect(new Set(shots.map((e) => e.p.shot)).size).toBe(shots.length);
  });

  it('le nombre de coups au but relevé tir par tir est celui du bilan de chaque camp', () => {
    const session = aiGame(7);
    for (const side of SIDES) {
      const hits = resolved(session).filter((e) => e.p.side === side && e.p.hit === 1).length;
      expect(hits).toBe(session.state.stats[side].hits);
    }
  });
});

describe('analyse des opérations : séries temporelles', () => {
  const session = aiGame(7);
  const analysis = analyzeRecording(recordingOf(session));

  it('échantillonne toute la partie, du début à la fin', () => {
    expect(analysis.times[0]).toBe(0);
    expect(analysis.times.at(-1)).toBe(session.state.time);
    for (let i = 1; i < analysis.times.length; i++) expect(analysis.times[i]!).toBeGreaterThan(analysis.times[i - 1]!);
    for (const side of SIDES) {
      const s = analysis.sides[side];
      for (const series of [s.fightersAvailable, s.fightersAirborne, s.landStrength, s.hull, s.awareness]) expect(series.length).toBe(analysis.times.length);
    }
    expect(analysis.control.length).toBe(analysis.times.length);
  });

  it('part de la dotation du scénario : quatre chasseurs par camp, tous au sol', () => {
    for (const side of SIDES) {
      expect(analysis.sides[side].fightersAvailable[0]).toBe(4);
      expect(analysis.sides[side].fightersAirborne[0]).toBe(0);
    }
  });

  it('le dernier échantillon est l’état final de la partie', () => {
    for (const side of SIDES) {
      const fighters = Object.values(session.state.units).filter((u) => u.side === side && u.kind === 'fighter');
      expect(analysis.sides[side].fightersAvailable.at(-1)).toBe(fighters.filter((u) => u.status !== 'destroyed' && u.status !== 'maintenance').length);
      expect(analysis.sides[side].fightersAirborne.at(-1)).toBe(fighters.filter((u) => u.status === 'airborne').length);
    }
    expect(analysis.control.at(-1)).toBe(session.state.objective.status);
  });

  it('mesure la qualité de l’image de chaque camp, entre 0 et 1', () => {
    for (const side of SIDES) {
      const values = analysis.sides[side].awareness.filter((v): v is number => v !== null);
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...values)).toBeGreaterThan(0);
    }
  });

  it('est reproductible', () => {
    expect(analyzeRecording(recordingOf(session))).toEqual(analysis);
  });
});

describe('analyse des opérations : engagements', () => {
  const session = aiGame(7);
  const analysis = analyzeRecording(recordingOf(session));
  const of = (side: SideId) => analysis.engagements.filter((line) => line.side === side);

  it('compte les tirs, les coups au but et les coups attendus par camp et par arme', () => {
    for (const side of SIDES) {
      const events = resolved(session).filter((e) => e.p.side === side);
      const lines = of(side);
      expect(lines.reduce((n, l) => n + l.shots, 0)).toBe(events.length);
      expect(lines.reduce((n, l) => n + l.hits, 0)).toBe(session.state.stats[side].hits);
      const expected = events.reduce((sum, e) => sum + (typeof e.p.pk === 'number' ? e.p.pk : 0), 0);
      expect(lines.reduce((sum, l) => sum + l.expectedHits, 0)).toBeCloseTo(expected, 6);
      for (const l of lines) {
        expect(l.hits).toBeLessThanOrEqual(l.shots);
        expect(l.kills).toBeLessThanOrEqual(l.hits);
      }
    }
  });

  it('répartit les tirs par tranche de distance et selon que la cible était alertée', () => {
    for (const side of SIDES) {
      const events = resolved(session).filter((e) => e.p.side === side);
      const bands = analysis.ranges[side];
      expect(bands.map((b) => b.band)).toEqual(['near', 'mid', 'far']);
      expect(bands.reduce((n, b) => n + b.shots, 0)).toBe(events.length);
      const alert = analysis.alert[side];
      expect(alert.aware.shots + alert.surprised.shots).toBe(events.filter((e) => e.p.weapon === 'aam' || e.p.weapon === 'sam').length);
    }
  });

  it('reconstitue la chaîne d’engagement de chaque destruction obtenue par un tir', () => {
    expect(analysis.killChains.length).toBeGreaterThan(0);
    for (const chain of analysis.killChains) {
      const victim = Object.values(session.state.units).find((u) => u.name === chain.target && u.side !== chain.killer);
      expect(victim?.status).toBe('destroyed');
      expect(chain.destroyedAt).toBeGreaterThanOrEqual(chain.firstShotAt);
      if (chain.detectedAt !== null) expect(chain.firstShotAt).toBeGreaterThanOrEqual(chain.detectedAt);
      if (chain.identifiedAt !== null && chain.detectedAt !== null) expect(chain.identifiedAt).toBeGreaterThanOrEqual(chain.detectedAt);
    }
    for (const side of SIDES) {
      const mine = analysis.killChains.filter((c) => c.killer === side);
      expect(mine.length).toBeLessThanOrEqual(session.state.stats[side].kills);
      if (mine.length > 0) expect(analysis.chainMedians[side].shotToKillS).not.toBeNull();
    }
  });
});

describe('analyse des opérations : missions et moments clés', () => {
  const session = passiveBlueGame();
  const analysis = analyzeRecording(recordingOf(session));

  it('rend compte de la patrouille initiale : quatre appareils, départ à vingt minutes, tirs', () => {
    const cap = analysis.missions.find((m) => m.side === 'BLUE' && m.name === 'CAP-01');
    expect(cap).toBeDefined();
    expect(cap!.type).toBe('CAP');
    expect(cap!.aircraft).toBe(4);
    expect(cap!.launchedAt).toBeGreaterThanOrEqual(1200);
    expect(cap!.launchedAt).toBeLessThan(1500);
    expect(cap!.onStationS).toBeLessThanOrEqual(session.state.time);
    expect(cap!.hits).toBeLessThanOrEqual(cap!.shots);
  });

  it('mesure le temps sur zone : l’avion-radar, en vol dès le début, tient sa station', () => {
    const aew = analysis.missions.find((m) => m.side === 'BLUE' && m.type === 'AEW');
    expect(aew).toBeDefined();
    expect(aew!.launchedAt).toBe(0);
    expect(aew!.onStationS).toBeGreaterThan(600);
    expect(aew!.onStationS).toBeLessThanOrEqual(session.state.time);
  });

  it('attribue chaque tir d’aéronef à sa mission', () => {
    for (const side of SIDES) {
      const fromMissions = analysis.missions.filter((m) => m.side === side).reduce((n, m) => n + m.shots, 0);
      const airShots = analysis.engagements.filter((l) => l.side === side && (l.weapon === 'aam' || l.weapon === 'asm')).reduce((n, l) => n + l.shots, 0);
      expect(fromMissions).toBe(airShots);
    }
  });

  it('relève les moments clés dans l’ordre, jusqu’à la fin de la mission', () => {
    const moments = analysis.keyMoments;
    for (let i = 1; i < moments.length; i++) expect(moments[i]!.t).toBeGreaterThanOrEqual(moments[i - 1]!.t);
    expect(moments.filter((m) => m.kind === 'end')).toHaveLength(1);
    expect(moments.at(-1)!.kind).toBe('end');
    expect(moments.filter((m) => m.kind === 'control')).toHaveLength(session.state.objective.timeline.length - 1);
    for (const side of SIDES) expect(moments.filter((m) => m.kind === 'contact' && m.side === side).length).toBeLessThanOrEqual(1);
    const losses = SIDES.reduce((n, side) => n + Object.values(session.state.stats[side].losses).reduce((a, b) => a + b, 0), 0);
    expect(moments.filter((m) => m.kind === 'loss')).toHaveLength(losses);
  });
});

describe('analyse des opérations : composantes interarmées', () => {
  it('suit les effectifs à terre et la coque des bâtiments de « Tête de pont »', () => {
    const session = createSession(TETE_DE_PONT, { playerSide: null, seed: 3, difficulty: 'standard' });
    runToEnd(session);
    const analysis = analyzeRecording(recordingOf(session), 300);
    for (const side of SIDES) {
      const s = analysis.sides[side];
      expect(s.landStrength[0]).toBeGreaterThan(0);
      expect(s.hull[0]).toBeGreaterThan(0);
      const ground = Object.values(session.state.units).filter((u) => u.side === side && u.land && u.status !== 'destroyed');
      expect(s.landStrength.at(-1)).toBeCloseTo(ground.reduce((sum, u) => sum + u.land!.strength, 0), 6);
    }
  });
});

describe('sensibilité au hasard', () => {
  const session = passiveBlueGame(5);
  const recording = recordingOf(session);

  it('rejouer avec la graine d’origine redonne le résultat d’origine', () => {
    const again = rerunWithSeed(recording, recording.options.seed);
    expect(again.winner).toBe(session.state.outcome!.winner);
    expect(again.level).toBe(session.state.outcome!.level);
    expect(again.defenderControlSec).toBe(session.state.objective.sec[session.state.objective.defender]);
    expect(again.refusedOrders).toBe(0);
  });

  it('tire des graines distinctes, toujours les mêmes pour une partie donnée', () => {
    const seeds = rerunSeeds(recording.options.seed, 12);
    expect(new Set(seeds).size).toBe(12);
    expect(seeds).not.toContain(recording.options.seed);
    expect(rerunSeeds(recording.options.seed, 12)).toEqual(seeds);
  });

  it('résume une série de rejeux : victoires par camp et étendue du contrôle', () => {
    const results = rerunSeeds(recording.options.seed, 4).map((seed) => rerunWithSeed(recording, seed));
    const summary = summarizeReruns(results, session.state.outcome);
    expect(summary.runs).toBe(4);
    expect(summary.wins.BLUE + summary.wins.RED + summary.wins.DRAW).toBe(4);
    expect(summary.defenderControlSec.min).toBeLessThanOrEqual(summary.defenderControlSec.median);
    expect(summary.defenderControlSec.median).toBeLessThanOrEqual(summary.defenderControlSec.max);
    expect(summary.sameAsOriginal).toBe(results.filter((r) => r.winner === session.state.outcome!.winner).length);
  });
});
