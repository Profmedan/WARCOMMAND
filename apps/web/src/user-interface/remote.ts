/**
 * Partie à deux joueurs : le lien entre l'écran de jeu et le serveur de parties.
 *
 * La simulation tourne sur le serveur. Ce contrôleur n'a jamais l'état de la partie : il reçoit l'image du
 * camp du joueur et ses événements, envoie des ordres, et ne découvre la vérité-terrain qu'à la fin.
 */
import type { SideId, SidePicture, SimEvent } from '@warcommand/simulation-core';
import type { MissionEstimate } from '@warcommand/air-operations';
import type { GameOrder, GameOrderResult, Session } from '@warcommand/scenario-system';
import { loadGame, type SaveGame } from '@warcommand/replay-engine';
import { PROTOCOL_VERSION, type ClientMessage, type PictureStatic, type Players, type ServerMessage } from '@warcommand/net-play';
import { briefingFit, type GameBrief, type GameLink, type NetStatus, type Speed } from './controller';

/** Ce que le joueur demande au serveur en arrivant. */
export type NetEntry =
  | { type: 'create'; name: string; side: SideId; scenarioId?: string; scenario?: unknown; seed: number; wegoTurnMin: number }
  | { type: 'join'; name: string; code: string }
  | { type: 'resume'; code: string; token: string };

const CONNECT_TIMEOUT_MS = 8000;
const REPLY_TIMEOUT_MS = 6000;
const RESUME_KEY = 'warcommand.net.v1';
const MAX_RECONNECTS = 15;

interface CheckEntry {
  result: GameOrderResult;
  estimate: MissionEstimate | null;
  /** Instant de simulation auquel la réponse vaut. */
  at: number;
  askedMs: number;
  pending: boolean;
}

/** Place à reprendre après un rechargement de la page ou une coupure. */
export interface ResumeTicket {
  url: string;
  code: string;
  token: string;
}

export function readResumeTicket(): ResumeTicket | null {
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);
    const t = raw ? (JSON.parse(raw) as Partial<ResumeTicket>) : null;
    return t && typeof t.url === 'string' && typeof t.code === 'string' && typeof t.token === 'string' ? (t as ResumeTicket) : null;
  } catch {
    return null;
  }
}

function writeResumeTicket(ticket: ResumeTicket | null): void {
  try {
    if (ticket) window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(ticket));
    else window.sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Stockage indisponible : la reprise après rechargement ne sera pas proposée.
  }
}

export class RemoteController implements GameLink {
  readonly canStep = false;
  readonly canSave = false;
  playerSide: SideId = 'BLUE';
  brief: GameBrief = { scenarioId: '', title: '', description: '', briefing: '', region: { center: { lat: 0, lon: 0 }, zoom: 3 }, fit: undefined };
  speed: Speed = 0;
  version = 0;

  private socket: WebSocket | null = null;
  private readonly listeners = new Set<() => void>();
  private fixed: PictureStatic | null = null;
  private current: SidePicture | null = null;
  private log: SimEvent[] = [];
  private isNight = false;
  private canOrder = true;
  private status: NetStatus = { code: '', players: { BLUE: null, RED: null }, requested: { BLUE: 0, RED: 0 }, effective: 0, online: false, error: null };
  private token = '';
  private final: Session | null = null;
  private ref = 0;
  private readonly replies = new Map<number, (result: GameOrderResult) => void>();
  private readonly checks = new Map<string, CheckEntry>();
  private readonly checkRefs = new Map<number, string>();
  private left = false;
  private reconnects = 0;

  private constructor(private readonly url: string) {}

  /** Se connecte au serveur et s'installe à une table. Échoue avec un message à montrer au joueur. */
  static connect(url: string, entry: NetEntry): Promise<RemoteController> {
    const controller = new RemoteController(url);
    return controller.open(entry).then(() => controller);
  }

  private open(entry: NetEntry): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(new Error(error));
        else resolve();
      };
      const timer = setTimeout(() => {
        finish('Le serveur ne répond pas. Vérifiez son adresse et qu’il est bien lancé (pnpm serve).');
        this.socket?.close();
      }, CONNECT_TIMEOUT_MS);

      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        finish('Adresse de serveur invalide : elle doit commencer par ws:// ou wss://.');
        return;
      }
      this.socket = socket;
      socket.onopen = () => socket.send(JSON.stringify({ ...entry, protocol: PROTOCOL_VERSION } satisfies ClientMessage));
      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (!settled && message.type === 'error') {
          finish(message.message);
          socket.close();
          return;
        }
        this.handle(message);
        // Installé et première image reçue : l'écran peut s'afficher.
        if (!settled && this.current) finish();
      };
      socket.onerror = () => finish('Connexion au serveur impossible. Vérifiez son adresse et qu’il est bien lancé (pnpm serve).');
      socket.onclose = () => {
        finish('La connexion a été fermée par le serveur.');
        if (this.socket === socket) this.onClosed();
      };
    });
  }

  private onClosed(): void {
    this.status = { ...this.status, online: false, effective: 0 };
    for (const resolve of this.replies.values()) resolve({ ok: false, code: 'OFFLINE' });
    this.replies.clear();
    this.notify();
    if (this.left || this.final || !this.token) return;
    // Coupure : on revient à sa place avec le jeton reçu à l'installation.
    if (this.reconnects >= MAX_RECONNECTS) {
      this.status = { ...this.status, error: 'Liaison perdue avec le serveur. Revenez au menu pour reprendre la partie.' };
      this.notify();
      return;
    }
    this.reconnects += 1;
    setTimeout(() => {
      if (this.left) return;
      this.open({ type: 'resume', code: this.status.code, token: this.token }).catch(() => this.onClosed());
    }, 2000);
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'seated':
        this.playerSide = message.side;
        this.token = message.token;
        this.fixed = message.static;
        this.status = { ...this.status, code: message.code, players: message.players, online: true, error: null };
        this.brief = { scenarioId: message.brief.scenarioId, title: message.brief.title, description: message.brief.description, briefing: message.brief.briefing, region: message.brief.region, fit: this.brief.fit };
        this.reconnects = 0;
        writeResumeTicket({ url: this.url, code: message.code, token: message.token });
        break;
      case 'players':
        this.status = { ...this.status, players: message.players };
        break;
      case 'state': {
        if (!this.fixed) return;
        const first = this.current === null;
        this.current = { ...message.picture, ...this.fixed };
        this.log = message.reset ? message.events : this.log.concat(message.events);
        this.isNight = message.night;
        this.canOrder = message.planning;
        this.speed = message.requested[this.playerSide] as Speed;
        this.status = { ...this.status, requested: message.requested, effective: message.speed };
        if (first) {
          const pic = this.current;
          const points = [...pic.bases.map((b) => b.pos), ...pic.units.filter((u) => u.status === 'airborne' || u.status === 'active').map((u) => u.pos)];
          this.brief = { ...this.brief, fit: briefingFit(pic.objective, points) };
        }
        break;
      }
      case 'orderResult': {
        const resolve = this.replies.get(message.ref);
        this.replies.delete(message.ref);
        resolve?.(message.result);
        break;
      }
      case 'checkResult': {
        const key = this.checkRefs.get(message.ref);
        this.checkRefs.delete(message.ref);
        if (key) this.checks.set(key, { result: message.result, estimate: message.estimate, at: this.time, askedMs: Date.now(), pending: false });
        break;
      }
      case 'ended': {
        const loaded = loadGame(message.save as SaveGame);
        if (loaded.ok) this.final = loaded.session;
        else this.status = { ...this.status, error: `Compte rendu illisible : ${loaded.errors[0] ?? 'erreur inconnue'}` };
        writeResumeTicket(null);
        break;
      }
      case 'error':
        this.status = { ...this.status, error: message.message };
        break;
      default:
        break;
    }
    this.notify();
  }

  private send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  start(): void {
    // Rien à lancer : le minuteur de la simulation est sur le serveur.
  }

  stop(): void {
    // Quitter l'écran ne quitte pas la table : voir `leave`.
  }

  /** Quitte la table pour de bon et ferme la liaison. */
  leave(): void {
    this.left = true;
    writeResumeTicket(null);
    this.send({ type: 'leave' });
    this.socket?.close();
  }

  setSpeed(speed: Speed): void {
    if (this.ended) return;
    this.speed = speed;
    this.send({ type: 'speed', speed });
    this.notify();
  }

  advance(): void {
    // Sans objet à deux joueurs : le temps appartient aux deux.
  }

  get time(): number {
    return this.current?.time ?? 0;
  }

  get ended(): boolean {
    return this.current?.ended ?? false;
  }

  get wegoTurnS(): number {
    return this.current?.wegoTurnS ?? 0;
  }

  get planning(): boolean {
    return this.canOrder;
  }

  night(): boolean {
    return this.isNight;
  }

  picture(): SidePicture {
    if (!this.current) throw new Error('Aucune image reçue du serveur');
    return this.current;
  }

  events(): SimEvent[] {
    return this.log;
  }

  /** Réponse connue du serveur pour cet ordre ; la redemande si elle date. */
  private lookup(order: GameOrder): CheckEntry | undefined {
    const key = JSON.stringify(order);
    const entry = this.checks.get(key);
    const now = Date.now();
    const stale = !entry || (!entry.pending && entry.at !== this.time && now - entry.askedMs > 500);
    if (stale) {
      if (this.checks.size > 60) this.checks.clear();
      const ref = (this.ref += 1);
      this.checkRefs.set(ref, key);
      this.checks.set(key, { result: entry?.result ?? { ok: false, code: 'CHECKING' }, estimate: entry?.estimate ?? null, at: entry?.at ?? -1, askedMs: now, pending: true });
      if (!this.send({ type: 'check', ref, order })) this.checks.set(key, { result: { ok: false, code: 'OFFLINE' }, estimate: null, at: -1, askedMs: now, pending: false });
    }
    return this.checks.get(key);
  }

  check(order: GameOrder): GameOrderResult {
    if (order.side !== this.playerSide) return { ok: false, code: 'WRONG_SIDE' };
    return this.lookup(order)?.result ?? { ok: false, code: 'CHECKING' };
  }

  estimate(order: GameOrder): MissionEstimate | null {
    if (order.type !== 'CREATE_MISSION' || order.side !== this.playerSide) return null;
    return this.lookup(order)?.estimate ?? null;
  }

  order(order: GameOrder): Promise<GameOrderResult> {
    const ref = (this.ref += 1);
    if (!this.send({ type: 'order', ref, order })) return Promise.resolve({ ok: false, code: 'OFFLINE' });
    return new Promise<GameOrderResult>((resolve) => {
      const timer = setTimeout(() => {
        this.replies.delete(ref);
        resolve({ ok: false, code: 'NO_REPLY' });
      }, REPLY_TIMEOUT_MS);
      this.replies.set(ref, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  save(): SaveGame | null {
    return null;
  }

  finalSession(): Session | null {
    return this.final;
  }

  net(): NetStatus {
    return this.status;
  }

  /** Nom de l'adversaire, s'il est arrivé. */
  opponent(): Players[SideId] {
    return this.status.players[this.playerSide === 'BLUE' ? 'RED' : 'BLUE'];
  }
}
