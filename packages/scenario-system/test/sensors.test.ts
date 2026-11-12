import { describe, expect, it } from 'vitest';
import { destination, getSidePicture, opponent, SIDES, type SimState } from '@warcommand/simulation-core';
import { detectionProbability, detectionRatio, observe, sensorSystem } from '@warcommand/air-operations';
import { freshState, SECTOR } from './helpers';

function airborne(s: SimState, id: string, pos: { lat: number; lon: number }, altM: number, headingDeg = 0) {
  const u = s.units[id]!;
  u.status = 'airborne';
  u.pos = { ...pos };
  u.altM = altM;
  u.headingDeg = headingDeg;
  return u;
}

describe('détection', () => {
  it('est impossible hors de portée, sous l’horizon radar ou hors du secteur balayé', () => {
    const s = freshState();
    const awacs = s.units['blue-awacs']!;
    const frigate = s.units['blue-frg']!;
    const rafale = airborne(s, 'blue-raf-1', SECTOR, 9000, 0);

    // Hors de portée : l'AWACS ne voit pas un chasseur à 600 km.
    const far = airborne(s, 'red-su-1', destination(awacs.pos, 30, 600), 9000);
    expect(detectionRatio(s, awacs, far)).toBe(0);

    // À portée et en altitude : détectable.
    far.pos = destination(awacs.pos, 30, 250);
    expect(detectionRatio(s, awacs, far)).toBeGreaterThan(0);

    // Sous l'horizon : la frégate ne voit pas un avion très bas à 120 km, mais le voit en altitude.
    const low = airborne(s, 'red-su-2', destination(frigate.pos, 45, 120), 150);
    expect(detectionRatio(s, frigate, low)).toBe(0);
    low.altM = 9000;
    expect(detectionRatio(s, frigate, low)).toBeGreaterThan(0);

    // Secteur balayé : le radar de nez ne voit pas derrière lui.
    const behind = airborne(s, 'red-su-3', destination(rafale.pos, 180, 60), 9000);
    expect(detectionRatio(s, rafale, behind)).toBe(0);
    behind.pos = destination(rafale.pos, 10, 60);
    expect(detectionRatio(s, rafale, behind)).toBeGreaterThan(0);

    // Un appareil au sol n'émet pas.
    rafale.status = 'ready';
    sensorSystem(s);
    expect(detectionProbability(s, 0)).toBe(0);
  });

  it('la probabilité décroît avec la distance et reste dans [0, pDetectMax]', () => {
    const s = freshState();
    let previous = Infinity;
    for (const ratio of [0.05, 0.3, 0.6, 0.9, 1]) {
      const p = detectionProbability(s, ratio);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(s.rules.pDetectMax);
      expect(p).toBeLessThan(previous);
      previous = p;
    }
  });

  it('une signature plus faible réduit la portée de détection', () => {
    const s = freshState();
    const awacs = s.units['blue-awacs']!;
    const target = airborne(s, 'red-su-1', destination(awacs.pos, 30, 300), 9000);
    const normal = detectionRatio(s, awacs, target);
    s.platforms.su35s!.signature = 0.1;
    const stealthy = detectionRatio(s, awacs, target);
    expect(stealthy === 0 || stealthy > normal).toBe(true);
  });
});

describe('brouillard de guerre', () => {
  it('au départ, un camp ne connaît que son renseignement initial', () => {
    const s = freshState();
    for (const side of SIDES) {
      const pic = getSidePicture(s, side);
      expect(pic.units.every((u) => u.side === side)).toBe(true);
      expect(pic.missions.every((m) => m.side === side)).toBe(true);
      expect(pic.contacts).toHaveLength(1);
      const intel = pic.contacts[0]!;
      expect(intel).toMatchObject({ identified: true, stale: true, fixed: true, kind: 'sam' });
      expect(intel.ageS).toBe(180 * 60);
    }
  });

  it('l’image d’un camp ne contient aucun identifiant de vérité-terrain adverse', () => {
    const s = freshState(null);
    // On crée des pistes sur toutes les unités adverses observables, pour le pire cas.
    for (const side of SIDES) {
      for (const u of Object.values(s.units)) if (u.side === opponent(side)) observe(s, side, u, true);
    }
    for (const side of SIDES) {
      const json = JSON.stringify(getSidePicture(s, side));
      expect(json).not.toContain('"unitId"');
      for (const u of Object.values(s.units)) {
        if (u.side !== side) expect(json, `fuite de ${u.id}`).not.toContain(`"${u.id}"`);
      }
      for (const m of Object.values(s.missions)) {
        if (m.side !== side) expect(json).not.toContain(`"${m.id}"`);
      }
    }
  });

  it('modifier une unité adverse non détectée ne change rien à l’image', () => {
    const a = freshState();
    const b = freshState();
    const hidden = b.units['red-su-1']!;
    hidden.pos = { lat: 69, lon: -9 };
    hidden.fuelKg = 1;
    hidden.weapons = 0;
    b.units['red-frg']!.pos = { lat: 68.4, lon: -7 };
    b.missions[Object.keys(b.missions).find((id) => id.startsWith('RED'))!]!.roe = 'free';
    expect(JSON.stringify(getSidePicture(b, 'BLUE'))).toBe(JSON.stringify(getSidePicture(a, 'BLUE')));
  });

  it('une piste vieillit, devient incertaine, puis est abandonnée', () => {
    const s = freshState();
    const target = airborne(s, 'red-su-1', destination(SECTOR, 0, 30), 9000, 180);
    target.speedKmh = 900;
    const c = observe(s, 'BLUE', target, false);
    expect(c.identified).toBe(false);
    const id = c.id;

    // La cible se pose : plus aucun capteur ne peut l'entretenir.
    target.status = 'ready';
    const tick = (seconds: number) => {
      for (let i = 0; i < seconds; i++) {
        s.time += 1;
        sensorSystem(s);
      }
    };
    tick(s.rules.staleAfterS + s.rules.sensorIntervalS);
    let view = getSidePicture(s, 'BLUE').contacts.find((k) => k.id === id)!;
    expect(view.stale).toBe(true);
    expect(view.identified).toBe(false);
    expect(view.uncertaintyKm).toBeGreaterThan(0);
    const early = view.uncertaintyKm;

    tick(120);
    view = getSidePicture(s, 'BLUE').contacts.find((k) => k.id === id)!;
    expect(view.uncertaintyKm).toBeGreaterThan(early);

    tick(s.rules.dropAirAfterS);
    expect(getSidePicture(s, 'BLUE').contacts.some((k) => k.id === id)).toBe(false);
    expect(s.events.some((e) => e.code === 'CONTACT_LOST' && e.p.contact === id)).toBe(true);
  });

  it('une piste est d’abord non identifiée, puis identifiée à force d’observations', () => {
    const s = freshState();
    const awacs = s.units['blue-awacs']!;
    airborne(s, 'red-su-1', destination(awacs.pos, 40, 150), 9000, 220);
    const track = () => Object.values(s.contacts.BLUE).find((k) => k.unitId === 'red-su-1');
    let firstSeenUnidentified = false;
    for (let i = 0; i < 600; i++) {
      s.time += 1;
      sensorSystem(s);
      const c = track();
      if (c && !c.identified) firstSeenUnidentified = true;
      if (c?.identified) break;
    }
    const c = track()!;
    expect(firstSeenUnidentified).toBe(true);
    expect(c.identified).toBe(true);
    expect(c.label).toBe('Su-35S');
    const codes = s.events.filter((e) => e.vis.includes('BLUE')).map((e) => e.code);
    expect(codes.indexOf('CONTACT_NEW')).toBeLessThan(codes.indexOf('CONTACT_IDENTIFIED'));
    // L'autre camp ne voit pas ces événements.
    expect(s.events.some((e) => e.code === 'CONTACT_NEW' && e.vis.includes('RED') && e.p.contact === c.id)).toBe(false);
  });
});
