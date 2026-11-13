import { describe, expect, it } from 'vitest';
import { BOUCLIER_ATLANTIQUE, createSession, issueOrder, runToEnd, stepSession } from '../src/index';

const versus = () => createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 11, versus: true });
const capOf = (session: ReturnType<typeof versus>, side: 'BLUE' | 'RED') => Object.values(session.state.missions).find((m) => m.side === side && m.type === 'CAP');

describe('partie à deux joueurs humains', () => {
  it('ne confie aucun camp à l’IA', () => {
    const session = versus();
    expect(session.state.ai.BLUE).toBeNull();
    expect(session.state.ai.RED).toBeNull();
    expect(session.options.versus).toBe(true);
  });

  it('une partie ordinaire garde son IA, et ses options ne changent pas de forme', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 11 });
    expect(session.state.ai.RED).not.toBeNull();
    expect(session.options).toEqual({ playerSide: 'BLUE', difficulty: BOUCLIER_ATLANTIQUE.difficulty, seed: 11, wegoTurnMin: 0 });
  });

  it('accepte les ordres des deux camps et les consigne tous', () => {
    const session = versus();
    stepSession(session, 60);
    const blueCap = capOf(session, 'BLUE')!;
    expect(issueOrder(session, { type: 'CANCEL_MISSION', side: 'BLUE', missionId: blueCap.id }).ok).toBe(true);
    const red = issueOrder(session, {
      type: 'CREATE_MISSION',
      side: 'RED',
      draft: { type: 'CAP', unitIds: ['red-su-1', 'red-su-2'], waypoints: [{ lat: 67.4, lon: -10.4 }], altM: 9000, speed: 'cruise', launchAt: 60, endAt: null, roe: 'defensive', allowRefuel: false, targetContactId: null },
    });
    expect(red.ok).toBe(true);
    expect(session.orders.map((o) => o.order.side)).toEqual(['BLUE', 'RED']);
  });

  it('dans une partie contre l’IA, le camp de l’IA ne reçoit toujours aucun ordre du joueur', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 11 });
    const result = issueOrder(session, { type: 'SET_ROE', side: 'RED', missionId: 'x', roe: 'free' });
    expect(result).toEqual({ ok: false, code: 'WRONG_SIDE' });
  });

  it('se joue jusqu’au bout sans aucune décision d’IA', () => {
    const session = versus();
    runToEnd(session);
    expect(session.state.outcome).not.toBeNull();
    expect(session.state.events.some((e) => e.code === 'AI_DECISION')).toBe(false);
  });
});
