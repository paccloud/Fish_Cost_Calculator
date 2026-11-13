import { CircleAlert, CircleCheck } from 'lucide-react';

const TONES = {
  success: { className: 'notice-success', role: 'status', Icon: CircleCheck },
  error: { className: 'notice-error', role: 'alert', Icon: CircleAlert },
};

/**
 * What just happened, in place, with an icon and a word.
 *
 * title is the outcome as one bold sentence ("Saved.", "The community yields didn’t load.");
 * children say why and what to do next. Success is announced politely (role="status"), a
 * failure straight away (role="alert"). Field errors belong under the field, not here.
 */
export default function Notice({ tone = 'success', title, children }) {
  const { className, role, Icon } = TONES[tone] ?? TONES.success;
  return (
    <div className={`notice ${className}`} role={role}>
      <Icon aria-hidden="true" />
      <div className="min-w-0">
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}
