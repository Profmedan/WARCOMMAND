'use client';

/**
 * Carte opérationnelle (MapLibre GL JS) : vue 2D de travail, et vue 3D complémentaire sur le globe.
 *
 * En vue 3D, la Terre est une sphère, la caméra s'incline et tourne, et chaque mobile en vol est relié à
 * sa projection au sol par une colonne à la hauteur de son altitude (exagérée pour rester lisible).
 *
 * Fond de carte embarqué Natural Earth (domaine public) : aucune tuile, aucune clé, aucun réseau.
 * Les lignes et surfaces sont des couches GeoJSON ; les symboles et étiquettes sont des éléments
 * DOM, ce qui évite toute dépendance à des polices distantes.
 */
import { useEffect, useRef, useState } from 'react';
import { Map as MlMap, Marker, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { bearingDeg, destination, type Bounds, type LatLon, type TerrainKind } from '@warcommand/simulation-core';
import { formatLatLon } from '../user-interface/i18n';
import type { MapScene, MapSymbol, Selection } from './scene';

export interface MapViewProps {
  scene: MapScene;
  view: { center: LatLon; zoom: number };
  /** Emprise à cadrer à l'ouverture (prioritaire sur `view`). */
  fit?: Bounds;
  /** Mode « pointage » : les clics traversent les symboles et sont remis à `onMapClick`. */
  picking: boolean;
  showGraticule: boolean;
  /** Vue 3D : globe, caméra inclinée, altitudes en volume. */
  view3d?: boolean;
  onMapClick?: (pos: LatLon) => void;
  onSelect?: (selection: Selection) => void;
  /** Appelé quand la vue se stabilise (déplacement, zoom) : emprise visible, centre, zoom. */
  onViewChange?: (view: MapViewState) => void;
}

export interface MapViewState {
  bounds: Bounds;
  center: LatLon;
  zoom: number;
}

const SIDE_COLOR = ['match', ['get', 'side'], 'BLUE', '#5ab4ff', 'RED', '#ff6b5e', '#f2c14e'] as unknown as string;

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'sea', type: 'background', paint: { 'background-color': '#14263d' } }],
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Les altitudes sont multipliées pour rester visibles à l'échelle d'un théâtre de plusieurs centaines de kilomètres. */
export const ALTITUDE_EXAGGERATION = 12;
/** Hauteur schématique des zones de terrain du scénario, en mètres : le jeu n'embarque aucun modèle d'altitude. */
const RELIEF_HEIGHT_M: Record<TerrainKind, number> = { montagne: 1800, urbain: 300, foret: 250, marais: 40 };
const RELIEF_COLOR = ['match', ['get', 'terrain'], 'montagne', '#8a7d68', 'urbain', '#9aa0a6', 'foret', '#3f6b4f', '#4f6f73'] as unknown as string;

/** Carré centré sur `pos`, de demi-côté `halfKm`. */
function squareRing(pos: LatLon, halfKm: number): [number, number][] {
  const corners = [45, 135, 225, 315].map((bearing) => lngLat(destination(pos, bearing, halfKm * Math.SQRT2)));
  return [...corners, corners[0]!];
}

/**
 * Volumes de la vue 3D : colonnes d'altitude, rideaux des traces, zones de terrain.
 * Les colonnes ont une largeur constante à l'écran : elle se recalcule donc avec le zoom.
 */
function volumeData(scene: MapScene, zoom: number): FeatureCollection {
  const features: Feature[] = [];
  const polygon = (ring: [number, number][], properties: Record<string, string | number>): Feature => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } });

  for (const zone of scene.relief) {
    features.push(polygon(zone.ring.map(lngLat), { kind: 'relief', terrain: zone.kind, b: 0, h: RELIEF_HEIGHT_M[zone.kind] * ALTITUDE_EXAGGERATION }));
  }
  for (const v of scene.volumes) {
    if (v.altM <= 0) continue;
    const kmPerPx = (40075 * Math.cos((v.pos.lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    const top = v.altM * ALTITUDE_EXAGGERATION;
    const cap = Math.min(top, Math.max(4000, top * 0.07));
    const side = v.side ?? 'NONE';
    features.push(polygon(squareRing(v.pos, 1.2 * kmPerPx), { kind: 'column', side, b: 0, h: top - cap }));
    features.push(polygon(squareRing(v.pos, 4 * kmPerPx), { kind: 'column', side, b: top - cap, h: top }));
  }
  for (const trail of scene.trails) {
    for (let i = 1; i < trail.points.length; i++) {
      const a = trail.points[i - 1]!;
      const b = trail.points[i]!;
      const altM = (a.altM + b.altM) / 2;
      if (altM <= 0 || (a.lat === b.lat && a.lon === b.lon)) continue;
      const kmPerPx = (40075 * Math.cos((a.lat * Math.PI) / 180)) / (512 * 2 ** zoom);
      const bearing = bearingDeg(a, b);
      const ring = [destination(a, bearing - 90, 0.6 * kmPerPx), destination(b, bearing - 90, 0.6 * kmPerPx), destination(b, bearing + 90, 0.6 * kmPerPx), destination(a, bearing + 90, 0.6 * kmPerPx)].map(lngLat);
      features.push(polygon([...ring, ring[0]!], { kind: 'curtain', side: trail.side ?? 'NONE', b: 0, h: altM * ALTITUDE_EXAGGERATION }));
    }
  }
  return { type: 'FeatureCollection', features };
}

function graticule(): FeatureCollection {
  const features: Feature[] = [];
  for (let lat = -84; lat <= 84; lat += 2) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] } });
  }
  for (let lon = -180; lon <= 180; lon += 5) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, -84], [lon, 84]] } });
  }
  return { type: 'FeatureCollection', features };
}

const lngLat = (p: LatLon): [number, number] => [p.lon, p.lat];

/**
 * Déroule les contours qui franchissent l'antiméridien : un saut de +180° à -180° entre deux
 * points consécutifs tracerait sinon un trait parasite à travers toute la carte.
 * Les longitudes déroulées dépassent ±180°, ce que MapLibre sait afficher.
 */
function unwrapAntimeridian(collection: FeatureCollection): FeatureCollection {
  const ring = (points: number[][]): number[][] => {
    let offset = 0;
    let previous: number | null = null;
    return points.map(([lon, lat]) => {
      if (previous !== null) {
        if (lon! - previous > 180) offset -= 360;
        else if (lon! - previous < -180) offset += 360;
      }
      previous = lon!;
      return [lon! + offset, lat!];
    });
  };
  const geometry = (g: Geometry): Geometry => {
    if (g.type === 'Polygon') return { ...g, coordinates: g.coordinates.map(ring) };
    if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map((polygon) => polygon.map(ring)) };
    return g;
  };
  return { ...collection, features: collection.features.map((f) => ({ ...f, geometry: geometry(f.geometry) })) };
}

function overlayData(scene: MapScene): FeatureCollection {
  const features: Feature[] = [];
  for (const s of scene.shapes) {
    const ring = s.ring.map(lngLat);
    const geometry: Geometry = s.kind === 'sector' ? { type: 'Polygon', coordinates: [ring] } : { type: 'LineString', coordinates: ring };
    features.push({ type: 'Feature', properties: { kind: s.kind, side: s.side ?? 'NONE' }, geometry });
  }
  for (const l of scene.lines) {
    features.push({ type: 'Feature', properties: { kind: l.kind, side: l.side ?? 'NONE' }, geometry: { type: 'LineString', coordinates: l.points.map(lngLat) } });
  }
  for (const d of scene.dots) {
    features.push({ type: 'Feature', properties: { kind: d.kind, side: d.side ?? 'NONE' }, geometry: { type: 'Point', coordinates: lngLat(d.pos) } });
  }
  for (const t of scene.trails) {
    features.push({ type: 'Feature', properties: { kind: 'trail', side: t.side ?? 'NONE' }, geometry: { type: 'LineString', coordinates: t.points.map((p) => [p.lon, p.lat]) } });
  }
  return { type: 'FeatureCollection', features };
}

function addLayers(map: MlMap, land: FeatureCollection): void {
  map.addSource('graticule', { type: 'geojson', data: graticule() });
  map.addSource('land', { type: 'geojson', data: land });
  map.addSource('overlay', { type: 'geojson', data: EMPTY });
  map.addSource('volumes', { type: 'geojson', data: EMPTY });

  map.addLayer({ id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': '#ffffff', 'line-opacity': 0.06, 'line-width': 1 } });
  map.addLayer({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#45605a' } });
  map.addLayer({ id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#a9c9b8', 'line-width': 1.1, 'line-opacity': 0.9 } });

  const kind = (k: string) => ['==', ['get', 'kind'], k] as unknown as boolean;
  const line = (id: string, k: string, paint: Record<string, unknown>) =>
    map.addLayer({ id, type: 'line', source: 'overlay', filter: kind(k) as never, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: paint as never });

  map.addLayer({ id: 'sector-fill', type: 'fill', source: 'overlay', filter: kind('sector') as never, paint: { 'fill-color': '#7fb8ff', 'fill-opacity': 0.07 } });
  line('sector-line', 'sector', { 'line-color': '#9fc8ff', 'line-width': 1.4, 'line-dasharray': [4, 3], 'line-opacity': 0.8 });
  line('zone-line', 'zone', { 'line-color': SIDE_COLOR, 'line-width': 1, 'line-dasharray': [1, 3], 'line-opacity': 0.7 });
  line('radar-line', 'radar', { 'line-color': SIDE_COLOR, 'line-width': 1, 'line-dasharray': [2, 4], 'line-opacity': 0.45 });
  line('weapon-line', 'weapon', { 'line-color': SIDE_COLOR, 'line-width': 1.2, 'line-opacity': 0.75 });
  line('threat-line', 'threat', { 'line-color': SIDE_COLOR, 'line-width': 1.2, 'line-dasharray': [3, 3], 'line-opacity': 0.7 });
  line('uncertainty-line', 'uncertainty', { 'line-color': '#f2c14e', 'line-width': 1, 'line-dasharray': [1, 2], 'line-opacity': 0.7 });
  line('terrain-line', 'terrain', { 'line-color': '#c9b48a', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.6 });
  line('footprint-line', 'footprint', { 'line-color': '#d6c6ff', 'line-width': 1.2, 'line-dasharray': [6, 3], 'line-opacity': 0.75 });
  line('trail-line', 'trail', { 'line-color': SIDE_COLOR, 'line-width': 1.4, 'line-opacity': 0.5 });
  line('route-line', 'route', { 'line-color': SIDE_COLOR, 'line-width': 1.8, 'line-dasharray': [3, 2.5], 'line-opacity': 0.9 });
  line('task-line', 'task', { 'line-color': SIDE_COLOR, 'line-width': 1, 'line-opacity': 0.55 });
  line('shot-line', 'shot', { 'line-color': '#ffb347', 'line-width': 1.4, 'line-opacity': 0.9 });
  line('draft-line', 'draft', { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2] });
  line('measure-line', 'measure', { 'line-color': '#ffe27a', 'line-width': 1.6, 'line-dasharray': [1, 2] });
  map.addLayer({ id: 'missile-dot', type: 'circle', source: 'overlay', filter: kind('missile') as never, paint: { 'circle-radius': 3, 'circle-color': '#ffd08a' } });
  map.addLayer({
    id: 'waypoint-dot',
    type: 'circle',
    source: 'overlay',
    filter: kind('waypoint') as never,
    paint: { 'circle-radius': 5, 'circle-color': '#0c1826', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });

  // Volumes de la vue 3D (vides en vue 2D).
  const volume = (id: string, k: string, color: string, opacity: number) =>
    map.addLayer({
      id,
      type: 'fill-extrusion',
      source: 'volumes',
      filter: kind(k) as never,
      paint: { 'fill-extrusion-color': color, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-opacity': opacity } as never,
    });
  volume('relief-3d', 'relief', RELIEF_COLOR, 0.55);
  volume('curtain-3d', 'curtain', SIDE_COLOR, 0.22);
  volume('column-3d', 'column', SIDE_COLOR, 0.92);
}

const FRAMES: Record<MapSymbol['frame'], string> = {
  friend: '<rect x="3" y="6.5" width="22" height="15" rx="3.5"/>',
  hostile: '<path d="M14 2.5 25.5 14 14 25.5 2.5 14Z"/>',
  unknown: '<circle cx="14" cy="14" r="10.5"/>',
  base: '<path d="M5 5h18v18H5z"/><path d="M5 5 23 23M23 5 5 23" stroke-width="1" opacity=".55"/>',
};

function symbolSignature(s: MapSymbol): string {
  const heading = s.headingDeg === null ? 'x' : String(Math.round(s.headingDeg / 3) * 3);
  return [s.frame, s.side ?? 'N', s.code, s.label, s.sub, heading, s.selected ? 1 : 0, s.faded ? 1 : 0].join('|');
}

function renderSymbol(el: HTMLElement, s: MapSymbol): void {
  const tone = s.side === 'BLUE' ? 'blue' : s.side === 'RED' ? 'red' : 'amber';
  el.className = `sym sym--${s.frame} sym--${tone}${s.selected ? ' is-selected' : ''}${s.faded ? ' is-faded' : ''}${s.select ? ' is-clickable' : ''}`;
  const leader = s.headingDeg === null ? '' : `<span class="sym__leader" style="transform:rotate(${Math.round(s.headingDeg)}deg)"></span>`;
  const code = s.frame === 'base' ? '' : `<span class="sym__code"></span>`;
  el.innerHTML = `${leader}<svg class="sym__frame" viewBox="0 0 28 28" aria-hidden="true">${FRAMES[s.frame]}</svg>${code}<span class="sym__label"><b></b><small></small></span>`;
  // Les textes passent par textContent : aucun contenu de scénario n'est interprété comme du HTML.
  const codeEl = el.querySelector('.sym__code');
  if (codeEl) codeEl.textContent = s.code;
  el.querySelector('b')!.textContent = s.label;
  el.querySelector('small')!.textContent = s.sub;
  el.setAttribute('title', s.sub ? `${s.label} — ${s.sub}` : s.label);
}

interface Entry {
  marker: Marker;
  el: HTMLElement;
  signature: string;
}

export function MapView({ scene, view, fit, picking, showGraticule, view3d = false, onMapClick, onSelect, onViewChange }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const entries = useRef(new Map<string, Entry>());
  const handlers = useRef({ onMapClick, onSelect, onViewChange });
  const selections = useRef(new Map<string, Selection>());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [cursor, setCursor] = useState<LatLon | null>(null);
  const initialView = useRef(view);
  const initialFit = useRef(fit);
  const sceneRef = useRef(scene);
  const view3dRef = useRef(view3d);
  sceneRef.current = scene;
  view3dRef.current = view3d;

  handlers.current = { onMapClick, onSelect, onViewChange };

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let cancelled = false;
    let map: MlMap;
    try {
      setWorkerUrl('/vendor/maplibre-gl-worker.mjs');
      map = new MlMap({
        container: node,
        style: BASE_STYLE,
        center: lngLat(initialView.current.center),
        zoom: initialView.current.zoom,
        minZoom: 1.5,
        maxZoom: 10,
        attributionControl: false,
        maxPitch: 75,
        renderWorldCopies: true,
      });
      // Vue 2D par défaut : ni rotation ni inclinaison. La vue 3D les rend.
      map.dragRotate.disable();
      map.touchPitch.disable();
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      return;
    }
    mapRef.current = map;
    const markers = entries.current;
    const box = initialFit.current;
    if (box) map.fitBounds([[box.west, box.south], [box.east, box.north]], { padding: 56, animate: false });

    map.on('load', () => {
      fetch('/data/land-50m.json')
        .then((r) => {
          if (!r.ok) throw new Error(`Fond de carte introuvable (${r.status})`);
          return r.json();
        })
        .then((topology) => {
          if (cancelled) return;
          const land = unwrapAntimeridian(feature(topology, topology.objects.land) as unknown as FeatureCollection);
          addLayers(map, land);
          setReady(true);
        })
        .catch((error: unknown) => {
          if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
        });
    });
    map.on('click', (e) => handlers.current.onMapClick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    map.on('mousemove', (e) => setCursor({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    map.on('mouseout', () => setCursor(null));
    const reportView = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      const clampLon = (v: number) => Math.max(-180, Math.min(180, v));
      const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
      handlers.current.onViewChange?.({
        bounds: { west: clampLon(b.getWest()), east: clampLon(b.getEast()), south: clampLat(b.getSouth()), north: clampLat(b.getNorth()) },
        center: { lat: clampLat(c.lat), lon: clampLon(c.lng) },
        zoom: map.getZoom(),
      });
    };
    map.on('moveend', reportView);
    map.on('load', reportView);
    // Les colonnes gardent une largeur constante à l'écran : on les recalcule quand le zoom change.
    map.on('zoomend', () => {
      if (!view3dRef.current) return;
      (map.getSource('volumes') as GeoJSONSource | undefined)?.setData(volumeData(sceneRef.current, map.getZoom()));
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      for (const entry of markers.values()) entry.marker.remove();
      markers.clear();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty('graticule', 'visibility', showGraticule ? 'visible' : 'none');
  }, [showGraticule, ready]);

  // Bascule entre la carte plane et le globe incliné.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setProjection({ type: view3d ? 'globe' : 'mercator' });
    if (view3d) {
      map.dragRotate.enable();
      map.touchPitch.enable();
      map.touchZoomRotate.enableRotation();
      map.keyboard.enableRotation();
      map.easeTo({ pitch: 55, duration: 700 });
    } else {
      map.dragRotate.disable();
      map.touchPitch.disable();
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    }
  }, [view3d, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('overlay') as GeoJSONSource | undefined)?.setData(overlayData(scene));
    (map.getSource('volumes') as GeoJSONSource | undefined)?.setData(view3d ? volumeData(scene, map.getZoom()) : EMPTY);

    const seen = new Set<string>();
    const place = (key: string, pos: LatLon, signature: string, render: (el: HTMLElement) => void, selection: Selection) => {
      seen.add(key);
      selections.current.set(key, selection);
      let entry = entries.current.get(key);
      if (!entry) {
        // Racine de taille nulle gérée par MapLibre ; le contenu, centré dessus, est géré ici.
        const root = document.createElement('div');
        root.className = 'marker-root';
        const el = document.createElement('div');
        root.appendChild(el);
        root.addEventListener('click', (event) => {
          const target = selections.current.get(key);
          if (!target) return;
          event.stopPropagation();
          handlers.current.onSelect?.(target);
        });
        const marker = new Marker({ element: root, anchor: 'center' }).setLngLat(lngLat(pos)).addTo(map);
        entry = { marker, el, signature: '' };
        entries.current.set(key, entry);
      } else {
        entry.marker.setLngLat(lngLat(pos));
      }
      if (entry.signature !== signature) {
        render(entry.el);
        entry.signature = signature;
      }
    };

    for (const s of scene.symbols) place(s.key, s.pos, symbolSignature(s), (el) => renderSymbol(el, s), s.select);
    for (const l of scene.labels) {
      place(
        `label:${l.key}`,
        l.pos,
        `${l.tone}|${l.text}`,
        (el) => {
          el.className = `maplabel maplabel--${l.tone}`;
          el.textContent = l.text;
        },
        null,
      );
    }
    for (const [key, entry] of entries.current) {
      if (seen.has(key)) continue;
      entry.marker.remove();
      entries.current.delete(key);
      selections.current.delete(key);
    }
  }, [scene, ready, view3d]);

  return (
    <div className={`mapview${picking ? ' mapview--picking' : ''}`}>
      <div ref={container} className="mapview__canvas" />
      {failed ? <div className="mapview__error">La carte n’a pas pu être affichée : {failed}</div> : null}
      {!ready && !failed ? <div className="mapview__loading">Chargement de la carte…</div> : null}
      <div className="mapview__readout">{cursor ? formatLatLon(cursor.lat, cursor.lon) : 'WGS84'}</div>
      {view3d ? (
        <div className="mapview__mode">
          Vue 3D · altitudes × {ALTITUDE_EXAGGERATION} · terrain schématique (zones du scénario) · clic droit ou Ctrl + glisser : tourner et incliner
        </div>
      ) : null}
      <div className="mapview__credit">Fond : Natural Earth (domaine public) · Carte : MapLibre GL JS</div>
    </div>
  );
}
