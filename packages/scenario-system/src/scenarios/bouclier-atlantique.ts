/**
 * Scénario de démonstration « Bouclier Atlantique ».
 *
 * Géographie réelle (mer de Norvège, entre l'Islande et Jan Mayen) ; situation politique, bases,
 * unités et événements entièrement fictifs. Aucune position opérationnelle réelle n'est utilisée.
 */
import type { ScenarioInput } from '../schema';

const BLUE_BASE = { lat: 65.28, lon: -14.4 };
const RED_BASE = { lat: 70.95, lon: -8.6 };

export const BOUCLIER_ATLANTIQUE_INPUT: ScenarioInput = {
  formatVersion: 1,
  id: 'bouclier-atlantique',
  title: 'Bouclier Atlantique',
  description:
    'Une coalition BLEUE assure la police du secteur aérien ALPHA, en mer de Norvège. Une coalition ROUGE entend lui en contester le contrôle pendant quatre-vingt-dix minutes. Situation, bases et unités fictives.',
  region: {
    name: 'Atlantique Nord — mer de Norvège',
    bounds: { west: -26, south: 61, east: 4, north: 74 },
    center: { lat: 67.6, lon: -11 },
    zoom: 4.6,
  },
  date: '2031-03-14T08:40:00Z',
  period: 'Contemporaine, situation fictive',
  durationMin: 90,
  weather: { label: 'Ciel dégagé, bonne visibilité', sensorFactor: 1 },
  seed: 20310314,
  sides: {
    BLUE: {
      name: 'Coalition BLEUE',
      description: 'Forces occidentales, matériels occidentaux.',
      doctrineId: 'coalition-occidentale',
      defaultRoe: 'defensive',
      briefing:
        'Préservez le contrôle du secteur ALPHA jusqu’à 10:10 Z. Vous l’emportez avec au moins 60 minutes de contrôle. Un secteur vide reste acquis à son dernier détenteur : il vous appartient au départ. Votre AWACS et votre ravitailleur sont déjà en vol ; la patrouille CAP-01 est planifiée pour 09:00 Z — à vous de l’avancer, de la scinder ou de la remplacer.',
    },
    RED: {
      name: 'Coalition ROUGE',
      description: 'Matériels d’origine russe, commandement centralisé (hypothèse de simulation).',
      doctrineId: 'rouge-centralisee',
      defaultRoe: 'defensive',
      briefing:
        'Contestez le contrôle du secteur ALPHA. Vous l’emportez si BLEU totalise moins de 45 minutes de contrôle à 10:10 Z. Le secteur appartient à BLEU au départ : il faut y faire entrer vos chasseurs pour le lui disputer. Vous venez de loin et n’avez pas de ravitailleur : comptez votre carburant.',
    },
  },
  groups: [
    { id: 'blue-esc-a', side: 'BLUE', name: 'Escadron A' },
    { id: 'blue-soutien', side: 'BLUE', name: 'Soutien aérien' },
    { id: 'blue-sol-air', side: 'BLUE', name: 'Défense sol-air' },
    { id: 'blue-naval', side: 'BLUE', name: 'Groupe naval' },
    { id: 'red-esc-1', side: 'RED', name: '1er escadron' },
    { id: 'red-soutien', side: 'RED', name: 'Soutien aérien' },
    { id: 'red-sol-air', side: 'RED', name: 'Défense sol-air' },
    { id: 'red-naval', side: 'RED', name: 'Groupe naval' },
  ],
  bases: [
    { id: 'base-bouclier', side: 'BLUE', name: 'Base Bouclier', pos: BLUE_BASE, weaponStock: 24, fuelStockKg: 250000 },
    { id: 'base-boree', side: 'RED', name: 'Base Borée', pos: RED_BASE, weaponStock: 24, fuelStockKg: 250000 },
  ],
  units: [
    { id: 'blue-raf-1', side: 'BLUE', name: 'Rafale A1', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.75 },
    { id: 'blue-raf-2', side: 'BLUE', name: 'Rafale A2', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.75 },
    { id: 'blue-raf-3', side: 'BLUE', name: 'Rafale A3', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.7 },
    { id: 'blue-raf-4', side: 'BLUE', name: 'Rafale A4', platformId: 'rafale', groupId: 'blue-esc-a', baseId: 'base-bouclier', crew: 0.7 },
    {
      id: 'blue-awacs',
      side: 'BLUE',
      name: 'AWACS 01',
      platformId: 'e3',
      groupId: 'blue-soutien',
      baseId: 'base-bouclier',
      crew: 0.8,
      airborne: { pos: { lat: 65.9, lon: -13.4 }, altM: 8800, fuelFraction: 0.85 },
    },
    {
      id: 'blue-tanker',
      side: 'BLUE',
      name: 'Tanker 01',
      platformId: 'a330mrtt',
      groupId: 'blue-soutien',
      baseId: 'base-bouclier',
      crew: 0.8,
      airborne: { pos: { lat: 65.5, lon: -12.6 }, altM: 8000, fuelFraction: 0.9 },
    },
    { id: 'blue-sam', side: 'BLUE', name: 'Sol-air 01', platformId: 'sam-mr-generic', groupId: 'blue-sol-air', pos: { lat: 65.3, lon: -14.25 } },
    {
      id: 'blue-frg',
      side: 'BLUE',
      name: 'Frégate 01',
      platformId: 'frigate-aaw-generic',
      groupId: 'blue-naval',
      pos: { lat: 66.25, lon: -13.0 },
      patrol: [
        { lat: 66.25, lon: -13.0 },
        { lat: 66.4, lon: -12.6 },
      ],
    },

    { id: 'red-su-1', side: 'RED', name: 'Su-35 01', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.7 },
    { id: 'red-su-2', side: 'RED', name: 'Su-35 02', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.7 },
    { id: 'red-su-3', side: 'RED', name: 'Su-35 03', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.65 },
    { id: 'red-su-4', side: 'RED', name: 'Su-35 04', platformId: 'su35s', groupId: 'red-esc-1', baseId: 'base-boree', crew: 0.65 },
    {
      id: 'red-aew',
      side: 'RED',
      name: 'A-50 01',
      platformId: 'a50u',
      groupId: 'red-soutien',
      baseId: 'base-boree',
      crew: 0.7,
      airborne: { pos: { lat: 68.5, lon: -10.6 }, altM: 9000, fuelFraction: 0.85 },
    },
    { id: 'red-sam', side: 'RED', name: 'Sol-air 01', platformId: 'sam-lr-generic', groupId: 'red-sol-air', pos: { lat: 70.93, lon: -8.7 } },
    {
      id: 'red-frg',
      side: 'RED',
      name: 'Frégate 01',
      platformId: 'frigate-generic',
      groupId: 'red-naval',
      pos: { lat: 67.95, lon: -8.8 },
      patrol: [
        { lat: 67.6, lon: -9.6 },
        { lat: 67.95, lon: -8.8 },
      ],
    },
  ],
  missions: [
    {
      type: 'AEW',
      side: 'BLUE',
      unitIds: ['blue-awacs'],
      waypoints: [
        { lat: 65.9, lon: -13.4 },
        { lat: 66.2, lon: -12.4 },
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
        { lat: 65.5, lon: -12.6 },
        { lat: 65.8, lon: -11.8 },
      ],
      altM: 8000,
      launchAtMin: 0,
      roe: 'hold',
    },
    {
      type: 'CAP',
      side: 'BLUE',
      name: 'CAP-01',
      unitIds: ['blue-raf-1', 'blue-raf-2', 'blue-raf-3', 'blue-raf-4'],
      waypoints: [
        { lat: 67.0, lon: -11.4 },
        { lat: 67.0, lon: -10.6 },
      ],
      altM: 9000,
      launchAtMin: 20,
      roe: 'defensive',
      allowRefuel: true,
      humanOnly: true,
    },
    {
      type: 'AEW',
      side: 'RED',
      unitIds: ['red-aew'],
      waypoints: [
        { lat: 68.5, lon: -10.6 },
        { lat: 68.7, lon: -9.4 },
      ],
      altM: 9000,
      launchAtMin: 0,
      roe: 'hold',
    },
  ],
  intel: [
    { side: 'BLUE', unitId: 'red-sam', ageMin: 180 },
    { side: 'RED', unitId: 'blue-sam', ageMin: 180 },
  ],
  objective: {
    type: 'SECTOR_CONTROL',
    id: 'alpha',
    name: 'Secteur ALPHA',
    center: { lat: 67.0, lon: -11.0 },
    radiusKm: 110,
    defender: 'BLUE',
    defenderWinsAtMin: 60,
    challengerWinsBelowMin: 45,
  },
  navalZones: {
    BLUE: { center: { lat: 66.35, lon: -12.8 }, radiusKm: 60 },
    RED: { center: { lat: 67.8, lon: -9.2 }, radiusKm: 60 },
  },
  triggers: [
    {
      id: 'mi-parcours',
      condition: { type: 'TIME_ELAPSED', atMin: 45 },
      actions: [{ type: 'MESSAGE', text: 'Mi-parcours : il reste 45 minutes.', vis: ['BLUE', 'RED'] }],
    },
    {
      id: 'dernier-quart',
      condition: { type: 'TIME_ELAPSED', atMin: 75 },
      actions: [{ type: 'MESSAGE', text: 'Il reste 15 minutes avant la fin de la période.', vis: ['BLUE', 'RED'] }],
    },
    {
      id: 'cap-bleue-en-secteur',
      condition: { type: 'UNIT_IN_ZONE', side: 'BLUE', kind: 'fighter', zone: { center: { lat: 67.0, lon: -11.0 }, radiusKm: 110 } },
      actions: [{ type: 'MESSAGE', text: 'Premiers chasseurs amis dans le secteur ALPHA.', vis: ['BLUE'] }],
    },
    {
      id: 'chasse-rouge-en-secteur',
      condition: { type: 'UNIT_IN_ZONE', side: 'RED', kind: 'fighter', zone: { center: { lat: 67.0, lon: -11.0 }, radiusKm: 110 } },
      actions: [{ type: 'MESSAGE', text: 'Premiers chasseurs amis dans le secteur ALPHA.', vis: ['RED'] }],
    },
    {
      id: 'escadron-bleu-hors-combat',
      condition: { type: 'GROUP_UNAVAILABLE', groupId: 'blue-esc-a' },
      actions: [{ type: 'MESSAGE', text: 'L’Escadron A n’a plus aucun appareil disponible.', vis: ['BLUE'] }],
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
    { title: 'AJP-3.3, Allied Joint Doctrine for Air and Space Operations', note: 'Principes publics de la puissance aérienne alliée' },
    { title: 'Fiches publiques des constructeurs et des forces aériennes', note: 'Voir la base de données des matériels pour le détail et le niveau de confiance' },
    { title: 'Situation, bases, unités et événements', note: 'Entièrement fictifs' },
  ],
};
