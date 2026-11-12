/**
 * Objectifs, conditions de victoire et moteur de déclencheurs « sans code ».
 */
import {
  controlStatusOf,
  distanceKm,
  emit,
  inCircle,
  isCombatReadyFighter,
  opponent,
  SIDES,
  type ControlStatus,
  type Outcome,
  type SideId,
  type SimState,
  type System,
  type Trigger,
} from '@warcommand/simulation-core';

export function setOutcome(s: SimState, winner: SideId | 'DRAW', reason: Outcome['reason']): void {
  if (s.outcome) return;
  const level: Outcome['level'] = winner === 'DRAW' ? 'draw' : s.stats[winner].losses.fighter <= 1 ? 'major' : 'minor';
  s.outcome = { winner, level, reason, endedAt: s.time };
  emit(s, 'MISSION_END', SIDES, { winner, level, reason });
}

/**
 * Contrôle du secteur. La vérité-terrain alimente le décompte officiel (révélé au compte rendu) ;
 * chaque camp tient en parallèle son propre décompte, fondé sur ses seules pistes.
 */
export const objectiveSystem: System = (s) => {
  const o = s.objective;
  const dt = s.rules.dtS;
  const present: Record<SideId, boolean> = { BLUE: false, RED: false };
  for (const u of Object.values(s.units)) {
    if (isCombatReadyFighter(u) && distanceKm(u.pos, o.center) <= o.radiusKm) present[u.side] = true;
  }

  const status: ControlStatus = controlStatusOf(present.BLUE, present.RED, 'BLUE', o.controller);
  if (status !== 'CONTESTED') o.controller = status;
  if (status !== o.status) {
    o.status = status;
    // La seconde qui vient de s'écouler est déjà comptée au nouveau statut : le segment commence à t - dt.
    o.timeline.push({ t: s.time - dt, status });
    emit(s, 'CONTROL_CHANGED', [], { status });
  }
  o.sec[status] += dt;

  for (const side of SIDES) {
    let enemySeen = false;
    for (const c of Object.values(s.contacts[side])) {
      if (c.stale || c.domain !== 'air' || c.damaged) continue;
      if (c.identified && c.kind !== 'fighter') continue;
      if (distanceKm(c.pos, o.center) <= o.radiusKm) {
        enemySeen = true;
        break;
      }
    }
    const p = o.perceived[side];
    const perceived = controlStatusOf(present[side], enemySeen, side, p.controller);
    if (perceived !== 'CONTESTED') p.controller = perceived;
    if (perceived !== p.status) {
      p.status = perceived;
      emit(s, 'PERCEIVED_CONTROL', [side], { status: perceived });
    }
    p.sec[perceived] += dt;
  }

  if (s.time >= s.endTime) {
    const held = o.sec[o.defender];
    const winner = held >= o.defenderWinsAtSec ? o.defender : held < o.challengerWinsBelowSec ? opponent(o.defender) : 'DRAW';
    setOutcome(s, winner, 'time');
  }
};

function conditionMet(s: SimState, t: Trigger): boolean {
  const c = t.condition;
  switch (c.type) {
    case 'TIME_ELAPSED':
      return s.time >= c.atSec;
    case 'LOSSES_AT_LEAST':
      return s.stats[c.side].losses[c.kind] >= c.count;
    case 'UNIT_IN_ZONE':
      return Object.values(s.units).some(
        (u) => u.side === c.side && u.kind === c.kind && (u.status === 'airborne' || u.status === 'active') && inCircle(u.pos, c.zone),
      );
    case 'GROUP_UNAVAILABLE': {
      const members = Object.values(s.units).filter((u) => u.groupId === c.groupId);
      return members.length > 0 && members.every((u) => u.status === 'destroyed' || u.status === 'maintenance');
    }
    case 'CONTROL_IS':
      return s.objective.status === c.status;
  }
}

export const triggerSystem: System = (s) => {
  for (const t of s.triggers) {
    if (t.fired || !conditionMet(s, t)) continue;
    t.fired = true;
    for (const a of t.actions) {
      if (a.type === 'MESSAGE') {
        emit(s, 'TRIGGER_MESSAGE', a.vis, { text: a.text });
      } else {
        const attrition = t.condition.type === 'GROUP_UNAVAILABLE' || t.condition.type === 'LOSSES_AT_LEAST';
        setOutcome(s, a.winner, attrition ? 'attrition' : 'trigger');
      }
    }
    if (s.outcome) return;
  }
};
