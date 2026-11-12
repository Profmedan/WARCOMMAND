/**
 * Engagement : décision de tir (règles d'engagement) → vol du missile → résolution → dommages.
 *
 * Air-air et sol-air : le résultat ne dépend pas d'une « note » de l'appareil. La probabilité de
 * coup au but combine la distance de tir, l'entraînement du tireur, l'autoprotection de la cible,
 * le type de cible et surtout la connaissance de la situation (une cible qui n'a pas vu le tireur
 * est surprise).
 *
 * Air-surface (SEAD) : un chasseur en mission d'attaque tire sur le site sol-air ou le bâtiment
 * désigné. Un coup au but décisif détruit le site (ou met le bâtiment hors de combat) ; sinon il
 * le neutralise dix minutes ; un tir manqué lui impose deux minutes de silence.
 *
 * Toutes les valeurs sont des paramètres de jeu (voir docs/modele-de-jeu.md).
 */
import {
  angleDiffDeg,
  bearingDeg,
  distanceKm,
  emit,
  opponent,
  radarHorizonKm,
  rand,
  type Contact,
  type PlatformPerf,
  type Roe,
  type Shot,
  type SimState,
  type System,
  type Unit,
} from '@warcommand/simulation-core';
import { destroyUnit, missionOf, perfOf, radarEmitting, roeAllows, shotsInFlightOn } from './helpers';
import { canSeeSurface, nightNow, observe, sensorHeightM } from './sensors';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function rangeFactor(shot: Shot): number {
  return 1.15 - 0.5 * Math.min(1, shot.launchRangeKm / Math.max(1, shot.maxRangeKm));
}

/** Probabilité de coup au but d'un tir air-air ou sol-air. */
export function hitProbability(s: SimState, shot: Shot, target: Unit, targetPerf: PlatformPerf): number {
  const r = s.rules;
  const base = shot.weapon === 'aam' ? r.pkBaseAam : r.pkBaseSam;
  const crewFactor = 0.8 + 0.4 * shot.shooterCrew;
  const ecmFactor = 1 - targetPerf.ecm;
  const awarenessFactor = shot.targetAware ? r.pkAwareFactor : r.pkSurpriseFactor;
  const sizeFactor = target.kind === 'fighter' ? 1 : r.pkLargeTargetFactor;
  const damageFactor = target.damaged ? r.pkDamagedTargetFactor : 1;
  return clamp(base * rangeFactor(shot) * crewFactor * ecmFactor * awarenessFactor * sizeFactor * damageFactor, r.pkMin, r.pkMax);
}

/** Probabilité de coup au but d'une munition air-surface sur un site sol-air ou un bâtiment. */
export function asmHitProbability(s: SimState, shot: Shot, target: Unit): number {
  const r = s.rules;
  const crewFactor = 0.8 + 0.4 * shot.shooterCrew;
  const defence = target.kind === 'ship' ? r.shipDefenceFactor : 1;
  const intel = shot.intelStale ? r.staleIntelFactor : 1;
  return clamp(r.pkBaseAsm * rangeFactor(shot) * crewFactor * defence * intel, r.pkMin, r.pkMax);
}

function resolveAirShot(s: SimState, shot: Shot, target: Unit, observed: boolean, tracked: Contact | undefined): void {
  const pk = hitProbability(s, shot, target, perfOf(s, target));
  const roll = rand(s.rng, 'sim');
  let result: 'miss' | 'damaged' | 'destroyed' = 'miss';
  if (roll < pk) {
    s.stats[shot.side].hits += 1;
    const lethal = target.damaged || rand(s.rng, 'sim') < s.rules.killGivenHit;
    result = lethal ? 'destroyed' : 'damaged';
  }
  emit(s, 'SHOT_RESOLVED', [], { shooter: shot.shooterName, target: target.name, weapon: shot.weapon, pk: round3(pk), roll: round3(roll), result });

  const seen = observed ? result : 'unobserved';
  if (result === 'destroyed') {
    s.stats[shot.side].kills += 1;
    emit(s, 'UNIT_DESTROYED', [target.side], { unit: target.name });
    emit(s, 'SHOT_RESULT', [shot.side], { unit: shot.shooterName, contact: shot.contactId, result: seen });
    destroyUnit(s, target);
  } else if (result === 'damaged') {
    target.damaged = true;
    s.stats[target.side].damaged += 1;
    // Le tireur ne sait la cible endommagée que s'il a pu observer le résultat.
    if (observed && tracked) tracked.damaged = true;
    emit(s, 'UNIT_DAMAGED', [target.side], { unit: target.name });
    emit(s, 'SHOT_RESULT', [shot.side], { unit: shot.shooterName, contact: shot.contactId, result: seen });
  } else {
    emit(s, 'MISSILE_EVADED', [target.side], { unit: target.name });
    emit(s, 'SHOT_RESULT', [shot.side], { unit: shot.shooterName, contact: shot.contactId, result: seen });
  }
}

/** Un appareil ami est-il en mesure de constater le résultat d'un tir air-surface ? */
function surfaceResultWitnessed(s: SimState, shot: Shot, target: Unit): boolean {
  const night = nightNow(s);
  const closeKm = s.rules.bdaRangeKm * (night ? s.rules.nightVisualFactor : 1);
  for (const u of Object.values(s.units)) {
    if (u.side !== shot.side || u.status !== 'airborne') continue;
    if (canSeeSurface(s, u, target.pos, night) || distanceKm(u.pos, target.pos) <= closeKm) return true;
  }
  return false;
}

function resolveSurfaceShot(s: SimState, shot: Shot, target: Unit, tracked: Contact | undefined): void {
  const pk = asmHitProbability(s, shot, target);
  const roll = rand(s.rng, 'sim');
  let result: 'miss' | 'suppressed' | 'damaged' | 'destroyed' = 'miss';
  if (roll < pk) {
    s.stats[shot.side].hits += 1;
    const decisive = rand(s.rng, 'sim') < s.rules.asmKillGivenHit;
    result = !decisive ? 'suppressed' : target.kind === 'ship' ? 'damaged' : 'destroyed';
  }
  emit(s, 'SHOT_RESOLVED', [], { shooter: shot.shooterName, target: target.name, weapon: shot.weapon, pk: round3(pk), roll: round3(roll), result });

  const witnessed = surfaceResultWitnessed(s, shot, target);
  emit(s, 'SHOT_RESULT', [shot.side], { unit: shot.shooterName, contact: shot.contactId, result: witnessed ? result : 'unobserved' });

  if (result === 'destroyed') {
    s.stats[shot.side].kills += 1;
    emit(s, 'UNIT_DESTROYED', [target.side], { unit: target.name });
    destroyUnit(s, target);
    return;
  }
  if (result === 'damaged') {
    // Bâtiment hors de combat : ni radar ni tir jusqu'à la fin, mais il reste à flot.
    target.damaged = true;
    s.stats[target.side].damaged += 1;
    if (witnessed && tracked) tracked.damaged = true;
    emit(s, 'UNIT_DAMAGED', [target.side], { unit: target.name });
    return;
  }
  const duration = result === 'suppressed' ? s.rules.suppressHitS : s.rules.suppressMissS;
  const until = Math.max(target.suppressedUntil, s.time + duration);
  if (until > target.suppressedUntil) {
    target.suppressedUntil = until;
    emit(s, 'UNIT_SUPPRESSED', [target.side], { unit: target.name, until });
  }
}

function resolveShots(s: SimState): void {
  const pending: Shot[] = [];
  for (const shot of s.shots) {
    if (shot.impactAt > s.time) {
      pending.push(shot);
      continue;
    }
    const target = s.units[shot.targetId]!;
    const tracked = s.contacts[shot.side][shot.contactId];
    const surface = shot.weapon === 'asm';
    const alive = surface ? target.status === 'active' : target.status === 'airborne';
    if (!alive) {
      emit(s, 'SHOT_RESULT', [shot.side], { unit: shot.shooterName, contact: shot.contactId, result: 'lost' });
      continue;
    }
    if (surface) resolveSurfaceShot(s, shot, target, tracked);
    else resolveAirShot(s, shot, target, tracked !== undefined && !tracked.stale, tracked);
  }
  s.shots = pending;
}

/** Fin de neutralisation : le radar d'une unité de surface ou sol-air reprend. */
function recoverSuppressed(s: SimState): void {
  for (const u of Object.values(s.units)) {
    if (u.suppressedUntil > 0 && s.time >= u.suppressedUntil) {
      u.suppressedUntil = 0;
      if (u.status === 'active') emit(s, 'UNIT_RECOVERED', [u.side], { unit: u.name });
    }
  }
}

function canShoot(s: SimState, u: Unit, p: PlatformPerf): boolean {
  if (p.weapon === 'none' || u.weapons <= 0 || u.damaged) return false;
  if (u.status !== 'airborne' && u.status !== 'active') return false;
  if (u.task === 'refuel' || u.task === 'refueling') return false;
  if (u.domain !== 'air' && !radarEmitting(s, u)) return false;
  return s.time - u.lastShotAt >= s.rules.shotCooldownS;
}

function roeOf(s: SimState, u: Unit): Roe {
  if (u.domain !== 'air') return s.defaultRoe[u.side];
  return missionOf(s, u)?.roe ?? 'hold';
}

function inboundOn(s: SimState, u: Unit, contact: Contact): number {
  return shotsInFlightOn(s, u.side, contact.unitId);
}

function pickTarget(s: SimState, u: Unit, p: PlatformPerf): { contact: Contact; rangeKm: number } | null {
  const roe = roeOf(s, u);
  let best: { contact: Contact; rangeKm: number; inbound: number } | null = null;
  for (const c of Object.values(s.contacts[u.side])) {
    if (c.domain !== 'air' || c.stale) continue;
    // Une piste connue par ses seules émissions ne suffit pas : il faut une piste radar fraîche.
    if (s.time - c.radarSeenAt > s.rules.staleAfterS) continue;
    const d = distanceKm(u.pos, c.pos);
    if (d > p.weaponRangeKm * s.rules.fireRangeFraction) continue;
    if (u.domain === 'air') {
      // Tir dans le secteur avant uniquement.
      if (d > 1 && angleDiffDeg(bearingDeg(u.pos, c.pos), u.headingDeg) > p.radarArcDeg / 2) continue;
    } else if (d > radarHorizonKm(sensorHeightM(s, u), c.altM)) {
      // Une unité de surface ne tire que sur ce que son propre radar peut éclairer.
      continue;
    }
    if (!roeAllows(s, u, roe, c)) continue;
    const inbound = inboundOn(s, u, c);
    if (inbound >= s.rules.maxShotsPerTarget) continue;
    if (!best || inbound < best.inbound || (inbound === best.inbound && d < best.rangeKm)) {
      best = { contact: c, rangeKm: d, inbound };
    }
  }
  return best;
}

function fire(s: SimState, u: Unit, p: PlatformPerf, contact: Contact, rangeKm: number): void {
  const enemy = opponent(u.side);
  const target = s.units[contact.unitId]!;
  const weapon = p.weapon === 'sam' ? 'sam' : 'aam';
  const speed = weapon === 'aam' ? s.rules.aamSpeedKmh : s.rules.samSpeedKmh;
  const flightS = Math.max(5, Math.round((rangeKm / speed) * 3600));

  // La cible est-elle prévenue ? Un tir sol-air est toujours détecté (éclairage radar) ;
  // un tir air-air ne l'est que si le camp visé tenait une piste fraîche sur le tireur.
  let aware = weapon === 'sam';
  for (const c of Object.values(s.contacts[enemy])) {
    if (c.unitId !== u.id) continue;
    if (!c.stale) {
      aware = true;
      c.hostileAct = true;
    }
  }

  u.weapons -= 1;
  u.lastShotAt = s.time;
  s.stats[u.side].shotsFired += 1;
  s.shots.push({
    id: (s.shotSeq += 1),
    side: u.side,
    shooterId: u.id,
    shooterName: u.name,
    targetId: target.id,
    contactId: contact.id,
    weapon,
    firedAt: s.time,
    impactAt: s.time + flightS,
    launchRangeKm: rangeKm,
    maxRangeKm: p.weaponRangeKm,
    shooterCrew: u.crew,
    intelStale: false,
    targetAware: aware,
    from: { lat: u.pos.lat, lon: u.pos.lon },
  });
  emit(s, 'SHOT_FIRED', [u.side], { unit: u.name, contact: contact.id, weapon });

  if (weapon === 'sam') {
    // Le tir révèle le site ou le bâtiment au camp visé.
    const revealed = observe(s, enemy, u, true, 'fire');
    revealed.hostileAct = true;
  }
  if (aware) emit(s, 'MISSILE_WARNING', [enemy], { unit: target.name });
}

/** Tir air-surface d'un chasseur en mission d'attaque sur le site désigné. */
function fireAtSite(s: SimState, u: Unit, p: PlatformPerf): void {
  if (u.kind !== 'fighter' || u.status !== 'airborne' || u.task !== 'attack' || u.asm <= 0 || u.damaged) return;
  if (s.time - u.lastShotAt < s.rules.shotCooldownS) return;
  const m = missionOf(s, u);
  if (!m || m.type !== 'SEAD' || !m.targetContactId) return;
  const c = s.contacts[u.side][m.targetContactId];
  if (!c || !c.identified || (c.kind !== 'sam' && c.kind !== 'ship')) return;
  // Un bâtiment se déplace : il faut une position fraîche. Un site fixe peut être tiré sur renseignement ancien.
  if (c.kind === 'ship' && c.stale) return;
  const rangeKm = distanceKm(u.pos, c.pos);
  if (rangeKm > p.asmRangeKm * s.rules.fireRangeFraction) return;
  if (inboundOn(s, u, c) >= s.rules.maxShotsPerTarget) return;

  u.asm -= 1;
  u.lastShotAt = s.time;
  s.stats[u.side].shotsFired += 1;
  s.stats[u.side].asmFired += 1;
  s.shots.push({
    id: (s.shotSeq += 1),
    side: u.side,
    shooterId: u.id,
    shooterName: u.name,
    targetId: c.unitId,
    contactId: c.id,
    weapon: 'asm',
    firedAt: s.time,
    impactAt: s.time + Math.max(5, Math.round((rangeKm / s.rules.asmSpeedKmh) * 3600)),
    launchRangeKm: rangeKm,
    maxRangeKm: p.asmRangeKm,
    shooterCrew: u.crew,
    intelStale: c.stale,
    targetAware: true,
    from: { lat: u.pos.lat, lon: u.pos.lon },
  });
  emit(s, 'SHOT_FIRED', [u.side], { unit: u.name, contact: c.id, weapon: 'asm' });
}

export const engagementSystem: System = (s) => {
  resolveShots(s);
  recoverSuppressed(s);
  for (const u of Object.values(s.units)) {
    const p = perfOf(s, u);
    const pick = canShoot(s, u, p) ? pickTarget(s, u, p) : null;
    if (pick) fire(s, u, p, pick.contact, pick.rangeKm);
    else fireAtSite(s, u, p);
  }
};
