import { useId } from 'react';
import { Bookmark, BookmarkCheck, ChevronDown, Share } from 'lucide-react';

// The figure is one line. On a narrow phone it gives up size, not digits: the type shrinks so the
// figure, its unit and the actions still share a row (about 0.62em per character, 13rem for the
// rest of the row). If it would have to go below 1.75rem the actions wrap under it instead.
const figureSize = (figure) =>
  `max(1.75rem, min(3.25rem, calc((100vw - 13rem) / ${(0.62 * Math.max(figure.length, 4)).toFixed(2)})))`;

/**
 * The answer, pinned to the bottom edge: the one `bar` block on the screen.
 *
 * It draws a ticket model (see ticketModel.js) and decides nothing itself. With an answer it
 * shows the label, the figure, Save and Share, then the line items. On a phone the line items
 * sit behind "Price details" so the ticket does not eat the screen; from 768px they are always
 * shown, beside the figure rather than under it, so the ticket stays short on a wide screen.
 * Without an answer it is one sentence saying what is missing, never a zero.
 *
 * `notice` is drawn just above the ticket, inside the dock, so the dock's height (which the
 * screen uses for scroll padding) includes it.
 */
export default function Ticket({
  dockRef, model, notice,
  open, onToggle,
  onSave, saved, saveDisabled,
  onShare, includePaid, onIncludePaid,
}) {
  const detailsId = useId();
  const { answer, lines, prompt } = model;
  const canShare = Boolean(onShare) && answer?.unit === '/lb';
  const hasDetails = lines.length > 0 || canShare;

  return (
    <div ref={dockRef} className="ticket-dock">
      {/* Only the notice itself takes taps: the strip beside it leaves the page underneath usable */}
      {notice && (
        <div className="pointer-events-none mx-auto max-w-content px-4 pb-2 sm:px-6 md:px-0 [&>*]:pointer-events-auto">
          {notice}
        </div>
      )}
      <section className="ticket" aria-label="Your result">
        {/* The dock is as wide as the window; what it says lines up with the column above it */}
        <div className="mx-auto max-w-content sm:px-2 md:px-0">
          {!answer ? (
            <p className="py-1 text-lg font-bold leading-6">{prompt}</p>
          ) : (
            <div className="md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:items-start md:gap-x-8">
              <div>
              <p className="ticket-label">{answer.label} <b>{answer.subject}</b></p>
              <div className="ticket-row flex-wrap gap-y-2">
                <p className="ticket-figure" style={{ fontSize: figureSize(answer.figure) }}>
                  {answer.figure}<small>{answer.unit === '/lb' ? '/lb' : ` ${answer.unit}`}</small>
                </p>
                <div className="ticket-actions ml-auto md:ml-0">
                  <button
                    type="button"
                    className="ticket-action"
                    onClick={onSave}
                    disabled={saveDisabled}
                    aria-disabled={saved || undefined}
                  >
                    {saved
                      ? <BookmarkCheck size={20} aria-hidden="true" />
                      : <Bookmark size={20} aria-hidden="true" />}
                    {saved ? 'Saved' : 'Save'}
                  </button>
                  {canShare && (
                    <button type="button" className="ticket-action" onClick={onShare} aria-label="Share this price">
                      <Share size={20} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              </div>
              {hasDetails && (
                <div className="md:border-l md:border-dashed md:border-on-bar-muted md:pl-8">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={detailsId}
                    onClick={onToggle}
                    className="mt-1 flex min-h-target w-full items-center justify-between gap-2 rounded text-left text-sm font-semibold text-on-bar md:hidden"
                  >
                    Price details
                    <ChevronDown
                      size={20}
                      aria-hidden="true"
                      className={`shrink-0 text-on-bar-muted ${open ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <div id={detailsId} className={open ? '' : 'hidden md:block'}>
                    {lines.length > 0 && (
                      <ul className="ticket-lines max-md:mt-0 md:mt-0 md:border-t-0 md:pt-0">
                        {lines.map((line) => (
                          <li key={line.id}><span>{line.label}</span><span>{line.value}</span></li>
                        ))}
                      </ul>
                    )}
                    {canShare && (
                      <label className="mt-1 flex min-h-target cursor-pointer items-center gap-3 text-sm text-on-bar-muted">
                        <input
                          type="checkbox"
                          checked={includePaid}
                          onChange={(e) => onIncludePaid(e.target.checked)}
                          className="h-5 w-5 shrink-0 cursor-pointer accent-brand-yellow"
                        />
                        <span><span className="font-semibold text-on-bar">Include what I paid</span> when I share</span>
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
