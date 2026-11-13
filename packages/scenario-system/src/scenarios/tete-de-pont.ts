/**
 * Scénario « Tête de pont » — démonstration interarmées de la phase 5.
 *
 * Géographie réelle (est de l'Islande et mer de Norvège) ; situation politique, bases, unités et
 * événements entièrement fictifs. Aucune position opérationnelle réelle n'est utilisée. Les zones
 * de terrain sont des simplifications de jeu, sans prétention topographique.
 *
 * ROUGE a pris pied sur la côte est et marche sur la localité CHARLIE, que BLEU tient avec un
 * groupement retranché. Chaque camp dispose d'un appui aérien, d'un groupe naval, d'un sous-marin,
 * d'une équipe d'opérations spéciales, d'un passage de satellite et de deux effets multi-domaines.
 */
import type { ScenarioInput } from '../schema';

const OBJECTIVE = { lat: 65.1, lon: -14.9 };
const BLUE_DEPOT = { lat: 65.1, lon: -15.75 };
const BLUE_AIRBASE = { lat: 64.5, lon: -21.5 };
const RED_PORT = { lat: 65.1, lon: -13.68 };
const RED_AIRSTRIP = { lat: 65.28, lon: -14.4 };
const CARRIER = { lat: 63.6, lon: -11.8 };
const AMPHIB = { lat: 65.38, lon: -13.45 };
const SUPPLY_SHIP = { lat: 65.1025, lon: -13.49 };

type Side = 'BLUE' | 'RED';
const land = (id: string, side: Side, name: string, platformId: string, pos: { lat: number; lon: number }, extra: object = {}) => ({
  id,
  side,
  name,
  platformId,
  groupId: side === 'BLUE' ? 'blue-terre' : 'red-terre',
  pos,
  ...extra,
});
const ship = (id: string, side: Side, name: string, platformId: string, pos: { lat: number; lon: number }, extra: object = {}) => ({
  id,
  side,
  name,
  platformId,
  groupId: side === 'BLUE' ? 'blue-naval' : 'red-naval',
  pos,
  ...extra,
});
const jet = (id: string, side: Side, name: string, platformId: string, groupId: string, baseId: string) => ({ id, side, name, platformId, groupId, baseId });

export const TETE_DE_PONT_INPUT: ScenarioInput = {
  formatVersion: 1,
  id: 'tete-de-pont',
  title: 'Tête de pont',
  description:
    'La coalition ROUGE a pris pied sur la côte est et marche sur la localité CHARLIE, que la coalition BLEUE tient avec un groupement retranché. Forces terrestres, navales et aériennes, effets cyber et spatiaux, opérations spéciales : trois heures et demie d’opérations interarmées. Situation, bases et unités fictives.',
  region: {
    name: 'Est de l’Islande — mer de Norvège',
    bounds: { west: -26, south: 61, east: 4, north: 74 },
    center: { lat: 64.9, lon: -14.2 },
    zoom: 6,
  },
  date: '2031-06-18T05:00:00Z',
  period: 'Contemporaine, situation fictive',
  durationMin: 210,
  weather: { label: 'Ciel dégagé, jour continu', sensorFactor: 1 },
  seed: 20310618,
  sides: {
    BLUE: {
      name: 'Coalition BLEUE',
      description: 'Forces occidentales : groupement terrestre retranché, groupe aéronaval, appui aérien.',
      doctrineId: 'coalition-occidentale',
      defaultRoe: 'free',
      resilience: 0.6,
      effects: { cyber: 1, jam: 1 },
      briefing:
        'Tenez la localité CHARLIE jusqu’à 08:30 Z : vous l’emportez avec au moins 130 minutes de contrôle sur 210. La zone revient au camp dont les formations de mêlée présentes sont nettement les plus fortes (une fois et demie l’adversaire) ; à forces comparables, elle est contestée. Votre groupement est retranché, votre réserve blindée attend au dépôt, à 40 km à l’ouest. L’appui aérien (mission d’appui, emport air-surface) frappe les formations que vos troupes, votre satellite ou votre équipe spéciale ont repérées. En mer, un groupe amphibie adverse approche de la côte : son navire transporte un renfort. Vous disposez d’une perturbation des réseaux adverses et d’un brouillage de leurs services spatiaux, à employer au bon moment.',
    },
    RED: {
      name: 'Coalition ROUGE',
      description: 'Matériels d’origine russe, commandement centralisé (hypothèse de simulation) : groupement d’assaut, groupe amphibie.',
      doctrineId: 'rouge-centralisee',
      defaultRoe: 'free',
      resilience: 0.4,
      effects: { cyber: 1, jam: 1 },
      briefing:
        'Disputez la localité CHARLIE à BLEU jusqu’à 08:30 Z : vous l’emportez s’il totalise moins de 115 minutes de contrôle sur 210. La zone est contestée tant que vos formations de mêlée y font jeu égal avec les siennes, et vous revient si elles y sont nettement les plus fortes. Votre groupement — un bataillon blindé, deux mécanisés — est à 28 km à l’est ; l’artillerie, la logistique et le poste de commandement doivent suivre. Un bataillon mécanisé attend à bord du navire amphibie : amenez-le à moins de 8 km d’une plage et mettez-le à terre. Votre ravitaillement vient du port et du navire logistique mouillé au large. L’adversaire est retranché en localité : l’artillerie et l’appui aérien pèseront plus que l’assaut frontal.',
    },
  },
  groups: [
    { id: 'blue-terre', side: 'BLUE', name: 'Groupement Hérisson' },
    { id: 'blue-air', side: 'BLUE', name: 'Escadron de Vestri' },
    { id: 'blue-embarque', side: 'BLUE', name: 'Groupe aérien embarqué' },
    { id: 'blue-soutien', side: 'BLUE', name: 'Soutien aérien' },
    { id: 'blue-naval', side: 'BLUE', name: 'Groupe aéronaval' },
    { id: 'red-terre', side: 'RED', name: 'Groupement Marteau' },
    { id: 'red-air', side: 'RED', name: 'Escadron d’Austri' },
    { id: 'red-naval', side: 'RED', name: 'Groupe amphibie' },
  ],
  bases: [
    { id: 'base-vestri', side: 'BLUE', name: 'Base Vestri', pos: BLUE_AIRBASE, weaponStock: 32, asmStock: 24, fuelStockKg: 300000 },
    { id: 'depot-herisson', side: 'BLUE', name: 'Dépôt Hérisson', pos: BLUE_DEPOT, weaponStock: 0, asmStock: 0, fuelStockKg: 0, supplyStock: 500 },
    { id: 'pont-envol', side: 'BLUE', name: 'Pont d’envol', pos: CARRIER, weaponStock: 24, asmStock: 16, fuelStockKg: 150000, hostUnitId: 'blue-pa' },
    { id: 'terrain-austri', side: 'RED', name: 'Terrain Austri', pos: RED_AIRSTRIP, weaponStock: 32, asmStock: 24, fuelStockKg: 200000 },
    { id: 'depot-port', side: 'RED', name: 'Dépôt du port', pos: RED_PORT, weaponStock: 0, asmStock: 0, fuelStockKg: 0, supplyStock: 300 },
    { id: 'depot-flottant', side: 'RED', name: 'Dépôt flottant', pos: SUPPLY_SHIP, weaponStock: 0, asmStock: 0, fuelStockKg: 0, supplyStock: 400, hostUnitId: 'red-ravit' },
  ],
  units: [
    // --- BLEU : groupement terrestre
    land('blue-pc', 'BLUE', 'PC Hérisson', 'hq-generic', { lat: 65.1, lon: -15.45 }),
    land('blue-meca', 'BLUE', '1er mécanisé', 'mech-bn-generic', OBJECTIVE, { posture: 'defend' }),
    land('blue-inf', 'BLUE', '2e d’infanterie', 'infantry-bn-generic', { lat: 65.125, lon: -14.92 }, { posture: 'defend' }),
    land('blue-genie', 'BLUE', 'Compagnie du génie', 'engineer-coy-generic', { lat: 65.09, lon: -14.94 }, { posture: 'defend' }),
    land('blue-art', 'BLUE', 'Artillerie Hérisson', 'artillery-bn-generic', { lat: 65.1, lon: -15.12 }),
    land('blue-reco', 'BLUE', 'Escadron de reconnaissance', 'recon-sqn-generic', { lat: 65.1, lon: -14.62 }),
    land('blue-log', 'BLUE', 'Bataillon logistique', 'logistics-bn-generic', { lat: 65.1, lon: -15.35 }),
    land('blue-blinde', 'BLUE', 'Réserve blindée', 'armor-bn-generic', { lat: 65.1, lon: -15.72 }),
    { id: 'blue-sam', side: 'BLUE', name: 'Sol-air Hérisson', platformId: 'sam-mr-generic', groupId: 'blue-terre', pos: BLUE_DEPOT },
    { id: 'blue-fs', side: 'BLUE', name: 'Équipe Alpha', platformId: 'sof-team-generic', groupId: 'blue-terre', baseId: 'depot-herisson' },
    // --- BLEU : air
    jet('blue-raf-1', 'BLUE', 'Rafale V1', 'rafale', 'blue-air', 'base-vestri'),
    jet('blue-raf-2', 'BLUE', 'Rafale V2', 'rafale', 'blue-air', 'base-vestri'),
    jet('blue-raf-3', 'BLUE', 'Rafale V3', 'rafale', 'blue-air', 'base-vestri'),
    jet('blue-raf-4', 'BLUE', 'Rafale V4', 'rafale', 'blue-air', 'base-vestri'),
    jet('blue-rafm-1', 'BLUE', 'Rafale M1', 'rafale', 'blue-embarque', 'pont-envol'),
    jet('blue-rafm-2', 'BLUE', 'Rafale M2', 'rafale', 'blue-embarque', 'pont-envol'),
    jet('blue-rafm-3', 'BLUE', 'Rafale M3', 'rafale', 'blue-embarque', 'pont-envol'),
    jet('blue-rafm-4', 'BLUE', 'Rafale M4', 'rafale', 'blue-embarque', 'pont-envol'),
    {
      id: 'blue-awacs',
      side: 'BLUE',
      name: 'AWACS 01',
      platformId: 'e3',
      groupId: 'blue-soutien',
      baseId: 'base-vestri',
      airborne: { pos: { lat: 64.9, lon: -17.6 }, altM: 8800, fuelFraction: 0.9 },
    },
    // --- BLEU : mer
    ship('blue-pa', 'BLUE', 'Porte-avions', 'carrier-generic', CARRIER),
    ship('blue-fda', 'BLUE', 'Frégate de défense aérienne', 'frigate-aaw-generic', { lat: 63.65, lon: -11.75 }, { leaderId: 'blue-pa' }),
    ship('blue-fremm', 'BLUE', 'Frégate', 'frigate-generic', { lat: 63.56, lon: -11.72 }, { leaderId: 'blue-pa' }),
    ship('blue-sm', 'BLUE', 'Sous-marin', 'submarine-generic', { lat: 64.9, lon: -12.6 }, { patrol: [{ lat: 64.95, lon: -12.9 }, { lat: 65.25, lon: -13.05 }] }),

    // --- ROUGE : groupement terrestre
    land('red-pc', 'RED', 'PC Marteau', 'hq-generic', { lat: 65.1, lon: -14.05 }),
    land('red-blinde', 'RED', '1er blindé', 'armor-bn-generic', { lat: 65.1, lon: -14.3 }),
    land('red-meca', 'RED', '2e mécanisé', 'mech-bn-generic', { lat: 65.13, lon: -14.28 }),
    land('red-meca-3', 'RED', '5e mécanisé', 'mech-bn-generic', { lat: 65.1, lon: -14.22 }),
    land('red-art', 'RED', 'Artillerie Marteau', 'artillery-bn-generic', { lat: 65.1, lon: -14.15 }),
    land('red-reco', 'RED', 'Escadron de reconnaissance', 'recon-sqn-generic', { lat: 65.1, lon: -14.42 }),
    land('red-log', 'RED', 'Bataillon logistique', 'logistics-bn-generic', { lat: 65.1, lon: -14.1 }),
    land('red-meca-2', 'RED', '3e mécanisé', 'mech-bn-generic', AMPHIB, { embarkedIn: 'red-amphib' }),
    { id: 'red-sam', side: 'RED', name: 'Sol-air du port', platformId: 'sam-mr-generic', groupId: 'red-terre', pos: RED_PORT },
    { id: 'red-fs', side: 'RED', name: 'Équipe Zoulou', platformId: 'sof-team-generic', groupId: 'red-terre', baseId: 'depot-port' },
    // --- ROUGE : air
    jet('red-su-1', 'RED', 'Su-30SM 1', 'su30sm', 'red-air', 'terrain-austri'),
    jet('red-su-2', 'RED', 'Su-30SM 2', 'su30sm', 'red-air', 'terrain-austri'),
    jet('red-su-3', 'RED', 'Su-30SM 3', 'su30sm', 'red-air', 'terrain-austri'),
    jet('red-su-4', 'RED', 'Su-30SM 4', 'su30sm', 'red-air', 'terrain-austri'),
    // --- ROUGE : mer
    ship('red-amphib', 'RED', 'Navire amphibie', 'amphib-generic', AMPHIB),
    ship('red-destroyer', 'RED', 'Destroyer', 'destroyer-generic', { lat: 65.42, lon: -13.4 }, { leaderId: 'red-amphib' }),
    ship('red-ravit', 'RED', 'Navire logistique', 'supply-ship-generic', SUPPLY_SHIP),
    ship('red-sm', 'RED', 'Sous-marin', 'submarine-generic', { lat: 64.4, lon: -11.6 }, { patrol: [{ lat: 64.4, lon: -11.6 }, { lat: 64.1, lon: -11.9 }] }),
  ],
  missions: [
    {
      type: 'AEW',
      side: 'BLUE',
      name: 'AEW-01',
      unitIds: ['blue-awacs'],
      waypoints: [{ lat: 64.9, lon: -17.6 }],
      altM: 8800,
      launchAtMin: 0,
      roe: 'hold',
    },
  ],
  intel: [
    { side: 'BLUE', unitId: 'red-sam', ageMin: 120 },
    { side: 'RED', unitId: 'blue-sam', ageMin: 180 },
  ],
  objective: {
    type: 'SECTOR_CONTROL',
    kind: 'ground',
    id: 'charlie',
    name: 'Localité CHARLIE',
    center: OBJECTIVE,
    radiusKm: 12,
    defender: 'BLUE',
    defenderWinsAtMin: 130,
    challengerWinsBelowMin: 115,
  },
  navalZones: {
    BLUE: { center: { lat: 64.4, lon: -12.2 }, radiusKm: 300 },
    RED: { center: { lat: 65.0, lon: -12.6 }, radiusKm: 220 },
  },
  terrain: [
    { id: 'charlie', name: 'Localité CHARLIE', kind: 'urbain', center: OBJECTIVE, radiusKm: 4 },
    { id: 'hauteurs', name: 'Hauteurs du nord', kind: 'montagne', center: { lat: 65.32, lon: -14.75 }, radiusKm: 9 },
    { id: 'plaine', name: 'Plaine humide', kind: 'marais', center: { lat: 64.93, lon: -14.55 }, radiusKm: 7 },
  ],
  satellites: [
    { id: 'observateur-1', side: 'BLUE', name: 'Observateur 1', startMin: 15, endMin: 30, footprint: { center: { lat: 65.15, lon: -14.0 }, radiusKm: 70 } },
    { id: 'veilleur-1', side: 'RED', name: 'Veilleur 1', startMin: 40, endMin: 55, footprint: { center: OBJECTIVE, radiusKm: 70 } },
  ],
  triggers: [
    {
      id: 'mi-parcours',
      condition: { type: 'TIME_ELAPSED', atMin: 105 },
      actions: [{ type: 'MESSAGE', text: 'Mi-parcours : il reste une heure trois quarts.', vis: ['BLUE', 'RED'] }],
    },
    {
      id: 'blindes-dans-la-localite',
      condition: { type: 'UNIT_IN_ZONE', side: 'RED', kind: 'armor', zone: { center: OBJECTIVE, radiusKm: 12 } },
      actions: [{ type: 'MESSAGE', text: 'Vos blindés ont atteint la zone de CHARLIE.', vis: ['RED'] }],
    },
    {
      id: 'herisson-hors-de-combat',
      condition: { type: 'GROUP_UNAVAILABLE', groupId: 'blue-terre' },
      actions: [{ type: 'MESSAGE', text: 'Le groupement Hérisson n’a plus aucune unité en état de combattre.', vis: ['BLUE'] }],
    },
    {
      id: 'marteau-hors-de-combat',
      condition: { type: 'GROUP_UNAVAILABLE', groupId: 'red-terre' },
      actions: [{ type: 'MESSAGE', text: 'Le groupement Marteau n’a plus aucune unité en état de combattre.', vis: ['RED'] }],
    },
  ],
  difficulty: 'standard',
  rules: {},
  sources: [
    { title: 'Situation, bases, unités et événements', note: 'Entièrement fictifs' },
    { title: 'Géographie', note: 'Trait de côte Natural Earth (domaine public) ; zones de terrain simplifiées pour le jeu' },
  ],
};
