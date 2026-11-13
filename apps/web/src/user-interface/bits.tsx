'use client';

/** Petits composants de mise en forme partagés par les fiches. */
import type { ReactNode } from 'react';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Jauge. `low` : seuil sous lequel elle passe en alerte ; `inverse` : une valeur haute est mauvaise (fatigue). */
export function Bar({ value, low = 25, inverse = false }: { value: number; low?: number; inverse?: boolean }) {
  const alert = inverse ? value >= 100 - low : value <= low;
  return (
    <span className="bar" role="img" aria-label={`${value} %`}>
      <span className={alert ? 'bar__fill bar__fill--low' : 'bar__fill'} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}
