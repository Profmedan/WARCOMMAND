/**
 * Serveur de parties à deux joueurs : le transport WebSocket et le minuteur du salon (`@warcommand/net-play`).
 *
 * La simulation tourne ici et nulle part ailleurs : les navigateurs envoient des ordres et reçoivent l'image
 * de leur camp. Aucune donnée n'est conservée sur disque ; une partie vit en mémoire le temps d'être jouée.
 */
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, PROTOCOL_VERSION, type Outgoing } from '@warcommand/net-play';
import { SCENARIOS } from '@warcommand/scenario-system';
import { checkScenario } from '@warcommand/mission-editor';

export interface NetServerOptions {
  port: number;
  /** Adresse d'écoute : 127.0.0.1 pour cette seule machine, 0.0.0.0 pour le réseau local. */
  host: string;
  /** Période du minuteur de simulation, en millisecondes. */
  tickMs?: number;
  /** Taille maximale d'un message reçu (un scénario personnel tient dans quelques centaines de kilo-octets). */
  maxPayload?: number;
  maxConnections?: number;
}

export interface NetServer {
  port: number;
  lobby: Lobby;
  close(): Promise<void>;
}

/** Messages qu'une connexion peut envoyer par seconde avant d'être fermée. */
const MAX_MESSAGES_PER_SECOND = 200;

export function startServer(options: NetServerOptions): Promise<NetServer> {
  const tickMs = options.tickMs ?? 100;
  const lobby = new Lobby({
    scenarios: (id) => SCENARIOS.find((s) => s.id === id),
    validate: (scenario) => checkScenario(scenario).errors,
    // Codes et jetons : aléa du système, pas celui de la simulation.
    random: () => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000,
  });

  const http = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ name: 'WAR COMMAND', protocol: PROTOCOL_VERSION, parties: lobby.size }));
  });
  const wss = new WebSocketServer({ server: http, maxPayload: options.maxPayload ?? 1024 * 1024 });
  const sockets = new Map<string, WebSocket>();
  let sequence = 0;

  const deliver = (out: Outgoing[]) => {
    for (const o of out) {
      const socket = sockets.get(o.to);
      if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(o.message));
    }
  };

  wss.on('connection', (socket) => {
    if (sockets.size >= (options.maxConnections ?? 64)) {
      socket.close(1013, 'Serveur complet');
      return;
    }
    const id = `c${(sequence += 1)}`;
    sockets.set(id, socket);
    lobby.connect(id);
    let windowStart = Date.now();
    let received = 0;

    socket.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        received = 0;
      }
      received += 1;
      if (received > MAX_MESSAGES_PER_SECOND) {
        socket.close(1008, 'Trop de messages');
        return;
      }
      let message: unknown = null;
      if (!isBinary) {
        try {
          message = JSON.parse(String(data));
        } catch {
          message = null;
        }
      }
      deliver(lobby.receive(id, message));
    });
    socket.on('close', () => {
      sockets.delete(id);
      deliver(lobby.disconnect(id));
    });
    // Erreur de transport (message démesuré, trame invalide) : `ws` ferme la connexion avec le code approprié.
    socket.on('error', () => undefined);
  });

  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    // Un processus suspendu ne rattrape pas son retard d'un bloc.
    const elapsed = Math.min(1000, now - last);
    last = now;
    deliver(lobby.tick(elapsed));
  }, tickMs);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, options.host, () => {
      resolve({
        port: (http.address() as AddressInfo).port,
        lobby,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(timer);
            for (const socket of sockets.values()) socket.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
