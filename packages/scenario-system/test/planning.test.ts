import { describe, expect, it } from 'vitest';
import { stepState } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, estimateMission, validateOrder } from '@warcommand/air-operations';
import { draft, freshState, SECTOR } from './helpers';

/**
 * Valeurs de référence calculées à la main pour un Rafale (4 700 kg, 50 kg/min en croisière,
 * 900 km/h) allant de la Base Bouclier au centre du secteur, soit environ 245 km :
 *   transit 16,3 min · 816 kg brûlés · 82,6 % à l'arrivée
 *   seuil de retour sur zone : 816 × 1,25 + 235 = 1 255 kg · autonomie (3 884 − 1 255) / 50 = 52,6 min
 */
describe('estimation d’une mission', () => {
  it('donne le transit, le carburant à l’arrivée et l’autonomie sur zone d’une patrouille', () => {
    const s = freshState();
    const e = estimateMission(s, 'BLUE', draft({ unitIds: ['blue-raf-1'], waypoints: [SECTOR], launchAt: 0 }))!;
    expect(e.departAt).toBe(120);
    expect(e.transitMin).toBeGreaterThan(15.8);
    expect(e.transitMin).toBeLessThan(16.8);
    expect(e.arrivalAt).toBeGreaterThan(1060);
    expect(e.arrivalAt).toBeLessThan(1140);
    expect(e.fuelOnArrivalPct).toBeGreaterThan(81.6);
    expect(e.fuelOnArrivalPct).toBeLessThan(83.6);
    expect(e.onStationMin).toBeGreaterThan(51.1);
    expect(e.onStationMin).toBeLessThan(54.1);
    expect(e.limitingUnitId).toBe('blue-raf-1');
  });

  it('concorde avec le vol réel à quelques minutes près', () => {
    const s = freshState();
    const d = draft({ unitIds: ['blue-raf-1'], waypoints: [SECTOR], launchAt: 0 });
    const estimate = estimateMission(s, 'BLUE', d)!;
    applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: d });
    const u = s.units['blue-raf-1']!;
    let onStationAt = 0;
    let leftAt = 0;
    for (let i = 0; i < 100 * 60 && leftAt === 0; i++) {
      stepState(s, AIR_SYSTEMS);
      if (onStationAt === 0 && u.task === 'station') onStationAt = s.time;
      if (onStationAt > 0 && u.task === 'rtb') leftAt = s.time;
    }
    expect(leftAt).toBeGreaterThan(0);
    expect(Math.abs((leftAt - onStationAt) / 60 - estimate.onStationMin)).toBeLessThan(4);
    expect(Math.abs(onStationAt - estimate.arrivalAt)).toBeLessThan(120);
  });

  it('tient compte de la basse altitude et du régime rapide', () => {
    const s = freshState();
    // Basse altitude (×1,5) : 1 225 kg en transit, seuil 1 766 kg, autonomie (3 475 − 1 766) / 75 = 22,8 min.
    const low = estimateMission(s, 'BLUE', draft({ unitIds: ['blue-raf-1'], waypoints: [SECTOR], altM: 500 }))!;
    expect(low.onStationMin).toBeGreaterThan(21.3);
    expect(low.onStationMin).toBeLessThan(24.3);
    // Régime rapide : 9,8 min à 230 kg/min = 2 253 kg, autonomie (2 447 − 1 255) / 50 = 23,8 min.
    const dash = estimateMission(s, 'BLUE', draft({ unitIds: ['blue-raf-1'], waypoints: [SECTOR], speed: 'dash' }))!;
    expect(dash.transitMin).toBeGreaterThan(9.3);
    expect(dash.transitMin).toBeLessThan(10.3);
    expect(dash.onStationMin).toBeGreaterThan(22.3);
    expect(dash.onStationMin).toBeLessThan(25.3);
  });

  it('part de la position et du carburant actuels pour un appareil en vol, et retient l’appareil le plus limité', () => {
    const s = freshState();
    for (const [id, fuel] of [['blue-raf-1', 3000], ['blue-raf-2', 2000]] as const) {
      const u = s.units[id]!;
      u.status = 'airborne';
      u.pos = { ...SECTOR };
      u.altM = 9000;
      u.fuelKg = fuel;
    }
    const one = estimateMission(s, 'BLUE', draft({ unitIds: ['blue-raf-1'], waypoints: [SECTOR] }))!;
    expect(one.departAt).toBe(0);
    expect(one.transitMin).toBe(0);
    // (3 000 − 1 255) / 50 = 34,9 min
    expect(one.onStationMin).toBeGreaterThan(33.4);
    expect(one.onStationMin).toBeLessThan(36.4);
    const both = estimateMission(s, 'BLUE', draft({ unitIds: ['blue-raf-1', 'blue-raf-2'], waypoints: [SECTOR] }))!;
    expect(both.limitingUnitId).toBe('blue-raf-2');
    // (2 000 − 1 255) / 50 = 14,9 min
    expect(both.onStationMin).toBeGreaterThan(13.4);
    expect(both.onStationMin).toBeLessThan(16.4);
  });

  it('ne donne rien pour une mission sans destination', () => {
    const s = freshState();
    expect(estimateMission(s, 'BLUE', draft({ unitIds: ['blue-raf-1'], waypoints: [] }))).toBeNull();
    expect(estimateMission(s, 'BLUE', draft({ unitIds: [], waypoints: [SECTOR] }))).toBeNull();
  });
});

describe('rayon d’action et ravitailleur', () => {
  // À environ 626 km de la base : l'aller-retour direct demande ≈ 4 825 kg, plus que les 4 700 kg emportés.
  const FAR = { lat: 70.5, lon: -8.8 };

  it('une station hors rayon direct devient accessible si le ravitaillement est autorisé et qu’un ravitailleur est en vol', () => {
    const s = freshState();
    const order = (allowRefuel: boolean) => validateOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['blue-raf-1'], waypoints: [FAR], allowRefuel }) });
    expect(order(false)).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    expect(order(true).ok).toBe(true);
  });

  it('sans carburant à céder, le ravitailleur n’étend pas le rayon d’action', () => {
    const s = freshState();
    s.units['blue-tanker']!.transferKg = 0;
    const res = validateOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['blue-raf-1'], waypoints: [FAR], allowRefuel: true }) });
    expect(res).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
  });
});
