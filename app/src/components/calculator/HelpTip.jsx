import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Help bubble that works for mouse (hover), keyboard (focus) and touch (tap).
 * Hover-only tooltips are invisible on phones, which is where most people use this.
 *
 * The bubble is `position: fixed` and placed from the trigger's rect. Fixed elements never add
 * scrollable overflow, so a bubble near the screen edge can't widen the page on mobile.
 */
export default function HelpTip({ text, label, children }) {
  const [show, setShow] = useState(false);
  const bubbleId = useId();
  const wrapperRef = useRef(null);
  const bubbleRef = useRef(null);
  const lastPointer = useRef('mouse');

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const trigger = wrapperRef.current;
    if (!show || !bubble || !trigger) return;
    const gap = 8;
    const vv = window.visualViewport;
    const viewportWidth = vv?.width ?? document.documentElement.clientWidth;
    const minX = (vv?.offsetLeft ?? 0) + gap;
    const maxX = (vv?.offsetLeft ?? 0) + viewportWidth - gap;
    // The CSS cap is in layout units; when zoomed in the visible area is narrower, so cap it here too
    bubble.style.maxWidth = `${Math.min(parseFloat(getComputedStyle(bubble).maxWidth) || Infinity, maxX - minX)}px`;
    const t = trigger.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();
    const left = Math.min(Math.max(t.left, minX), Math.max(minX, maxX - width));
    // Prefer above the trigger; drop below when it would slide under the 56px top bar
    const fitsAbove = t.top - height - gap >= (vv?.offsetTop ?? 0) + 64;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${fitsAbove ? t.top - height - gap : t.bottom + gap}px`;
  }, [show]);

  // Tapping elsewhere closes it (iOS never blurs a tapped button); scrolling would detach it
  useEffect(() => {
    if (!show) return undefined;
    const close = (e) => {
      if (e.type === 'scroll' || !wrapperRef.current?.contains(e.target)) setShow(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [show]);

  return (
    <span ref={wrapperRef} className="inline-block">
      <button
        type="button"
        aria-label={label}
        aria-describedby={show ? bubbleId : undefined}
        aria-expanded={show}
        // 44px hit area without moving the layout: padding out, negative margin back in
        className="-m-[13px] cursor-help rounded p-[13px] text-left"
        onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setShow(true); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setShow(false); }}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setShow(true); }}
        onBlur={() => setShow(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setShow(false); }}
        onClick={(e) => {
          // detail === 0 means keyboard or assistive-tech activation: always open (Esc closes)
          if (e.detail === 0) setShow(true);
          else if (lastPointer.current !== 'mouse') setShow((s) => !s);
        }}
      >
        {children}
      </button>
      {show && (
        <span
          id={bubbleId}
          ref={bubbleRef}
          role="tooltip"
          className="fixed left-0 top-0 z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-sm font-normal leading-snug text-text-primary shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
