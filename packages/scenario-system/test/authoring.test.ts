import { describe, expect, it } from 'vitest';
import { cloneData, getSidePicture, type AiMemory, type SidePicture } from '@warcommand/simulation-core';
import { aiDecide, createAiMemory } from '@warcommand/ai-commander';
import { BOUCLIER_ATLANTIQUE_INPUT, createInitialState, createSession, parseScenario, stepSession, type ScenarioInput } from '../src/index';
import { freshState } from './helpers';

const decide = (pic: SidePicture, mem: AiMemory) => aiDecide(cloneData(pic), mem, () => 0.5);

function variant(mutate: (sc: ScenarioInput) => void) {
  const input = cloneData(BOUCLIER_ATLANTIQUE_INPUT);
  mutate(input);
  return parseScenario(input);
}

describe('doctrine réglable par scénario', () => {
  it('applique les réglages propres au scénario par-dessus le profil choisi', () => {
    const parsed = variant((sc) => {
      sc.sides.RED.doctrineOverrides = { masse: 0.1, agressivite: 1 };
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = createInitialState(parsed.scenario, { playerSide: 'BLUE', difficulty: 'standard', seed: 1 });
    // Profil « rouge-centralisee » : préservation 0,4 ; centralisation 0,85 — inchangés.
    expect(s.doctrine.RED).toMatchObject({ masse: 0.1, agressivite: 1, preservation: 0.4, centralisation: 0.85 });
    expect(s.doctrine.BLUE.masse).toBe(0.4);
  });

  it('refuse un paramètre de doctrine inconnu ou hors de l’intervalle 0–1', () => {
    expect(variant((sc) => void ((sc.sides.RED as { doctrineOverrides: unknown }).doctrineOverrides = { vitesse: 0.5 })).ok).toBe(false);
    expect(variant((sc) => void (sc.sides.RED.doctrineOverrides = { masse: 1.5 })).ok).toBe(false);
  });
});

describe('comportement initial de l’IA', () => {
  it('l’IA tient la posture imposée jusqu’à l’échéance, même après une perte, puis reprend sa liberté', () => {
    const s = freshState('BLUE');
    // Sans contrainte, cette IA choisit d'emblée le balayage en masse (0,70 contre 0,69).
    const free = createAiMemory('challenger', 'veteran');
    decide(getSidePicture(s, 'RED'), free);
    expect(free.posture).toBe('MASS_SWEEP');

    const mem = createAiMemory('challenger', 'veteran', { posture: 'WITHDRAW', untilS: 1200 });
    const first = decide(getSidePicture(s, 'RED'), mem);
    expect(mem.posture).toBe('WITHDRAW');
    expect(first.filter((o) => o.type === 'CREATE_MISSION')).toHaveLength(0);
    expect(mem.log.find((d) => d.code === 'POSTURE')!.p).toMatchObject({ posture: 'WITHDRAW', forced: 1 });

    s.units['red-su-1']!.status = 'destroyed';
    const mid = getSidePicture(s, 'RED');
    mid.time = 600;
    decide(mid, mem);
    expect(mem.posture).toBe('WITHDRAW');

    const late = getSidePicture(s, 'RED');
    late.time = 1260;
    const orders = decide(late, mem);
    expect(mem.posture).not.toBe('WITHDRAW');
    expect(orders.some((o) => o.type === 'CREATE_MISSION')).toBe(true);
  });

  it('un scénario peut retenir l’IA au sol pendant les premières minutes', () => {
    const parsed = variant((sc) => {
      sc.sides.RED.aiInitialPosture = 'WITHDRAW';
      sc.sides.RED.aiPostureLockMin = 20;
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const session = createSession(parsed.scenario, { playerSide: 'BLUE', seed: 4 });
    const s = session.state;
    expect(s.ai.RED).toMatchObject({ forcedPosture: 'WITHDRAW', forcedUntil: 1200 });
    const redSorties = () => s.stats.RED.sorties;
    stepSession(session, 19 * 60);
    expect(redSorties()).toBe(0);
    stepSession(session, 12 * 60);
    expect(redSorties()).toBeGreaterThan(0);
  });

  it('la contrainte ne s’applique qu’à un camp confié à l’IA', () => {
    const parsed = variant((sc) => {
      sc.sides.RED.aiInitialPosture = 'WITHDRAW';
      sc.sides.RED.aiPostureLockMin = 20;
    });
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const s = createInitialState(parsed.scenario, { playerSide: 'RED', difficulty: 'standard', seed: 1 });
    expect(s.ai.RED).toBeNull();
    expect(s.ai.BLUE).toMatchObject({ forcedPosture: null });
  });

  it('refuse une posture qui ne correspond pas au rôle du camp, ou une durée sans posture', () => {
    // ROUGE est le challenger : la patrouille permanente est une posture de défenseur.
    const wrongRole = variant((sc) => void (sc.sides.RED.aiInitialPosture = 'STANDING_CAP'));
    expect(wrongRole.ok).toBe(false);
    if (!wrongRole.ok) expect(wrongRole.errors.join(' ')).toMatch(/posture/);
    expect(variant((sc) => void (sc.sides.BLUE.aiInitialPosture = 'MASS_SWEEP')).ok).toBe(false);
    expect(variant((sc) => void (sc.sides.BLUE.aiInitialPosture = 'STANDING_CAP')).ok).toBe(true);
    expect(variant((sc) => void (sc.sides.RED.aiPostureLockMin = 15)).ok).toBe(false);
  });
});
