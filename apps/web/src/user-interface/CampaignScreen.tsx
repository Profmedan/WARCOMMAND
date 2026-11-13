'use client';

/**
 * Écran de campagne : où en est la campagne, ce que les missions passées reportent sur la prochaine,
 * et le lancement de la mission en cours.
 */
import { useMemo, useState } from 'react';
import { SIDES, type SideId } from '@warcommand/simulation-core';
import { SCENARIOS, type Scenario } from '@warcommand/scenario-system';
import { campaignStanding, getCampaign, prepareMission, type CarryNote, type PreparedMission } from '@warcommand/campaign-system';
import type { SaveGame } from '@warcommand/replay-engine';
import { getPlatform, hasPlatform } from '@warcommand/unit-database';
import { campaignFileName, type CampaignSlot } from './campaignStore';
import { downloadJson } from './controller';
import { DIFFICULTY_LABEL, formatMinutes, SIDE_LABEL } from './i18n';

interface Props {
  slot: CampaignSlot;
  /** Lance la mission en cours ; `resume` : la sauvegarde de la mission interrompue, à reprendre. */
  onPlay: (prepared: PreparedMission, wegoTurnMin: number, resume: SaveGame | null) => void;
  onQuit: () => void;
}

const lookup = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);
const LEVEL: Record<string, string> = { major: 'victoire majeure', minor: 'victoire mineure', draw: 'résultat indécis' };
const tone = (side: SideId) => (side === 'BLUE' ? 'blue' : 'red');
const platformName = (id: string) => (hasPlatform(id) ? getPlatform(id).name : id);

function noteText(note: CarryNote): string {
  switch (note.kind) {
    case 'shortfall':
      return `${note.missing} ${platformName(note.platformId)} manquant${note.missing > 1 ? 's' : ''} sur ${note.planned} : vos pertes ne sont pas encore toutes remplacées.`;
    case 'stock':
      return `Stocks de ${note.munition === 'aam' ? 'missiles air-air' : 'munitions air-surface'} de vos bases réduits à ${note.pct} % : la réserve du théâtre est entamée.`;
    case 'experience':
      return `Équipages aguerris par vos victoires : entraînement relevé de ${note.pct} points.`;
  }
}

export function CampaignScreen({ slot, onPlay, onQuit }: Props) {
  const { state, inProgress } = slot;
  const def = getCampaign(state.campaignId);
  const [wegoTurnMin, setWegoTurnMin] = useState(0);
  const prepared = useMemo(() => (def && state.current !== null ? prepareMission(def, state, lookup) : null), [def, state]);

  if (!def) {
    return (
      <main className="menu">
        <p className="error">Campagne inconnue : {state.campaignId}.</p>
        <button type="button" className="btn" onClick={onQuit}>
          Revenir au menu
        </button>
      </main>
    );
  }

  const standing = campaignStanding(def, state);
  const me = state.playerSide;
  const enemy: SideId = me === 'BLUE' ? 'RED' : 'BLUE';
  // La mission interrompue ne se reprend que si elle est bien celle que la campagne attend.
  const resumable = prepared?.ok && inProgress && inProgress.recording.scenario.id === prepared.scenario.id && inProgress.recording.options.seed === prepared.options.seed ? inProgress : null;
  const notes = prepared?.ok ? prepared.notes.filter((n) => n.side === me) : [];
  const shortfall = Object.entries(state.shortfall[me]);

  const headline = !standing.finished
    ? 'Campagne en cours'
    : standing.verdict === 'DRAW'
      ? 'Campagne indécise'
      : standing.verdict === me
        ? 'Campagne gagnée'
        : 'Campagne perdue';

  return (
    <main className="menu campaign">
      <header className="menu__head">
        <div>
          <h1>{def.title}</h1>
          <p>
            Camp {SIDE_LABEL[me]} · IA {DIFFICULTY_LABEL[state.difficulty]} · graine {state.seed}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => downloadJson(campaignFileName(state), state)} title="L’état de la campagne ; une mission interrompue n’est pas comprise">
            Exporter la campagne
          </button>
          <button type="button" className="btn btn--ghost" onClick={onQuit}>
            Revenir au menu
          </button>
        </div>
      </header>

      <div className="menu__grid">
        <section className="card">
          <h2>{headline}</h2>
          <div className="tiles">
            {SIDES.map((side) => (
              <div key={side} className="tile">
                <span>
                  <span className={`dotkey bg--${tone(side)}`} /> Points {SIDE_LABEL[side]}
                  {side === me ? ' (vous)' : ''}
                </span>
                <strong>{standing.points[side]}</strong>
              </div>
            ))}
          </div>
          <p className="muted">Victoire majeure : 3 points · victoire mineure : 2 · résultat indécis : 1 chacun. La campagne revient au camp qui en totalise le plus.</p>

          <h2>Déroulement</h2>
          <ol className="acts">
            {def.missions.map((m) => {
              const record = state.history.find((r) => r.missionId === m.id);
              const current = state.current === m.id;
              return (
                <li key={m.id} className={record ? 'is-played' : current ? 'is-current' : 'is-waiting'}>
                  <strong>{m.title}</strong>
                  <small>
                    {record
                      ? record.winner === 'DRAW'
                        ? 'Résultat indécis'
                        : `${SIDE_LABEL[record.winner]} l’emporte — ${LEVEL[record.level]}`
                      : current
                        ? 'Mission en cours'
                        : state.history.length > 0 && state.current === null
                          ? 'Non jouée : la campagne a pris un autre cours'
                          : 'À venir, selon l’issue des missions précédentes'}
                  </small>
                </li>
              );
            })}
          </ol>

          <h2>Vos moyens</h2>
          <dl className="facts">
            <div>
              <dt>Réserve de missiles air-air</dt>
              <dd>{state.reserves[me].aam}</dd>
            </div>
            <div>
              <dt>Réserve de munitions air-surface</dt>
              <dd>{state.reserves[me].asm}</dd>
            </div>
            <div>
              <dt>Aéronefs manquants</dt>
              <dd>{shortfall.length === 0 ? 'aucun' : shortfall.map(([id, n]) => `${n} × ${platformName(id)}`).join(' · ')}</dd>
            </div>
            <div>
              <dt>Expérience des équipages</dt>
              <dd>{state.experience[me] > 0 ? `+${Math.round(state.experience[me] * 100)} points d’entraînement` : 'sans changement'}</dd>
            </div>
          </dl>
          <p className="muted">
            Entre deux missions, un aéronef perdu sur deux est remplacé, la réserve reçoit {def.carry.resupply[me].aam} missiles air-air et {def.carry.resupply[me].asm} munitions
            air-surface, et les équipages du vainqueur progressent. Ce sont des règles de jeu, sans prétention de réalisme. Les moyens du camp {SIDE_LABEL[enemy]} ne vous sont pas connus.
          </p>
        </section>

        <section className="card">
          {state.current === null ? (
            <>
              <h2>Bilan</h2>
              <h3>{headline}</h3>
              <p>
                {standing.played} mission{standing.played > 1 ? 's' : ''} jouée{standing.played > 1 ? 's' : ''} · BLEU {standing.points.BLUE} points · ROUGE {standing.points.RED} points.
              </p>
            </>
          ) : prepared && prepared.ok ? (
            <>
              <h2>Mission suivante</h2>
              <h3>{prepared.mission.title}</h3>
              <p>{prepared.mission.intro}</p>
              <p className="briefing">{prepared.scenario.sides[me].briefing}</p>
              <dl className="facts">
                <div>
                  <dt>Durée</dt>
                  <dd>{prepared.scenario.durationMin} min</dd>
                </div>
                <div>
                  <dt>Défenseur</dt>
                  <dd>{SIDE_LABEL[prepared.scenario.objective.defender]}</dd>
                </div>
              </dl>
              <h2>Ce que la campagne reporte sur cette mission</h2>
              {notes.length === 0 ? <p className="muted">Rien : vous abordez la mission avec la dotation prévue.</p> : null}
              <ul className="notes">
                {notes.map((n, i) => (
                  <li key={i}>{noteText(n)}</li>
                ))}
              </ul>
              <label className="field">
                <span>Gestion du temps</span>
                <select className="input" value={wegoTurnMin} onChange={(e) => setWegoTurnMin(Number(e.target.value))} disabled={resumable !== null}>
                  <option value={0}>Temps continu, avec pause</option>
                  <option value={5}>Par tours de 5 minutes (ordres simultanés)</option>
                  <option value={10}>Par tours de 10 minutes (ordres simultanés)</option>
                </select>
              </label>
              {resumable ? (
                <>
                  <button type="button" className="btn btn--primary btn--wide" onClick={() => onPlay(prepared, wegoTurnMin, resumable)}>
                    Reprendre la mission interrompue
                  </button>
                  <button type="button" className="btn" onClick={() => onPlay(prepared, wegoTurnMin, null)}>
                    Recommencer la mission depuis le début
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--primary btn--wide" onClick={() => onPlay(prepared, wegoTurnMin, null)}>
                  Lancer la mission
                </button>
              )}
            </>
          ) : (
            <>
              <h2>Mission suivante</h2>
              <ul className="error">{prepared && !prepared.ok ? prepared.errors.map((e) => <li key={e}>{e}</li>) : null}</ul>
            </>
          )}
        </section>

        <section className="card card--wide">
          <h2>Missions jouées</h2>
          {state.history.length === 0 ? <p className="muted">Aucune mission jouée pour l’instant.</p> : null}
          {state.history.length > 0 ? (
            <table className="table table--static">
              <thead>
                <tr>
                  <th>Mission</th>
                  <th>Issue</th>
                  <th>Points BLEU · ROUGE</th>
                  <th>Aéronefs perdus BLEU · ROUGE</th>
                  <th>Missiles air-air consommés BLEU · ROUGE</th>
                  <th>Contrôle BLEU · ROUGE · contesté</th>
                </tr>
              </thead>
              <tbody>
                {state.history.map((r) => {
                  const lost = (side: SideId) => Object.values(r.aircraftLost[side]).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={r.missionId}>
                      <td>{def.missions.find((m) => m.id === r.missionId)?.title ?? r.missionId}</td>
                      <td>{r.winner === 'DRAW' ? 'Indécis' : `${SIDE_LABEL[r.winner]} — ${LEVEL[r.level]}`}</td>
                      <td>
                        {r.points.BLUE} · {r.points.RED}
                      </td>
                      <td>
                        {lost('BLUE')} · {lost('RED')}
                      </td>
                      <td>
                        {r.expended.BLUE.aam} · {r.expended.RED.aam}
                      </td>
                      <td>
                        {formatMinutes(r.controlSec.BLUE)} · {formatMinutes(r.controlSec.RED)} · {formatMinutes(r.controlSec.CONTESTED)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </section>
      </div>
    </main>
  );
}
