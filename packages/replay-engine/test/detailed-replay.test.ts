import { describe, expect, it } from 'vitest';
import { hashState } from '@warcommand/simulation-core';
import { BOUCLIER_ATLANTIQUE, createSession, issueOrder, runToEnd, stepSession, type Session } from '@warcommand/scenario-system';
import { createReplayCursor, loadRecording, recordingOf, replay, saveGame } from '../src/index';

/** Partie jouée par BLEU avec un ordre en cours de route : la patrouille initiale est annulée à la dixième minute. */
function playedGame(): Session {
  const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', seed: 99, difficulty: 'standard' });
  stepSession(session, 600);
  const cap = Object.values(session.state.missions).find((m) => m.side === 'BLUE' && m.type === 'CAP')!;
  expect(issueOrder(session, { type: 'CANCEL_MISSION', side: 'BLUE', missionId: cap.id }).ok).toBe(true);
  runToEnd(session);
  return session;
}

describe('rejeu détaillé : consultation à tout instant', () => {
  const session = playedGame();
  const recording = recordingOf(session);
  const cursor = createReplayCursor(recording);

  it('restitue le même état que la re-simulation directe, en avant, en arrière et pas à pas', () => {
    for (const t of [0, 1, 599, 600, 601, 1234, 1235, 1236, 2400, 300, 301, cursor.endTime - 1, cursor.endTime]) {
      expect(hashState(cursor.stateAt(t))).toBe(hashState(replay(recording, t).state));
    }
  });

  it('ne modifie jamais un état déjà rendu', () => {
    const first = cursor.stateAt(1000);
    const before = hashState(first);
    cursor.stateAt(1001);
    cursor.stateAt(1500);
    expect(first.time).toBe(1000);
    expect(hashState(first)).toBe(before);
  });

  it('donne le journal complet de la partie, pour la chronologie', () => {
    expect(cursor.events).toEqual(session.state.events);
  });
});

describe('rejeu détaillé : traces des unités', () => {
  const session = playedGame();
  const cursor = createReplayCursor(recordingOf(session));

  it('garde la trace d’un appareil : des points ordonnés, tous pris pendant qu’il volait', () => {
    const trail = cursor.trail('blue-awacs', 1800, 900);
    expect(trail.length).toBeGreaterThan(10);
    for (let i = 1; i < trail.length; i++) expect(trail[i]!.t).toBeGreaterThan(trail[i - 1]!.t);
    expect(trail[0]!.t).toBeGreaterThanOrEqual(900);
    expect(trail.at(-1)!.t).toBeLessThanOrEqual(1800);
    for (const p of trail) expect(p.altM).toBeGreaterThan(0);
  });

  it('le dernier point de la trace est la position de l’unité à cet instant', () => {
    const t = 1800;
    const unit = cursor.stateAt(t).units['blue-awacs']!;
    const last = cursor.trail('blue-awacs', t, 600).at(-1)!;
    expect(last.t).toBe(t);
    expect(last.lat).toBeCloseTo(unit.pos.lat, 9);
    expect(last.lon).toBeCloseTo(unit.pos.lon, 9);
  });

  it('ne trace rien pour un appareil resté au sol, ni pour une unité inconnue', () => {
    expect(cursor.trail('blue-raf-1', 300, 300)).toEqual([]);
    expect(cursor.trail('inconnue', 1800, 900)).toEqual([]);
  });
});

describe('rejeu détaillé : relire un enregistrement exporté', () => {
  const session = playedGame();
  const exported: unknown = JSON.parse(JSON.stringify(recordingOf(session)));

  it('accepte un enregistrement exporté et le rejoue à l’identique', () => {
    const loaded = loadRecording(exported);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.recording.orders).toHaveLength(1);
    expect(hashState(replay(loaded.recording).state)).toBe(hashState(session.state));
  });

  it.each<[string, unknown, RegExp]>([
    ['une donnée qui n’est pas un objet', 42, /illisible/i],
    ['une sauvegarde de partie', JSON.parse(JSON.stringify(saveGame(session))), /sauvegarde/i],
    ['un autre format', { format: 'autre', version: 1 }, /enregistrement WAR COMMAND/i],
    ['une autre version', { ...(exported as object), version: 9 }, /version/i],
    ['un scénario invalide', { ...(exported as object), scenario: { id: 'x' } }, /./],
    ['des ordres mal formés', { ...(exported as object), orders: [{ t: 'bientôt', order: {} }] }, /ordre/i],
    ['des ordres sans camp', { ...(exported as object), orders: [{ t: 10, order: { type: 'CANCEL_MISSION' } }] }, /ordre/i],
    ['une graine invalide', { ...(exported as object), options: { playerSide: 'BLUE', difficulty: 'standard', seed: -1 } }, /graine/i],
    ['un camp inconnu', { ...(exported as object), options: { playerSide: 'VERT', difficulty: 'standard', seed: 1 } }, /camp/i],
    ['une difficulté inconnue', { ...(exported as object), options: { playerSide: 'BLUE', difficulty: 'divin', seed: 1 } }, /difficulté/i],
  ])('refuse %s', (_label, data, message) => {
    const loaded = loadRecording(data);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.errors.join(' ')).toMatch(message);
  });

  it('un ordre que le moteur ne sait pas lire ne fait pas échouer le chargement : il est refusé au rejeu', () => {
    const odd = { ...(exported as { orders: unknown[] }), orders: [{ t: 30, order: { type: 'ORDRE_INCONNU', side: 'BLUE' } }] };
    const loaded = loadRecording(odd);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(replay(loaded.recording).state.outcome).not.toBeNull();
  });
});
