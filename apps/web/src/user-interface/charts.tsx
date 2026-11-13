'use client';

/**
 * Graphiques du compte rendu : courbes dans le temps et barre de répartition, en SVG, sans bibliothèque.
 *
 * Une seule grandeur par graphique, une légende toujours présente, la valeur lue au survol comme au clavier,
 * et un tableau des valeurs sous chaque courbe : rien n'est accessible par la seule couleur ni par le seul survol.
 */
import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** Teintes des camps pour les tracés : celles de l'interface, assombries d'un cran pour le fond sombre (contrôlées). */
export const CHART_COLOR = { BLUE: '#3f97e8', RED: '#e8574c', NEUTRAL: '#8a8a8a' } as const;

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  /** Une valeur par instant ; `null` : pas de mesure (la courbe s'interrompt). */
  values: (number | null)[];
}

interface LineChartProps {
  title: string;
  /** Ce que mesure l'axe vertical, en clair. */
  note: string;
  times: number[];
  series: ChartSeries[];
  /** Heure affichée pour un instant de simulation. */
  clock: (t: number) => string;
  /** Mise en forme d'une valeur (axe, infobulle, tableau). */
  format: (value: number) => string;
  /** Borne haute imposée (par exemple 100 pour un pourcentage). */
  max?: number;
}

const W = 560;
const H = 200;
const PAD = { left: 44, right: 54, top: 12, bottom: 26 };

/** Graduation « ronde » : 1, 2 ou 5 fois une puissance de dix. */
function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="chartlegend">
      {items.map((item) => (
        <li key={item.label}>
          <span className="chartlegend__key" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function LineChart({ title, note, times, series, clock, format, max }: LineChartProps) {
  const [index, setIndex] = useState<number | null>(null);
  const titleId = useId();
  const last = times.length - 1;
  const t0 = times[0] ?? 0;
  const span = Math.max(1, (times[last] ?? 1) - t0);

  const observed = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = max ?? Math.max(1, ...observed);
  const step = niceStep(top, 4);
  const yMax = max ?? Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);

  const x = (t: number) => PAD.left + ((t - t0) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);

  const pathOf = (values: (number | null)[]): string => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(times[i]!).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };

  // Étiquette en bout de courbe : seulement si les deux fins ne se chevauchent pas — sinon la légende,
  // l'infobulle et le tableau portent les valeurs.
  const ends = series.map((s) => ({ s, v: s.values[last] ?? null }));
  const endYs = ends.filter((e) => e.v !== null).map((e) => y(e.v!));
  const collide = endYs.some((a, i) => endYs.some((b, j) => i !== j && Math.abs(a - b) < 13));

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * span);
  // Deux courbes identiques se recouvrent : on le dit, plutôt que de laisser croire qu'il n'y en a qu'une.
  const merged = series.length > 1 && series.slice(1).every((s) => s.values.every((v, i) => v === series[0]!.values[i]));

  const nearest = (clientX: number, target: SVGSVGElement): number => {
    const box = target.getBoundingClientRect();
    const t = t0 + ((((clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right)) * span;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - t) < Math.abs(times[best]! - t)) best = i;
    return best;
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setIndex(nearest(e.clientX, e.currentTarget));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    setIndex((i) => {
      const from = i ?? last;
      if (e.key === 'Home') return 0;
      if (e.key === 'End') return last;
      return Math.max(0, Math.min(last, from + (e.key === 'ArrowLeft' ? -1 : 1)));
    });
  };

  // Tableau des valeurs : une douzaine de lignes, réparties sur la partie.
  const stride = Math.max(1, Math.ceil(times.length / 12));
  const rows = times.map((_, i) => i).filter((i) => i % stride === 0 || i === last);
  const tipLeft = index === null ? 0 : (x(times[index]!) / W) * 100;

  return (
    <figure className="chart">
      <figcaption>
        <strong id={titleId}>{title}</strong>
        <span>
          {note}
          {merged ? ' — les courbes des deux camps sont confondues' : ''}
        </span>
      </figcaption>
      <div className="chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setIndex(null)}
          onFocus={() => setIndex((i) => i ?? last)}
          onBlur={() => setIndex(null)}
          onKeyDown={onKey}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className="chart__grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="chart__tick" x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end">
                {format(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={t} className="chart__tick" x={x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
              {clock(t)}
            </text>
          ))}
          {series.map((s) => (
            <path key={s.key} d={pathOf(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {ends.map(({ s, v }) =>
            v === null ? null : (
              <g key={s.key}>
                <circle className="chart__dot" cx={x(times[last]!)} cy={y(v)} r={4} fill={s.color} />
                {collide ? null : (
                  <text className="chart__end" x={x(times[last]!) + 9} y={y(v) + 4}>
                    {format(v)}
                  </text>
                )}
              </g>
            ),
          )}
          {index !== null ? (
            <g>
              <line className="chart__cross" x1={x(times[index]!)} x2={x(times[index]!)} y1={PAD.top} y2={H - PAD.bottom} />
              {series.map((s) => {
                const v = s.values[index];
                return v === null || v === undefined ? null : <circle key={s.key} className="chart__dot" cx={x(times[index]!)} cy={y(v)} r={4} fill={s.color} />;
              })}
            </g>
          ) : null}
        </svg>
        {index !== null ? (
          <div className={`chart__tip${tipLeft > 62 ? ' chart__tip--left' : ''}`} style={{ left: `${tipLeft}%` }} role="status">
            <time>{clock(times[index]!)} Z</time>
            {series.map((s) => {
              const v = s.values[index];
              return (
                <p key={s.key}>
                  <span className="chart__key" style={{ background: s.color }} />
                  <b>{v === null || v === undefined ? '—' : format(v)}</b> {s.label}
                </p>
              );
            })}
          </div>
        ) : null}
      </div>
      <details className="chart__table">
        <summary>Tableau des valeurs</summary>
        <table className="table table--static">
          <thead>
            <tr>
              <th>Heure</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i}>
                <td>{clock(times[i]!)} Z</td>
                {series.map((s) => {
                  const v = s.values[i];
                  return <td key={s.key}>{v === null || v === undefined ? '—' : format(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export interface SharePart {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Un tout réparti en quelques parts : une barre segmentée, sa légende, et les valeurs en clair à côté. */
export function ShareBar({ parts, label }: { parts: SharePart[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="sharebar" role="img" aria-label={`${label} : ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
      <div className="sharebar__bar">
        {shown.map((p) => {
          const share = total > 0 ? p.value / total : 0;
          return (
            <span key={p.key} className="sharebar__part" style={{ flexGrow: p.value, background: p.color }} title={`${p.label} : ${p.value} sur ${total}`}>
              {/* L'étiquette n'apparaît que si la part est assez large pour la contenir. */}
              {share >= 0.12 ? p.value : ''}
            </span>
          );
        })}
      </div>
      <Legend items={parts.map((p) => ({ label: `${p.label} : ${p.value}`, color: p.color }))} />
    </div>
  );
}
