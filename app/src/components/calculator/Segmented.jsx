/**
 * Two or three modes of one screen. The pressed segment is the one teal fill a screen has
 * besides its selected tiles. Segments are 48px tall; the tray is a card corner (8px) and each
 * segment a button corner (6px).
 *
 * options: [{ id, label }]. Each segment is a button with `aria-pressed`.
 */
export default function Segmented({ label, options, value, onChange }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-line-strong bg-surface-raised p-1"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`min-h-control rounded-lg px-2 text-base font-bold leading-5 transition-colors ${
            value === option.id ? 'bg-primary text-on-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
