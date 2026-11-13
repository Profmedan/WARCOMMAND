/**
 * Capteurs, détection probabiliste et tenue des pistes.
 *
 * Trois familles de capteurs :
 *  - radar   : portée, signature, horizon, secteur balayé, tirage ; identification progressive ;
 *  - écoute  : tout radar qui émet se trahit, à 1,2 fois sa portée, auprès des unités dotées d'un
 *              détecteur d'émissions ; la piste obtenue ne permet pas le tir ;
 *  - optronique (drone) : repère et identifie les unités de surface et au sol, même silencieuses ;
 *              portée réduite de nuit ; constate les destructions.
 *
 * Simplifications documentées : liaison de données parfaite au sein d'un camp, pas de relief,
 * pas d'erreur de mesure, un tirage par cible et par balayage, jour et nuit évalués au centre
 * du secteur d'objectif.
 */
import {
  angleDiffDeg,
  bearingDeg,
  distanceKm,
  emit,
  isNight,
  opponent,
  radarHorizonKm,
  rand,
  SIDES,
  type Contact,
  type ContactSource,
  type SideId,
  type SimState,
  type System,
  type Unit,
} from '@warcommand/simulation-core';
import { perfOf, radarEmitting } from './helpers';

function isOperational(u: Unit): boolean {
  return u.status === 'airborne' || u.status === 'active';
}

export function sensorHeightM(s: SimState, u: Unit): number {
  return u.domain === 'air' ? u.altM : perfOf(s, u).antennaHeightM;
}

export function targetHeightM(s: SimState, u: Unit): number {
  return u.domain === 'air' ? u.altM : s.rules.surfaceTargetHeightM;
}

export function nightNow(s: SimState): boolean {
  return isNight(s.startIso, s.time, s.objective.center, s.rules.nightSunElevationDeg);
}

/**
 * Qualité de détection radar d'une cible par un capteur : 0 si la détection est impossible
 * (radar coupé, hors portée, sous l'horizon, hors secteur), sinon distance / portée efficace dans ]0, 1].
 */
export function detectionRatio(s: SimState, observer: Unit, target: Unit): number {
  // Un radar ne voit ni ce qui est au sol, ni un sous-marin en plongée.
  if (!radarEmitting(s, observer) || target.domain === 'ground' || target.kind === 'sub') return 0;
  const p = perfOf(s, observer);
  const d = distanceKm(observer.pos, target.pos);
  const signature = perfOf(s, target).signature;
  // Équation radar : la portée varie comme la racine quatrième de la signature.
  const effective = p.radarRangeKm * Math.pow(signature, 0.25) * s.weather.sensorFactor;
  if (d > effective) return 0;
  if (d > radarHorizonKm(sensorHeightM(s, observer), targetHeightM(s, target))) return 0;
  if (p.radarArcDeg < 360 && d > 1) {
    const off = angleDiffDeg(bearingDeg(observer.pos, target.pos), observer.headingDeg);
    if (off > p.radarArcDeg / 2) return 0;
  }
  return Math.max(1e-6, d / effective);
}

export function detectionProbability(s: SimState, ratio: number): number {
  if (ratio <= 0) return 0;
  return s.rules.pDetectMax * (1 - Math.pow(ratio, s.rules.detectExponent));
}

/** L'observateur peut-il capter les émissions radar de la cible ? */
export function canHearEmitter(s: SimState, observer: Unit, emitter: Unit): boolean {
  if (!isOperational(observer) || !perfOf(s, observer).esm) return false;
  if (observer.domain !== 'air' && observer.damaged) return false;
  if (!radarEmitting(s, emitter)) return false;
  const d = distanceKm(observer.pos, emitter.pos);
  if (d > perfOf(s, emitter).radarRangeKm * s.rules.esmRangeFactor) return false;
  return d <= radarHorizonKm(sensorHeightM(s, observer), sensorHeightM(s, emitter));
}

/** Portée optronique effective d'un observateur, compte tenu de la nuit. */
export function eoRangeKm(s: SimState, observer: Unit, night: boolean): number {
  if (observer.status !== 'airborne') return 0;
  return perfOf(s, observer).eoRangeKm * (night ? s.rules.nightEoFactor : 1);
}

/** L'observateur peut-il voir à l'optronique un point de la surface ? */
export function canSeeSurface(s: SimState, observer: Unit, pos: { lat: number; lon: number }, night: boolean): boolean {
  const range = eoRangeKm(s, observer, night);
  if (range <= 0) return false;
  const d = distanceKm(observer.pos, pos);
  return d <= range && d <= radarHorizonKm(observer.altM, s.rules.surfaceTargetHeightM);
}

function contactFor(s: SimState, side: SideId, unitId: string): Contact | undefined {
  for (const c of Object.values(s.contacts[side])) if (c.unitId === unitId) return c;
  return undefined;
}

/** Crée ou rafraîchit la piste d'un camp sur une unité adverse effectivement observée. */
export function observe(s: SimState, side: SideId, target: Unit, identify: boolean, source: ContactSource = 'radar'): Contact {
  let c = contactFor(s, side, target.id);
  if (!c) {
    const seq = (s.contactSeq[side] += 1);
    const prefix = target.side === 'RED' ? 'R' : 'B';
    c = {
      id: `${prefix}${String(seq).padStart(2, '0')}`,
      unitId: target.id,
      domain: target.domain,
      pos: { lat: target.pos.lat, lon: target.pos.lon },
      altM: target.altM,
      headingDeg: target.headingDeg,
      speedKmh: target.speedKmh,
      firstSeen: s.time,
      lastSeen: s.time,
      idProgress: 0,
      identified: false,
      kind: null,
      label: null,
      stale: false,
      hostileAct: false,
      damaged: false,
      radarSeenAt: -1e9,
      source,
      fixed: false,
    };
    s.contacts[side][c.id] = c;
    emit(s, 'CONTACT_NEW', [side], { contact: c.id, domain: c.domain, source });
  }
  c.pos = { lat: target.pos.lat, lon: target.pos.lon };
  c.altM = target.altM;
  c.headingDeg = target.headingDeg;
  c.speedKmh = target.speedKmh;
  c.lastSeen = s.time;
  c.stale = false;
  c.source = source;
  if (source === 'radar') c.radarSeenAt = s.time;
  // Seul un site sol-air est un site fixe ; une formation terrestre se déplace, sa piste vieillit et se perd.
  if (target.kind === 'sam') c.fixed = true;
  if (identify && !c.identified) {
    c.identified = true;
    c.idProgress = 1;
    c.kind = target.kind;
    c.label = perfOf(s, target).label;
    emit(s, 'CONTACT_IDENTIFIED', [side], { contact: c.id, label: c.label, kind: c.kind });
  }
  return c;
}

function progressIdentification(s: SimState, side: SideId, target: Unit, c: Contact, gain: number): void {
  if (c.identified) return;
  c.idProgress += gain;
  if (c.idProgress >= 1) observe(s, side, target, true, c.source);
}

function sweep(s: SimState, side: SideId, night: boolean): void {
  const enemy = opponent(side);
  const own: Unit[] = [];
  const targets: Unit[] = [];
  for (const u of Object.values(s.units)) {
    if (!isOperational(u)) continue;
    if (u.side === side) own.push(u);
    else if (u.side === enemy) targets.push(u);
  }
  const visualKm = s.rules.visualIdKm * (night ? s.rules.nightVisualFactor : 1);

  for (const target of targets) {
    // 1. Radar.
    let bestRatio = 0;
    let closestKm = Infinity;
    for (const o of own) {
      const ratio = detectionRatio(s, o, target);
      if (ratio <= 0) continue;
      if (bestRatio === 0 || ratio < bestRatio) bestRatio = ratio;
      closestKm = Math.min(closestKm, distanceKm(o.pos, target.pos));
    }
    if (bestRatio > 0 && rand(s.rng, 'sim') < detectionProbability(s, bestRatio)) {
      const c = observe(s, side, target, false, 'radar');
      progressIdentification(s, side, target, c, closestKm <= visualKm ? 1 : s.rules.idRate * (1 - bestRatio));
      continue;
    }
    // 2. Écoute des émissions radar.
    if (own.some((o) => canHearEmitter(s, o, target)) && rand(s.rng, 'sim') < s.rules.esmDetectP) {
      const c = observe(s, side, target, false, 'esm');
      progressIdentification(s, side, target, c, s.rules.esmIdRate);
      continue;
    }
    // 3. Optronique : unités de surface et au sol.
    const hidden = target.kind === 'sub' || target.kind === 'sof';
    if (target.domain !== 'air' && !hidden && own.some((o) => canSeeSurface(s, o, target.pos, night)) && rand(s.rng, 'sim') < s.rules.eoDetectP) {
      observe(s, side, target, true, 'eo');
    }
  }

  for (const c of Object.values(s.contacts[side])) {
    const age = s.time - c.lastSeen;
    if (!c.stale && age > s.rules.staleAfterS) c.stale = true;

    // Constat de destruction : un capteur optronique, ou un appareil tout proche, voit le site détruit.
    const unit = s.units[c.unitId];
    if (unit && unit.status === 'destroyed' && unit.domain !== 'air') {
      const bdaKm = s.rules.bdaRangeKm * (night ? s.rules.nightVisualFactor : 1);
      const witnessed = own.some((o) => o.status === 'airborne' && (canSeeSurface(s, o, c.pos, night) || distanceKm(o.pos, c.pos) <= bdaKm));
      if (witnessed) {
        delete s.contacts[side][c.id];
        emit(s, 'CONTACT_DESTROYED', [side], { contact: c.id });
        continue;
      }
    }

    // Un site fixe vieillit mais n'est jamais abandonné : sa position reste un renseignement.
    if (c.fixed) continue;
    const dropAfter = c.domain === 'air' ? s.rules.dropAirAfterS : s.rules.dropSurfaceAfterS;
    if (age > dropAfter) {
      delete s.contacts[side][c.id];
      emit(s, 'CONTACT_LOST', [side], { contact: c.id });
    }
  }
}

export const sensorSystem: System = (s) => {
  if (s.time % s.rules.sensorIntervalS !== 0) return;
  const night = nightNow(s);
  for (const side of SIDES) sweep(s, side, night);
};
