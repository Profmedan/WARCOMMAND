'use client';

/**
 * Rejeu détaillé (onglet du compte rendu) : la partie revue à tout instant, en vérité-terrain ou telle que
 * chaque camp la voyait, avec sa chronologie, les traces des unités et la vue 3D.
 *
 * Rien n'est enregistré pendant la partie : tout est reconstitué par re-simulation déterministe.
 */
import { useEffect, useMemo, useState } from 'react';
import { clockZ, getSidePicture, SIDES, type ControlStatus, type SideId, type SimEvent, type SimState } from '@warcommand/simulation-core';
import type { Session } from '@warcommand/scenario-system';
import { createReplayCursor, recordingOf, type ReplayCursor } from '@warcommand/replay-engine';
import { MapView } from '../world-map/MapView';
import { ALL_DOMAINS, boundsOf, DEFAULT_LAYERS, sceneFromPicture, sceneFromTruth, type Selection } from '../world-map/scene';
import { CONTROL_LABEL, formatEvent, formatMinutes, KIND_LABEL, LAND_POSTURE_LABEL, MISSION_TYPE_LABEL, SIDE_LABEL, SOF_PHASE_LABEL, SOURCE_LABEL, STATUS_LABEL, TASK_LABEL } from './i18n';

type Perspective = 'TRUTH' | SideId;

/** Secondes de simulation par seconde réelle. */
const RATES = [60, 300, 900] as const;
/** Durée des traces affichées derrière les unités. */
const TRAIL_S = 900;
const FRAME_MS = 100;
/** Événements portés sur la chronologie : ceux qui changent le cours de la partie. */
const MARKED = new Set(['CONTROL_CHANGED', 'UNIT_DESTROYED', 'UNIT_LOST_FUEL', 'SOF_LOST', 'TROOPS_LANDED', 'EFFECT_USED', 'LAND_BROKEN']);

const tone = (s: ControlStatus) => (s === 'BLUE' ? 'blue' : s === 'RED' ? 'red' : 'amber');
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Fiche de ce qui est sélectionné sur la carte, à l'instant observé. */
function Sheet({ state, perspective, selection }: { state: SimState; perspective: Perspective; selection: Selection }) {
  if (!selection) return <p className="muted">Cliquez une unité sur la carte pour voir son état à cet instant.</p>;

  if (selection.type === 'contact' && perspective !== 'TRUTH') {
    const c = getSidePicture(state, perspective).contacts.find((x) => x.id === selection.id);
    if (!c) return <p className="muted">Cette piste n’existe pas à cet instant.</p>;
    return (
      <dl className="facts facts--tight">
        <div>
          <dt>Piste</dt>
          <dd>{c.identified ? `${c.id} · ${c.label ?? ''}` : `${c.id} · non identifiée`}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{SOURCE_LABEL[c.source]}</dd>
        </div>
        <div>
          <dt>Âge de l’information</dt>
          <dd>{c.stale ? `${Math.max(1, Math.round(c.ageS / 60))} min` : 'fraîche'}</dd>
        </div>
        <div>
          <dt>Altitude · vitesse</dt>
          <dd>
            {Math.round(c.altM).toLocaleString('fr-FR')} m · {Math.round(c.speedKmh)} km/h
          </dd>
        </div>
      </dl>
    );
  }

  const u = selection.type === 'unit' ? state.units[selection.id] : undefined;
  if (!u || (perspective !== 'TRUTH' && u.side !== perspective)) return <p className="muted">Cette unité n’est pas visible à cet instant.</p>;
  const p = state.platforms[u.platformId];
  const mission = u.missionId ? state.missions[u.missionId] : undefined;
  return (
    <dl className="facts facts--tight">
      <div>
        <dt>{SIDE_LABEL[u.side]}</dt>
        <dd>
          {u.name} · {p?.label ?? KIND_LABEL[u.kind]}
        </dd>
      </div>
      <div>
        <dt>État</dt>
        <dd>
          {STATUS_LABEL[u.status]}
          {u.damaged ? ' · endommagé' : ''}
        </dd>
      </div>
      {u.domain === 'air' ? (
        <>
          <div>
            <dt>Tâche</dt>
            <dd>
              {TASK_LABEL[u.task]}
              {mission ? ` · ${mission.name} (${MISSION_TYPE_LABEL[mission.type]})` : ''}
            </dd>
          </div>
          <div>
            <dt>Altitude · vitesse</dt>
            <dd>
              {Math.round(u.altM).toLocaleString('fr-FR')} m · {Math.round(u.speedKmh)} km/h
            </dd>
          </div>
          <div>
            <dt>Carburant</dt>
            <dd>{p && p.fuelCapacityKg > 0 ? pct(u.fuelKg / p.fuelCapacityKg) : '—'}</dd>
          </div>
          <div>
            <dt>Munitions</dt>
            <dd>
              {u.weapons} air-air · {u.asm} air-surface
            </dd>
          </div>
        </>
      ) : null}
      {u.land ? (
        <>
          <div>
            <dt>Posture</dt>
            <dd>
              {LAND_POSTURE_LABEL[u.land.posture]}
              {u.land.broken ? ' · rompue' : u.land.inContact ? ' · au contact' : ''}
            </dd>
          </div>
          <div>
            <dt>Effectifs · moral</dt>
            <dd>
              {pct(u.land.strength)} · {pct(u.land.morale)}
            </dd>
          </div>
          <div>
            <dt>Cohésion · ravitaillement</dt>
            <dd>
              {pct(u.land.cohesion)} · {pct(u.land.supply)}
            </dd>
          </div>
        </>
      ) : null}
      {u.naval ? (
        <>
          <div>
            <dt>Coque</dt>
            <dd>
              {u.naval.hull}
              {p ? ` / ${p.hull}` : ''}
            </dd>
          </div>
          <div>
            <dt>Armement</dt>
            <dd>
              {u.naval.ssm} antinavires · {u.naval.torpedoes} torpilles · {u.weapons} sol-air
            </dd>
          </div>
        </>
      ) : null}
      {u.sof ? (
        <div>
          <dt>Équipe</dt>
          <dd>{SOF_PHASE_LABEL[u.sof.phase]}</dd>
        </div>
      ) : null}
      {u.kind === 'sam' ? (
        <div>
          <dt>Missiles</dt>
          <dd>{u.weapons}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function Replay({ session }: { session: Session }) {
  const [cursor, setCursor] = useState<ReplayCursor | null>(null);
  const [t, setT] = useState(session.state.time);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<(typeof RATES)[number]>(300);
  const [perspective, setPerspective] = useState<Perspective>('TRUTH');
  const [trails, setTrails] = useState(true);
  const [view3d, setView3d] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const scenario = session.scenario;
  const startIso = session.state.startIso;
  const ctx = useMemo(() => ({ startIso, sectorName: session.state.objective.name }), [startIso, session]);

  // La préparation re-simule toute la partie : on la diffère pour laisser l'écran s'afficher.
  useEffect(() => {
    const id = setTimeout(() => setCursor(createReplayCursor(recordingOf(session))), 30);
    return () => clearTimeout(id);
  }, [session]);

  useEffect(() => {
    if (!playing || !cursor) return;
    const id = setInterval(() => {
      setT((v) => {
        if (v >= cursor.endTime) {
          setPlaying(false);
          return v;
        }
        return Math.min(cursor.endTime, v + (rate * FRAME_MS) / 1000);
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [playing, cursor, rate]);

  const fit = useMemo(() => boundsOf([...scenario.bases.map((b) => b.pos), scenario.objective.center]), [scenario]);
  const state: SimState | null = useMemo(() => (cursor ? cursor.stateAt(t) : null), [cursor, t]);

  const scene = useMemo(() => {
    if (!state || !cursor) return null;
    const trail = trails ? (unitId: string) => cursor.trail(unitId, state.time, TRAIL_S) : undefined;
    if (perspective === 'TRUTH') return sceneFromTruth(state, { layers: DEFAULT_LAYERS, domains: ALL_DOMAINS, selection, trail });
    return sceneFromPicture(getSidePicture(state, perspective), { layers: DEFAULT_LAYERS, domains: ALL_DOMAINS, selection, draft: [], measure: [], showNavalZone: false, trail });
  }, [state, cursor, perspective, trails, selection]);

  // Journal de la perspective choisie : tout pour l'arbitre, sinon ce que le camp pouvait voir.
  const visible: SimEvent[] = useMemo(() => {
    if (!cursor) return [];
    return perspective === 'TRUTH' ? cursor.events : cursor.events.filter((e) => e.vis.includes(perspective));
  }, [cursor, perspective]);
  const recent = useMemo(() => {
    let end = visible.length;
    while (end > 0 && visible[end - 1]!.t > t) end -= 1;
    return visible.slice(Math.max(0, end - 14), end).reverse();
  }, [visible, t]);
  const marks = useMemo(() => visible.filter((e) => MARKED.has(e.code)), [visible]);

  if (!cursor || !state || !scene) return <p className="muted">Préparation du rejeu : la partie est re-simulée à partir de la graine et des ordres…</p>;

  const end = cursor.endTime;
  const jump = (to: number) => {
    setPlaying(false);
    setT(Math.max(0, Math.min(end, to)));
  };
  const o = state.objective;
  const timeline = session.state.objective.timeline;
  const seen = perspective === 'TRUTH' ? null : o.perceived[perspective];

  return (
    <div className="replay">
      <div className="replay__bar">
        <button type="button" className="btn btn--primary" onClick={() => (t >= end ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))}>
          {playing ? 'Pause' : t >= end ? 'Revoir depuis le début' : 'Lecture'}
        </button>
        <div className="speed" role="group" aria-label="Vitesse de lecture">
          {RATES.map((r) => (
            <button key={r} type="button" className={`speed__btn${rate === r ? ' is-on' : ''}`} aria-pressed={rate === r} onClick={() => setRate(r)}>
              ×{r}
            </button>
          ))}
        </div>
        <div className="speed" role="group" aria-label="Avance pas à pas">
          <button type="button" className="speed__btn" onClick={() => jump(t - 60)} disabled={t <= 0}>
            −1 min
          </button>
          <button type="button" className="speed__btn" onClick={() => jump(t - 10)} disabled={t <= 0}>
            −10 s
          </button>
          <button type="button" className="speed__btn" onClick={() => jump(t + 10)} disabled={t >= end}>
            +10 s
          </button>
          <button type="button" className="speed__btn" onClick={() => jump(t + 60)} disabled={t >= end}>
            +1 min
          </button>
        </div>
        <strong className="replay__clock">{clockZ(startIso, t)} Z</strong>
        <label className="replay__view">
          <span>Point de vue</span>
          <select
            className="input"
            value={perspective}
            onChange={(e) => {
              setPerspective(e.target.value as Perspective);
              setSelection(null);
            }}
          >
            <option value="TRUTH">Vérité-terrain (les deux camps)</option>
            {SIDES.map((s) => (
              <option key={s} value={s}>
                Image du camp {SIDE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} /> Traces ({TRAIL_S / 60} min)
        </label>
        <button type="button" className={`btn${view3d ? ' is-on' : ''}`} aria-pressed={view3d} onClick={() => setView3d((v) => !v)}>
          {view3d ? 'Vue 2D' : 'Vue 3D'}
        </button>
      </div>

      <div className="replay__timeline">
        <input type="range" min={0} max={end} step={10} value={Math.round(t)} onChange={(e) => jump(Number(e.target.value))} aria-label="Instant observé" />
        <div className="controlbar controlbar--thin" role="img" aria-label="Contrôle réel du secteur au fil de la partie">
          {timeline.map((seg, i) => {
            const to = i + 1 < timeline.length ? timeline[i + 1]!.t : end;
            return to > seg.t ? <span key={seg.t} className={`controlbar__seg bg--${tone(seg.status)}`} style={{ width: `${(100 * (to - seg.t)) / Math.max(1, end)}%` }} /> : null;
          })}
        </div>
        <div className="replay__marks">
          {marks.map((e, i) => (
            <button
              key={i}
              type="button"
              className={`replay__mark bg--${e.code === 'CONTROL_CHANGED' ? 'amber' : e.vis[0] ? tone(e.vis[0]) : 'amber'}`}
              style={{ left: `${(100 * e.t) / Math.max(1, end)}%` }}
              title={`${clockZ(startIso, e.t)} Z — ${formatEvent(e, ctx).text}`}
              aria-label={`Aller à ${clockZ(startIso, e.t)} Z : ${formatEvent(e, ctx).text}`}
              onClick={() => jump(e.t)}
            />
          ))}
        </div>
      </div>

      <p className="replay__status">
        {seen ? (
          <>
            Contrôle perçu par {SIDE_LABEL[perspective as SideId]} : <b className={`txt--${tone(seen.status)}`}>{CONTROL_LABEL[seen.status]}</b> · BLEU {formatMinutes(seen.sec.BLUE)} · ROUGE{' '}
            {formatMinutes(seen.sec.RED)} · contesté {formatMinutes(seen.sec.CONTESTED)} —{' '}
          </>
        ) : null}
        Contrôle réel : <b className={`txt--${tone(o.status)}`}>{CONTROL_LABEL[o.status]}</b> · BLEU {formatMinutes(o.sec.BLUE)} · ROUGE {formatMinutes(o.sec.RED)} · contesté{' '}
        {formatMinutes(o.sec.CONTESTED)}
      </p>

      <div className="replay__main">
        <div className="replay__map">
          <MapView scene={scene} view={{ center: scenario.region.center, zoom: scenario.region.zoom }} fit={fit} picking={false} showGraticule view3d={view3d} onSelect={setSelection} onMapClick={() => setSelection(null)} />
        </div>
        <aside className="replay__side">
          <h3>Sélection</h3>
          <Sheet state={state} perspective={perspective} selection={selection} />
          <h3>Journal à cet instant</h3>
          {recent.length === 0 ? <p className="muted">Aucun événement pour l’instant.</p> : null}
          <div className="journal journal--replay">
            {recent.map((e, i) => {
              const line = formatEvent(e, ctx);
              return (
                <button key={`${e.t}-${i}`} type="button" className={`journal__line tone--${line.tone}`} onClick={() => jump(e.t)} title="Aller à cet instant">
                  <time>{clockZ(startIso, e.t)}</time> {line.text}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
      <p className="muted">
        {perspective === 'TRUTH'
          ? 'Vérité-terrain des deux camps, reconstituée par re-simulation déterministe : aucune position n’est enregistrée, tout est recalculé.'
          : `Ce que le camp ${SIDE_LABEL[perspective]} voyait à cet instant : ses unités, ses pistes et leur fraîcheur — rien d’autre.`}{' '}
        Les repères de la chronologie marquent les pertes, les changements de contrôle, les débarquements et les effets employés.
      </p>
    </div>
  );
}
