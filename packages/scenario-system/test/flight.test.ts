import { describe, expect, it } from 'vitest';
import { checkInvariants, distanceKm, snapshotPositions, stepState } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, bingoFuelKg, perfOf } from '@warcommand/air-operations';
import { draft, freshState, SECTOR } from './helpers';

function run(s: ReturnType<typeof freshState>, steps: number, each?: () => void): void {
  for (let i = 0; i < steps; i++) {
    const before = snapshotPositions(s);
    stepState(s, AIR_SYSTEMS);
    // Le décompte de contrôle n'est pas tenu ici (pas de système d'objectif) : on l'aligne pour l'invariant.
    s.objective.sec.BLUE = s.time;
    expect(checkInvariants(s, before)).toEqual([]);
    each?.();
  }
}

describe('vol, carburant et remise en condition', () => {
  it('décolle à l’heure prévue, rejoint sa station et la tient', () => {
    const s = freshState();
    const res = applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['blue-raf-1', 'blue-raf-2'], launchAt: 300 }) });
    expect(res.ok).toBe(true);
    const u = s.units['blue-raf-1']!;
    run(s, 299);
    expect(u.status).toBe('ready');
    run(s, 2);
    expect(u.status).toBe('airborne');
    expect(s.stats.BLUE.sorties).toBe(2);
    run(s, 20 * 60);
    expect(u.task).toBe('station');
    expect(distanceKm(u.pos, SECTOR)).toBeLessThan(s.rules.racetrackHalfKm + 1);
    expect(s.events.some((e) => e.code === 'MISSION_ON_STATION')).toBe(true);
  });

  it('consomme du carburant sans jamais passer sous zéro, rentre au bingo, se pose et est remis en condition', () => {
    const s = freshState();
    applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['blue-raf-1'], launchAt: 0 }) });
    const u = s.units['blue-raf-1']!;
    const p = perfOf(s, u);
    const base = s.bases['base-bouclier']!;
    const stock = { weapons: base.weaponStock, fuel: base.fuelStockKg };
    let last = u.fuelKg;
    let sawRtb = false;
    let fuelAtRtb = 0;
    let bingoAtRtb = 0;

    run(s, 100 * 60, () => {
      if (u.status === 'airborne') {
        expect(u.fuelKg).toBeLessThanOrEqual(last);
        last = u.fuelKg;
        if (u.task === 'rtb' && !sawRtb) {
          sawRtb = true;
          fuelAtRtb = u.fuelKg;
          bingoAtRtb = bingoFuelKg(s, u);
        }
      }
    });

    expect(sawRtb).toBe(true);
    expect(s.events.some((e) => e.code === 'UNIT_RTB' && e.p.reason === 'fuel')).toBe(true);
    // Le retour est déclenché au seuil, pas après.
    expect(fuelAtRtb).toBeGreaterThan(bingoAtRtb * 0.97);
    expect(u.status).toBe('turnaround');
    expect(u.fuelKg).toBeGreaterThan(0);
    expect(distanceKm(u.pos, base.pos)).toBe(0);

    u.weapons = 2;
    const burned = p.fuelCapacityKg - u.fuelKg;
    run(s, p.turnaroundMin * 60 + 5);
    expect(u.status).toBe('ready');
    expect(u.fuelKg).toBe(p.fuelCapacityKg);
    expect(u.weapons).toBe(p.weaponCount);
    expect(base.weaponStock).toBe(stock.weapons - (p.weaponCount - 2));
    expect(base.fuelStockKg).toBeCloseTo(stock.fuel - burned, 6);
  });

  it('perd l’appareil en cas de panne sèche', () => {
    const s = freshState();
    applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['blue-raf-1'], launchAt: 0 }) });
    run(s, 15 * 60);
    const u = s.units['blue-raf-1']!;
    expect(u.status).toBe('airborne');
    u.fuelKg = 20;
    run(s, 60);
    expect(u.status).toBe('destroyed');
    expect(u.fuelKg).toBe(0);
    expect(s.stats.BLUE.losses.fighter).toBe(1);
    expect(s.events.some((e) => e.code === 'UNIT_LOST_FUEL')).toBe(true);
  });

  it('ravitaille en vol : ce que reçoit le chasseur est exactement ce que cède le ravitailleur', () => {
    const s = freshState();
    applyOrder(s, {
      type: 'CREATE_MISSION',
      side: 'BLUE',
      draft: draft({ unitIds: ['blue-raf-1'], launchAt: 0, allowRefuel: true, waypoints: [{ lat: 66.2, lon: -12.0 }] }),
    });
    const u = s.units['blue-raf-1']!;
    const tanker = s.units['blue-tanker']!;
    const p = perfOf(s, u);
    const pool = tanker.transferKg;
    run(s, 10 * 60);
    expect(u.status).toBe('airborne');
    u.fuelKg = p.fuelCapacityKg * 0.3;

    let joined = false;
    let received = 0;
    let previous = u.fuelKg;
    let peak = u.fuelKg;
    run(s, 25 * 60, () => {
      if (u.task === 'refueling') joined = true;
      if (u.fuelKg > previous) received += u.fuelKg - previous;
      previous = u.fuelKg;
      peak = Math.max(peak, u.fuelKg);
    });

    expect(joined).toBe(true);
    expect(s.events.some((e) => e.code === 'REFUEL_START')).toBe(true);
    expect(s.events.some((e) => e.code === 'REFUEL_END')).toBe(true);
    expect(peak).toBeGreaterThan(p.fuelCapacityKg * 0.95);
    expect(peak).toBeLessThanOrEqual(p.fuelCapacityKg);
    expect(pool - tanker.transferKg).toBeCloseTo(s.stats.BLUE.fuelTransferredKg, 6);
    // Le chasseur brûle du carburant pendant le transfert : il a reçu au moins son gain net.
    expect(s.stats.BLUE.fuelTransferredKg).toBeGreaterThanOrEqual(received - 1e-6);
    expect(u.task === 'transit' || u.task === 'station').toBe(true);
  });

  it('sans ravitaillement autorisé, le même appareil rentre à la base', () => {
    const s = freshState();
    applyOrder(s, {
      type: 'CREATE_MISSION',
      side: 'BLUE',
      draft: draft({ unitIds: ['blue-raf-1'], launchAt: 0, allowRefuel: false, waypoints: [{ lat: 66.2, lon: -12.0 }] }),
    });
    const u = s.units['blue-raf-1']!;
    run(s, 10 * 60);
    u.fuelKg = perfOf(s, u).fuelCapacityKg * 0.12;
    run(s, 60);
    expect(u.task).toBe('rtb');
    expect(s.stats.BLUE.fuelTransferredKg).toBe(0);
  });
});
