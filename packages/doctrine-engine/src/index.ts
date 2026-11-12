/**
 * Moteur de doctrine : des profils paramétrables, indépendants du camp et du matériel.
 *
 * Chaque paramètre porte un classement de fiabilité (prompt maître §9) :
 *   1. doctrine publique documentée
 *   2. interprétation d'une source secondaire
 *   3. hypothèse de simulation
 *   4. équilibrage purement ludique
 *
 * Important : même lorsqu'un principe est documenté (classe 1), sa traduction en un nombre
 * entre 0 et 1 reste un choix de simulation. Aucun profil ne prétend décrire la doctrine
 * officielle d'un État.
 */
import type { DoctrineParams } from '@warcommand/simulation-core';

export type Classification = 1 | 2 | 3 | 4;

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  1: 'Doctrine publique documentée',
  2: 'Interprétation d’une source secondaire',
  3: 'Hypothèse de simulation',
  4: 'Équilibrage ludique',
};

export type DoctrineKey = Exclude<keyof DoctrineParams, 'id'>;

export const DOCTRINE_KEYS: readonly DoctrineKey[] = [
  'centralisation',
  'autonomie',
  'masse',
  'preservation',
  'tempo',
  'agressivite',
];

export const DOCTRINE_KEY_INFO: Record<DoctrineKey, { label: string; effect: string }> = {
  centralisation: {
    label: 'Centralisation des décisions',
    effect: 'Allonge le délai entre un ordre et le décollage des appareils au sol.',
  },
  autonomie: {
    label: 'Autonomie des subordonnés',
    effect: 'Allonge la distance à laquelle une patrouille poursuit de sa propre initiative.',
  },
  masse: {
    label: 'Concentration des moyens',
    effect: 'L’IA préfère engager ses chasseurs groupés plutôt que par paires relevées.',
  },
  preservation: {
    label: 'Préservation des forces',
    effect: 'L’IA rompt plus tôt après des pertes et pèse davantage les menaces connues.',
  },
  tempo: {
    label: 'Tempo de planification',
    effect: 'L’IA réévalue son plan plus souvent.',
  },
  agressivite: {
    label: 'Esprit offensif',
    effect: 'L’IA privilégie les postures offensives et la chasse aux moyens de soutien adverses.',
  },
};

export interface DoctrineParamInfo {
  value: number;
  classification: Classification;
  basis: string;
}

export interface DoctrineProfile {
  id: string;
  name: string;
  description: string;
  sources: string[];
  params: Record<DoctrineKey, DoctrineParamInfo>;
}

const AJP33 =
  'AJP-3.3, Allied Joint Doctrine for Air and Space Operations (publication publique de l’OTAN)';

export const DOCTRINES: Record<string, DoctrineProfile> = {
  'coalition-occidentale': {
    id: 'coalition-occidentale',
    name: 'Coalition occidentale (inspiration OTAN)',
    description:
      'Profil inspiré des principes publics de la puissance aérienne alliée : contrôle centralisé, exécution décentralisée.',
    sources: [
      AJP33,
      'AJP-5, Allied Joint Doctrine for the Planning of Operations',
      'AJP-3.3.5, Allied Joint Doctrine for Airspace Control',
    ],
    params: {
      centralisation: {
        value: 0.5,
        classification: 1,
        basis: `Principe « contrôle centralisé, exécution décentralisée » (${AJP33}). Formulation exacte à recouper dans l’édition en vigueur ; la valeur numérique est un choix de simulation.`,
      },
      autonomie: {
        value: 0.8,
        classification: 1,
        basis: `Même principe d’exécution décentralisée (${AJP33}) ; la valeur numérique est un choix de simulation.`,
      },
      masse: { value: 0.4, classification: 3, basis: 'Hypothèse : présence continue par rotation de patrouilles.' },
      preservation: { value: 0.6, classification: 3, basis: 'Hypothèse : forte valeur accordée aux équipages et aux moyens rares.' },
      tempo: { value: 0.7, classification: 3, basis: 'Hypothèse : cycle de décision court.' },
      agressivite: { value: 0.5, classification: 4, basis: 'Équilibrage.' },
    },
  },

  'rouge-centralisee': {
    id: 'rouge-centralisee',
    name: 'Coalition rouge (commandement centralisé)',
    description:
      'Profil de jeu fondé sur des hypothèses de simulation. Il ne décrit pas la doctrine officielle d’un État : les travaux de sources ouvertes cités restent à dépouiller avant tout reclassement.',
    sources: [
      'À dépouiller : CNA, « Russian Concepts of Future Warfare Based on Lessons from the Ukraine War » (août 2025)',
      'À dépouiller : SWP, étude sur la transformation interarmées de l’armée chinoise (septembre 2025)',
    ],
    params: {
      centralisation: { value: 0.85, classification: 3, basis: 'Hypothèse de simulation, non sourcée à ce stade.' },
      autonomie: { value: 0.45, classification: 3, basis: 'Hypothèse de simulation, non sourcée à ce stade.' },
      masse: { value: 0.75, classification: 3, basis: 'Hypothèse de simulation, non sourcée à ce stade.' },
      preservation: { value: 0.4, classification: 3, basis: 'Hypothèse de simulation, non sourcée à ce stade.' },
      tempo: { value: 0.5, classification: 3, basis: 'Hypothèse de simulation, non sourcée à ce stade.' },
      agressivite: { value: 0.7, classification: 4, basis: 'Équilibrage : le challenger doit prendre l’initiative.' },
    },
  },

  'equilibre-ludique': {
    id: 'equilibre-ludique',
    name: 'Profil neutre',
    description: 'Tous les paramètres à mi-course. Sert de référence et de profil par défaut pour les essais.',
    sources: [],
    params: {
      centralisation: { value: 0.5, classification: 4, basis: 'Équilibrage.' },
      autonomie: { value: 0.5, classification: 4, basis: 'Équilibrage.' },
      masse: { value: 0.5, classification: 4, basis: 'Équilibrage.' },
      preservation: { value: 0.5, classification: 4, basis: 'Équilibrage.' },
      tempo: { value: 0.5, classification: 4, basis: 'Équilibrage.' },
      agressivite: { value: 0.5, classification: 4, basis: 'Équilibrage.' },
    },
  },
};

export function hasDoctrine(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DOCTRINES, id);
}

export function getDoctrine(id: string): DoctrineProfile {
  const profile = DOCTRINES[id];
  if (!profile) throw new Error(`Doctrine inconnue : ${id}`);
  return profile;
}

/** Valeurs numériques d'un profil, éventuellement surchargées (le joueur peut modifier la doctrine). */
export function resolveDoctrine(id: string, overrides: Partial<Record<DoctrineKey, number>> = {}): DoctrineParams {
  const profile = getDoctrine(id);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const value = (key: DoctrineKey) => clamp(overrides[key] ?? profile.params[key].value);
  return {
    id,
    centralisation: value('centralisation'),
    autonomie: value('autonomie'),
    masse: value('masse'),
    preservation: value('preservation'),
    tempo: value('tempo'),
    agressivite: value('agressivite'),
  };
}
