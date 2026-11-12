import { describe, expect, it } from 'vitest';
import { checkInvariants, hashState, snapshotPositions } from '@warcommand/simulation-core';
import { nightNow } from '@warcommand/air-operations';
import { BRECHE_BOREALE, createSession, runToEnd, SCENARIOS, stepSession } from '@warcommand/scenario-system';
import { buildAar } from '../src/index';

describe('scénario « Brèche Boréale »', () => {
  it('est livré, valide, et met en scène les moyens de la phase 3', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['bouclier-atlantique', 'breche-boreale']);
    const session = createSession(BRECHE_BOREALE, { playerSide: 'BLUE' });
    const s = session.state;
    const of = (side: string, kind: string) => Object.values(s.units).filter((u) => u.side === side && u.kind === kind);
    expect(of('BLUE', 'fighter')).toHaveLength(6);
    expect(of('BLUE', 'drone')).toHaveLength(1);
    expect(of('BLUE', 'tanker')).toHaveLength(1);
    expect(of('RED', 'fighter')).toHaveLength(4);
    expect(of('RED', 'sam')).toHaveLength(1);
    expect(s.objective.defender).toBe('RED');
    // Un chasseur rouge est en maintenance au départ ; BLEU dispose de munitions air-surface.
    expect(of('RED', 'fighter').filter((u) => u.status === 'turnaround')).toHaveLength(1);
    expect(Object.values(s.bases).find((b) => b.side === 'BLUE')!.asmStock).toBeGreaterThanOrEqual(8);
    // La mission commence de jour et s'achève de nuit.
    expect(nightNow(s)).toBe(false);
    s.time = s.endTime;
    expect(nightNow(s)).toBe(true);
  });

  it.each([1, 2])('graine %i : la partie IA contre IA se déroule sans violation ni ordre refusé', (seed) => {
    const session = createSession(BRECHE_BOREALE, { playerSide: null, seed });
    const s = session.state;
    let previous = snapshotPositions(s);
    while (!s.outcome) {
      stepSession(session, 1);
      expect(checkInvariants(s, previous)).toEqual([]);
      previous = snapshotPositions(s);
    }
    expect(s.time).toBe(s.endTime);
    for (const side of ['BLUE', 'RED'] as const) {
      expect(s.ai[side]!.log.filter((d) => d.code === 'ORDER_REJECTED'), side).toEqual([]);
    }
    const aar = buildAar(s);
    expect(aar.controlSec.BLUE + aar.controlSec.RED + aar.controlSec.CONTESTED).toBe(s.endTime);
  });

  it('sur quelques graines, l’IA y emploie réellement l’attaque des défenses, l’escorte ou l’écoute', () => {
    let asm = 0;
    let suppressions = 0;
    let passive = 0;
    let refuels = 0;
    for (const seed of [1, 2, 3, 4]) {
      const session = createSession(BRECHE_BOREALE, { playerSide: null, seed });
      runToEnd(session);
      const s = session.state;
      asm += s.stats.BLUE.asmFired + s.stats.RED.asmFired;
      suppressions += s.events.filter((e) => e.code === 'UNIT_SUPPRESSED' || (e.code === 'UNIT_DESTROYED' && String(e.p.unit).startsWith('Sol-air'))).length;
      passive += s.events.filter((e) => e.code === 'CONTACT_NEW' && e.p.source === 'esm').length;
      refuels += s.events.filter((e) => e.code === 'REFUEL_START').length;
    }
    expect(asm).toBeGreaterThan(0);
    expect(suppressions).toBeGreaterThan(0);
    expect(passive).toBeGreaterThan(0);
    expect(refuels).toBeGreaterThan(0);
  });

  it('est reproductible', () => {
    const play = () => {
      const session = createSession(BRECHE_BOREALE, { playerSide: null, seed: 5 });
      runToEnd(session);
      return hashState(session.state);
    };
    expect(play()).toBe(play());
  });
});
