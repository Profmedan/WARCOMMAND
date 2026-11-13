/**
 * Jeu à deux joueurs : un salon qui héberge des parties et fait autorité sur leur simulation.
 *
 * Ce module ne connaît ni socket ni horloge : il reçoit des messages et des durées, et rend les messages à
 * envoyer. Le transport (WebSocket) et le minuteur sont l'affaire du serveur, dans `tools/`.
 *
 * Brouillard de guerre : un joueur ne reçoit que l'image de son camp et les événements qu'il a le droit de
 * voir — exactement ce que reçoit l'IA en partie solitaire. La vérité-terrain n'est envoyée qu'à la fin.
 */
import { getSidePicture, opponent, SIDES, visibleEvents, type SideId, type SidePicture, type SimEvent } from '@warcommand/simulation-core';
import { estimateMission, nightNow, type MissionEstimate } from '@warcommand/air-operations';
import {
  createSession,
  issueOrder,
  parseScenario,
  stepSession,
  validateGameOrder,
  type GameOrder,
  type GameOrderResult,
  type Scenario,
  type Session,
} from '@warcommand/scenario-system';
import { saveGame, type SaveGame } from '@warcommand/replay-engine';

export const PROTOCOL_VERSION = 1;

export type NetSpeed = 0 | 1 | 5 | 20 | 100;
export const NET_SPEEDS: readonly NetSpeed[] = [0, 1, 5, 20, 100];

/** Ce qui ne change pas de toute la partie : envoyé une fois, à l'installation. */
export type PictureStatic = Pick<SidePicture, 'platforms' | 'rules' | 'terrain' | 'theater'>;
export type PictureDynamic = Omit<SidePicture, keyof PictureStatic>;

export interface MatchBrief {
  code: string;
  scenarioId: string;
  title: string;
  description: string;
  /** Briefing du camp du joueur — jamais celui de l'adversaire. */
  briefing: string;
  region: { center: { lat: number; lon: number }; zoom: number };
  sideNames: Record<SideId, string>;
  /** 0 = temps continu ; sinon durée d'un tour en minutes. */
  wegoTurnMin: number;
}

export type Players = Record<SideId, { name: string; connected: boolean } | null>;

/** Résultat d'un ordre reçu par le réseau : celui du moteur, ou un refus du salon. */
export type NetOrderResult = GameOrderResult;

export type ClientMessage =
  | { type: 'create'; protocol: number; name: string; side: SideId; scenarioId?: string; scenario?: unknown; seed: number; wegoTurnMin: number }
  | { type: 'join'; protocol: number; name: string; code: string }
  | { type: 'resume'; protocol: number; code: string; token: string }
  | { type: 'speed'; speed: NetSpeed }
  | { type: 'order'; ref: number; order: GameOrder }
  | { type: 'check'; ref: number; order: GameOrder }
  | { type: 'leave' };

export type ServerMessage =
  | { type: 'error'; message: string }
  | { type: 'seated'; code: string; token: string; side: SideId; brief: MatchBrief; static: PictureStatic; players: Players }
  | { type: 'players'; players: Players }
  | {
      type: 'state';
      picture: PictureDynamic;
      /** Événements visibles par le joueur. `reset` : la liste repart du début de la partie. */
      events: SimEvent[];
      reset: boolean;
      night: boolean;
      /** Vitesse effective : la plus lente des deux demandes, 0 si un joueur manque. */
      speed: number;
      requested: Record<SideId, NetSpeed>;
      /** Les ordres sont-ils recevables maintenant ? */
      planning: boolean;
    }
  | { type: 'orderResult'; ref: number; result: NetOrderResult }
  | { type: 'checkResult'; ref: number; result: NetOrderResult; estimate: MissionEstimate | null }
  | { type: 'ended'; save: SaveGame };

export interface Outgoing {
  to: string;
  message: ServerMessage;
}

export interface LobbyOptions {
  /** Scénarios livrés, par identifiant. */
  scenarios: (id: string) => Scenario | undefined;
  /** Contrôle de cohérence d'un scénario envoyé par l'hôte : liste des erreurs, vide s'il est jouable. */
  validate: (scenario: Scenario) => string[];
  /** Source d'aléa pour les codes et les jetons (jamais pour la simulation, qui a sa graine). */
  random: () => number;
  /** Délai après lequel une partie désertée par ses deux joueurs est fermée. */
  graceMs?: number;
  maxMatches?: number;
}

interface Seat {
  name: string;
  token: string;
  conn: string | null;
  requested: NetSpeed;
  /** Nombre d'événements de l'état déjà examinés pour ce joueur. */
  scanned: number;
  endedSent: boolean;
}

interface Match {
  code: string;
  session: Session;
  seats: Record<SideId, Seat | null>;
  carry: number;
  /** Temps réel écoulé depuis que plus personne n'est connecté. */
  desertedMs: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Garde-fou : nombre maximal de pas de simulation par appel à `tick`. */
const MAX_STEPS_PER_TICK = 400;
const MALFORMED: NetOrderResult = { ok: false, code: 'MALFORMED' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSide = (v: unknown): v is SideId => v === 'BLUE' || v === 'RED';

export class Lobby {
  private readonly options: Required<LobbyOptions>;
  private readonly matches = new Map<string, Match>();
  /** Connexion → place occupée. */
  private readonly seatOf = new Map<string, { code: string; side: SideId }>();
  private readonly connections = new Set<string>();

  constructor(options: LobbyOptions) {
    this.options = { graceMs: 600_000, maxMatches: 16, ...options };
  }

  /** Nombre de parties hébergées. */
  get size(): number {
    return this.matches.size;
  }

  connect(conn: string): void {
    this.connections.add(conn);
  }

  disconnect(conn: string): Outgoing[] {
    this.connections.delete(conn);
    return this.vacate(conn);
  }

  /** Traite un message reçu d'une connexion ; rend les messages à envoyer. */
  receive(conn: string, raw: unknown): Outgoing[] {
    if (!isObject(raw) || typeof raw.type !== 'string') return this.error(conn, 'Message illisible.');
    switch (raw.type) {
      case 'create':
        return this.onCreate(conn, raw);
      case 'join':
        return this.onJoin(conn, raw);
      case 'resume':
        return this.onResume(conn, raw);
      case 'leave':
        return this.vacate(conn);
      case 'speed':
      case 'order':
      case 'check': {
        const place = this.seatOf.get(conn);
        const match = place ? this.matches.get(place.code) : undefined;
        if (!place || !match) return this.error(conn, 'Vous n’êtes installé dans aucune partie.');
        if (raw.type === 'speed') return this.onSpeed(conn, match, place.side, raw.speed);
        return raw.type === 'order' ? this.onOrder(conn, match, place.side, raw) : this.onCheck(conn, match, place.side, raw);
      }
      default:
        return this.error(conn, `Message inconnu : ${raw.type}.`);
    }
  }

  /** Fait avancer les parties de `realMs` millisecondes de temps réel ; rend les états à diffuser. */
  tick(realMs: number): Outgoing[] {
    const out: Outgoing[] = [];
    for (const match of [...this.matches.values()]) {
      const connected = SIDES.some((side) => match.seats[side]?.conn != null);
      if (!connected) {
        match.desertedMs += realMs;
        if (match.desertedMs >= this.options.graceMs) this.matches.delete(match.code);
        continue;
      }
      match.desertedMs = 0;

      const s = match.session.state;
      const speed = this.effectiveSpeed(match);
      if (speed === 0 || s.outcome) {
        match.carry = 0;
        continue;
      }
      match.carry += (realMs / 1000) * speed;
      let steps = Math.min(MAX_STEPS_PER_TICK, Math.floor(match.carry));
      if (steps <= 0) continue;
      match.carry -= steps;
      // Mode par tours : la résolution s'arrête exactement à la fin du tour.
      const turn = s.wegoTurnS;
      if (turn > 0) steps = Math.min(steps, turn - (s.time % turn));
      stepSession(match.session, steps);
      if (s.outcome || (turn > 0 && s.time % turn === 0)) {
        // Fin de tour ou de partie : chacun doit redemander une vitesse.
        for (const side of SIDES) if (match.seats[side]) match.seats[side]!.requested = 0;
        match.carry = 0;
      }
      out.push(...this.broadcast(match));
    }
    return out;
  }

  /* ---------------------------------------------------------------- Installation */

  private error(conn: string, message: string): Outgoing[] {
    return [{ to: conn, message: { type: 'error', message } }];
  }

  private checkProtocol(raw: Record<string, unknown>): string | null {
    return raw.protocol === PROTOCOL_VERSION ? null : 'Votre version du jeu n’est pas celle du serveur : mettez les deux à jour.';
  }

  private nameOf(raw: Record<string, unknown>): string | null {
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 24) : '';
    return name.length > 0 ? name : null;
  }

  private token(): string {
    let token = '';
    for (let i = 0; i < 24; i++) token += Math.floor(this.options.random() * 16).toString(16);
    return token;
  }

  private freshCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(this.options.random() * CODE_ALPHABET.length)];
      if (!this.matches.has(code)) return code;
    }
  }

  private onCreate(conn: string, raw: Record<string, unknown>): Outgoing[] {
    const mismatch = this.checkProtocol(raw);
    if (mismatch) return this.error(conn, mismatch);
    const name = this.nameOf(raw);
    if (!name) return this.error(conn, 'Indiquez un nom de joueur.');
    if (!isSide(raw.side)) return this.error(conn, 'Camp inconnu.');
    const seed = raw.seed;
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return this.error(conn, 'Graine invalide.');
    const turn = raw.wegoTurnMin;
    if (turn !== 0 && turn !== 5 && turn !== 10) return this.error(conn, 'Gestion du temps inconnue.');
    if (this.matches.size >= this.options.maxMatches) return this.error(conn, 'Le serveur héberge déjà le nombre maximal de parties.');

    let scenario: Scenario | undefined;
    if (raw.scenario !== undefined) {
      const parsed = parseScenario(raw.scenario);
      if (!parsed.ok) return this.error(conn, `Scénario refusé : ${parsed.errors.slice(0, 3).join(' ; ')}`);
      const errors = this.options.validate(parsed.scenario);
      if (errors.length > 0) return this.error(conn, `Scénario refusé : ${errors.slice(0, 3).join(' ; ')}`);
      scenario = parsed.scenario;
    } else {
      scenario = typeof raw.scenarioId === 'string' ? this.options.scenarios(raw.scenarioId) : undefined;
      if (!scenario) return this.error(conn, `Scénario inconnu : ${String(raw.scenarioId)}.`);
    }

    let session: Session;
    try {
      session = createSession(scenario, { playerSide: raw.side, seed, wegoTurnMin: turn, versus: true });
    } catch (error) {
      return this.error(conn, `Scénario refusé : ${error instanceof Error ? error.message : String(error)}`);
    }

    const out = this.vacate(conn);
    const match: Match = { code: this.freshCode(), session, seats: { BLUE: null, RED: null }, carry: 0, desertedMs: 0 };
    this.matches.set(match.code, match);
    return [...out, ...this.seat(conn, match, raw.side, name)];
  }

  private onJoin(conn: string, raw: Record<string, unknown>): Outgoing[] {
    const mismatch = this.checkProtocol(raw);
    if (mismatch) return this.error(conn, mismatch);
    const name = this.nameOf(raw);
    if (!name) return this.error(conn, 'Indiquez un nom de joueur.');
    const match = typeof raw.code === 'string' ? this.matches.get(raw.code.trim().toUpperCase()) : undefined;
    if (!match) return this.error(conn, 'Partie introuvable : vérifiez le code.');
    const free = SIDES.find((side) => match.seats[side] === null);
    if (!free) return this.error(conn, 'Cette partie est complète.');
    return [...this.vacate(conn), ...this.seat(conn, match, free, name)];
  }

  private onResume(conn: string, raw: Record<string, unknown>): Outgoing[] {
    const mismatch = this.checkProtocol(raw);
    if (mismatch) return this.error(conn, mismatch);
    const match = typeof raw.code === 'string' ? this.matches.get(raw.code.trim().toUpperCase()) : undefined;
    if (!match) return this.error(conn, 'Partie introuvable : elle a peut-être été fermée.');
    const side = SIDES.find((s) => match.seats[s] !== null && match.seats[s]!.token === raw.token);
    if (!side) return this.error(conn, 'Jeton de reprise refusé.');
    const out = this.vacate(conn);
    const seat = match.seats[side]!;
    // Une connexion plus ancienne du même joueur est remplacée.
    if (seat.conn !== null) this.seatOf.delete(seat.conn);
    return [...out, ...this.seat(conn, match, side, seat.name, seat.token)];
  }

  /** Installe une connexion à une place, lui envoie tout ce qu'il faut pour afficher la partie, prévient l'autre joueur. */
  private seat(conn: string, match: Match, side: SideId, name: string, token = this.token()): Outgoing[] {
    const seat: Seat = { name, token, conn, requested: 0, scanned: 0, endedSent: false };
    match.seats[side] = seat;
    match.desertedMs = 0;
    this.seatOf.set(conn, { code: match.code, side });

    const sc = match.session.scenario;
    const s = match.session.state;
    const own = new Set(Object.values(s.units).filter((u) => u.side === side).map((u) => u.platformId));
    const out: Outgoing[] = [
      {
        to: conn,
        message: {
          type: 'seated',
          code: match.code,
          token,
          side,
          brief: {
            code: match.code,
            scenarioId: sc.id,
            title: sc.title,
            description: sc.description,
            briefing: sc.sides[side].briefing,
            region: { center: { ...sc.region.center }, zoom: sc.region.zoom },
            sideNames: { BLUE: sc.sides.BLUE.name, RED: sc.sides.RED.name },
            wegoTurnMin: match.session.options.wegoTurnMin ?? 0,
          },
          static: {
            // Seules les fiches des matériels du camp : la dotation adverse ne se lit pas dans la liste.
            platforms: Object.fromEntries(Object.entries(s.platforms).filter(([id]) => own.has(id))),
            rules: s.rules,
            terrain: s.terrain,
            theater: s.theater,
          },
          players: this.players(match),
        },
      },
      ...this.stateFor(match, side),
    ];
    const other = match.seats[opponent(side)];
    if (other?.conn != null) out.push({ to: other.conn, message: { type: 'players', players: this.players(match) } }, ...this.stateFor(match, opponent(side)));
    return out;
  }

  /** Libère la place tenue par une connexion (départ ou coupure) : le joueur garde son jeton pour revenir. */
  private vacate(conn: string): Outgoing[] {
    const place = this.seatOf.get(conn);
    if (!place) return [];
    this.seatOf.delete(conn);
    const match = this.matches.get(place.code);
    const seat = match?.seats[place.side];
    if (!match || !seat || seat.conn !== conn) return [];
    seat.conn = null;
    seat.requested = 0;
    const other = match.seats[opponent(place.side)];
    if (other?.conn == null) return [];
    return [{ to: other.conn, message: { type: 'players', players: this.players(match) } }, ...this.stateFor(match, opponent(place.side))];
  }

  private players(match: Match): Players {
    const of = (side: SideId) => (match.seats[side] ? { name: match.seats[side]!.name, connected: match.seats[side]!.conn !== null } : null);
    return { BLUE: of('BLUE'), RED: of('RED') };
  }

  /* ---------------------------------------------------------------- Partie */

  private effectiveSpeed(match: Match): number {
    const blue = match.seats.BLUE;
    const red = match.seats.RED;
    if (!blue || !red || blue.conn === null || red.conn === null) return 0;
    return Math.min(blue.requested, red.requested);
  }

  private planning(match: Match): boolean {
    const s = match.session.state;
    return s.wegoTurnS === 0 || s.time % s.wegoTurnS === 0;
  }

  /** État à envoyer à un joueur : l'image de son camp, ses nouveaux événements, et la fin de partie le cas échéant. */
  private stateFor(match: Match, side: SideId): Outgoing[] {
    const seat = match.seats[side];
    if (!seat || seat.conn === null) return [];
    const s = match.session.state;
    const { platforms: _platforms, rules: _rules, terrain: _terrain, theater: _theater, ...picture } = getSidePicture(s, side);
    const reset = seat.scanned === 0;
    const events = visibleEvents(s, side, seat.scanned);
    seat.scanned = s.events.length;
    const out: Outgoing[] = [
      {
        to: seat.conn,
        message: {
          type: 'state',
          picture,
          events,
          reset,
          night: nightNow(s),
          speed: this.effectiveSpeed(match),
          requested: { BLUE: match.seats.BLUE?.requested ?? 0, RED: match.seats.RED?.requested ?? 0 },
          planning: this.planning(match),
        },
      },
    ];
    // La vérité-terrain n'est révélée qu'une fois la mission terminée, comme en partie solitaire.
    if (s.outcome && !seat.endedSent) {
      seat.endedSent = true;
      out.push({ to: seat.conn, message: { type: 'ended', save: saveGame(match.session) } });
    }
    return out;
  }

  private broadcast(match: Match): Outgoing[] {
    return SIDES.flatMap((side) => this.stateFor(match, side));
  }

  private onSpeed(conn: string, match: Match, side: SideId, speed: unknown): Outgoing[] {
    if (!NET_SPEEDS.includes(speed as NetSpeed)) return this.error(conn, 'Vitesse inconnue.');
    match.seats[side]!.requested = match.session.state.outcome ? 0 : (speed as NetSpeed);
    match.carry = 0;
    return this.broadcast(match);
  }

  /** Un ordre venu du réseau est une donnée quelconque : il n'atteint le moteur que s'il a la forme d'un ordre du camp. */
  private vet(side: SideId, order: unknown): NetOrderResult | null {
    if (!isObject(order) || typeof order.type !== 'string' || !isSide(order.side)) return MALFORMED;
    if (order.side !== side) return { ok: false, code: 'WRONG_SIDE' };
    return null;
  }

  private onOrder(conn: string, match: Match, side: SideId, raw: Record<string, unknown>): Outgoing[] {
    const ref = typeof raw.ref === 'number' ? raw.ref : 0;
    let result = this.vet(side, raw.order);
    if (!result) {
      try {
        result = issueOrder(match.session, raw.order as GameOrder);
      } catch {
        result = MALFORMED;
      }
    }
    return [{ to: conn, message: { type: 'orderResult', ref, result } }, ...this.stateFor(match, side)];
  }

  private onCheck(conn: string, match: Match, side: SideId, raw: Record<string, unknown>): Outgoing[] {
    const ref = typeof raw.ref === 'number' ? raw.ref : 0;
    let result = this.vet(side, raw.order);
    let estimate: MissionEstimate | null = null;
    if (!result) {
      const order = raw.order as GameOrder;
      try {
        result = this.planning(match) ? validateGameOrder(match.session.state, order) : { ok: false, code: 'NOT_PLANNING_PHASE' };
        if (order.type === 'CREATE_MISSION') estimate = estimateMission(match.session.state, side, order.draft);
      } catch {
        result = MALFORMED;
        estimate = null;
      }
    }
    return [{ to: conn, message: { type: 'checkResult', ref, result, estimate } }];
  }
}
