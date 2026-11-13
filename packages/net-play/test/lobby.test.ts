import { describe, expect, it } from 'vitest';
import { hashState, type SideId } from '@warcommand/simulation-core';
import { BOUCLIER_ATLANTIQUE, SCENARIOS, type GameOrder } from '@warcommand/scenario-system';
import { checkScenario } from '@warcommand/mission-editor';
import { loadGame, replay } from '@warcommand/replay-engine';
import { Lobby, PROTOCOL_VERSION, type ServerMessage } from '../src/index';

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/** Banc d'essai : un salon, et la boîte de réception de chaque connexion, alimentée comme par un vrai transport. */
class Bench {
  readonly lobby: Lobby;
  readonly inbox = new Map<string, ServerMessage[]>();
  private n = 0;

  constructor(graceMs = 600_000) {
    // Générateur déterministe : codes et jetons sont les mêmes d'un essai à l'autre.
    const random = () => {
      this.n = (this.n * 1103515245 + 12345) >>> 0;
      return this.n / 0x100000000;
    };
    this.lobby = new Lobby({ scenarios: (id) => SCENARIOS.find((s) => s.id === id), validate: (sc) => checkScenario(sc).errors, random, graceMs });
  }

  private deliver(out: { to: string; message: ServerMessage }[]): void {
    for (const o of out) {
      const box = this.inbox.get(o.to) ?? [];
      // Un transport réel sérialise : rien de ce que reçoit un client ne partage de référence avec le serveur.
      box.push(JSON.parse(JSON.stringify(o.message)) as ServerMessage);
      this.inbox.set(o.to, box);
    }
  }

  connect(conn: string): void {
    this.lobby.connect(conn);
  }

  send(conn: string, message: unknown): void {
    this.deliver(this.lobby.receive(conn, message));
  }

  drop(conn: string): void {
    this.deliver(this.lobby.disconnect(conn));
  }

  tick(ms: number, times = 1): void {
    for (let i = 0; i < times; i++) this.deliver(this.lobby.tick(ms));
  }

  all<T extends ServerMessage['type']>(conn: string, type: T): Of<T>[] {
    return (this.inbox.get(conn) ?? []).filter((m): m is Of<T> => m.type === type);
  }

  last<T extends ServerMessage['type']>(conn: string, type: T): Of<T> {
    const found = this.all(conn, type).at(-1);
    if (!found) throw new Error(`Aucun message « ${type} » reçu par ${conn}`);
    return found;
  }

  time(conn: string): number {
    return this.last(conn, 'state').picture.time;
  }
}

const create = (over: Record<string, unknown> = {}) => ({ type: 'create', protocol: PROTOCOL_VERSION, name: 'Alice', side: 'BLUE', scenarioId: 'bouclier-atlantique', seed: 5, wegoTurnMin: 0, ...over });

/** Deux joueurs installés : Alice (connexion « a ») commande BLEU, Bruno (« b ») commande ROUGE. */
function seated(over: Record<string, unknown> = {}, graceMs?: number): { bench: Bench; code: string } {
  const bench = new Bench(graceMs);
  bench.connect('a');
  bench.connect('b');
  bench.send('a', create(over));
  const code = bench.last('a', 'seated').code;
  bench.send('b', { type: 'join', protocol: PROTOCOL_VERSION, name: 'Bruno', code });
  return { bench, code };
}

const redCap: GameOrder = {
  type: 'CREATE_MISSION',
  side: 'RED',
  draft: { type: 'CAP', unitIds: ['red-su-1', 'red-su-2'], waypoints: [{ lat: 67.4, lon: -10.4 }], altM: 9000, speed: 'cruise', launchAt: 0, endAt: null, roe: 'defensive', allowRefuel: false, targetContactId: null },
};

describe('salon : création et arrivée des joueurs', () => {
  it('l’hôte crée la partie, reçoit son code, son camp et son seul briefing', () => {
    const bench = new Bench();
    bench.connect('a');
    bench.send('a', create());
    const seat = bench.last('a', 'seated');
    expect(seat.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(seat.side).toBe('BLUE');
    expect(seat.token.length).toBeGreaterThanOrEqual(16);
    expect(seat.brief.title).toBe(BOUCLIER_ATLANTIQUE.title);
    expect(seat.brief.briefing).toBe(BOUCLIER_ATLANTIQUE.sides.BLUE.briefing);
    expect(JSON.stringify(seat.brief)).not.toContain(BOUCLIER_ATLANTIQUE.sides.RED.briefing);
    expect(seat.players).toEqual({ BLUE: { name: 'Alice', connected: true }, RED: null });
    expect(bench.last('a', 'state').picture.side).toBe('BLUE');
  });

  it('le second joueur rejoint avec le code et prend le camp libre ; chacun est prévenu', () => {
    const { bench } = seated();
    expect(bench.last('b', 'seated').side).toBe('RED');
    expect(bench.last('b', 'state').picture.side).toBe('RED');
    const players = { BLUE: { name: 'Alice', connected: true }, RED: { name: 'Bruno', connected: true } };
    expect(bench.last('a', 'players').players).toEqual(players);
    expect(bench.last('b', 'seated').players).toEqual(players);
  });

  it('l’hôte peut choisir ROUGE : l’invité commande alors BLEU', () => {
    const { bench } = seated({ side: 'RED' });
    expect(bench.last('a', 'seated').side).toBe('RED');
    expect(bench.last('b', 'seated').side).toBe('BLUE');
  });

  it.each<[string, (bench: Bench, code: string) => void, RegExp]>([
    ['un code inconnu', (bench) => bench.send('c', { type: 'join', protocol: PROTOCOL_VERSION, name: 'Chloé', code: 'ZZZZ' }), /introuvable/i],
    ['une partie complète', (bench, code) => bench.send('c', { type: 'join', protocol: PROTOCOL_VERSION, name: 'Chloé', code }), /complète/i],
    ['une autre version du protocole', (bench, code) => bench.send('c', { type: 'join', protocol: 99, name: 'Chloé', code }), /version/i],
    ['un message illisible', (bench) => bench.send('c', 'bonjour'), /illisible/i],
    ['un message inconnu', (bench) => bench.send('c', { type: 'danse' }), /inconnu/i],
    ['un ordre sans être installé', (bench) => bench.send('c', { type: 'order', ref: 1, order: redCap }), /partie/i],
    ['un scénario inconnu', (bench) => bench.send('c', create({ scenarioId: 'nulle-part' })), /scénario/i],
    ['un scénario personnel invalide', (bench) => bench.send('c', create({ scenarioId: undefined, scenario: { id: 'x' } })), /scénario/i],
    ['un nom vide', (bench) => bench.send('c', create({ name: '   ' })), /nom/i],
    ['une graine invalide', (bench) => bench.send('c', create({ seed: -4 })), /graine/i],
  ])('refuse %s', (_label, act, message) => {
    const { bench, code } = seated();
    bench.connect('c');
    act(bench, code);
    expect(bench.last('c', 'error').message).toMatch(message);
    expect(bench.all('c', 'seated')).toHaveLength(0);
  });

  it('accepte un scénario personnel valide, envoyé par l’hôte', () => {
    const bench = new Bench();
    bench.connect('a');
    bench.send('a', create({ scenarioId: undefined, scenario: { ...BOUCLIER_ATLANTIQUE, id: 'mon-scenario', title: 'Mon scénario' } }));
    expect(bench.last('a', 'seated').brief.title).toBe('Mon scénario');
  });
});

describe('salon : le temps', () => {
  it('ne s’écoule pas tant que les deux joueurs ne sont pas là', () => {
    const bench = new Bench();
    bench.connect('a');
    bench.send('a', create());
    bench.send('a', { type: 'speed', speed: 20 });
    bench.tick(1000, 3);
    expect(bench.time('a')).toBe(0);
  });

  it('avance à la plus lente des deux vitesses demandées', () => {
    const { bench } = seated();
    bench.send('a', { type: 'speed', speed: 20 });
    bench.tick(1000);
    expect(bench.time('a')).toBe(0);
    expect(bench.last('b', 'state').speed).toBe(0);

    bench.send('b', { type: 'speed', speed: 5 });
    bench.tick(1000);
    expect(bench.time('a')).toBe(5);
    expect(bench.time('b')).toBe(5);
    expect(bench.last('a', 'state').speed).toBe(5);
    expect(bench.last('a', 'state').requested).toEqual({ BLUE: 20, RED: 5 });

    bench.send('b', { type: 'speed', speed: 0 });
    bench.tick(1000, 2);
    expect(bench.time('a')).toBe(5);
  });

  it('refuse une vitesse qui n’existe pas', () => {
    const { bench } = seated();
    bench.send('a', { type: 'speed', speed: 1000 });
    expect(bench.last('a', 'error').message).toMatch(/vitesse/i);
  });

  it('en mode par tours, s’arrête à la fin du tour et attend que les deux joueurs relancent', () => {
    const { bench } = seated({ wegoTurnMin: 5 });
    bench.send('a', { type: 'speed', speed: 100 });
    bench.send('b', { type: 'speed', speed: 100 });
    bench.tick(200, 3);
    // Tour en cours de résolution : les ordres attendent.
    bench.send('a', { type: 'order', ref: 7, order: { type: 'SET_ROE', side: 'BLUE', missionId: 'BLUE-CAP-1', roe: 'free' } });
    expect(bench.last('a', 'orderResult')).toMatchObject({ ref: 7, result: { ok: false, code: 'NOT_PLANNING_PHASE' } });
    bench.tick(200, 40);
    expect(bench.time('a')).toBe(300);
    expect(bench.last('a', 'state').requested).toEqual({ BLUE: 0, RED: 0 });
    expect(bench.last('a', 'state').planning).toBe(true);
    bench.tick(200, 5);
    expect(bench.time('a')).toBe(300);
  });
});

describe('salon : ordres', () => {
  it('chaque joueur commande son camp, et seulement le sien', () => {
    const { bench } = seated();
    bench.send('b', { type: 'order', ref: 1, order: redCap });
    expect(bench.last('b', 'orderResult')).toMatchObject({ ref: 1, result: { ok: true } });
    expect(bench.last('b', 'state').picture.missions.some((m) => m.type === 'CAP')).toBe(true);

    bench.send('a', { type: 'order', ref: 2, order: redCap });
    expect(bench.last('a', 'orderResult')).toMatchObject({ ref: 2, result: { ok: false, code: 'WRONG_SIDE' } });
  });

  it('un ordre mal formé est refusé sans faire tomber la partie', () => {
    const { bench } = seated();
    bench.send('a', { type: 'order', ref: 3, order: { type: 'CREATE_MISSION', side: 'BLUE' } });
    expect(bench.last('a', 'orderResult').result.ok).toBe(false);
    bench.send('a', { type: 'order', ref: 4, order: 'feu' });
    expect(bench.last('a', 'orderResult').result.ok).toBe(false);
    bench.send('a', { type: 'speed', speed: 1 });
    bench.send('b', { type: 'speed', speed: 1 });
    bench.tick(1000);
    expect(bench.time('a')).toBe(1);
  });

  it('vérifie un ordre sans l’émettre, et estime une mission', () => {
    const { bench } = seated();
    const order: GameOrder = {
      type: 'CREATE_MISSION',
      side: 'BLUE',
      draft: { type: 'CAP', unitIds: ['blue-raf-1'], waypoints: [{ lat: 67.0, lon: -11.0 }], altM: 9000, speed: 'cruise', launchAt: 0, endAt: null, roe: 'defensive', allowRefuel: false, targetContactId: null },
    };
    const far: GameOrder = { ...order, draft: { ...order.draft, waypoints: [{ lat: 10, lon: 60 }] } };
    bench.send('a', { type: 'check', ref: 9, order: far });
    const reply = bench.last('a', 'checkResult');
    expect(reply.ref).toBe(9);
    expect(reply.result.ok).toBe(false);

    const before = bench.last('a', 'state').picture.missions.length;
    bench.send('a', { type: 'check', ref: 11, order });
    const second = bench.last('a', 'checkResult');
    expect(second.result.ok).toBe(true);
    expect(second.estimate).not.toBeNull();
    expect(second.estimate!.transitMin).toBeGreaterThan(0);
    // Vérifier n'ordonne rien : la liste des missions n'a pas bougé.
    bench.send('a', { type: 'speed', speed: 0 });
    expect(bench.last('a', 'state').picture.missions.length).toBe(before);

    bench.send('a', { type: 'check', ref: 12, order: redCap });
    expect(bench.last('a', 'checkResult').result).toEqual({ ok: false, code: 'WRONG_SIDE' });
  });
});

describe('salon : déconnexion et reprise', () => {
  it('une déconnexion met la partie en pause et prévient l’autre joueur', () => {
    const { bench } = seated();
    bench.send('a', { type: 'speed', speed: 5 });
    bench.send('b', { type: 'speed', speed: 5 });
    bench.tick(1000);
    bench.drop('b');
    expect(bench.last('a', 'players').players.RED).toEqual({ name: 'Bruno', connected: false });
    bench.tick(1000, 3);
    expect(bench.time('a')).toBe(5);
  });

  it('le joueur revient avec son jeton, retrouve son camp et tout son journal', () => {
    const { bench, code } = seated();
    const token = bench.last('b', 'seated').token;
    bench.send('a', { type: 'speed', speed: 20 });
    bench.send('b', { type: 'speed', speed: 20 });
    bench.tick(1000, 30);
    const seenBefore = bench.all('b', 'state').flatMap((m) => m.events);
    bench.drop('b');

    bench.connect('b2');
    bench.send('b2', { type: 'resume', protocol: PROTOCOL_VERSION, code, token: 'faux-jeton' });
    expect(bench.last('b2', 'error').message).toMatch(/jeton/i);
    bench.send('b2', { type: 'resume', protocol: PROTOCOL_VERSION, code, token });
    expect(bench.last('b2', 'seated').side).toBe('RED');
    expect(bench.last('b2', 'state').events).toEqual(seenBefore);
    expect(bench.last('a', 'players').players.RED).toEqual({ name: 'Bruno', connected: true });

    // Sa vitesse est revenue à la pause : il doit la redemander pour que le temps reprenne.
    bench.tick(1000);
    expect(bench.time('a')).toBe(600);
    bench.send('b2', { type: 'speed', speed: 20 });
    bench.tick(1000);
    expect(bench.time('a')).toBe(620);
  });

  it('une partie abandonnée par ses deux joueurs est fermée après le délai de grâce', () => {
    const { bench, code } = seated({}, 5000);
    const token = bench.last('a', 'seated').token;
    bench.drop('a');
    bench.drop('b');
    bench.tick(1000, 4);
    bench.connect('a2');
    bench.send('a2', { type: 'resume', protocol: PROTOCOL_VERSION, code, token });
    expect(bench.last('a2', 'seated').side).toBe('BLUE');
    bench.drop('a2');
    bench.tick(1000, 6);
    bench.connect('a3');
    bench.send('a3', { type: 'resume', protocol: PROTOCOL_VERSION, code, token });
    expect(bench.last('a3', 'error').message).toMatch(/introuvable/i);
  });
});

describe('salon : brouillard de guerre et fin de partie', () => {
  const { bench } = seated();
  bench.send('b', { type: 'order', ref: 1, order: redCap });
  bench.send('a', { type: 'speed', speed: 100 });
  bench.send('b', { type: 'speed', speed: 100 });
  for (let i = 0; i < 400 && bench.all('a', 'ended').length === 0; i++) bench.tick(200);

  it('la partie va à son terme et chaque joueur reçoit le compte rendu complet', () => {
    expect(bench.all('a', 'ended')).toHaveLength(1);
    expect(bench.all('b', 'ended')).toHaveLength(1);
    expect(bench.last('a', 'state').picture.ended).toBe(true);
  });

  it('avant la fin, un joueur ne reçoit rien qui désigne une unité adverse', () => {
    const idsOf = (side: SideId) => BOUCLIER_ATLANTIQUE.units.filter((u) => u.side === side).map((u) => u.id);
    for (const [conn, enemy] of [['a', 'RED'], ['b', 'BLUE']] as const) {
      const during = JSON.stringify((bench.inbox.get(conn) ?? []).filter((m) => m.type !== 'ended'));
      for (const id of idsOf(enemy)) expect(during).not.toContain(`"${id}"`);
      for (const m of bench.all(conn, 'state')) {
        expect(m.picture.side).not.toBe(enemy);
        for (const e of m.events) expect(e.vis).toContain(enemy === 'RED' ? 'BLUE' : 'RED');
      }
    }
  });

  it('la sauvegarde finale se recharge et se rejoue à l’identique, ordres des deux camps compris', () => {
    const save = bench.last('a', 'ended').save;
    const loaded = loadGame(save);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session.options.versus).toBe(true);
    expect(loaded.session.orders.map((o) => o.order.side)).toEqual(['RED']);
    expect(hashState(replay(save.recording).state)).toBe(save.hash);
    expect(bench.last('b', 'ended').save.hash).toBe(save.hash);
  });
});
