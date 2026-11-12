/**
 * Générateur pseudo-aléatoire déterministe (Mulberry32).
 *
 * L'état de chaque flux est un entier 32 bits stocké dans `SimState.rng` : il est donc
 * sauvegardé, rechargé et rejoué avec la partie. Aucun `Math.random` dans la simulation.
 */
export type RngStreams = Record<string, number>;

/** Dérive une graine de flux à partir de la graine du scénario et d'un nom de flux. */
export function hashSeed(seed: number, stream: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < stream.length; i++) {
    h = Math.imul(h ^ stream.charCodeAt(i), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function createStreams(seed: number, names: readonly string[]): RngStreams {
  const streams: RngStreams = {};
  for (const name of names) streams[name] = hashSeed(seed, name);
  return streams;
}

/** Tire un réel dans [0, 1) et fait avancer le flux. */
export function rand(streams: RngStreams, stream: string): number {
  const current = streams[stream];
  if (current === undefined) throw new Error(`Flux aléatoire inconnu : ${stream}`);
  const s = (current + 0x6d2b79f5) >>> 0;
  streams[stream] = s;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
