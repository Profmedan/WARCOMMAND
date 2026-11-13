'use client';

/**
 * Analyse approfondie des opérations (onglet du compte rendu).
 *
 * Tout ce qui s'affiche ici est recalculé par re-simulation de la partie et lit la vérité-terrain :
 * l'écran n'est accessible qu'une fois la mission terminée.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { clockZ, SIDES, type SideId } from '@warcommand/simulation-core';
import type { Session } from '@warcommand/scenario-system';
import { analyzeRecording, recordingOf, rerunSeeds, rerunWithSeed, summarizeReruns, type OperationsAnalysis, type RangeBandId, type RerunResult } from '@warcommand/replay-engine';
import { CHART_COLOR, Legend, LineChart, ShareBar, type ChartSeries } from './charts';
import { describeMoment, formatMinutes, KIND_LABEL, MISSION_STATUS_LABEL, MISSION_TYPE_LABEL, SIDE_LABEL, WEAPON_LABEL } from './i18n';

const RERUNS = 12;
const BAND_LABEL: Record<RangeBandId, string> = { near: 'Moins d’un tiers de la portée', mid: 'D’un à deux tiers', far: 'Au-delà des deux tiers' };
const fr = (value: number, digits = 1) => value.toFixed(digits).replace('.', ',');
const rate = (hits: number, shots: number) => (shots > 0 ? `${Math.round((100 * hits) / shots)} %` : '—');
const duration = (sec: number | null) => (sec === null ? '—' : sec < 120 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`);
const tone = (side: SideId) => (side === 'BLUE' ? 'blue' : 'red');

function Sensitivity({ session }: { session: Session }) {
  const [results, setResults] = useState<RerunResult[]>([]);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);
  const recording = useMemo(() => recordingOf(session), [session]);
  const state = session.state;

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = () => {
    const seeds = rerunSeeds(recording.options.seed, RERUNS);
    setResults([]);
    setRunning(true);
    // Un rejeu par passage dans la boucle d'événements : l'écran reste réactif et montre l'avancement.
    const next = (i: number, done: RerunResult[]) => {
      if (cancelled.current) return;
      if (i >= seeds.length) {
        setRunning(false);
        return;
      }
      const all = [...done, rerunWithSeed(recording, seeds[i]!)];
      setResults(all);
      setTimeout(() => next(i + 1, all), 0);
    };
    setTimeout(() => next(0, []), 30);
  };

  const summary = results.length > 0 ? summarizeReruns(results, state.outcome) : null;
  const defender = state.objective.defender;
  const original = state.outcome;

  return (
    <section className="card card--wide">
      <h2>Part du hasard</h2>
      <p className="muted">
        La partie est rejouée {RERUNS} fois avec d’autres tirages : mêmes forces, mêmes ordres aux mêmes instants. Si le résultat tient, il doit plus
        au plan qu’à la chance. Limite : vos ordres ne s’adaptent pas à la nouvelle situation ; ceux qu’elle rend irrecevables sont ignorés et comptés.
      </p>
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={run} disabled={running}>
          {running ? `Rejeu ${results.length} / ${RERUNS}…` : results.length > 0 ? 'Rejouer la série' : `Rejouer ${RERUNS} fois avec d’autres tirages`}
        </button>
      </div>
      {summary ? (
        <>
          <ShareBar
            label="Vainqueur des rejeux"
            parts={[
              { key: 'BLUE', label: 'Victoires BLEU', value: summary.wins.BLUE, color: CHART_COLOR.BLUE },
              { key: 'DRAW', label: 'Résultats indécis', value: summary.wins.DRAW, color: CHART_COLOR.NEUTRAL },
              { key: 'RED', label: 'Victoires ROUGE', value: summary.wins.RED, color: CHART_COLOR.RED },
            ]}
          />
          <div className="tiles">
            <div className="tile">
              <span>Même vainqueur que la partie</span>
              <strong>
                {summary.sameAsOriginal} sur {summary.runs}
              </strong>
            </div>
            <div className="tile">
              <span>Contrôle du défenseur ({SIDE_LABEL[defender]}), médiane</span>
              <strong>{formatMinutes(summary.defenderControlSec.median)}</strong>
            </div>
            <div className="tile">
              <span>Du plus faible au plus fort</span>
              <strong>
                {formatMinutes(summary.defenderControlSec.min)} – {formatMinutes(summary.defenderControlSec.max)}
              </strong>
            </div>
            <div className="tile">
              <span>Dans la partie jouée</span>
              <strong>{formatMinutes(state.objective.sec[defender])}</strong>
            </div>
          </div>
          {summary.refusedOrders > 0 ? (
            <p className="muted">
              {summary.refusedOrders} ordre{summary.refusedOrders > 1 ? 's' : ''} n’{summary.refusedOrders > 1 ? 'ont' : 'a'} pas pu être rejoué{summary.refusedOrders > 1 ? 's' : ''} (piste absente,
              appareil perdu) : ces rejeux s’écartent d’autant de votre plan.
            </p>
          ) : null}
          <details className="chart__table">
            <summary>Détail des rejeux</summary>
            <table className="table table--static">
              <thead>
                <tr>
                  <th>Graine</th>
                  <th>Vainqueur</th>
                  <th>Contrôle du défenseur</th>
                  <th>Pertes BLEU</th>
                  <th>Pertes ROUGE</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.seed} className={original && r.winner !== original.winner ? 'is-done' : ''}>
                    <td>{r.seed}</td>
                    <td>{r.winner === 'DRAW' ? 'Indécis' : SIDE_LABEL[r.winner]}</td>
                    <td>{formatMinutes(r.defenderControlSec)}</td>
                    <td>{r.losses.BLUE}</td>
                    <td>{r.losses.RED}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : null}
    </section>
  );
}

export function Analysis({ session }: { session: Session }) {
  const [analysis, setAnalysis] = useState<OperationsAnalysis | null>(null);
  const state = session.state;

  // L'analyse re-simule toute la partie : on la diffère pour laisser l'écran s'afficher.
  useEffect(() => {
    const id = setTimeout(() => setAnalysis(analyzeRecording(recordingOf(session))), 30);
    return () => clearTimeout(id);
  }, [session]);

  if (!analysis) {
    return (
      <section className="card card--wide">
        <p className="muted">Analyse en cours : la partie est re-simulée à partir de la graine et des ordres…</p>
      </section>
    );
  }

  const clock = (t: number) => clockZ(state.startIso, t, false);
  const at = (t: number) => `${clockZ(state.startIso, Math.max(0, t))} Z`;
  const pair = (pick: (side: SideId) => (number | null)[]): ChartSeries[] => SIDES.map((side) => ({ key: side, label: SIDE_LABEL[side], color: CHART_COLOR[side], values: pick(side) }));
  const whole = (v: number) => String(Math.round(v));
  const hasLand = SIDES.some((side) => analysis.sides[side].landStrength.some((v) => v > 0));
  const hasHull = SIDES.some((side) => analysis.sides[side].hull.some((v) => v > 0));
  const lines = [...analysis.engagements].sort((a, b) => a.side.localeCompare(b.side) || b.shots - a.shots);
  const missions = analysis.missions.filter((m) => m.launchedAt !== null || m.status !== 'cancelled');

  return (
    <>
      <section className="card card--wide">
        <h2>Rapport de forces dans le temps</h2>
        <Legend items={SIDES.map((side) => ({ label: `${SIDE_LABEL[side]} — ${state.sideNames[side]}`, color: CHART_COLOR[side] }))} />
        <div className="charts">
          <LineChart title="Chasseurs disponibles" note="Ni détruits ni en réparation" times={analysis.times} series={pair((s) => analysis.sides[s].fightersAvailable)} clock={clock} format={whole} />
          <LineChart title="Chasseurs en vol" note="Appareils en l’air à cet instant" times={analysis.times} series={pair((s) => analysis.sides[s].fightersAirborne)} clock={clock} format={whole} />
          <LineChart
            title="Qualité de l’image"
            note="Part des unités adverses en opération tenues en piste fraîche"
            times={analysis.times}
            series={pair((s) => analysis.sides[s].awareness.map((v) => (v === null ? null : v * 100)))}
            clock={clock}
            format={(v) => `${Math.round(v)} %`}
            max={100}
          />
          {hasLand ? (
            <LineChart title="Effectifs à terre" note="Somme des effectifs des formations, en équivalents de formation" times={analysis.times} series={pair((s) => analysis.sides[s].landStrength)} clock={clock} format={(v) => fr(v)} />
          ) : null}
          {hasHull ? <LineChart title="Coque des bâtiments" note="Points de coque des bâtiments à flot" times={analysis.times} series={pair((s) => analysis.sides[s].hull)} clock={clock} format={whole} /> : null}
        </div>
        <p className="muted">Survolez une courbe, ou parcourez-la aux flèches du clavier, pour lire les valeurs à un instant ; chaque graphique a son tableau.</p>
      </section>

      <section className="card">
        <h2>Efficacité des tirs</h2>
        {lines.length === 0 ? <p>Aucun tir n’a été résolu.</p> : null}
        {lines.length > 0 ? (
          <>
            <table className="table table--static">
              <thead>
                <tr>
                  <th>Camp</th>
                  <th>Arme</th>
                  <th>Tirs</th>
                  <th>Coups au but</th>
                  <th>Attendus</th>
                  <th>Écart</th>
                  <th>Destructions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const gap = l.hits - l.expectedHits;
                  return (
                    <tr key={`${l.side}-${l.weapon}`}>
                      <td>
                        <span className={`dotkey bg--${tone(l.side)}`} /> {SIDE_LABEL[l.side]}
                      </td>
                      <td>{WEAPON_LABEL[l.weapon] ?? l.weapon}</td>
                      <td>{l.shots}</td>
                      <td>{l.hits}</td>
                      <td>{fr(l.expectedHits)}</td>
                      <td>{`${gap >= 0 ? '+' : '−'}${fr(Math.abs(gap))}`}</td>
                      <td>{l.kills}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted">
              « Attendus » : somme des probabilités de chaque tir, c’est-à-dire ce que le hasard devait donner en moyenne. Un écart positif est de la
              réussite, un écart négatif de la malchance. Valeurs de jeu, pas des performances réelles.
            </p>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Distance de tir et surprise</h2>
        <table className="table table--static">
          <thead>
            <tr>
              <th>Distance de tir</th>
              {SIDES.map((side) => (
                <th key={side}>
                  <span className={`dotkey bg--${tone(side)}`} /> {SIDE_LABEL[side]} : tirs · au but
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['near', 'mid', 'far'] as const).map((band, i) => (
              <tr key={band}>
                <th scope="row">{BAND_LABEL[band]}</th>
                {SIDES.map((side) => {
                  const b = analysis.ranges[side][i]!;
                  return (
                    <td key={side}>
                      {b.shots} · {b.hits} ({rate(b.hits, b.shots)})
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row">Air-air et sol-air, cible alertée</th>
              {SIDES.map((side) => {
                const a = analysis.alert[side].aware;
                return (
                  <td key={side}>
                    {a.shots} · {a.hits} ({rate(a.hits, a.shots)})
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row">Air-air et sol-air, cible surprise</th>
              {SIDES.map((side) => {
                const a = analysis.alert[side].surprised;
                return (
                  <td key={side}>
                    {a.shots} · {a.hits} ({rate(a.hits, a.shots)})
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <p className="muted">Une cible est « alertée » quand son camp tenait une piste fraîche sur le tireur au moment du tir.</p>
      </section>

      <section className="card card--wide">
        <h2>Chaîne d’engagement</h2>
        <div className="tiles">
          {SIDES.map((side) => (
            <div key={side} className="tile">
              <span>
                <span className={`dotkey bg--${tone(side)}`} /> {SIDE_LABEL[side]} : de la détection au premier tir (médiane)
              </span>
              <strong>{duration(analysis.chainMedians[side].detectToShotS)}</strong>
            </div>
          ))}
          {SIDES.map((side) => (
            <div key={side} className="tile">
              <span>
                <span className={`dotkey bg--${tone(side)}`} /> {SIDE_LABEL[side]} : du premier tir à la destruction (médiane)
              </span>
              <strong>{duration(analysis.chainMedians[side].shotToKillS)}</strong>
            </div>
          ))}
        </div>
        {analysis.killChains.length === 0 ? <p>Aucune destruction n’a été obtenue par un tir.</p> : null}
        {analysis.killChains.length > 0 ? (
          <table className="table table--static">
            <thead>
              <tr>
                <th>Détruit par</th>
                <th>Cible</th>
                <th>Détectée</th>
                <th>Identifiée</th>
                <th>Premier tir</th>
                <th>Détruite</th>
              </tr>
            </thead>
            <tbody>
              {analysis.killChains.map((c, i) => (
                <tr key={i}>
                  <td>
                    <span className={`dotkey bg--${tone(c.killer)}`} /> {SIDE_LABEL[c.killer]}
                  </td>
                  <td>
                    {c.target} ({KIND_LABEL[c.kind]})
                  </td>
                  <td>{c.detectedAt === null ? '—' : c.detectedAt < 0 ? 'renseignement initial' : at(c.detectedAt)}</td>
                  <td>{c.identifiedAt === null ? '—' : at(c.identifiedAt)}</td>
                  <td>{at(c.firstShotAt)}</td>
                  <td>{at(c.destroyedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="card card--wide">
        <h2>Missions aériennes</h2>
        {missions.length === 0 ? <p>Aucune mission aérienne.</p> : null}
        {missions.length > 0 ? (
          <table className="table table--static">
            <thead>
              <tr>
                <th>Camp</th>
                <th>Mission</th>
                <th>Type</th>
                <th>Appareils</th>
                <th>Départ</th>
                <th>Temps sur zone</th>
                <th>Tirs</th>
                <th>Au but</th>
                <th>Destructions</th>
                <th>Pertes</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => (
                <tr key={`${m.side}-${m.name}`} className={m.launchedAt === null ? 'is-done' : ''}>
                  <td>
                    <span className={`dotkey bg--${tone(m.side)}`} /> {SIDE_LABEL[m.side]}
                  </td>
                  <td>{m.name}</td>
                  <td>{MISSION_TYPE_LABEL[m.type]}</td>
                  <td>{m.aircraft}</td>
                  <td>{m.launchedAt === null ? 'non partie' : at(m.launchedAt)}</td>
                  <td>{m.onStationS > 0 ? formatMinutes(m.onStationS) : '—'}</td>
                  <td>{m.shots}</td>
                  <td>{m.hits}</td>
                  <td>{m.kills}</td>
                  <td>{m.lost}</td>
                  <td>{MISSION_STATUS_LABEL[m.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="card card--wide">
        <h2>Moments clés</h2>
        <ol className="moments">
          {analysis.keyMoments.map((m, i) => (
            <li key={i}>
              <time>{at(m.t)}</time>
              <span className={`dotkey ${m.side ? `bg--${tone(m.side)}` : 'bg--amber'}`} />
              <span>{describeMoment(m.kind, m.side, m.p)}</span>
            </li>
          ))}
        </ol>
      </section>

      <Sensitivity session={session} />
    </>
  );
}
