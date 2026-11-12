/**
 * Exécute le scénario de démonstration sans navigateur, IA contre IA.
 *
 *   pnpm sim                       une partie avec la graine du scénario
 *   pnpm sim --seed 42             une partie avec la graine 42
 *   pnpm sim --campaign 20         vingt parties (graines 1 à 20) et leur bilan
 *   pnpm sim --difficulty veteran  difficulté de l'IA (recrue, standard, veteran)
 *   pnpm sim --journal             affiche le journal complet (vue observateur)
 *   pnpm sim --scenario breche-boreale   choisit le scénario (par défaut : bouclier-atlantique)
 *   pnpm sim --file mon-scenario.json    joue un scénario exporté par l'éditeur de missions
 */
import { readFileSync } from 'node:fs';
import { clockZ, hashState, type Difficulty, type SimEvent } from '@warcommand/simulation-core';
import { createSession, runToEnd, SCENARIOS, type Scenario } from '@warcommand/scenario-system';
import { checkScenario, importScenarioJson } from '@warcommand/mission-editor';
import { buildAar } from '@warcommand/replay-engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Lit et vérifie un scénario exporté par l'éditeur ; quitte avec les motifs s'il n'est pas jouable. */
function scenarioFromFile(path: string): Scenario {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error(`Fichier illisible : ${path}`);
    process.exit(1);
  }
  const imported = importScenarioJson(text);
  if (!imported.ok) {
    console.error(`Scénario refusé :\n- ${imported.errors.join('\n- ')}`);
    process.exit(1);
  }
  const check = checkScenario(imported.scenario);
  if (check.errors.length > 0) {
    console.error(`Scénario injouable :\n- ${check.errors.join('\n- ')}`);
    process.exit(1);
  }
  for (const warning of check.warnings) console.log(`Avertissement — ${warning}`);
  return imported.scenario;
}

function shippedScenario(id: string): Scenario {
  const found = SCENARIOS.find((sc) => sc.id === id);
  if (!found) {
    console.error(`Scénario inconnu : ${id}. Disponibles : ${SCENARIOS.map((sc) => sc.id).join(', ')}`);
    process.exit(1);
  }
  return found;
}

const file = arg('file');
const SCENARIO = file ? scenarioFromFile(file) : shippedScenario(arg('scenario') ?? SCENARIOS[0]!.id);
const difficulty = (arg('difficulty') ?? SCENARIO.difficulty) as Difficulty;
const minutes = (sec: number) => (sec / 60).toFixed(1).padStart(5);

function play(seed: number) {
  const session = createSession(SCENARIO, { playerSide: null, seed, difficulty });
  const started = performance.now();
  runToEnd(session);
  return { session, aar: buildAar(session.state), ms: performance.now() - started };
}

function line(e: SimEvent, startIso: string): string {
  const who = e.vis.length === 0 ? 'OBS ' : e.vis.length === 2 ? 'TOUS' : e.vis[0] === 'BLUE' ? 'BLEU' : 'ROUGE';
  return `${clockZ(startIso, e.t)} [${who.padEnd(5)}] ${e.code} ${JSON.stringify(e.p)}`;
}

const campaign = arg('campaign');
if (campaign) {
  const n = Number(campaign);
  const tally: Record<string, number> = { BLUE: 0, RED: 0, DRAW: 0 };
  console.log(`Campagne de ${n} parties IA contre IA — « ${SCENARIO.title} », difficulté ${difficulty}\n`);
  console.log('graine  vainqueur  fin         BLEU   ROUGE  cont.   pertes B/R  tirs B/R');
  for (let seed = 1; seed <= n; seed++) {
    const { aar, session } = play(seed);
    const o = aar.outcome!;
    tally[o.winner] = (tally[o.winner] ?? 0) + 1;
    console.log(
      `${String(seed).padStart(6)}  ${o.winner.padEnd(9)}  ${o.reason.padEnd(10)} ${minutes(aar.controlSec.BLUE)}  ${minutes(aar.controlSec.RED)}  ${minutes(aar.controlSec.CONTESTED)}   ` +
        `${aar.sides.BLUE.stats.losses.fighter}/${aar.sides.RED.stats.losses.fighter}         ${aar.sides.BLUE.stats.shotsFired}/${aar.sides.RED.stats.shotsFired}` +
        `   ${clockZ(session.state.startIso, o.endedAt)}`,
    );
  }
  console.log(`\nBilan : BLEU ${tally.BLUE} — ROUGE ${tally.RED} — indécis ${tally.DRAW}`);
} else {
  const seed = Number(arg('seed') ?? SCENARIO.seed);
  const { session, aar, ms } = play(seed);
  const s = session.state;
  const o = aar.outcome!;
  if (flag('journal')) {
    for (const e of s.events) console.log(line(e, s.startIso));
    console.log('');
  }
  console.log(`« ${SCENARIO.title} » — IA contre IA, graine ${seed}, difficulté ${difficulty}`);
  console.log(`Résultat : ${o.winner} (${o.level}, fin par ${o.reason}) à ${clockZ(s.startIso, o.endedAt)} Z`);
  console.log(`Contrôle du secteur (minutes) : BLEU ${minutes(aar.controlSec.BLUE)} · ROUGE ${minutes(aar.controlSec.RED)} · contesté ${minutes(aar.controlSec.CONTESTED)}`);
  for (const id of ['BLUE', 'RED'] as const) {
    const side = aar.sides[id];
    const st = side.stats;
    console.log(
      `${side.name} : ${st.sorties} sorties, ${st.shotsFired} tirs, ${st.hits} coups au but, ${st.kills} destructions, ` +
        `${st.losses.fighter} chasseurs perdus, ${st.damaged} endommagés, ${Math.round(st.fuelBurnedKg / 1000)} t de carburant, ` +
        `${Math.round(st.fuelTransferredKg / 1000)} t ravitaillées`,
    );
    for (const d of side.aiDecisions) {
      console.log(`    ${clockZ(s.startIso, d.t)} ${d.level === 'strategic' ? 'STRAT' : 'OPER '} ${d.code} ${JSON.stringify(d.p)} ${Object.keys(d.utilities).length ? JSON.stringify(d.utilities) : ''}`);
    }
  }
  console.log(`Événements : ${s.events.length} · empreinte d'état ${hashState(s)} · ${ms.toFixed(0)} ms de calcul`);
}
