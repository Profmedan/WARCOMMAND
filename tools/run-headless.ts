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
 *   pnpm sim --analyse             ajoute l'analyse des opérations (tirs, chaîne d'engagement, missions, moments clés)
 *   pnpm sim --rejeux 12           rejoue la partie avec douze autres tirages et dit si le résultat tient
 *   pnpm sim --record partie.json  écrit l'enregistrement de la partie, à revoir dans le jeu (« Revoir un enregistrement »)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { clockZ, GROUND_FORCE_KINDS, hashState, NAVAL_KINDS, type Difficulty, type SimEvent } from '@warcommand/simulation-core';
import { createSession, runToEnd, SCENARIOS, type Scenario } from '@warcommand/scenario-system';
import { checkScenario, importScenarioJson } from '@warcommand/mission-editor';
import { analyzeRecording, buildAar, recordingOf, rerunSeeds, rerunWithSeed, summarizeReruns } from '@warcommand/replay-engine';

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
    // Bilan interarmées : seulement si le camp a engagé des formations terrestres ou des bâtiments.
    const groundLost = GROUND_FORCE_KINDS.reduce((n, kind) => n + st.losses[kind], 0);
    const shipsLost = NAVAL_KINDS.reduce((n, kind) => n + st.losses[kind], 0);
    if (side.units.some((u) => GROUND_FORCE_KINDS.includes(u.kind) || NAVAL_KINDS.includes(u.kind))) {
      console.log(
        `    à terre : ${st.landStrengthLost.toFixed(1)} formation d'effectifs perdus, ${groundLost} formations détruites · ` +
          `en mer : ${shipsLost} bâtiments perdus, ${st.ssmFired} missiles antinavires, ${st.torpedoesFired} torpilles · ${st.effectsUsed} effets multi-domaines`,
      );
    }
    for (const d of side.aiDecisions) {
      console.log(`    ${clockZ(s.startIso, d.t)} ${d.level === 'strategic' ? 'STRAT' : 'OPER '} ${d.code} ${JSON.stringify(d.p)} ${Object.keys(d.utilities).length ? JSON.stringify(d.utilities) : ''}`);
    }
  }
  console.log(`Événements : ${s.events.length} · empreinte d'état ${hashState(s)} · ${ms.toFixed(0)} ms de calcul`);

  const recording = recordingOf(session);
  const camp = (side: string) => (side === 'BLUE' ? 'BLEU ' : 'ROUGE');
  const at = (t: number) => clockZ(s.startIso, Math.max(0, t));

  if (flag('analyse')) {
    const a = analyzeRecording(recording);
    console.log('\nAnalyse des opérations');
    console.log('  Tirs — camp, arme : tirs, coups au but (attendus), destructions');
    for (const l of a.engagements) console.log(`    ${camp(l.side)} ${l.weapon.padEnd(7)} : ${l.shots} tirs, ${l.hits} au but (${l.expectedHits.toFixed(1)} attendus), ${l.kills} destructions`);
    for (const id of ['BLUE', 'RED'] as const) {
      const m = a.chainMedians[id];
      const sec = (v: number | null) => (v === null ? '—' : `${Math.round(v)} s`);
      console.log(`  Chaîne d'engagement ${camp(id)} : détection → premier tir ${sec(m.detectToShotS)} · premier tir → destruction ${sec(m.shotToKillS)} (médianes)`);
    }
    console.log('  Missions — départ, temps sur zone, tirs, coups au but, pertes');
    for (const m of a.missions) {
      console.log(`    ${camp(m.side)} ${m.name.padEnd(10)} ${m.type.padEnd(7)} ${m.launchedAt === null ? 'non partie' : at(m.launchedAt)}  ${minutes(m.onStationS)} min  ${m.shots} tirs  ${m.hits} au but  ${m.lost} perdus`);
    }
    console.log('  Moments clés');
    for (const m of a.keyMoments) console.log(`    ${at(m.t)} ${m.kind.padEnd(8)} ${m.side ? camp(m.side) : '     '} ${JSON.stringify(m.p)}`);
  }

  const reruns = arg('rejeux');
  if (reruns) {
    const results = rerunSeeds(seed, Number(reruns)).map((other) => rerunWithSeed(recording, other));
    const sum = summarizeReruns(results, s.outcome);
    console.log(`\nPart du hasard — ${sum.runs} rejeux avec d'autres tirages : BLEU ${sum.wins.BLUE} · ROUGE ${sum.wins.RED} · indécis ${sum.wins.DRAW}`);
    console.log(`  Même vainqueur que la partie : ${sum.sameAsOriginal} sur ${sum.runs} · contrôle du défenseur (min) : ${minutes(sum.defenderControlSec.min).trim()} à ${minutes(sum.defenderControlSec.max).trim()}, médiane ${minutes(sum.defenderControlSec.median).trim()}`);
  }

  const out = arg('record');
  if (out) {
    writeFileSync(out, JSON.stringify(recording, null, 2));
    console.log(`\nEnregistrement écrit : ${out}`);
  }
}
