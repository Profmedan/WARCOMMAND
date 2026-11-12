import { describe, expect, it } from 'vitest';
import { destination, type Shot, type SimState } from '@warcommand/simulation-core';
import { engagementSystem, hitProbability, observe, perfOf } from '@warcommand/air-operations';
import { freshState, putOnCap, SECTOR } from './helpers';

/** Un Rafale et un Su-35 face à face à 60 km, hors du secteur d'objectif. */
function duel(roe: 'hold' | 'defensive' | 'free', identified: boolean) {
  const s = freshState();
  const here = { lat: 63.5, lon: -5 };
  const there = destination(here, 90, 60);
  const blue = putOnCap(s, 'blue-raf-1', here, 90, roe);
  const red = s.units['red-su-1']!;
  red.status = 'airborne';
  red.pos = there;
  red.altM = 9000;
  red.headingDeg = 270;
  const contact = observe(s, 'BLUE', red, identified);
  s.time += 100;
  // La piste reste entretenue par un radar ami (comme le ferait l'AWACS).
  contact.lastSeen = s.time;
  contact.radarSeenAt = s.time;
  return { s, blue, red, contact };
}

const shotsBy = (s: SimState, id: string) => s.shots.filter((x) => x.shooterId === id);

describe('décision d’engagement', () => {
  it('tir libre : engage un hostile identifié à portée, et consomme un missile', () => {
    const { s, blue } = duel('free', true);
    const before = blue.weapons;
    engagementSystem(s);
    expect(shotsBy(s, blue.id)).toHaveLength(1);
    expect(blue.weapons).toBe(before - 1);
    expect(s.stats.BLUE.shotsFired).toBe(1);
    expect(s.shots[0]!.impactAt).toBeGreaterThan(s.time);
  });

  it('ne tire jamais sur une piste non identifiée', () => {
    for (const roe of ['defensive', 'free'] as const) {
      const { s, blue } = duel(roe, false);
      engagementSystem(s);
      expect(shotsBy(s, blue.id)).toHaveLength(0);
    }
  });

  it('règles défensives : n’engage pas un hostile éloigné du secteur et des moyens amis, sauf acte hostile', () => {
    const { s, blue, contact } = duel('defensive', true);
    // À 60 km le rayon défensif (80 km) autorise le tir ; on éloigne donc la piste au-delà.
    s.rules.defensiveRadiusKm = 40;
    engagementSystem(s);
    expect(shotsBy(s, blue.id)).toHaveLength(0);
    contact.hostileAct = true;
    engagementSystem(s);
    expect(shotsBy(s, blue.id)).toHaveLength(1);
  });

  it('règles défensives : engage un hostile identifié à l’intérieur du secteur', () => {
    const s = freshState();
    const blue = putOnCap(s, 'blue-raf-1', destination(SECTOR, 270, 30), 90, 'defensive');
    const red = s.units['red-su-1']!;
    red.status = 'airborne';
    red.pos = destination(SECTOR, 90, 30);
    red.altM = 9000;
    s.rules.defensiveRadiusKm = 10;
    observe(s, 'BLUE', red, true);
    engagementSystem(s);
    expect(shotsBy(s, blue.id)).toHaveLength(1);
  });

  it('tir en riposte uniquement : rien sans acte hostile', () => {
    const { s, blue, contact } = duel('hold', true);
    engagementSystem(s);
    expect(shotsBy(s, blue.id)).toHaveLength(0);
    contact.hostileAct = true;
    engagementSystem(s);
    expect(shotsBy(s, blue.id)).toHaveLength(1);
  });

  it('pas de tir sans munition, hors de portée, hors du secteur avant, sur piste périmée ou appareil endommagé', () => {
    const blockers: ((x: ReturnType<typeof duel>) => void)[] = [
      (x) => void (x.blue.weapons = 0),
      (x) => void (x.contact.pos = destination(x.blue.pos, 90, 200)),
      (x) => void (x.blue.headingDeg = 270),
      (x) => void (x.contact.stale = true),
      (x) => void (x.contact.radarSeenAt = x.s.time - 60),
      (x) => void (x.blue.damaged = true),
      (x) => void (x.blue.task = 'refueling'),
    ];
    for (const block of blockers) {
      const x = duel('free', true);
      block(x);
      engagementSystem(x.s);
      expect(shotsBy(x.s, x.blue.id)).toHaveLength(0);
    }
  });

  it('respecte la cadence de tir et le nombre de missiles en vol par cible', () => {
    const { s, blue, contact } = duel('free', true);
    engagementSystem(s);
    engagementSystem(s);
    expect(shotsBy(s, blue.id)).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      s.time += s.rules.shotCooldownS;
      contact.lastSeen = s.time;
      contact.radarSeenAt = s.time;
      // On repousse l'impact pour garder les missiles en vol.
      for (const shot of s.shots) shot.impactAt = s.time + 1000;
      engagementSystem(s);
    }
    expect(shotsBy(s, blue.id)).toHaveLength(s.rules.maxShotsPerTarget);
  });

  it('une unité sol-air ne tire que sur ce que son radar peut éclairer, et se révèle en tirant', () => {
    const s = freshState();
    const sam = s.units['blue-sam']!;
    const red = s.units['red-su-1']!;
    red.status = 'airborne';
    red.pos = destination(sam.pos, 60, 45);
    red.altM = 20; // très basse altitude : horizon radar d'environ 34 km, la cible est à 45 km
    const c = observe(s, 'BLUE', red, true);
    engagementSystem(s);
    expect(shotsBy(s, sam.id)).toHaveLength(0);

    red.altM = 6000;
    c.altM = 6000;
    expect(Object.values(s.contacts.RED).some((k) => k.unitId === sam.id && !k.stale)).toBe(false);
    engagementSystem(s);
    expect(shotsBy(s, sam.id)).toHaveLength(1);
    const revealed = Object.values(s.contacts.RED).find((k) => k.unitId === sam.id)!;
    expect(revealed).toMatchObject({ stale: false, identified: true, hostileAct: true });
  });
});

describe('résolution des tirs', () => {
  const shot = (over: Partial<Shot>): Shot => ({
    id: 1,
    side: 'BLUE',
    shooterId: 'blue-raf-1',
    shooterName: 'Rafale A1',
    targetId: 'red-su-1',
    contactId: 'R01',
    weapon: 'aam',
    firedAt: 0,
    impactAt: 60,
    launchRangeKm: 50,
    maxRangeKm: 90,
    shooterCrew: 0.7,
    intelStale: false,
    targetAware: true,
    from: { lat: 0, lon: 0 },
    ...over,
  });

  it('la surprise, la distance, l’entraînement et la cible modulent la probabilité de coup au but', () => {
    const s = freshState();
    const fighter = s.units['red-su-1']!;
    const awacs = s.units['red-aew']!;
    const pk = (over: Partial<Shot>, target = fighter) => hitProbability(s, shot(over), target, perfOf(s, target));

    expect(pk({ targetAware: false })).toBeGreaterThan(pk({ targetAware: true }));
    expect(pk({ launchRangeKm: 20 })).toBeGreaterThan(pk({ launchRangeKm: 85 }));
    expect(pk({ shooterCrew: 0.9 })).toBeGreaterThan(pk({ shooterCrew: 0.5 }));
    expect(pk({}, awacs)).toBeGreaterThan(pk({}, fighter));
    fighter.damaged = true;
    expect(pk({})).toBeGreaterThan(hitProbability(s, shot({}), { ...fighter, damaged: false }, perfOf(s, fighter)));
    for (const range of [0, 45, 90, 500]) {
      const p = pk({ launchRangeKm: range, targetAware: false, shooterCrew: 1 }, awacs);
      expect(p).toBeGreaterThanOrEqual(s.rules.pkMin);
      expect(p).toBeLessThanOrEqual(s.rules.pkMax);
    }
  });

  it('une meilleure fiche ne garantit pas la victoire : le résultat est un tirage', () => {
    const results = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = freshState('BLUE', seed);
      const red = s.units['red-su-1']!;
      red.status = 'airborne';
      red.altM = 9000;
      s.shots.push(shot({ impactAt: 1 }));
      s.time = 1;
      engagementSystem(s);
      const resolved = s.events.find((e) => e.code === 'SHOT_RESOLVED')!;
      results.add(String(resolved.p.result));
      expect(Number(resolved.p.pk)).toBeGreaterThan(0);
      expect(Number(resolved.p.pk)).toBeLessThan(1);
    }
    expect(results.has('miss')).toBe(true);
    expect(results.has('destroyed') || results.has('damaged')).toBe(true);
  });

  it('un tir sur une cible déjà posée ou détruite est perdu, sans effet', () => {
    const s = freshState();
    s.shots.push(shot({ impactAt: 1 }));
    s.time = 1;
    engagementSystem(s);
    expect(s.shots).toHaveLength(0);
    expect(s.units['red-su-1']!.status).toBe('ready');
    expect(s.events.some((e) => e.code === 'SHOT_RESULT' && e.p.result === 'lost')).toBe(true);
  });

  it('la destruction retire l’appareil, compte la perte et confirme la piste fraîche', () => {
    const s = freshState();
    const red = s.units['red-su-1']!;
    red.status = 'airborne';
    red.altM = 9000;
    red.damaged = true; // un appareil déjà endommagé est détruit par tout coup au but
    const c = observe(s, 'BLUE', red, true);
    s.rules.pkMin = 0.9;
    s.rules.pkMax = 1;
    s.rules.pkBaseAam = 5;
    s.shots.push(shot({ impactAt: 1, contactId: c.id }));
    s.time = 1;
    c.lastSeen = 1;
    engagementSystem(s);
    expect(red.status).toBe('destroyed');
    expect(s.stats.RED.losses.fighter).toBe(1);
    expect(s.stats.BLUE.kills).toBe(1);
    expect(s.contacts.BLUE[c.id]).toBeUndefined();
    expect(s.events.some((e) => e.code === 'CONTACT_DESTROYED' && e.vis.includes('BLUE'))).toBe(true);
    expect(s.events.some((e) => e.code === 'UNIT_DESTROYED' && e.vis.includes('RED') && !e.vis.includes('BLUE'))).toBe(true);
  });
});
