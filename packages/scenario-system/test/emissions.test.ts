import { describe, expect, it } from 'vitest';
import { cloneData, destination, type SimState, type Unit } from '@warcommand/simulation-core';
import { applyOrder, engagementSystem, missionSystem, observe, sensorSystem } from '@warcommand/air-operations';
import { BOUCLIER_ATLANTIQUE_INPUT, createInitialState, parseScenario } from '../src/index';
import { draft, freshState, putOnCap } from './helpers';

/** Loin de tout autre capteur des deux camps. */
const REMOTE = { lat: 63.0, lon: -3.0 };

function fly(s: SimState, id: string, pos: { lat: number; lon: number }, headingDeg: number, altM = 9000): Unit {
  const u = s.units[id]!;
  u.status = 'airborne';
  u.pos = { ...pos };
  u.altM = altM;
  u.headingDeg = headingDeg;
  return u;
}

function sweeps(s: SimState, n: number): void {
  for (let i = 0; i < n * s.rules.sensorIntervalS; i++) {
    s.time += 1;
    sensorSystem(s);
  }
}

const track = (s: SimState, side: 'BLUE' | 'RED', unitId: string) => Object.values(s.contacts[side]).find((c) => c.unitId === unitId);

/** Met un chasseur rouge en patrouille sur place, avec ou sans silence radar. */
function redCap(s: SimState, u: Unit, emcon: boolean): void {
  const res = applyOrder(s, { type: 'CREATE_MISSION', side: 'RED', draft: draft({ unitIds: [u.id], waypoints: [u.pos], roe: 'free', launchAt: s.time, emcon }) });
  expect(res.ok).toBe(true);
  missionSystem(s);
}

describe('émissions radar et écoute passive', () => {
  it('un radar qui émet est repéré au-delà de la portée de détection radar de l’observateur', () => {
    const s = freshState();
    const rafale = fly(s, 'blue-raf-1', REMOTE, 90);
    // À 210 km : hors de portée du radar du Rafale (≈ 171 km), mais dans le rayon d'écoute (190 × 1,2 = 228 km).
    const sukhoi = fly(s, 'red-su-1', destination(rafale.pos, 90, 210), 270);
    sweeps(s, 12);
    const c = track(s, 'BLUE', sukhoi.id);
    expect(c).toBeDefined();
    expect(c!.source).toBe('esm');
    expect(c!.radarSeenAt).toBeLessThan(0);
    // Le type d'émetteur finit par être reconnu.
    expect(c!.identified).toBe(true);
    expect(c!.label).toBe('Su-35S');
  });

  it('au-delà du rayon d’écoute, rien n’est repéré', () => {
    const s = freshState();
    const rafale = fly(s, 'blue-raf-1', REMOTE, 90);
    const sukhoi = fly(s, 'red-su-1', destination(rafale.pos, 90, 240), 270);
    sweeps(s, 12);
    expect(track(s, 'BLUE', sukhoi.id)).toBeUndefined();
  });

  it('en silence radar, le même appareil n’est pas repéré', () => {
    const s = freshState();
    const rafale = fly(s, 'blue-raf-1', REMOTE, 90);
    const sukhoi = fly(s, 'red-su-1', destination(rafale.pos, 90, 210), 270);
    redCap(s, sukhoi, true);
    sweeps(s, 12);
    expect(track(s, 'BLUE', sukhoi.id)).toBeUndefined();
  });

  it('un appareil en silence radar ne détecte rien par son propre radar', () => {
    const detected = (emcon: boolean) => {
      const s = freshState();
      // Le Rafale est lui-même silencieux, pour que seule la détection radar du Su-35 soit en cause.
      const rafale = putOnCap(s, 'blue-raf-1', REMOTE, 90, 'hold');
      s.missions[rafale.missionId!]!.emcon = true;
      const sukhoi = fly(s, 'red-su-1', destination(rafale.pos, 90, 120), 270);
      redCap(s, sukhoi, emcon);
      sweeps(s, 12);
      return track(s, 'RED', rafale.id);
    };
    expect(detected(false)?.source).toBe('radar');
    expect(detected(true)).toBeUndefined();
  });

  it('une piste connue par ses seules émissions ne peut pas être engagée ; elle le devient dès qu’un radar la tient', () => {
    const s = freshState();
    const rafale = putOnCap(s, 'blue-raf-1', REMOTE, 90, 'free');
    const sukhoi = fly(s, 'red-su-1', destination(rafale.pos, 90, 60), 270);
    const c = observe(s, 'BLUE', sukhoi, true, 'esm');
    engagementSystem(s);
    expect(s.shots).toHaveLength(0);
    expect(c.source).toBe('esm');

    observe(s, 'BLUE', sukhoi, false, 'radar');
    engagementSystem(s);
    expect(s.shots).toHaveLength(1);
  });

  it('une unité sol-air qui émet est repérée par l’écoute ; neutralisée, elle ne l’est plus', () => {
    const s = freshState();
    const sam = s.units['red-sam']!;
    for (const id of Object.keys(s.contacts.BLUE)) delete s.contacts.BLUE[id];
    fly(s, 'blue-raf-1', destination(sam.pos, 180, 200), 0);
    sweeps(s, 12);
    const c = track(s, 'BLUE', sam.id);
    expect(c).toMatchObject({ source: 'esm', fixed: true, stale: false });

    // Radar coupé (neutralisation) : la piste n'est plus entretenue et vieillit.
    sam.suppressedUntil = s.time + 3600;
    sweeps(s, 10);
    expect(track(s, 'BLUE', sam.id)).toMatchObject({ stale: true });
  });
});

function droneState(over: { night?: boolean; intel?: boolean } = {}): SimState {
  const input = cloneData(BOUCLIER_ATLANTIQUE_INPUT);
  input.units.push({
    id: 'blue-mq9',
    side: 'BLUE',
    name: 'Reaper 01',
    platformId: 'mq9',
    groupId: 'blue-soutien',
    baseId: 'base-bouclier',
    airborne: { pos: { lat: 66, lon: -13 }, altM: 7500 },
  });
  if (!over.intel) input.intel = [];
  if (over.night) input.date = '2031-03-14T22:00:00Z';
  const parsed = parseScenario(input);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return createInitialState(parsed.scenario, { playerSide: 'BLUE', difficulty: 'standard', seed: 1 });
}

describe('reconnaissance optronique', () => {
  it('un drone repère et identifie un site sol-air silencieux à portée de son capteur', () => {
    const s = droneState();
    const sam = s.units['red-sam']!;
    sam.suppressedUntil = 1e9; // radar coupé : seule l'optronique peut le trouver
    const drone = s.units['blue-mq9']!;
    drone.pos = destination(sam.pos, 180, 50);
    sweeps(s, 12);
    expect(track(s, 'BLUE', sam.id)).toMatchObject({ source: 'eo', identified: true, fixed: true, kind: 'sam' });
  });

  it('hors de portée du capteur, le site reste inconnu', () => {
    const s = droneState();
    const sam = s.units['red-sam']!;
    sam.suppressedUntil = 1e9;
    s.units['blue-mq9']!.pos = destination(sam.pos, 180, 90);
    sweeps(s, 12);
    expect(track(s, 'BLUE', sam.id)).toBeUndefined();
  });

  it('de nuit, la portée optronique tombe à 60 %', () => {
    const found = (km: number) => {
      const s = droneState({ night: true });
      const sam = s.units['red-sam']!;
      sam.suppressedUntil = 1e9;
      s.units['blue-mq9']!.pos = destination(sam.pos, 180, km);
      sweeps(s, 12);
      return track(s, 'BLUE', sam.id) !== undefined;
    };
    // 70 km de jour, 42 km de nuit.
    expect(found(50)).toBe(false);
    expect(found(35)).toBe(true);
  });

  it('la reconnaissance constate la destruction d’un site', () => {
    const s = droneState({ intel: true });
    const sam = s.units['red-sam']!;
    const known = track(s, 'BLUE', sam.id)!;
    sam.status = 'destroyed';
    sweeps(s, 4);
    expect(track(s, 'BLUE', sam.id)).toBeDefined(); // personne pour constater

    s.units['blue-mq9']!.pos = destination(sam.pos, 180, 40);
    sweeps(s, 2);
    expect(track(s, 'BLUE', sam.id)).toBeUndefined();
    expect(s.events.some((e) => e.code === 'CONTACT_DESTROYED' && e.p.contact === known.id && e.vis.includes('BLUE'))).toBe(true);
  });

  it('la mission de reconnaissance est réservée aux drones', () => {
    const s = droneState();
    const recon = (unitIds: string[]) => applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ type: 'RECON', unitIds, altM: 7500, waypoints: [{ lat: 66.5, lon: -12 }] }) });
    expect(recon(['blue-raf-1'])).toMatchObject({ ok: false, code: 'WRONG_KIND' });
    expect(recon(['blue-mq9']).ok).toBe(true);
    expect(applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['blue-mq9'] }) })).toMatchObject({ ok: false, code: 'WRONG_KIND' });
  });
});

describe('jour et nuit', () => {
  it('de nuit, l’identification à vue ne joue plus qu’à très courte distance', () => {
    const identifiedAtFirstSight = (night: boolean) => {
      const s = freshState();
      if (night) s.startIso = '2031-03-14T22:00:00Z';
      const rafale = fly(s, 'blue-raf-1', REMOTE, 90);
      // À 20 km : sous le seuil visuel de jour (25 km), au-delà du seuil de nuit (7,5 km).
      const sukhoi = fly(s, 'red-su-1', destination(rafale.pos, 90, 20), 270);
      redCap(s, sukhoi, true);
      for (let i = 0; i < 40 && !track(s, 'BLUE', sukhoi.id); i++) sweeps(s, 1);
      return track(s, 'BLUE', sukhoi.id)!.identified;
    };
    expect(identifiedAtFirstSight(false)).toBe(true);
    expect(identifiedAtFirstSight(true)).toBe(false);
  });
});
