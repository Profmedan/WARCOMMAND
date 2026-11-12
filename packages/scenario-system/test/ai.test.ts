import { describe, expect, it } from 'vitest';
import { cloneData, getSidePicture, rand, type AiMemory, type SidePicture } from '@warcommand/simulation-core';
import { validateOrder } from '@warcommand/air-operations';
import { aiDecide, createAiMemory, INITIAL_ASSESSMENT_S } from '@warcommand/ai-commander';
import { BOUCLIER_ATLANTIQUE, createSession, runToEnd, stepSession } from '../src/index';
import { freshState } from './helpers';

const fixed = (value: number) => () => value;

function decide(pic: SidePicture, mem: AiMemory) {
  return aiDecide(cloneData(pic), mem, fixed(0.5));
}

describe('IA adverse', () => {
  it('attend d’avoir une première image avant de décider, puis lance une patrouille valide', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'RED', seed: 11 });
    const s = session.state;
    stepSession(session, INITIAL_ASSESSMENT_S - 1);
    expect(s.ai.BLUE!.log).toHaveLength(0);
    expect(Object.values(s.missions).some((m) => m.side === 'BLUE' && m.type === 'CAP')).toBe(false);
    stepSession(session, 5 * 60);
    const cap = Object.values(s.missions).find((m) => m.side === 'BLUE' && m.type === 'CAP');
    expect(cap).toBeDefined();
    expect(s.ai.BLUE!.posture).not.toBeNull();
    expect(s.ai.BLUE!.log.some((d) => d.level === 'strategic' && d.code === 'POSTURE')).toBe(true);
    expect(s.ai.BLUE!.log.some((d) => d.level === 'operative' && d.code === 'LAUNCH_CAP')).toBe(true);
    expect(s.units['blue-raf-1']!.status === 'airborne' || s.units['blue-raf-3']!.status === 'airborne').toBe(true);
  });

  it('ne dépend que de l’image de son camp : une unité adverse non détectée ne change pas ses ordres', () => {
    const a = freshState('BLUE');
    const b = freshState('BLUE');
    b.units['blue-raf-1']!.pos = { lat: 66, lon: -12 };
    b.units['blue-raf-2']!.weapons = 0;
    b.units['blue-frg']!.pos = { lat: 66.5, lon: -12.2 };
    const memA = createAiMemory('challenger', 'veteran');
    const memB = createAiMemory('challenger', 'veteran');
    const ordersA = decide(getSidePicture(a, 'RED'), memA);
    const ordersB = decide(getSidePicture(b, 'RED'), memB);
    expect(ordersA.length).toBeGreaterThan(0);
    expect(ordersB).toEqual(ordersA);
    expect(memB).toEqual(memA);
  });

  it('n’émet que des ordres pour son propre camp, acceptés par la validation commune', () => {
    const s = freshState('BLUE');
    const mem = createAiMemory('challenger', 'standard');
    const orders = decide(getSidePicture(s, 'RED'), mem);
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      expect(order.side).toBe('RED');
      expect(validateOrder(s, order).ok).toBe(true);
    }
  });

  it('aucun ordre de l’IA n’est refusé au cours de parties complètes', () => {
    for (const seed of [1, 2, 3, 4]) {
      const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: null, seed, difficulty: seed % 2 ? 'standard' : 'veteran' });
      runToEnd(session);
      for (const side of ['BLUE', 'RED'] as const) {
        const rejected = session.state.ai[side]!.log.filter((d) => d.code === 'ORDER_REJECTED');
        expect(rejected, `graine ${seed}, ${side}`).toEqual([]);
      }
    }
  });

  it('réagit aux pertes selon sa doctrine : repli si elle valorise la préservation, poursuite sinon', () => {
    const after = (preservation: number) => {
      const s = freshState('BLUE');
      s.doctrine.RED.preservation = preservation;
      const mem = createAiMemory('challenger', 'veteran');
      decide(getSidePicture(s, 'RED'), mem);
      expect(mem.posture === 'MASS_SWEEP' || mem.posture === 'ROTATING_PRESENCE').toBe(true);
      for (const id of ['red-su-1', 'red-su-2', 'red-su-3']) s.units[id]!.status = 'destroyed';
      const pic = getSidePicture(s, 'RED');
      pic.time += 30;
      const orders = decide(pic, mem);
      expect(mem.knownLosses).toBe(3);
      return { mem, orders };
    };

    const cautious = after(0.9);
    expect(cautious.mem.posture).toBe('WITHDRAW');
    expect(cautious.orders.every((o) => o.type === 'CANCEL_MISSION')).toBe(true);
    const last = cautious.mem.log.find((d) => d.code === 'POSTURE' && d.p.posture === 'WITHDRAW')!;
    expect(last.utilities.WITHDRAW).toBeGreaterThan(last.utilities.MASS_SWEEP!);

    expect(after(0).mem.posture).not.toBe('WITHDRAW');
  });

  it('passe en tir libre après un acte hostile constaté', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'RED', seed: 2 });
    const s = session.state;
    stepSession(session, 6 * 60);
    const cap = Object.values(s.missions).find((m) => m.side === 'BLUE' && m.type === 'CAP')!;
    expect(cap.roe).toBe('defensive');
    Object.values(s.contacts.BLUE)[0]!.hostileAct = true;
    stepSession(session, s.rules.aiWakeS + 1);
    expect(cap.roe).toBe('free');
    expect(s.ai.BLUE!.knownHostileAct).toBe(true);
  });

  it('se replie une fois l’objectif acquis', () => {
    const s = freshState('RED');
    const mem = createAiMemory('defender', 'veteran');
    const pic = getSidePicture(s, 'BLUE');
    pic.objective.perceived.sec.BLUE = pic.objective.defenderWinsAtSec + 1;
    decide(pic, mem);
    expect(mem.posture).toBe('WITHDRAW');
  });

  it('est déterministe : même image, même mémoire, mêmes tirages → mêmes ordres', () => {
    const run = () => {
      const s = freshState('BLUE', 99);
      const mem = createAiMemory('challenger', 'recrue');
      const orders = aiDecide(cloneData(getSidePicture(s, 'RED')), mem, () => rand(s.rng, 'ai:RED'));
      return JSON.stringify({ orders, mem });
    };
    expect(run()).toBe(run());
  });
});
