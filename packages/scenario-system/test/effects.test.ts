import { describe, expect, it } from 'vitest';
import { destination, distanceKm, isLand, type LatLon, type Shot, type SimState, type Unit } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, asmHitProbability, observe, scrambleDelayS } from '@warcommand/air-operations';
import { landSystem } from '@warcommand/land-operations';
import { navalSystem } from '@warcommand/naval-operations';
import { applyEffectOrder, effectsSystem, sofCompromiseP, sofInsertP, validateEffectOrder } from '@warcommand/multi-domain-effects';
import { draft } from './helpers';
import { east, jointState, keep, runJoint, SEA, west } from './joint-helpers';

const MIN = 60;
const SYSTEMS = [...AIR_SYSTEMS, landSystem, navalSystem, effectsSystem];
const place = (s: SimState, id: string, pos: LatLon) => {
  s.units[id]!.pos = { ...pos };
};
const use = (s: SimState, side: 'BLUE' | 'RED', effect: 'cyber' | 'jam') => applyEffectOrder(s, { type: 'USE_EFFECT', side, effect });
const seen = (s: SimState, code: string, side: 'BLUE' | 'RED') => s.events.filter((e) => e.code === code && e.vis.length === 1 && e.vis[0] === side);

describe('effets cyber et spatiaux', () => {
  it('une perturbation des réseaux adverses consomme l’effet, dégrade le service visé et n’est annoncée qu’à qui de droit', () => {
    const s = jointState();
    expect(validateEffectOrder(s, { type: 'USE_EFFECT', side: 'BLUE', effect: 'cyber' })).toEqual({ ok: true });
    expect(use(s, 'BLUE', 'cyber')).toEqual({ ok: true });
    expect(s.effects.BLUE.cyber).toBe(0);
    expect(s.services.RED.level.network).toBeCloseTo(1 - s.rules.effectStrength, 9);
    expect(s.services.RED.level.satcom).toBe(1);
    expect(s.services.BLUE.level.network).toBe(1);
    expect(s.stats.BLUE.effectsUsed).toBe(1);
    expect(seen(s, 'EFFECT_USED', 'BLUE')).toHaveLength(1);
    expect(seen(s, 'SERVICE_DEGRADED', 'RED').map((e) => e.p.service)).toEqual(['network']);
    // L'effet est épuisé.
    expect(use(s, 'BLUE', 'cyber')).toMatchObject({ ok: false, code: 'NO_EFFECT_LEFT' });
    s.outcome = { winner: 'DRAW', level: 'draw', reason: 'time', endedAt: 0 };
    expect(use(s, 'RED', 'cyber')).toMatchObject({ ok: false, code: 'MISSION_OVER' });
  });

  it('un brouillage des services spatiaux dégrade liaisons et navigation par satellite', () => {
    const s = jointState();
    expect(use(s, 'RED', 'jam')).toEqual({ ok: true });
    expect(s.services.BLUE.level).toMatchObject({ network: 1 });
    expect(s.services.BLUE.level.satcom).toBeCloseTo(0.3, 9);
    expect(s.services.BLUE.level.nav).toBeCloseTo(0.3, 9);
    expect(seen(s, 'SERVICE_DEGRADED', 'BLUE').map((e) => e.p.service).sort()).toEqual(['nav', 'satcom']);
  });

  it('la perturbation dure, puis le service se rétablit progressivement ; la résilience abrège l’une et accélère l’autre', () => {
    const s = jointState();
    use(s, 'BLUE', 'cyber');
    // Résilience 0,5 : quinze minutes de perturbation, puis un dixième par minute.
    runJoint(s, [effectsSystem], 15 * MIN);
    expect(s.services.RED.level.network).toBeCloseTo(0.3, 9);
    runJoint(s, [effectsSystem], MIN);
    expect(s.services.RED.level.network).toBeCloseTo(0.4, 6);
    expect(seen(s, 'SERVICE_RESTORED', 'RED')).toHaveLength(0);
    runJoint(s, [effectsSystem], 6 * MIN + 2);
    expect(s.services.RED.level.network).toBe(1);
    expect(seen(s, 'SERVICE_RESTORED', 'RED').map((e) => e.p.service)).toEqual(['network']);

    const tough = jointState((sc) => (sc.sides.RED.resilience = 1));
    use(tough, 'BLUE', 'cyber');
    // Résilience 1 : sept minutes et demie, puis 0,15 par minute.
    runJoint(tough, [effectsSystem], 450);
    expect(tough.services.RED.level.network).toBeCloseTo(0.3, 9);
    runJoint(tough, [effectsSystem], 2 * MIN);
    expect(tough.services.RED.level.network).toBeCloseTo(0.6, 6);
  });

  it('des réseaux dégradés retardent le décollage des appareils au sol', () => {
    const s = jointState();
    const nominal = scrambleDelayS(s.rules, s.doctrine.BLUE);
    s.services.BLUE.level.network = 0.5;
    const res = applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['b-raf-1'], waypoints: [east(5)], launchAt: 0 }) });
    expect(res.ok).toBe(true);
    expect(Object.values(s.missions)[0]!.launchAt).toBe(nominal * 2);
  });

  it('une navigation par satellite dégradée rend les munitions guidées moins précises', () => {
    const s = jointState();
    const target = s.units['r-arm']!;
    const shot: Shot = {
      id: 1, side: 'BLUE', shooterId: 'b-raf-1', shooterName: 'Rafale 1', targetId: target.id, contactId: 'R01', weapon: 'asm',
      firedAt: 0, impactAt: 60, launchRangeKm: 50, maxRangeKm: 70, shooterCrew: 0.7, intelStale: false, targetAware: true,
      from: destination(target.pos, 270, 50),
    };
    const nominal = asmHitProbability(s, shot, target);
    s.services.BLUE.level.nav = 0.3;
    expect(asmHitProbability(s, shot, target)).toBeCloseTo(nominal * s.rules.navDegradedFactor, 9);
    // La navigation de l'adversaire n'y change rien.
    s.services.BLUE.level.nav = 1;
    s.services.RED.level.nav = 0;
    expect(asmHitProbability(s, shot, target)).toBeCloseTo(nominal, 9);
  });
});

describe('satellites d’observation', () => {
  const tracks = (s: SimState, side: 'BLUE' | 'RED') =>
    Object.values(s.contacts[side])
      .map((c) => c.unitId)
      .sort();

  it('pendant sa fenêtre, un satellite révèle à son camp les formations et les bâtiments de surface dans son empreinte', () => {
    // Empreinte élargie jusqu'au large : elle couvre les forces rouges à terre et un bout de mer.
    const s = jointState((sc) => (sc.satellites![0]!.footprint = { center: east(100), radiusKm: 100 }));
    const offshore = east(190);
    expect(isLand(offshore)).toBe(false);
    place(s, 'r-dd', offshore);
    place(s, 'r-sub', destination(offshore, 0, 5));
    runJoint(s, [effectsSystem], 10 * MIN - 1);
    expect(tracks(s, 'BLUE')).toEqual([]);
    runJoint(s, [effectsSystem], 10);
    expect(seen(s, 'SAT_PASS_START', 'BLUE')).toHaveLength(1);
    expect(seen(s, 'SAT_PASS_START', 'RED')).toHaveLength(0);
    // Tout ce qui est à terre ou en surface dans l'empreinte, mais ni le sous-marin ni ce qui est hors d'empreinte.
    expect(tracks(s, 'BLUE')).toEqual(['r-arm', 'r-art', 'r-dd', 'r-hq', 'r-log', 'r-mech']);
    expect(Object.values(s.contacts.BLUE).every((c) => c.identified && c.source === 'sat')).toBe(true);
    runJoint(s, [effectsSystem], 10 * MIN);
    expect(seen(s, 'SAT_PASS_END', 'BLUE')).toHaveLength(1);
    expect(s.satellites.find((p) => p.id === 'sat-b')!.phase).toBe('done');
  });

  it('ne livre rien si les liaisons par satellite de son camp sont brouillées, ni de nuit', () => {
    const jammed = jointState();
    use(jammed, 'RED', 'jam');
    runJoint(jammed, [effectsSystem], 12 * MIN);
    expect(tracks(jammed, 'BLUE')).toEqual([]);

    const night = jointState((sc) => (sc.date = '2031-12-14T23:00:00Z'));
    runJoint(night, [effectsSystem], 12 * MIN);
    expect(tracks(night, 'BLUE')).toEqual([]);
  });
});

describe('opérations spéciales', () => {
  const NEAR_RED_HQ = east(80, 6);
  const insert = (target: LatLon, unitId = 'b-sof', side: 'BLUE' | 'RED' = 'BLUE') =>
    ({ type: 'SOF_INSERT', side, unitId, target }) as const;
  /** Équipe bleue infiltrée avec succès près du PC rouge. */
  function onStation(prepare?: (s: SimState) => void): { s: SimState; team: Unit } {
    const s = jointState();
    s.rules.sofInsertP = 1;
    s.rules.sofCompromiseBaseP = 0;
    s.rules.sofCompromisePerUnitP = 0;
    prepare?.(s);
    expect(applyEffectOrder(s, insert(NEAR_RED_HQ))).toEqual({ ok: true });
    const team = s.units['b-sof']!;
    runJoint(s, SYSTEMS, team.sof!.arriveAt - s.time + 1);
    return { s, team };
  }

  it('refuse une infiltration impossible', () => {
    const s = jointState();
    expect(validateEffectOrder(s, insert(NEAR_RED_HQ))).toEqual({ ok: true });
    expect(validateEffectOrder(s, insert(NEAR_RED_HQ, 'b-mech'))).toMatchObject({ ok: false, code: 'NOT_SOF' });
    expect(validateEffectOrder(s, insert(NEAR_RED_HQ, 'r-sof'))).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    expect(validateEffectOrder(s, insert(NEAR_RED_HQ, 'fantome'))).toMatchObject({ ok: false, code: 'UNKNOWN_UNIT' });
    expect(validateEffectOrder(s, insert(SEA.blueFrigate))).toMatchObject({ ok: false, code: 'NOT_ON_LAND' });
    expect(validateEffectOrder(s, insert({ lat: 50, lon: 20 }))).toMatchObject({ ok: false, code: 'OUT_OF_THEATER' });
    s.rules.sofRangeKm = 100;
    expect(validateEffectOrder(s, insert(NEAR_RED_HQ))).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    s.rules.sofRangeKm = 400;
    applyEffectOrder(s, insert(NEAR_RED_HQ));
    // Déjà partie : elle ne reçoit pas un second ordre d'infiltration.
    expect(validateEffectOrder(s, insert(NEAR_RED_HQ))).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });
  });

  it('s’infiltre en un temps qui dépend de la distance, hors carte, puis observe en profondeur et rend compte', () => {
    const s = jointState();
    s.rules.sofInsertP = 1;
    s.rules.sofCompromiseBaseP = 0;
    s.rules.sofCompromisePerUnitP = 0;
    const team = s.units['b-sof']!;
    const d = distanceKm(team.pos, NEAR_RED_HQ);
    applyEffectOrder(s, insert(NEAR_RED_HQ));
    expect(team.sof).toMatchObject({ phase: 'inserting', target: NEAR_RED_HQ, compromised: false });
    expect(team.sof!.arriveAt).toBe(s.rules.sofPrepS + Math.round((d / s.rules.sofInsertKmh) * 3600));
    expect(team.status).toBe('embarked');
    expect(seen(s, 'SOF_INSERTING', 'BLUE')).toHaveLength(1);

    runJoint(s, SYSTEMS, team.sof!.arriveAt - 2);
    expect(team.status).toBe('embarked');
    expect(Object.values(s.contacts.BLUE)).toHaveLength(0);
    runJoint(s, SYSTEMS, 10);
    expect(team.status).toBe('active');
    expect(team.pos).toEqual(NEAR_RED_HQ);
    expect(team.sof!.phase).toBe('observing');
    expect(seen(s, 'SOF_ON_STATION', 'BLUE')).toHaveLength(1);

    // À 15 km à la ronde : le PC, la logistique et l'artillerie rouges — pas les blindés, trop loin.
    const reported = Object.values(s.contacts.BLUE);
    expect(reported.map((c) => c.unitId).sort()).toEqual(['r-art', 'r-hq', 'r-log']);
    expect(reported.every((c) => c.identified && c.source === 'sof')).toBe(true);
    expect(seen(s, 'INTEL_REPORT', 'BLUE')).toHaveLength(3);
    // ROUGE ne voit pas l'équipe.
    expect(Object.values(s.contacts.RED).some((c) => c.unitId === 'b-sof')).toBe(false);
  });

  it('sans liaison par satellite, l’équipe observe mais ne peut rien transmettre', () => {
    const { s } = onStation((st) => {
      st.services.BLUE.level.satcom = 0.2;
      st.services.BLUE.disruptedUntil.satcom = 1e9;
    });
    runJoint(s, SYSTEMS, MIN);
    expect(Object.values(s.contacts.BLUE)).toHaveLength(0);
  });

  it('l’infiltration peut échouer : l’équipe renonce et rentre', () => {
    const s = jointState();
    s.rules.sofInsertP = 0;
    applyEffectOrder(s, insert(NEAR_RED_HQ));
    const team = s.units['b-sof']!;
    runJoint(s, SYSTEMS, team.sof!.arriveAt + 2);
    expect(seen(s, 'SOF_ABORTED', 'BLUE')).toHaveLength(1);
    expect(team.sof!.phase).toBe('extracting');
    expect(team.status).toBe('embarked');
    runJoint(s, SYSTEMS, team.sof!.arriveAt - s.time + 2);
    expect(team.sof!.phase).toBe('ready');
    expect(team.status).toBe('ready');
    expect(team.pos).toEqual(s.bases['b-airbase']!.pos);
  });

  it('la présence de formations adverses rend l’infiltration plus hasardeuse et la découverte plus probable', () => {
    const s = jointState();
    const team = s.units['b-sof']!;
    expect(sofInsertP(s, team, NEAR_RED_HQ)).toBeCloseTo(0.85, 9);
    // Une formation adverse à moins de 5 km du point visé.
    expect(sofInsertP(s, team, destination(s.units['r-hq']!.pos, 0, 3))).toBeCloseTo(0.55, 9);

    place(s, 'b-sof', NEAR_RED_HQ);
    expect(sofCompromiseP(s, team)).toBeCloseTo(0.01, 9);
    place(s, 'r-log', destination(NEAR_RED_HQ, 90, 3));
    expect(sofCompromiseP(s, team)).toBeCloseTo(0.06, 9);
    // Une unité de reconnaissance compte double.
    s.units['r-mech']!.kind = 'recon';
    place(s, 'r-mech', destination(NEAR_RED_HQ, 180, 2));
    expect(sofCompromiseP(s, team)).toBeCloseTo(0.16, 9);
  });

  it('découverte, l’équipe s’exfiltre d’elle-même ; l’exfiltration sous pression peut échouer', () => {
    const lost = onStation();
    lost.s.rules.sofCompromiseBaseP = 1;
    lost.s.rules.sofExtractCompromisedP = 0;
    runJoint(lost.s, SYSTEMS, MIN);
    expect(seen(lost.s, 'SOF_COMPROMISED', 'BLUE')).toHaveLength(1);
    expect(lost.team.sof).toMatchObject({ phase: 'extracting', compromised: true });
    expect(lost.team.status).toBe('embarked');
    runJoint(lost.s, SYSTEMS, lost.team.sof!.arriveAt - lost.s.time + 2);
    expect(seen(lost.s, 'SOF_LOST', 'BLUE')).toHaveLength(1);
    expect(lost.team.status).toBe('destroyed');
    expect(lost.s.stats.BLUE.losses.sof).toBe(1);

    const saved = onStation();
    saved.s.rules.sofCompromiseBaseP = 1;
    saved.s.rules.sofExtractCompromisedP = 1;
    runJoint(saved.s, SYSTEMS, MIN);
    runJoint(saved.s, SYSTEMS, saved.team.sof!.arriveAt - saved.s.time + 2);
    expect(seen(saved.s, 'SOF_RECOVERED', 'BLUE')).toHaveLength(1);
    expect(saved.team.status).toBe('ready');
    expect(saved.team.sof).toMatchObject({ phase: 'ready', compromised: false, target: null });
    // Récupérée, elle se reconditionne avant de pouvoir repartir.
    expect(validateEffectOrder(saved.s, insert(NEAR_RED_HQ))).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });
  });

  it('sur ordre, l’équipe s’exfiltre et rentre à sa base', () => {
    const { s, team } = onStation();
    s.rules.sofExtractP = 1;
    expect(validateEffectOrder(s, { type: 'SOF_EXTRACT', side: 'BLUE', unitId: 'b-sof' })).toEqual({ ok: true });
    expect(validateEffectOrder(s, { type: 'SOF_EXTRACT', side: 'BLUE', unitId: 'r-sof' })).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    // Une équipe restée à sa base n'a rien à exfiltrer.
    expect(validateEffectOrder(s, { type: 'SOF_EXTRACT', side: 'RED', unitId: 'r-sof' })).toMatchObject({ ok: false, code: 'UNIT_UNAVAILABLE' });
    expect(applyEffectOrder(s, { type: 'SOF_EXTRACT', side: 'BLUE', unitId: 'b-sof' })).toEqual({ ok: true });
    expect(team.sof!.phase).toBe('extracting');
    runJoint(s, SYSTEMS, team.sof!.arriveAt - s.time + 2);
    expect(team.status).toBe('ready');
    expect(team.pos).toEqual(s.bases['b-airbase']!.pos);
    expect(seen(s, 'SOF_RECOVERED', 'BLUE')).toHaveLength(1);
  });
});

describe('renseignement croisé', () => {
  it('une piste donnée par un satellite ou une équipe spéciale suffit à l’appui aérien, tant qu’elle est fraîche', () => {
    const s = jointState((sc) => keep(sc, ['b-hq', 'b-raf-1', 'r-arm', 'r-hq']));
    place(s, 'r-arm', east(25));
    const u = s.units['b-raf-1']!;
    Object.assign(u, { status: 'airborne', pos: west(40), altM: 6000, speedKmh: 900, loadoutId: 'sead', weapons: 2, asm: 4 });
    applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ type: 'CAS', unitIds: ['b-raf-1'], waypoints: [east(20)], altM: 6000, launchAt: 0 }) });
    // Aucune troupe bleue n'observe le blindé : sans renseignement, pas de tir.
    runJoint(s, SYSTEMS, 6 * MIN);
    expect(s.events.some((e) => e.code === 'SHOT_FIRED')).toBe(false);
    // Un satellite (ou une équipe) entretient la piste : l'appui tire.
    for (let i = 0; i < 20; i++) {
      observe(s, 'BLUE', s.units['r-arm']!, true, 'sat');
      runJoint(s, SYSTEMS, 20);
    }
    expect(s.events.some((e) => e.code === 'SHOT_FIRED' && e.p.weapon === 'asm')).toBe(true);
  });
});
