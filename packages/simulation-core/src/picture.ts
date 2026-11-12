/**
 * Image de la situation d'un camp — le brouillard de guerre.
 *
 * C'est la seule vue que reçoivent l'IA adverse et l'interface en cours de partie.
 * Elle ne contient ni les unités adverses non détectées, ni aucun identifiant de vérité-terrain.
 */
import { distanceKm, type Bounds, type Circle, type LatLon } from './geo';
import {
  opponent,
  type Base,
  type Contact,
  type ContactSource,
  type ControlStatus,
  type DoctrineParams,
  type Domain,
  type Group,
  type Mission,
  type PerceivedControl,
  type PlatformPerf,
  type Roe,
  type Rules,
  type ShotWeapon,
  type SideId,
  type SimState,
  type Unit,
  type UnitKind,
} from './types';

export interface ContactView {
  id: string;
  domain: Domain;
  pos: LatLon;
  altM: number;
  headingDeg: number;
  speedKmh: number;
  firstSeen: number;
  lastSeen: number;
  ageS: number;
  /** Information ancienne : la piste n'est plus entretenue par un capteur. */
  stale: boolean;
  identified: boolean;
  kind: UnitKind | null;
  label: string | null;
  hostileAct: boolean;
  /** Dommage constaté (résultat de tir observé) : l'appareil n'est plus apte au combat. */
  damaged: boolean;
  source: ContactSource;
  /** Piste radar fraîche : condition d'un tir air-air ou sol-air. */
  radarTracked: boolean;
  fixed: boolean;
  /** Rayon d'incertitude sur la position, croissant avec l'âge de l'information. */
  uncertaintyKm: number;
  inSector: boolean;
}

/** Tir ami en vol. La cible n'est désignée que par sa piste, jamais par son identité réelle. */
export interface ShotView {
  id: number;
  from: LatLon;
  contactId: string;
  weapon: ShotWeapon;
  firedAt: number;
  impactAt: number;
}

export interface ObjectiveView {
  id: string;
  name: string;
  center: LatLon;
  radiusKm: number;
  defender: SideId;
  defenderWinsAtSec: number;
  challengerWinsBelowSec: number;
  perceived: PerceivedControl;
}

export interface SidePicture {
  side: SideId;
  time: number;
  endTime: number;
  startIso: string;
  wegoTurnS: number;
  sideName: string;
  groups: Group[];
  units: Unit[];
  missions: Mission[];
  bases: Base[];
  /** Infrastructures fixes adverses connues (les bases figurent au dossier de renseignement). */
  enemyBases: { name: string; pos: LatLon }[];
  contacts: ContactView[];
  /** Tirs amis en vol (les tirs adverses ne sont connus que par les alertes). */
  shots: ShotView[];
  objective: ObjectiveView;
  platforms: Record<string, PlatformPerf>;
  rules: Rules;
  doctrine: DoctrineParams;
  defaultRoe: Roe;
  navalZone: Circle | null;
  theater: Bounds;
  ended: boolean;
}

export function contactView(state: SimState, c: Contact): ContactView {
  const ageS = Math.max(0, state.time - c.lastSeen);
  const uncertaintyKm = c.fixed || !c.stale ? 0 : Math.min(250, (c.speedKmh * ageS) / 3600);
  return {
    id: c.id,
    domain: c.domain,
    pos: { lat: c.pos.lat, lon: c.pos.lon },
    altM: c.altM,
    headingDeg: c.headingDeg,
    speedKmh: c.speedKmh,
    firstSeen: c.firstSeen,
    lastSeen: c.lastSeen,
    ageS,
    stale: c.stale,
    identified: c.identified,
    kind: c.kind,
    label: c.label,
    hostileAct: c.hostileAct,
    damaged: c.damaged,
    source: c.source,
    radarTracked: !c.stale && state.time - c.radarSeenAt <= state.rules.staleAfterS,
    fixed: c.fixed,
    uncertaintyKm,
    inSector: distanceKm(c.pos, state.objective.center) <= state.objective.radiusKm,
  };
}

export function getSidePicture(state: SimState, side: SideId): SidePicture {
  const enemy = opponent(side);
  const o = state.objective;
  return {
    side,
    time: state.time,
    endTime: state.endTime,
    startIso: state.startIso,
    wegoTurnS: state.wegoTurnS,
    sideName: state.sideNames[side],
    groups: Object.values(state.groups).filter((g) => g.side === side),
    units: Object.values(state.units).filter((u) => u.side === side),
    missions: Object.values(state.missions).filter((m) => m.side === side),
    bases: Object.values(state.bases).filter((b) => b.side === side),
    enemyBases: Object.values(state.bases)
      .filter((b) => b.side === enemy)
      .map((b) => ({ name: b.name, pos: { lat: b.pos.lat, lon: b.pos.lon } })),
    contacts: Object.values(state.contacts[side]).map((c) => contactView(state, c)),
    shots: state.shots
      .filter((shot) => shot.side === side)
      .map((shot) => ({
        id: shot.id,
        from: { lat: shot.from.lat, lon: shot.from.lon },
        contactId: shot.contactId,
        weapon: shot.weapon,
        firedAt: shot.firedAt,
        impactAt: shot.impactAt,
      })),
    objective: {
      id: o.id,
      name: o.name,
      center: o.center,
      radiusKm: o.radiusKm,
      defender: o.defender,
      defenderWinsAtSec: o.defenderWinsAtSec,
      challengerWinsBelowSec: o.challengerWinsBelowSec,
      perceived: o.perceived[side],
    },
    platforms: state.platforms,
    rules: state.rules,
    doctrine: state.doctrine[side],
    defaultRoe: state.defaultRoe[side],
    navalZone: state.navalZones[side],
    theater: state.theater,
    ended: state.outcome !== null,
  };
}

/** Un chasseur « apte au combat » compte pour le contrôle du secteur. */
export function isCombatReadyFighter(u: Unit): boolean {
  return u.kind === 'fighter' && u.status === 'airborne' && !u.damaged && u.weapons > 0;
}

export function controlStatusOf(ownPresent: boolean, enemyPresent: boolean, own: SideId, previous: SideId): ControlStatus {
  if (ownPresent && enemyPresent) return 'CONTESTED';
  if (ownPresent) return own;
  if (enemyPresent) return opponent(own);
  return previous;
}
