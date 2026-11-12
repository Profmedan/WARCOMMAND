'use client';

/**
 * Compte rendu après action et mode observateur.
 *
 * C'est le seul écran qui montre la vérité-terrain des deux camps : il n'est accessible
 * qu'une fois la mission terminée.
 */
import { useEffect, useMemo, useState } from 'react';
import { clockZ, SIDES, type ControlStatus, type SideId, type SimState } from '@warcommand/simulation-core';
import { buildAar, createReplayCursor, recordingOf, type ReplayCursor } from '@warcommand/replay-engine';
import { MapView } from '../world-map/MapView';
import { ALL_DOMAINS, boundsOf, DEFAULT_LAYERS, sceneFromTruth } from '../world-map/scene';
import { downloadJson, type GameController } from './controller';
import { CONTROL_LABEL, describeAiDecision, formatEvent, formatMinutes, POSTURE_LABEL, RESULT_LABEL, SIDE_LABEL, STATUS_LABEL, WEAPON_LABEL } from './i18n';

interface Props {
  controller: GameController;
  onBack: () => void;
  onQuit: () => void;
  quitLabel: string;
  onRestart: (seed: number) => void;
}

type Tab = 'bilan' | 'observateur' | 'tirs' | 'ia' | 'journal';

const TABS: [Tab, string][] = [
  ['bilan', 'Bilan'],
  ['observateur', 'Observateur'],
  ['tirs', 'Tirs'],
  ['ia', 'Décisions de l’IA'],
  ['journal', 'Journal complet'],
];

const tone = (s: ControlStatus) => (s === 'BLUE' ? 'blue' : s === 'RED' ? 'red' : 'amber');
const tons = (kg: number) => `${(kg / 1000).toFixed(1).replace('.', ',')} t`;
const REASON: Record<string, string> = { time: 'fin de la période', attrition: 'attrition', trigger: 'événement de scénario' };
const LEVEL: Record<string, string> = { major: 'victoire majeure', minor: 'victoire mineure', draw: 'résultat indécis' };

function Observer({ controller }: { controller: GameController }) {
  const [cursor, setCursor] = useState<ReplayCursor | null>(null);
  const [t, setT] = useState(controller.time);
  const [playing, setPlaying] = useState(false);
  const scenario = controller.session.scenario;
  const startIso = controller.session.state.startIso;

  // La préparation re-simule toute la partie : on la diffère pour laisser l'écran s'afficher.
  useEffect(() => {
    const id = setTimeout(() => setCursor(createReplayCursor(recordingOf(controller.session))), 30);
    return () => clearTimeout(id);
  }, [controller]);

  useEffect(() => {
    if (!playing || !cursor) return;
    const id = setInterval(() => {
      setT((v) => {
        if (v >= cursor.endTime) {
          setPlaying(false);
          return v;
        }
        return Math.min(cursor.endTime, v + 20);
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, cursor]);

  const fit = useMemo(() => boundsOf([...scenario.bases.map((b) => b.pos), scenario.objective.center]), [scenario]);
  const state: SimState | null = useMemo(() => (cursor ? cursor.stateAt(t) : null), [cursor, t]);
  const scene = useMemo(() => (state ? sceneFromTruth(state, { layers: DEFAULT_LAYERS, domains: ALL_DOMAINS }) : null), [state]);

  if (!cursor || !state || !scene) return <p className="muted">Préparation du rejeu : la partie est re-simulée à partir de la graine et de vos ordres…</p>;

  const o = state.objective;
  return (
    <div className="observer">
      <div className="observer__bar">
        <button type="button" className="btn" onClick={() => (t >= cursor.endTime ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))}>
          {playing ? 'Pause' : t >= cursor.endTime ? 'Revoir depuis le début' : 'Lecture'}
        </button>
        <input type="range" min={0} max={cursor.endTime} step={10} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Instant observé" />
        <strong>{clockZ(startIso, t)} Z</strong>
        <span>
          Contrôle réel : <b className={`txt--${tone(o.status)}`}>{CONTROL_LABEL[o.status]}</b> · BLEU {formatMinutes(o.sec.BLUE)} · ROUGE {formatMinutes(o.sec.RED)} · contesté {formatMinutes(o.sec.CONTESTED)}
        </span>
      </div>
      <div className="observer__map">
        <MapView scene={scene} view={{ center: scenario.region.center, zoom: scenario.region.zoom }} fit={fit} picking={false} showGraticule />
      </div>
      <p className="muted">Vérité-terrain des deux camps, reconstituée par re-simulation déterministe : aucune position n’est enregistrée, tout est recalculé.</p>
    </div>
  );
}

export function Debrief({ controller, onBack, onQuit, quitLabel, onRestart }: Props) {
  const state = controller.session.state;
  const aar = useMemo(() => buildAar(state), [state]);
  const [tab, setTab] = useState<Tab>('bilan');
  const outcome = aar.outcome;
  const player = controller.playerSide;
  const ctx = { startIso: state.startIso, sectorName: state.objective.name };
  const at = (t: number) => clockZ(state.startIso, t);

  const headline = !outcome ? 'Mission en cours' : outcome.winner === 'DRAW' ? 'Résultat indécis' : `Victoire ${SIDE_LABEL[outcome.winner] === 'BLEU' ? 'BLEUE' : 'ROUGE'}`;
  const verdict = !outcome ? '' : outcome.winner === 'DRAW' ? 'Aucun camp n’atteint son seuil.' : outcome.winner === player ? 'Vous l’emportez.' : 'Vous êtes battu.';
  const total = Math.max(1, aar.elapsedSec);
  const rows: [string, (s: SideId) => string | number][] = [
    ['Sorties', (s) => aar.sides[s].stats.sorties],
    ['Tirs', (s) => aar.sides[s].stats.shotsFired],
    ['Dont tirs air-surface', (s) => aar.sides[s].stats.asmFired],
    ['Coups au but', (s) => aar.sides[s].stats.hits],
    ['Destructions obtenues', (s) => aar.sides[s].stats.kills],
    ['Chasseurs perdus', (s) => aar.sides[s].stats.losses.fighter],
    ['Autres pertes', (s) => aar.sides[s].stats.losses.aew + aar.sides[s].stats.losses.tanker + aar.sides[s].stats.losses.drone + aar.sides[s].stats.losses.ship + aar.sides[s].stats.losses.sam],
    ['Appareils endommagés', (s) => aar.sides[s].stats.damaged],
    ['Carburant consommé', (s) => tons(aar.sides[s].stats.fuelBurnedKg)],
    ['Carburant ravitaillé en vol', (s) => tons(aar.sides[s].stats.fuelTransferredKg)],
    ['Commandement', (s) => (aar.sides[s].controlledByAi ? 'IA' : 'Vous')],
  ];

  return (
    <div className="debrief">
      <header className="debrief__head">
        <div>
          <p className="sheet__eyebrow">Compte rendu après action · {controller.session.scenario.title}</p>
          <h1 className={outcome && outcome.winner !== 'DRAW' ? `txt--${tone(outcome.winner)}` : ''}>{headline}</h1>
          <p>
            {verdict} {outcome ? `${LEVEL[outcome.level]} · ${REASON[outcome.reason]} à ${at(outcome.endedAt)} Z` : ''}
          </p>
        </div>
        <div className="debrief__actions">
          <button type="button" className="btn btn--primary" onClick={() => onRestart(state.seed)}>
            Rejouer (même graine)
          </button>
          <button type="button" className="btn" onClick={() => onRestart(Math.floor(Math.random() * 1_000_000_000))}>
            Rejouer (nouvelle graine)
          </button>
          <button type="button" className="btn" onClick={() => downloadJson(`war-command-compte-rendu-${state.seed}.json`, aar)}>
            Exporter le compte rendu
          </button>
          <button type="button" className="btn" onClick={() => downloadJson(`war-command-enregistrement-${state.seed}.json`, recordingOf(controller.session))}>
            Exporter l’enregistrement
          </button>
          <button type="button" className="btn" onClick={onBack}>
            Revoir la carte finale
          </button>
          <button type="button" className="btn btn--ghost" onClick={onQuit}>
            {quitLabel}
          </button>
        </div>
      </header>

      <div className="tabs tabs--big" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="debrief__body">
        {tab === 'bilan' ? (
          <>
            <section className="card">
              <h2>Contrôle réel du secteur</h2>
              <div className="controlbar" role="img" aria-label="Chronologie du contrôle du secteur">
                {aar.controlTimeline
                  .filter((seg) => seg.to > seg.from)
                  .map((seg) => (
                    <span key={seg.from} className={`controlbar__seg bg--${tone(seg.status)}`} style={{ width: `${(100 * (seg.to - seg.from)) / total}%` }} title={`${at(seg.from)} → ${at(seg.to)} Z : ${CONTROL_LABEL[seg.status]}`} />
                  ))}
              </div>
              <div className="controlbar__axis">
                <span>{at(0)} Z</span>
                <span>{at(aar.elapsedSec)} Z</span>
              </div>
              <p>
                <b className="txt--blue">BLEU {formatMinutes(aar.controlSec.BLUE)}</b> · <b className="txt--red">ROUGE {formatMinutes(aar.controlSec.RED)}</b> ·{' '}
                <b className="txt--amber">contesté {formatMinutes(aar.controlSec.CONTESTED)}</b>
              </p>
              <p className="muted">
                Seuils : le défenseur ({SIDE_LABEL[aar.defender]}) l’emporte à partir de {formatMinutes(aar.defenderWinsAtSec)} de contrôle ; le challenger
                l’emporte si le défenseur en totalise moins de {formatMinutes(aar.challengerWinsBelowSec)}.
              </p>
              <p className="muted">
                Pendant la partie, vos capteurs vous donnaient : BLEU {formatMinutes(aar.sides[player].perceivedSec.BLUE)} · ROUGE{' '}
                {formatMinutes(aar.sides[player].perceivedSec.RED)} · contesté {formatMinutes(aar.sides[player].perceivedSec.CONTESTED)}.
              </p>
            </section>

            <section className="card">
              <h2>Bilan des deux camps</h2>
              <table className="table table--static">
                <thead>
                  <tr>
                    <th />
                    {SIDES.map((s) => (
                      <th key={s} className={`txt--${tone(s)}`}>
                        {aar.sides[s].name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, value]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {SIDES.map((s) => (
                        <td key={s}>{value(s)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card card--wide">
              <h2>État final des unités</h2>
              <div className="twocol">
                {SIDES.map((s) => (
                  <table key={s} className="table table--static">
                    <thead>
                      <tr>
                        <th className={`txt--${tone(s)}`}>{SIDE_LABEL[s]}</th>
                        <th>Matériel</th>
                        <th>État</th>
                        <th>Carburant</th>
                        <th>Missiles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aar.sides[s].units.map((u) => (
                        <tr key={u.name} className={u.status === 'destroyed' ? 'is-done' : ''}>
                          <td>{u.name}</td>
                          <td>{u.platform}</td>
                          <td>
                            {STATUS_LABEL[u.status]}
                            {u.damaged && u.status !== 'destroyed' && u.status !== 'maintenance' ? ' · endommagé' : ''}
                          </td>
                          <td>{u.fuelPct === null ? '—' : `${u.fuelPct} %`}</td>
                          <td>{u.weapons}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
              <p className="muted">
                Graine {aar.seed} · empreinte d’état {aar.hash}. Rejouer avec la même graine et les mêmes ordres reproduit cette partie à l’identique.
              </p>
            </section>
          </>
        ) : null}

        {tab === 'observateur' ? (
          <section className="card card--wide">
            <Observer controller={controller} />
          </section>
        ) : null}

        {tab === 'tirs' ? (
          <section className="card card--wide">
            <h2>Résolution de chaque tir</h2>
            <p className="muted">
              Un tir touche si le tirage est inférieur à la probabilité. En air-air et sol-air, celle-ci dépend de la distance de tir, de
              l’entraînement du tireur, de l’autoprotection et du type de la cible, et surtout de la surprise : une cible qui ne suivait pas le
              tireur est bien plus vulnérable. En air-surface, elle dépend de la distance, du tireur, de la défense rapprochée d’un bâtiment et de
              la fraîcheur du renseignement. Valeurs de jeu, pas des performances réelles.
            </p>
            {aar.shots.length === 0 ? <p>Aucun tir n’a été résolu.</p> : null}
            {aar.shots.length > 0 ? (
              <table className="table table--static">
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th>Tireur</th>
                    <th>Cible</th>
                    <th>Arme</th>
                    <th>Probabilité</th>
                    <th>Tirage</th>
                    <th>Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {aar.shots.map((x, i) => (
                    <tr key={i} className={x.result === 'miss' ? 'is-done' : ''}>
                      <td>{at(x.t)} Z</td>
                      <td>{x.shooter}</td>
                      <td>{x.target}</td>
                      <td>{WEAPON_LABEL[x.weapon] ?? x.weapon}</td>
                      <td>{x.pk.toFixed(2).replace('.', ',')}</td>
                      <td>{x.roll.toFixed(2).replace('.', ',')}</td>
                      <td>{RESULT_LABEL[x.result] ?? x.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        ) : null}

        {tab === 'ia' ? (
          <section className="card card--wide">
            <h2>Ce que l’IA a décidé, et pourquoi</h2>
            <p className="muted">
              L’IA ne reçoit que l’image de son camp. À chaque choix, elle compare des utilités ; les valeurs retenues figurent ci-dessous, aléa de
              difficulté compris.
            </p>
            {SIDES.filter((s) => aar.sides[s].controlledByAi).map((s) => (
              <div key={s}>
                <h3 className={`txt--${tone(s)}`}>
                  IA {SIDE_LABEL[s]} — {aar.sides[s].name}
                </h3>
                <ol className="decisions">
                  {aar.sides[s].aiDecisions.map((d, i) => (
                    <li key={i}>
                      <time>{at(d.t)} Z</time>
                      <span className={`tag tag--${d.level === 'strategic' ? 'c1' : 'est'}`}>{d.level === 'strategic' ? 'stratégique' : 'opératif'}</span>
                      <span>{describeAiDecision(d.code, d.p)}</span>
                      {Object.keys(d.utilities).length > 0 ? (
                        <small>
                          {Object.entries(d.utilities)
                            .sort((a, b) => b[1] - a[1])
                            .map(([k, v]) => `${POSTURE_LABEL[k] ?? describeStation(k)} ${v.toFixed(2).replace('.', ',')}`)
                            .join(' · ')}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        ) : null}

        {tab === 'journal' ? (
          <section className="card card--wide">
            <h2>Journal complet (les deux camps et l’arbitre)</h2>
            <div className="journal journal--tall">
              {aar.events.map((e, i) => {
                const line = formatEvent(e, ctx);
                const who = e.vis.length === 0 ? 'arbitre' : e.vis.length === 2 ? 'tous' : SIDE_LABEL[e.vis[0]!];
                return (
                  <p key={i} className={`tone--${line.tone}`}>
                    <time>{at(e.t)}</time> <span className={`who who--${e.vis.length === 1 ? tone(e.vis[0]!) : 'none'}`}>{who}</span> {line.text}
                  </p>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function describeStation(key: string): string {
  const names: Record<string, string> = { center: 'centre', back: 'arrière', forward: 'avant', left: 'flanc gauche', right: 'flanc droit' };
  return names[key] ?? key;
}
