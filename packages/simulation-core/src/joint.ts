/**
 * Aides communes aux domaines de la phase 5 : ce que valent, à un instant donné, les services dont
 * dépend le commandement d'un camp. Fonctions pures de l'état, sans règle de combat.
 */
import type { ServiceId, SideId, SimState } from './types';

export function serviceLevel(s: SimState, side: SideId, service: ServiceId): number {
  return s.services[side].level[service];
}

/** Un service est dit dégradé sous le seuil `degradedBelow` : ses effets de seuil s'appliquent. */
export function serviceDegraded(s: SimState, side: SideId, service: ServiceId): boolean {
  return serviceLevel(s, side, service) < s.rules.degradedBelow;
}

/**
 * Allongement des délais de commandement d'un camp quand ses réseaux sont perturbés :
 * 1 en nominal, 2 à mi-capacité, 3 réseaux coupés.
 */
export function c2DelayFactor(s: SimState, side: SideId): number {
  return 1 + 2 * (1 - serviceLevel(s, side, 'network'));
}
