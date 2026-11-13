import { describe, expect, it } from 'vitest';
import { checkInvariants, distanceKm, getSidePicture, hashState, SIDES, snapshotPositions } from '@warcommand/simulation-core';
import { recordingOf, replay, verifyReplay } from '@warcommand/replay-engine';
import { createSession, issueOrder, parseScenario, stepSession, type Scenario, type Session } from '../src/index';
import { east, jointInput } from './joint-helpers';

function jointScenario(): Scenario {
  const input = jointInput();
  input.navalZones = { BLUE: { center: { lat: 64.5, lon: -11.5 }, radiusKm: 600 }, RED: { center: { lat: 65.5, lon: -11 }, radiusKm: 600 } };
  const parsed = parseScenario(input);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.scenario;
}

/** Partie où le joueur BLEU donne un ordre à chaque composante. */
function playerGame(): Session {
  const session = createSession(jointScenario(), { playerSide: 'BLUE', seed: 21 });
  stepSession(session, 30);
  expect(issueOrder(session, { type: 'LAND_ORDER', side: 'BLUE', unitId: 'b-rec', posture: 'move', route: [east(25)] }).ok).toBe(true);
  expect(issueOrder(session, { type: 'MOVE_SHIP', side: 'BLUE', unitId: 'b-frig', dest: { lat: 64.2, lon: -10.6 } }).ok).toBe(true);
  expect(issueOrder(session, { type: 'USE_EFFECT', side: 'BLUE', effect: 'cyber' }).ok).toBe(true);
  expect(issueOrder(session, { type: 'SOF_INSERT', side: 'BLUE', unitId: 'b-sof', target: east(80, 6) }).ok).toBe(true);
  stepSession(session, 20 * 60);
  return session;
}

describe('session interarmées', () => {
  it('le joueur commande toutes les composantes de son camp, et seulement de son camp', () => {
    const session = playerGame();
    expect(session.orders.map((o) => o.order.type)).toEqual(['LAND_ORDER', 'MOVE_SHIP', 'USE_EFFECT', 'SOF_INSERT']);
    const s = session.state;
    // Dix kilomètres à 45 km/h : l'escadron de reconnaissance est arrivé, et tient.
    expect(distanceKm(s.units['b-rec']!.pos, east(25))).toBeLessThan(0.1);
    expect(s.effects.BLUE.cyber).toBe(0);
    expect(s.units['b-sof']!.sof!.phase).toBe('inserting');

    // Un ordre refusé n'est pas enregistré ; un ordre au camp confié à l'IA est refusé d'emblée.
    expect(issueOrder(session, { type: 'USE_EFFECT', side: 'BLUE', effect: 'cyber' })).toMatchObject({ ok: false, code: 'NO_EFFECT_LEFT' });
    expect(issueOrder(session, { type: 'LAND_ORDER', side: 'RED', unitId: 'r-arm', posture: 'hold', route: [] })).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    expect(issueOrder(session, { type: 'LAND_TROOPS', side: 'RED', shipId: 'r-lst', unitId: 'r-inf', beach: east(150) })).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    expect(issueOrder(session, { type: 'SOF_EXTRACT', side: 'RED', unitId: 'r-sof' })).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    expect(session.orders).toHaveLength(4);
  });

  it('en mode par tours, aucun ordre — terrestre, naval ou multi-domaines — ne passe en cours de tour', () => {
    const session = createSession(jointScenario(), { playerSide: 'BLUE', seed: 21, wegoTurnMin: 5 });
    stepSession(session, 30);
    expect(issueOrder(session, { type: 'LAND_ORDER', side: 'BLUE', unitId: 'b-rec', posture: 'move', route: [east(25)] })).toMatchObject({ ok: false, code: 'NOT_PLANNING_PHASE' });
    expect(issueOrder(session, { type: 'USE_EFFECT', side: 'BLUE', effect: 'jam' })).toMatchObject({ ok: false, code: 'NOT_PLANNING_PHASE' });
    stepSession(session, 270);
    expect(issueOrder(session, { type: 'USE_EFFECT', side: 'BLUE', effect: 'jam' }).ok).toBe(true);
  });

  it('rejouer les ordres du joueur reproduit exactement la partie interarmées', () => {
    const session = playerGame();
    const recording = recordingOf(session);
    const again = replay(recording, session.state.time);
    expect(hashState(again.state)).toBe(hashState(session.state));
    expect(verifyReplay(recording, session.state)).toBe(true);
    const without = replay({ ...recording, orders: [] }, session.state.time);
    expect(hashState(without.state)).not.toBe(hashState(session.state));
  });

  it('tous les systèmes tournent ensemble sans violer les contrôles de cohérence', () => {
    const session = playerGame();
    const s = session.state;
    for (let i = 0; i < 40 * 60; i++) {
      const before = snapshotPositions(s);
      stepSession(session, 1);
      expect(checkInvariants(s, before)).toEqual([]);
    }
    // Le satellite bleu est passé, les réseaux rouges ont été perturbés puis rétablis.
    expect(s.satellites.find((p) => p.side === 'BLUE')!.phase).toBe('done');
    expect(s.events.some((e) => e.code === 'SERVICE_RESTORED' && e.vis.includes('RED'))).toBe(true);
  });

  it('l’image d’un camp montre ses services, ses effets et ses satellites — jamais ceux de l’adversaire', () => {
    const session = playerGame();
    const s = session.state;
    const pic = getSidePicture(s, 'BLUE');
    expect(pic.services).toEqual(s.services.BLUE);
    expect(pic.effects).toEqual(s.effects.BLUE);
    expect(pic.satellites.map((p) => p.id)).toEqual(['sat-b']);
    expect(pic.objective.kind).toBe('ground');
    expect(pic.terrain.map((t) => t.kind)).toEqual(['urbain', 'foret']);
    // Les bases fixes adverses sont au dossier ; un pont d'envol ou un dépôt flottant, non : ils trahiraient un bâtiment.
    expect(pic.enemyBases.map((b) => b.name).sort()).toEqual(['Base Borée', 'Dépôt rouge']);
    const red = getSidePicture(s, 'RED');
    expect(red.enemyBases.some((b) => b.name === 'Pont d’envol')).toBe(false);

    for (const side of SIDES) {
      const json = JSON.stringify(getSidePicture(s, side));
      for (const u of Object.values(s.units)) {
        if (u.side !== side) expect(json.includes(`"${u.id}"`), `${side} voit ${u.id}`).toBe(false);
      }
      expect(json.includes(side === 'BLUE' ? '"sat-r"' : '"sat-b"')).toBe(false);
    }
  });
});
