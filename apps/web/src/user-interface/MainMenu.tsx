'use client';

import { useEffect, useRef, useState } from 'react';
import { clockZ, SIDES, type Difficulty, type SideId } from '@warcommand/simulation-core';
import { SCENARIOS, type Scenario, type Session } from '@warcommand/scenario-system';
import { loadRecording, replay } from '@warcommand/replay-engine';
import { getPlatform, hasPlatform } from '@warcommand/unit-database';
import { getDoctrine, hasDoctrine } from '@warcommand/doctrine-engine';
import { createBlankScenario, duplicateScenario, importScenarioJson, uniqueScenarioId } from '@warcommand/mission-editor';
import type { NewGameOptions } from './App';
import { deleteSave, downloadJson, listSaves, type StoredSave } from './controller';
import { DIFFICULTY_HELP, DIFFICULTY_LABEL, SIDE_LABEL } from './i18n';
import type { CampaignSlot } from './campaignStore';
import { CampaignCard, NetCard } from './MenuExtras';
import type { RemoteController } from './remote';
import { deleteCustomScenario, listCustomScenarios, saveCustomScenario, scenarioFileName, type CustomScenario } from './scenarioStore';

interface Props {
  onStart: (options: NewGameOptions) => void;
  onLoad: (data: unknown) => string[];
  /** Ouvre l'éditeur. `unsaved` : le scénario n'existe encore nulle part (copie non enregistrée). */
  onEdit: (scenario: Scenario, unsaved: boolean) => void;
  onCampaign: (slot: CampaignSlot) => void;
  /** Le joueur est installé à une table du serveur de parties. */
  onNet: (controller: RemoteController) => void;
  /** Revoir une partie enregistrée : son compte rendu, son analyse et son rejeu. */
  onReview: (session: Session) => void;
}

interface Entry {
  scenario: Scenario;
  /** Scénario personnel, enregistré dans ce navigateur. */
  custom: boolean;
  playable: boolean;
  savedAt?: string;
}

const DIFFICULTIES: Difficulty[] = ['recrue', 'standard', 'veteran'];

function orderOfBattle(scenario: Scenario, side: SideId): string[] {
  const counts = new Map<string, number>();
  for (const u of scenario.units) {
    if (u.side !== side) continue;
    const name = hasPlatform(u.platformId) ? getPlatform(u.platformId).name : u.platformId;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => `${n} × ${name}`);
}

export function MainMenu({ onStart, onLoad, onEdit, onCampaign, onNet, onReview }: Props) {
  const [custom, setCustom] = useState<CustomScenario[]>([]);
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0]!.id);
  const [side, setSide] = useState<SideId>('BLUE');
  const [difficulty, setDifficulty] = useState<Difficulty>(SCENARIOS[0]!.difficulty);
  const [seed, setSeed] = useState<string>(String(SCENARIOS[0]!.seed));
  const [wegoTurnMin, setWegoTurnMin] = useState(0);
  const [saves, setSaves] = useState<StoredSave[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [editorNotice, setEditorNotice] = useState<{ lines: string[]; bad: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const scenarioInput = useRef<HTMLInputElement | null>(null);
  const recordingInput = useRef<HTMLInputElement | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    setSaves(listSaves());
    setCustom(listCustomScenarios());
  }, []);

  const entries: Entry[] = [
    ...SCENARIOS.map((scenario) => ({ scenario, custom: false, playable: true })),
    ...custom.map((c) => ({ scenario: c.scenario, custom: true, playable: c.playable, savedAt: c.savedAt })),
  ];
  const entry = entries.find((e) => e.scenario.id === scenarioId) ?? entries[0]!;
  const scenario = entry.scenario;
  const allIds = entries.map((e) => e.scenario.id);

  const select = (sc: Scenario) => {
    setScenarioId(sc.id);
    setSeed(String(sc.seed));
    setDifficulty(sc.difficulty);
  };

  const seedValue = Number(seed);
  const seedValid = Number.isInteger(seedValue) && seedValue >= 0 && seedValue <= 0xffffffff;
  const end = clockZ(scenario.date, scenario.durationMin * 60, false);

  const importFile = async (file: File) => {
    try {
      setErrors(onLoad(JSON.parse(await file.text())));
    } catch {
      setErrors(['Ce fichier n’est pas un JSON lisible.']);
    }
  };

  /** Relit un enregistrement exporté et rejoue la partie jusqu'à son terme, pour en ouvrir le compte rendu. */
  const importRecording = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setErrors(['Ce fichier n’est pas un JSON lisible.']);
      return;
    }
    const loaded = loadRecording(data);
    if (!loaded.ok) {
      setErrors(loaded.errors.slice(0, 6));
      return;
    }
    setErrors([]);
    setReviewing(true);
    // La re-simulation prend un instant : on laisse d'abord le bouton afficher qu'elle est en cours.
    setTimeout(() => {
      try {
        onReview(replay(loaded.recording));
      } catch (error) {
        setErrors([`Cet enregistrement ne peut pas être rejoué : ${error instanceof Error ? error.message : String(error)}`]);
        setReviewing(false);
      }
    }, 30);
  };

  const importScenario = async (file: File) => {
    const result = importScenarioJson(await file.text());
    if (!result.ok) {
      setEditorNotice({ lines: result.errors.slice(0, 6), bad: true });
      return;
    }
    // Jamais d'écrasement : un identifiant déjà pris reçoit un suffixe.
    const imported = { ...result.scenario, id: uniqueScenarioId(result.scenario.id, allIds) };
    if (!saveCustomScenario(imported)) {
      setEditorNotice({ lines: ['Stockage du navigateur indisponible ou plein : le scénario importé ne peut pas être conservé.'], bad: true });
      return;
    }
    setCustom(listCustomScenarios());
    select(imported);
    setEditorNotice({ lines: [`Scénario importé : « ${imported.title} ».`], bad: false });
  };

  const duplicate = (sc: Scenario) => {
    const copy = duplicateScenario(sc, allIds);
    if (!saveCustomScenario(copy)) {
      setEditorNotice({ lines: ['Stockage du navigateur indisponible ou plein : la copie ne peut pas être conservée.'], bad: true });
      return;
    }
    setCustom(listCustomScenarios());
    setEditorNotice({ lines: [`Copie créée : « ${copy.title} ».`], bad: false });
  };

  const createNew = () => {
    const blank = createBlankScenario({ title: 'Nouveau scénario', seed: Math.floor(Math.random() * 1_000_000_000) });
    onEdit({ ...blank, id: uniqueScenarioId(blank.id, allIds) }, false);
  };

  return (
    <main className="menu">
      <header className="menu__head">
        <div>
          <h1>WAR COMMAND</h1>
          <p>Air Operations Center</p>
        </div>
        <p className="menu__tag">Phases 1 à 6 · opérations interarmées · campagne · deux joueurs · rejeu et analyse</p>
      </header>

      <div className="menu__grid">
        <section className="card">
          <h2>Scénario</h2>
          <div className="scenarios" role="radiogroup" aria-label="Scénario">
            {entries.map((e) => (
              <button
                key={e.scenario.id}
                type="button"
                role="radio"
                aria-checked={e.scenario.id === scenario.id}
                className={`scenario${e.scenario.id === scenario.id ? ' is-on' : ''}`}
                onClick={() => select(e.scenario)}
              >
                <strong>{e.scenario.title}</strong>
                <small>
                  {e.scenario.durationMin} min · défenseur : {SIDE_LABEL[e.scenario.objective.defender]}
                  {e.custom ? (e.playable ? ' · scénario personnel' : ' · brouillon incomplet') : ''}
                </small>
              </button>
            ))}
          </div>
          <h3>{scenario.title}</h3>
          {scenario.description ? <p>{scenario.description}</p> : null}
          <dl className="facts">
            <div>
              <dt>Région</dt>
              <dd>{scenario.region.name}</dd>
            </div>
            <div>
              <dt>Période</dt>
              <dd>{scenario.period}</dd>
            </div>
            <div>
              <dt>Créneau</dt>
              <dd>
                {clockZ(scenario.date, 0, false)} Z → {end} Z ({scenario.durationMin} min)
              </dd>
            </div>
            <div>
              <dt>Météo</dt>
              <dd>{scenario.weather.label}</dd>
            </div>
          </dl>

          <h2>Votre camp</h2>
          <div className="sides">
            {SIDES.map((s) => (
              <button key={s} type="button" className={`side side--${s === 'BLUE' ? 'blue' : 'red'}${side === s ? ' is-on' : ''}`} onClick={() => setSide(s)} aria-pressed={side === s}>
                <strong>{SIDE_LABEL[s]}</strong>
                <span>{scenario.sides[s].name}</span>
                <small>{orderOfBattle(scenario, s).join(' · ') || 'aucune unité'}</small>
                <small>Doctrine : {hasDoctrine(scenario.sides[s].doctrineId) ? getDoctrine(scenario.sides[s].doctrineId).name : scenario.sides[s].doctrineId}</small>
              </button>
            ))}
          </div>
          {scenario.sides[side].briefing ? <p className="briefing">{scenario.sides[side].briefing}</p> : null}
        </section>

        <section className="card">
          <h2>Adversaire</h2>
          <p>
            L’IA dirige le camp {SIDE_LABEL[side === 'BLUE' ? 'RED' : 'BLUE']}. Elle ne voit que ce que ses capteurs détectent et
            n’agit que par des ordres soumis aux mêmes règles que les vôtres.
          </p>
          <div className="choices" role="radiogroup" aria-label="Difficulté de l’IA">
            {DIFFICULTIES.map((d) => (
              <label key={d} className={`choice${difficulty === d ? ' is-on' : ''}`}>
                <input type="radio" name="difficulty" checked={difficulty === d} onChange={() => setDifficulty(d)} />
                <span>
                  <strong>{DIFFICULTY_LABEL[d]}</strong>
                  <small>{DIFFICULTY_HELP[d]}</small>
                </span>
              </label>
            ))}
          </div>

          <h2>Déroulement</h2>
          <label className="field">
            <span>Gestion du temps</span>
            <select className="input" value={wegoTurnMin} onChange={(e) => setWegoTurnMin(Number(e.target.value))}>
              <option value={0}>Temps continu, avec pause</option>
              <option value={5}>Par tours de 5 minutes (ordres simultanés)</option>
              <option value={10}>Par tours de 10 minutes (ordres simultanés)</option>
            </select>
            <small className="hint">
              {wegoTurnMin === 0
                ? 'Vous donnez vos ordres à tout moment, en pause ou non.'
                : 'Les deux camps donnent leurs ordres entre deux tours, puis le tour se résout sans intervention : l’IA y est soumise comme vous.'}
            </small>
          </label>

          <h2>Graine aléatoire</h2>
          <p>Même graine et mêmes ordres : même partie, à l’identique.</p>
          <div className="row">
            <input className="input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.trim())} aria-label="Graine aléatoire" aria-invalid={!seedValid} />
            <button type="button" className="btn" onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000_000)))}>
              Tirer au sort
            </button>
          </div>
          {!seedValid ? <p className="error">La graine doit être un entier positif.</p> : null}
          {!entry.playable ? <p className="error">Ce brouillon est incomplet : ouvrez-le dans l’éditeur pour le terminer.</p> : null}

          <button type="button" className="btn btn--primary btn--wide" disabled={!seedValid || !entry.playable} onClick={() => onStart({ scenario, side, difficulty, seed: seedValue, wegoTurnMin })}>
            Lancer la mission
          </button>

          <h2>Reprendre une partie</h2>
          {saves.length === 0 ? <p className="muted">Aucune sauvegarde dans ce navigateur.</p> : null}
          <ul className="saves">
            {saves.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.title}</strong>
                  <small>{new Date(s.savedAt).toLocaleString('fr-FR')}</small>
                </span>
                <button type="button" className="btn" onClick={() => setErrors(onLoad(s.save))}>
                  Reprendre
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    deleteSave(s.id);
                    setSaves(listSaves());
                  }}
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
          <div className="row">
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              Importer une sauvegarde (.json)
            </button>
            <input
              ref={recordingInput}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Fichier d’enregistrement à revoir"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importRecording(file);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn" disabled={reviewing} onClick={() => recordingInput.current?.click()} title="Un enregistrement s’exporte depuis le compte rendu d’une partie terminée">
              {reviewing ? 'Re-simulation en cours…' : 'Revoir un enregistrement (.json)'}
            </button>
          </div>
          {errors.length > 0 ? (
            <ul className="error">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <CampaignCard onOpen={onCampaign} />

        <NetCard scenario={scenario} custom={entry.custom} playable={entry.playable} side={side} seed={seedValue} seedValid={seedValid} wegoTurnMin={wegoTurnMin} onConnected={onNet} />

        <section className="card card--wide">
          <h2>Éditeur de missions</h2>
          <p>
            Composez vos propres scénarios : région, coalitions et doctrines, bases, unités, missions initiales, objectif et
            déclencheurs. Un scénario se teste depuis l’éditeur, puis se joue ici comme les autres.
          </p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={createNew}>
              Nouveau scénario
            </button>
            {entry.custom ? (
              <button type="button" className="btn" onClick={() => onEdit(scenario, false)}>
                Modifier « {scenario.title} »
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => onEdit(duplicateScenario(scenario, allIds), true)}>
                Modifier une copie de « {scenario.title} »
              </button>
            )}
            <input
              ref={scenarioInput}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Fichier de scénario à importer"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importScenario(file);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn" onClick={() => scenarioInput.current?.click()}>
              Importer un scénario (.json)
            </button>
          </div>
          {editorNotice ? (
            <ul className={editorNotice.bad ? 'error' : 'notice'} role="status">
              {editorNotice.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}

          <h2>Mes scénarios</h2>
          {custom.length === 0 ? <p className="muted">Aucun scénario personnel dans ce navigateur.</p> : null}
          <ul className="saves saves--wide">
            {custom.map((c) => (
              <li key={c.scenario.id}>
                <span>
                  <strong>{c.scenario.title}</strong>
                  <small>
                    {c.playable ? 'jouable' : 'brouillon incomplet'} · {c.scenario.units.length} unité{c.scenario.units.length > 1 ? 's' : ''} · {c.scenario.durationMin} min ·
                    enregistré le {new Date(c.savedAt).toLocaleString('fr-FR')}
                  </small>
                </span>
                <button type="button" className="btn" onClick={() => onEdit(c.scenario, false)}>
                  Modifier
                </button>
                <button type="button" className="btn" onClick={() => duplicate(c.scenario)}>
                  Dupliquer
                </button>
                <button type="button" className="btn" onClick={() => downloadJson(scenarioFileName(c.scenario), c.scenario)}>
                  Exporter
                </button>
                {confirmDelete === c.scenario.id ? (
                  <button
                    type="button"
                    className="btn btn--danger"
                    onBlur={() => setConfirmDelete(null)}
                    onClick={() => {
                      deleteCustomScenario(c.scenario.id);
                      setConfirmDelete(null);
                      setEditorNotice(null);
                      setCustom(listCustomScenarios());
                      if (scenarioId === c.scenario.id) select(SCENARIOS[0]!);
                    }}
                  >
                    Confirmer la suppression
                  </button>
                ) : (
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirmDelete(c.scenario.id)}>
                    Supprimer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="menu__foot">
        Jeu de simulation : situation, bases, unités et événements fictifs. Les valeurs des matériels sont des valeurs de jeu
        documentées, pas des prédictions de performances réelles.
      </footer>
    </main>
  );
}
