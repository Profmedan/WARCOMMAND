import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@warcommand/net-play';
import { startServer, type NetServer } from '../net-server';

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/** Client d'essai : une vraie connexion WebSocket et la file des messages reçus. */
class Client {
  readonly inbox: ServerMessage[] = [];
  private readonly waiters: (() => void)[] = [];
  closed: { code: number } | null = null;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.inbox.push(JSON.parse(String(data)) as ServerMessage);
      for (const w of this.waiters.splice(0)) w();
    });
    socket.on('close', (code) => {
      this.closed = { code };
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static open(port: number): Promise<Client> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      const client = new Client(socket);
      socket.once('open', () => resolve(client));
      socket.once('error', reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Attend qu'un message satisfasse `test` (parmi ceux déjà reçus ou à venir). */
  async until<T extends ServerMessage['type']>(type: T, test: (m: Of<T>) => boolean = () => true, timeoutMs = 5000): Promise<Of<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.inbox.filter((m): m is Of<T> => m.type === type).find(test);
      if (found) return found;
      if (this.closed) throw new Error(`Connexion fermée (${this.closed.code}) avant « ${type} »`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Délai dépassé en attendant « ${type} »`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async untilClosed(timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    if (!this.closed) throw new Error('La connexion aurait dû être fermée');
    return this.closed.code;
  }

  close(): void {
    this.socket.close();
  }
}

describe('serveur de parties (WebSocket réel)', () => {
  let server: NetServer;
  const clients: Client[] = [];
  const open = async () => {
    const c = await Client.open(server.port);
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', tickMs: 20, maxPayload: 256 * 1024 });
  });

  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('répond en HTTP par un état de santé', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'WAR COMMAND', protocol: PROTOCOL_VERSION });
  });

  it('deux joueurs se connectent, jouent, et le temps avance pour les deux', async () => {
    const alice = await open();
    alice.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'Alice', side: 'BLUE', scenarioId: 'bouclier-atlantique', seed: 9, wegoTurnMin: 0 });
    const seat = await alice.until('seated');
    expect(seat.side).toBe('BLUE');

    const bruno = await open();
    bruno.send({ type: 'join', protocol: PROTOCOL_VERSION, name: 'Bruno', code: seat.code });
    expect((await bruno.until('seated')).side).toBe('RED');
    await alice.until('players', (m) => m.players.RED?.connected === true);

    alice.send({ type: 'speed', speed: 100 });
    bruno.send({ type: 'speed', speed: 100 });
    const blue = await alice.until('state', (m) => m.picture.time >= 60);
    const red = await bruno.until('state', (m) => m.picture.time >= 60);
    expect(blue.picture.side).toBe('BLUE');
    expect(red.picture.side).toBe('RED');
    expect(blue.speed).toBe(100);

    bruno.close();
    await alice.until('players', (m) => m.players.RED?.connected === false);
    const paused = await alice.until('state', (m) => m.speed === 0);
    expect(paused.requested.RED).toBe(0);
  });

  it('un message qui n’est pas du JSON est refusé, et la connexion reste utilisable', async () => {
    const c = await open();
    c.send('ceci n’est pas du JSON');
    expect((await c.until('error')).message).toMatch(/illisible/i);
    c.send({ type: 'join', protocol: PROTOCOL_VERSION, name: 'Chloé', code: 'ZZZZ' });
    expect((await c.until('error', (m) => /introuvable/i.test(m.message))).message).toMatch(/introuvable/i);
  });

  it('un message démesuré ferme la connexion', async () => {
    const c = await open();
    c.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, name: 'x'.repeat(400 * 1024), code: 'ZZZZ' }));
    expect(await c.untilClosed()).toBe(1009);
  });

  it('une connexion qui inonde le serveur de messages est fermée', async () => {
    const c = await open();
    for (let i = 0; i < 600; i++) c.send({ type: 'speed', speed: 0 });
    expect(await c.untilClosed()).toBe(1008);
  });
});
