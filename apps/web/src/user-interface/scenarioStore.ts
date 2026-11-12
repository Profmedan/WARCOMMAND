/**
 * Scénarios personnels, enregistrés dans le stockage local du navigateur.
 * Un brouillon incomplet peut être enregistré : il reste modifiable, mais n'est pas jouable.
 */
import { checkScenario, readDraft, slugify } from '@warcommand/mission-editor';
import type { Scenario } from '@warcommand/scenario-system';

const KEY = 'warcommand.scenarios.v1';
const LIMIT = 24;

interface Stored {
  id: string;
  savedAt: string;
  data: unknown;
}

export interface CustomScenario {
  scenario: Scenario;
  savedAt: string;
  /** Jouable : aucune erreur à la vérification. */
  playable: boolean;
}

function read(): Stored[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Stored[]) : [];
  } catch {
    return [];
  }
}

export function listCustomScenarios(): CustomScenario[] {
  const out: CustomScenario[] = [];
  for (const entry of read()) {
    const scenario = readDraft(entry.data);
    if (!scenario) continue;
    out.push({ scenario, savedAt: entry.savedAt, playable: checkScenario(scenario).errors.length === 0 });
  }
  return out;
}

/** Enregistre (ou remplace) un scénario personnel. `false` si le stockage est indisponible ou plein. */
export function saveCustomScenario(scenario: Scenario): boolean {
  try {
    const others = read().filter((e) => e.id !== scenario.id);
    const entry: Stored = { id: scenario.id, savedAt: new Date().toISOString(), data: scenario };
    window.localStorage.setItem(KEY, JSON.stringify([entry, ...others].slice(0, LIMIT)));
    return true;
  } catch {
    return false;
  }
}

/** Nom du fichier d'export : d'après le titre, que l'auteur reconnaît, plutôt que l'identifiant interne. */
export function scenarioFileName(scenario: Scenario): string {
  return `war-command-scenario-${slugify(scenario.title)}.json`;
}

export function deleteCustomScenario(id: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(read().filter((e) => e.id !== id)));
  } catch {
    // Stockage indisponible : rien à supprimer.
  }
}
