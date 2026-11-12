import { describe, expect, it } from 'vitest';
import {
  action,
  angleDiffDeg,
  bearingDeg,
  clockZ,
  condition,
  createStreams,
  destination,
  distanceKm,
  hashState,
  moveToward,
  radarHorizonKm,
  rand,
  selector,
  sequence,
} from '../src/index';

describe('générateur aléatoire', () => {
  it('produit la même suite pour la même graine', () => {
    const a = createStreams(42, ['sim']);
    const b = createStreams(42, ['sim']);
    const sa = Array.from({ length: 50 }, () => rand(a, 'sim'));
    const sb = Array.from({ length: 50 }, () => rand(b, 'sim'));
    expect(sa).toEqual(sb);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('produit des suites différentes pour des graines ou des flux différents', () => {
    const a = createStreams(1, ['sim', 'ai:RED']);
    const b = createStreams(2, ['sim']);
    expect(rand(a, 'sim')).not.toBe(rand(b, 'sim'));
    expect(a.sim).not.toBe(a['ai:RED']);
  });

  it('garde les flux indépendants : tirer dans l’un ne déplace pas l’autre', () => {
    const a = createStreams(7, ['sim', 'ai:RED']);
    const b = createStreams(7, ['sim', 'ai:RED']);
    for (let i = 0; i < 10; i++) rand(a, 'ai:RED');
    expect(rand(a, 'sim')).toBe(rand(b, 'sim'));
  });

  it('refuse un flux inconnu', () => {
    expect(() => rand(createStreams(1, ['sim']), 'autre')).toThrow();
  });
});

describe('géodésie', () => {
  const paris = { lat: 48.8566, lon: 2.3522 };
  const london = { lat: 51.5074, lon: -0.1278 };

  it('calcule des distances connues à moins de 0,5 %', () => {
    expect(distanceKm(paris, london)).toBeGreaterThan(343.5 * 0.995);
    expect(distanceKm(paris, london)).toBeLessThan(343.5 * 1.005);
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
    expect(distanceKm(paris, paris)).toBe(0);
  });

  it('calcule les caps cardinaux', () => {
    const o = { lat: 10, lon: 10 };
    expect(bearingDeg(o, { lat: 11, lon: 10 })).toBeCloseTo(0, 5);
    expect(bearingDeg(o, { lat: 10, lon: 11 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 9, lon: 10 })).toBeCloseTo(180, 5);
    expect(angleDiffDeg(350, 10)).toBeCloseTo(20, 9);
    expect(angleDiffDeg(10, 350)).toBeCloseTo(20, 9);
  });

  it('destination et distance sont cohérentes', () => {
    const start = { lat: 67, lon: -11 };
    for (const brg of [0, 45, 133, 270]) {
      const end = destination(start, brg, 250);
      expect(distanceKm(start, end)).toBeCloseTo(250, 6);
      expect(angleDiffDeg(bearingDeg(start, end), brg)).toBeLessThan(1e-6);
    }
  });

  it('ne dépasse jamais la cible en se déplaçant', () => {
    const from = { lat: 65, lon: -14 };
    const to = { lat: 65.1, lon: -14 };
    const far = moveToward(from, to, 0.25, 0);
    expect(far.arrived).toBe(false);
    expect(distanceKm(from, far.pos)).toBeCloseTo(0.25, 6);
    const near = moveToward(from, to, 500, 0);
    expect(near.arrived).toBe(true);
    expect(near.pos).toEqual(to);
    expect(near.movedKm).toBeCloseTo(distanceKm(from, to), 9);
  });

  it('applique la formule de l’horizon radar', () => {
    expect(radarHorizonKm(0, 0)).toBe(0);
    expect(radarHorizonKm(30, 9000)).toBeCloseTo(4.12 * (Math.sqrt(30) + Math.sqrt(9000)), 9);
    expect(radarHorizonKm(30, 100)).toBeLessThan(radarHorizonKm(30, 9000));
  });
});

describe('outils du noyau', () => {
  it('l’empreinte dépend du contenu et de lui seul', () => {
    expect(hashState({ a: 1, b: [1, 2] })).toBe(hashState({ a: 1, b: [1, 2] }));
    expect(hashState({ a: 1, b: [1, 2] })).not.toBe(hashState({ a: 1, b: [2, 1] }));
    expect(hashState({})).toHaveLength(16);
  });

  it('convertit le temps de simulation en heure Zulu', () => {
    expect(clockZ('2031-03-14T08:40:00Z', 0)).toBe('08:40:00');
    expect(clockZ('2031-03-14T08:40:00Z', 120)).toBe('08:42:00');
    expect(clockZ('2031-03-14T08:40:00Z', 5400, false)).toBe('10:10');
  });

  it('les arbres de comportement respectent priorité et séquence', () => {
    const trace: string[] = [];
    const tree = selector<{ n: number }>(
      sequence(
        condition((c) => c.n > 10),
        action(() => trace.push('grand')),
      ),
      sequence(
        condition((c) => c.n > 5),
        action(() => trace.push('moyen')),
      ),
      action(() => trace.push('petit')),
    );
    tree({ n: 20 });
    tree({ n: 7 });
    tree({ n: 1 });
    expect(trace).toEqual(['grand', 'moyen', 'petit']);
  });
});
