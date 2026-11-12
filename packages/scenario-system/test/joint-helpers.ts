/**
 * Scénario d'essai interarmées : un petit théâtre fictif dans l'est de l'Islande, avec toutes les
 * familles d'unités de la phase 5. Les tests le modifient avant de le charger.
 */
import { expect } from 'vitest';
import { checkInvariants, destination, snapshotPositions, stepState, type LatLon, type SimState, type System } from '@warcommand/simulation-core';
import { createInitialState, parseScenario, type ScenarioInput } from '../src/index';

/** Centre de l'objectif terrestre. */
export const OBJ: LatLon = { lat: 65.0, lon: -17.0 };
export const west = (km: number, northKm = 0): LatLon => destination(destination(OBJ, 270, km), 0, northKm);
export const east = (km: number, northKm = 0): LatLon => destination(destination(OBJ, 90, km), 0, northKm);
/** Points en pleine mer, à l'est de l'Islande. */
export const SEA = {
  blueFrigate: { lat: 64.0, lon: -11.0 },
  blueCarrier: { lat: 63.5, lon: -12.0 },
  redDestroyer: { lat: 66.5, lon: -10.0 },
  redSub: { lat: 65.8, lon: -10.5 },
  redAmphib: { lat: 65.0, lon: -12.4 },
  redSupply: { lat: 65.1, lon: -12.2 },
} as const;

export function jointInput(): ScenarioInput {
  const ground = (id: string, side: 'BLUE' | 'RED', platformId: string, pos: LatLon, name: string) => ({
    id,
    side,
    name,
    platformId,
    groupId: side === 'BLUE' ? 'b-land' : 'r-land',
    pos,
  });
  const ship = (id: string, side: 'BLUE' | 'RED', platformId: string, pos: LatLon, name: string) => ({
    id,
    side,
    name,
    platformId,
    groupId: side === 'BLUE' ? 'b-sea' : 'r-sea',
    pos,
  });
  const jet = (id: string, side: 'BLUE' | 'RED', platformId: string, baseId: string, name: string) => ({
    id,
    side,
    name,
    platformId,
    groupId: side === 'BLUE' ? 'b-air' : 'r-air',
    baseId,
  });
  const sideDef = (name: string, doctrineId: string) => ({
    name,
    doctrineId,
    defaultRoe: 'defensive' as const,
    resilience: 0.5,
    effects: { cyber: 1, jam: 1 },
  });

  return {
    formatVersion: 1,
    id: 'essai-interarmees',
    title: 'Essai interarmées',
    description: 'Scénario d’essai des règles interarmées. Situation, bases et unités fictives.',
    region: { name: 'Est de l’Islande', bounds: { west: -26, south: 61, east: 4, north: 74 }, center: OBJ, zoom: 5 },
    date: '2031-06-14T10:00:00Z',
    period: 'Contemporaine, situation fictive',
    durationMin: 180,
    weather: { label: 'Ciel dégagé', sensorFactor: 1 },
    seed: 11,
    sides: { BLUE: sideDef('Coalition BLEUE', 'coalition-occidentale'), RED: sideDef('Coalition ROUGE', 'rouge-centralisee') },
    groups: [
      { id: 'b-land', side: 'BLUE', name: 'Groupement terrestre bleu' },
      { id: 'b-air', side: 'BLUE', name: 'Escadron bleu' },
      { id: 'b-sea', side: 'BLUE', name: 'Groupe naval bleu' },
      { id: 'r-land', side: 'RED', name: 'Groupement terrestre rouge' },
      { id: 'r-air', side: 'RED', name: 'Escadron rouge' },
      { id: 'r-sea', side: 'RED', name: 'Groupe naval rouge' },
    ],
    bases: [
      { id: 'b-airbase', side: 'BLUE', name: 'Base Vestri', pos: { lat: 64.5, lon: -21.5 }, weaponStock: 24, asmStock: 16, fuelStockKg: 200000 },
      { id: 'b-depot', side: 'BLUE', name: 'Dépôt bleu', pos: west(45), weaponStock: 0, asmStock: 0, fuelStockKg: 0, supplyStock: 600 },
      { id: 'b-deck', side: 'BLUE', name: 'Pont d’envol', pos: SEA.blueCarrier, weaponStock: 24, asmStock: 16, fuelStockKg: 200000, hostUnitId: 'b-cv' },
      { id: 'r-airbase', side: 'RED', name: 'Base Borée', pos: { lat: 70.95, lon: -8.6 }, weaponStock: 24, asmStock: 16, fuelStockKg: 200000 },
      { id: 'r-depot', side: 'RED', name: 'Dépôt rouge', pos: east(95), weaponStock: 0, asmStock: 0, fuelStockKg: 0, supplyStock: 600 },
      { id: 'r-afloat', side: 'RED', name: 'Dépôt flottant', pos: SEA.redSupply, weaponStock: 0, asmStock: 0, fuelStockKg: 0, supplyStock: 400, hostUnitId: 'r-aor' },
    ],
    units: [
      ground('b-hq', 'BLUE', 'hq-generic', west(40), 'PC bleu'),
      ground('b-mech', 'BLUE', 'mech-bn-generic', OBJ, '1er mécanisé'),
      ground('b-inf', 'BLUE', 'infantry-bn-generic', west(0, 3), '2e d’infanterie'),
      ground('b-art', 'BLUE', 'artillery-bn-generic', west(12), 'Artillerie bleue'),
      ground('b-eng', 'BLUE', 'engineer-coy-generic', west(2), 'Génie bleu'),
      ground('b-rec', 'BLUE', 'recon-sqn-generic', east(15), 'Reconnaissance bleue'),
      ground('b-log', 'BLUE', 'logistics-bn-generic', west(25), 'Logistique bleue'),
      jet('b-raf-1', 'BLUE', 'rafale', 'b-airbase', 'Rafale 1'),
      jet('b-raf-2', 'BLUE', 'rafale', 'b-airbase', 'Rafale 2'),
      jet('b-rafm-1', 'BLUE', 'rafale', 'b-deck', 'Rafale Marine 1'),
      jet('b-rafm-2', 'BLUE', 'rafale', 'b-deck', 'Rafale Marine 2'),
      { id: 'b-sof', side: 'BLUE', name: 'Équipe Alpha', platformId: 'sof-team-generic', groupId: 'b-land', baseId: 'b-airbase' },
      ship('b-frig', 'BLUE', 'frigate-generic', SEA.blueFrigate, 'Frégate bleue'),
      ship('b-cv', 'BLUE', 'carrier-generic', SEA.blueCarrier, 'Porte-avions bleu'),

      ground('r-hq', 'RED', 'hq-generic', east(85), 'PC rouge'),
      ground('r-arm', 'RED', 'armor-bn-generic', east(60), '1er blindé'),
      ground('r-mech', 'RED', 'mech-bn-generic', east(62, 3), '2e mécanisé'),
      ground('r-art', 'RED', 'artillery-bn-generic', east(75), 'Artillerie rouge'),
      ground('r-log', 'RED', 'logistics-bn-generic', east(80), 'Logistique rouge'),
      { ...ground('r-inf', 'RED', 'infantry-bn-generic', SEA.redAmphib, '3e d’infanterie'), embarkedIn: 'r-lst' },
      jet('r-su-1', 'RED', 'su35s', 'r-airbase', 'Su-35S 1'),
      jet('r-su-2', 'RED', 'su35s', 'r-airbase', 'Su-35S 2'),
      { id: 'r-sof', side: 'RED', name: 'Équipe Zoulou', platformId: 'sof-team-generic', groupId: 'r-land', baseId: 'r-airbase' },
      ship('r-dd', 'RED', 'destroyer-generic', SEA.redDestroyer, 'Destroyer rouge'),
      ship('r-sub', 'RED', 'submarine-generic', SEA.redSub, 'Sous-marin rouge'),
      ship('r-lst', 'RED', 'amphib-generic', SEA.redAmphib, 'Navire amphibie rouge'),
      ship('r-aor', 'RED', 'supply-ship-generic', SEA.redSupply, 'Navire logistique rouge'),
    ],
    missions: [],
    intel: [],
    objective: {
      type: 'SECTOR_CONTROL',
      kind: 'ground',
      id: 'charlie',
      name: 'Localité CHARLIE',
      center: OBJ,
      radiusKm: 12,
      defender: 'BLUE',
      defenderWinsAtMin: 120,
      challengerWinsBelowMin: 90,
    },
    navalZones: { BLUE: null, RED: null },
    terrain: [
      { id: 'ville', name: 'Localité CHARLIE', kind: 'urbain', center: OBJ, radiusKm: 4 },
      { id: 'bois', name: 'Forêt du nord', kind: 'foret', center: east(30, 14), radiusKm: 6 },
    ],
    satellites: [
      { id: 'sat-b', side: 'BLUE', name: 'Observateur 1', startMin: 10, endMin: 20, footprint: { center: east(60), radiusKm: 80 } },
      { id: 'sat-r', side: 'RED', name: 'Veilleur 1', startMin: 30, endMin: 40, footprint: { center: OBJ, radiusKm: 80 } },
    ],
    triggers: [],
    difficulty: 'standard',
    rules: {},
    sources: [{ title: 'Scénario fictif d’essai' }],
  };
}

/** Charge le scénario d'essai, éventuellement modifié. Les deux camps sont confiés au joueur des tests : aucune IA ne décide. */
export function jointState(mutate?: (sc: ScenarioInput) => void, seed = 11): SimState {
  const input = jointInput();
  mutate?.(input);
  const parsed = parseScenario(input);
  if (!parsed.ok) throw new Error(`scénario d’essai invalide :\n${parsed.errors.join('\n')}`);
  const s = createInitialState(parsed.scenario, { playerSide: 'BLUE', difficulty: 'standard', seed });
  // Aucune IA dans ces tests : les ordres viennent du test lui-même.
  s.ai.RED = null;
  return s;
}

/** Avance l'état de `steps` secondes avec les systèmes donnés, en contrôlant les invariants à chaque pas. */
export function runJoint(s: SimState, systems: readonly System[], steps: number, each?: () => void): void {
  for (let i = 0; i < steps; i++) {
    const before = snapshotPositions(s);
    stepState(s, systems);
    // Le décompte de contrôle n'est pas tenu ici (pas de système d'objectif) : on l'aligne pour l'invariant.
    s.objective.sec.BLUE = s.time;
    expect(checkInvariants(s, before)).toEqual([]);
    each?.();
  }
}
