/**
 * Contrôleur de partie : fait le lien entre la session de simulation et l'interface.
 *
 * L'horloge de simulation est indépendante de l'affichage : un minuteur accumule le temps réel
 * multiplié par la vitesse choisie et exécute le nombre de pas de 1 s correspondant.
 * L'interface ne lit que l'image du camp du joueur (`picture`) et ses événements visibles.
 */
import { getSidePicture, visibleEvents, type SideId, type SidePicture, type SimEvent } from '@warcommand/simulation-core';
import { estimateMission, nightNow, validateOrder, type MissionEstimate, type Order, type OrderResult } from '@warcommand/air-operations';
import { createSession, issueOrder, stepSession, type Scenario, type Session, type SetupOptions } from '@warcommand/scenario-system';
import { loadGame, saveGame, type SaveGame } from '@warcommand/replay-engine';

export type Speed = 0 | 1 | 5 | 20 | 100;
export const SPEEDS: readonly Speed[] = [0, 1, 5, 20, 100];

const TICK_MS = 50;
/** Garde-fou : nombre maximal de pas par tic, pour ne jamais geler l'interface. */
const MAX_STEPS_PER_TICK = 400;
const SAVE_KEY = 'warcommand.saves.v1';

export interface StoredSave {
  id: string;
  title: string;
  savedAt: string;
  save: SaveGame;
}

export class GameController {
  readonly session: Session;
  readonly playerSide: SideId;
  speed: Speed = 0;
  /** Incrémenté à chaque changement visible : sert de version pour React. */
  version = 0;

  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReal = 0;
  private carry = 0;
  private cachedPicture: { version: number; picture: SidePicture } | null = null;
  private cachedEvents: SimEvent[] = [];
  private scannedEvents = 0;

  constructor(session: Session) {
    if (session.options.playerSide === null) throw new Error('Une partie jouée exige un camp pour le joueur');
    this.session = session;
    this.playerSide = session.options.playerSide;
  }

  static create(scenario: Scenario, options: Partial<SetupOptions>): GameController {
    return new GameController(createSession(scenario, options));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastReal = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  setSpeed(speed: Speed): void {
    this.speed = this.ended ? 0 : speed;
    this.carry = 0;
    this.lastReal = performance.now();
    this.notify();
  }

  private tick(): void {
    const now = performance.now();
    // Un onglet en arrière-plan peut suspendre le minuteur : on borne le rattrapage.
    const elapsed = Math.min(250, now - this.lastReal) / 1000;
    this.lastReal = now;
    if (this.speed === 0 || this.ended) return;
    this.carry += elapsed * this.speed;
    let steps = Math.min(MAX_STEPS_PER_TICK, Math.floor(this.carry));
    if (steps <= 0) return;
    this.carry -= steps;
    // Mode par tours : la résolution s'arrête exactement à la fin du tour, pour la phase d'ordres.
    const turn = this.wegoTurnS;
    if (turn > 0) steps = Math.min(steps, turn - (this.time % turn));
    stepSession(this.session, steps);
    if (this.ended || (turn > 0 && this.time % turn === 0)) {
      this.speed = 0;
      this.carry = 0;
    }
    this.notify();
  }

  /** Avance d'un nombre fixe de secondes de simulation (bouton « +1 min » en pause). */
  advance(seconds: number): void {
    if (this.ended) return;
    stepSession(this.session, seconds);
    if (this.ended) this.speed = 0;
    this.notify();
  }

  /** Durée d'un tour en mode par tours (secondes) ; 0 en temps continu. */
  get wegoTurnS(): number {
    return this.session.state.wegoTurnS;
  }

  /** Les ordres sont-ils recevables maintenant ? Toujours en temps continu ; entre deux tours sinon. */
  get planning(): boolean {
    const turn = this.wegoTurnS;
    return turn === 0 || this.time % turn === 0;
  }

  /** Fait-il nuit au-dessus du secteur d'objectif ? */
  night(): boolean {
    return nightNow(this.session.state);
  }

  /** Estimation d'une mission avant de l'ordonner : transit, carburant à l'arrivée, autonomie sur zone. */
  estimate(order: Order): MissionEstimate | null {
    if (order.type !== 'CREATE_MISSION' || order.side !== this.playerSide) return null;
    return estimateMission(this.session.state, this.playerSide, order.draft);
  }

  /** Vérifie un ordre sans l'émettre (retour immédiat dans le planificateur). */
  check(order: Order): OrderResult {
    if (order.side !== this.playerSide) return { ok: false, code: 'WRONG_SIDE' };
    if (!this.planning) return { ok: false, code: 'NOT_PLANNING_PHASE' };
    return validateOrder(this.session.state, order);
  }

  order(order: Order): OrderResult {
    const result = issueOrder(this.session, order);
    this.notify();
    return result;
  }

  get ended(): boolean {
    return this.session.state.outcome !== null;
  }

  get time(): number {
    return this.session.state.time;
  }

  /** Image de la situation du joueur — jamais la vérité-terrain. */
  picture(): SidePicture {
    if (!this.cachedPicture || this.cachedPicture.version !== this.version) {
      this.cachedPicture = { version: this.version, picture: getSidePicture(this.session.state, this.playerSide) };
    }
    return this.cachedPicture.picture;
  }

  /** Événements visibles par le joueur, dans l'ordre chronologique. */
  events(): SimEvent[] {
    const all = this.session.state.events;
    if (this.scannedEvents < all.length) {
      this.cachedEvents = this.cachedEvents.concat(visibleEvents(this.session.state, this.playerSide, this.scannedEvents));
      this.scannedEvents = all.length;
    }
    return this.cachedEvents;
  }

  save(): SaveGame {
    return saveGame(this.session);
  }
}

function readStore(): StoredSave[] {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredSave[]) : [];
  } catch {
    return [];
  }
}

export function listSaves(): StoredSave[] {
  return readStore();
}

/** Enregistre la partie dans le navigateur. Retourne `false` si le stockage est indisponible ou plein. */
export function storeSave(title: string, save: SaveGame): boolean {
  try {
    const entry: StoredSave = { id: `${Date.now()}`, title, savedAt: new Date().toISOString(), save };
    const all = [entry, ...readStore()].slice(0, 8);
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function deleteSave(id: string): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(readStore().filter((s) => s.id !== id)));
  } catch {
    // Stockage indisponible : rien à supprimer.
  }
}

export function controllerFromSave(data: unknown): { ok: true; controller: GameController } | { ok: false; errors: string[] } {
  const loaded = loadGame(data);
  if (!loaded.ok) return loaded;
  if (loaded.session.options.playerSide === null) return { ok: false, errors: ['Cette sauvegarde ne contient pas de camp joueur'] };
  return { ok: true, controller: new GameController(loaded.session) };
}

/** Propose au navigateur d'enregistrer un fichier JSON. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
