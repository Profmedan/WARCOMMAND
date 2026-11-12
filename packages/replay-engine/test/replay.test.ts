import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  cloneData,
  getSidePicture,
  hashState,
  opponent,
  SIDES,
  snapshotPositions,
  type SimState,
} from '@warcommand/simulation-core';
import { canHearEmitter, canSeeSurface, detectionRatio, nightNow } from '@warcommand/air-operations';
import { BOUCLIER_ATLANTIQUE, createSession, issueOrder, runToEnd, stepSession, type Session } from '@warcommand/scenario-system';
import { buildAar, createReplayCursor, loadGame, recordingOf, replay, saveGame, verifyReplay } from '../src/index';

const SECTOR = { lat: 67.0, lon: -11.0 };

function aiGame(seed: number, difficulty: 'recrue' | 'standard' | 'veteran' = 'standard'): Session {
  const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: null, seed, difficulty });
  runToEnd(session);
  return session;
}

/** Toute piste rafraîchie à cet instant doit être justifiée par un capteur (radar, écoute, optronique) ou par un tir sol-air adverse. */
function unjustifiedRevelations(s: SimState): string[] {
  const errors: string[] = [];
  for (const side of SIDES) {
    const observers = Object.values(s.units).filter((u) => u.side === side && (u.status === 'airborne' || u.status === 'active'));
    for (const c of Object.values(s.contacts[side])) {
      if (c.lastSeen !== s.time) continue;
      const target = s.units[c.unitId]!;
      if (target.side !== opponent(side)) errors.push(`${c.id} : piste sur une unité amie`);
      const night = nightNow(s);
      const seen = observers.some((o) => detectionRatio(s, o, target) > 0 || canHearEmitter(s, o, target) || canSeeSurface(s, o, target.pos, night));
      const revealedByFire = target.domain !== 'air' && target.lastShotAt === s.time;
      if (!seen && !revealedByFire) errors.push(`${side} ${c.id} : révélation injustifiée de ${target.id} à t=${s.time}`);
    }
  }
  return errors;
}

describe('reproductibilité', () => {
  it('trois exécutions avec la même graine donnent exactement le même résultat', () => {
    const runs = [aiGame(20310314), aiGame(20310314), aiGame(20310314)];
    const hashes = runs.map((r) => hashState(r.state));
    expect(new Set(hashes).size).toBe(1);
    expect(runs[1]!.state.events).toEqual(runs[0]!.state.events);
    expect(runs[2]!.state.outcome).toEqual(runs[0]!.state.outcome);
    expect(runs[0]!.state.outcome).not.toBeNull();
  });

  it('une autre graine donne un autre déroulement', () => {
    expect(hashState(aiGame(1).state)).not.toBe(hashState(aiGame(2).state));
  });
});

describe('parties complètes', () => {
  it.each([
    [1, 'standard'],
    [7, 'veteran'],
    [12, 'recrue'],
  ] as const)('graine %i (%s) : invariants respectés à chaque pas, aucune révélation injustifiée', (seed, difficulty) => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: null, seed, difficulty });
    const s = session.state;
    let previous = snapshotPositions(s);
    while (!s.outcome) {
      stepSession(session, 1);
      expect(checkInvariants(s, previous)).toEqual([]);
      previous = snapshotPositions(s);
      if (s.time % s.rules.sensorIntervalS === 0) expect(unjustifiedRevelations(s)).toEqual([]);
    }
    expect(s.time).toBe(s.endTime);
    expect(s.outcome!.reason).toBe('time');
    const o = s.objective;
    expect(o.sec.BLUE + o.sec.RED + o.sec.CONTESTED).toBe(s.endTime);
    // La partie a réellement eu lieu : des sorties, des détections, des décisions.
    expect(s.stats.BLUE.sorties + s.stats.RED.sorties).toBeGreaterThan(2);
    expect(s.events.some((e) => e.code === 'CONTACT_IDENTIFIED')).toBe(true);
    expect(s.ai.BLUE!.log.length).toBeGreaterThan(0);
    expect(s.ai.RED!.log.length).toBeGreaterThan(0);
    // Bilan matière : les missiles tirés correspondent aux missiles manquants, recomplètements compris.
    for (const side of SIDES) {
      const units = Object.values(s.units).filter((u) => u.side === side);
      const base = Object.values(s.bases).find((b) => b.side === side)!;
      const initialStock = BOUCLIER_ATLANTIQUE.bases.find((b) => b.id === base.id)!.weaponStock;
      const carriedAtStart = units.reduce((n, u) => n + s.platforms[u.platformId]!.weaponCount, 0);
      const carriedNow = units.reduce((n, u) => n + u.weapons, 0);
      expect(carriedAtStart + initialStock - carriedNow - base.weaponStock).toBe(s.stats[side].shotsFired - s.stats[side].asmFired);
      const asmAtStart = BOUCLIER_ATLANTIQUE.bases.find((b) => b.id === base.id)!.asmStock + units.reduce((n, u) => n + (s.platforms[u.platformId]!.loadouts[0]?.asm ?? 0), 0);
      const asmNow = base.asmStock + units.reduce((n, u) => n + u.asm, 0);
      expect(asmAtStart - asmNow).toBe(s.stats[side].asmFired);
    }
  });

  it('l’image d’un camp ne fuit jamais d’identifiant adverse, tout au long d’une partie', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: null, seed: 5 });
    const s = session.state;
    const enemyIds = (side: 'BLUE' | 'RED') => Object.values(s.units).filter((u) => u.side !== side).map((u) => `"${u.id}"`);
    while (!s.outcome) {
      stepSession(session, 60);
      for (const side of SIDES) {
        const json = JSON.stringify(getSidePicture(s, side));
        for (const id of enemyIds(side)) expect(json.includes(id), `${side} voit ${id}`).toBe(false);
      }
    }
  });
});

describe('rejeu et sauvegarde', () => {
  function playerGame(): Session {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 77 });
    stepSession(session, 60);
    const cap = (unitIds: string[], launchAt: number) =>
      issueOrder(session, {
        type: 'CREATE_MISSION',
        side: 'BLUE',
        draft: { type: 'CAP', unitIds, waypoints: [SECTOR], altM: 9000, speed: 'cruise', launchAt, endAt: null, roe: 'defensive', allowRefuel: true, targetContactId: null },
      });
    expect(cap(['blue-raf-1', 'blue-raf-2'], 60).ok).toBe(true);
    stepSession(session, 600);
    expect(issueOrder(session, { type: 'MOVE_SHIP', side: 'BLUE', unitId: 'blue-frg', dest: { lat: 66.5, lon: -12.4 } }).ok).toBe(true);
    stepSession(session, 900);
    expect(cap(['blue-raf-3', 'blue-raf-4'], session.state.time).ok).toBe(true);
    const first = Object.values(session.state.missions).find((m) => m.side === 'BLUE' && m.type === 'CAP' && m.status === 'active')!;
    expect(issueOrder(session, { type: 'SET_ROE', side: 'BLUE', missionId: first.id, roe: 'free' }).ok).toBe(true);
    // Un ordre refusé n'est pas enregistré.
    expect(issueOrder(session, { type: 'RTB_UNIT', side: 'BLUE', unitId: 'blue-sam' }).ok).toBe(false);
    stepSession(session, 1500);
    return session;
  }

  it('rejouer les ordres du joueur reproduit exactement la partie', () => {
    const session = playerGame();
    expect(session.orders).toHaveLength(4);
    const recording = recordingOf(session);
    const again = replay(recording, session.state.time);
    expect(again.state.time).toBe(session.state.time);
    expect(hashState(again.state)).toBe(hashState(session.state));
    expect(verifyReplay(recording, session.state)).toBe(true);

    // Sans les ordres du joueur, la partie diverge : le rejeu les applique bien.
    const without = replay({ ...recording, orders: [] }, session.state.time);
    expect(hashState(without.state)).not.toBe(hashState(session.state));

    // Rejeu partiel : état intermédiaire cohérent avec l'horloge demandée.
    expect(replay(recording, 700).state.time).toBe(700);
  });

  it('le curseur de rejeu restitue le même état que le rejeu direct, à tout instant', () => {
    const session = playerGame();
    runToEnd(session);
    const recording = recordingOf(session);
    const cursor = createReplayCursor(recording, 300);
    expect(cursor.endTime).toBe(session.state.time);
    expect(hashState(cursor.stateAt(cursor.endTime))).toBe(hashState(session.state));
    expect(hashState(cursor.stateAt(0))).toBe(hashState(replay(recording, 0).state));
    for (const t of [61, 300, 659, 660, 661, 1560, 1561, 2999, 4321]) {
      expect(hashState(cursor.stateAt(t)), `t=${t}`).toBe(hashState(replay(recording, t).state));
    }
  });

  it('une sauvegarde rechargée continue exactement comme la partie d’origine', () => {
    const session = playerGame();
    const json = JSON.stringify(saveGame(session));
    const loaded = loadGame(JSON.parse(json));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(hashState(loaded.session.state)).toBe(hashState(session.state));
    runToEnd(session);
    runToEnd(loaded.session);
    expect(hashState(loaded.session.state)).toBe(hashState(session.state));
    expect(loaded.session.state.outcome).toEqual(session.state.outcome);
  });

  it('refuse une sauvegarde étrangère, d’une autre version, altérée ou au scénario invalide', () => {
    const save = saveGame(playerGame());
    expect(loadGame(null).ok).toBe(false);
    expect(loadGame({ format: 'autre' }).ok).toBe(false);
    expect(loadGame({ ...save, version: 2 }).ok).toBe(false);
    const tampered = cloneData(save);
    tampered.state.units['blue-raf-1']!.weapons = 6;
    tampered.state.units['blue-raf-1']!.fuelKg += 1;
    expect(loadGame(tampered)).toMatchObject({ ok: false });
    const badScenario = cloneData(save);
    badScenario.recording.scenario.units[0]!.platformId = 'x-wing';
    expect(loadGame(badScenario).ok).toBe(false);
  });

  it('refuse une sauvegarde faite avec une version antérieure du moteur, en le disant', () => {
    const old = cloneData(saveGame(playerGame())) as unknown as { state: { formatVersion: number } };
    old.state.formatVersion = 1;
    const result = loadGame(old);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/version antérieure/);
  });
});

describe('compte rendu après action', () => {
  it('résume fidèlement la partie', () => {
    const session = aiGame(3);
    const s = session.state;
    const aar = buildAar(s);
    expect(aar.outcome).toEqual(s.outcome);
    expect(aar.controlSec.BLUE + aar.controlSec.RED + aar.controlSec.CONTESTED).toBe(aar.elapsedSec);
    expect(aar.controlTimeline[0]!.from).toBe(0);
    expect(aar.controlTimeline.at(-1)!.to).toBe(aar.elapsedSec);
    for (let i = 1; i < aar.controlTimeline.length; i++) {
      expect(aar.controlTimeline[i]!.from).toBe(aar.controlTimeline[i - 1]!.to);
    }
    const perSide = { BLUE: 0, RED: 0, CONTESTED: 0 };
    for (const seg of aar.controlTimeline) perSide[seg.status] += seg.to - seg.from;
    expect(perSide).toEqual(aar.controlSec);
    expect(aar.shots.length).toBeLessThanOrEqual(aar.sides.BLUE.stats.shotsFired + aar.sides.RED.stats.shotsFired);
    expect(aar.shots.filter((x) => x.result !== 'miss').length).toBe(aar.sides.BLUE.stats.hits + aar.sides.RED.stats.hits);
    expect(aar.sides.BLUE.units).toHaveLength(8);
    expect(aar.sides.RED.units).toHaveLength(7);
    expect(aar.sides.RED.aiDecisions.length).toBeGreaterThan(0);
    expect(aar.sides.BLUE.controlledByAi).toBe(true);
    expect(aar.hash).toBe(hashState(s));
  });
});
