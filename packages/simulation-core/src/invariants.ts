/**
 * Contrôles de cohérence du moteur (prompt maître §17).
 * Appelés par les tests à chaque pas : toute violation est un bogue du moteur.
 */
import { distanceKm, type LatLon } from './geo';
import type { SimState } from './types';

export type PositionSnapshot = Record<string, { pos: LatLon; status: string }>;

export function snapshotPositions(state: SimState): PositionSnapshot {
  const snap: PositionSnapshot = {};
  for (const u of Object.values(state.units)) snap[u.id] = { pos: { lat: u.pos.lat, lon: u.pos.lon }, status: u.status };
  return snap;
}

/** Retourne la liste des violations constatées (vide si l'état est cohérent). */
export function checkInvariants(state: SimState, previous: PositionSnapshot | null): string[] {
  const errors: string[] = [];
  const dt = state.rules.dtS;

  for (const u of Object.values(state.units)) {
    const p = state.platforms[u.platformId];
    if (!p) {
      errors.push(`${u.id} : plate-forme inconnue ${u.platformId}`);
      continue;
    }
    if (!(u.fuelKg >= 0)) errors.push(`${u.id} : carburant négatif (${u.fuelKg})`);
    if (u.fuelKg > p.fuelCapacityKg + 1e-6) errors.push(`${u.id} : carburant au-delà de la capacité`);
    if (!(u.weapons >= 0) || !Number.isInteger(u.weapons)) errors.push(`${u.id} : munitions invalides (${u.weapons})`);
    if (u.weapons > p.weaponCount) errors.push(`${u.id} : munitions au-delà de l'emport`);
    if (!(u.transferKg >= 0)) errors.push(`${u.id} : carburant transférable négatif`);
    if (!(Math.abs(u.pos.lat) <= 90) || !(Math.abs(u.pos.lon) <= 180)) errors.push(`${u.id} : position invalide`);
    if (u.status === 'airborne' && u.domain !== 'air') errors.push(`${u.id} : unité non aérienne en vol`);
    if (u.status === 'airborne' && u.altM > p.ceilingM + 1e-6) errors.push(`${u.id} : au-dessus du plafond`);
    if (u.missionId) {
      const m = state.missions[u.missionId];
      if (!m) errors.push(`${u.id} : mission inconnue ${u.missionId}`);
      else if (m.side !== u.side) errors.push(`${u.id} : mission d'un autre camp`);
      if (u.status === 'destroyed' || u.status === 'maintenance') errors.push(`${u.id} : mission attribuée à un appareil indisponible`);
    }

    const prev = previous?.[u.id];
    if (prev) {
      const moved = distanceKm(prev.pos, u.pos);
      const maxStep = (Math.max(p.dashKmh, p.cruiseKmh) * dt) / 3600;
      if (moved > maxStep * 1.001 + 1e-6) {
        errors.push(`${u.id} : téléportation (${moved.toFixed(3)} km en ${dt} s, maximum ${maxStep.toFixed(3)} km)`);
      }
      if ((prev.status === 'destroyed' || prev.status === 'maintenance') && moved > 1e-9) {
        errors.push(`${u.id} : unité hors service en mouvement`);
      }
      if (prev.status === 'destroyed' && u.status !== 'destroyed') errors.push(`${u.id} : unité détruite revenue en service`);
    }
  }

  for (const b of Object.values(state.bases)) {
    if (b.weaponStock < 0) errors.push(`${b.id} : stock de munitions négatif`);
    if (b.fuelStockKg < 0) errors.push(`${b.id} : stock de carburant négatif`);
  }

  for (const s of state.shots) {
    if (!state.units[s.shooterId] || !state.units[s.targetId]) errors.push(`tir ${s.id} : unité inconnue`);
    if (s.impactAt < s.firedAt) errors.push(`tir ${s.id} : impact avant le tir`);
  }

  const o = state.objective;
  const total = o.sec.BLUE + o.sec.RED + o.sec.CONTESTED;
  if (Math.abs(total - state.time) > 1e-6) errors.push(`objectif : le décompte de contrôle (${total}) ne correspond pas au temps écoulé (${state.time})`);

  return errors;
}
