'use client';

/**
 * Champs de saisie de l'éditeur. La valeur n'est transmise qu'à la sortie du champ (ou sur Entrée) :
 * on peut ainsi vider un champ pour le retaper, et une valeur refusée revient à la précédente.
 */
import { useEffect, useState, type ReactNode } from 'react';

interface TextProps {
  label?: string;
  value: string;
  /** Retourne `false` si la valeur est refusée : le champ reprend alors sa valeur précédente. */
  onCommit: (value: string) => boolean;
  multiline?: boolean;
  rows?: number;
  ariaLabel?: string;
  small?: boolean;
}

export function EditText({ label, value, onCommit, multiline, rows = 3, ariaLabel, small }: TextProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value && !onCommit(text)) setText(value);
  };
  const className = `input${small ? ' input--small' : ''}`;
  const input = multiline ? (
    <textarea className={className} rows={rows} value={text} aria-label={ariaLabel ?? label} onChange={(e) => setText(e.target.value)} onBlur={commit} />
  ) : (
    <input
      className={className}
      value={text}
      aria-label={ariaLabel ?? label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
  if (!label) return input;
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  );
}

interface NumberProps {
  label?: string;
  value: number;
  onCommit: (value: number) => boolean;
  suffix?: string;
  ariaLabel?: string;
  hint?: ReactNode;
  /** Champ élargi, pour les grands nombres (graine). */
  wide?: boolean;
}

export function EditNumber({ label, value, onCommit, suffix, ariaLabel, hint, wide }: NumberProps) {
  const shown = String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const parsed = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      setText(shown);
      return;
    }
    if (parsed !== value && !onCommit(parsed)) setText(shown);
  };
  const input = (
    <span className={`numfield${wide ? ' numfield--wide' : ''}`}>
      <input
        className="input input--small"
        inputMode="decimal"
        value={text}
        aria-label={ariaLabel ?? label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {suffix ? <small>{suffix}</small> : null}
    </span>
  );
  if (!label) return input;
  return (
    <label className="field">
      <span>{label}</span>
      {input}
      {hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}
