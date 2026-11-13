/**
 * IA interarmées (niveau opératif) : manœuvre des formations terrestres, appui aérien rapproché,
 * effets cyber et spatiaux, opérations spéciales, débarquement, chasse sous-marine.
 *
 * Comme le reste de l'IA, elle ne reçoit que l'image de son camp et n'agit que par des ordres soumis
 * à la validation commune. La géographie (trait de côte, terrain) est une donnée publique : s'en
 * servir pour tracer un itinéraire n'est pas un privilège.
 *
 * Règles simples et explicites, consignées au journal des décisions :
 *  - challenger : les formations de mêlée attaquent l'objectif ; artillerie, logistique et poste de
 *    commandement suivent à distance ; la reconnaissance précède ;
 *  - défenseur : les formations tiennent l'objectif en défense ; la réserve y est appelée et
 *    contre-attaque ce qui y pénètre ; artillerie et logistique s'installent en arrière ;
 *  - appui aérien : une paire de chasseurs tenue en alerte, lancée dès que des troupes sont au contact d'un
 *    adversaire repéré ;
 *  - effets et forces spéciales : employés une fois, sauf au niveau « recrue ».
 */
import {
  angleDiffDeg,
  bearingDeg,
  centroid,
  destination,
  distanceKm,
  firstLandToward,
  inBounds,
  inCircle,
  isGroundForce,
  isLand,
  isManeuver,
  isSurfaceShip,
  pathAtSea,
  pathOnLand,
  type AiDecision,
  type AiMemory,
  type ContactView,
  type LandPosture,
  type LatLon,
  type SidePicture,
  type Unit,
} from '@warcommand/simulation-core';
import { missionWithinRange, type Order } from '@warcommand/air-operations';
import type { LandOrder } from '@warcommand/land-operations';
import type { NavalOrder } from '@warcommand/naval-operations';
import type { EffectOrder } from '@warcommand/multi-domain-effects';

type JointOrder = Order | LandOrder | NavalOrder | EffectOrder;

export interface JointPlan {
  orders: JointOrder[];
  /** Chasseurs retenus pour l'appui : l'IA aérienne ne doit pas les affecter ailleurs pendant ce cycle. */
  reserved: string[];
}

/** Intervalle entre deux réévaluations interarmées, selon la difficulté. */
const JOINT_INTERVAL_S = { recrue: 240, standard: 120, veteran: 60 } as const;
const CAS_ALTITUDE_M = 6000;
const CAS_RETRY_S = 600;
const CAS_PAIR = 2;
/** Une piste terrestre plus ancienne que cela n'oriente plus la manœuvre. */
const GROUND_TRACK_MAX_AGE_S = 1800;
/**
 * L'équipe spéciale est engagée dès que l'adversaire terrestre est localisé (après un délai minimal),
 * ou d'office au bout de vingt minutes ; elle est rappelée à quarante minutes de la fin.
 */
const SOF_NOT_BEFORE_S = 300;
const SOF_BLIND_AFTER_S = 1200;
const SOF_RECALL_BEFORE_END_S = 2400;
const NAVAL_RETRY_S = 300;
/** Distances, depuis le centre de l'objectif, des appuis et soutiens d'un attaquant. */
const ATTACK_ARTILLERY_KM = 20;
const ATTACK_LOGISTICS_KM = 26;
const ATTACK_HQ_KM = 34;
/** Distances, en arrière de l'objectif, des appuis et soutiens d'un défenseur. */
const DEFENCE_ARTILLERY_KM = 8;
const DEFENCE_LOGISTICS_KM = 13;
/** Rayon, autour du centre, sur lequel le défenseur dispose ses formations. */
const DEFENCE_RING_KM = 2.5;
const DEFENCE_BEARINGS = [0, 55, -55, 110, -110, 165];
/** Une unité à moins de cette distance de sa destination est considérée comme rendue. */
const ARRIVED_KM = 1.5;
/** L'axe retenu n'est révisé que si l'estimation s'en écarte de plus de cet angle : sinon tout le dispositif tournerait sans cesse. */
const AXIS_REVISION_DEG = 40;
/** La reconnaissance du défenseur se replie quand l'adversaire est à moins de 9 km, et ne retourne à son poste qu'au-delà de 15 km. */
const RECON_PRESSED_KM = 9;
const RECON_CLEAR_KM = 15;

interface Ctx {
  pic: SidePicture;
  mem: AiMemory;
  record: (entry: AiDecision) => void;
  orders: JointOrder[];
  formations: Unit[];
  tracks: ContactView[];
}

const routeEnd = (u: Unit): LatLon | null => u.route[u.route.length - 1] ?? null;
const isMovingNow = (u: Unit): boolean => u.route.length > 0 && (u.land!.posture === 'move' || u.land!.posture === 'attack' || u.land!.posture === 'withdraw');

/** Itinéraire terrestre : direct si possible, sinon par un point de contournement ; `null` si aucun n'est trouvé. */
function landRoute(from: LatLon, to: LatLon): LatLon[] | null {
  if (pathOnLand(from, to)) return [to];
  const mid = destination(from, bearingDeg(from, to), distanceKm(from, to) / 2);
  const axis = bearingDeg(from, to);
  for (const offset of [15, -15, 30, -30, 50, -50]) {
    const via = destination(mid, axis + 90, offset);
    if (isLand(via) && pathOnLand(from, via) && pathOnLand(via, to)) return [via, to];
  }
  return null;
}

/** L'unité exécute-t-elle déjà cet ordre (même posture, même destination à deux kilomètres près) ? */
function alreadyDoing(u: Unit, posture: LandPosture, dest: LatLon | null): boolean {
  const l = u.land!;
  if (l.posture !== posture) return false;
  if (!dest) return true;
  const end = routeEnd(u);
  return end !== null ? distanceKm(end, dest) < 2 : distanceKm(u.pos, dest) < 2;
}

function landOrder(c: Ctx, u: Unit, posture: LandPosture, dest: LatLon | null): boolean {
  const l = u.land!;
  if (l.pending || alreadyDoing(u, posture, dest)) return false;
  // Déjà sur place : un déplacement ou un repli vers ce point n'a plus d'objet.
  if (dest && posture !== 'attack' && !isMovingNow(u) && distanceKm(u.pos, dest) < ARRIVED_KM) return false;
  const route = dest ? landRoute(u.pos, dest) : [];
  if (route === null || (dest && !inBounds(dest, c.pic.theater))) return false;
  c.orders.push({ type: 'LAND_ORDER', side: c.pic.side, unitId: u.id, posture, route });
  return true;
}

/**
 * Cap, depuis l'objectif, vers l'adversaire terrestre : ses formations repérées ; à défaut ses sites au
 * sol connus (un site sol-air au dossier de renseignement) ; à défaut sa base fixe la plus proche.
 */
function threatBearing(c: Ctx): number {
  const center = c.pic.objective.center;
  if (c.tracks.length > 0) return bearingDeg(center, centroid(c.tracks.map((t) => t.pos)));
  const sites = c.pic.contacts.filter((t) => t.domain === 'ground' && t.identified);
  if (sites.length > 0) return bearingDeg(center, centroid(sites.map((t) => t.pos)));
  let best: LatLon | null = null;
  let bestD = Infinity;
  for (const b of c.pic.enemyBases) {
    const d = distanceKm(center, b.pos);
    if (d < bestD) {
      bestD = d;
      best = b.pos;
    }
  }
  if (best) return bearingDeg(center, best);
  const own = c.formations.filter((u) => isManeuver(u.kind));
  return own.length > 0 ? bearingDeg(center, centroid(own.map((u) => u.pos))) + 180 : 90;
}

/** Axe mémorisé sous la clé `key` : fixé à la première estimation, révisé seulement si elle change franchement. */
function stableAxis(c: Ctx, key: string, estimate: number): number {
  const kept = c.mem.notes[key];
  const normal = ((estimate % 360) + 360) % 360;
  if (kept === undefined || angleDiffDeg(kept, normal) > AXIS_REVISION_DEG) c.mem.notes[key] = normal;
  return c.mem.notes[key]!;
}

/* ------------------------------------------------------------------ Manœuvre terrestre */

function planAttack(c: Ctx): void {
  const o = c.pic.objective;
  const maneuver = c.formations.filter((u) => isManeuver(u.kind) && u.kind !== 'recon' && !u.land!.broken);
  const body = maneuver.length > 0 ? maneuver : c.formations;
  // Axe d'approche : du centre de l'objectif vers le gros de nos forces, fixé au départ.
  const approach = stableAxis(c, 'approachDeg', bearingDeg(o.center, centroid(body.map((u) => u.pos))));
  const behind = (km: number) => destination(o.center, approach, km);
  let launched = 0;

  for (const u of c.formations) {
    const l = u.land!;
    if (l.inContact || l.broken) continue;
    const d = distanceKm(u.pos, o.center);
    if (isManeuver(u.kind) && u.kind !== 'recon') {
      // Dans la zone et sans adversaire au contact : on s'y installe. Sinon : à l'attaque.
      if (d <= o.radiusKm * 0.5 && !isMovingNow(u)) landOrder(c, u, 'defend', null);
      else if (landOrder(c, u, 'attack', o.center)) launched += 1;
    } else if (u.kind === 'recon') {
      landOrder(c, u, 'move', behind(o.radiusKm + 8));
    } else if (u.kind === 'artillery') {
      if (distanceKm(u.pos, behind(ATTACK_ARTILLERY_KM)) > 6) landOrder(c, u, 'move', behind(ATTACK_ARTILLERY_KM));
      else landOrder(c, u, 'defend', null);
    } else if (u.kind === 'logistics') {
      const point = l.supplyPoint ?? u.pos;
      if (distanceKm(point, behind(ATTACK_LOGISTICS_KM)) > 8) landOrder(c, u, 'move', behind(ATTACK_LOGISTICS_KM));
    } else if (u.kind === 'hq') {
      if (distanceKm(u.pos, behind(ATTACK_HQ_KM)) > 12) landOrder(c, u, 'move', behind(ATTACK_HQ_KM));
    }
  }
  if (launched > 0 && !c.mem.notes.groundAttack) {
    c.mem.notes.groundAttack = c.pic.time;
    c.record({ t: c.pic.time, level: 'operative', code: 'GROUND_ATTACK', p: { n: launched, objective: o.name }, utilities: {} });
  }
}


function planDefence(c: Ctx): void {
  const o = c.pic.objective;
  const threat = stableAxis(c, 'threatDeg', threatBearing(c));
  const rear = (km: number) => destination(o.center, threat + 180, km);
  const intruders = c.tracks.filter((t) => !t.stale && t.kind !== null && isManeuver(t.kind) && distanceKm(t.pos, o.center) <= o.radiusKm);
  const holders = c.formations.filter((u) => isManeuver(u.kind) && u.kind !== 'recon' && !u.land!.broken).sort((a, b) => a.id.localeCompare(b.id));
  let ordered = 0;

  holders.forEach((u, i) => {
    const l = u.land!;
    if (l.inContact) return;
    const d = distanceKm(u.pos, o.center);
    const slot = destination(o.center, threat + DEFENCE_BEARINGS[i % DEFENCE_BEARINGS.length]!, DEFENCE_RING_KM);
    if (d <= o.radiusKm * 0.5) {
      // Dans la zone. Une unité déjà retranchée y reste ; une unité fraîche contre-attaque ce qui a pénétré.
      const fresh = l.dugIn < 0.2 && l.strength >= 0.5 && l.cohesion >= 0.5;
      const intruder = intruders[0];
      if (intruder && fresh && c.pic.doctrine.agressivite >= 0.3 && !isMovingNow(u)) {
        if (landOrder(c, u, 'attack', intruder.pos)) ordered += 1;
      } else if (!isMovingNow(u) && landOrder(c, u, 'defend', null)) ordered += 1;
    } else if (landOrder(c, u, intruders.length > 0 ? 'attack' : 'move', intruders.length > 0 ? o.center : slot)) {
      ordered += 1;
    }
  });

  for (const u of c.formations) {
    const l = u.land!;
    if (l.inContact || l.broken) continue;
    if (u.kind === 'recon') {
      // Poste d'observation en avant ; si l'adversaire approche, la reconnaissance se replie dans la zone.
      const nearest = Math.min(Infinity, ...c.tracks.filter((t) => t.kind !== null && isManeuver(t.kind)).map((t) => distanceKm(t.pos, u.pos)));
      const post = destination(o.center, threat, o.radiusKm + 6);
      if (nearest <= RECON_PRESSED_KM) landOrder(c, u, 'withdraw', rear(2));
      else if (nearest > RECON_CLEAR_KM && distanceKm(u.pos, post) > 5) landOrder(c, u, 'move', post);
    } else if (u.kind === 'artillery') {
      if (distanceKm(u.pos, rear(DEFENCE_ARTILLERY_KM)) > 6) landOrder(c, u, 'move', rear(DEFENCE_ARTILLERY_KM));
      else if (landOrder(c, u, 'defend', null)) ordered += 1;
    } else if (u.kind === 'logistics') {
      const point = l.supplyPoint ?? u.pos;
      if (distanceKm(point, rear(DEFENCE_LOGISTICS_KM)) > 10) landOrder(c, u, 'move', rear(DEFENCE_LOGISTICS_KM));
    }
  }
  if (ordered > 0 && !c.mem.notes.groundDefence) {
    c.mem.notes.groundDefence = c.pic.time;
    c.record({ t: c.pic.time, level: 'operative', code: 'GROUND_DEFENCE', p: { n: ordered, objective: o.name }, utilities: {} });
  }
}

/* ------------------------------------------------------------------ Appui aérien rapproché */

/** Une mission d'appui est-elle déjà ordonnée ou en cours ? */
const casRunning = (pic: SidePicture): boolean => pic.missions.some((m) => m.type === 'CAS' && (m.status === 'planned' || m.status === 'active'));

/** Chasseurs libres aptes à l'appui (emport air-surface, base ouverte et approvisionnée), les plus proches de `near` d'abord. */
function casCandidates(pic: SidePicture, near: LatLon): Unit[] {
  const ranked: { u: Unit; d: number }[] = [];
  for (const u of pic.units) {
    if (u.kind !== 'fighter' || u.status !== 'ready' || u.missionId !== null || u.damaged || u.availableAt > pic.time || !u.baseId) continue;
    const perf = pic.platforms[u.platformId];
    const base = pic.bases.find((b) => b.id === u.baseId);
    if (!perf || !base || base.closed || !perf.loadouts.some((l) => l.asm > 0)) continue;
    if (base.asmStock <= 0 && u.asm <= 0) continue;
    ranked.push({ u, d: distanceKm(base.pos, near) });
  }
  return ranked.sort((a, b) => a.d - b.d || a.u.id.localeCompare(b.u.id)).map((x) => x.u);
}

/**
 * Paire tenue en alerte pour l'appui des troupes, tant qu'aucune mission d'appui ne vole : l'IA aérienne
 * ne doit pas l'engager ailleurs. Jamais plus de la moitié des chasseurs en état de voler.
 */
function casReserve(pic: SidePicture): string[] {
  if (casRunning(pic)) return [];
  const fit = pic.units.filter((u) => u.kind === 'fighter' && u.status !== 'destroyed' && u.status !== 'maintenance' && !u.damaged).length;
  const quota = Math.min(CAS_PAIR, Math.floor(fit / 2));
  return casCandidates(pic, pic.objective.center)
    .slice(0, quota)
    .map((u) => u.id);
}

function planCas(c: Ctx, reserve: string[]): string[] {
  const { pic, mem } = c;
  const engaged = c.formations.filter((u) => u.land!.inContact);
  const targets = c.tracks.filter((t) => !t.stale);
  if (engaged.length === 0 || targets.length === 0 || casRunning(pic)) return [];
  if (pic.time < (mem.notes.casRetryAt ?? 0)) return [];

  // Zone d'appui : la piste adverse la plus proche d'une formation amie au contact.
  let station: LatLon | null = null;
  let best = Infinity;
  for (const t of targets) {
    for (const f of engaged) {
      const d = distanceKm(t.pos, f.pos);
      if (d < best) {
        best = d;
        station = t.pos;
      }
    }
  }
  if (!station) return [];

  // La paire en alerte d'abord ; à défaut, les chasseurs aptes les plus proches de la zone. Tous doivent pouvoir aller et revenir.
  const zone = station;
  const inRange = (u: Unit): boolean => {
    const perf = pic.platforms[u.platformId]!;
    const base = pic.bases.find((b) => b.id === u.baseId)!;
    return missionWithinRange({ perf, rules: pic.rules, fuelKg: perf.fuelCapacityKg, origin: base.pos, target: zone, home: base.pos, altM: Math.min(CAS_ALTITUDE_M, perf.ceilingM), tankers: null });
  };
  const candidates = casCandidates(pic, zone).filter(inRange);
  const alert = candidates.filter((u) => reserve.includes(u.id));
  const chosen = (alert.length > 0 ? alert : candidates).slice(0, CAS_PAIR);
  if (chosen.length === 0) return [];

  const unitIds = chosen.map((u) => u.id);
  c.orders.push({
    type: 'CREATE_MISSION',
    side: pic.side,
    draft: {
      type: 'CAS',
      unitIds,
      waypoints: [{ lat: zone.lat, lon: zone.lon }],
      altM: CAS_ALTITUDE_M,
      speed: 'cruise',
      launchAt: pic.time,
      endAt: null,
      roe: 'defensive',
      allowRefuel: false,
      targetContactId: null,
    },
  });
  mem.notes.casRetryAt = pic.time + CAS_RETRY_S;
  c.record({ t: pic.time, level: 'operative', code: 'CAS', p: { n: unitIds.length, troops: engaged.length }, utilities: {} });
  return unitIds;
}

/* ------------------------------------------------------------------ Effets, forces spéciales */

function planEffects(c: Ctx): void {
  const { pic } = c;
  if (c.mem.difficulty === 'recrue' || !c.formations.some((u) => u.land!.inContact)) return;
  for (const effect of ['cyber', 'jam'] as const) {
    if (pic.effects[effect] <= 0) continue;
    c.orders.push({ type: 'USE_EFFECT', side: pic.side, effect });
    c.record({ t: pic.time, level: 'operative', code: 'EFFECT', p: { effect }, utilities: {} });
  }
}

function planSof(c: Ctx): void {
  const { pic, mem } = c;
  if (mem.difficulty === 'recrue') return;
  const o = pic.objective;
  for (const team of pic.units) {
    if (!team.sof || team.status === 'destroyed') continue;
    if (team.sof.phase === 'observing' && pic.time >= pic.endTime - SOF_RECALL_BEFORE_END_S) {
      c.orders.push({ type: 'SOF_EXTRACT', side: pic.side, unitId: team.id });
      c.record({ t: pic.time, level: 'operative', code: 'SOF_EXTRACT', p: { unit: team.name }, utilities: {} });
      continue;
    }
    if (team.sof.phase !== 'ready' || team.status !== 'ready' || team.availableAt > pic.time) continue;
    if (mem.notes.sofSent || pic.time < SOF_NOT_BEFORE_S || pic.time >= pic.endTime - 2 * SOF_RECALL_BEFORE_END_S) continue;
    if (c.tracks.length === 0 && pic.time < SOF_BLIND_AFTER_S) continue;
    // Le défenseur surveille l'axe d'approche adverse ; l'attaquant, les arrières de la défense.
    const bearing = threatBearing(c);
    const candidates =
      mem.role === 'defender'
        ? [destination(destination(o.center, bearing, 30), bearing + 90, 6), destination(o.center, bearing, 24), destination(o.center, bearing, 36)]
        : [destination(destination(o.center, bearing, 10), bearing + 90, 5), destination(o.center, bearing, 14), destination(o.center, bearing + 180, 20)];
    const target = candidates.find((p) => inBounds(p, pic.theater) && isLand(p) && distanceKm(team.pos, p) <= pic.rules.sofRangeKm);
    if (!target) continue;
    c.orders.push({ type: 'SOF_INSERT', side: pic.side, unitId: team.id, target });
    mem.notes.sofSent = pic.time;
    c.record({ t: pic.time, level: 'operative', code: 'SOF_INSERT', p: { unit: team.name }, utilities: {} });
  }
}

/* ------------------------------------------------------------------ Mer */

function planNaval(c: Ctx): void {
  const { pic, mem } = c;
  const zone = pic.navalZone;
  const canSail = (from: LatLon, dest: LatLon) => zone !== null && inCircle(dest, zone) && !isLand(dest) && pathAtSea(from, dest);

  for (const ship of pic.units) {
    if (!ship.naval || ship.status !== 'active') continue;
    const perf = pic.platforms[ship.platformId];
    if (!perf) continue;

    // Débarquement : approcher d'une plage en direction de l'objectif, puis mettre les troupes à terre.
    if (perf.lift > 0 && ship.naval.troops.length > 0 && !ship.naval.landing && !ship.damaged) {
      const shore = firstLandToward(ship.pos, pic.objective.center);
      if (!shore) continue;
      const inland = destination(shore, bearingDeg(shore, pic.objective.center), 1.5);
      const beach = isLand(inland) ? inland : shore;
      if (distanceKm(ship.pos, beach) <= pic.rules.landingRangeKm - 0.5) {
        c.orders.push({ type: 'LAND_TROOPS', side: pic.side, shipId: ship.id, unitId: ship.naval.troops[0]!, beach });
        c.record({ t: pic.time, level: 'operative', code: 'LANDING', p: { ship: ship.name }, utilities: {} });
      } else if (ship.route.length === 0 && pic.time >= (mem.notes[`sail:${ship.id}`] ?? 0)) {
        const point = destination(shore, bearingDeg(shore, ship.pos), 4);
        if (canSail(ship.pos, point)) c.orders.push({ type: 'MOVE_SHIP', side: pic.side, unitId: ship.id, dest: point });
        mem.notes[`sail:${ship.id}`] = pic.time + NAVAL_RETRY_S;
      }
      continue;
    }

    // Chasse sous-marine (niveau vétéran) : aller au-devant du bâtiment adverse repéré le plus proche.
    if (ship.kind === 'sub' && mem.difficulty === 'veteran' && ship.naval.torpedoes > 0 && pic.time >= (mem.notes[`sail:${ship.id}`] ?? 0)) {
      let prey: ContactView | null = null;
      let best = Infinity;
      for (const t of pic.contacts) {
        if (t.domain !== 'surface' || !t.identified || t.kind === null || !isSurfaceShip(t.kind) || t.ageS > 900) continue;
        const d = distanceKm(ship.pos, t.pos);
        if (d < best) {
          best = d;
          prey = t;
        }
      }
      if (!prey || best <= perf.torpedoKm * 0.8) continue;
      const end = routeEnd(ship);
      if (end && distanceKm(end, prey.pos) < 10) continue;
      if (!canSail(ship.pos, prey.pos)) continue;
      c.orders.push({ type: 'MOVE_SHIP', side: pic.side, unitId: ship.id, dest: { lat: prey.pos.lat, lon: prey.pos.lon } });
      mem.notes[`sail:${ship.id}`] = pic.time + NAVAL_RETRY_S;
      c.record({ t: pic.time, level: 'operative', code: 'SUB_HUNT', p: { unit: ship.name, contact: prey.id }, utilities: {} });
    }
  }
}

/* ------------------------------------------------------------------ Cycle */

/** Un cycle de décision interarmées. Ne fait rien si ce n'est pas encore l'heure de réévaluer. */
export function planJoint(pic: SidePicture, mem: AiMemory, record: (entry: AiDecision) => void): JointPlan {
  const formations = pic.units.filter((u) => u.land !== null && u.status === 'active' && isGroundForce(u.kind));
  // L'alerte d'appui vaut à chaque appel, même entre deux réévaluations : sinon l'IA aérienne s'en emparerait.
  const reserve = formations.length > 0 && pic.objective.kind === 'ground' ? casReserve(pic) : [];
  if (pic.time < (mem.notes.jointAt ?? 0)) return { orders: [], reserved: reserve };
  mem.notes.jointAt = pic.time + JOINT_INTERVAL_S[mem.difficulty];

  const tracks = pic.contacts.filter((t) => t.domain === 'ground' && t.identified && t.kind !== null && isGroundForce(t.kind) && t.ageS <= GROUND_TRACK_MAX_AGE_S);
  const c: Ctx = { pic, mem, record, orders: [], formations, tracks };

  if (formations.length > 0 && pic.objective.kind === 'ground') {
    if (mem.role === 'challenger') planAttack(c);
    else planDefence(c);
  }
  const launched = formations.length > 0 ? planCas(c, reserve) : [];
  if (formations.length > 0) planEffects(c);
  planSof(c);
  planNaval(c);
  return { orders: c.orders, reserved: [...new Set([...reserve, ...launched])] };
}
