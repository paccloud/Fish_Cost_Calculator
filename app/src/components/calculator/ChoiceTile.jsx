/**
 * One big tap target in a group of choices: a radio button drawn as a 56px tile, so arrow keys
 * and screen readers work as for any radio group.
 *
 * `label` is the plain name ("Whole fish"). `sub` is the second line: the trade code ("Round") or
 * the yield ("46% yield"). `code` is a trade code for a tile whose second line is taken: it is a
 * smaller third line, and a long one ("S/B Fillet (Pinboning)") wraps. It is never hidden,
 * because buyers quote the code. Tiles in a grid row are all as tall as the tallest.
 */
export default function ChoiceTile({ name, value, checked, onChange, label, sub, code }) {
  return (
    <label className="relative block">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span
        className="flex h-full min-h-tile flex-col items-start justify-center gap-0.5 rounded-xl border-2 border-line-strong bg-surface-raised px-3 py-2.5 text-left text-base font-bold leading-5 text-text-primary transition-colors [overflow-wrap:anywhere] peer-hover:border-accent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-on-primary peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--color-focus)] peer-checked:[&_small]:text-on-primary"
      >
        {label}
        {sub && <small className="text-sm font-medium leading-5 text-text-secondary tabular-nums">{sub}</small>}
        {code && (
          <small className="text-xs font-medium leading-4 text-text-secondary">{code}</small>
        )}
      </span>
    </label>
  );
}
