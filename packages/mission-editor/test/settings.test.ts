import { describe, expect, it } from 'vitest';
import type { Scenario } from '@warcommand/scenario-system';
import { addBase, addUnit, checkScenario, createBlankScenario, setMeta, setObjective, setRegion, setSide, type EditResult } from '../src/index';

function ok(result: EditResult): Scenario {
  if (!result.ok) throw new Error(`édition refusée : ${result.error}`);
  return result.draft;
}

function small(): Scenario {
  let d = createBlankScenario({ title: 'Essai', seed: 7 });
  d = ok(addBase(d, { side: 'BLUE', pos: { lat: 65.28, lon: -14.4 } }));
  d = ok(addBase(d, { side: 'RED', pos: { lat: 70.95, lon: -8.6 } }));
  d = ok(addUnit(d, { side: 'BLUE', platformId: 'rafale', pos: { lat: 65.28, lon: -14.4 } }));
  d = ok(addUnit(d, { side: 'RED', platformId: 'su35s', pos: { lat: 70.95, lon: -8.6 } }));
  return ok(setObjective(d, { center: { lat: 67, lon: -11 }, radiusKm: 110 }));
}

describe('réglages généraux', () => {
  it('modifie titre, description, date, durée, météo, graine et difficulté', () => {
    const d = ok(
      setMeta(small(), {
        title: 'Verrou du Nord',
        description: 'Un autre scénario.',
        date: '2032-06-01T04:00:00Z',
        period: 'Fictive',
        durationMin: 120,
        weatherLabel: 'Brume',
        sensorFactor: 0.7,
        seed: 99,
        difficulty: 'veteran',
        regionName: 'Grand Nord',
      }),
    );
    expect(d).toMatchObject({ title: 'Verrou du Nord', description: 'Un autre scénario.', date: '2032-06-01T04:00:00Z', period: 'Fictive', durationMin: 120, seed: 99, difficulty: 'veteran' });
    expect(d.weather).toEqual({ label: 'Brume', sensorFactor: 0.7 });
    expect(d.region.name).toBe('Grand Nord');
    // L'identifiant du scénario ne change pas quand on le renomme.
    expect(d.id).toBe('essai');
    expect(checkScenario(d).errors).toEqual([]);
  });

  it('refuse les valeurs incohérentes, en disant pourquoi', () => {
    const d = small();
    const cases: [Parameters<typeof setMeta>[1], RegExp][] = [
      [{ title: '   ' }, /titre/],
      [{ description: '' }, /description/],
      [{ date: 'demain matin' }, /[Dd]ate/],
      [{ durationMin: 0 }, /durée/],
      [{ durationMin: 2000 }, /durée/],
      // Le défenseur doit pouvoir atteindre son seuil (60 min) dans la durée.
      [{ durationMin: 50 }, /seuil/],
      [{ sensorFactor: 2 }, /météo/],
      [{ seed: -4 }, /graine/],
      [{ seed: 1.5 }, /graine/],
    ];
    for (const [patch, pattern] of cases) {
      const res = setMeta(d, patch);
      expect(res.ok, JSON.stringify(patch)).toBe(false);
      if (!res.ok) expect(res.error).toMatch(pattern);
    }
  });
});

describe('région', () => {
  const wide = { bounds: { west: -30, south: 58, east: 10, north: 76 }, center: { lat: 67, lon: -10 }, zoom: 4 };

  it('recadre la région quand tout ce qui est posé y tient', () => {
    const d = ok(setRegion(small(), wide));
    expect(d.region).toMatchObject(wide);
    expect(d.region.name).toBe('Région du scénario');
    expect(checkScenario(d).errors).toEqual([]);
  });

  it('refuse une région qui laisserait dehors une base, une unité ou l’objectif, et les nomme', () => {
    const res = setRegion(small(), { bounds: { west: -20, south: 64, east: -5, north: 69 }, center: { lat: 66, lon: -12 }, zoom: 5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Base rouge 1/);
  });

  it('refuse une emprise retournée ou un centre hors de l’emprise', () => {
    const d = small();
    expect(setRegion(d, { ...wide, bounds: { west: 10, south: 58, east: -30, north: 76 } }).ok).toBe(false);
    expect(setRegion(d, { ...wide, center: { lat: 20, lon: 0 } }).ok).toBe(false);
  });
});

describe('coalitions', () => {
  it('modifie nom, doctrine, réglages de doctrine, règles d’engagement et briefing', () => {
    const d = ok(
      setSide(small(), 'RED', {
        name: 'Coalition ORANGE',
        doctrineId: 'equilibre-ludique',
        doctrineOverrides: { masse: 0.9 },
        defaultRoe: 'free',
        briefing: 'Tenez bon.',
      }),
    );
    expect(d.sides.RED).toMatchObject({ name: 'Coalition ORANGE', doctrineId: 'equilibre-ludique', doctrineOverrides: { masse: 0.9 }, defaultRoe: 'free', briefing: 'Tenez bon.' });
    expect(d.sides.BLUE.name).toBe('Coalition BLEUE');
    expect(checkScenario(d).errors).toEqual([]);
  });

  it('règle le comportement initial de l’IA, et efface la durée quand la posture est retirée', () => {
    let d = ok(setSide(small(), 'RED', { aiInitialPosture: 'WITHDRAW', aiPostureLockMin: 20 }));
    expect(d.sides.RED).toMatchObject({ aiInitialPosture: 'WITHDRAW', aiPostureLockMin: 20 });
    expect(checkScenario(d).errors).toEqual([]);
    d = ok(setSide(d, 'RED', { aiInitialPosture: null }));
    expect(d.sides.RED).toMatchObject({ aiInitialPosture: null, aiPostureLockMin: 0 });
    expect(checkScenario(d).errors).toEqual([]);
  });

  it('refuse un nom vide, un réglage de doctrine hors bornes, une durée de maintien absurde', () => {
    const d = small();
    expect(setSide(d, 'BLUE', { name: ' ' }).ok).toBe(false);
    expect(setSide(d, 'BLUE', { doctrineOverrides: { tempo: 1.2 } }).ok).toBe(false);
    expect(setSide(d, 'BLUE', { aiPostureLockMin: -5 }).ok).toBe(false);
  });

  it('laisse la vérification signaler une doctrine inconnue ou une posture inadaptée au rôle', () => {
    const unknown = ok(setSide(small(), 'BLUE', { doctrineId: 'inconnue' }));
    expect(checkScenario(unknown).errors.some((e) => /doctrine inconnue/.test(e))).toBe(true);
    // BLEU défend : le balayage en masse est une posture de challenger.
    const wrongRole = ok(setSide(small(), 'BLUE', { aiInitialPosture: 'MASS_SWEEP', aiPostureLockMin: 10 }));
    expect(checkScenario(wrongRole).errors.some((e) => /posture/.test(e))).toBe(true);
  });
});

describe('avertissement sur le comportement imposé', () => {
  it('avertit quand l’IA du challenger est retenue au sol pendant tout le scénario', () => {
    const d = small();
    const held = ok(setSide(d, 'RED', { aiInitialPosture: 'WITHDRAW', aiPostureLockMin: d.durationMin }));
    const check = checkScenario(held);
    expect(check.errors).toEqual([]);
    expect(check.warnings.some((w) => /ROUGE est retenue au sol pendant tout le scénario/.test(w))).toBe(true);
  });

  it('ne dit rien si le repli imposé prend fin avant le terme, ou s’il vise le défenseur', () => {
    const d = small();
    const brief = ok(setSide(d, 'RED', { aiInitialPosture: 'WITHDRAW', aiPostureLockMin: 20 }));
    expect(checkScenario(brief).warnings.some((w) => /retenue au sol/.test(w))).toBe(false);
    const defender = ok(setSide(d, 'BLUE', { aiInitialPosture: 'WITHDRAW', aiPostureLockMin: d.durationMin }));
    expect(checkScenario(defender).warnings.some((w) => /retenue au sol/.test(w))).toBe(false);
  });
});

describe('inversion des rôles', () => {
  it('changer de défenseur retire les comportements initiaux imposés à l’IA, qui ne conviennent plus aux nouveaux rôles', () => {
    let d = ok(setSide(small(), 'RED', { aiInitialPosture: 'MASS_SWEEP', aiPostureLockMin: 20 }));
    d = ok(setSide(d, 'BLUE', { aiInitialPosture: 'STANDING_CAP', aiPostureLockMin: 10 }));
    const swapped = ok(setObjective(d, { defender: 'RED' }));
    expect(swapped.objective.defender).toBe('RED');
    expect(swapped.sides.RED).toMatchObject({ aiInitialPosture: null, aiPostureLockMin: 0 });
    expect(swapped.sides.BLUE).toMatchObject({ aiInitialPosture: null, aiPostureLockMin: 0 });
    expect(checkScenario(swapped).errors).toEqual([]);
  });

  it('les autres réglages de l’objectif ne touchent pas aux comportements imposés', () => {
    const d = ok(setSide(small(), 'RED', { aiInitialPosture: 'MASS_SWEEP', aiPostureLockMin: 20 }));
    const moved = ok(setObjective(d, { radiusKm: 120, defender: 'BLUE' }));
    expect(moved.sides.RED).toMatchObject({ aiInitialPosture: 'MASS_SWEEP', aiPostureLockMin: 20 });
  });
});

describe('brouillons enregistrés', () => {
  it('donne un identifiant libre à un nouveau scénario', async () => {
    const { uniqueScenarioId } = await import('../src/index');
    expect(uniqueScenarioId('essai', ['bouclier-atlantique'])).toBe('essai');
    expect(uniqueScenarioId('essai', ['essai'])).toBe('essai-2');
    expect(uniqueScenarioId('essai', ['essai', 'essai-2', 'essai-3'])).toBe('essai-4');
  });

  it('relit un brouillon incomplet (sans unité) tel qu’il a été enregistré', async () => {
    const { readDraft } = await import('../src/index');
    const blank = createBlankScenario({ title: 'En cours', seed: 3 });
    const stored: unknown = JSON.parse(JSON.stringify(blank));
    expect(readDraft(stored)).toEqual(blank);
    // Un scénario complet se relit aussi.
    const full = small();
    expect(readDraft(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });

  it('refuse de relire ce qui n’a pas la forme d’un scénario', async () => {
    const { readDraft } = await import('../src/index');
    expect(readDraft(null)).toBeNull();
    expect(readDraft({ formatVersion: 1, title: 'Bidon' })).toBeNull();
    const broken = JSON.parse(JSON.stringify(small())) as { units: { crew: unknown }[] };
    broken.units[0]!.crew = 'beaucoup';
    expect(readDraft(broken)).toBeNull();
    const wrongVersion = JSON.parse(JSON.stringify(small())) as { formatVersion: number };
    wrongVersion.formatVersion = 3;
    expect(readDraft(wrongVersion)).toBeNull();
  });
});
