import { useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { parseAmount } from '../../lib/numberInput';
import { tapHaptic } from './haptics';

const stepButton =
  'flex min-h-tile items-center justify-center rounded-xl border-2 border-line-strong bg-surface-raised text-text-primary transition-colors hover:border-accent hover:text-accent active:translate-y-px active:bg-surface';

/**
 * A typed number with a big minus and plus either side, for wet or gloved hands.
 *
 * `value` is the text in the box, exactly as typed; `format` turns a stepped number back into
 * text. Text that is not a number marks the box invalid and is never counted as 0. Pass
 * `invalid` for a number that can be read but cannot be used (a yield over 100).
 */
export default function Stepper({
  id, value, onChange, step, format, prefix, suffix, lessLabel, moreLabel, placeholder, describedBy, invalid = false,
}) {
  const inputRef = useRef(null);
  const unreadable = String(value).trim() !== '' && Number.isNaN(parseAmount(value));
  const bump = (delta) => {
    tapHaptic();
    onChange(format(Math.max(0, (parseAmount(value) || 0) + delta)));
  };
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] gap-2">
      <button type="button" onClick={() => bump(-step)} aria-label={lessLabel} className={stepButton}>
        <Minus size={24} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {/* The input is as wide as its text (digits are tabular, so one `ch` each) and the $ or unit
          sits right beside the number; a tap anywhere in the box focuses it */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex cursor-text items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-line-strong bg-surface-raised px-3 has-[[aria-invalid=true]]:border-danger focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[color:var(--color-focus)]"
      >
        {prefix && <span aria-hidden="true" className="text-xl font-bold text-text-secondary">{prefix}</span>}
        <input
          ref={inputRef}
          id={id}
          style={{ width: `calc(${Math.max(String(value || placeholder || '').length, 2)}ch + 0.25rem)` }}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || unreadable || undefined}
          aria-describedby={describedBy}
          className="min-h-[3.25rem] min-w-0 max-w-full bg-transparent text-center text-2xl font-extrabold tabular-nums text-text-primary placeholder-text-muted focus:outline-none"
        />
        {suffix && <span aria-hidden="true" className="whitespace-nowrap text-xl font-bold text-text-secondary">{suffix}</span>}
      </div>
      <button type="button" onClick={() => bump(step)} aria-label={moreLabel} className={stepButton}>
        <Plus size={24} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}
