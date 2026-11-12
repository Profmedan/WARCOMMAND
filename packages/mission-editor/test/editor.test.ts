import { describe, expect, it } from 'vitest';
import { cloneData, distanceKm } from '@warcommand/simulation-core';
import { BOUCLIER_ATLANTIQUE, BRECHE_BOREALE, type Scenario } from '@warcommand/scenario-system';
import {
  addBase,
  addGroup,
  addMission,
  addTrigger,
  addUnit,
  checkScenario,
  createBlankScenario,
  duplicateScenario,
  exportScenarioJson,
  importScenarioJson,
  moveUnit,
  quickTest,
  removeBase,
  removeGroup,
  removeMission,
  removeTrigger,
  removeUnit,
  renameGroup,
  setIntel,
  setNavalZone,
  setObjective,
  updateBase,
  updateMission,
  updateUnit,
  type EditResult,
} from '../src/index';

const ICELAND = { lat: 65.28, lon: -14.4 };
const JAN_MAYEN = { lat: 70.95, lon: -8.6 };
const SECTOR = { lat: 67.0, lon: -11.0 };

/** Déballe un résultat d'édition qui doit réussir. */
function ok(result: EditResult): Scenario {
  if (!result.ok) throw new Error(`édition refusée : ${result.error}`);
  return result.draft;
}

/** Scénario minimal jouable : une base et deux chasseurs par camp. */
function small(): Scenario {
  let d = createBlankScenario({ title: 'Essai', seed: 7 });
  d = ok(addBase(d, { side: 'BLUE', pos: ICELAND }));
  d = ok(addBase(d, { side: 'RED', pos: JAN_MAYEN }));
  for (let i = 0; i < 2; i++) d = ok(addUnit(d, { side: 'BLUE', platformId: 'rafale', pos: ICELAND }));
  for (let i = 0; i < 2; i++) d = ok(addUnit(d, { side: 'RED', platformId: 'su35s', pos: JAN_MAYEN }));
  return ok(setObjective(d, { center: SECTOR, radiusKm: 110 }));
}

describe('scénario vierge', () => {
  it('porte le titre et la graine demandés, sans forces, et dit ce qui lui manque en français', () => {
    const d = createBlankScenario({ title: 'Essai', seed: 7 });
    expect(d).toMatchObject({ formatVersion: 1, title: 'Essai', seed: 7, units: [], bases: [], missions: [], triggers: [] });
    expect(d.id).toBe('essai');
    expect(d.groups.map((g) => g.side).sort()).toEqual(['BLUE', 'RED']);
    const check = checkScenario(d);
    expect(check.errors).toContain('Ajoutez au moins une unité.');
  });

  it('ne modifie jamais le brouillon d’origine', () => {
    const d = createBlankScenario({ title: 'Essai', seed: 7 });
    const before = JSON.stringify(d);
    addBase(d, { side: 'BLUE', pos: ICELAND });
    setObjective(d, { radiusKm: 50 });
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('bases et unités', () => {
  it('nomme et identifie bases et unités sans doublon, et rattache les aéronefs à leur base', () => {
    const d = small();
    expect(d.bases.map((b) => [b.id, b.name, b.side])).toEqual([
      ['blue-base-1', 'Base bleue 1', 'BLUE'],
      ['red-base-1', 'Base rouge 1', 'RED'],
    ]);
    const blue = d.units.filter((u) => u.side === 'BLUE');
    expect(blue.map((u) => [u.id, u.name, u.baseId])).toEqual([
      ['blue-rafale-1', 'Rafale 1', 'blue-base-1'],
      ['blue-rafale-2', 'Rafale 2', 'blue-base-1'],
    ]);
    // Les deux chasseurs partagent le même groupe, créé une seule fois.
    expect(new Set(blue.map((u) => u.groupId)).size).toBe(1);
    expect(d.groups.find((g) => g.id === blue[0]!.groupId)).toMatchObject({ side: 'BLUE' });
  });

  it('refuse un aéronef si le camp n’a pas de base, et un matériel inconnu', () => {
    const d = createBlankScenario({ title: 'Essai', seed: 7 });
    const noBase = addUnit(d, { side: 'BLUE', platformId: 'rafale', pos: ICELAND });
    expect(noBase.ok).toBe(false);
    if (!noBase.ok) expect(noBase.error).toMatch(/base/);
    expect(addUnit(d, { side: 'BLUE', platformId: 'x-wing', pos: ICELAND })).toMatchObject({ ok: false });
  });

  it('rattache un aéronef à la base amie la plus proche du point indiqué', () => {
    let d = small();
    d = ok(addBase(d, { side: 'BLUE', pos: { lat: 64.0, lon: -22.0 } }));
    const res = addUnit(d, { side: 'BLUE', platformId: 'e3', pos: { lat: 64.2, lon: -21.0 } });
    d = ok(res);
    expect(d.units.find((u) => u.id === (res as { id: string }).id)!.baseId).toBe('blue-base-2');
  });

  it('met un aéronef en vol à l’altitude habituelle de son rôle, à l’endroit indiqué', () => {
    const here = { lat: 66, lon: -13 };
    const res = addUnit(small(), { side: 'BLUE', platformId: 'e3', pos: here, airborne: true });
    const u = ok(res).units.find((x) => x.id === (res as { id: string }).id)!;
    expect(u.airborne).toMatchObject({ pos: here, altM: 8800 });
    expect(u.name).toBe('E-3 Sentry 1');
  });

  it('place une unité de surface là où on la pose, sans base', () => {
    const at = { lat: 66.4, lon: -12.5 };
    const res = addUnit(small(), { side: 'BLUE', platformId: 'frigate-aaw-generic', pos: at });
    const u = ok(res).units.find((x) => x.id === (res as { id: string }).id)!;
    expect(u.pos).toEqual(at);
    expect(u.baseId).toBeUndefined();
    expect(u.name).toBe('Frégate 1');
  });

  it('déplace une unité de surface ou un aéronef en vol, mais pas un aéronef au sol', () => {
    let d = small();
    const ship = addUnit(d, { side: 'BLUE', platformId: 'frigate-aaw-generic', pos: { lat: 66.4, lon: -12.5 } });
    d = ok(ship);
    const awacs = addUnit(d, { side: 'BLUE', platformId: 'e3', pos: { lat: 66, lon: -13 }, airborne: true });
    d = ok(awacs);
    const to = { lat: 66.8, lon: -12 };
    d = ok(moveUnit(d, (ship as { id: string }).id, to));
    d = ok(moveUnit(d, (awacs as { id: string }).id, to));
    expect(d.units.find((u) => u.id === (ship as { id: string }).id)!.pos).toEqual(to);
    expect(d.units.find((u) => u.id === (awacs as { id: string }).id)!.airborne!.pos).toEqual(to);
    const grounded = moveUnit(d, 'blue-rafale-1', to);
    expect(grounded.ok).toBe(false);
    if (!grounded.ok) expect(grounded.error).toMatch(/base/);
  });

  it('modifie une unité et refuse les incohérences', () => {
    let d = small();
    d = ok(updateUnit(d, 'blue-rafale-1', { name: 'Leader', crew: 0.9, unavailableForMin: 20 }));
    expect(d.units.find((u) => u.id === 'blue-rafale-1')).toMatchObject({ name: 'Leader', crew: 0.9, unavailableForMin: 20 });
    d = ok(updateUnit(d, 'blue-rafale-1', { unavailableForMin: null }));
    expect(d.units.find((u) => u.id === 'blue-rafale-1')!.unavailableForMin).toBeUndefined();
    const redGroup = d.groups.find((g) => g.side === 'RED')!.id;
    expect(updateUnit(d, 'blue-rafale-1', { groupId: redGroup }).ok).toBe(false);
    expect(updateUnit(d, 'blue-rafale-1', { baseId: 'red-base-1' }).ok).toBe(false);
    expect(updateUnit(d, 'blue-rafale-1', { crew: 1.4 }).ok).toBe(false);
    expect(updateUnit(d, 'inconnue', { name: 'x' }).ok).toBe(false);
  });

  it('supprimer une unité la retire des missions, supprime la mission vidée et le renseignement qui la visait', () => {
    let d = small();
    d = ok(addMission(d, { side: 'BLUE', type: 'CAP', unitIds: ['blue-rafale-1', 'blue-rafale-2'], waypoints: [SECTOR] }));
    d = ok(addMission(d, { side: 'RED', type: 'CAP', unitIds: ['red-su35s-1'], waypoints: [SECTOR] }));
    d = ok(setIntel(d, 'BLUE', 'red-su35s-1', 30));
    expect(d.intel).toEqual([{ side: 'BLUE', unitId: 'red-su35s-1', ageMin: 30 }]);

    d = ok(removeUnit(d, 'blue-rafale-1'));
    expect(d.missions[0]!.unitIds).toEqual(['blue-rafale-2']);
    d = ok(removeUnit(d, 'red-su35s-1'));
    expect(d.missions).toHaveLength(1);
    expect(d.intel).toEqual([]);
    expect(d.units.map((u) => u.id)).toEqual(['blue-rafale-2', 'red-su35s-2']);
  });

  it('refuse de supprimer une base occupée ou un groupe non vide, les accepte une fois vides', () => {
    let d = small();
    const occupied = removeBase(d, 'blue-base-1');
    expect(occupied.ok).toBe(false);
    if (!occupied.ok) expect(occupied.error).toMatch(/2 aéronefs/);
    const group = d.units[0]!.groupId;
    expect(removeGroup(d, group).ok).toBe(false);
    d = ok(removeUnit(d, 'blue-rafale-1'));
    d = ok(removeUnit(d, 'blue-rafale-2'));
    d = ok(removeBase(d, 'blue-base-1'));
    d = ok(removeGroup(d, group));
    expect(d.bases.map((b) => b.id)).toEqual(['red-base-1']);
    expect(d.groups.some((g) => g.id === group)).toBe(false);
  });

  it('gère groupes, stocks et renommages', () => {
    let d = small();
    const g = addGroup(d, { side: 'BLUE', name: 'Escadron B' });
    d = ok(g);
    d = ok(renameGroup(d, (g as { id: string }).id, 'Escadron de réserve'));
    expect(d.groups.find((x) => x.id === (g as { id: string }).id)!.name).toBe('Escadron de réserve');
    d = ok(updateBase(d, 'blue-base-1', { name: 'Base Vigie', asmStock: 8, pos: { lat: 65.5, lon: -14 } }));
    expect(d.bases[0]).toMatchObject({ name: 'Base Vigie', asmStock: 8, pos: { lat: 65.5, lon: -14 } });
    expect(updateBase(d, 'blue-base-1', { weaponStock: -1 }).ok).toBe(false);
    expect(renameGroup(d, (g as { id: string }).id, '  ').ok).toBe(false);
  });
});

describe('missions, objectif, zones et déclencheurs', () => {
  it('ajoute une mission initiale avec les réglages habituels de son type', () => {
    const d = ok(addMission(small(), { side: 'BLUE', type: 'CAP', unitIds: ['blue-rafale-1'], waypoints: [SECTOR] }));
    expect(d.missions[0]).toMatchObject({ type: 'CAP', side: 'BLUE', altM: 9000, launchAtMin: 0, roe: 'defensive', speed: 'cruise', humanOnly: false });
  });

  it('refuse une mission sans appareil, sans point, ou confiée à un appareil adverse ou inadapté', () => {
    const d = small();
    expect(addMission(d, { side: 'BLUE', type: 'CAP', unitIds: [], waypoints: [SECTOR] }).ok).toBe(false);
    expect(addMission(d, { side: 'BLUE', type: 'CAP', unitIds: ['blue-rafale-1'], waypoints: [] }).ok).toBe(false);
    expect(addMission(d, { side: 'BLUE', type: 'CAP', unitIds: ['red-su35s-1'], waypoints: [SECTOR] }).ok).toBe(false);
    const wrongKind = addMission(d, { side: 'BLUE', type: 'AEW', unitIds: ['blue-rafale-1'], waypoints: [SECTOR] });
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.error).toMatch(/Rafale 1/);
  });

  it('modifie puis supprime une mission', () => {
    let d = ok(addMission(small(), { side: 'BLUE', type: 'CAP', unitIds: ['blue-rafale-1'], waypoints: [SECTOR] }));
    d = ok(updateMission(d, 0, { launchAtMin: 15, roe: 'free', name: 'CAP-NORD', emcon: true }));
    expect(d.missions[0]).toMatchObject({ launchAtMin: 15, roe: 'free', name: 'CAP-NORD', emcon: true });
    expect(updateMission(d, 0, { unitIds: ['red-su35s-1'] }).ok).toBe(false);
    expect(updateMission(d, 3, { launchAtMin: 1 }).ok).toBe(false);
    expect(ok(removeMission(d, 0)).missions).toEqual([]);
  });

  it('règle l’objectif et refuse des seuils incohérents', () => {
    let d = ok(setObjective(small(), { name: 'Secteur ZOULOU', defender: 'RED', defenderWinsAtMin: 70, challengerWinsBelowMin: 50 }));
    expect(d.objective).toMatchObject({ name: 'Secteur ZOULOU', defender: 'RED', defenderWinsAtMin: 70, challengerWinsBelowMin: 50, radiusKm: 110 });
    expect(setObjective(d, { challengerWinsBelowMin: 80 }).ok).toBe(false);
    expect(setObjective(d, { radiusKm: 0 }).ok).toBe(false);
    d = ok(setNavalZone(d, 'BLUE', { center: { lat: 66.4, lon: -12.5 }, radiusKm: 60 }));
    expect(d.navalZones.BLUE).toEqual({ center: { lat: 66.4, lon: -12.5 }, radiusKm: 60 });
    expect(ok(setNavalZone(d, 'BLUE', null)).navalZones.BLUE).toBeNull();
  });

  it('ajoute et retire des déclencheurs, avec des identifiants uniques', () => {
    let d = small();
    const message = { type: 'MESSAGE' as const, text: 'Mi-parcours.', vis: ['BLUE' as const, 'RED' as const] };
    const first = addTrigger(d, { condition: { type: 'TIME_ELAPSED', atMin: 45 }, actions: [message] });
    d = ok(first);
    const second = addTrigger(d, { condition: { type: 'LOSSES_AT_LEAST', side: 'RED', kind: 'fighter', count: 2 }, actions: [{ type: 'END_MISSION', winner: 'BLUE' }] });
    d = ok(second);
    expect(d.triggers.map((t) => t.id)).toEqual(['declencheur-1', 'declencheur-2']);
    expect(addTrigger(d, { condition: { type: 'TIME_ELAPSED', atMin: 10 }, actions: [] }).ok).toBe(false);
    expect(addTrigger(d, { condition: { type: 'GROUP_UNAVAILABLE', groupId: 'fantome' }, actions: [message] }).ok).toBe(false);
    d = ok(removeTrigger(d, 'declencheur-1'));
    expect(d.triggers.map((t) => t.id)).toEqual(['declencheur-2']);
  });
});

describe('patrouilles navales', () => {
  const SEA = { lat: 64.2, lon: -10.5 };
  const NEARBY = { lat: 64.5, lon: -10.0 };
  const FAR = { lat: 61.5, lon: -4.0 };

  /** Scénario minimal avec une frégate BLEUE en mer, sans zone de manœuvre. */
  function withFrigate(): { d: Scenario; id: string } {
    const res = addUnit(small(), { side: 'BLUE', platformId: 'frigate-generic', pos: SEA });
    if (!res.ok || !res.id) throw new Error('frégate refusée');
    return { d: res.draft, id: res.id };
  }

  /** Le même, avec une zone de manœuvre BLEUE et une patrouille à deux points. */
  function patrolling(): { d: Scenario; id: string } {
    const { d, id } = withFrigate();
    const zoned = ok(setNavalZone(d, 'BLUE', { center: SEA, radiusKm: 80 }));
    return { d: ok(updateUnit(zoned, id, { patrol: [SEA, NEARBY] })), id };
  }

  it('trace une patrouille à l’intérieur de la zone de manœuvre du camp : le scénario reste valide', () => {
    const { d, id } = patrolling();
    expect(d.units.find((u) => u.id === id)!.patrol).toEqual([SEA, NEARBY]);
    expect(checkScenario(d).errors).toEqual([]);
  });

  it('refuse une patrouille tant que le camp n’a pas de zone de manœuvre maritime', () => {
    const { d, id } = withFrigate();
    const res = updateUnit(d, id, { patrol: [SEA, NEARBY] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/zone de manœuvre/);
  });

  it('refuse un point de patrouille hors de la zone de manœuvre', () => {
    const { d, id } = withFrigate();
    const zoned = ok(setNavalZone(d, 'BLUE', { center: SEA, radiusKm: 80 }));
    const res = updateUnit(zoned, id, { patrol: [SEA, FAR] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/hors de la zone/);
  });

  it('refuse une patrouille pour autre chose qu’un bâtiment de surface, ou de plus de huit points', () => {
    const { d, id } = withFrigate();
    const zoned = ok(setNavalZone(d, 'BLUE', { center: SEA, radiusKm: 80 }));
    expect(updateUnit(zoned, 'blue-rafale-1', { patrol: [SEA] }).ok).toBe(false);
    expect(updateUnit(zoned, id, { patrol: Array.from({ length: 9 }, () => SEA) }).ok).toBe(false);
  });

  it('efface la patrouille : le bâtiment redevient immobile', () => {
    const { d, id } = patrolling();
    expect(d.units.find((u) => u.id === id)!.patrol).toHaveLength(2);
    const still = ok(updateUnit(d, id, { patrol: null }));
    expect(still.units.find((u) => u.id === id)!.patrol).toBeUndefined();
  });

  it('refuse de retirer ou de déplacer la zone de manœuvre si une patrouille en sortirait', () => {
    const { d } = patrolling();
    const removed = setNavalZone(d, 'BLUE', null);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error).toMatch(/Frégate 1/);
    expect(setNavalZone(d, 'BLUE', { center: FAR, radiusKm: 30 }).ok).toBe(false);
    // Agrandir la zone, ou toucher à celle de l'autre camp, reste permis.
    expect(setNavalZone(d, 'BLUE', { center: SEA, radiusKm: 120 }).ok).toBe(true);
    expect(setNavalZone(d, 'RED', null).ok).toBe(true);
  });
});

describe('vérification et test rapide', () => {
  it('un scénario construit pas à pas est valide, puis se joue de bout en bout', () => {
    const d = small();
    expect(checkScenario(d).errors).toEqual([]);
    const result = quickTest(d, { seed: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.endedAtMin).toBe(90);
    expect(result.controlMin.BLUE + result.controlMin.RED + result.controlMin.CONTESTED).toBeCloseTo(90, 5);
    expect(['BLUE', 'RED', 'DRAW']).toContain(result.winner);
    expect(result.violations).toEqual([]);
    expect(result.sorties.BLUE + result.sorties.RED).toBeGreaterThan(0);
  });

  it('le test rapide est reproductible et refuse un scénario invalide', () => {
    const d = small();
    expect(quickTest(d, { seed: 3 })).toEqual(quickTest(d, { seed: 3 }));
    const broken = quickTest(createBlankScenario({ title: 'Vide', seed: 1 }), { seed: 3 });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors.length).toBeGreaterThan(0);
  });

  it('avertit d’un camp sans chasseur et d’un secteur hors de portée du challenger', () => {
    let d = small();
    d = ok(removeUnit(d, 'red-su35s-1'));
    d = ok(removeUnit(d, 'red-su35s-2'));
    d = ok(addUnit(d, { side: 'RED', platformId: 'a50u', pos: JAN_MAYEN }));
    const noFighter = checkScenario(d);
    expect(noFighter.errors).toEqual([]);
    expect(noFighter.warnings.some((w) => /ROUGE/.test(w) && /chasseur/.test(w))).toBe(true);

    // Secteur à plus de 1 500 km de la base rouge : hors de portée d'un Su-35 de jeu.
    let far = ok(setObjective(small(), { center: { lat: 62.0, lon: -24.0 }, defender: 'BLUE' }));
    far = ok(updateBase(far, 'red-base-1', { pos: { lat: 73.5, lon: 3.5 } }));
    const check = checkScenario(far);
    expect(check.warnings.some((w) => /hors de portée/.test(w) && /ROUGE/.test(w))).toBe(true);
    // Le scénario d'origine n'a pas cet avertissement.
    expect(checkScenario(small()).warnings.some((w) => /hors de portée/.test(w))).toBe(false);
  });

  it('avertit qu’un aéronef en vol sans mission initiale rentrera aussitôt', () => {
    const res = addUnit(small(), { side: 'BLUE', platformId: 'e3', pos: { lat: 66, lon: -13 }, airborne: true });
    const d = ok(res);
    expect(checkScenario(d).warnings.some((w) => /E-3 Sentry 1/.test(w) && /mission/.test(w))).toBe(true);
    const tasked = ok(addMission(d, { side: 'BLUE', type: 'AEW', unitIds: [(res as { id: string }).id], waypoints: [{ lat: 66, lon: -13 }] }));
    expect(checkScenario(tasked).warnings.some((w) => /E-3 Sentry 1/.test(w))).toBe(false);
  });

  it('signale en erreur, en français, une mission initiale que le moteur refuserait', () => {
    const d = ok(addMission(small(), { side: 'BLUE', type: 'CAP', name: 'CAP-LOIN', unitIds: ['blue-rafale-1'], waypoints: [{ lat: 62, lon: 3 }] }));
    const check = checkScenario(d);
    expect(check.errors.some((e) => /CAP-LOIN/.test(e) && /rayon d’action/.test(e))).toBe(true);
  });

  it('les deux scénarios livrés passent la vérification sans erreur', () => {
    expect(checkScenario(BOUCLIER_ATLANTIQUE).errors).toEqual([]);
    expect(checkScenario(BRECHE_BOREALE).errors).toEqual([]);
  });
});

describe('duplication, export et import', () => {
  it('duplique sous un nouvel identifiant et un titre distinct, sans toucher à l’original', () => {
    const before = JSON.stringify(BOUCLIER_ATLANTIQUE);
    const copy = duplicateScenario(BOUCLIER_ATLANTIQUE, ['bouclier-atlantique', 'breche-boreale']);
    expect(copy.id).toBe('bouclier-atlantique-copie');
    expect(copy.title).toBe('Bouclier Atlantique (copie)');
    expect(copy.units).toEqual(BOUCLIER_ATLANTIQUE.units);
    expect(JSON.stringify(BOUCLIER_ATLANTIQUE)).toBe(before);
    const again = duplicateScenario(BOUCLIER_ATLANTIQUE, ['bouclier-atlantique', 'bouclier-atlantique-copie']);
    expect(again.id).toBe('bouclier-atlantique-copie-2');
    // La copie est indépendante : la modifier ne change pas l'original.
    copy.units[0]!.name = 'Modifié';
    expect(BOUCLIER_ATLANTIQUE.units[0]!.name).not.toBe('Modifié');
  });

  it('un scénario exporté se réimporte à l’identique', () => {
    const d = small();
    const back = importScenarioJson(exportScenarioJson(d));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.scenario).toEqual(d);
  });

  it('un brouillon encore sans unité, exporté par l’éditeur, se réimporte comme brouillon', () => {
    const blank = createBlankScenario({ title: 'Brouillon en cours', seed: 3 });
    const back = importScenarioJson(exportScenarioJson(blank));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.scenario).toEqual(blank);
      // Réimporté, il reste un brouillon : la vérification continue de le dire injouable.
      expect(checkScenario(back.scenario).errors.length).toBeGreaterThan(0);
    }
  });

  it('refuse un fichier dont le contenu n’a pas la forme d’un scénario, même partiel', () => {
    const broken = cloneData(small()) as unknown as { durationMin: unknown };
    broken.durationMin = 'longtemps';
    expect(importScenarioJson(JSON.stringify(broken)).ok).toBe(false);
  });

  it('refuse, avec un message en français, un fichier illisible, étranger ou d’une autre version', () => {
    const notJson = importScenarioJson('{ ceci n’est pas du JSON');
    expect(notJson).toMatchObject({ ok: false });
    if (!notJson.ok) expect(notJson.errors[0]).toMatch(/JSON/);

    const foreign = importScenarioJson(JSON.stringify({ format: 'warcommand-save', version: 1 }));
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]).toMatch(/sauvegarde/);

    const future = cloneData(small()) as unknown as { formatVersion: number };
    future.formatVersion = 2;
    const wrongVersion = importScenarioJson(JSON.stringify(future));
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) expect(wrongVersion.errors[0]).toMatch(/version 2/);

    expect(importScenarioJson('[]').ok).toBe(false);
  });

  it('place l’objectif d’un scénario vierge au centre de la région choisie', () => {
    const d = createBlankScenario({ title: 'Ailleurs', seed: 1, center: { lat: 35, lon: 18 } });
    expect(d.objective.center).toEqual({ lat: 35, lon: 18 });
    expect(d.region.center).toEqual({ lat: 35, lon: 18 });
    expect(d.region.bounds.west).toBeLessThan(18);
    expect(d.region.bounds.east).toBeGreaterThan(18);
    expect(distanceKm({ lat: d.region.bounds.south, lon: 18 }, { lat: d.region.bounds.north, lon: 18 })).toBeGreaterThan(800);
  });
});
