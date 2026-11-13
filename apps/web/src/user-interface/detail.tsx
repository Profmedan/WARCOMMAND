'use client';

import {
  clockZ,
  distanceKm,
  isGroundForce,
  isSurfaceShip,
  type ContactView,
  type LatLon,
  type Mission,
  type MissionType,
  type Roe,
  type SidePicture,
  type SpeedMode,
  type Unit,
} from '@warcommand/simulation-core';
import { MISSION_KIND, type MissionEstimate, type Order } from '@warcommand/air-operations';
import type { GameOrder, GameOrderResult } from '@warcommand/scenario-system';
import { GAME_STAT_LABELS, getPlatform, type GameStatKey } from '@warcommand/unit-database';
import { CLASSIFICATION_LABELS, DOCTRINE_KEY_INFO, DOCTRINE_KEYS, getDoctrine } from '@warcommand/doctrine-engine';
import type { Selection } from '../world-map/scene';
import { Bar, Row } from './bits';
import { EffectsPanel, LandSection, NavalSection, SofSection, type JointTool } from './joint';
import {
  CONTROL_LABEL,
  DOMAIN_LABEL,
  formatLatLon,
  formatMinutes,
  KIND_LABEL,
  MISSION_STATUS_LABEL,
  MISSION_TYPE_HELP,
  MISSION_TYPE_LABEL,
  rejectReason,
  ROE_HELP,
  ROE_LABEL,
  RTB_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  TASK_LABEL,
} from './i18n';

export interface PlanDraft {
  type: MissionType;
  unitIds: string[];
  waypoints: LatLon[];
  altM: number;
  speed: SpeedMode;
  /** Minutes avant le départ ; 0 = dès que possible. */
  delayMin: number;
  /** Durée du créneau en minutes ; `null` = sans limite. */
  windowMin: number | null;
  roe: Roe;
  allowRefuel: boolean;
  targetContactId: string | null;
  /** Emport demandé ; `null` = automatique (emport en cours, ou air-surface pour une attaque). */
  loadoutId: string | null;
  /** Silence radar. */
  emcon: boolean;
  /** Appareil à protéger (escorte). */
  escortUnitId: string | null;
}

/** Missions dont la destination est une station ou une route posée sur la carte. */
export function usesWaypoints(type: MissionType): boolean {
  return type !== 'INTERCEPT' && type !== 'SEAD' && type !== 'ESCORT';
}

export function planToOrder(pic: SidePicture, plan: PlanDraft): Order {
  const launchAt = pic.time + plan.delayMin * 60;
  const targeted = plan.type === 'INTERCEPT' || plan.type === 'SEAD';
  return {
    type: 'CREATE_MISSION',
    side: pic.side,
    draft: {
      type: plan.type,
      unitIds: plan.unitIds,
      waypoints: usesWaypoints(plan.type) ? plan.waypoints : [],
      altM: plan.altM,
      speed: plan.speed,
      launchAt,
      endAt: plan.windowMin === null ? null : launchAt + plan.windowMin * 60,
      roe: plan.roe,
      allowRefuel: plan.allowRefuel,
      targetContactId: targeted ? plan.targetContactId : null,
      loadoutId: plan.loadoutId,
      emcon: plan.emcon,
      escortUnitId: plan.type === 'ESCORT' ? plan.escortUnitId : null,
    },
  };
}

/** Motif d'un refus du moteur, précédé du nom de l'unité en cause quand il y en a une. */
export function rejectText(pic: SidePicture, result: GameOrderResult, orderType?: string): string {
  if (result.ok) return '';
  const unit = result.unitId ? pic.units.find((u) => u.id === result.unitId) : undefined;
  const reason = rejectReason(result.code, orderType);
  return unit ? `${unit.name} : ${reason}` : reason;
}

const ROES: Roe[] = ['hold', 'defensive', 'free'];
const ALTITUDES = [500, 3000, 6000, 7500, 8000, 9000, 11000];
const DELAYS = [0, 5, 10, 15, 20, 30, 45];
const WINDOWS = [20, 30, 45, 60];
const MISSION_TYPES: MissionType[] = ['CAP', 'SWEEP', 'INTERCEPT', 'ESCORT', 'SEAD', 'CAS', 'RECON', 'AEW', 'TANKER'];
const COMBAT_TYPES: ReadonlySet<MissionType> = new Set<MissionType>(['CAP', 'SWEEP', 'INTERCEPT', 'ESCORT', 'SEAD', 'CAS']);

/** Une piste est-elle une cible possible d'une attaque (SEAD) : site sol-air ou bâtiment de surface identifié ? */
export function isStrikeTarget(c: ContactView): boolean {
  return c.identified && c.kind !== null && (c.kind === 'sam' || isSurfaceShip(c.kind));
}

/** Défenses sol-air et bâtiments de surface connus et identifiés : cibles possibles d'une attaque. */
export function siteContacts(pic: SidePicture): ContactView[] {
  return pic.contacts.filter(isStrikeTarget);
}

/** Aéronefs amis que l'on peut escorter : en vol, ou affectés à une mission. */
export function escortableUnits(pic: SidePicture, exclude: readonly string[]): Unit[] {
  const rank = (u: Unit) => (u.kind === 'fighter' ? 1 : 0);
  return pic.units
    .filter((u) => u.domain === 'air' && !exclude.includes(u.id) && u.status !== 'destroyed' && u.status !== 'maintenance')
    .filter((u) => u.status === 'airborne' || u.missionId !== null)
    .sort((a, b) => rank(a) - rank(b));
}

/** Réglages par défaut propres à chaque type de mission. */
export function defaultsFor(pic: SidePicture, type: MissionType): Partial<PlanDraft> {
  switch (type) {
    case 'SEAD':
      return { altM: 500, roe: 'free', targetContactId: siteContacts(pic)[0]?.id ?? null };
    case 'INTERCEPT':
      return { altM: 9000, roe: 'free', targetContactId: pic.contacts.find((c) => c.domain === 'air')?.id ?? null };
    case 'ESCORT':
      return { altM: 9000, roe: pic.defaultRoe, escortUnitId: escortableUnits(pic, [])[0]?.id ?? null };
    case 'CAS':
      return { altM: 6000, roe: pic.defaultRoe };
    case 'SWEEP':
      return { altM: 9000, roe: 'free' };
    case 'RECON':
      return { altM: 7500 };
    case 'AEW':
    case 'TANKER':
      return { altM: 8000 };
    default:
      return { altM: 9000, roe: pic.defaultRoe };
  }
}

function fuelPct(pic: SidePicture, u: Unit): number | null {
  const cap = pic.platforms[u.platformId]?.fuelCapacityKg ?? 0;
  return cap > 0 ? Math.round((100 * u.fuelKg) / cap) : null;
}

function isTaskable(u: Unit): boolean {
  if (u.damaged || u.status === 'destroyed' || u.status === 'maintenance' || u.status === 'active') return false;
  return !(u.status === 'airborne' && u.task === 'rtb' && u.rtbReason !== 'order' && u.rtbReason !== 'mission_end');
}

/* ------------------------------------------------------------------ Planificateur */

interface PlannerProps {
  pic: SidePicture;
  plan: PlanDraft;
  check: GameOrderResult;
  estimate: MissionEstimate | null;
  onChange: (plan: PlanDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function Planner({ pic, plan, check, estimate, onChange, onSubmit, onCancel }: PlannerProps) {
  const kind = MISSION_KIND[plan.type];
  const candidates = pic.units.filter((u) => u.kind === kind && u.status !== 'destroyed');
  const airContacts = pic.contacts.filter((c) => c.domain === 'air');
  const sites = siteContacts(pic);
  const escortable = escortableUnits(pic, plan.unitIds);
  const hasTanker = pic.units.some((u) => u.kind === 'tanker' && u.status !== 'destroyed');
  const set = (patch: Partial<PlanDraft>) => onChange({ ...plan, ...patch });
  const toggle = (id: string) => set({ unitIds: plan.unitIds.includes(id) ? plan.unitIds.filter((x) => x !== id) : [...plan.unitIds, id] });
  const combat = COMBAT_TYPES.has(plan.type);
  const available = (type: MissionType) => pic.units.some((u) => u.kind === MISSION_KIND[type] && u.status !== 'destroyed');
  const blocked = (type: MissionType): string | null => {
    if (type === 'INTERCEPT' && airContacts.length === 0) return 'aucun contact aérien';
    if (type === 'SEAD' && sites.length === 0) return 'aucune défense identifiée';
    if (type === 'ESCORT' && escortableUnits(pic, []).length === 0) return 'aucun appareil à escorter';
    return null;
  };
  const loadouts = (candidates[0] ? pic.platforms[candidates[0].platformId]?.loadouts : undefined) ?? [];
  const base = pic.bases[0];

  return (
    <div className="sheet">
      <p className="sheet__eyebrow">Planification</p>
      <h2>Nouvelle mission</h2>

      <label className="field">
        <span>Type</span>
        <select
          className="input"
          value={plan.type}
          onChange={(e) => {
            const type = e.target.value as MissionType;
            const keep = plan.unitIds.filter((id) => pic.units.find((u) => u.id === id)?.kind === MISSION_KIND[type]);
            onChange({ ...plan, type, unitIds: keep, targetContactId: null, escortUnitId: null, loadoutId: null, ...defaultsFor(pic, type) });
          }}
        >
          {MISSION_TYPES.filter(available).map((type) => {
            const why = blocked(type);
            return (
              <option key={type} value={type} disabled={why !== null}>
                {MISSION_TYPE_LABEL[type]}
                {why ? ` (${why})` : ''}
              </option>
            );
          })}
        </select>
        <small className="hint">{MISSION_TYPE_HELP[plan.type]}</small>
      </label>

      <fieldset className="field">
        <legend>Appareils</legend>
        {candidates.length === 0 ? <p className="muted">Aucun appareil de ce type.</p> : null}
        {candidates.map((u) => {
          const pct = fuelPct(pic, u);
          const ok = isTaskable(u);
          return (
            <label key={u.id} className={`check${ok ? '' : ' is-off'}`}>
              <input type="checkbox" checked={plan.unitIds.includes(u.id)} disabled={!ok} onChange={() => toggle(u.id)} />
              <span>{u.name}</span>
              <small>
                {u.status === 'airborne'
                  ? `${TASK_LABEL[u.task]}${pct !== null ? ` · ${pct} %` : ''}`
                  : u.status === 'turnaround' && u.readyAt !== null
                    ? `${u.fault ? 'en panne, ' : ''}prêt à ${clockZ(pic.startIso, u.readyAt, false)} Z`
                    : STATUS_LABEL[u.status].toLowerCase()}
              </small>
            </label>
          );
        })}
      </fieldset>

      {plan.type === 'INTERCEPT' ? (
        <label className="field">
          <span>Piste à intercepter</span>
          <select className="input" value={plan.targetContactId ?? ''} onChange={(e) => set({ targetContactId: e.target.value || null })}>
            {airContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} {c.identified ? c.label : '— non identifié'}
                {c.stale ? ' (ancien)' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {plan.type === 'SEAD' ? (
        <label className="field">
          <span>Défense à attaquer</span>
          <select className="input" value={plan.targetContactId ?? ''} onChange={(e) => set({ targetContactId: e.target.value || null })}>
            {sites.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} {c.label}
                {c.stale ? (c.fixed ? ' (renseignement ancien)' : ' (position ancienne)') : ''}
              </option>
            ))}
          </select>
          <small className="hint">
            Un site fixe peut être tiré sur renseignement ancien, avec moins de chances de coup au but ; un bâtiment exige une position fraîche.
            L’approche à basse altitude retarde la détection par le radar visé.
          </small>
        </label>
      ) : null}

      {plan.type === 'ESCORT' ? (
        <label className="field">
          <span>Appareil à protéger</span>
          <select className="input" value={plan.escortUnitId ?? ''} onChange={(e) => set({ escortUnitId: e.target.value || null })}>
            {escortable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {KIND_LABEL[u.kind].toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {usesWaypoints(plan.type) ? (
        <div className="field">
          <span>{plan.type === 'SWEEP' ? 'Route' : 'Station'}</span>
          <p className="hint">
            {plan.type === 'SWEEP'
              ? 'Cliquez sur la carte les points de la route, dans l’ordre (huit au plus). Elle est parcourue une seule fois.'
              : 'Cliquez sur la carte. Un seul point crée un circuit d’attente automatique ; plusieurs points (huit au plus) dessinent votre propre circuit.'}
          </p>
          <div className="row">
            <strong>{plan.waypoints.length === 0 ? 'Aucun point' : `${plan.waypoints.length} point${plan.waypoints.length > 1 ? 's' : ''}`}</strong>
            <button type="button" className="btn btn--small" disabled={plan.waypoints.length === 0} onClick={() => set({ waypoints: plan.waypoints.slice(0, -1) })}>
              Retirer le dernier
            </button>
            <button type="button" className="btn btn--small" disabled={plan.waypoints.length === 0} onClick={() => set({ waypoints: [] })}>
              Effacer
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid2">
        <label className="field">
          <span>Altitude</span>
          <select className="input" value={plan.altM} onChange={(e) => set({ altM: Number(e.target.value) })}>
            {ALTITUDES.map((a) => (
              <option key={a} value={a}>
                {a.toLocaleString('fr-FR')} m{a < pic.rules.lowAltBelowM ? ' (basse)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Régime de transit</span>
          <select className="input" value={plan.speed} onChange={(e) => set({ speed: e.target.value as SpeedMode })}>
            <option value="cruise">Croisière</option>
            <option value="dash">Rapide (très gourmand)</option>
          </select>
        </label>
        <label className="field">
          <span>Départ</span>
          <select className="input" value={plan.delayMin} onChange={(e) => set({ delayMin: Number(e.target.value) })}>
            {DELAYS.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'Dès que possible' : `${clockZ(pic.startIso, pic.time + d * 60, false)} Z (+${d} min)`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fin de créneau</span>
          <select className="input" value={plan.windowMin ?? ''} onChange={(e) => set({ windowMin: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Sans limite</option>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                Après {w} min
              </option>
            ))}
          </select>
        </label>
      </div>
      {plan.altM < pic.rules.lowAltBelowM ? (
        <p className="hint">Basse altitude : sous l’horizon des radars de surface lointains, mais consommation multipliée par {pic.rules.lowAltBurnFactor}.</p>
      ) : null}

      {kind === 'fighter' && loadouts.length > 1 ? (
        <label className="field">
          <span>Emport</span>
          <select className="input" value={plan.loadoutId ?? ''} onChange={(e) => set({ loadoutId: e.target.value || null })}>
            <option value="">{plan.type === 'SEAD' || plan.type === 'CAS' ? 'Automatique (air-surface)' : 'Automatique (emport en cours)'}</option>
            {loadouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label} — {l.aam} air-air{l.asm > 0 ? `, ${l.asm} air-surface` : ''}
              </option>
            ))}
          </select>
          <small className="hint">
            Changer d’emport immobilise l’appareil {Math.round(pic.rules.rearmDelayS / 60)} min au sol et n’est pas possible en vol.
            {base ? ` Stocks de ${base.name} : ${base.weaponStock} air-air, ${base.asmStock} air-surface.` : ''}
          </small>
        </label>
      ) : null}

      {combat ? (
        <label className="field">
          <span>Règles d’engagement</span>
          <select className="input" value={plan.roe} onChange={(e) => set({ roe: e.target.value as Roe })}>
            {ROES.map((r) => (
              <option key={r} value={r}>
                {ROE_LABEL[r]}
              </option>
            ))}
          </select>
          <small className="hint">{ROE_HELP[plan.roe]}</small>
        </label>
      ) : null}

      {kind === 'fighter' || kind === 'aew' ? (
        <label className="check check--wrap">
          <input type="checkbox" checked={plan.emcon} onChange={() => set({ emcon: !plan.emcon })} />
          <span>Silence radar</span>
          <small>indétectable à l’écoute, mais aveugle sans avion-radar ami</small>
        </label>
      ) : null}

      {hasTanker && plan.type !== 'TANKER' ? (
        <label className="check check--wrap">
          <input type="checkbox" checked={plan.allowRefuel} onChange={() => set({ allowRefuel: !plan.allowRefuel })} />
          <span>Ravitaillement en vol autorisé</span>
          <small>étend aussi le rayon d’action</small>
        </label>
      ) : null}

      {estimate ? (
        <dl className="estimate" aria-label="Estimation de la mission">
          <Row label="Départ">{clockZ(pic.startIso, estimate.departAt, false)} Z</Row>
          <Row label="Arrivée">
            {clockZ(pic.startIso, estimate.arrivalAt, false)} Z · transit {Math.round(estimate.transitMin)} min
          </Row>
          <Row label="Carburant à l’arrivée">{Math.max(0, Math.round(estimate.fuelOnArrivalPct))} %</Row>
          <Row label="Autonomie sur zone">
            {estimate.onStationMin > 0 ? `≈ ${Math.round(estimate.onStationMin)} min sans ravitaillement` : 'aucune sans ravitaillement'}
          </Row>
        </dl>
      ) : null}

      <p className={check.ok ? 'hint hint--ok' : 'error'} role="status">
        {check.ok ? 'Ordre réalisable. Les appareils au sol décollent après le délai de mise en œuvre.' : rejectText(pic, check)}
      </p>
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={!check.ok} onClick={onSubmit}>
          Valider l’ordre
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Abandonner
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Fiches */

interface DetailProps {
  pic: SidePicture;
  selection: Selection;
  briefing: string;
  onSelect: (selection: Selection) => void;
  onPlan: (seed: Partial<PlanDraft>) => void;
  onOrder: (order: GameOrder) => void;
  onMoveShip: (unitId: string) => void;
  movingShip: string | null;
  /** Outil de désignation en cours pour une formation, un débarquement ou une équipe spéciale. */
  jointTool: JointTool | null;
  onJointTool: (tool: JointTool | null) => void;
}

function PlatformSheet({ platformId }: { platformId: string }) {
  const record = getPlatform(platformId);
  const keys = (Object.keys(record.game) as GameStatKey[]).filter((k) => record.game[k].value !== 0);
  return (
    <details className="fold">
      <summary>Fiche matériel et provenance des données</summary>
      <p className="muted">
        {record.role} · {record.manufacturer} · {record.servicePeriod}
        {record.generic ? ' · matériel générique, sans équivalent réel' : ''}
      </p>
      {record.reference.length > 0 ? (
        <>
          <h4>Données publiques de référence</h4>
          <ul className="facts2">
            {record.reference.map((r) => (
              <li key={r.label}>
                <span>{r.label}</span>
                <b>{r.value}</b>
                <small>
                  {r.source} · confiance {r.confidence}
                </small>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4>Valeurs utilisées par le moteur</h4>
      <ul className="facts2">
        {keys.map((k) => (
          <li key={k}>
            <span>{GAME_STAT_LABELS[k].label}</span>
            <b>
              {record.game[k].value.toLocaleString('fr-FR')} {GAME_STAT_LABELS[k].unit}
            </b>
            <small>
              <em className={`tag tag--${record.game[k].provenance === 'publique' ? 'pub' : 'est'}`}>{record.game[k].provenance === 'publique' ? 'donnée publique' : 'estimation de jeu'}</em> {record.game[k].basis}
            </small>
          </li>
        ))}
      </ul>
      <p className="muted">Données rassemblées le {new Date(record.dataDate).toLocaleDateString('fr-FR')}. Sources : {record.sources.join(' ; ')}.</p>
    </details>
  );
}

function UnitSheet({ pic, unit, onSelect, onPlan, onOrder, onMoveShip, movingShip, jointTool, onJointTool }: DetailProps & { unit: Unit }) {
  const joint = { pic, unit, tool: jointTool, onOrder, onTool: onJointTool, onSupport: (at: LatLon) => onPlan({ type: 'CAS', waypoints: [at] }) };
  const p = pic.platforms[unit.platformId];
  const mission = pic.missions.find((m) => m.id === unit.missionId);
  const base = pic.bases.find((b) => b.id === unit.baseId);
  const group = pic.groups.find((g) => g.id === unit.groupId);
  const pct = fuelPct(pic, unit);
  const isAir = unit.domain === 'air';
  const loadout = p?.loadouts.find((l) => l.id === unit.loadoutId);
  const inService = unit.status === 'airborne' || unit.status === 'active';
  const radar =
    !p || p.radarRangeKm <= 0 || !inService
      ? null
      : !isAir && unit.damaged
        ? 'hors service'
        : !isAir && unit.suppressedUntil > pic.time
          ? `coupé jusqu’à ${clockZ(pic.startIso, unit.suppressedUntil, false)} Z (pris pour cible)`
          : isAir && mission?.emcon
            ? 'silence radar'
            : 'émet — repérable à l’écoute';

  return (
    <div className="sheet">
      <p className="sheet__eyebrow">{KIND_LABEL[unit.kind]}</p>
      <h2>{unit.name}</h2>
      <span className={`chip2 chip2--${unit.status}`}>
        {STATUS_LABEL[unit.status]}
        {unit.damaged && unit.status !== 'destroyed' && unit.status !== 'maintenance' ? ' · endommagé' : ''}
      </span>

      <dl className="kvlist">
        <Row label="Matériel">{p?.label ?? unit.platformId}</Row>
        <Row label="Groupe">{group?.name ?? '—'}</Row>
        {base ? <Row label="Base">{base.name}{base.closed ? ' — hors service' : ''}</Row> : null}
        {unit.status !== 'destroyed' && !unit.land && !unit.sof ? <Row label="Activité">{TASK_LABEL[unit.task]}{unit.task === 'rtb' && unit.rtbReason ? ` (${RTB_LABEL[unit.rtbReason]})` : ''}</Row> : null}
        {isAir && pct !== null ? (
          <Row label="Carburant">
            <Bar value={pct} /> {pct} %
          </Row>
        ) : null}
        {unit.kind === 'tanker' ? <Row label="À transférer">{Math.round(unit.transferKg / 1000)} t</Row> : null}
        {loadout ? <Row label="Emport">{loadout.label}</Row> : null}
        {p && p.weaponCount > 0 ? (
          <Row label={p.weapon === 'sam' ? 'Missiles sol-air' : 'Missiles air-air'}>
            {unit.weapons} / {loadout ? loadout.aam : p.weaponCount}
          </Row>
        ) : null}
        {loadout && loadout.asm > 0 ? (
          <Row label="Munitions air-surface">
            {unit.asm} / {loadout.asm}
          </Row>
        ) : null}
        {radar ? <Row label="Radar">{radar}</Row> : null}
        {unit.fault && unit.status === 'turnaround' ? <Row label="Panne">réparation en cours</Row> : null}
        {unit.status === 'airborne' ? (
          <Row label="Vol">
            {Math.round(unit.altM).toLocaleString('fr-FR')} m · {Math.round(unit.speedKmh)} km/h · cap {String(Math.round(unit.headingDeg)).padStart(3, '0')}°
          </Row>
        ) : null}
        {unit.status === 'turnaround' && unit.readyAt !== null ? <Row label="Disponible à">{clockZ(pic.startIso, unit.readyAt, false)} Z</Row> : null}
        <Row label="Équipage">{Math.round(unit.crew * 100)} % d’entraînement</Row>
        <Row label="Position">{formatLatLon(unit.pos.lat, unit.pos.lon)}</Row>
        {mission ? (
          <Row label="Mission">
            <button type="button" className="linkbtn" onClick={() => onSelect({ type: 'mission', id: mission.id })}>
              {mission.name}
            </button>{' '}
            · {MISSION_STATUS_LABEL[mission.status].toLowerCase()}
          </Row>
        ) : null}
      </dl>

      <div className="actions">
        {isAir && isTaskable(unit) ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onPlan({ type: unit.kind === 'fighter' ? 'CAP' : unit.kind === 'aew' ? 'AEW' : unit.kind === 'drone' ? 'RECON' : 'TANKER', unitIds: [unit.id] })}
          >
            Nouvelle mission
          </button>
        ) : null}
        {isAir && unit.kind !== 'fighter' && (unit.status === 'airborne' || unit.missionId !== null) && pic.units.some((u) => u.kind === 'fighter' && isTaskable(u)) ? (
          <button type="button" className="btn" onClick={() => onPlan({ type: 'ESCORT', escortUnitId: unit.id })}>
            Faire escorter
          </button>
        ) : null}
        {unit.status === 'airborne' && unit.task !== 'rtb' ? (
          <button type="button" className="btn" onClick={() => onOrder({ type: 'RTB_UNIT', side: pic.side, unitId: unit.id })}>
            Retour à la base
          </button>
        ) : null}
        {unit.naval && unit.status === 'active' ? (
          <button type="button" className={`btn${movingShip === unit.id ? ' is-on' : ''}`} aria-pressed={movingShip === unit.id} onClick={() => onMoveShip(unit.id)}>
            {movingShip === unit.id ? 'Cliquez la destination en mer, dans la zone de manœuvre' : 'Déplacer'}
          </button>
        ) : null}
      </div>
      {unit.status !== 'destroyed' ? (
        <>
          <LandSection {...joint} />
          <NavalSection {...joint} />
          <SofSection {...joint} />
        </>
      ) : null}
      <PlatformSheet platformId={unit.platformId} />
    </div>
  );
}

function MissionSheet({ pic, mission, onSelect, onOrder }: DetailProps & { mission: Mission }) {
  const members = pic.units.filter((u) => u.missionId === mission.id);
  const roster = mission.unitIds.map((id) => pic.units.find((u) => u.id === id)).filter((u): u is Unit => u !== undefined);
  const counts = new Map<string, number>();
  for (const u of roster) {
    const label = pic.platforms[u.platformId]?.label ?? u.platformId;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const fuels = members.map((u) => fuelPct(pic, u)).filter((v): v is number => v !== null);
  const fuel = fuels.length > 0 ? Math.min(...fuels) : null;
  const open = mission.status === 'planned' || mission.status === 'active';
  const combat = COMBAT_TYPES.has(mission.type);
  const escorted = mission.escortUnitId ? pic.units.find((u) => u.id === mission.escortUnitId) : undefined;

  return (
    <div className="sheet">
      <p className="sheet__eyebrow">Mission</p>
      <h2>{mission.name}</h2>
      <span className={`chip2 chip2--${mission.status}`}>{MISSION_STATUS_LABEL[mission.status]}</span>

      <dl className="kvlist kvlist--spaced">
        <Row label="Composition">{[...counts].map(([label, n]) => `${n} × ${label}`).join(', ') || '—'}</Row>
        <Row label="Départ">{clockZ(pic.startIso, mission.launchAt, false)} Z</Row>
        <Row label="Type">{MISSION_TYPE_LABEL[mission.type]}</Row>
        {mission.endAt !== null ? <Row label="Fin de créneau">{clockZ(pic.startIso, mission.endAt, false)} Z</Row> : null}
        {mission.targetContactId ? (
          <Row label="Piste visée">
            <button type="button" className="linkbtn" onClick={() => onSelect({ type: 'contact', id: mission.targetContactId! })}>
              {mission.targetContactId}
            </button>
          </Row>
        ) : null}
        {escorted ? (
          <Row label="Appareil protégé">
            <button type="button" className="linkbtn" onClick={() => onSelect({ type: 'unit', id: escorted.id })}>
              {escorted.name}
            </button>
          </Row>
        ) : null}
        <Row label="Altitude">{mission.altM.toLocaleString('fr-FR')} m</Row>
        {mission.emcon ? <Row label="Radar">silence radar</Row> : null}
        {fuel !== null ? (
          <Row label="Carburant">
            <Bar value={fuel} /> {fuel} %{members.length > 1 ? ' (le plus bas)' : ''}
          </Row>
        ) : null}
        <Row label="Ravitaillement">{mission.allowRefuel ? 'autorisé' : 'non prévu'}</Row>
      </dl>

      {combat ? (
        <label className="field">
          <span>ROE</span>
          <select className="input" value={mission.roe} disabled={!open} onChange={(e) => onOrder({ type: 'SET_ROE', side: pic.side, missionId: mission.id, roe: e.target.value as Roe })}>
            {ROES.map((r) => (
              <option key={r} value={r}>
                {ROE_LABEL[r]}
              </option>
            ))}
          </select>
          <small className="hint">{ROE_HELP[mission.roe]}</small>
        </label>
      ) : null}

      <h4>Appareils affectés</h4>
      {members.length === 0 ? <p className="muted">Plus aucun appareil sur cette mission.</p> : null}
      <ul className="members">
        {members.map((u) => (
          <li key={u.id}>
            <button type="button" className="linkbtn" onClick={() => onSelect({ type: 'unit', id: u.id })}>
              {u.name}
            </button>
            <small>
              {u.status === 'airborne' ? TASK_LABEL[u.task] : STATUS_LABEL[u.status].toLowerCase()}
              {u.kind === 'fighter' ? ` · ${u.weapons} air-air${u.asm > 0 ? `, ${u.asm} air-surface` : ''}` : ''}
            </small>
          </li>
        ))}
      </ul>

      {open ? (
        <div className="actions">
          {mission.status === 'planned' && mission.launchAt > pic.time + 1 ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                onOrder({
                  type: 'CREATE_MISSION',
                  side: pic.side,
                  draft: {
                    type: mission.type,
                    name: mission.name,
                    unitIds: members.map((u) => u.id),
                    waypoints: mission.waypoints,
                    altM: mission.altM,
                    speed: mission.speed,
                    launchAt: pic.time,
                    endAt: mission.endAt,
                    roe: mission.roe,
                    allowRefuel: mission.allowRefuel,
                    targetContactId: mission.targetContactId,
                    emcon: mission.emcon,
                    escortUnitId: mission.escortUnitId,
                  },
                })
              }
            >
              Décoller dès que possible
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => onOrder({ type: 'CANCEL_MISSION', side: pic.side, missionId: mission.id })}>
            Annuler la mission
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ContactSheet({ pic, contact, onPlan }: DetailProps & { contact: ContactView }) {
  const fighters = pic.units.filter((u) => u.kind === 'fighter' && isTaskable(u));
  const nearest = fighters.reduce<number | null>((best, u) => {
    const d = distanceKm(u.pos, contact.pos);
    return best === null || d < best ? d : best;
  }, null);

  return (
    <div className="sheet">
      <p className="sheet__eyebrow">Renseignement</p>
      <h2>
        {contact.id}
        {contact.identified ? '' : ' ?'}
      </h2>
      <span className={`chip2 ${contact.identified ? 'chip2--hostile' : 'chip2--unknown'}`}>{contact.identified ? 'Hostile identifié' : 'Non identifié'}</span>

      <dl className="kvlist kvlist--spaced">
        <Row label="Nature">{contact.identified && contact.kind ? `${contact.label} — ${KIND_LABEL[contact.kind].toLowerCase()}` : `inconnue (${DOMAIN_LABEL[contact.domain]})`}</Row>
        <Row label="Fiabilité">{contact.fixed && contact.stale ? 'renseignement ancien sur un site fixe' : contact.stale ? 'information ancienne, position incertaine' : 'piste entretenue par capteur'}</Row>
        <Row label="Source">{SOURCE_LABEL[contact.source]}</Row>
        {contact.domain === 'air' && !contact.stale ? <Row label="Tir possible">{contact.radarTracked ? 'oui, piste radar fraîche' : 'non, pas de piste radar'}</Row> : null}
        <Row label="Dernière détection">
          {contact.lastSeen >= 0 ? `${clockZ(pic.startIso, contact.lastSeen)} Z` : 'avant le début de la mission'}
          {contact.stale ? ` (il y a ${formatMinutes(contact.ageS)})` : ''}
        </Row>
        {contact.uncertaintyKm > 0 ? <Row label="Incertitude">± {Math.round(contact.uncertaintyKm)} km</Row> : null}
        {contact.domain === 'air' ? (
          <Row label="Cinématique">
            {Math.round(contact.altM).toLocaleString('fr-FR')} m · {Math.round(contact.speedKmh)} km/h · cap {String(Math.round(contact.headingDeg)).padStart(3, '0')}°
          </Row>
        ) : null}
        <Row label="Position">{formatLatLon(contact.pos.lat, contact.pos.lon)}</Row>
        <Row label="Secteur">{contact.inSector ? `dans ${pic.objective.name}` : 'hors du secteur'}</Row>
        <Row label="Acte hostile">{contact.hostileAct ? 'a ouvert le feu' : 'aucun constaté'}</Row>
        {contact.damaged ? <Row label="État">endommagé (constaté) — ne compte plus pour le contrôle du secteur</Row> : null}
        {nearest !== null ? <Row label="Chasseur le plus proche">{Math.round(nearest)} km</Row> : null}
      </dl>

      {!contact.identified ? <p className="hint">Tant qu’une piste n’est pas identifiée, vos appareils ne l’engagent pas — sauf si elle ouvre le feu.</p> : null}
      {contact.domain === 'air' ? (
        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={fighters.length === 0} onClick={() => onPlan({ type: 'INTERCEPT', targetContactId: contact.id, unitIds: [], roe: 'free' })}>
            Intercepter
          </button>
        </div>
      ) : isStrikeTarget(contact) ? (
        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={fighters.length === 0} onClick={() => onPlan({ type: 'SEAD', targetContactId: contact.id })}>
            {contact.kind === 'sam' ? 'Attaquer (SEAD)' : 'Attaquer le bâtiment'}
          </button>
        </div>
      ) : contact.identified && contact.kind !== null && isGroundForce(contact.kind) ? (
        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={fighters.length === 0} onClick={() => onPlan({ type: 'CAS', waypoints: [contact.pos] })}>
            Appui aérien sur cette formation
          </button>
        </div>
      ) : contact.kind === 'sub' ? (
        <p className="hint">Un sous-marin ne se combat pas depuis les airs : vos frégates et destroyers l’attaquent d’eux-mêmes s’ils le tiennent au sonar, à moins de 20 km.</p>
      ) : (
        <p className="hint">Cette piste n’est pas identifiée : elle ne peut être désignée ni à une attaque, ni à un appui.</p>
      )}
    </div>
  );
}

function Overview({ pic, briefing, onPlan, onOrder }: DetailProps) {
  const o = pic.objective;
  const per = o.perceived;
  const isDefender = o.defender === pic.side;
  const doctrine = getDoctrine(pic.doctrine.id);
  const defenderSec = per.sec[o.defender];

  return (
    <div className="sheet">
      <p className="sheet__eyebrow">Objectif</p>
      <h2>{o.name}</h2>
      <span className={`chip2 chip2--${per.status === 'CONTESTED' ? 'unknown' : per.status === pic.side ? 'active' : 'hostile'}`}>Contrôle estimé : {CONTROL_LABEL[per.status]}</span>

      <dl className="kvlist kvlist--spaced">
        <Row label="Votre rôle">{isDefender ? (o.kind === 'ground' ? 'Tenir la zone avec vos formations terrestres' : 'Préserver le contrôle du secteur') : o.kind === 'ground' ? 'Disputer la zone avec vos formations terrestres' : 'Contester le contrôle du secteur'}</Row>
        {o.kind === 'ground' ? <Row label="Règle">la zone revient au camp dont les formations de mêlée présentes sont nettement les plus fortes ; sinon elle est contestée</Row> : null}
        <Row label="Contrôle du défenseur (estimé)">
          {formatMinutes(defenderSec)} sur {formatMinutes(pic.endTime)}
        </Row>
        <Row label="Victoire du défenseur">à partir de {formatMinutes(o.defenderWinsAtSec)}</Row>
        <Row label="Victoire du challenger">en dessous de {formatMinutes(o.challengerWinsBelowSec)}</Row>
      </dl>
      <p className="hint">Estimation fondée sur vos seuls capteurs. Le décompte réel est révélé au compte rendu.</p>
      {pic.bases.map((b) => (
        <p key={b.id} className="muted">
          {b.closed
            ? `${b.name} : hors service.`
            : b.supplyStock > 0 && b.fuelStockKg <= 0
              ? `${b.name} : ${Math.round(b.supplyStock)} points de ravitaillement.`
              : `Stocks de ${b.name} : ${b.weaponStock} missiles air-air, ${b.asmStock} munitions air-surface.`}
        </p>
      ))}

      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={() => onPlan({})}>
          Nouvelle mission
        </button>
      </div>

      <EffectsPanel pic={pic} onOrder={onOrder} />

      <details className="fold" open>
        <summary>Briefing</summary>
        <p>{briefing}</p>
      </details>

      <details className="fold">
        <summary>Doctrine : {doctrine.name}</summary>
        <p className="muted">{doctrine.description}</p>
        <ul className="facts2">
          {DOCTRINE_KEYS.map((k) => (
            <li key={k}>
              <span>{DOCTRINE_KEY_INFO[k].label}</span>
              <b>{Math.round(pic.doctrine[k] * 100)} %</b>
              <small>
                {DOCTRINE_KEY_INFO[k].effect} <em className={`tag tag--c${doctrine.params[k].classification}`}>{CLASSIFICATION_LABELS[doctrine.params[k].classification]}</em> {doctrine.params[k].basis}
              </small>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function DetailPanel(props: DetailProps) {
  const { pic, selection } = props;
  if (selection?.type === 'unit') {
    const unit = pic.units.find((u) => u.id === selection.id);
    if (unit) return <UnitSheet {...props} unit={unit} />;
  }
  if (selection?.type === 'mission') {
    const mission = pic.missions.find((m) => m.id === selection.id);
    if (mission) return <MissionSheet {...props} mission={mission} />;
  }
  if (selection?.type === 'contact') {
    const contact = pic.contacts.find((c) => c.id === selection.id);
    if (contact) return <ContactSheet {...props} contact={contact} />;
    return (
      <div className="sheet">
        <p className="sheet__eyebrow">Renseignement</p>
        <h2>{selection.id}</h2>
        <p className="muted">Cette piste n’est plus suivie.</p>
      </div>
    );
  }
  return <Overview {...props} />;
}
