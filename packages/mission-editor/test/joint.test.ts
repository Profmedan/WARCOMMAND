import { describe, expect, it } from 'vitest';
import { isLand } from '@warcommand/simulation-core';
import { TETE_DE_PONT, type Scenario } from '@warcommand/scenario-system';
import {
  addBase,
  addSatellite,
  addTerrain,
  addUnit,
  checkScenario,
  createBlankScenario,
  moveUnit,
  quickTest,
  removeBase,
  removeSatellite,
  removeTerrain,
  removeUnit,
  setMeta,
  setNavalZone,
  setObjective,
  setSide,
  updateBase,
  updateSatellite,
  updateTerrain,
  updateUnit,
  type EditResult,
} from '../src/index';

/** Est de l'Islande : la localité, un point plus à l'est, la côte ouest du dépôt. */
const TOWN = { lat: 65.1, lon: -14.9 };
const EAST = { lat: 65.12, lon: -14.3 };
const WEST = { lat: 65.1, lon: -15.7 };
/** Au large : devant la côte est, puis plus au sud. */
const SEA = { lat: 65.38, lon: -13.45 };
const SEA_SOUTH = { lat: 63.6, lon: -11.8 };

function ok(result: EditResult): Scenario {
  if (!result.ok) throw new Error(`édition refusée : ${result.error}`);
  return result.draft;
}
/** Applique une édition qui doit réussir et rend aussi l'identifiant créé. */
function made(result: EditResult): { d: Scenario; id: string } {
  if (!result.ok) throw new Error(`édition refusée : ${result.error}`);
  return { d: result.draft, id: result.id! };
}
function refusal(result: EditResult): string {
  if (result.ok) throw new Error('édition acceptée alors qu’un refus était attendu');
  return result.error;
}
const blank = () => createBlankScenario({ title: 'Interarmées', seed: 11 });
const unit = (d: Scenario, id: string) => d.units.find((u) => u.id === id)!;

describe('géographie des points d’essai', () => {
  it('les points à terre sont à terre, les points en mer sont en mer', () => {
    for (const p of [TOWN, EAST, WEST]) expect(isLand(p)).toBe(true);
    for (const p of [SEA, SEA_SOUTH]) expect(isLand(p)).toBe(false);
  });
});

describe('formations terrestres', () => {
  it('pose une formation à terre, la nomme d’après son matériel et la range dans le groupement terrestre', () => {
    const { d, id } = made(addUnit(blank(), { side: 'BLUE', platformId: 'armor-bn-generic', pos: TOWN }));
    expect(unit(d, id)).toMatchObject({ name: 'Bataillon blindé 1', groupId: 'blue-terre', pos: TOWN });
    expect(d.groups.find((g) => g.id === 'blue-terre')?.name).toBe('Groupement terrestre');
  });

  it('refuse une formation terrestre en mer', () => {
    expect(refusal(addUnit(blank(), { side: 'RED', platformId: 'mech-bn-generic', pos: SEA }))).toMatch(/à terre/);
  });

  it('refuse de déplacer une formation en mer', () => {
    const { d, id } = made(addUnit(blank(), { side: 'RED', platformId: 'mech-bn-generic', pos: EAST }));
    expect(refusal(moveUnit(d, id, SEA))).toMatch(/à terre/);
    expect(unit(ok(moveUnit(d, id, TOWN)), id).pos).toEqual(TOWN);
  });

  it('règle effectifs, moral, ravitaillement et posture de départ d’une formation', () => {
    const { d, id } = made(addUnit(blank(), { side: 'BLUE', platformId: 'infantry-bn-generic', pos: TOWN }));
    const next = ok(updateUnit(d, id, { strength: 0.8, morale: 0.6, supply: 0.5, posture: 'defend' }));
    expect(unit(next, id)).toMatchObject({ strength: 0.8, morale: 0.6, supply: 0.5, posture: 'defend' });
    expect(refusal(updateUnit(d, id, { strength: 1.2 }))).toMatch(/0 et 100 %/);
    expect(refusal(updateUnit(d, id, { morale: -0.1 }))).toMatch(/0 et 100 %/);
  });

  it('réserve effectifs, moral et posture aux formations terrestres', () => {
    const { d, id } = made(addUnit(blank(), { side: 'BLUE', platformId: 'frigate-generic', pos: SEA }));
    expect(refusal(updateUnit(d, id, { strength: 0.8 }))).toMatch(/formation terrestre/);
    expect(refusal(updateUnit(d, id, { posture: 'defend' }))).toMatch(/formation terrestre/);
  });
});

describe('bâtiments', () => {
  it('refuse un bâtiment à terre, à la pose comme au déplacement', () => {
    expect(refusal(addUnit(blank(), { side: 'BLUE', platformId: 'destroyer-generic', pos: TOWN }))).toMatch(/en mer/);
    const { d, id } = made(addUnit(blank(), { side: 'BLUE', platformId: 'destroyer-generic', pos: SEA }));
    expect(unit(d, id)).toMatchObject({ name: 'Destroyer 1', groupId: 'blue-naval' });
    expect(refusal(moveUnit(d, id, TOWN))).toMatch(/en mer/);
  });

  it('désigne un chef de file à une escorte, et le retire', () => {
    const carrier = made(addUnit(blank(), { side: 'BLUE', platformId: 'carrier-generic', pos: SEA_SOUTH }));
    const frigate = made(addUnit(carrier.d, { side: 'BLUE', platformId: 'frigate-generic', pos: SEA }));
    const escorted = ok(updateUnit(frigate.d, frigate.id, { leaderId: carrier.id }));
    expect(unit(escorted, frigate.id).leaderId).toBe(carrier.id);
    expect(unit(ok(updateUnit(escorted, frigate.id, { leaderId: null })), frigate.id).leaderId).toBeUndefined();
  });

  it('refuse une escorte en boucle, en chaîne, adverse ou non navale', () => {
    const carrier = made(addUnit(blank(), { side: 'BLUE', platformId: 'carrier-generic', pos: SEA_SOUTH }));
    const frigate = made(addUnit(carrier.d, { side: 'BLUE', platformId: 'frigate-generic', pos: SEA }));
    const destroyer = made(addUnit(frigate.d, { side: 'BLUE', platformId: 'destroyer-generic', pos: SEA }));
    const enemy = made(addUnit(destroyer.d, { side: 'RED', platformId: 'frigate-generic', pos: SEA }));
    const troop = made(addUnit(enemy.d, { side: 'BLUE', platformId: 'mech-bn-generic', pos: TOWN }));
    const d = ok(updateUnit(troop.d, frigate.id, { leaderId: carrier.id }));
    expect(refusal(updateUnit(d, frigate.id, { leaderId: frigate.id }))).toMatch(/chef de file/);
    // Le porte-avions a déjà une escorte : il ne peut pas en suivre une autre.
    expect(refusal(updateUnit(d, carrier.id, { leaderId: destroyer.id }))).toMatch(/escorte/);
    // La frégate suit déjà le porte-avions : on ne la suit pas.
    expect(refusal(updateUnit(d, destroyer.id, { leaderId: frigate.id }))).toMatch(/suit/);
    expect(refusal(updateUnit(d, destroyer.id, { leaderId: enemy.id }))).toMatch(/chef de file/);
    expect(refusal(updateUnit(d, troop.id, { leaderId: carrier.id }))).toMatch(/bâtiment/);
  });

  it('libère l’escorte quand son chef de file est supprimé', () => {
    const leader = made(addUnit(blank(), { side: 'BLUE', platformId: 'destroyer-generic', pos: SEA_SOUTH }));
    const frigate = made(addUnit(leader.d, { side: 'BLUE', platformId: 'frigate-generic', pos: SEA }));
    const d = ok(removeUnit(ok(updateUnit(frigate.d, frigate.id, { leaderId: leader.id })), leader.id));
    expect(unit(d, frigate.id).leaderId).toBeUndefined();
  });

  it('trace une patrouille pour un sous-marin, en mer seulement', () => {
    const sub = made(addUnit(blank(), { side: 'RED', platformId: 'submarine-generic', pos: SEA }));
    const d = ok(setNavalZone(sub.d, 'RED', { center: SEA, radiusKm: 150 }));
    expect(unit(ok(updateUnit(d, sub.id, { patrol: [SEA, { lat: 65.6, lon: -12.9 }] })), sub.id).patrol).toHaveLength(2);
    expect(refusal(updateUnit(d, sub.id, { patrol: [SEA, EAST] }))).toMatch(/à terre/);
  });
});

describe('troupes embarquées', () => {
  function withAmphib() {
    const ship = made(addUnit(blank(), { side: 'RED', platformId: 'amphib-generic', pos: SEA }));
    const first = made(addUnit(ship.d, { side: 'RED', platformId: 'mech-bn-generic', pos: EAST }));
    const second = made(addUnit(first.d, { side: 'RED', platformId: 'infantry-bn-generic', pos: EAST }));
    const third = made(addUnit(second.d, { side: 'RED', platformId: 'armor-bn-generic', pos: EAST }));
    return { d: third.d, ship: ship.id, troops: [first.id, second.id, third.id] as const };
  }

  it('embarque une formation sur un navire amphibie de son camp : elle prend la position du bâtiment', () => {
    const { d, ship, troops } = withAmphib();
    const next = ok(updateUnit(d, troops[0], { embarkedIn: ship }));
    expect(unit(next, troops[0])).toMatchObject({ embarkedIn: ship, pos: SEA });
    expect(checkScenario(next).errors.filter((e) => e.includes(troops[0]))).toEqual([]);
  });

  it('refuse d’embarquer au-delà de la capacité, sur un bâtiment sans capacité de transport ou adverse', () => {
    const { d, ship, troops } = withAmphib();
    const full = ok(updateUnit(ok(updateUnit(d, troops[0], { embarkedIn: ship })), troops[1], { embarkedIn: ship }));
    expect(refusal(updateUnit(full, troops[2], { embarkedIn: ship }))).toMatch(/capacité/);
    const frigate = made(addUnit(d, { side: 'RED', platformId: 'frigate-generic', pos: SEA }));
    expect(refusal(updateUnit(frigate.d, troops[0], { embarkedIn: frigate.id }))).toMatch(/ne transporte pas/);
    const enemy = made(addUnit(d, { side: 'BLUE', platformId: 'amphib-generic', pos: SEA_SOUTH }));
    expect(refusal(updateUnit(enemy.d, troops[0], { embarkedIn: enemy.id }))).toMatch(/son camp/);
    expect(refusal(updateUnit(d, ship, { embarkedIn: ship }))).toMatch(/formation terrestre/);
  });

  it('une formation embarquée suit son bâtiment', () => {
    const { d, ship, troops } = withAmphib();
    const moved = ok(moveUnit(ok(updateUnit(d, troops[0], { embarkedIn: ship })), ship, SEA_SOUTH));
    expect(unit(moved, troops[0]).pos).toEqual(SEA_SOUTH);
  });

  it('déplacer une formation embarquée sur la côte la remet à terre ; en mer, c’est refusé', () => {
    const { d, ship, troops } = withAmphib();
    const aboard = ok(updateUnit(d, troops[0], { embarkedIn: ship }));
    expect(refusal(moveUnit(aboard, troops[0], SEA_SOUTH))).toMatch(/à bord/);
    const ashore = unit(ok(moveUnit(aboard, troops[0], EAST)), troops[0]);
    expect(ashore.embarkedIn).toBeUndefined();
    expect(ashore.pos).toEqual(EAST);
  });

  it('refuse de supprimer un bâtiment qui porte une formation', () => {
    const { d, ship, troops } = withAmphib();
    const aboard = ok(updateUnit(d, troops[0], { embarkedIn: ship }));
    expect(refusal(removeUnit(aboard, ship))).toMatch(/à bord/);
    expect(ok(removeUnit(ok(removeUnit(aboard, troops[0])), ship)).units.some((u) => u.id === ship)).toBe(false);
  });
});

describe('porte-avions et navire logistique', () => {
  it('un porte-avions arrive avec son pont d’envol : une base portée, où se rattachent les appareils embarqués', () => {
    const carrier = made(addUnit(blank(), { side: 'BLUE', platformId: 'carrier-generic', pos: SEA_SOUTH }));
    const deck = carrier.d.bases.find((b) => b.hostUnitId === carrier.id)!;
    expect(deck).toMatchObject({ side: 'BLUE', pos: SEA_SOUTH });
    expect(deck.name).toMatch(/Pont d’envol/);
    expect(deck.fuelStockKg).toBeGreaterThan(0);
    const jet = made(addUnit(carrier.d, { side: 'BLUE', platformId: 'rafale', pos: SEA_SOUTH, baseId: deck.id }));
    expect(unit(jet.d, jet.id).baseId).toBe(deck.id);
    expect(checkScenario(jet.d).errors.filter((e) => e.includes('base'))).toEqual([]);
  });

  it('refuse sur le pont un appareil qui n’est pas embarquable, et au-delà de sa capacité', () => {
    const carrier = made(addUnit(blank(), { side: 'BLUE', platformId: 'carrier-generic', pos: SEA_SOUTH }));
    const deck = carrier.d.bases.find((b) => b.hostUnitId === carrier.id)!;
    expect(refusal(addUnit(carrier.d, { side: 'BLUE', platformId: 'e3', pos: SEA_SOUTH, baseId: deck.id }))).toMatch(/porte-avions/);
    let d = carrier.d;
    for (let i = 0; i < 12; i++) d = ok(addUnit(d, { side: 'BLUE', platformId: 'rafale', pos: SEA_SOUTH, baseId: deck.id }));
    expect(refusal(addUnit(d, { side: 'BLUE', platformId: 'rafale', pos: SEA_SOUTH, baseId: deck.id }))).toMatch(/12 places/);
    // Même règle quand on change la base d'un appareil déjà posé.
    const land = made(addBase(carrier.d, { side: 'BLUE', pos: WEST }));
    const awacs = made(addUnit(land.d, { side: 'BLUE', platformId: 'e3', pos: WEST, baseId: land.id }));
    expect(refusal(updateUnit(awacs.d, awacs.id, { baseId: deck.id }))).toMatch(/porte-avions/);
  });

  it('un appareil posé sans base désignée ne choisit jamais un pont où il ne peut pas opérer', () => {
    const carrier = made(addUnit(blank(), { side: 'BLUE', platformId: 'carrier-generic', pos: SEA_SOUTH }));
    const land = made(addBase(carrier.d, { side: 'BLUE', pos: WEST }));
    const awacs = made(addUnit(land.d, { side: 'BLUE', platformId: 'e3', pos: SEA_SOUTH }));
    expect(unit(awacs.d, awacs.id).baseId).toBe(land.id);
  });

  it('le pont d’envol suit le porte-avions et ne se déplace pas seul', () => {
    const carrier = made(addUnit(blank(), { side: 'BLUE', platformId: 'carrier-generic', pos: SEA_SOUTH }));
    const deck = carrier.d.bases.find((b) => b.hostUnitId === carrier.id)!;
    expect(ok(moveUnit(carrier.d, carrier.id, SEA)).bases.find((b) => b.id === deck.id)!.pos).toEqual(SEA);
    expect(refusal(updateBase(carrier.d, deck.id, { pos: SEA }))).toMatch(/déplacez le bâtiment/);
  });

  it('un navire logistique arrive avec son dépôt flottant', () => {
    const ship = made(addUnit(blank(), { side: 'RED', platformId: 'supply-ship-generic', pos: SEA }));
    const depot = ship.d.bases.find((b) => b.hostUnitId === ship.id)!;
    expect(depot.supplyStock).toBeGreaterThan(0);
    expect(depot.weaponStock + depot.asmStock + depot.fuelStockKg).toBe(0);
    expect(refusal(addUnit(ship.d, { side: 'RED', platformId: 'su30sm', pos: SEA, baseId: depot.id }))).toMatch(/navire logistique/);
  });

  it('refuse de supprimer un porte-avions dont le pont porte des appareils ; sinon retire le pont avec lui', () => {
    const carrier = made(addUnit(blank(), { side: 'BLUE', platformId: 'carrier-generic', pos: SEA_SOUTH }));
    const deck = carrier.d.bases.find((b) => b.hostUnitId === carrier.id)!;
    const jet = made(addUnit(carrier.d, { side: 'BLUE', platformId: 'rafale', pos: SEA_SOUTH, baseId: deck.id }));
    expect(refusal(removeUnit(jet.d, carrier.id))).toMatch(/pont/);
    const gone = ok(removeUnit(carrier.d, carrier.id));
    expect(gone.bases).toEqual([]);
  });
});

describe('équipes spéciales', () => {
  it('rattache une équipe à la base terrestre la plus proche de son camp, sans position propre', () => {
    const far = made(addBase(blank(), { side: 'BLUE', pos: WEST }));
    const near = made(addBase(far.d, { side: 'BLUE', pos: TOWN }));
    const carrier = made(addUnit(near.d, { side: 'BLUE', platformId: 'carrier-generic', pos: SEA }));
    const team = made(addUnit(carrier.d, { side: 'BLUE', platformId: 'sof-team-generic', pos: EAST }));
    const u = unit(team.d, team.id);
    expect(u.baseId).toBe(near.id);
    expect(u.pos).toBeUndefined();
    expect(u.groupId).toBe('blue-speciales');
    expect(checkScenario(team.d).errors.filter((e) => e.includes(team.id))).toEqual([]);
  });

  it('refuse une équipe sans base terrestre, et ne la déplace pas sur la carte', () => {
    expect(refusal(addUnit(blank(), { side: 'RED', platformId: 'sof-team-generic', pos: EAST }))).toMatch(/base/);
    const base = made(addBase(blank(), { side: 'RED', pos: EAST }));
    const team = made(addUnit(base.d, { side: 'RED', platformId: 'sof-team-generic', pos: EAST }));
    expect(refusal(moveUnit(team.d, team.id, TOWN))).toMatch(/base/);
  });

  it('change la base d’une équipe, et empêche de supprimer la base dont elle part', () => {
    const first = made(addBase(blank(), { side: 'RED', pos: EAST }));
    const second = made(addBase(first.d, { side: 'RED', pos: TOWN }));
    const team = made(addUnit(second.d, { side: 'RED', platformId: 'sof-team-generic', pos: EAST }));
    expect(unit(ok(updateUnit(team.d, team.id, { baseId: second.id })), team.id).baseId).toBe(second.id);
    expect(refusal(removeBase(team.d, first.id))).toMatch(/1 unité y est rattachée/);
  });
});

describe('dépôts, effets et objectif terrestre', () => {
  it('règle le stock de ravitaillement d’une base : elle devient un dépôt', () => {
    const base = made(addBase(blank(), { side: 'BLUE', pos: WEST }));
    expect(ok(updateBase(base.d, base.id, { supplyStock: 400 })).bases[0]!.supplyStock).toBe(400);
    expect(refusal(updateBase(base.d, base.id, { supplyStock: -1 }))).toMatch(/ravitaillement/);
  });

  it('règle la résilience et les effets multi-domaines d’un camp', () => {
    const d = ok(setSide(blank(), 'RED', { resilience: 0.8, effects: { cyber: 2, jam: 1 } }));
    expect(d.sides.RED).toMatchObject({ resilience: 0.8, effects: { cyber: 2, jam: 1 } });
    expect(refusal(setSide(d, 'RED', { resilience: 1.5 }))).toMatch(/résilience/);
    expect(refusal(setSide(d, 'RED', { effects: { cyber: 6, jam: 0 } }))).toMatch(/cinq/);
    expect(refusal(setSide(d, 'RED', { effects: { cyber: 1.5, jam: 0 } }))).toMatch(/cinq/);
  });

  it('fait de l’objectif une zone à tenir au sol', () => {
    expect(ok(setObjective(blank(), { kind: 'ground', center: TOWN, radiusKm: 12 })).objective).toMatchObject({ kind: 'ground', radiusKm: 12 });
  });

  it('pour un objectif terrestre, avertit du camp sans formation de mêlée et ne réclame pas de chasseurs', () => {
    let d = ok(setObjective(blank(), { kind: 'ground', center: TOWN, radiusKm: 12 }));
    d = ok(addUnit(d, { side: 'BLUE', platformId: 'mech-bn-generic', pos: TOWN }));
    d = ok(addUnit(d, { side: 'RED', platformId: 'artillery-bn-generic', pos: EAST }));
    const check = checkScenario(d);
    expect(check.errors).toEqual([]);
    expect(check.warnings.some((w) => /ROUGE/.test(w) && /formation de mêlée/.test(w))).toBe(true);
    expect(check.warnings.some((w) => /BLEU/.test(w) && /formation de mêlée/.test(w))).toBe(false);
    expect(check.warnings.some((w) => /chasseur/.test(w))).toBe(false);
  });
});

describe('zones de terrain', () => {
  it('ajoute une zone, la modifie puis la retire', () => {
    const zone = made(addTerrain(blank(), { kind: 'urbain', center: TOWN }));
    expect(zone.d.terrain[0]).toMatchObject({ id: zone.id, kind: 'urbain', center: TOWN, name: 'Zone urbaine 1' });
    expect(zone.d.terrain[0]!.radiusKm).toBeGreaterThan(0);
    const changed = ok(updateTerrain(zone.d, zone.id, { kind: 'foret', radiusKm: 20, name: 'Bois du nord' }));
    expect(changed.terrain[0]).toMatchObject({ kind: 'foret', radiusKm: 20, name: 'Bois du nord' });
    expect(ok(removeTerrain(changed, zone.id)).terrain).toEqual([]);
  });

  it('refuse une zone hors de la région, de rayon nul ou sans nom', () => {
    expect(refusal(addTerrain(blank(), { kind: 'marais', center: { lat: 10, lon: 10 } }))).toMatch(/région/);
    const zone = made(addTerrain(blank(), { kind: 'montagne', center: TOWN }));
    expect(refusal(updateTerrain(zone.d, zone.id, { radiusKm: 0 }))).toMatch(/rayon/);
    expect(refusal(updateTerrain(zone.d, zone.id, { name: ' ' }))).toMatch(/nom/);
    expect(refusal(updateTerrain(zone.d, 'inconnue', { radiusKm: 5 }))).toMatch(/inconnue/);
  });
});

describe('satellites d’observation', () => {
  it('ajoute une fenêtre de couverture dans la durée du scénario', () => {
    const sat = made(addSatellite(blank(), { side: 'BLUE', center: TOWN }));
    const p = sat.d.satellites[0]!;
    expect(p).toMatchObject({ id: sat.id, side: 'BLUE', name: 'Observateur 1' });
    expect(p.footprint.center).toEqual(TOWN);
    expect(p.startMin).toBeGreaterThanOrEqual(0);
    expect(p.endMin).toBeGreaterThan(p.startMin);
    expect(p.endMin).toBeLessThanOrEqual(sat.d.durationMin);
    expect(checkScenario(ok(addUnit(sat.d, { side: 'BLUE', platformId: 'mech-bn-generic', pos: TOWN }))).errors).toEqual([]);
  });

  it('modifie la fenêtre et l’empreinte, et refuse une fenêtre vide ou qui dépasse la fin', () => {
    const sat = made(addSatellite(blank(), { side: 'RED', center: TOWN }));
    const changed = ok(updateSatellite(sat.d, sat.id, { startMin: 30, endMin: 50, radiusKm: 80, center: EAST, name: 'Veilleur' }));
    expect(changed.satellites[0]).toMatchObject({ startMin: 30, endMin: 50, name: 'Veilleur', footprint: { center: EAST, radiusKm: 80 } });
    expect(refusal(updateSatellite(sat.d, sat.id, { startMin: 40, endMin: 40 }))).toMatch(/fenêtre/);
    expect(refusal(updateSatellite(sat.d, sat.id, { endMin: sat.d.durationMin + 1 }))).toMatch(/durée/);
    expect(refusal(updateSatellite(sat.d, sat.id, { radiusKm: 0 }))).toMatch(/rayon/);
  });

  it('empêche de raccourcir le scénario sous une fenêtre de satellite, et retire une fenêtre', () => {
    const sat = made(addSatellite(blank(), { side: 'RED', center: TOWN }));
    const late = ok(updateSatellite(sat.d, sat.id, { startMin: 70, endMin: 85 }));
    expect(refusal(setMeta(late, { durationMin: 80 }))).toMatch(/satellite/);
    expect(ok(removeSatellite(late, sat.id)).satellites).toEqual([]);
  });
});

describe('scénario interarmées complet', () => {
  function joint(): Scenario {
    let d = ok(setObjective(blank(), { kind: 'ground', name: 'Localité CHARLIE', center: TOWN, radiusKm: 12, defender: 'BLUE' }));
    d = ok(setSide(d, 'BLUE', { effects: { cyber: 1, jam: 0 } }));
    d = ok(addTerrain(d, { kind: 'urbain', center: TOWN }));
    const depot = made(addBase(d, { side: 'BLUE', pos: WEST }));
    d = ok(updateBase(depot.d, depot.id, { supplyStock: 300 }));
    for (const platformId of ['mech-bn-generic', 'infantry-bn-generic', 'hq-generic']) d = ok(addUnit(d, { side: 'BLUE', platformId, pos: TOWN }));
    d = ok(addUnit(d, { side: 'BLUE', platformId: 'sof-team-generic', pos: WEST }));
    for (const platformId of ['armor-bn-generic', 'mech-bn-generic', 'artillery-bn-generic']) d = ok(addUnit(d, { side: 'RED', platformId, pos: EAST }));
    const ship = made(addUnit(d, { side: 'RED', platformId: 'amphib-generic', pos: SEA }));
    const troop = made(addUnit(ship.d, { side: 'RED', platformId: 'mech-bn-generic', pos: EAST }));
    d = ok(updateUnit(troop.d, troop.id, { embarkedIn: ship.id }));
    d = ok(addUnit(d, { side: 'RED', platformId: 'supply-ship-generic', pos: { lat: 65.1, lon: -13.49 } }));
    d = ok(addSatellite(d, { side: 'RED', center: TOWN }));
    return d;
  }

  it('un brouillon bâti opération par opération est valide', () => {
    expect(checkScenario(joint()).errors).toEqual([]);
  });

  it('se joue de bout en bout au test rapide, sans violation de cohérence, et de façon reproductible', () => {
    const d = ok(setMeta(joint(), { durationMin: 60 }));
    const result = quickTest(d, { seed: 4 });
    if (!result.ok) throw new Error(result.errors.join(' ; '));
    expect(result.violations).toEqual([]);
    expect(result.endedAtMin).toBe(60);
    // Le bilan du test dit ce que la bataille terrestre a coûté à chaque camp.
    expect(result.landStrengthLost.BLUE).toBeGreaterThanOrEqual(0);
    expect(result.landStrengthLost.BLUE + result.landStrengthLost.RED).toBeGreaterThan(0);
    expect(quickTest(d, { seed: 4 })).toEqual(result);
  });

  it('le scénario livré « Tête de pont » reste valide après retouches de l’éditeur', () => {
    let d: Scenario = TETE_DE_PONT;
    d = ok(moveUnit(d, 'blue-pa', { lat: 63.7, lon: -11.6 }));
    expect(d.bases.find((b) => b.id === 'pont-envol')!.pos).toEqual({ lat: 63.7, lon: -11.6 });
    d = ok(updateUnit(d, 'red-meca', { strength: 0.9 }));
    d = ok(moveUnit(d, 'red-amphib', { lat: 65.3, lon: -13.3 }));
    expect(unit(d, 'red-meca-2').pos).toEqual({ lat: 65.3, lon: -13.3 });
    d = ok(setSide(d, 'RED', { effects: { cyber: 0, jam: 2 } }));
    expect(checkScenario(d).errors).toEqual([]);
  });
});
