/**
 * Scénario « Brèche Boréale » — démonstration des capacités de la phase 3.
 *
 * Géographie réelle (mer de Norvège) ; situation politique, bases, unités et événements
 * entièrement fictifs. Aucune position opérationnelle réelle n'est utilisée.
 *
 * ROUGE tient un secteur proche de sa base, sous le couvert d'un groupe sol-air et d'une frégate.
 * BLEU, qui vient de loin, doit ouvrir une brèche (attaque des défenses), tenir grâce à son
 * ravitailleur, et composer avec la tombée de la nuit.
 */
import type { ScenarioInput } from '../schema';

const BLUE_BASE = { lat: 65.28, lon: -14.4 };
const RED_BASE = { lat: 70.95, lon: -8.6 };
const SECTOR = { lat: 69.9, lon: -9.2 };

export const BRECHE_BOREALE_INPUT: ScenarioInput = {
  formatVersion: 1,
  id: 'breche-boreale',
  title: 'Brèche Boréale',
  description:
    'Au crépuscule, la coalition ROUGE tient le secteur aérien BRAVO, au large de sa base, sous le couvert d’un groupe sol-air et d’une frégate. La coalition BLEUE doit ouvrir une brèche dans ces défenses et lui disputer le secteur pendant deux heures. Situation, bases et unités fictives.',
  region: {
    name: 'Atlantique Nord — mer de Norvège',
    bounds: { west: -26, south: 61, east: 4, north: 74 },
    center: { lat: 68.2, lon: -11 },
    zoom: 4.4,
  },
  date: '2031-03-14T18:00:00Z',
  period: 'Contemporaine, situation fictive',
  durationMin: 120,
  weather: { label: 'Ciel dégagé ; la nuit tombe vers 19:30 Z', sensorFactor: 1 },
  seed: 20310315,
  sides: {
    BLUE: {
      name: 'Coalition BLEUE',
      description: 'Forces occidentales, matériels occidentaux.',
      doctrineId: 'coalition-occidentale',
      defaultRoe: 'defensive',
      briefing:
        'Disputez le secteur BRAVO à ROUGE jusqu’à 20:00 Z : vous l’emportez si ROUGE totalise moins de 80 minutes de contrôle sur 120. Le secteur est couvert par un groupe sol-air à la Base Borée et par une frégate : neutralisez-les (mission SEAD, emport air-surface, approche à basse altitude) avant d’y installer vos patrouilles. Vous êtes à 560 km de votre base : le ravitailleur est indispensable, et une cible lointaine ne devient accessible que si le ravitaillement est autorisé. Votre drone surveille déjà la frégate. La nuit, l’optronique et l’identification à vue portent moins loin.',
    },
    RED: {
      name: 'Coalition ROUGE',
      description: 'Matériels d’origine russe, commandement centralisé (hypothèse de simulation).',
      doctrineId: 'rouge-centralisee',
      defaultRoe: 'defensive',
      briefing:
        'Conservez le secteur BRAVO jusqu’à 20:00 Z : vous l’emportez avec au moins 95 minutes de contrôle sur 120. Votre groupe sol-air et votre frégate couvrent le secteur, mais leurs radars vous trahissent et attireront des attaques. Un de vos chasseurs est en maintenance pendant la première demi-heure. L’adversaire dépend de son ravitailleur et de son avion-radar.',
    },
  },
  groups: [
    { id: 'blue-esc-a', side: 'BLUE', name: 'Escadron A' },
    { id: 'blue-esc-b', side: 'BLUE', name: 'Escadron B' },
    { id: 'blue-soutien', side: 'BLUE', name: 'Soutien aérien' },
    { id: 'blue-sol-air', side: 'BLUE', name: 'Défense sol-air' },
    { id: 'blue-naval', side: 'BLUE', name: 'Groupe naval' },
    { id: 'red-esc-1', side: 'RED', name: '1er escadron' },
    { id: 'red-soutien', side: 'RED', name: 'Soutien aérien' },
    { id: 'red-sol-air', side: 'RED', name: 'Défense sol-air' },
    { id: 'red-naval', side: 'RED', name: 'Groupe naval' },
  ],
  bases: [
    { id: 'base-bouclier', side: 'BLUE', name: 'Base Bouclier', pos: BLUE_BASE, weaponStock: 24, asmStock: 12, fuelStockKg: 300000 },
    { id: 'base-boree', side: 'RED', name: 'Base Borée', pos: RED_BASE, weaponStock: 24, asmStock: 4, fuelStockKg: 300000 },
  ],
  units: [
    { id: 'blue-raf-1', side: 'BLUE', name: 'Rafale A1', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.75 },
    { id: 'blue-raf-2', side: 'BLUE', name: 'Rafale A2', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.75 },
    { id: 'blue-raf-3', side: 'BLUE', name: 'Rafale A3', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.7 },
    { id: 'blue-raf-4', side: 'BLUE', name: 'Rafale A4', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.7 },
    { id: 'blue-raf-5', side: 'BLUE', name: 'Rafale B1', platformId: 'rafale', groupId: 'blue-esc-b', baseId: 'base-bouclier', crew: 0.75 },
    { id: 'blue-raf-6', side: 'BLUE', name: 'Rafale B2', platformId: 'rafale', groupId: 'blue-esc-b', baseId: 'base-bouclier', crew: 0.7 },
    {
      id: 'blue-awacs',
      side: 'BLUE',
      name: 'AWACS 01',
      platformId: 'e3',
      groupId: 'blue-soutien',
      baseId: 'base-bouclier',
      crew: 0.8,
      airborne: { pos: { lat: 67.6, lon: -12.2 }, altM: 8800, fuelFraction: 0.85 },
    },
    {
      id: 'blue-tanker',
      side: 'BLUE',
      name: 'Tanker 01',
      platformId: 'a330mrtt',
      groupId: 'blue-soutien',
      baseId: 'base-bouclier',
      crew: 0.8,
      airborne: { pos: { lat: 68.7, lon: -11.4 }, altM: 8000, fuelFraction: 0.9 },
    },
    {
      id: 'blue-mq9',
      side: 'BLUE',
      name: 'Reaper 01',
      platformId: 'mq9',
      groupId: 'blue-soutien',
      baseId: 'base-bouclier',
      crew: 0.75,
      airborne: { pos: { lat: 68.85, lon: -10.4 }, altM: 7500, fuelFraction: 0.8 },
    },
    { id: 'blue-sam', side: 'BLUE', name: 'Sol-air 01', platformId: 'sam-mr-generic', groupId: 'blue-sol-air', pos: { lat: 65.3, lon: -14.25 } },
    {
      id: 'blue-frg',
      side: 'BLUE',
      name: 'Frégate 01',
      platformId: 'frigate-aaw-generic',
      groupId: 'blue-naval',
      pos: { lat: 67.4, lon: -11.6 },
      patrol: [
        { lat: 67.4, lon: -11.6 },
        { lat: 67.55, lon: -11.2 },
      ],
    },

    { id: 'red-su-1', side: 'RED', name: 'Su-35 01', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.7 },
    { id: 'red-su-2', side: 'RED', name: 'Su-35 02', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.7 },
    { id: 'red-su-3', side: 'RED', name: 'Su-35 03', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.65 },
    { id: 'red-su-4', side: 'RED', name: 'Su-35 04', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.65, unavailableForMin: 30 },
    {
      id: 'red-aew',
      side: 'RED',
      name: 'A-50 01',
      platformId: 'a50u',
      groupId: 'red-soutien',
      baseId: 'base-boree',
      crew: 0.7,
      airborne: { pos: { lat: 70.3, lon: -8.0 }, altM: 9000, fuelFraction: 0.85 },
    },
    { id: 'red-sam', side: 'RED', name: 'Sol-air 01', platformId: 'sam-lr-generic', groupId: 'red-sol-air', pos: { lat: 70.93, lon: -8.7 } },
    {
      id: 'red-frg',
      side: 'RED',
      name: 'Frégate 01',
      platformId: 'frigate-generic',
      groupId: 'red-naval',
      pos: { lat: 69.45, lon: -9.7 },
      patrol: [
        { lat: 69.45, lon: -9.7 },
        { lat: 69.6, lon: -9.3 },
      ],
    },
  ],
  missions: [
    {
      type: 'AEW',
      side: 'BLUE',
      unitIds: ['blue-awacs'],
      waypoints: [
        { lat: 67.6, lon: -12.2 },
        { lat: 67.9, lon: -11.2 },
      ],
      altM: 8800,
      launchAtMin: 0,
      roe: 'hold',
    },
    {
      type: 'TANKER',
      side: 'BLUE',
      unitIds: ['blue-tanker'],
      waypoints: [
        { lat: 68.7, lon: -11.4 },
        { lat: 68.9, lon: -10.6 },
      ],
      altM: 8000,
      launchAtMin: 0,
      roe: 'hold',
    },
    {
      type: 'RECON',
      side: 'BLUE',
      unitIds: ['blue-mq9'],
      waypoints: [
        { lat: 68.85, lon: -10.4 },
        { lat: 68.95, lon: -9.6 },
      ],
      altM: 7500,
      launchAtMin: 0,
      roe: 'hold',
    },
    {
      type: 'AEW',
      side: 'RED',
      unitIds: ['red-aew'],
      waypoints: [
        { lat: 70.3, lon: -8.0 },
        { lat: 70.4, lon: -6.8 },
      ],
      altM: 9000,
      launchAtMin: 0,
      roe: 'hold',
    },
    {
      type: 'CAP',
      side: 'RED',
      name: 'CAP-01',
      unitIds: ['red-su-1', 'red-su-2'],
      waypoints: [
        { lat: 69.9, lon: -9.6 },
        { lat: 69.9, lon: -8.8 },
      ],
      altM: 9000,
      launchAtMin: 3,
      roe: 'defensive',
      humanOnly: true,
    },
  ],
  intel: [
    { side: 'BLUE', unitId: 'red-sam', ageMin: 240 },
    { side: 'RED', unitId: 'blue-sam', ageMin: 240 },
  ],
  objective: {
    type: 'SECTOR_CONTROL',
    id: 'bravo',
    name: 'Secteur BRAVO',
    center: SECTOR,
    radiusKm: 90,
    defender: 'RED',
    defenderWinsAtMin: 95,
    challengerWinsBelowMin: 80,
  },
  navalZones: {
    BLUE: { center: { lat: 67.45, lon: -11.4 }, radiusKm: 60 },
    RED: { center: { lat: 69.5, lon: -9.5 }, radiusKm: 50 },
  },
  triggers: [
    {
      id: 'mi-parcours',
      condition: { type: 'TIME_ELAPSED', atMin: 60 },
      actions: [{ type: 'MESSAGE', text: 'Mi-parcours : il reste une heure.', vis: ['BLUE', 'RED'] }],
    },
    {
      id: 'nuit',
      condition: { type: 'TIME_ELAPSED', atMin: 90 },
      actions: [{ type: 'MESSAGE', text: 'La nuit tombe : l’optronique et l’identification à vue portent moins loin.', vis: ['BLUE', 'RED'] }],
    },
    {
      id: 'dernier-quart',
      condition: { type: 'TIME_ELAPSED', atMin: 105 },
      actions: [{ type: 'MESSAGE', text: 'Il reste 15 minutes avant la fin de la période.', vis: ['BLUE', 'RED'] }],
    },
    {
      id: 'sol-air-rouge-detruit',
      condition: { type: 'LOSSES_AT_LEAST', side: 'RED', kind: 'sam', count: 1 },
      actions: [{ type: 'MESSAGE', text: 'Le groupe sol-air de la Base Borée est détruit.', vis: ['RED'] }],
    },
    {
      id: 'escadron-rouge-hors-combat',
      condition: { type: 'GROUP_UNAVAILABLE', groupId: 'red-esc-1' },
      actions: [{ type: 'MESSAGE', text: 'Le 1er escadron n’a plus aucun appareil disponible.', vis: ['RED'] }],
    },
  ],
  difficulty: 'standard',
  rules: {},
  sources: [
    { title: 'Natural Earth', note: 'Géographie (domaine public)', url: 'https://www.naturalearthdata.com' },
    { title: 'Fiches publiques des constructeurs et des forces aériennes', note: 'Voir la base de données des matériels pour le détail et le niveau de confiance' },
    { title: 'Situation, bases, unités et événements', note: 'Entièrement fictifs' },
  ],
};
