import { CircleAlert } from 'lucide-react';

/**
 * What is wrong with a box and what to type, under the box. An icon and words, never colour
 * alone. Point the input's `aria-describedby` at `id`.
 */
export default function FieldError({ id, children }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm font-semibold text-danger">
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
