import { describe, expect, it } from 'vitest';
import { cloneData, hashState, stepState } from '@warcommand/simulation-core';
import { observe } from '@warcommand/air-operations';
import {
  BOUCLIER_ATLANTIQUE,
  BOUCLIER_ATLANTIQUE_INPUT,
  createInitialState,
  createSession,
  exportScenario,
  parseScenario,
  stepSession,
  SYSTEMS,
  type ScenarioInput,
} from '../src/index';
import { freshState } from './helpers';

const variant = (mutate: (sc: ScenarioInput) => void): unknown => {
  const sc = cloneData(BOUCLIER_ATLANTIQUE_INPUT);
  mutate(sc);
  return sc;
};

describe('schéma de scénario', () => {
  it('le scénario livré est valide et survit à un aller-retour JSON', () => {
    const first = parseScenario(BOUCLIER_ATLANTIQUE_INPUT);
    expect(first.ok).toBe(true);
    const again = parseScenario(JSON.parse(exportScenario(BOUCLIER_ATLANTIQUE)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.scenario).toEqual(BOUCLIER_ATLANTIQUE);
  });

  it('respecte l’ordre de bataille demandé', () => {
    const count = (side: string, kind: string) =>
      Object.values(freshState().units).filter((u) => u.side === side && u.kind === kind).length;
    expect([count('BLUE', 'fighter'), count('BLUE', 'aew'), count('BLUE', 'tanker'), count('BLUE', 'sam'), count('BLUE', 'ship')]).toEqual([4, 1, 1, 1, 1]);
    expect([count('RED', 'fighter'), count('RED', 'aew'), count('RED', 'tanker'), count('RED', 'sam'), count('RED', 'ship')]).toEqual([4, 1, 0, 1, 1]);
    expect(BOUCLIER_ATLANTIQUE.durationMin).toBe(90);
  });

  it('refuse les scénarios incohérents, avec un message explicite', () => {
    const cases: [string, (sc: ScenarioInput) => void, RegExp][] = [
      ['version de format', (sc) => void ((sc as { formatVersion: number }).formatVersion = 2), /formatVersion/],
      ['matériel inconnu', (sc) => void (sc.units[0]!.platformId = 'x-wing'), /matériel inconnu/],
      ['aéronef sans base', (sc) => void delete sc.units[0]!.baseId, /rattaché à une base/],
      ['identifiant en double', (sc) => void (sc.units[1]!.id = sc.units[0]!.id), /en double/],
      ['groupe inconnu', (sc) => void (sc.units[0]!.groupId = 'fantome'), /groupe inconnu/],
      ['groupe adverse', (sc) => void (sc.units[0]!.groupId = 'red-esc-1'), /autre camp/],
      ['doctrine inconnue', (sc) => void (sc.sides.RED.doctrineId = 'nope'), /doctrine inconnue/],
      ['seuils qui se chevauchent', (sc) => void (sc.objective.challengerWinsBelowMin = 70), /se chevauchent/],
      ['seuil supérieur à la durée', (sc) => void (sc.objective.defenderWinsAtMin = 200), /supérieur à la durée/],
      ['unité hors région', (sc) => void (sc.units[6]!.pos = { lat: 10, lon: 10 }), /hors de la région/],
      ['mission pour une unité adverse', (sc) => void (sc.missions[0]!.unitIds = ['red-aew']), /autre camp/],
      ['mission incompatible', (sc) => void (sc.missions[0]!.unitIds = ['blue-raf-1']), /ne peut pas effectuer/],
      ['paramètre de règle inconnu', (sc) => void (sc.rules = { vitesseLumiere: 3 }), /paramètre inconnu/],
      ['date invalide', (sc) => void (sc.date = 'demain'), /date/],
      ['renseignement sur soi-même', (sc) => void (sc.intel[0]!.unitId = 'blue-sam'), /camp renseigné/],
      ['patrouille hors zone', (sc) => void (sc.units[7]!.patrol = [{ lat: 70, lon: -20 }]), /zone de manœuvre/],
      ['équipage hors bornes', (sc) => void (sc.units[0]!.crew = 3), /crew/],
    ];
    for (const [label, mutate, pattern] of cases) {
      const res = parseScenario(variant(mutate));
      expect(res.ok, label).toBe(false);
      if (!res.ok) expect(res.errors.join(' | '), label).toMatch(pattern);
    }
    expect(parseScenario(null).ok).toBe(false);
    expect(parseScenario({}).ok).toBe(false);
  });
});

describe('mise en place', () => {
  it('la difficulté ne change ni les forces ni les stocks de l’IA', () => {
    const forces = (difficulty: 'recrue' | 'veteran') => {
      const s = createInitialState(BOUCLIER_ATLANTIQUE, { playerSide: 'BLUE', difficulty, seed: 5 });
      return hashState({ units: s.units, bases: s.bases, platforms: s.platforms, rules: s.rules });
    };
    expect(forces('recrue')).toBe(forces('veteran'));
  });

  it('la mission proposée au joueur est ignorée quand son camp est confié à l’IA', () => {
    const human = freshState('BLUE');
    const ai = freshState('RED');
    expect(Object.values(human.missions).some((m) => m.name === 'CAP-01' && m.side === 'BLUE')).toBe(true);
    expect(Object.values(ai.missions).some((m) => m.type === 'CAP' && m.side === 'BLUE')).toBe(false);
    expect(human.ai.BLUE).toBeNull();
    expect(human.ai.RED).toMatchObject({ role: 'challenger' });
    expect(ai.ai.BLUE).toMatchObject({ role: 'defender' });
  });

  it('chaque camp reçoit son propre briefing', () => {
    const s = freshState();
    const briefings = s.events.filter((e) => e.code === 'TRIGGER_MESSAGE');
    expect(briefings).toHaveLength(2);
    expect(briefings.every((e) => e.vis.length === 1)).toBe(true);
  });
});

describe('objectifs et déclencheurs', () => {
  it('le contrôle du secteur suit la présence des chasseurs et reste acquis quand le secteur est vide', () => {
    const s = freshState();
    const o = s.objective;
    const place = (id: string, inSector: boolean) => {
      const u = s.units[id]!;
      u.status = inSector ? 'airborne' : 'ready';
      u.pos = inSector ? { ...o.center } : { ...s.bases[u.baseId!]!.pos };
      u.altM = inSector ? 9000 : 0;
    };
    // On n'exécute que l'objectif, pour isoler la règle.
    const objective = SYSTEMS[SYSTEMS.length - 3]!;
    const tick = () => {
      s.time += 1;
      objective(s);
    };

    tick();
    expect(o.status).toBe('BLUE'); // vide : acquis au défenseur
    place('red-su-1', true);
    tick();
    expect(o.status).toBe('RED');
    place('blue-raf-1', true);
    tick();
    expect(o.status).toBe('CONTESTED');
    place('red-su-1', false);
    place('blue-raf-1', false);
    tick();
    expect(o.status).toBe('RED'); // vide : acquis au dernier détenteur
    s.units['red-su-2']!.weapons = 0;
    place('red-su-2', true);
    place('blue-raf-1', true);
    tick();
    expect(o.status).toBe('BLUE'); // un chasseur sans munitions ne compte pas
    expect(o.sec.BLUE + o.sec.RED + o.sec.CONTESTED).toBe(s.time);
    expect(o.timeline.map((x) => x.status)).toEqual(['BLUE', 'RED', 'CONTESTED', 'RED', 'BLUE']);
  });

  it('le contrôle perçu ne dépend que des pistes du camp', () => {
    const s = freshState();
    const objective = SYSTEMS[SYSTEMS.length - 3]!;
    const red = s.units['red-su-1']!;
    red.status = 'airborne';
    red.pos = { ...s.objective.center };
    red.altM = 9000;
    s.time += 1;
    objective(s);
    expect(s.objective.status).toBe('RED');
    // BLEU n'a aucune piste : il croit toujours tenir le secteur.
    expect(s.objective.perceived.BLUE.status).toBe('BLUE');
    expect(s.events.some((e) => e.code === 'CONTROL_CHANGED' && e.vis.length > 0)).toBe(false);
  });

  it('un hostile dont le dommage a été constaté ne compte plus dans le contrôle perçu', () => {
    const s = freshState();
    const objective = SYSTEMS[SYSTEMS.length - 3]!;
    const red = s.units['red-su-1']!;
    red.status = 'airborne';
    red.pos = { ...s.objective.center };
    red.altM = 9000;
    const c = observe(s, 'BLUE', red, true);
    const tick = () => {
      s.time += 1;
      c.lastSeen = s.time;
      objective(s);
    };
    tick();
    expect(s.objective.perceived.BLUE.status).toBe('RED');
    // Retour d'un chasseur bleu, puis coup au but observé sur le chasseur rouge.
    const blue = s.units['blue-raf-1']!;
    blue.status = 'airborne';
    blue.pos = { ...s.objective.center };
    tick();
    expect(s.objective.perceived.BLUE.status).toBe('CONTESTED');
    red.damaged = true;
    c.damaged = true;
    tick();
    expect(s.objective.status).toBe('BLUE');
    expect(s.objective.perceived.BLUE.status).toBe('BLUE');
  });

  it('applique les seuils de victoire à la fin de la période', () => {
    const outcome = (blueMinutes: number) => {
      const s = freshState();
      s.time = s.endTime - 1;
      s.objective.sec.BLUE = blueMinutes * 60 - 1;
      s.objective.sec.RED = s.time - s.objective.sec.BLUE;
      stepState(s, SYSTEMS.slice(-3, -2));
      return s.outcome!;
    };
    expect(outcome(60)).toMatchObject({ winner: 'BLUE', reason: 'time', level: 'major' });
    expect(outcome(59)).toMatchObject({ winner: 'DRAW', level: 'draw' });
    expect(outcome(45)).toMatchObject({ winner: 'DRAW' });
    expect(outcome(44)).toMatchObject({ winner: 'RED', reason: 'time' });
  });

  it('exécute les déclencheurs une seule fois : message, groupe indisponible, fin de mission', () => {
    const custom = parseScenario(
      variant((sc) => {
        sc.triggers.push({
          id: 'fin-anticipee',
          condition: { type: 'LOSSES_AT_LEAST', side: 'RED', kind: 'fighter', count: 2 },
          actions: [{ type: 'END_MISSION', winner: 'BLUE' }],
        });
      }),
    );
    expect(custom.ok).toBe(true);
    if (!custom.ok) return;
    const session = createSession(custom.scenario, { playerSide: 'BLUE', seed: 9 });
    const s = session.state;

    for (const id of ['blue-raf-1', 'blue-raf-2', 'blue-raf-3', 'blue-raf-4']) s.units[id]!.status = 'destroyed';
    stepSession(session, 3);
    const messages = s.events.filter((e) => e.code === 'TRIGGER_MESSAGE' && String(e.p.text).includes('Escadron A'));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.vis).toEqual(['BLUE']);
    expect(s.outcome).toBeNull();

    s.stats.RED.losses.fighter = 2;
    stepSession(session, 1);
    expect(s.outcome).toMatchObject({ winner: 'BLUE', reason: 'attrition' });
    const t = s.time;
    stepSession(session, 10);
    expect(s.time).toBe(t); // la simulation ne progresse plus après la fin
    expect(s.events.filter((e) => e.code === 'MISSION_END')).toHaveLength(1);
  });

  it('annonce la mi-parcours à l’heure dite', () => {
    const session = createSession(BOUCLIER_ATLANTIQUE, { playerSide: null, seed: 4 });
    stepSession(session, 45 * 60 + 1);
    const e = session.state.events.find((x) => x.code === 'TRIGGER_MESSAGE' && String(x.p.text).startsWith('Mi-parcours'));
    expect(e?.t).toBe(45 * 60);
  });
});
