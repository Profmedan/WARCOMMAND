import { describe, expect, it } from 'vitest';
import { checkInvariants, DEFAULT_RULES, distanceKm, firstLandToward, getSidePicture, hashState, isGroundForce, isLand, isNaval, pathOnLand, SIDES, snapshotPositions } from '@warcommand/simulation-core';
import { getPlatform } from '@warcommand/unit-database';
import { createInitialState, createSession, parseScenario, runToEnd, SCENARIOS, stepSession, TETE_DE_PONT, TETE_DE_PONT_INPUT } from '../src/index';

const kindOf = (platformId: string) => getPlatform(platformId).kind;
const unit = (id: string) => TETE_DE_PONT.units.find((u) => u.id === id)!;

describe('scénario « Tête de pont »', () => {
  it('est valide, livré avec le jeu, et se charge pour chaque camp', () => {
    const parsed = parseScenario(TETE_DE_PONT_INPUT);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    expect(SCENARIOS.map((sc) => sc.id)).toEqual(['bouclier-atlantique', 'breche-boreale', 'tete-de-pont']);
    for (const playerSide of ['BLUE', 'RED', null] as const) {
      const s = createInitialState(TETE_DE_PONT, { playerSide, difficulty: 'standard', seed: 1 });
      expect(s.objective.kind).toBe('ground');
      expect(s.objective.controller).toBe('BLUE');
    }
  });

  it('réunit toutes les composantes de la phase 5 dans les deux camps', () => {
    const sc = TETE_DE_PONT;
    for (const side of ['BLUE', 'RED'] as const) {
      const kinds = new Set(sc.units.filter((u) => u.side === side).map((u) => kindOf(u.platformId)));
      for (const kind of ['fighter', 'mech', 'armor', 'artillery', 'recon', 'logistics', 'hq', 'sam', 'sof', 'sub']) {
        expect(kinds.has(kind as never), `${side} : ${kind}`).toBe(true);
      }
      expect(sc.sides[side].effects.cyber + sc.sides[side].effects.jam).toBeGreaterThan(0);
      expect(sc.satellites.some((p) => p.side === side)).toBe(true);
      expect(sc.bases.some((b) => b.side === side && b.supplyStock > 0)).toBe(true);
    }
    const kinds = new Set(sc.units.map((u) => kindOf(u.platformId)));
    for (const kind of ['carrier', 'amphib', 'supply', 'ship', 'infantry', 'engineer', 'aew']) expect(kinds.has(kind as never), kind).toBe(true);
    // Aviation embarquée, troupe embarquée, dépôt flottant, escortes.
    const deck = sc.bases.find((b) => b.hostUnitId !== undefined && kindOf(unit(b.hostUnitId).platformId) === 'carrier')!;
    expect(sc.units.filter((u) => u.baseId === deck.id).length).toBeGreaterThanOrEqual(2);
    expect(sc.bases.some((b) => b.hostUnitId !== undefined && kindOf(unit(b.hostUnitId).platformId) === 'supply')).toBe(true);
    expect(sc.units.filter((u) => u.embarkedIn !== undefined)).toHaveLength(1);
    expect(sc.units.filter((u) => u.leaderId !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(sc.terrain.length).toBeGreaterThanOrEqual(3);
    expect(sc.navalZones.BLUE).not.toBeNull();
    expect(sc.navalZones.RED).not.toBeNull();
  });

  it('respecte la géographie : formations à terre, bâtiments en mer, axes d’attaque praticables', () => {
    const sc = TETE_DE_PONT;
    const o = sc.objective.center;
    for (const u of sc.units) {
      const kind = kindOf(u.platformId);
      if (isGroundForce(kind) && u.embarkedIn === undefined) expect(isLand(u.pos!), u.id).toBe(true);
      if (isNaval(kind)) expect(isLand(u.pos!), u.id).toBe(false);
    }
    // Les formations de mêlée rouges peuvent marcher droit sur l'objectif.
    for (const u of sc.units.filter((x) => x.side === 'RED' && ['armor', 'mech'].includes(kindOf(x.platformId)) && x.embarkedIn === undefined)) {
      expect(pathOnLand(u.pos!, o), u.id).toBe(true);
      expect(distanceKm(u.pos!, o)).toBeGreaterThan(sc.objective.radiusKm + 8);
    }
    // Le navire amphibie a une côte devant lui, d'où l'objectif est accessible à pied.
    const amphib = sc.units.find((u) => kindOf(u.platformId) === 'amphib')!;
    const beach = firstLandToward(amphib.pos!, o);
    expect(beach).not.toBeNull();
    expect(distanceKm(amphib.pos!, beach!)).toBeLessThan(40);
    // La défense tient l'objectif au départ.
    expect(sc.units.some((u) => u.side === 'BLUE' && kindOf(u.platformId) === 'mech' && distanceKm(u.pos!, o) < sc.objective.radiusKm)).toBe(true);
  });

  it('rattache les équipes spéciales à un dépôt avancé : sur zone en moins de trois quarts d’heure', () => {
    const sc = TETE_DE_PONT;
    const teams = sc.units.filter((u) => kindOf(u.platformId) === 'sof');
    expect(teams.map((u) => u.side).sort()).toEqual(['BLUE', 'RED']);
    for (const team of teams) {
      const base = sc.bases.find((b) => b.id === team.baseId)!;
      const minutes = (distanceKm(base.pos, sc.objective.center) / DEFAULT_RULES.sofInsertKmh) * 60;
      expect(minutes, team.id).toBeLessThan(45);
    }
  });
});

describe('« Tête de pont » — parties complètes, IA contre IA', () => {
  it('se joue de bout en bout sans violer un contrôle de cohérence ni refuser un ordre de l’IA, toutes composantes engagées', () => {
    const session = createSession(TETE_DE_PONT, { playerSide: null, seed: 3 });
    const s = session.state;
    while (!s.outcome) {
      const before = snapshotPositions(s);
      stepSession(session, 1);
      const errors = checkInvariants(s, before);
      if (errors.length > 0) throw new Error(`t=${s.time} : ${errors.join(' ; ')}`);
    }
    expect(s.outcome.reason).toBe('time');
    for (const side of SIDES) {
      expect(s.ai[side]!.log.filter((d) => d.code === 'ORDER_REJECTED').map((d) => `${d.p.order}/${d.p.reason}`), side).toEqual([]);
    }
    const codes = new Set(s.events.map((e) => e.code));
    for (const code of ['LAND_ORDER', 'LAND_IN_CONTACT', 'CAS_REQUEST', 'TROOPS_LANDING', 'TROOPS_LANDED', 'EFFECT_USED', 'SERVICE_DEGRADED', 'SERVICE_RESTORED', 'SAT_PASS_START', 'SAT_PASS_END', 'SOF_INSERTING']) {
      expect(codes.has(code as never), code).toBe(true);
    }
    // L'appui aérien a frappé des formations terrestres, et les deux camps ont perdu du monde à terre.
    expect(s.events.some((e) => e.code === 'SHOT_FIRED' && e.p.weapon === 'asm')).toBe(true);
    expect(s.stats.BLUE.landStrengthLost).toBeGreaterThan(0);
    expect(s.stats.RED.landStrengthLost).toBeGreaterThan(0);
    // Le décompte de contrôle couvre toute la durée.
    expect(s.objective.sec.BLUE + s.objective.sec.RED + s.objective.sec.CONTESTED).toBe(s.endTime);
  });

  it('est reproductible : même graine, même partie ; autre graine, autre partie', () => {
    const play = (seed: number) => {
      const session = createSession(TETE_DE_PONT, { playerSide: null, seed });
      runToEnd(session);
      return hashState(session.state);
    };
    const first = play(7);
    expect(play(7)).toBe(first);
    expect(play(8)).not.toBe(first);
  });

  it('l’image d’un camp ne contient jamais l’identifiant d’une unité adverse, tout au long de la partie', () => {
    const session = createSession(TETE_DE_PONT, { playerSide: null, seed: 5 });
    const s = session.state;
    const enemyIds = (side: 'BLUE' | 'RED') => Object.values(s.units).filter((u) => u.side !== side).map((u) => `"${u.id}"`);
    while (!s.outcome) {
      stepSession(session, 300);
      for (const side of SIDES) {
        const json = JSON.stringify(getSidePicture(s, side));
        for (const id of enemyIds(side)) expect(json.includes(id), `${side} voit ${id}`).toBe(false);
      }
    }
  });
});
