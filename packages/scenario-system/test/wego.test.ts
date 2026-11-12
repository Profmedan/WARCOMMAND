import { describe, expect, it } from 'vitest';
import { hashState } from '@warcommand/simulation-core';
import type { Order } from '@warcommand/air-operations';
import { BOUCLIER_ATLANTIQUE, createSession, issueOrder, stepSession } from '../src/index';
import { draft } from './helpers';

const cap = (unitIds: string[]): Order => ({ type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds, launchAt: 0 }) });

describe('mode par tours (WEGO)', () => {
  it('n’accepte les ordres du joueur qu’entre deux tours', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 8, wegoTurnMin: 5 });
    expect(session.state.wegoTurnS).toBe(300);
    expect(issueOrder(session, cap(['blue-raf-1'])).ok).toBe(true);

    stepSession(session, 100);
    expect(issueOrder(session, cap(['blue-raf-2']))).toMatchObject({ ok: false, code: 'NOT_PLANNING_PHASE' });
    expect(session.orders).toHaveLength(1);

    stepSession(session, 200);
    expect(session.state.time).toBe(300);
    expect(issueOrder(session, cap(['blue-raf-2'])).ok).toBe(true);
    expect(session.orders).toHaveLength(2);
  });

  it('l’IA ne décide elle aussi qu’aux fins de tour', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 8, wegoTurnMin: 5 });
    stepSession(session, 40 * 60);
    const log = session.state.ai.RED!.log;
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((d) => d.t % 300 !== 0)).toEqual([]);
  });

  it('en temps continu, les ordres sont acceptés à tout instant et l’IA décide librement', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 8 });
    expect(session.state.wegoTurnS).toBe(0);
    stepSession(session, 100);
    expect(issueOrder(session, cap(['blue-raf-2'])).ok).toBe(true);
    stepSession(session, 40 * 60);
    expect(session.state.ai.RED!.log.some((d) => d.t % 300 !== 0)).toBe(true);
  });

  it('reste déterministe', () => {
    const play = () => {
      const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: null, seed: 21, wegoTurnMin: 5 });
      stepSession(session, 60 * 60);
      return hashState(session.state);
    };
    expect(play()).toBe(play());
  });
});
