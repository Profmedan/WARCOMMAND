/**
 * Opérations navales : groupes et escortes, bases embarquées, écoute sous-marine, lutte antinavire
 * (missiles, torpilles), lutte anti-sous-marine, débarquement, recomplètement à la mer.
 *
 * Modèle ludique documenté dans docs/modele-de-jeu.md. Simplifications : un sous-marin est toujours
 * en plongée ; le sonar est un tirage par cible et par balayage ; l'arme anti-sous-marine et la
 * défense antimissile sont abstraites ; un missile antinavire ou une torpille vaut un tirage unique
 * à l'impact ; le recomplètement livre une munition par bâtiment et par intervalle.
 */
import {
  destination,
  distanceKm,
  emit,
  isSurfaceShip,
  opponent,
  rand,
  serviceDegraded,
  shotFacts,
  type Contact,
  type PlatformPerf,
  type Shot,
  type ShotWeapon,
  type SideId,
  type SimState,
  type System,
  type Unit,
} from '@warcommand/simulation-core';
import { hitShip, observe, perfOf, radarEmitting, roeAllows } from '@warcommand/air-operations';

/** Positions des escortes autour du chef de file : gisement par rapport à son cap. */
const STATION_BEARINGS = [135, -135, 90, -90, 180, 45, -45];
/** Une escorte ne manœuvre que si elle est à plus de cette distance de son poste. */
const STATION_SLACK_KM = 0.3;
/** Vitesse de mise en œuvre de l'arme anti-sous-marine (hélicoptère ou roquette, abstraits). */
const ASW_DELIVERY_KMH = 300;
/** Coût, en points de dépôt, d'une munition recomplétée à la mer. */
const REPLENISH_COST = { sam: 2, ssm: 5, torpedo: 5 } as const;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const isNavalWeapon = (w: ShotWeapon): boolean => w === 'ssm' || w === 'torpedo' || w === 'asw';

/* ------------------------------------------------------------------ Ce qui suit un bâtiment */

function carry(s: SimState): void {
  for (const b of Object.values(s.bases)) {
    const host = b.hostUnitId ? s.units[b.hostUnitId] : undefined;
    if (!host) continue;
    b.pos = { lat: host.pos.lat, lon: host.pos.lon };
    // Les appareils posés sur le pont suivent le bâtiment.
    for (const u of Object.values(s.units)) {
      if (u.baseId === b.id && u.status !== 'airborne' && u.status !== 'destroyed' && u.status !== 'active' && u.status !== 'embarked') {
        u.pos = { lat: b.pos.lat, lon: b.pos.lon };
      }
    }
  }
}

function carryTroops(s: SimState, ship: Unit): void {
  for (const id of ship.naval!.troops) {
    const troop = s.units[id];
    if (troop && troop.status === 'embarked') troop.pos = { lat: ship.pos.lat, lon: ship.pos.lon };
  }
}

/* ------------------------------------------------------------------ Groupes et escortes */

function keepStation(s: SimState, ships: Unit[]): void {
  const rank = new Map<string, number>();
  for (const f of ships) {
    const n = f.naval!;
    if (!n.leaderId) continue;
    const leader = s.units[n.leaderId];
    if (!leader || leader.status !== 'active') {
      // Chef de file perdu : l'escorte reprend sa liberté.
      n.leaderId = null;
      continue;
    }
    const i = rank.get(leader.id) ?? 0;
    rank.set(leader.id, i + 1);
    const ring = 1 + Math.floor(i / STATION_BEARINGS.length);
    const station = destination(leader.pos, leader.headingDeg + STATION_BEARINGS[i % STATION_BEARINGS.length]!, s.rules.formationKm * ring);
    if (distanceKm(f.pos, station) > STATION_SLACK_KM) {
      f.route = [station];
      f.routeLoop = false;
      f.wpIndex = 0;
      f.task = 'move';
    }
  }
}

/* ------------------------------------------------------------------ Déroutement des appareils */

function divert(s: SimState): void {
  for (const u of Object.values(s.units)) {
    if (u.status !== 'airborne' || !u.baseId) continue;
    const base = s.bases[u.baseId];
    if (!base || !base.closed) continue;
    const capable = perfOf(s, u).carrierCapable;
    let best: string | null = null;
    let bestD = Infinity;
    for (const b of Object.values(s.bases)) {
      if (b.side !== u.side || b.closed || b.id === base.id) continue;
      if (b.hostUnitId !== null && (!capable || perfOf(s, s.units[b.hostUnitId]!).deck <= 0)) continue;
      // Une base n'accueille des appareils que si elle en met en œuvre : un simple dépôt n'est pas un terrain.
      if (b.hostUnitId === null && b.fuelStockKg <= 0) continue;
      const d = distanceKm(u.pos, b.pos);
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    if (!best) continue;
    u.baseId = best;
    emit(s, 'UNIT_DIVERTED', [u.side], { unit: u.name, base: s.bases[best]!.name });
  }
}

/* ------------------------------------------------------------------ Débarquement */

function progressLanding(s: SimState, ship: Unit): void {
  const n = ship.naval!;
  const landing = n.landing;
  if (!landing) return;
  if (ship.damaged || distanceKm(ship.pos, landing.beach) > s.rules.landingRangeKm) {
    n.landing = null;
    return;
  }
  if (s.time < landing.doneAt) return;
  const troop = s.units[landing.unitId];
  n.landing = null;
  if (!troop || troop.status !== 'embarked' || !troop.land) return;
  n.troops = n.troops.filter((id) => id !== troop.id);
  troop.status = 'active';
  troop.pos = { lat: landing.beach.lat, lon: landing.beach.lon };
  troop.task = 'hold';
  troop.route = [];
  troop.land.posture = 'hold';
  troop.land.cohesion = Math.min(troop.land.cohesion, s.rules.landedCohesion);
  emit(s, 'TROOPS_LANDED', [troop.side], { unit: troop.name, ship: ship.name });
}

/* ------------------------------------------------------------------ Écoute sous-marine */

/** Bruit rayonné par une cible : rapide, elle s'entend de loin ; immobile, à peine ; un tir récent la trahit. */
function noiseFactor(s: SimState, target: Unit): number {
  const r = s.rules;
  const speed = target.speedKmh > r.subFastKmh ? r.subFastFactor : target.speedKmh < 1 ? r.subQuietFactor : 1;
  return speed * (target.naval!.datumUntil > s.time ? r.datumFactor : 1);
}

/** Un bâtiment de surface n'écoute que les sous-marins ; un sous-marin écoute tout ce qui navigue. */
function canHear(s: SimState, listener: Unit, target: Unit): boolean {
  const p = perfOf(s, listener);
  if (p.sonarKm <= 0) return false;
  if (listener.kind !== 'sub' && (listener.damaged || target.kind !== 'sub')) return false;
  return distanceKm(listener.pos, target.pos) <= p.sonarKm * noiseFactor(s, target);
}

function sonarSweep(s: SimState, ships: Unit[]): void {
  for (const target of ships) {
    const listeners = ships.filter((l) => l.side !== target.side && canHear(s, l, target));
    if (listeners.length === 0) continue;
    if (rand(s.rng, 'sim') < s.rules.sonarDetectP) observe(s, opponent(target.side), target, true, 'sonar');
  }
}

/* ------------------------------------------------------------------ Tirs */

function inFlightOn(s: SimState, side: SideId, targetId: string, weapon: ShotWeapon): number {
  let n = 0;
  for (const shot of s.shots) if (shot.side === side && shot.targetId === targetId && shot.weapon === weapon) n += 1;
  return n;
}

function launch(s: SimState, u: Unit, c: Contact, weapon: ShotWeapon, rangeKm: number, maxRangeKm: number, speedKmh: number, minFlightS: number): void {
  s.shots.push({
    id: (s.shotSeq += 1),
    side: u.side,
    shooterId: u.id,
    shooterName: u.name,
    targetId: c.unitId,
    contactId: c.id,
    weapon,
    firedAt: s.time,
    impactAt: s.time + Math.max(minFlightS, Math.round((rangeKm / speedKmh) * 3600)),
    launchRangeKm: rangeKm,
    maxRangeKm,
    shooterCrew: u.crew,
    intelStale: false,
    targetAware: true,
    from: { lat: u.pos.lat, lon: u.pos.lon },
  });
  s.stats[u.side].shotsFired += 1;
  emit(s, 'SHOT_FIRED', [u.side], { unit: u.name, contact: c.id, weapon });
  // Qui ouvre le feu se déclare hostile aux yeux de l'adversaire, s'il le tenait déjà.
  for (const k of Object.values(s.contacts[opponent(u.side)])) if (k.unitId === u.id) k.hostileAct = true;
}

/** Piste la plus proche que l'unité a le droit et la possibilité d'engager avec l'arme considérée. */
function pickTarget(s: SimState, u: Unit, rangeKm: number, wanted: (c: Contact) => boolean): { contact: Contact; d: number } | null {
  const roe = s.defaultRoe[u.side];
  let best: { contact: Contact; d: number } | null = null;
  for (const c of Object.values(s.contacts[u.side])) {
    if (c.stale || !wanted(c)) continue;
    const d = distanceKm(u.pos, c.pos);
    if (d > rangeKm || !roeAllows(s, u, roe, c)) continue;
    if (!best || d < best.d) best = { contact: c, d };
  }
  return best;
}

const isShipTrack = (c: Contact): boolean => c.domain === 'surface' && c.identified && c.kind !== null && isSurfaceShip(c.kind);

function fireWeapons(s: SimState, u: Unit, p: PlatformPerf): void {
  const n = u.naval!;
  const r = s.rules;

  if (u.kind === 'sub') {
    if (n.torpedoes <= 0 || s.time - n.lastTorpedoAt < r.torpedoCooldownS) return;
    const pick = pickTarget(s, u, p.torpedoKm, (c) => isShipTrack(c) && inFlightOn(s, u.side, c.unitId, 'torpedo') === 0);
    if (!pick) return;
    const count = Math.min(2, n.torpedoes);
    for (let i = 0; i < count; i++) launch(s, u, pick.contact, 'torpedo', pick.d, p.torpedoKm, r.torpedoSpeedKmh, 30);
    n.torpedoes -= count;
    n.lastTorpedoAt = s.time;
    n.datumUntil = s.time + r.datumS;
    s.stats[u.side].torpedoesFired += count;
    return;
  }

  // Un bâtiment de surface avarié ou neutralisé ne tire plus.
  if (u.damaged || s.time < u.suppressedUntil) return;

  if (n.ssm > 0 && s.time - n.lastSsmAt >= r.ssmCooldownS) {
    const pick = pickTarget(s, u, p.ssmRangeKm * r.fireRangeFraction, (c) => isShipTrack(c) && inFlightOn(s, u.side, c.unitId, 'ssm') === 0);
    if (pick) {
      const count = Math.min(r.ssmSalvo, n.ssm);
      for (let i = 0; i < count; i++) launch(s, u, pick.contact, 'ssm', pick.d, p.ssmRangeKm, r.ssmSpeedKmh, 5);
      n.ssm -= count;
      n.lastSsmAt = s.time;
      s.stats[u.side].ssmFired += count;
    }
  }

  // Lutte anti-sous-marine : frégates et destroyers, sur une piste sonar fraîche.
  if (u.kind === 'ship' && p.sonarKm > 0 && s.time - n.lastAswAt >= r.aswCooldownS) {
    const pick = pickTarget(s, u, r.aswRangeKm, (c) => c.kind === 'sub' && c.identified && inFlightOn(s, u.side, c.unitId, 'asw') === 0);
    if (pick) {
      launch(s, u, pick.contact, 'asw', pick.d, r.aswRangeKm, ASW_DELIVERY_KMH, 30);
      n.lastAswAt = s.time;
    }
  }
}

/** Un bâtiment peut-il opposer une défense antimissile ? Il lui faut des missiles et un radar en veille. */
function canDefend(s: SimState, u: Unit): boolean {
  return u.status === 'active' && u.naval !== null && perfOf(s, u).weapon === 'sam' && u.weapons > 0 && radarEmitting(s, u);
}

/** Défenseur d'un bâtiment visé par un missile : lui-même s'il le peut, sinon l'escorte la plus proche à portée. */
function pointDefender(s: SimState, target: Unit): Unit | null {
  if (canDefend(s, target)) return target;
  let best: Unit | null = null;
  let bestD = s.rules.pointDefenceKm;
  for (const u of Object.values(s.units)) {
    if (u.side !== target.side || u.id === target.id || !canDefend(s, u)) continue;
    const d = distanceKm(u.pos, target.pos);
    if (d <= bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

function resolveShot(s: SimState, shot: Shot): void {
  const target = s.units[shot.targetId];
  const base = shotFacts(shot, target?.name ?? '?');
  if (!target || target.status !== 'active') {
    emit(s, 'SHOT_RESOLVED', [], { ...base, hit: 0, result: 'lost' });
    emit(s, 'SHOT_RESULT', [shot.side], { unit: shot.shooterName, contact: shot.contactId, result: 'lost' });
    return;
  }
  const r = s.rules;
  let pk: number;
  let points = 1;
  if (shot.weapon === 'ssm') {
    pk = r.pkBaseSsm * (serviceDegraded(s, shot.side, 'nav') ? r.navDegradedFactor : 1);
    const defender = pointDefender(s, target);
    if (defender) {
      defender.weapons -= 1;
      pk *= r.shipDefenceFactor;
    }
  } else if (shot.weapon === 'torpedo') {
    pk = r.pkTorpedo;
    points = 2;
  } else {
    pk = r.pkAsw;
  }

  const roll = rand(s.rng, 'sim');
  let result: 'miss' | 'hit' | 'damaged' | 'sunk' = 'miss';
  const tracked = s.contacts[shot.side][shot.contactId];
  if (roll < pk) {
    s.stats[shot.side].hits += 1;
    result = hitShip(s, target, points);
    if (result === 'sunk') s.stats[shot.side].kills += 1;
    if (result === 'damaged' && tracked && !tracked.stale) tracked.damaged = true;
  }
  emit(s, 'SHOT_RESOLVED', [], { ...base, pk: round3(pk), roll: round3(roll), hit: roll < pk ? 1 : 0, result });
  // Le tireur ne connaît le résultat que s'il tient encore la cible (ou si elle a coulé sous ses capteurs).
  const witnessed = result === 'sunk' ? tracked !== undefined : tracked !== undefined && !tracked.stale;
  emit(s, 'SHOT_RESULT', [shot.side], { unit: shot.shooterName, contact: shot.contactId, result: witnessed ? result : 'unobserved' });
}

function resolveShots(s: SimState): void {
  if (!s.shots.some((shot) => isNavalWeapon(shot.weapon) && shot.impactAt <= s.time)) return;
  const pending: Shot[] = [];
  for (const shot of s.shots) {
    if (!isNavalWeapon(shot.weapon) || shot.impactAt > s.time) pending.push(shot);
    else resolveShot(s, shot);
  }
  s.shots = pending;
}

/* ------------------------------------------------------------------ Recomplètement à la mer */

function replenish(s: SimState, ships: Unit[]): void {
  for (const tender of ships) {
    if (tender.kind !== 'supply' || tender.damaged) continue;
    const depot = Object.values(s.bases).find((b) => b.hostUnitId === tender.id && !b.closed);
    if (!depot) continue;
    for (const u of ships) {
      if (u.side !== tender.side || u.id === tender.id || distanceKm(u.pos, tender.pos) > s.rules.replenishKm) continue;
      const p = perfOf(s, u);
      const n = u.naval!;
      // Une munition par bâtiment et par intervalle : d'abord la défense, puis l'attaque.
      if (p.weapon === 'sam' && u.weapons < p.weaponCount && depot.supplyStock >= REPLENISH_COST.sam) {
        u.weapons += 1;
        depot.supplyStock -= REPLENISH_COST.sam;
      } else if (n.ssm < p.ssmCount && depot.supplyStock >= REPLENISH_COST.ssm) {
        n.ssm += 1;
        depot.supplyStock -= REPLENISH_COST.ssm;
      } else if (n.torpedoes < p.torpedoCount && depot.supplyStock >= REPLENISH_COST.torpedo) {
        n.torpedoes += 1;
        depot.supplyStock -= REPLENISH_COST.torpedo;
      }
    }
  }
}

/* ------------------------------------------------------------------ Système */

/** Système des opérations navales. Sans bâtiment, il ne fait rien ; il ne tire un nombre aléatoire que pour un sonar à portée ou un impact. */
export const navalSystem: System = (s) => {
  const ships = Object.values(s.units).filter((u) => u.naval !== null && u.status === 'active');
  resolveShots(s);
  carry(s);
  divert(s);
  if (ships.length === 0) return;
  for (const ship of ships) {
    if (ship.status !== 'active') continue;
    carryTroops(s, ship);
    progressLanding(s, ship);
  }
  keepStation(s, ships);
  if (s.time % s.rules.sensorIntervalS === 0) sonarSweep(s, ships);
  for (const ship of ships) if (ship.status === 'active') fireWeapons(s, ship, perfOf(s, ship));
  if (s.time % s.rules.replenishIntervalS === 0) replenish(s, ships);
};
