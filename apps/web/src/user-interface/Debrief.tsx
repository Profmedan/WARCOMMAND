'use client';

/**
 * Compte rendu après action : bilan, analyse des opérations, rejeu détaillé, tirs, décisions de l'IA, journal.
 *
 * C'est le seul écran qui montre la vérité-terrain des deux camps : il n'est accessible
 * qu'une fois la mission terminée.
 */
import { useMemo, useState } from 'react';
import { clockZ, GROUND_FORCE_KINDS, NAVAL_KINDS, SIDES, type ControlStatus, type SideId, type UnitKind } from '@warcommand/simulation-core';
import type { Session } from '@warcommand/scenario-system';
import { buildAar, recordingOf, type AarUnit } from '@warcommand/replay-engine';
import { Analysis } from './Analysis';
import { downloadJson } from './controller';
import { CONTROL_LABEL, describeAiDecision, formatEvent, formatMinutes, POSTURE_LABEL, RESULT_LABEL, SIDE_LABEL, SOF_PHASE_LABEL, STATUS_LABEL, WEAPON_LABEL } from './i18n';
import { Replay } from './Replay';

interface Props {
  /** Partie terminée, vérité-terrain comprise. */
  session: Session;
  /** Camp que tenait le joueur ; `null` pour une partie entre IA ou un enregistrement revu en spectateur. */
  playerSide: SideId | null;
  /** Retour à la carte finale ; absent quand il n'y a pas d'écran de jeu derrière. */
  onBack?: () => void;
  onQuit: () => void;
  quitLabel: string;
  /** Rejouer la mission ; absent en campagne, à deux joueurs et pour un enregistrement revu. */
  onRestart?: (seed: number) => void;
}

type Tab = 'bilan' | 'analyse' | 'rejeu' | 'tirs' | 'ia' | 'journal';

const TABS: [Tab, string][] = [
  ['bilan', 'Bilan'],
  ['analyse', 'Analyse'],
  ['rejeu', 'Rejeu'],
  ['tirs', 'Tirs'],
  ['ia', 'Décisions de l’IA'],
  ['journal', 'Journal complet'],
];

const tone = (s: ControlStatus) => (s === 'BLUE' ? 'blue' : s === 'RED' ? 'red' : 'amber');
const tons = (kg: number) => `${(kg / 1000).toFixed(1).replace('.', ',')} t`;
const REASON: Record<string, string> = { time: 'fin de la période', attrition: 'attrition', trigger: 'événement de scénario' };
const LEVEL: Record<string, string> = { major: 'Victoire majeure', minor: 'Victoire mineure', draw: 'Résultat indécis' };
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** État final d'une unité : son statut, précisé par ce qui lui est propre (effectifs, coque, phase). */
function finalState(u: AarUnit): string {
  if (u.status === 'destroyed') return u.strengthPct !== null ? 'Détruite' : u.sofPhase !== null ? 'Perdue' : STATUS_LABEL.destroyed;
  if (u.sofPhase !== null) return capital(SOF_PHASE_LABEL[u.sofPhase]);
  if (u.strengthPct !== null) return `${u.status === 'embarked' ? 'À bord' : STATUS_LABEL[u.status]} · effectifs ${u.strengthPct} %`;
  if (u.hull !== null) return `${STATUS_LABEL[u.status]} · coque ${u.hull.left}/${u.hull.of}`;
  return `${STATUS_LABEL[u.status]}${u.damaged && u.status !== 'maintenance' ? ' · endommagé' : ''}`;
}

export function Debrief({ session, playerSide, onBack, onQuit, quitLabel, onRestart }: Props) {
  const state = session.state;
  const aar = useMemo(() => buildAar(state), [state]);
  const [tab, setTab] = useState<Tab>('bilan');
  const outcome = aar.outcome;
  const player = playerSide;
  const ctx = { startIso: state.startIso, sectorName: state.objective.name };
  const at = (t: number) => clockZ(state.startIso, t);

  const headline = !outcome ? 'Mission en cours' : outcome.winner === 'DRAW' ? 'Résultat indécis' : `Victoire ${SIDE_LABEL[outcome.winner] === 'BLEU' ? 'BLEUE' : 'ROUGE'}`;
  const verdict = !outcome ? '' : outcome.winner === 'DRAW' ? 'Aucun camp n’atteint son seuil.' : player === null ? '' : outcome.winner === player ? 'Vous l’emportez.' : 'Vous êtes battu.';
  const total = Math.max(1, aar.elapsedSec);
  const lost = (s: SideId, kinds: readonly UnitKind[]) => kinds.reduce((n, kind) => n + aar.sides[s].stats.losses[kind], 0);
  const present = (kinds: readonly UnitKind[]) => SIDES.some((s) => aar.sides[s].units.some((u) => kinds.includes(u.kind)));
  const rows: [string, (s: SideId) => string | number][] = [
    ['Sorties', (s) => aar.sides[s].stats.sorties],
    ['Tirs', (s) => aar.sides[s].stats.shotsFired],
    ['Dont tirs air-surface', (s) => aar.sides[s].stats.asmFired],
    ['Coups au but', (s) => aar.sides[s].stats.hits],
    ['Destructions obtenues', (s) => aar.sides[s].stats.kills],
    ['Chasseurs perdus', (s) => aar.sides[s].stats.losses.fighter],
    ['Autres appareils et sites sol-air perdus', (s) => lost(s, ['aew', 'tanker', 'drone', 'sam'])],
    ['Appareils endommagés', (s) => aar.sides[s].stats.damaged],
    ['Carburant consommé', (s) => tons(aar.sides[s].stats.fuelBurnedKg)],
    ['Carburant ravitaillé en vol', (s) => tons(aar.sides[s].stats.fuelTransferredKg)],
  ];
  // Les lignes terrestres, navales et multi-domaines n'apparaissent que si le scénario engage ces composantes.
  if (present(GROUND_FORCE_KINDS)) {
    rows.push(
      ['Formations terrestres détruites', (s) => lost(s, GROUND_FORCE_KINDS)],
      ['Effectifs perdus à terre', (s) => `${aar.sides[s].stats.landStrengthLost.toFixed(1).replace('.', ',')} formation`],
    );
  }
  if (present(NAVAL_KINDS)) {
    rows.push(
      ['Bâtiments perdus', (s) => lost(s, NAVAL_KINDS)],
      ['Missiles antinavires tirés', (s) => aar.sides[s].stats.ssmFired],
      ['Torpilles tirées', (s) => aar.sides[s].stats.torpedoesFired],
    );
  }
  if (SIDES.some((s) => aar.sides[s].stats.effectsUsed > 0)) rows.push(['Effets multi-domaines employés', (s) => aar.sides[s].stats.effectsUsed]);
  rows.push(['Commandement', (s) => (aar.sides[s].controlledByAi ? 'IA' : s === player ? 'Vous' : player === null ? 'Joueur' : 'Votre adversaire')]);

  return (
    <div className="debrief">
      <header className="debrief__head">
        <div>
          <p className="sheet__eyebrow">Compte rendu après action · {session.scenario.title}</p>
          <h1 className={outcome && outcome.winner !== 'DRAW' ? `txt--${tone(outcome.winner)}` : ''}>{headline}</h1>
          <p>
            {verdict} {outcome ? `${LEVEL[outcome.level]} · ${REASON[outcome.reason]} à ${at(outcome.endedAt)} Z` : ''}
          </p>
        </div>
        <div className="debrief__actions">
          {onRestart ? (
            <>
              <button type="button" className="btn btn--primary" onClick={() => onRestart(state.seed)}>
                Rejouer (même graine)
              </button>
              <button type="button" className="btn" onClick={() => onRestart(Math.floor(Math.random() * 1_000_000_000))}>
                Rejouer (nouvelle graine)
              </button>
            </>
          ) : null}
          <button type="button" className="btn" onClick={() => downloadJson(`war-command-compte-rendu-${state.seed}.json`, aar)}>
            Exporter le compte rendu
          </button>
          <button type="button" className="btn" onClick={() => downloadJson(`war-command-enregistrement-${state.seed}.json`, recordingOf(session))} title="Fichier à relire plus tard depuis le menu : « Revoir un enregistrement »">
            Exporter l’enregistrement
          </button>
          {onBack ? (
            <button type="button" className="btn" onClick={onBack}>
              Revoir la carte finale
            </button>
          ) : null}
          <button type="button" className={`btn${onRestart ? ' btn--ghost' : ' btn--primary'}`} onClick={onQuit}>
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
              {player ? (
                <p className="muted">
                  Pendant la partie, vos capteurs vous donnaient : BLEU {formatMinutes(aar.sides[player].perceivedSec.BLUE)} · ROUGE{' '}
                  {formatMinutes(aar.sides[player].perceivedSec.RED)} · contesté {formatMinutes(aar.sides[player].perceivedSec.CONTESTED)}.
                </p>
              ) : null}
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
                          <td>{finalState(u)}</td>
                          <td>{u.fuelPct === null ? '—' : `${u.fuelPct} %`}</td>
                          <td>{u.strengthPct !== null || u.sofPhase !== null ? '—' : u.weapons}</td>
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

        {tab === 'analyse' ? <Analysis session={session} /> : null}

        {tab === 'rejeu' ? (
          <section className="card card--wide">
            <Replay session={session} />
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
