/**
 * Scène cartographique : ce que la carte doit dessiner à un instant donné.
 *
 * Deux constructions, strictement séparées :
 *  - `sceneFromPicture` : pendant la partie, à partir de la seule image du camp du joueur ;
 *  - `sceneFromTruth`   : après la mission (rejeu détaillé), à partir de la vérité-terrain.
 */
import {
  centroid,
  circlePolygon,
  destination,
  type Bounds,
  type LatLon,
  type SideId,
  type SidePicture,
  type SimState,
  type TerrainKind,
  type TerrainZone,
  type UnitKind,
} from '@warcommand/simulation-core';
import type { Scenario } from '@warcommand/scenario-system';
import { getPlatform, hasPlatform } from '@warcommand/unit-database';
import { KIND_CODE, TERRAIN_LABEL } from '../user-interface/i18n';

export type Selection = { type: 'unit' | 'contact' | 'mission' | 'base'; id: string } | null;

export type SymbolFrame = 'friend' | 'hostile' | 'unknown' | 'base';

export interface MapSymbol {
  key: string;
  select: Exclude<Selection, null> | null;
  /** Couleur : camp, ou `null` pour une piste non identifiée. */
  side: SideId | null;
  frame: SymbolFrame;
  code: string;
  label: string;
  sub: string;
  pos: LatLon;
  /** Vecteur de cap, pour les mobiles en mouvement. */
  headingDeg: number | null;
  faded: boolean;
  selected: boolean;
}

export type ShapeKind = 'sector' | 'radar' | 'weapon' | 'threat' | 'uncertainty' | 'zone' | 'terrain' | 'footprint';
export type LineKind = 'route' | 'task' | 'shot' | 'draft' | 'measure';

/** Un point d'une trace : où était l'unité, et à quelle altitude. */
export interface TrailPoint {
  lat: number;
  lon: number;
  altM: number;
}

export interface MapShape {
  kind: ShapeKind;
  side: SideId | null;
  ring: LatLon[];
}

export interface MapLine {
  kind: LineKind;
  side: SideId | null;
  points: LatLon[];
}

export interface MapDot {
  kind: 'missile' | 'waypoint';
  side: SideId | null;
  pos: LatLon;
}

export interface MapLabel {
  key: string;
  pos: LatLon;
  text: string;
  tone: 'sector' | 'measure' | 'waypoint' | 'terrain';
}

/** Mobile en altitude : en vue 3D, une colonne le relie à sa projection au sol. */
export interface MapVolume {
  side: SideId | null;
  pos: LatLon;
  altM: number;
}

/** Trace d'une unité : une ligne au sol en 2D, un rideau jusqu'à l'altitude de vol en 3D. */
export interface MapTrail {
  side: SideId | null;
  points: TrailPoint[];
}

/** Zone de terrain du scénario, dessinée en volume en vue 3D. */
export interface MapRelief {
  kind: TerrainKind;
  ring: LatLon[];
}

export interface MapScene {
  symbols: MapSymbol[];
  shapes: MapShape[];
  lines: MapLine[];
  dots: MapDot[];
  labels: MapLabel[];
  volumes: MapVolume[];
  trails: MapTrail[];
  relief: MapRelief[];
}

const emptyScene = (): MapScene => ({ symbols: [], shapes: [], lines: [], dots: [], labels: [], volumes: [], trails: [], relief: [] });

export interface LayerToggles {
  units: boolean;
  contacts: boolean;
  routes: boolean;
  radar: boolean;
  weapons: boolean;
  sector: boolean;
  terrain: boolean;
  graticule: boolean;
}

export const DEFAULT_LAYERS: LayerToggles = {
  units: true,
  contacts: true,
  routes: true,
  radar: false,
  weapons: true,
  sector: true,
  terrain: true,
  graticule: true,
};

export type DomainFilter = Record<'air' | 'surface' | 'ground', boolean>;
export const ALL_DOMAINS: DomainFilter = { air: true, surface: true, ground: true };

/** Portée supposée d'une défense sol-air adverse dont on ignore les caractéristiques (affichage indicatif). */
export const ASSUMED_THREAT_KM = 80;

export interface SceneOptions {
  layers: LayerToggles;
  domains: DomainFilter;
  selection: Selection;
  /** Points du plan de vol en cours de saisie. */
  draft: LatLon[];
  measure: LatLon[];
  showNavalZone: boolean;
  /** Rejeu : trace récente d'une unité. */
  trail?: (unitId: string) => TrailPoint[];
}

const circle = (center: LatLon, radiusKm: number) => circlePolygon({ center, radiusKm }, 96);

/** Emprise englobant un ensemble de points (cadrage initial de la carte). */
export function boundsOf(points: readonly LatLon[]): Bounds | undefined {
  if (points.length === 0) return undefined;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  return { west, south, east, north };
}

/** Demi-largeur du cadrage autour d'un objectif terrestre : le champ de bataille est petit devant le théâtre. */
const GROUND_FRAME_KM = 75;

/** Cadrage sur les abords d'un objectif terrestre. */
export function groundFrame(center: LatLon): Bounds | undefined {
  return boundsOf([0, 90, 180, 270].map((bearing) => destination(center, bearing, GROUND_FRAME_KM)));
}
const pct = (value: number, max: number) => (max > 0 ? `${Math.round((100 * value) / max)} %` : '');

/** Zones de terrain particulier : un cercle et son nom. */
function drawTerrain(scene: MapScene, zones: readonly TerrainZone[]): void {
  for (const zone of zones) {
    const ring = circle(zone.center, zone.radiusKm);
    scene.shapes.push({ kind: 'terrain', side: null, ring });
    scene.relief.push({ kind: zone.kind, ring });
    scene.labels.push({ key: `terrain:${zone.id}`, pos: destination(zone.center, 0, zone.radiusKm * 0.8), text: `${zone.name} · ${TERRAIN_LABEL[zone.kind]}`, tone: 'terrain' });
  }
}

function draftAndMeasure(scene: MapScene, o: SceneOptions, side: SideId | null): void {
  if (o.draft.length > 0) {
    o.draft.forEach((pos, i) => {
      scene.dots.push({ kind: 'waypoint', side, pos });
      scene.labels.push({ key: `wp:${i}`, pos, text: String(i + 1), tone: 'waypoint' });
    });
    if (o.draft.length > 1) scene.lines.push({ kind: 'draft', side, points: o.draft });
  }
  if (o.measure.length > 0) {
    for (const pos of o.measure) scene.dots.push({ kind: 'waypoint', side: null, pos });
    if (o.measure.length > 1) scene.lines.push({ kind: 'measure', side: null, points: o.measure });
  }
}

/** Texte sous le symbole d'une unité amie : carburant d'un aéronef, effectifs d'une formation, aéronefs à bord d'un porte-avions. */
function unitSub(pic: SidePicture, u: SidePicture['units'][number], parkedAt: (baseId: string) => number): string {
  const p = pic.platforms[u.platformId];
  if (u.domain === 'air') return p ? pct(u.fuelKg, p.fuelCapacityKg) : '';
  if (u.land) return `${Math.round(u.land.strength * 100)} %${u.land.broken ? ' · rompue' : u.land.inContact ? ' · contact' : ''}`;
  if (u.naval) {
    const deck = pic.bases.find((b) => b.hostUnitId === u.id && p !== undefined && p.deck > 0);
    const parts = [deck ? `${parkedAt(deck.id)} à bord` : '', u.naval.troops.length > 0 ? 'troupes à bord' : '', u.damaged ? 'avarié' : ''];
    return parts.filter(Boolean).join(' · ');
  }
  return '';
}

/** Scène en cours de partie : uniquement ce que le camp du joueur sait. */
export function sceneFromPicture(pic: SidePicture, o: SceneOptions): MapScene {
  const scene = emptyScene();
  const side = pic.side;
  const enemy: SideId = side === 'BLUE' ? 'RED' : 'BLUE';
  const selectedUnit = o.selection?.type === 'unit' ? o.selection.id : null;
  const selectedContact = o.selection?.type === 'contact' ? o.selection.id : null;
  const selectedMission = o.selection?.type === 'mission' ? o.selection.id : null;
  const contactById = new Map(pic.contacts.map((c) => [c.id, c]));
  const unitById = new Map(pic.units.map((u) => [u.id, u]));

  if (o.layers.sector) {
    const obj = pic.objective;
    scene.shapes.push({ kind: 'sector', side: null, ring: circle(obj.center, obj.radiusKm) });
    scene.labels.push({ key: 'sector', pos: destination(obj.center, 180, obj.radiusKm * 0.82), text: obj.name.toUpperCase(), tone: 'sector' });
  }
  if (o.showNavalZone && pic.navalZone) {
    scene.shapes.push({ kind: 'zone', side, ring: circle(pic.navalZone.center, pic.navalZone.radiusKm) });
  }
  if (o.layers.terrain) drawTerrain(scene, pic.terrain);
  // Empreinte d'un satellite du camp, pendant son passage.
  for (const pass of pic.satellites) {
    if (pass.phase !== 'open') continue;
    scene.shapes.push({ kind: 'footprint', side, ring: circle(pass.footprint.center, pass.footprint.radiusKm) });
    scene.labels.push({ key: `sat:${pass.id}`, pos: destination(pass.footprint.center, 0, pass.footprint.radiusKm * 0.92), text: `SATELLITE ${pass.name.toUpperCase()}`, tone: 'terrain' });
  }

  // Bases : les siennes, et celles de l'adversaire qui figurent au dossier de renseignement.
  // Une base embarquée n'a pas de symbole propre : elle se confond avec son bâtiment.
  const parkedAt = (baseId: string) =>
    pic.units.filter((u) => u.baseId === baseId && u.domain === 'air' && (u.status === 'ready' || u.status === 'turnaround' || u.status === 'maintenance')).length;
  for (const b of pic.bases) {
    if (b.hostUnitId !== null) continue;
    const onGround = parkedAt(b.id);
    scene.symbols.push({
      key: `base:${b.id}`,
      select: null,
      side,
      frame: 'base',
      code: 'B',
      label: b.name,
      sub: onGround > 0 ? `${onGround} au sol` : '',
      pos: b.pos,
      headingDeg: null,
      faded: false,
      selected: false,
    });
  }
  pic.enemyBases.forEach((b, i) => {
    scene.symbols.push({ key: `ebase:${i}`, select: null, side: enemy, frame: 'base', code: 'B', label: b.name, sub: '', pos: b.pos, headingDeg: null, faded: false, selected: false });
  });

  if (o.layers.units) {
    for (const u of pic.units) {
      if (!o.domains[u.domain]) continue;
      if (u.status !== 'airborne' && u.status !== 'active') continue;
      const p = pic.platforms[u.platformId];
      const selected = u.id === selectedUnit || (selectedMission !== null && u.missionId === selectedMission);
      scene.symbols.push({
        key: `unit:${u.id}`,
        select: { type: 'unit', id: u.id },
        side,
        frame: 'friend',
        code: KIND_CODE[u.kind],
        label: u.name,
        sub: unitSub(pic, u, parkedAt),
        pos: u.pos,
        headingDeg: u.speedKmh > 0 ? u.headingDeg : null,
        // Unité de surface neutralisée ou hors de combat, formation rompue : estompée.
        faded: u.domain !== 'air' && (u.damaged || u.suppressedUntil > pic.time || u.land?.broken === true),
        selected,
      });
      if (u.status === 'airborne') scene.volumes.push({ side, pos: u.pos, altM: u.altM });
      const past = o.trail?.(u.id);
      if (past && past.length > 1) scene.trails.push({ side, points: past });
      // Itinéraire d'une formation ou d'un bâtiment, et ordre terrestre encore en cours de transmission.
      if (o.layers.routes && u.domain !== 'air') {
        if (u.route.length > 0) scene.lines.push({ kind: 'route', side, points: [u.pos, ...u.route] });
        if (u.land?.pending && u.land.pending.route.length > 0) scene.lines.push({ kind: 'task', side, points: [u.pos, ...u.land.pending.route] });
      }
      if (!p) continue;
      // Portée d'observation d'une formation ou d'une équipe sélectionnée.
      if (u.id === selectedUnit && p.spotKm > 0) scene.shapes.push({ kind: 'radar', side, ring: circle(u.pos, p.spotKm) });
      const showRadar = p.radarRangeKm > 0 && (o.layers.radar || u.id === selectedUnit);
      if (showRadar) scene.shapes.push({ kind: 'radar', side, ring: circle(u.pos, p.radarRangeKm) });
      const showWeapon = p.weaponRangeKm > 0 && ((o.layers.weapons && u.domain !== 'air') || u.id === selectedUnit);
      if (showWeapon) scene.shapes.push({ kind: 'weapon', side, ring: circle(u.pos, p.weaponRangeKm) });
    }
  }

  if (o.layers.contacts) {
    for (const c of pic.contacts) {
      if (!o.domains[c.domain]) continue;
      const age = c.stale && !c.fixed ? ` · ${Math.max(1, Math.round(c.ageS / 60))} min` : '';
      scene.symbols.push({
        key: `contact:${c.id}`,
        select: { type: 'contact', id: c.id },
        side: c.identified ? enemy : null,
        frame: c.identified ? 'hostile' : 'unknown',
        code: c.identified && c.kind ? KIND_CODE[c.kind] : '?',
        label: c.identified ? `${c.id} ${c.label ?? ''}`.trim() : `${c.id} ?`,
        sub: c.fixed && c.stale ? 'rens. ancien' : c.stale ? `ancien${age}` : c.domain === 'air' && !c.radarTracked ? 'écoute' : '',
        pos: c.pos,
        headingDeg: !c.stale && c.speedKmh > 0 ? c.headingDeg : null,
        faded: c.stale,
        selected: c.id === selectedContact,
      });
      if (c.domain === 'air' && !c.stale) scene.volumes.push({ side: c.identified ? enemy : null, pos: c.pos, altM: c.altM });
      if (c.uncertaintyKm > 2) scene.shapes.push({ kind: 'uncertainty', side: null, ring: circle(c.pos, c.uncertaintyKm) });
      if (o.layers.weapons && c.identified && (c.kind === 'sam' || c.kind === 'ship')) {
        scene.shapes.push({ kind: 'threat', side: enemy, ring: circle(c.pos, ASSUMED_THREAT_KM) });
      }
    }
  }

  if (o.layers.routes) {
    for (const m of pic.missions) {
      if (m.status !== 'planned' && m.status !== 'active') continue;
      const highlight = m.id === selectedMission;
      const members = pic.units.filter((u) => u.missionId === m.id);
      if (m.waypoints.length > 1) {
        scene.lines.push({ kind: highlight ? 'draft' : 'route', side, points: [...m.waypoints, m.waypoints[0]!] });
      }
      const anchor = m.waypoints.length > 0 ? centroid(m.waypoints) : null;
      const base = pic.bases.find((b) => members.some((u) => u.baseId === b.id));
      if (m.status === 'planned' && anchor && base && members.some((u) => u.status !== 'airborne')) {
        scene.lines.push({ kind: 'route', side, points: [base.pos, m.waypoints[0]!] });
      }
    }
    for (const u of pic.units) {
      if (u.status !== 'airborne') continue;
      const m = pic.missions.find((x) => x.id === u.missionId);
      let to: LatLon | null = null;
      if (u.task === 'transit' && m && m.waypoints.length > 0) to = m.waypoints[u.wpIndex % m.waypoints.length]!;
      else if (u.task === 'rtb') to = pic.bases.find((b) => b.id === u.baseId)?.pos ?? null;
      else if ((u.task === 'pursue' || u.task === 'attack') && u.targetContactId) to = contactById.get(u.targetContactId)?.pos ?? null;
      else if (u.task === 'escort' && m?.escortUnitId) to = unitById.get(m.escortUnitId)?.pos ?? null;
      else if ((u.task === 'refuel' || u.task === 'refueling') && u.refuelFromId) to = unitById.get(u.refuelFromId)?.pos ?? null;
      if (to) scene.lines.push({ kind: u.task === 'transit' ? 'route' : 'task', side, points: [u.pos, to] });
    }
  }

  for (const shot of pic.shots) {
    const target = contactById.get(shot.contactId);
    if (!target) continue;
    const f = Math.max(0, Math.min(1, (pic.time - shot.firedAt) / Math.max(1, shot.impactAt - shot.firedAt)));
    const head = { lat: shot.from.lat + (target.pos.lat - shot.from.lat) * f, lon: shot.from.lon + (target.pos.lon - shot.from.lon) * f };
    scene.lines.push({ kind: 'shot', side, points: [shot.from, head] });
    scene.dots.push({ kind: 'missile', side, pos: head });
  }

  draftAndMeasure(scene, o, side);
  return scene;
}

const KIND_ORDER: UnitKind[] = ['fighter', 'aew', 'tanker', 'ship', 'sam'];

/** Scène de l'observateur : vérité-terrain des deux camps. Réservée à l'après-mission. */
export function sceneFromTruth(state: SimState, o: Pick<SceneOptions, 'layers' | 'domains'> & Partial<Pick<SceneOptions, 'selection' | 'trail'>>): MapScene {
  const selectedUnit = o.selection?.type === 'unit' ? o.selection.id : null;
  const scene = emptyScene();
  const obj = state.objective;
  scene.shapes.push({ kind: 'sector', side: null, ring: circle(obj.center, obj.radiusKm) });
  scene.labels.push({ key: 'sector', pos: destination(obj.center, 180, obj.radiusKm * 0.82), text: obj.name.toUpperCase(), tone: 'sector' });

  drawTerrain(scene, state.terrain);
  for (const b of Object.values(state.bases)) {
    if (b.hostUnitId !== null) continue;
    scene.symbols.push({ key: `base:${b.id}`, select: null, side: b.side, frame: 'base', code: 'B', label: b.name, sub: '', pos: b.pos, headingDeg: null, faded: false, selected: false });
  }
  const units = Object.values(state.units).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const u of units) {
    if (!o.domains[u.domain]) continue;
    if (u.status !== 'airborne' && u.status !== 'active') continue;
    const p = state.platforms[u.platformId]!;
    scene.symbols.push({
      key: `unit:${u.id}`,
      select: { type: 'unit', id: u.id },
      side: u.side,
      frame: u.side === 'BLUE' ? 'friend' : 'hostile',
      code: KIND_CODE[u.kind],
      label: u.name,
      sub: u.domain === 'air' ? pct(u.fuelKg, p.fuelCapacityKg) : u.land ? `${Math.round(u.land.strength * 100)} %` : '',
      pos: u.pos,
      headingDeg: u.speedKmh > 0 ? u.headingDeg : null,
      faded: u.damaged || u.land?.broken === true,
      selected: u.id === selectedUnit,
    });
    if (u.status === 'airborne') scene.volumes.push({ side: u.side, pos: u.pos, altM: u.altM });
    const past = o.trail?.(u.id);
    if (past && past.length > 1) scene.trails.push({ side: u.side, points: past });
    if (u.id === selectedUnit && p.radarRangeKm > 0 && !o.layers.radar) scene.shapes.push({ kind: 'radar', side: u.side, ring: circle(u.pos, p.radarRangeKm) });
    if (o.layers.weapons && u.domain !== 'air' && p.weaponRangeKm > 0) {
      scene.shapes.push({ kind: 'weapon', side: u.side, ring: circle(u.pos, p.weaponRangeKm) });
    }
    if (o.layers.radar && p.radarRangeKm > 0) scene.shapes.push({ kind: 'radar', side: u.side, ring: circle(u.pos, p.radarRangeKm) });
  }
  if (o.layers.routes) {
    for (const m of Object.values(state.missions)) {
      if (m.status === 'active' && m.waypoints.length > 1) scene.lines.push({ kind: 'route', side: m.side, points: [...m.waypoints, m.waypoints[0]!] });
    }
  }
  for (const shot of state.shots) {
    const target = state.units[shot.targetId];
    if (!target) continue;
    const f = Math.max(0, Math.min(1, (state.time - shot.firedAt) / Math.max(1, shot.impactAt - shot.firedAt)));
    const head = { lat: shot.from.lat + (target.pos.lat - shot.from.lat) * f, lon: shot.from.lon + (target.pos.lon - shot.from.lon) * f };
    scene.lines.push({ kind: 'shot', side: shot.side, points: [shot.from, head] });
    scene.dots.push({ kind: 'missile', side: shot.side, pos: head });
  }
  return scene;
}

export interface EditorSceneOptions {
  selection: Selection;
  /** Points en cours de saisie (mission, patrouille). */
  draft: LatLon[];
  /** Mission mise en évidence dans la liste. */
  highlightMission: number | null;
}

/**
 * Scène de l'éditeur : le scénario tel qu'il est écrit, les deux camps à découvert.
 * Les aéronefs au sol ne sont pas dessinés un à un : leur base en indique le nombre.
 */
export function sceneFromScenario(sc: Scenario, o: EditorSceneOptions): MapScene {
  const scene = emptyScene();
  const obj = sc.objective;
  scene.shapes.push({ kind: 'sector', side: null, ring: circle(obj.center, obj.radiusKm) });
  scene.labels.push({ key: 'sector', pos: destination(obj.center, 180, obj.radiusKm * 0.82), text: obj.name.toUpperCase(), tone: 'sector' });
  for (const side of ['BLUE', 'RED'] as const) {
    const zone = sc.navalZones[side];
    if (zone) scene.shapes.push({ kind: 'zone', side, ring: circle(zone.center, zone.radiusKm) });
  }

  drawTerrain(scene, sc.terrain);
  for (const pass of sc.satellites) {
    scene.shapes.push({ kind: 'footprint', side: pass.side, ring: circle(pass.footprint.center, pass.footprint.radiusKm) });
    scene.labels.push({ key: `sat:${pass.id}`, pos: destination(pass.footprint.center, 0, pass.footprint.radiusKm * 0.92), text: `SATELLITE ${pass.name.toUpperCase()}`, tone: 'terrain' });
  }

  for (const b of sc.bases) {
    // Une base embarquée se confond avec son bâtiment : pas de symbole propre.
    if (b.hostUnitId !== undefined) continue;
    const parked = sc.units.filter((u) => u.baseId === b.id && !u.airborne).length;
    scene.symbols.push({
      key: `base:${b.id}`,
      select: { type: 'base', id: b.id },
      side: b.side,
      frame: 'base',
      code: 'B',
      label: b.name,
      sub: parked > 0 ? `${parked} au sol` : '',
      pos: b.pos,
      headingDeg: null,
      faded: false,
      selected: o.selection?.type === 'base' && o.selection.id === b.id,
    });
  }

  for (const u of sc.units) {
    const pos = u.airborne?.pos ?? u.pos;
    // Ni position propre (aéronef au sol, équipe spéciale à sa base), ni à terre (troupe embarquée) : pas de symbole.
    if (!pos || u.embarkedIn !== undefined) continue;
    const record = hasPlatform(u.platformId) ? getPlatform(u.platformId) : null;
    const aboard = sc.units.filter((x) => x.embarkedIn === u.id).length;
    scene.symbols.push({
      key: `unit:${u.id}`,
      select: { type: 'unit', id: u.id },
      side: u.side,
      frame: u.side === 'BLUE' ? 'friend' : 'hostile',
      code: record ? KIND_CODE[record.kind] : '?',
      label: u.name,
      sub: u.airborne ? `${Math.round(u.airborne.altM).toLocaleString('fr-FR')} m` : aboard > 0 ? `${aboard} formation(s) à bord` : '',
      pos,
      headingDeg: null,
      faded: false,
      selected: o.selection?.type === 'unit' && o.selection.id === u.id,
    });
    if (record && record.domain !== 'air') {
      const range = record.game.weaponRangeKm.value;
      if (range > 0) scene.shapes.push({ kind: 'weapon', side: u.side, ring: circle(pos, range) });
      if (u.patrol && u.patrol.length > 0) scene.lines.push({ kind: 'task', side: u.side, points: [pos, ...u.patrol] });
    }
  }

  sc.missions.forEach((m, index) => {
    if (m.waypoints.length === 0) return;
    const loop = m.type !== 'SWEEP' && m.waypoints.length > 1;
    const points = loop ? [...m.waypoints, m.waypoints[0]!] : m.waypoints;
    if (points.length > 1) scene.lines.push({ kind: index === o.highlightMission ? 'draft' : 'route', side: m.side, points });
    else scene.dots.push({ kind: 'waypoint', side: m.side, pos: m.waypoints[0]! });
    scene.labels.push({ key: `mission:${index}`, pos: m.waypoints[0]!, text: m.name ?? `${m.type} ${index + 1}`, tone: 'waypoint' });
  });

  o.draft.forEach((pos, i) => {
    scene.dots.push({ kind: 'waypoint', side: null, pos });
    scene.labels.push({ key: `wp:${i}`, pos, text: String(i + 1), tone: 'waypoint' });
  });
  if (o.draft.length > 1) scene.lines.push({ kind: 'draft', side: null, points: o.draft });
  return scene;
}
