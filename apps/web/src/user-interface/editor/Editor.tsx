'use client';

/**
 * Éditeur de missions.
 *
 * L'écran ne contient aucune règle : chaque geste appelle une opération du paquet
 * `mission-editor`, qui retourne un nouveau brouillon ou un refus motivé, et la vérification
 * (`checkScenario`) est recalculée à chaque modification.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { clockZ, isGroundForce, isNaval, TERRAIN, UNIT_KINDS, type Difficulty, type LatLon, type Roe, type SideId, type TerrainKind, type UnitKind } from '@warcommand/simulation-core';
import { MISSION_KIND } from '@warcommand/air-operations';
import { INITIAL_POSTURES } from '@warcommand/ai-commander';
import { DOCTRINE_KEY_INFO, DOCTRINE_KEYS, DOCTRINES, hasDoctrine, getDoctrine } from '@warcommand/doctrine-engine';
import {
  addBase,
  addGroup,
  addMission,
  addSatellite,
  addTerrain,
  addTrigger,
  addUnit,
  checkScenario,
  DEFAULT_ALTITUDE_M,
  INITIAL_MISSION_TYPES,
  moveUnit,
  quickTest,
  removeBase,
  removeGroup,
  removeMission,
  removeSatellite,
  removeTerrain,
  removeTrigger,
  removeUnit,
  renameGroup,
  setIntel,
  setMeta,
  setNavalZone,
  setObjective,
  setRegion,
  setSide,
  updateBase,
  updateMission,
  updateSatellite,
  updateTerrain,
  updateUnit,
  type EditResult,
  type InitialMissionType,
  type QuickTestResult,
} from '@warcommand/mission-editor';
import { parseScenario, type Scenario } from '@warcommand/scenario-system';
import { getPlatform, hasPlatform, JOINT_STAT_LABELS, libraryGroups, type JointStatKey } from '@warcommand/unit-database';
import { MapView, type MapViewState } from '../../world-map/MapView';
import { groundFrame, sceneFromScenario, type Selection } from '../../world-map/scene';
import { downloadJson } from '../controller';
import { scenarioFileName } from '../scenarioStore';
import {
  CONDITION_LABEL,
  CONTROL_LABEL,
  describeAction,
  describeCondition,
  DIFFICULTY_LABEL,
  formatLatLon,
  KIND_LABEL,
  MISSION_TYPE_LABEL,
  POSTURE_LABEL,
  ROE_LABEL,
  SIDE_LABEL,
  TERRAIN_LABEL,
} from '../i18n';
import { EditNumber, EditText } from './fields';

interface Props {
  initial: Scenario;
  /** Le brouillon porte déjà des modifications non enregistrées (retour d'un essai en jeu, copie). */
  initialDirty?: boolean;
  /** Le brouillon a changé : l'application le garde pour y revenir après un essai en jeu. */
  onDraftChange: (draft: Scenario) => void;
  onPlay: (scenario: Scenario, side: SideId, difficulty: Difficulty) => void;
  /** Enregistre le brouillon ; `false` si le stockage du navigateur est indisponible. */
  onSave: (draft: Scenario) => boolean;
  onQuit: () => void;
}

type Section = 'scenario' | 'coalitions' | 'forces' | 'missions' | 'objectif' | 'terrain' | 'declencheurs';
const SECTIONS: [Section, string][] = [
  ['scenario', 'Scénario'],
  ['coalitions', 'Coalitions'],
  ['forces', 'Forces'],
  ['missions', 'Missions'],
  ['objectif', 'Objectif'],
  ['terrain', 'Terrain'],
  ['declencheurs', 'Déclencheurs'],
];

type Tool =
  | { type: 'none' }
  | { type: 'base'; side: SideId }
  | { type: 'unit'; side: SideId; platformId: string; airborne: boolean; remaining: number }
  | { type: 'move'; target: Exclude<Selection, null> }
  | { type: 'objective' }
  | { type: 'zone'; side: SideId }
  | { type: 'waypoints' }
  | { type: 'patrol'; unitId: string; points: LatLon[] }
  | { type: 'trigger-zone' }
  /** Pose une zone de terrain, ou déplace celle dont `id` est donné. */
  | { type: 'terrain'; kind: TerrainKind; id?: string }
  /** Pose l'empreinte d'un satellite, ou déplace celle dont `id` est donné. */
  | { type: 'satellite'; side: SideId; id?: string };

interface MissionForm {
  index: number | null;
  side: SideId;
  type: InitialMissionType;
  name: string;
  unitIds: string[];
  waypoints: LatLon[];
  altM: number;
  launchAtMin: number;
  endAtMin: number | null;
  roe: Roe;
  allowRefuel: boolean;
  emcon: boolean;
  humanOnly: boolean;
}

type ConditionType = keyof typeof CONDITION_LABEL;

interface TriggerForm {
  condition: ConditionType;
  atMin: number;
  side: SideId;
  kind: UnitKind;
  count: number;
  zoneCenter: LatLon | null;
  zoneRadiusKm: number;
  groupId: string;
  status: 'BLUE' | 'RED' | 'CONTESTED';
  action: 'MESSAGE' | 'END_MISSION';
  text: string;
  toBlue: boolean;
  toRed: boolean;
  winner: 'BLUE' | 'RED' | 'DRAW';
}

const SIDE_LIST: SideId[] = ['BLUE', 'RED'];
const ROES: Roe[] = ['hold', 'defensive', 'free'];
const DIFFICULTIES: Difficulty[] = ['recrue', 'standard', 'veteran'];
const KINDS: readonly UnitKind[] = UNIT_KINDS;
const TERRAIN_KINDS: TerrainKind[] = ['urbain', 'foret', 'montagne', 'marais'];
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const factor = (value: number) => `×${String(value).replace('.', ',')}`;
/** Ce qu'une zone de terrain change, en clair (valeurs de jeu). */
const terrainEffect = (kind: TerrainKind) =>
  `Vitesse ${factor(TERRAIN[kind].mobility)} · protection du défenseur ${factor(TERRAIN[kind].defence)} · distance d’observation ${factor(TERRAIN[kind].concealment)}.`;
const ALTITUDES = [500, 3000, 6000, 7500, 8000, 8800, 9000, 11000];
const tone = (side: SideId) => (side === 'BLUE' ? 'blue' : 'red');
const kindOf = (platformId: string): UnitKind | null => (hasPlatform(platformId) ? getPlatform(platformId).kind : null);
const isAircraft = (platformId: string) => hasPlatform(platformId) && getPlatform(platformId).domain === 'air';
const liftOf = (platformId: string) => (hasPlatform(platformId) ? (getPlatform(platformId).joint?.lift?.value ?? 0) : 0);

const blankMission = (draft: Scenario, side: SideId): MissionForm => ({
  index: null,
  side,
  type: 'CAP',
  name: '',
  unitIds: [],
  waypoints: [],
  altM: 9000,
  launchAtMin: 0,
  endAtMin: null,
  roe: draft.sides[side].defaultRoe,
  allowRefuel: false,
  emcon: false,
  humanOnly: false,
});

const blankTrigger = (draft: Scenario): TriggerForm => ({
  condition: 'TIME_ELAPSED',
  atMin: Math.round(draft.durationMin / 2),
  side: 'RED',
  kind: 'fighter',
  count: 2,
  zoneCenter: null,
  zoneRadiusKm: 100,
  groupId: draft.groups[0]?.id ?? '',
  status: 'CONTESTED',
  action: 'MESSAGE',
  text: '',
  toBlue: true,
  toRed: true,
  winner: 'DRAW',
});

export function Editor({ initial, initialDirty = false, onDraftChange, onPlay, onSave, onQuit }: Props) {
  const [draft, setDraftState] = useState(initial);
  const [dirty, setDirty] = useState(initialDirty);
  const [section, setSection] = useState<Section>('forces');
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>({ type: 'none' });
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [forcesSide, setForcesSide] = useState<SideId>('BLUE');
  const [libraryId, setLibraryId] = useState('rafale');
  const [libraryCount, setLibraryCount] = useState(1);
  const [libraryAirborne, setLibraryAirborne] = useState(false);
  const [terrainKind, setTerrainKind] = useState<TerrainKind>('urbain');
  const [mission, setMission] = useState<MissionForm>(() => blankMission(initial, 'BLUE'));
  const [trigger, setTrigger] = useState<TriggerForm>(() => blankTrigger(initial));
  const [test, setTest] = useState<QuickTestResult | 'running' | null>(null);
  const [playSide, setPlaySide] = useState<SideId>('BLUE');
  const [playDifficulty, setPlayDifficulty] = useState<Difficulty>(initial.difficulty);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const view = useRef<MapViewState | null>(null);
  // Objectif terrestre : on ouvre sur ses abords plutôt que sur tout le théâtre.
  const initialFit = useRef((initial.objective.kind === 'ground' ? groundFrame(initial.objective.center) : undefined) ?? initial.region.bounds);

  const check = useMemo(() => checkScenario(draft), [draft]);
  const say = (text: string, bad = false) => setNotice({ text, bad });

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTool({ type: 'none' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setDraft = (next: Scenario) => {
    setDraftState(next);
    setDirty(true);
    setTest(null);
    onDraftChange(next);
  };

  /** Applique le résultat d'une opération d'édition ; affiche le motif en cas de refus. */
  const apply = (result: EditResult): boolean => {
    if (!result.ok) {
      say(result.error, true);
      return false;
    }
    setDraft(result.draft);
    setNotice((n) => (n?.bad ? null : n));
    return true;
  };

  /* ---------------------------------------------------------------- Carte */

  const draftPoints = tool.type === 'patrol' ? tool.points : section === 'missions' ? mission.waypoints : [];
  const scene = useMemo(
    () => sceneFromScenario(draft, { selection, draft: draftPoints, highlightMission: section === 'missions' ? mission.index : null }),
    [draft, selection, draftPoints, section, mission.index],
  );

  const onMapClick = (pos: LatLon) => {
    switch (tool.type) {
      case 'base': {
        const res = addBase(draft, { side: tool.side, pos });
        if (apply(res) && res.ok && res.id) setSelection({ type: 'base', id: res.id });
        setTool({ type: 'none' });
        return;
      }
      case 'unit': {
        const res = addUnit(draft, { side: tool.side, platformId: tool.platformId, pos, airborne: tool.airborne });
        if (!apply(res)) {
          setTool({ type: 'none' });
          return;
        }
        if (res.ok && res.id) setSelection({ type: 'unit', id: res.id });
        setTool(tool.remaining > 1 ? { ...tool, remaining: tool.remaining - 1 } : { type: 'none' });
        return;
      }
      case 'move': {
        const res = tool.target.type === 'base' ? updateBase(draft, tool.target.id, { pos }) : moveUnit(draft, tool.target.id, pos);
        apply(res);
        setTool({ type: 'none' });
        return;
      }
      case 'objective':
        apply(setObjective(draft, { center: pos }));
        setTool({ type: 'none' });
        return;
      case 'zone':
        apply(setNavalZone(draft, tool.side, { center: pos, radiusKm: draft.navalZones[tool.side]?.radiusKm ?? 60 }));
        setTool({ type: 'none' });
        return;
      case 'waypoints':
        if (mission.waypoints.length >= 8) say('Huit points au maximum.', true);
        else setMission({ ...mission, waypoints: [...mission.waypoints, pos] });
        return;
      case 'patrol':
        if (tool.points.length >= 8) say('Huit points au maximum.', true);
        else setTool({ ...tool, points: [...tool.points, pos] });
        return;
      case 'trigger-zone':
        setTrigger({ ...trigger, zoneCenter: pos });
        setTool({ type: 'none' });
        return;
      case 'terrain':
        apply(tool.id ? updateTerrain(draft, tool.id, { center: pos }) : addTerrain(draft, { kind: tool.kind, center: pos }));
        setTool({ type: 'none' });
        return;
      case 'satellite':
        apply(tool.id ? updateSatellite(draft, tool.id, { center: pos }) : addSatellite(draft, { side: tool.side, center: pos }));
        setTool({ type: 'none' });
        return;
      default:
        setSelection(null);
    }
  };

  const onSelect = (sel: Selection) => {
    if (!sel || (sel.type !== 'unit' && sel.type !== 'base')) return;
    setSelection(sel);
    const side = sel.type === 'unit' ? draft.units.find((u) => u.id === sel.id)?.side : draft.bases.find((b) => b.id === sel.id)?.side;
    if (side) setForcesSide(side);
  };

  const toolHint: Record<Tool['type'], string> = {
    none: '',
    base: 'Cliquez l’emplacement de la base',
    unit: tool.type === 'unit' ? `Cliquez pour poser l’unité (${tool.remaining} à placer)` : '',
    move: 'Cliquez la nouvelle position',
    objective: 'Cliquez le centre du secteur d’objectif',
    zone: 'Cliquez le centre de la zone de manœuvre maritime',
    waypoints: `Cliquez les points de la mission (${mission.waypoints.length} posé${mission.waypoints.length > 1 ? 's' : ''}) · Échap ou « Terminer » pour finir`,
    patrol: tool.type === 'patrol' ? `Cliquez les points de la patrouille (${tool.points.length} posé${tool.points.length > 1 ? 's' : ''}), puis terminez` : '',
    'trigger-zone': 'Cliquez le centre de la zone du déclencheur',
    terrain: 'Cliquez le centre de la zone de terrain',
    satellite: 'Cliquez le centre de l’empreinte du satellite',
  };

  /* ---------------------------------------------------------------- Section : scénario */

  const dateLocal = draft.date.slice(0, 16);
  const renderScenario = () => (
    <div className="sheet">
      <EditText label="Titre" value={draft.title} onCommit={(v) => apply(setMeta(draft, { title: v }))} />
      <EditText label="Description" multiline value={draft.description} onCommit={(v) => apply(setMeta(draft, { description: v }))} />
      <div className="grid2">
        <label className="field">
          <span>Début (UTC)</span>
          <input
            className="input input--small"
            type="datetime-local"
            value={dateLocal}
            onChange={(e) => {
              if (e.target.value) apply(setMeta(draft, { date: `${e.target.value}:00Z` }));
            }}
          />
        </label>
        <EditNumber label="Durée" suffix="min" value={draft.durationMin} onCommit={(v) => apply(setMeta(draft, { durationMin: v }))} />
      </div>
      <EditText label="Période" value={draft.period} onCommit={(v) => apply(setMeta(draft, { period: v }))} />
      <EditText label="Météo" value={draft.weather.label} onCommit={(v) => apply(setMeta(draft, { weatherLabel: v }))} />
      <label className="field">
        <span>Effet de la météo sur les capteurs : {Math.round(draft.weather.sensorFactor * 100)} %</span>
        <input type="range" min={30} max={120} step={5} value={Math.round(draft.weather.sensorFactor * 100)} onChange={(e) => apply(setMeta(draft, { sensorFactor: Number(e.target.value) / 100 }))} />
        <small className="hint">Multiplie la portée de tous les radars. 100 % : temps clair.</small>
      </label>
      <div className="grid2">
        <EditNumber wide label="Graine" value={draft.seed} onCommit={(v) => apply(setMeta(draft, { seed: v }))} />
        <label className="field">
          <span>Difficulté par défaut</span>
          <select className="input input--small" value={draft.difficulty} onChange={(e) => apply(setMeta(draft, { difficulty: e.target.value as Difficulty }))}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h4>Région</h4>
      <EditText label="Nom" value={draft.region.name} onCommit={(v) => apply(setMeta(draft, { regionName: v }))} />
      <p className="muted">
        De {formatLatLon(draft.region.bounds.south, draft.region.bounds.west)} à {formatLatLon(draft.region.bounds.north, draft.region.bounds.east)}.
      </p>
      <button
        type="button"
        className="btn btn--small"
        onClick={() => {
          if (!view.current) return;
          if (apply(setRegion(draft, view.current))) say('La région du scénario est maintenant la vue affichée.');
        }}
      >
        Prendre la vue actuelle de la carte comme région
      </button>
      <p className="hint">Déplacez et zoomez la carte où vous voulez dans le monde, puis cadrez. Tout ce qui est déjà posé doit rester dans la région.</p>
    </div>
  );

  /* ---------------------------------------------------------------- Section : coalitions */

  const renderCoalitions = () => (
    <div className="sheet">
      {SIDE_LIST.map((side) => {
        const def = draft.sides[side];
        const profile = hasDoctrine(def.doctrineId) ? getDoctrine(def.doctrineId) : null;
        const role = draft.objective.defender === side ? 'defender' : 'challenger';
        const overridden = Object.keys(def.doctrineOverrides).length > 0;
        return (
          <section key={side} className="subcard">
            <h3 className={`txt--${tone(side)}`}>
              {SIDE_LABEL[side]} — {role === 'defender' ? 'défenseur' : 'challenger'}
            </h3>
            <EditText label="Nom" value={def.name} onCommit={(v) => apply(setSide(draft, side, { name: v }))} />
            <EditText label="Description" value={def.description} onCommit={(v) => apply(setSide(draft, side, { description: v }))} />
            <label className="field">
              <span>Doctrine</span>
              <select className="input input--small" value={def.doctrineId} onChange={(e) => apply(setSide(draft, side, { doctrineId: e.target.value, doctrineOverrides: {} }))}>
                {Object.values(DOCTRINES).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <small className="hint">Indépendante du camp et du matériel. Les réglages ci-dessous s’appliquent par-dessus le profil.</small>
            </label>
            {profile
              ? DOCTRINE_KEYS.map((key) => {
                  const value = def.doctrineOverrides[key] ?? profile.params[key].value;
                  return (
                    <label key={key} className="field" title={DOCTRINE_KEY_INFO[key].effect}>
                      <span>
                        {DOCTRINE_KEY_INFO[key].label} : {Math.round(value * 100)} %{def.doctrineOverrides[key] !== undefined ? ' (modifié)' : ''}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(value * 100)}
                        onChange={(e) => apply(setSide(draft, side, { doctrineOverrides: { ...def.doctrineOverrides, [key]: Number(e.target.value) / 100 } }))}
                      />
                    </label>
                  );
                })
              : null}
            {overridden ? (
              <button type="button" className="btn btn--small" onClick={() => apply(setSide(draft, side, { doctrineOverrides: {} }))}>
                Rétablir le profil
              </button>
            ) : null}
            <label className="field">
              <span>Règles d’engagement par défaut</span>
              <select className="input input--small" value={def.defaultRoe} onChange={(e) => apply(setSide(draft, side, { defaultRoe: e.target.value as Roe }))}>
                {ROES.map((r) => (
                  <option key={r} value={r}>
                    {ROE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <EditText label="Briefing du joueur" multiline rows={4} value={def.briefing} onCommit={(v) => apply(setSide(draft, side, { briefing: v }))} />
            <label className="field">
              <span>Comportement initial de l’IA</span>
              <select
                className="input input--small"
                value={def.aiInitialPosture ?? ''}
                onChange={(e) =>
                  apply(
                    setSide(draft, side, e.target.value === '' ? { aiInitialPosture: null } : { aiInitialPosture: e.target.value as NonNullable<typeof def.aiInitialPosture>, aiPostureLockMin: def.aiPostureLockMin || 15 }),
                  )
                }
              >
                <option value="">Libre : l’IA choisit sa posture</option>
                {INITIAL_POSTURES[role].map((p) => (
                  <option key={p} value={p}>
                    {POSTURE_LABEL[p] ?? p}
                  </option>
                ))}
              </select>
              <small className="hint">Ne joue que si ce camp est confié à l’IA. « Repli » la retient au sol.</small>
            </label>
            {def.aiInitialPosture !== null ? (
              <EditNumber label="Posture tenue pendant" suffix="min" value={def.aiPostureLockMin} onCommit={(v) => apply(setSide(draft, side, { aiPostureLockMin: v }))} />
            ) : null}
            <h4>Réseaux et effets multi-domaines</h4>
            <label className="field">
              <span>Résilience des réseaux et services : {Math.round(def.resilience * 100)} %</span>
              <input type="range" min={0} max={100} step={5} value={Math.round(def.resilience * 100)} onChange={(e) => apply(setSide(draft, side, { resilience: Number(e.target.value) / 100 }))} />
              <small className="hint">Raccourcit les perturbations subies et accélère le rétablissement.</small>
            </label>
            <div className="grid2">
              <EditNumber label="Perturbations des réseaux adverses" value={def.effects.cyber} onCommit={(v) => apply(setSide(draft, side, { effects: { ...def.effects, cyber: v } }))} />
              <EditNumber label="Brouillages des services spatiaux adverses" value={def.effects.jam} onCommit={(v) => apply(setSide(draft, side, { effects: { ...def.effects, jam: v } }))} />
            </div>
            <p className="hint">Effets abstraits et temporaires, de zéro à cinq de chaque sorte, que ce camp pourra employer en cours de partie.</p>
          </section>
        );
      })}
    </div>
  );

  /* ---------------------------------------------------------------- Section : forces */

  const record = hasPlatform(libraryId) ? getPlatform(libraryId) : null;
  const sideBases = draft.bases.filter((b) => b.side === forcesSide);

  /** Aéronefs au sol et équipes spéciales : rattachés d'emblée à une base du camp, sans passer par la carte. */
  const toBase = record ? (record.domain === 'air' && !libraryAirborne) || record.kind === 'sof' : false;
  const addFromLibrary = () => {
    if (!record) return;
    if (toBase) {
      const base = sideBases[0];
      if (!base) {
        say(`Ajoutez d’abord une base pour ce camp : ${record.kind === 'sof' ? 'une équipe spéciale part d’une base' : 'un aéronef doit être rattaché à une base'}.`, true);
        return;
      }
      // La base sélectionnée si elle est de ce camp ; sinon le moteur d'édition choisit la plus proche qui convient.
      const chosen = selection?.type === 'base' && sideBases.some((b) => b.id === selection.id) ? selection.id : undefined;
      let next = draft;
      let lastId: string | undefined;
      for (let i = 0; i < libraryCount; i++) {
        const res = addUnit(next, { side: forcesSide, platformId: record.id, pos: base.pos, ...(chosen ? { baseId: chosen } : {}) });
        if (!res.ok) {
          say(res.error, true);
          break;
        }
        next = res.draft;
        lastId = res.id;
      }
      if (next !== draft) setDraft(next);
      if (lastId) setSelection({ type: 'unit', id: lastId });
      return;
    }
    setTool({ type: 'unit', side: forcesSide, platformId: record.id, airborne: record.domain === 'air', remaining: libraryCount });
  };

  const renderForces = () => (
    <div className="sheet">
      <div className="chips" role="group" aria-label="Camp">
        {SIDE_LIST.map((side) => (
          <button key={side} type="button" className={`chip${forcesSide === side ? ' is-on' : ''}`} aria-pressed={forcesSide === side} onClick={() => setForcesSide(side)}>
            {SIDE_LABEL[side]} · {draft.units.filter((u) => u.side === side).length} unité{draft.units.filter((u) => u.side === side).length > 1 ? 's' : ''}
          </button>
        ))}
      </div>

      <h4>Bibliothèque des forces</h4>
      <label className="field">
        <span>Matériel</span>
        <select
          className="input input--small"
          value={libraryId}
          onChange={(e) => {
            setLibraryId(e.target.value);
            setLibraryAirborne(false);
          }}
        >
          {libraryGroups().map((g) => (
            <optgroup key={g.coalition} label={g.label}>
              {g.records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {KIND_LABEL[r.kind].toLowerCase()}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {record ? (
        <p className="muted">
          {record.role} · {record.generic ? 'matériel générique, sans équivalent réel' : record.country}.{' '}
          {[
            record.game.radarRangeKm.value > 0 ? `Radar ${record.game.radarRangeKm.value} km` : null,
            record.game.weaponCount.value > 0 ? `${record.game.weaponCount.value} missiles de ${record.game.weaponRangeKm.value} km` : null,
            record.loadouts.some((l) => l.asm > 0) ? 'emport air-surface possible' : null,
            ...Object.entries(record.joint ?? {}).flatMap(([key, datum]) => {
              const info = JOINT_STAT_LABELS[key as JointStatKey];
              return datum ? [`${info.label.toLowerCase()} : ${datum.value}${info.unit ? ` ${info.unit}` : ''}`] : [];
            }),
          ]
            .filter(Boolean)
            .join(' · ')}
          . Valeurs de jeu.
        </p>
      ) : null}
      <div className="row">
        <label className="row">
          <span className="muted">Nombre</span>
          <select className="input input--small numselect" value={libraryCount} onChange={(e) => setLibraryCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {record?.domain === 'air' ? (
          <label className="check check--inline">
            <input type="checkbox" checked={libraryAirborne} onChange={() => setLibraryAirborne(!libraryAirborne)} />
            <span>déjà en vol</span>
          </label>
        ) : null}
      </div>
      <button type="button" className="btn btn--primary" onClick={addFromLibrary}>
        {toBase ? `Ajouter à une base ${SIDE_LABEL[forcesSide]}` : `Placer sur la carte (${SIDE_LABEL[forcesSide]})`}
      </button>

      <h4>Bases</h4>
      {sideBases.length === 0 ? <p className="muted">Aucune base. Un aéronef ou une équipe spéciale doit être rattaché à une base.</p> : null}
      {sideBases.map((b) => (
        <button key={b.id} type="button" className={`unitrow${selection?.type === 'base' && selection.id === b.id ? ' is-selected' : ''}`} onClick={() => setSelection({ type: 'base', id: b.id })}>
          <span className={`dot dot--${tone(b.side)}`} aria-hidden="true" />
          <span className="unitrow__name">{b.name}</span>
          <span className="unitrow__state">
            {b.hostUnitId !== undefined ? 'embarquée · ' : ''}
            {draft.units.filter((u) => u.baseId === b.id).length} unité(s)
          </span>
        </button>
      ))}
      <button type="button" className={`btn btn--small${tool.type === 'base' ? ' is-on' : ''}`} onClick={() => setTool(tool.type === 'base' ? { type: 'none' } : { type: 'base', side: forcesSide })}>
        Ajouter une base {SIDE_LABEL[forcesSide]}
      </button>

      <h4>Groupes et unités</h4>
      {draft.groups
        .filter((g) => g.side === forcesSide)
        .map((g) => {
          const units = draft.units.filter((u) => u.groupId === g.id);
          return (
            <div key={g.id} className="group">
              <div className="row row--tight">
                <EditText small ariaLabel="Nom du groupe" value={g.name} onCommit={(v) => apply(renameGroup(draft, g.id, v))} />
                {units.length === 0 ? (
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => apply(removeGroup(draft, g.id))}>
                    Supprimer
                  </button>
                ) : null}
              </div>
              {units.map((u) => (
                <button key={u.id} type="button" className={`unitrow${selection?.type === 'unit' && selection.id === u.id ? ' is-selected' : ''}`} onClick={() => setSelection({ type: 'unit', id: u.id })}>
                  <span className={`dot dot--${u.airborne ? 'airborne' : isAircraft(u.platformId) ? 'ready' : 'active'}`} aria-hidden="true" />
                  <span className="unitrow__name">{u.name}</span>
                  <span className="unitrow__state">
                    {u.airborne
                      ? 'en vol'
                      : isAircraft(u.platformId)
                        ? u.unavailableForMin
                          ? `indispo. ${u.unavailableForMin} min`
                          : 'au sol'
                        : u.embarkedIn !== undefined
                          ? 'à bord'
                          : kindOf(u.platformId) === 'sof'
                            ? 'à sa base'
                            : 'en position'}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      <button type="button" className="btn btn--small" onClick={() => apply(addGroup(draft, { side: forcesSide }))}>
        Ajouter un groupe
      </button>
    </div>
  );

  /* ---------------------------------------------------------------- Section : missions */

  const missionCandidates = draft.units.filter((u) => u.side === mission.side && kindOf(u.platformId) === MISSION_KIND[mission.type]);
  const submitMission = () => {
    const common = {
      type: mission.type,
      unitIds: mission.unitIds,
      waypoints: mission.waypoints,
      altM: mission.altM,
      launchAtMin: mission.launchAtMin,
      roe: mission.roe,
      allowRefuel: mission.allowRefuel,
      emcon: mission.emcon,
      humanOnly: mission.humanOnly,
    };
    const res =
      mission.index === null
        ? addMission(draft, { ...common, side: mission.side, name: mission.name || undefined, endAtMin: mission.endAtMin ?? undefined })
        : updateMission(draft, mission.index, { ...common, name: mission.name || undefined, endAtMin: mission.endAtMin ?? undefined });
    if (apply(res)) {
      setMission(blankMission(draft, mission.side));
      setTool({ type: 'none' });
    }
  };

  const renderMissions = () => (
    <div className="sheet">
      <p className="hint">Missions déjà ordonnées au début du scénario. Les autres seront décidées en jeu, par le joueur ou par l’IA.</p>
      {draft.missions.length === 0 ? <p className="muted">Aucune mission initiale.</p> : null}
      {draft.missions.map((m, index) => (
        <div key={index} className={`listrow${mission.index === index ? ' is-selected' : ''}`}>
          <span>
            <b className={`txt--${tone(m.side)}`}>{m.name ?? `${MISSION_TYPE_LABEL[m.type]} ${index + 1}`}</b>
            <small>
              {MISSION_TYPE_LABEL[m.type]} · {m.unitIds.length} appareil(s) · départ {clockZ(draft.date, m.launchAtMin * 60, false)} Z{m.humanOnly ? ' · joueur seulement' : ''}
            </small>
          </span>
          <button
            type="button"
            className="btn btn--small"
            onClick={() =>
              setMission({
                index,
                side: m.side,
                type: m.type,
                name: m.name ?? '',
                unitIds: [...m.unitIds],
                waypoints: m.waypoints.map((w) => ({ ...w })),
                altM: m.altM,
                launchAtMin: m.launchAtMin,
                endAtMin: m.endAtMin ?? null,
                roe: m.roe,
                allowRefuel: m.allowRefuel,
                emcon: m.emcon,
                humanOnly: m.humanOnly,
              })
            }
          >
            Modifier
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => {
              if (apply(removeMission(draft, index))) setMission(blankMission(draft, mission.side));
            }}
          >
            Supprimer
          </button>
        </div>
      ))}

      <h4>{mission.index === null ? 'Nouvelle mission initiale' : 'Modifier la mission'}</h4>
      <div className="grid2">
        <label className="field">
          <span>Camp</span>
          <select
            className="input input--small"
            value={mission.side}
            disabled={mission.index !== null}
            onChange={(e) => setMission({ ...blankMission(draft, e.target.value as SideId), type: mission.type, altM: mission.altM })}
          >
            {SIDE_LIST.map((s) => (
              <option key={s} value={s}>
                {SIDE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select
            className="input input--small"
            value={mission.type}
            onChange={(e) => {
              const type = e.target.value as InitialMissionType;
              setMission({ ...mission, type, unitIds: [], altM: DEFAULT_ALTITUDE_M[MISSION_KIND[type]] });
            }}
          >
            {INITIAL_MISSION_TYPES.map((t) => (
              <option key={t} value={t}>
                {MISSION_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Nom (facultatif)</span>
        <input className="input input--small" value={mission.name} onChange={(e) => setMission({ ...mission, name: e.target.value })} />
      </label>
      <fieldset className="field">
        <legend>Appareils</legend>
        {missionCandidates.length === 0 ? <p className="muted">Ce camp n’a aucun appareil pour ce type de mission.</p> : null}
        {missionCandidates.map((u) => (
          <label key={u.id} className="check">
            <input
              type="checkbox"
              checked={mission.unitIds.includes(u.id)}
              onChange={() => setMission({ ...mission, unitIds: mission.unitIds.includes(u.id) ? mission.unitIds.filter((x) => x !== u.id) : [...mission.unitIds, u.id] })}
            />
            <span>{u.name}</span>
            <small>{u.airborne ? 'en vol' : 'au sol'}</small>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <span>{mission.type === 'SWEEP' ? 'Route' : 'Station'}</span>
        <div className="row">
          <strong>{mission.waypoints.length === 0 ? 'Aucun point' : `${mission.waypoints.length} point${mission.waypoints.length > 1 ? 's' : ''}`}</strong>
          <button type="button" className={`btn btn--small${tool.type === 'waypoints' ? ' is-on' : ''}`} onClick={() => setTool(tool.type === 'waypoints' ? { type: 'none' } : { type: 'waypoints' })}>
            {tool.type === 'waypoints' ? 'Terminer' : 'Placer sur la carte'}
          </button>
          <button type="button" className="btn btn--small" disabled={mission.waypoints.length === 0} onClick={() => setMission({ ...mission, waypoints: [] })}>
            Effacer
          </button>
        </div>
      </div>
      <div className="grid2">
        <label className="field">
          <span>Altitude</span>
          <select className="input input--small" value={mission.altM} onChange={(e) => setMission({ ...mission, altM: Number(e.target.value) })}>
            {ALTITUDES.map((a) => (
              <option key={a} value={a}>
                {a.toLocaleString('fr-FR')} m
              </option>
            ))}
          </select>
        </label>
        <EditNumber label="Départ après" suffix="min" value={mission.launchAtMin} onCommit={(v) => (v >= 0 ? (setMission({ ...mission, launchAtMin: v }), true) : false)} />
        <EditNumber
          label="Fin de créneau"
          suffix="min"
          hint="0 : sans limite"
          value={mission.endAtMin ?? 0}
          onCommit={(v) => (v >= 0 ? (setMission({ ...mission, endAtMin: v === 0 ? null : v }), true) : false)}
        />
        {mission.type === 'CAP' || mission.type === 'SWEEP' ? (
          <label className="field">
            <span>Règles d’engagement</span>
            <select className="input input--small" value={mission.roe} onChange={(e) => setMission({ ...mission, roe: e.target.value as Roe })}>
              {ROES.map((r) => (
                <option key={r} value={r}>
                  {ROE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <label className="check check--inline">
        <input type="checkbox" checked={mission.allowRefuel} onChange={() => setMission({ ...mission, allowRefuel: !mission.allowRefuel })} />
        <span>Ravitaillement en vol autorisé</span>
      </label>
      <label className="check check--inline">
        <input type="checkbox" checked={mission.emcon} onChange={() => setMission({ ...mission, emcon: !mission.emcon })} />
        <span>Silence radar</span>
      </label>
      <label className="check check--wrap">
        <input type="checkbox" checked={mission.humanOnly} onChange={() => setMission({ ...mission, humanOnly: !mission.humanOnly })} />
        <span>Proposée au joueur seulement</span>
        <small>ignorée si ce camp est confié à l’IA, qui planifie elle-même</small>
      </label>
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={submitMission}>
          {mission.index === null ? 'Ajouter la mission' : 'Enregistrer les modifications'}
        </button>
        {mission.index !== null ? (
          <button type="button" className="btn" onClick={() => setMission(blankMission(draft, mission.side))}>
            Abandonner
          </button>
        ) : null}
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- Section : objectif */

  const o = draft.objective;
  const renderObjective = () => (
    <div className="sheet">
      <EditText label="Nom du secteur" value={o.name} onCommit={(v) => apply(setObjective(draft, { name: v }))} />
      <label className="field">
        <span>Nature de l’objectif</span>
        <select className="input input--small" value={o.kind} onChange={(e) => apply(setObjective(draft, { kind: e.target.value as 'air' | 'ground' }))}>
          <option value="air">Secteur aérien — disputé par la chasse</option>
          <option value="ground">Zone terrestre — tenue par les formations de mêlée</option>
        </select>
        <small className="hint">
          {o.kind === 'ground'
            ? 'La zone revient au camp dont les formations de mêlée présentes sont nettement les plus fortes (une fois et demie l’adversaire) ; à forces comparables, elle est contestée.'
            : 'Le secteur revient au camp qui y maintient seul des chasseurs en état de combattre.'}
        </small>
      </label>
      <label className="field">
        <span>Défenseur</span>
        <select
          className="input input--small"
          value={o.defender}
          onChange={(e) => {
            const imposed = SIDE_LIST.some((s) => draft.sides[s].aiInitialPosture !== null);
            if (apply(setObjective(draft, { defender: e.target.value as SideId })) && imposed) {
              say('Rôles inversés : les comportements initiaux imposés à l’IA ont été retirés (onglet Coalitions).');
            }
          }}
        >
          {SIDE_LIST.map((s) => (
            <option key={s} value={s}>
              {SIDE_LABEL[s]} défend, {SIDE_LABEL[s === 'BLUE' ? 'RED' : 'BLUE']} conteste
            </option>
          ))}
        </select>
        <small className="hint">Un secteur vide reste acquis à son dernier détenteur ; il appartient au défenseur au départ.</small>
      </label>
      <p className="muted">Centre : {formatLatLon(o.center.lat, o.center.lon)}</p>
      <div className="row">
        <button type="button" className={`btn btn--small${tool.type === 'objective' ? ' is-on' : ''}`} onClick={() => setTool(tool.type === 'objective' ? { type: 'none' } : { type: 'objective' })}>
          Placer le centre sur la carte
        </button>
      </div>
      <EditNumber label="Rayon" suffix="km" value={o.radiusKm} onCommit={(v) => apply(setObjective(draft, { radiusKm: v }))} />
      <h4>Conditions de victoire</h4>
      <EditNumber label="Le défenseur gagne à partir de" suffix={`min de contrôle sur ${draft.durationMin}`} value={o.defenderWinsAtMin} onCommit={(v) => apply(setObjective(draft, { defenderWinsAtMin: v }))} />
      <EditNumber label="Le challenger gagne en dessous de" suffix="min de contrôle du défenseur" value={o.challengerWinsBelowMin} onCommit={(v) => apply(setObjective(draft, { challengerWinsBelowMin: v }))} />
      <p className="hint">Entre les deux seuils, le résultat est indécis.</p>

      <h4>Zones de manœuvre maritime</h4>
      <p className="hint">Les ordres de déplacement naval y sont confinés. À placer entièrement en mer.</p>
      {SIDE_LIST.map((side) => {
        const zone = draft.navalZones[side];
        return (
          <div key={side} className="subcard">
            <strong className={`txt--${tone(side)}`}>{SIDE_LABEL[side]}</strong>
            {zone ? <p className="muted">Centre : {formatLatLon(zone.center.lat, zone.center.lon)}</p> : <p className="muted">Aucune zone.</p>}
            <div className="row">
              <button type="button" className={`btn btn--small${tool.type === 'zone' && tool.side === side ? ' is-on' : ''}`} onClick={() => setTool(tool.type === 'zone' && tool.side === side ? { type: 'none' } : { type: 'zone', side })}>
                {zone ? 'Déplacer' : 'Placer sur la carte'}
              </button>
              {zone ? (
                <>
                  <EditNumber ariaLabel="Rayon de la zone" suffix="km" value={zone.radiusKm} onCommit={(v) => apply(setNavalZone(draft, side, { center: zone.center, radiusKm: v }))} />
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => apply(setNavalZone(draft, side, null))}>
                    Supprimer
                  </button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  /* ---------------------------------------------------------------- Section : terrain et satellites */

  const renderTerrain = () => (
    <div className="sheet">
      <h4>Zones de terrain</h4>
      <p className="hint">Hors de ces zones, le terrain est ouvert. Une zone ralentit, protège ou dissimule les formations terrestres qui s’y trouvent.</p>
      {draft.terrain.length === 0 ? <p className="muted">Aucune zone : tout le terrain est ouvert.</p> : null}
      {draft.terrain.map((t) => {
        const moving = tool.type === 'terrain' && tool.id === t.id;
        return (
          <div key={t.id} className="subcard">
            <EditText small ariaLabel="Nom de la zone" value={t.name} onCommit={(v) => apply(updateTerrain(draft, t.id, { name: v }))} />
            <div className="row">
              <select className="input input--small" aria-label="Nature du terrain" value={t.kind} onChange={(e) => apply(updateTerrain(draft, t.id, { kind: e.target.value as TerrainKind }))}>
                {TERRAIN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {capital(TERRAIN_LABEL[k])}
                  </option>
                ))}
              </select>
              <EditNumber ariaLabel="Rayon de la zone" suffix="km" value={t.radiusKm} onCommit={(v) => apply(updateTerrain(draft, t.id, { radiusKm: v }))} />
            </div>
            <p className="muted">{terrainEffect(t.kind)}</p>
            <div className="row">
              <button type="button" className={`btn btn--small${moving ? ' is-on' : ''}`} onClick={() => setTool(moving ? { type: 'none' } : { type: 'terrain', kind: t.kind, id: t.id })}>
                Déplacer
              </button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => apply(removeTerrain(draft, t.id))}>
                Supprimer
              </button>
            </div>
          </div>
        );
      })}
      <div className="row">
        <select className="input input--small" aria-label="Nature de la zone à ajouter" value={terrainKind} onChange={(e) => setTerrainKind(e.target.value as TerrainKind)}>
          {TERRAIN_KINDS.map((k) => (
            <option key={k} value={k}>
              {capital(TERRAIN_LABEL[k])}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`btn btn--small${tool.type === 'terrain' && tool.id === undefined ? ' is-on' : ''}`}
          onClick={() => setTool(tool.type === 'terrain' && tool.id === undefined ? { type: 'none' } : { type: 'terrain', kind: terrainKind })}
        >
          Placer sur la carte
        </button>
      </div>
      <p className="hint">{terrainEffect(terrainKind)} Valeurs de jeu.</p>

      <h4>Satellites d’observation</h4>
      <p className="hint">
        Satellites fictifs. Pendant sa fenêtre, de jour, par temps clair et si ses liaisons par satellite ne sont pas perturbées, un camp voit ce qui se trouve dans l’empreinte au sol.
      </p>
      {draft.satellites.length === 0 ? <p className="muted">Aucun satellite.</p> : null}
      {draft.satellites.map((p) => {
        const moving = tool.type === 'satellite' && tool.id === p.id;
        return (
          <div key={p.id} className="subcard">
            <div className="row row--tight">
              <EditText small ariaLabel="Nom du satellite" value={p.name} onCommit={(v) => apply(updateSatellite(draft, p.id, { name: v }))} />
              <select className="input input--small" aria-label="Camp du satellite" value={p.side} onChange={(e) => apply(updateSatellite(draft, p.id, { side: e.target.value as SideId }))}>
                {SIDE_LIST.map((side) => (
                  <option key={side} value={side}>
                    {SIDE_LABEL[side]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid2">
              <EditNumber label="Début de la fenêtre" suffix="min" value={p.startMin} onCommit={(v) => apply(updateSatellite(draft, p.id, { startMin: v }))} />
              <EditNumber label="Fin de la fenêtre" suffix="min" value={p.endMin} onCommit={(v) => apply(updateSatellite(draft, p.id, { endMin: v }))} />
            </div>
            <p className="muted">
              De {clockZ(draft.date, p.startMin * 60, false)} Z à {clockZ(draft.date, p.endMin * 60, false)} Z · empreinte centrée sur {formatLatLon(p.footprint.center.lat, p.footprint.center.lon)}
            </p>
            <div className="row">
              <EditNumber ariaLabel="Rayon de l’empreinte" suffix="km" value={p.footprint.radiusKm} onCommit={(v) => apply(updateSatellite(draft, p.id, { radiusKm: v }))} />
              <button type="button" className={`btn btn--small${moving ? ' is-on' : ''}`} onClick={() => setTool(moving ? { type: 'none' } : { type: 'satellite', side: p.side, id: p.id })}>
                Déplacer
              </button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => apply(removeSatellite(draft, p.id))}>
                Supprimer
              </button>
            </div>
          </div>
        );
      })}
      <div className="row">
        {SIDE_LIST.map((side) => {
          const on = tool.type === 'satellite' && tool.id === undefined && tool.side === side;
          return (
            <button key={side} type="button" className={`btn btn--small${on ? ' is-on' : ''}`} onClick={() => setTool(on ? { type: 'none' } : { type: 'satellite', side })}>
              Ajouter un satellite {SIDE_LABEL[side]}
            </button>
          );
        })}
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- Section : déclencheurs */

  const submitTrigger = () => {
    const t = trigger;
    let condition: Scenario['triggers'][number]['condition'];
    switch (t.condition) {
      case 'TIME_ELAPSED':
        condition = { type: 'TIME_ELAPSED', atMin: t.atMin };
        break;
      case 'LOSSES_AT_LEAST':
        condition = { type: 'LOSSES_AT_LEAST', side: t.side, kind: t.kind, count: t.count };
        break;
      case 'UNIT_IN_ZONE':
        if (!t.zoneCenter) {
          say('Placez la zone du déclencheur sur la carte.', true);
          return;
        }
        condition = { type: 'UNIT_IN_ZONE', side: t.side, kind: t.kind, zone: { center: t.zoneCenter, radiusKm: t.zoneRadiusKm } };
        break;
      case 'GROUP_UNAVAILABLE':
        condition = { type: 'GROUP_UNAVAILABLE', groupId: t.groupId };
        break;
      default:
        condition = { type: 'CONTROL_IS', status: t.status };
    }
    const vis: SideId[] = [...(t.toBlue ? (['BLUE'] as const) : []), ...(t.toRed ? (['RED'] as const) : [])];
    const action: Scenario['triggers'][number]['actions'][number] = t.action === 'MESSAGE' ? { type: 'MESSAGE', text: t.text, vis } : { type: 'END_MISSION', winner: t.winner };
    if (apply(addTrigger(draft, { condition, actions: [action] }))) setTrigger(blankTrigger(draft));
  };

  const needsSide = trigger.condition === 'LOSSES_AT_LEAST' || trigger.condition === 'UNIT_IN_ZONE';
  const renderTriggers = () => (
    <div className="sheet">
      <p className="hint">Quand la condition est remplie, l’action s’exécute une seule fois. Aucun code à écrire.</p>
      {draft.triggers.length === 0 ? <p className="muted">Aucun déclencheur.</p> : null}
      {draft.triggers.map((t) => (
        <div key={t.id} className="listrow">
          <span>
            <b>Quand {describeCondition(t.condition, draft)}</b>
            <small>→ {t.actions.map(describeAction).join(' ; ')}</small>
          </span>
          <button type="button" className="btn btn--small btn--ghost" onClick={() => apply(removeTrigger(draft, t.id))}>
            Supprimer
          </button>
        </div>
      ))}

      <h4>Nouveau déclencheur</h4>
      <label className="field">
        <span>Quand…</span>
        <select className="input input--small" value={trigger.condition} onChange={(e) => setTrigger({ ...trigger, condition: e.target.value as ConditionType })}>
          {(Object.keys(CONDITION_LABEL) as ConditionType[]).map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      {trigger.condition === 'TIME_ELAPSED' ? <EditNumber label="Délai" suffix="min après le début" value={trigger.atMin} onCommit={(v) => (v >= 0 ? (setTrigger({ ...trigger, atMin: v }), true) : false)} /> : null}
      {needsSide ? (
        <div className="grid2">
          <label className="field">
            <span>Camp</span>
            <select className="input input--small" value={trigger.side} onChange={(e) => setTrigger({ ...trigger, side: e.target.value as SideId })}>
              {SIDE_LIST.map((s) => (
                <option key={s} value={s}>
                  {SIDE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type d’unité</span>
            <select className="input input--small" value={trigger.kind} onChange={(e) => setTrigger({ ...trigger, kind: e.target.value as UnitKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {trigger.condition === 'LOSSES_AT_LEAST' ? <EditNumber label="Pertes" suffix="unité(s) détruite(s)" value={trigger.count} onCommit={(v) => (Number.isInteger(v) && v > 0 ? (setTrigger({ ...trigger, count: v }), true) : false)} /> : null}
      {trigger.condition === 'UNIT_IN_ZONE' ? (
        <div className="field">
          <span>Zone</span>
          <p className="muted">{trigger.zoneCenter ? `Centre : ${formatLatLon(trigger.zoneCenter.lat, trigger.zoneCenter.lon)}` : 'Aucune zone placée.'}</p>
          <div className="row">
            <button type="button" className={`btn btn--small${tool.type === 'trigger-zone' ? ' is-on' : ''}`} onClick={() => setTool(tool.type === 'trigger-zone' ? { type: 'none' } : { type: 'trigger-zone' })}>
              Placer sur la carte
            </button>
            <button type="button" className="btn btn--small" onClick={() => setTrigger({ ...trigger, zoneCenter: { ...o.center }, zoneRadiusKm: o.radiusKm })}>
              Reprendre le secteur d’objectif
            </button>
            <EditNumber ariaLabel="Rayon de la zone du déclencheur" suffix="km" value={trigger.zoneRadiusKm} onCommit={(v) => (v > 0 ? (setTrigger({ ...trigger, zoneRadiusKm: v }), true) : false)} />
          </div>
        </div>
      ) : null}
      {trigger.condition === 'GROUP_UNAVAILABLE' ? (
        <label className="field">
          <span>Groupe</span>
          <select className="input input--small" value={trigger.groupId} onChange={(e) => setTrigger({ ...trigger, groupId: e.target.value })}>
            {draft.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {SIDE_LABEL[g.side]} — {g.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {trigger.condition === 'CONTROL_IS' ? (
        <label className="field">
          <span>Le contrôle réel devient</span>
          <select className="input input--small" value={trigger.status} onChange={(e) => setTrigger({ ...trigger, status: e.target.value as TriggerForm['status'] })}>
            {(['BLUE', 'RED', 'CONTESTED'] as const).map((s) => (
              <option key={s} value={s}>
                {CONTROL_LABEL[s]}
              </option>
            ))}
          </select>
          <small className="hint">Attention : un message lié au contrôle réel peut révéler au joueur ce que ses capteurs ne voient pas.</small>
        </label>
      ) : null}

      <label className="field">
        <span>Alors…</span>
        <select className="input input--small" value={trigger.action} onChange={(e) => setTrigger({ ...trigger, action: e.target.value as TriggerForm['action'] })}>
          <option value="MESSAGE">Afficher un message</option>
          <option value="END_MISSION">Terminer la mission</option>
        </select>
      </label>
      {trigger.action === 'MESSAGE' ? (
        <>
          <label className="field">
            <span>Message</span>
            <textarea className="input input--small" rows={2} value={trigger.text} onChange={(e) => setTrigger({ ...trigger, text: e.target.value })} />
          </label>
          <div className="row">
            <span className="muted">Visible par</span>
            <label className="check check--inline">
              <input type="checkbox" checked={trigger.toBlue} onChange={() => setTrigger({ ...trigger, toBlue: !trigger.toBlue })} />
              <span>BLEU</span>
            </label>
            <label className="check check--inline">
              <input type="checkbox" checked={trigger.toRed} onChange={() => setTrigger({ ...trigger, toRed: !trigger.toRed })} />
              <span>ROUGE</span>
            </label>
          </div>
        </>
      ) : (
        <label className="field">
          <span>Résultat</span>
          <select className="input input--small" value={trigger.winner} onChange={(e) => setTrigger({ ...trigger, winner: e.target.value as TriggerForm['winner'] })}>
            <option value="BLUE">Victoire BLEUE</option>
            <option value="RED">Victoire ROUGE</option>
            <option value="DRAW">Résultat indécis</option>
          </select>
        </label>
      )}
      <button type="button" className="btn btn--primary" onClick={submitTrigger}>
        Ajouter le déclencheur
      </button>
    </div>
  );

  /* ---------------------------------------------------------------- Inspecteur */

  const selectedUnit = selection?.type === 'unit' ? draft.units.find((u) => u.id === selection.id) : undefined;
  const selectedBase = selection?.type === 'base' ? draft.bases.find((b) => b.id === selection.id) : undefined;

  const renderInspector = () => {
    if (selectedUnit) {
      const u = selectedUnit;
      const platform = hasPlatform(u.platformId) ? getPlatform(u.platformId) : null;
      const air = platform?.domain === 'air';
      const sof = platform?.kind === 'sof';
      const ground = platform ? isGroundForce(platform.kind) : false;
      const naval = platform ? isNaval(platform.kind) : false;
      const transports = ground ? draft.units.filter((x) => x.side === u.side && liftOf(x.platformId) > 0) : [];
      const fleet = naval ? draft.units.filter((x) => x.side === u.side && x.id !== u.id && hasPlatform(x.platformId) && isNaval(getPlatform(x.platformId).kind)) : [];
      const hosted = draft.bases.find((b) => b.hostUnitId === u.id);
      const ashoreHint = 'Pour la remettre à terre : « Déplacer », puis cliquez un point de la côte.';
      const enemy: SideId = u.side === 'BLUE' ? 'RED' : 'BLUE';
      const intel = draft.intel.find((k) => k.side === enemy && k.unitId === u.id);
      const drawing = tool.type === 'patrol' && tool.unitId === u.id;
      return (
        <div className="sheet">
          <p className="sheet__eyebrow">
            {platform ? KIND_LABEL[platform.kind] : 'Unité'} · <span className={`txt--${tone(u.side)}`}>{SIDE_LABEL[u.side]}</span>
          </p>
          <EditText label="Nom" value={u.name} onCommit={(v) => apply(updateUnit(draft, u.id, { name: v }))} />
          <p className="muted">{platform?.name ?? u.platformId}</p>
          <label className="field">
            <span>Groupe</span>
            <select className="input input--small" value={u.groupId} onChange={(e) => apply(updateUnit(draft, u.id, { groupId: e.target.value }))}>
              {draft.groups
                .filter((g) => g.side === u.side)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
          {air || sof ? (
            <label className="field">
              <span>Base</span>
              <select className="input input--small" value={u.baseId ?? ''} onChange={(e) => apply(updateUnit(draft, u.id, { baseId: e.target.value }))}>
                {draft.bases
                  .filter((b) => b.side === u.side && (!sof || b.hostUnitId === undefined))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          {/* L'entraînement ne pèse que sur le tir des missiles : sans objet pour une formation terrestre ou une équipe spéciale. */}
          {ground || sof ? null : (
            <label className="field">
              <span>Entraînement de l’équipage : {Math.round(u.crew * 100)} %</span>
              <input type="range" min={0} max={100} step={5} value={Math.round(u.crew * 100)} onChange={(e) => apply(updateUnit(draft, u.id, { crew: Number(e.target.value) / 100 }))} />
            </label>
          )}

          {air ? (
            <>
              <label className="check check--inline">
                <input type="checkbox" checked={!!u.airborne} onChange={() => apply(updateUnit(draft, u.id, { airborne: u.airborne ? null : {} }))} />
                <span>Déjà en vol au début</span>
              </label>
              {u.airborne ? (
                <div className="grid2">
                  <label className="field">
                    <span>Altitude</span>
                    <select className="input input--small" value={u.airborne.altM} onChange={(e) => apply(updateUnit(draft, u.id, { airborne: { altM: Number(e.target.value) } }))}>
                      {[...new Set([...ALTITUDES, u.airborne.altM])]
                        .sort((a, b) => a - b)
                        .map((a) => (
                          <option key={a} value={a}>
                            {a.toLocaleString('fr-FR')} m
                          </option>
                        ))}
                    </select>
                  </label>
                  <EditNumber label="Carburant" suffix="%" value={Math.round(u.airborne.fuelFraction * 100)} onCommit={(v) => apply(updateUnit(draft, u.id, { airborne: { fuelFraction: v / 100 } }))} />
                </div>
              ) : (
                <EditNumber
                  label="Indisponible au début"
                  suffix="min"
                  hint="0 : disponible dès le début"
                  value={u.unavailableForMin ?? 0}
                  onCommit={(v) => apply(updateUnit(draft, u.id, { unavailableForMin: v > 0 ? v : null }))}
                />
              )}
            </>
          ) : null}

          {ground ? (
            <>
              {(
                [
                  ['strength', 'Effectifs', 1, 25],
                  ['morale', 'Moral', 0.8, 0],
                  ['supply', 'Ravitaillement', 1, 0],
                ] as const
              ).map(([key, label, fallback, min]) => {
                const value = Math.round((u[key] ?? fallback) * 100);
                return (
                  <label key={key} className="field">
                    <span>
                      {label} au début : {value} %
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={100}
                      step={5}
                      value={value}
                      onChange={(e) => {
                        const v = Number(e.target.value) / 100;
                        apply(updateUnit(draft, u.id, key === 'strength' ? { strength: v } : key === 'morale' ? { morale: v } : { supply: v }));
                      }}
                    />
                  </label>
                );
              })}
              <label className="field">
                <span>Posture de départ</span>
                <select className="input input--small" value={u.posture ?? 'hold'} onChange={(e) => apply(updateUnit(draft, u.id, { posture: e.target.value as 'hold' | 'defend' }))}>
                  <option value="hold">En attente</option>
                  <option value="defend">En défense : elle se retranche</option>
                </select>
              </label>
              {u.embarkedIn !== undefined || transports.length > 0 ? (
                <label className="field">
                  <span>Embarquement</span>
                  <select
                    className="input input--small"
                    value={u.embarkedIn ?? ''}
                    onChange={(e) => {
                      if (e.target.value === '') say(ashoreHint);
                      else apply(updateUnit(draft, u.id, { embarkedIn: e.target.value }));
                    }}
                  >
                    <option value="">À terre</option>
                    {transports.map((t) => (
                      <option key={t.id} value={t.id}>
                        À bord de {t.name}
                      </option>
                    ))}
                  </select>
                  {u.embarkedIn !== undefined ? <small className="hint">{ashoreHint}</small> : null}
                </label>
              ) : null}
            </>
          ) : null}

          {naval ? (
            <label className="field">
              <span>Chef de file</span>
              <select className="input input--small" value={u.leaderId ?? ''} onChange={(e) => apply(updateUnit(draft, u.id, { leaderId: e.target.value === '' ? null : e.target.value }))}>
                <option value="">Navigue seul</option>
                {fleet.map((x) => (
                  <option key={x.id} value={x.id}>
                    Suit {x.name}
                  </option>
                ))}
              </select>
              <small className="hint">Une escorte garde son poste auprès de son chef de file.</small>
            </label>
          ) : null}
          {hosted ? (
            <div className="field">
              <span>{hosted.name}</span>
              <p className="muted">Base portée par ce bâtiment : elle le suit, et ses stocks se règlent comme ceux d’une base.</p>
              <div className="row">
                <button type="button" className="btn btn--small" onClick={() => setSelection({ type: 'base', id: hosted.id })}>
                  Régler ses stocks
                </button>
              </div>
            </div>
          ) : null}

          {naval ? (
            <div className="field">
              <span>Patrouille</span>
              <p className="muted">{u.patrol && u.patrol.length > 0 ? `${u.patrol.length} point(s), dans la zone de manœuvre du camp.` : 'Immobile.'}</p>
              <div className="row">
                {drawing ? (
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => {
                      if (tool.type === 'patrol') apply(updateUnit(draft, u.id, { patrol: tool.points }));
                      setTool({ type: 'none' });
                    }}
                  >
                    Terminer la patrouille
                  </button>
                ) : (
                  <button type="button" className="btn btn--small" onClick={() => setTool({ type: 'patrol', unitId: u.id, points: [] })}>
                    Tracer sur la carte
                  </button>
                )}
                {u.patrol ? (
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => apply(updateUnit(draft, u.id, { patrol: null }))}>
                    Effacer
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <label className="check check--wrap">
            <input type="checkbox" checked={!!intel} onChange={() => apply(setIntel(draft, enemy, u.id, intel ? null : 120))} />
            <span>Connue de {SIDE_LABEL[enemy]} au début</span>
            <small>renseignement initial, déjà ancien</small>
          </label>
          {intel ? <EditNumber label="Âge du renseignement" suffix="min" value={intel.ageMin} onCommit={(v) => apply(setIntel(draft, enemy, u.id, v))} /> : null}

          <div className="actions">
            {!sof && (!air || u.airborne) ? (
              <button type="button" className={`btn${tool.type === 'move' ? ' is-on' : ''}`} onClick={() => setTool({ type: 'move', target: { type: 'unit', id: u.id } })}>
                Déplacer
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                if (apply(removeUnit(draft, u.id))) setSelection(null);
              }}
            >
              Supprimer l’unité
            </button>
          </div>
        </div>
      );
    }

    if (selectedBase) {
      const b = selectedBase;
      const host = draft.units.find((x) => x.id === b.hostUnitId);
      return (
        <div className="sheet">
          <p className="sheet__eyebrow">
            {host ? 'Base embarquée' : 'Base'} · <span className={`txt--${tone(b.side)}`}>{SIDE_LABEL[b.side]}</span>
          </p>
          <EditText label="Nom" value={b.name} onCommit={(v) => apply(updateBase(draft, b.id, { name: v }))} />
          <p className="muted">{host ? `Portée par ${host.name} : elle le suit.` : formatLatLon(b.pos.lat, b.pos.lon)}</p>
          <h4>Stocks</h4>
          <EditNumber label="Missiles air-air" value={b.weaponStock} onCommit={(v) => apply(updateBase(draft, b.id, { weaponStock: v }))} />
          <EditNumber label="Munitions air-surface" value={b.asmStock} onCommit={(v) => apply(updateBase(draft, b.id, { asmStock: v }))} hint="Nécessaires aux missions d’attaque des défenses sol-air et d’appui aérien rapproché." />
          <EditNumber label="Carburant" suffix="t" value={Math.round(b.fuelStockKg / 1000)} onCommit={(v) => apply(updateBase(draft, b.id, { fuelStockKg: v * 1000 }))} />
          <EditNumber
            label="Ravitaillement des forces terrestres et navales"
            suffix="points"
            value={b.supplyStock}
            onCommit={(v) => apply(updateBase(draft, b.id, { supplyStock: v }))}
            hint="Au-dessus de zéro, la base est un dépôt : formations et bâtiments proches s’y ravitaillent."
          />
          <div className="actions">
            {host ? null : (
              <button type="button" className={`btn${tool.type === 'move' ? ' is-on' : ''}`} onClick={() => setTool({ type: 'move', target: { type: 'base', id: b.id } })}>
                Déplacer
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                if (apply(removeBase(draft, b.id))) setSelection(null);
              }}
            >
              Supprimer la base
            </button>
          </div>
          {host ? null : <p className="hint">Posez les bases sur la terre ferme : le jeu ne le vérifie pas.</p>}
        </div>
      );
    }

    return (
      <div className="sheet">
        <p className="sheet__eyebrow">Inspecteur</p>
        <h2>{draft.title}</h2>
        <p className="muted">Sélectionnez une base ou une unité, dans la liste ou sur la carte, pour la modifier.</p>
        <dl className="kvlist kvlist--spaced">
          {SIDE_LIST.map((side) => (
            <div key={side} className="kv">
              <dt className={`txt--${tone(side)}`}>{SIDE_LABEL[side]}</dt>
              <dd>
                {draft.bases.filter((b) => b.side === side).length} base(s), {draft.units.filter((u) => u.side === side).length} unité(s),{' '}
                {draft.missions.filter((m) => m.side === side).length} mission(s) initiale(s)
              </dd>
            </div>
          ))}
          <div className="kv">
            <dt>Objectif</dt>
            <dd>
              {o.name}, {SIDE_LABEL[o.defender]} défend, {Math.round(o.radiusKm)} km de rayon
            </dd>
          </div>
          <div className="kv">
            <dt>Durée</dt>
            <dd>
              {draft.durationMin} min, de {clockZ(draft.date, 0, false)} Z à {clockZ(draft.date, draft.durationMin * 60, false)} Z
            </dd>
          </div>
          <div className="kv">
            <dt>Déclencheurs</dt>
            <dd>{draft.triggers.length}</dd>
          </div>
        </dl>
        <p className="hint">Dans l’éditeur, les deux camps sont à découvert. En jeu, chacun ne verra que ce que ses capteurs détectent.</p>
      </div>
    );
  };

  /* ---------------------------------------------------------------- Actions générales */

  const valid = check.errors.length === 0;
  const runTest = () => {
    setTest('running');
    // Le test joue toute la partie : on laisse d'abord l'écran afficher « test en cours ».
    setTimeout(() => setTest(quickTest(draft)), 30);
  };
  const play = () => {
    const parsed = parseScenario(draft);
    if (!parsed.ok) {
      say('Le scénario comporte des erreurs : corrigez-les avant de jouer.', true);
      return;
    }
    onPlay(parsed.scenario, playSide, playDifficulty);
  };
  const save = (): boolean => {
    if (!onSave(draft)) {
      say('Enregistrement impossible : stockage du navigateur indisponible ou plein. Exportez le scénario en fichier.', true);
      return false;
    }
    setDirty(false);
    say(valid ? 'Scénario enregistré dans ce navigateur.' : 'Brouillon enregistré. Il ne sera jouable qu’une fois les erreurs corrigées.');
    return true;
  };

  return (
    <div className="editor">
      <header className="topbar editor__top">
        <div className="topbar__title">
          <strong>WAR COMMAND</strong>
          <span>Éditeur de missions</span>
        </div>
        <div className="editor__status">
          <span className={`pill ${valid ? 'pill--plan' : 'pill--bad'}`}>{valid ? 'Scénario valide' : `${check.errors.length} erreur${check.errors.length > 1 ? 's' : ''}`}</span>
          {check.warnings.length > 0 ? <span className="pill pill--run">{check.warnings.length} avertissement{check.warnings.length > 1 ? 's' : ''}</span> : null}
          {dirty ? <span className="muted">modifications non enregistrées</span> : null}
        </div>
        <div className="editor__actions">
          <button type="button" className="btn" disabled={!valid || test === 'running'} onClick={runTest}>
            {test === 'running' ? 'Test en cours…' : 'Tester (IA contre IA)'}
          </button>
          <span className="editor__play">
            <select className="input input--small" value={playSide} onChange={(e) => setPlaySide(e.target.value as SideId)} aria-label="Camp joué pour l’essai">
              {SIDE_LIST.map((s) => (
                <option key={s} value={s}>
                  {SIDE_LABEL[s]}
                </option>
              ))}
            </select>
            <select className="input input--small" value={playDifficulty} onChange={(e) => setPlayDifficulty(e.target.value as Difficulty)} aria-label="Difficulté de l’IA pour l’essai">
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn--primary" disabled={!valid} onClick={play}>
              Jouer
            </button>
          </span>
          <button type="button" className="btn" onClick={save}>
            Enregistrer
          </button>
          <button type="button" className="btn" onClick={() => downloadJson(scenarioFileName(draft), draft)}>
            Exporter
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => (dirty ? setConfirmQuit(true) : onQuit())}>
            Quitter
          </button>
        </div>
      </header>

      <aside className="panel editor__left">
        <div className="tabs" role="tablist">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'is-on' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </div>
        <div key={section} className="editor__scroll">
          {section === 'scenario' ? renderScenario() : null}
          {section === 'coalitions' ? renderCoalitions() : null}
          {section === 'forces' ? renderForces() : null}
          {section === 'missions' ? renderMissions() : null}
          {section === 'objectif' ? renderObjective() : null}
          {section === 'terrain' ? renderTerrain() : null}
          {section === 'declencheurs' ? renderTriggers() : null}
        </div>
      </aside>

      <main className="mapzone editor__map">
        <MapView
          scene={scene}
          view={{ center: initial.region.center, zoom: initial.region.zoom }}
          fit={initialFit.current}
          picking={tool.type !== 'none'}
          showGraticule
          onMapClick={onMapClick}
          onSelect={onSelect}
          onViewChange={(v) => {
            view.current = v;
          }}
        />
        {tool.type !== 'none' ? <div className="maphint">{tool.type === 'waypoints' ? toolHint.waypoints : `${toolHint[tool.type]} · Échap pour abandonner`}</div> : null}
        {notice ? (
          <div className={`toast${notice.bad ? ' toast--bad' : ''}`} role="status">
            {notice.text}
          </div>
        ) : null}
      </main>

      <aside className="panel detail editor__right">{renderInspector()}</aside>

      <section className="panel editor__bottom">
        <div className="editor__check">
          <h2>Vérification</h2>
          {valid && check.warnings.length === 0 ? <p className="tone--good">Aucune erreur, aucun avertissement : le scénario est jouable.</p> : null}
          {check.errors.map((e) => (
            <p key={e} className="tone--alert">
              Erreur — {e}
            </p>
          ))}
          {check.warnings.map((w) => (
            <p key={w} className="tone--intel">
              Avertissement — {w}
            </p>
          ))}
        </div>
        <div className="editor__test">
          <h2>Test rapide</h2>
          {test === null ? <p className="muted">Joue toute la mission en IA contre IA, en contrôlant la cohérence du moteur à chaque seconde.</p> : null}
          {test === 'running' ? <p className="muted">Partie en cours de calcul…</p> : null}
          {test !== null && test !== 'running' && !test.ok ? test.errors.map((e) => <p key={e} className="tone--alert">{e}</p>) : null}
          {test !== null && test !== 'running' && test.ok ? (
            <>
              <p>
                <b className={test.winner === 'DRAW' ? '' : `txt--${tone(test.winner)}`}>{test.winner === 'DRAW' ? 'Résultat indécis' : `Victoire ${SIDE_LABEL[test.winner]}`}</b> à {Math.round(test.endedAtMin)} min · contrôle : BLEU{' '}
                {Math.round(test.controlMin.BLUE)} min, ROUGE {Math.round(test.controlMin.RED)} min, contesté {Math.round(test.controlMin.CONTESTED)} min
              </p>
              <p className="muted">
                Sorties {test.sorties.BLUE}/{test.sorties.RED} · tirs {test.shots.BLUE}/{test.shots.RED} · chasseurs perdus {test.fightersLost.BLUE}/{test.fightersLost.RED}
                {test.landStrengthLost.BLUE + test.landStrengthLost.RED > 0
                  ? ` · effectifs perdus à terre ${test.landStrengthLost.BLUE.toFixed(1).replace('.', ',')}/${test.landStrengthLost.RED.toFixed(1).replace('.', ',')} formation`
                  : ''}{' '}
                (BLEU/ROUGE) · {test.events} événements
              </p>
              {test.violations.length === 0 ? <p className="tone--good">Aucune incohérence du moteur.</p> : test.violations.map((v) => <p key={v} className="tone--alert">{v}</p>)}
            </>
          ) : null}
        </div>
      </section>

      {confirmQuit ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="quit-title">
          <div className="modal__box">
            <h2 id="quit-title">Quitter l’éditeur ?</h2>
            <p>Des modifications ne sont pas enregistrées.</p>
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  // Si l'enregistrement échoue, on reste dans l'éditeur : rien n'est perdu.
                  if (save()) onQuit();
                  else setConfirmQuit(false);
                }}
              >
                Enregistrer et quitter
              </button>
              <button type="button" className="btn" onClick={onQuit}>
                Quitter sans enregistrer
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmQuit(false)}>
                Rester
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
