import { describe, expect, it } from 'vitest';
import { createSession, runToEnd, TETE_DE_PONT } from '@warcommand/scenario-system';
import { buildAar } from '../src/index';

describe('compte rendu après action — interarmées', () => {
  const session = createSession(TETE_DE_PONT, { playerSide: null, seed: 3 });
  runToEnd(session);
  const s = session.state;
  const aar = buildAar(s);
  const row = (id: string) => aar.sides[s.units[id]!.side].units.find((u) => u.name === s.units[id]!.name)!;

  it('donne pour chaque formation terrestre ses effectifs restants, et rien pour les autres unités', () => {
    const mech = s.units['blue-meca']!;
    expect(row('blue-meca').kind).toBe('mech');
    expect(row('blue-meca').strengthPct).toBe(Math.round(mech.land!.strength * 100));
    expect(row('blue-raf-1').strengthPct).toBeNull();
    expect(row('blue-pa').strengthPct).toBeNull();
    // Des formations ont souffert : le compte rendu doit le montrer.
    const formations = [...aar.sides.BLUE.units, ...aar.sides.RED.units].filter((u) => u.strengthPct !== null);
    expect(formations.length).toBeGreaterThanOrEqual(12);
    expect(formations.some((u) => u.strengthPct! < 100)).toBe(true);
  });

  it('donne pour chaque bâtiment l’état de sa coque', () => {
    const carrier = s.units['blue-pa']!;
    expect(row('blue-pa').hull).toEqual({ left: carrier.naval!.hull, of: s.platforms[carrier.platformId]!.hull });
    expect(row('blue-meca').hull).toBeNull();
    expect(row('blue-raf-1').hull).toBeNull();
  });

  it('donne la phase de chaque équipe spéciale', () => {
    expect(row('blue-fs').sofPhase).toBe(s.units['blue-fs']!.sof!.phase);
    expect(row('blue-meca').sofPhase).toBeNull();
  });
});
