import { describe, expect, it } from 'vitest';
import { cloneData, destination, distanceKm, stepState, type SimState, type Unit } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, validateOrder } from '@warcommand/air-operations';
import { BOUCLIER_ATLANTIQUE_INPUT, createInitialState, parseScenario } from '../src/index';
import { draft, freshState } from './helpers';

const run = (s: SimState, steps: number) => {
  for (let i = 0; i < steps; i++) stepState(s, AIR_SYSTEMS);
};

/** Place un appareil en finale, à 5 km de sa base, en retour sur ordre. */
function onFinal(s: SimState, id: string): Unit {
  const u = s.units[id]!;
  u.status = 'airborne';
  u.altM = 3000;
  u.pos = destination(s.bases[u.baseId!]!.pos, 0, 5);
  u.task = 'rtb';
  u.rtbReason = 'order';
  u.fuelKg = 2000;
  return u;
}

describe('formation', () => {
  it('les appareils d’une même mission volent décalés, jamais confondus ni dispersés', () => {
    const s = freshState();
    const ids = ['blue-raf-1', 'blue-raf-2', 'blue-raf-3', 'blue-raf-4'];
    expect(applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ids, launchAt: 0 }) }).ok).toBe(true);
    expect(ids.map((id) => s.units[id]!.slot)).toEqual([0, 1, 2, 3]);

    run(s, 8 * 60);
    for (let minute = 0; minute < 20; minute++) {
      run(s, 60);
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const d = distanceKm(s.units[ids[a]!]!.pos, s.units[ids[b]!]!.pos);
          expect(d, `${ids[a]} / ${ids[b]} à t=${s.time}`).toBeGreaterThan(1);
          expect(d).toBeLessThan(12);
        }
      }
    }
  });
});

describe('disponibilité', () => {
  it('sans panne, la remise en condition dure exactement le délai du matériel', () => {
    const s = freshState();
    s.platforms.rafale!.reliability = 1;
    const u = onFinal(s, 'blue-raf-1');
    run(s, 60);
    expect(u.status).toBe('turnaround');
    expect(u.fault).toBe(false);
    const landedAt = s.events.find((e) => e.code === 'UNIT_LANDED')!.t;
    expect(u.readyAt).toBe(landedAt + 25 * 60);
    expect(s.events.some((e) => e.code === 'UNIT_FAULT')).toBe(false);
  });

  it('une panne à l’atterrissage allonge la remise en condition de 20 à 45 minutes', () => {
    const s = freshState();
    s.platforms.rafale!.reliability = 0;
    const u = onFinal(s, 'blue-raf-1');
    run(s, 60);
    expect(u.status).toBe('turnaround');
    expect(u.fault).toBe(true);
    const landedAt = s.events.find((e) => e.code === 'UNIT_LANDED')!.t;
    const extra = u.readyAt! - landedAt - 25 * 60;
    expect(extra).toBeGreaterThanOrEqual(20 * 60);
    expect(extra).toBeLessThanOrEqual(45 * 60);
    expect(s.events.some((e) => e.code === 'UNIT_FAULT' && e.vis.length === 1 && e.vis[0] === 'BLUE')).toBe(true);
    // L'appareil ne peut pas repartir avant la fin de la réparation.
    const early = validateOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: [u.id], launchAt: landedAt + 26 * 60 }) });
    expect(early).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });

    run(s, u.readyAt! - s.time + 1);
    expect(u.status).toBe('ready');
    expect(u.fault).toBe(false);
  });

  it('un appareil endommagé est réparé après trois heures, puis de nouveau disponible', () => {
    const s = freshState();
    const u = onFinal(s, 'blue-raf-1');
    u.damaged = true;
    u.weapons = 1;
    run(s, 60);
    expect(u.status).toBe('maintenance');
    const landedAt = s.events.find((e) => e.code === 'UNIT_LANDED')!.t;
    expect(u.readyAt).toBe(landedAt + 3 * 3600);

    run(s, 3 * 3600 - 120);
    expect(u.status).toBe('maintenance');
    run(s, 200);
    expect(u.status).toBe('ready');
    expect(u.damaged).toBe(false);
    expect(u.weapons).toBe(6);
    expect(u.fuelKg).toBe(4700);
  });

  it('un scénario peut déclarer un appareil indisponible au départ', () => {
    const input = cloneData(BOUCLIER_ATLANTIQUE_INPUT);
    input.units[3]!.unavailableForMin = 30;
    input.missions = input.missions.filter((m) => m.type !== 'CAP');
    const parsed = parseScenario(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = createInitialState(parsed.scenario, { playerSide: 'BLUE', difficulty: 'standard', seed: 1 });
    const u = s.units['blue-raf-4']!;
    expect(u.status).toBe('turnaround');
    expect(u.readyAt).toBe(30 * 60);
    expect(validateOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: [u.id], launchAt: 600 }) })).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });
    run(s, 30 * 60 + 1);
    expect(u.status).toBe('ready');
  });

  it('refuse qu’une unité de surface soit déclarée en maintenance', () => {
    const input = cloneData(BOUCLIER_ATLANTIQUE_INPUT);
    input.units[7]!.unavailableForMin = 10;
    const parsed = parseScenario(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(' ')).toMatch(/réservé aux aéronefs/);
  });
});
