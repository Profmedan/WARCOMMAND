/**
 * Campagnes en cours, conservées dans le stockage local du navigateur.
 *
 * Un emplacement réunit l'état de la campagne (points, pertes à reporter, réserves, expérience) et, le cas
 * échéant, la sauvegarde de la mission interrompue. L'état est revalidé à chaque lecture.
 */
import { parseCampaignState, type CampaignState } from '@warcommand/campaign-system';
import type { SaveGame } from '@warcommand/replay-engine';

const KEY = 'warcommand.campaigns.v1';
const LIMIT = 6;

export interface CampaignSlot {
  state: CampaignState;
  /** Mission interrompue, à reprendre ; `null` : la mission en cours n'est pas commencée. */
  inProgress: SaveGame | null;
}

interface Stored {
  state: unknown;
  inProgress: unknown;
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

export function listCampaigns(): CampaignSlot[] {
  const out: CampaignSlot[] = [];
  for (const entry of read()) {
    const parsed = parseCampaignState(entry?.state);
    if (!parsed.ok) continue;
    out.push({ state: parsed.state, inProgress: (entry.inProgress as SaveGame | null) ?? null });
  }
  return out;
}

/** Enregistre (ou remplace) un emplacement. `false` si le stockage est indisponible ou plein. */
export function saveCampaign(slot: CampaignSlot): boolean {
  try {
    const others = read().filter((e) => (e?.state as { slotId?: unknown } | null)?.slotId !== slot.state.slotId);
    window.localStorage.setItem(KEY, JSON.stringify([{ state: slot.state, inProgress: slot.inProgress }, ...others].slice(0, LIMIT)));
    return true;
  } catch {
    return false;
  }
}

export function deleteCampaign(slotId: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(read().filter((e) => (e?.state as { slotId?: unknown } | null)?.slotId !== slotId)));
  } catch {
    // Stockage indisponible : rien à supprimer.
  }
}

/** Identifiant d'emplacement encore libre. */
export function freshSlotId(existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `campagne-${n}`;
    if (!taken.has(id)) return id;
  }
}

export function campaignFileName(state: CampaignState): string {
  return `war-command-campagne-${state.campaignId}-${state.history.length}.json`;
}
