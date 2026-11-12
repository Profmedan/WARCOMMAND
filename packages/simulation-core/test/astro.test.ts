import { describe, expect, it } from 'vitest';
import { isNight, solarElevationDeg } from '../src/index';

const at = (iso: string) => Date.parse(iso);

describe('hauteur du soleil', () => {
  it('est proche du zénith à midi à l’équateur lors de l’équinoxe, et sous l’horizon à minuit', () => {
    expect(solarElevationDeg(at('2024-03-20T12:07:00Z'), { lat: 0, lon: 0 })).toBeGreaterThan(87);
    expect(solarElevationDeg(at('2024-03-20T00:07:00Z'), { lat: 0, lon: 0 })).toBeLessThan(-85);
  });

  it('retrouve la hauteur de midi à Paris au solstice d’été (≈ 64,6°)', () => {
    const h = solarElevationDeg(at('2024-06-21T11:52:00Z'), { lat: 48.85, lon: 2.35 });
    expect(h).toBeGreaterThan(63.6);
    expect(h).toBeLessThan(65.6);
  });

  it('reproduit le soleil de minuit et la nuit polaire à 70° N', () => {
    // Solstice d'été, minuit solaire : hauteur ≈ 70 + 23,44 − 90 = 3,4°.
    const midnightSun = solarElevationDeg(at('2024-06-21T00:00:00Z'), { lat: 70, lon: 0 });
    expect(midnightSun).toBeGreaterThan(2);
    expect(midnightSun).toBeLessThan(5);
    // Solstice d'hiver, midi solaire : hauteur ≈ 90 − 70 − 23,44 = −3,4°.
    const polarNoon = solarElevationDeg(at('2024-12-21T12:00:00Z'), { lat: 70, lon: 0 });
    expect(polarNoon).toBeLessThan(-2);
    expect(polarNoon).toBeGreaterThan(-5);
  });

  it('dépend de la longitude : le soleil se lève plus tôt à l’est', () => {
    const t = at('2024-03-20T06:00:00Z');
    expect(solarElevationDeg(t, { lat: 0, lon: 30 })).toBeGreaterThan(solarElevationDeg(t, { lat: 0, lon: -30 }));
  });

  it('classe le jour et la nuit au-dessus du secteur du scénario', () => {
    const sector = { lat: 67, lon: -11 };
    expect(isNight('2031-03-14T08:40:00Z', 0, sector, -6)).toBe(false);
    expect(isNight('2031-03-14T08:40:00Z', 13 * 3600 + 20 * 60, sector, -6)).toBe(true); // 22:00 Z
  });
});
