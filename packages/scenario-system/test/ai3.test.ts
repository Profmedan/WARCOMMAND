import { describe, expect, it } from 'vitest';
import { cloneData, getSidePicture, type AiMemory, type SidePicture } from '@warcommand/simulation-core';
import { observe } from '@warcommand/air-operations';
import { aiDecide, createAiMemory, type CommanderOrder } from '@warcommand/ai-commander';
import { applyGameOrder, BRECHE_BOREALE, createInitialState, validateGameOrder } from '../src/index';
import { freshState } from './helpers';

const decide = (pic: SidePicture, mem: AiMemory) => aiDecide(cloneData(pic), mem, () => 0.5);
const missions = (orders: CommanderOrder[], type: string) => orders.flatMap((o) => (o.type === 'CREATE_MISSION' && o.draft.type === type ? [o.draft] : []));

describe('IA : missions de la phase 3', () => {
  it('attaque une défense sol-air connue qui couvre le secteur, si elle a des munitions air-surface', () => {
    const s = freshState('BLUE');
    s.bases['base-boree']!.asmStock = 4;
    const frigate = observe(s, 'RED', s.units['blue-frg']!, true);
    const mem = createAiMemory('challenger', 'standard');
    const orders = decide(getSidePicture(s, 'RED'), mem);
    const sead = missions(orders, 'SEAD');
    expect(sead).toHaveLength(1);
    expect(sead[0]).toMatchObject({ targetContactId: frigate.id, roe: 'free' });
    expect(sead[0]!.unitIds).toHaveLength(2);
    // Il reste des chasseurs pour disputer le secteur.
    expect(missions(orders, 'CAP').flatMap((d) => d.unitIds).length).toBeGreaterThanOrEqual(2);
    for (const o of orders) expect(validateGameOrder(s, o).ok).toBe(true);
    expect(mem.log.some((d) => d.code === 'LAUNCH_SEAD')).toBe(true);

    // Elle ne relance pas aussitôt une seconde attaque sur la même cible.
    const pic = getSidePicture(s, 'RED');
    pic.time += 120;
    expect(missions(decide(pic, mem), 'SEAD')).toHaveLength(0);
  });

  it('n’attaque pas sans munitions air-surface, ni une défense qui ne gêne pas le secteur', () => {
    const noStock = freshState('BLUE');
    observe(noStock, 'RED', noStock.units['blue-frg']!, true);
    expect(missions(decide(getSidePicture(noStock, 'RED'), createAiMemory('challenger', 'standard')), 'SEAD')).toHaveLength(0);

    // Le site sol-air bleu, près de sa base, est à plus de 250 km du secteur : hors sujet.
    const farSite = freshState('BLUE');
    farSite.bases['base-boree']!.asmStock = 4;
    expect(missions(decide(getSidePicture(farSite, 'RED'), createAiMemory('challenger', 'standard')), 'SEAD')).toHaveLength(0);
  });

  it('escorte son moyen de soutien menacé', () => {
    const s = freshState('RED');
    const awacs = s.units['blue-awacs']!;
    const intruder = s.units['red-su-1']!;
    intruder.status = 'airborne';
    intruder.altM = 9000;
    intruder.pos = { lat: awacs.pos.lat + 1.5, lon: awacs.pos.lon };
    observe(s, 'BLUE', intruder, true);
    const mem = createAiMemory('defender', 'standard');
    const orders = decide(getSidePicture(s, 'BLUE'), mem);
    const escort = missions(orders, 'ESCORT');
    expect(escort).toHaveLength(1);
    expect(escort[0]).toMatchObject({ escortUnitId: 'blue-awacs' });
    expect(escort[0]!.unitIds).toHaveLength(2);
    expect(missions(orders, 'INTERCEPT')).toHaveLength(0);
    for (const o of orders) expect(validateGameOrder(s, o).ok).toBe(true);
  });

  it('au niveau vétéran, patrouille en silence radar quand son avion-radar couvre la station ; pas au niveau standard', () => {
    const emcon = (difficulty: 'standard' | 'veteran') => {
      const s = freshState('RED');
      const orders = decide(getSidePicture(s, 'BLUE'), createAiMemory('defender', difficulty));
      const cap = missions(orders, 'CAP');
      expect(cap.length).toBeGreaterThan(0);
      return cap[0]!.emcon === true;
    };
    expect(emcon('veteran')).toBe(true);
    expect(emcon('standard')).toBe(false);
  });

  it('au niveau vétéran, garde son radar si aucun avion-radar ne couvre la station', () => {
    const s = freshState('RED');
    s.units['blue-awacs']!.status = 'destroyed';
    const cap = missions(decide(getSidePicture(s, 'BLUE'), createAiMemory('defender', 'veteran')), 'CAP');
    expect(cap.length).toBeGreaterThan(0);
    expect(cap[0]!.emcon === true).toBe(false);
  });

  it('attend l’effet de son attaque avant d’installer une patrouille dans un secteur entièrement couvert', () => {
    // « Brèche Boréale » : le secteur est couvert par un site sol-air (connu) et une frégate (repérée).
    const s = createInitialState(BRECHE_BOREALE, { playerSide: 'RED', difficulty: 'standard', seed: 1 });
    observe(s, 'BLUE', s.units['red-frg']!, true);
    const mem = createAiMemory('challenger', 'standard');

    const first = decide(getSidePicture(s, 'BLUE'), mem);
    expect(missions(first, 'SEAD').length).toBeGreaterThan(0);
    expect(missions(first, 'CAP')).toHaveLength(0);
    expect(mem.log.some((d) => d.code === 'HOLD_FOR_SEAD')).toBe(true);
    for (const o of first) expect(applyGameOrder(s, o).ok).toBe(true);

    // Tant que l'attaque est en cours, elle patiente — et n'en lance pas une seconde.
    expect(missions(first, 'SEAD')).toHaveLength(1);
    s.time += 120;
    const during = decide(getSidePicture(s, 'BLUE'), mem);
    expect(missions(during, 'CAP')).toHaveLength(0);
    expect(missions(during, 'SEAD')).toHaveLength(0);
    for (const o of during) expect(applyGameOrder(s, o).ok).toBe(true);

    // L'attaque terminée, elle installe sa patrouille.
    for (const m of Object.values(s.missions)) {
      if (m.side !== 'BLUE' || m.type !== 'SEAD') continue;
      m.status = 'completed';
      for (const u of Object.values(s.units)) if (u.missionId === m.id) u.missionId = null;
    }
    s.time += 120;
    const after = decide(getSidePicture(s, 'BLUE'), mem);
    expect(missions(after, 'CAP').length).toBeGreaterThan(0);
    for (const o of after) expect(applyGameOrder(s, o).ok).toBe(true);

    // Elle n'attend qu'une fois : une nouvelle attaque ne suspend plus les patrouilles suivantes.
    for (const m of Object.values(s.missions)) {
      if (m.side !== 'BLUE' || m.type !== 'CAP') continue;
      m.status = 'completed';
      for (const u of Object.values(s.units)) if (u.missionId === m.id) u.missionId = null;
    }
    s.time += 1200;
    const later = decide(getSidePicture(s, 'BLUE'), mem);
    expect(missions(later, 'CAP').length).toBeGreaterThan(0);
  });

  it('accompagne son attaque d’une escorte quand elle a assez de chasseurs, et garde une paire en réserve', () => {
    const s = createInitialState(BRECHE_BOREALE, { playerSide: 'RED', difficulty: 'standard', seed: 1 });
    observe(s, 'BLUE', s.units['red-frg']!, true);
    const mem = createAiMemory('challenger', 'standard');
    const orders = decide(getSidePicture(s, 'BLUE'), mem);
    const sead = missions(orders, 'SEAD');
    const escort = missions(orders, 'ESCORT');
    expect(sead).toHaveLength(1);
    expect(escort).toHaveLength(1);
    expect(escort[0]!.unitIds).toHaveLength(2);
    expect(sead[0]!.unitIds).toContain(escort[0]!.escortUnitId);
    expect(escort[0]!.roe).toBe('free');
    // L'escorte part avec l'attaque, pas dix minutes avant elle.
    expect(escort[0]!.launchAt).toBeGreaterThanOrEqual(s.time + s.rules.rearmDelayS);
    const engaged = new Set([...sead[0]!.unitIds, ...escort[0]!.unitIds]);
    expect(engaged.size).toBe(4);
    for (const o of orders) expect(applyGameOrder(s, o).ok).toBe(true);
    expect(Object.values(s.units).filter((u) => u.side === 'BLUE' && u.kind === 'fighter' && u.missionId === null)).toHaveLength(2);
  });

  it('avec quatre chasseurs seulement, l’attaque part sans escorte pour laisser une paire au secteur', () => {
    const s = freshState('BLUE');
    s.bases['base-boree']!.asmStock = 4;
    observe(s, 'RED', s.units['blue-frg']!, true);
    const orders = decide(getSidePicture(s, 'RED'), createAiMemory('challenger', 'standard'));
    expect(missions(orders, 'SEAD')).toHaveLength(1);
    expect(missions(orders, 'ESCORT')).toHaveLength(0);
  });

  it('ne protège qu’un moyen de soutien à la fois, et jamais avec sa dernière paire', () => {
    const threatened = () => {
      const s = freshState('RED');
      const awacs = s.units['blue-awacs']!;
      const intruder = s.units['red-su-1']!;
      intruder.status = 'airborne';
      intruder.altM = 9000;
      // À portée de menace de l'AWACS comme du ravitailleur.
      intruder.pos = { lat: awacs.pos.lat + 1.2, lon: awacs.pos.lon + 0.5 };
      observe(s, 'BLUE', intruder, true);
      return s;
    };

    const s = threatened();
    const mem = createAiMemory('defender', 'standard');
    const first = decide(getSidePicture(s, 'BLUE'), mem);
    for (const o of first) expect(applyGameOrder(s, o).ok).toBe(true);
    s.time += 700;
    Object.values(s.contacts.BLUE).forEach((c) => {
      c.lastSeen = s.time;
      c.radarSeenAt = s.time;
    });
    const second = decide(getSidePicture(s, 'BLUE'), mem);
    expect(missions(first, 'ESCORT')).toHaveLength(1);
    expect(missions(second, 'ESCORT')).toHaveLength(0);

    const few = threatened();
    few.units['blue-raf-3']!.status = 'destroyed';
    few.units['blue-raf-4']!.status = 'destroyed';
    const orders = decide(getSidePicture(few, 'BLUE'), createAiMemory('defender', 'standard'));
    expect(missions(orders, 'ESCORT')).toHaveLength(0);
    expect(missions(orders, 'CAP').flatMap((d) => d.unitIds)).toHaveLength(2);
  });

  it('n’attend pas quand une station du secteur échappe aux défenses connues', () => {
    // « Bouclier Atlantique » : la frégate bleue ne couvre qu'une frange du secteur.
    const s = freshState('BLUE');
    s.bases['base-boree']!.asmStock = 4;
    observe(s, 'RED', s.units['blue-frg']!, true);
    const mem = createAiMemory('challenger', 'standard');
    const orders = decide(getSidePicture(s, 'RED'), mem);
    expect(missions(orders, 'CAP').length).toBeGreaterThan(0);
    expect(mem.log.some((d) => d.code === 'HOLD_FOR_SEAD')).toBe(false);
  });
});
