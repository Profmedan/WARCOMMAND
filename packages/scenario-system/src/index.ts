import { BOUCLIER_ATLANTIQUE_INPUT } from './scenarios/bouclier-atlantique';
import { BRECHE_BOREALE_INPUT } from './scenarios/breche-boreale';
import { TETE_DE_PONT_INPUT } from './scenarios/tete-de-pont';
import { parseScenario, type Scenario } from './schema';

export * from './schema';
export * from './setup';
export * from './objectives';
export * from './session';
export { BOUCLIER_ATLANTIQUE_INPUT, BRECHE_BOREALE_INPUT, TETE_DE_PONT_INPUT };

function mustParse(input: unknown, name: string): Scenario {
  const result = parseScenario(input);
  if (!result.ok) throw new Error(`Scénario livré invalide (${name}) :\n- ${result.errors.join('\n- ')}`);
  return result.scenario;
}

/** Scénario de démonstration, validé au chargement. */
export const BOUCLIER_ATLANTIQUE: Scenario = mustParse(BOUCLIER_ATLANTIQUE_INPUT, 'bouclier-atlantique');

/** Scénario de la phase 3 : attaque des défenses sol-air, ravitaillement, reconnaissance, tombée de la nuit. */
export const BRECHE_BOREALE: Scenario = mustParse(BRECHE_BOREALE_INPUT, 'breche-boreale');

/** Scénario de la phase 5 : opérations interarmées autour d'un objectif terrestre. */
export const TETE_DE_PONT: Scenario = mustParse(TETE_DE_PONT_INPUT, 'tete-de-pont');

/** Scénarios livrés avec le jeu. */
export const SCENARIOS: readonly Scenario[] = [BOUCLIER_ATLANTIQUE, BRECHE_BOREALE, TETE_DE_PONT];
