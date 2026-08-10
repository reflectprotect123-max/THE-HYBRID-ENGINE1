import { type ReactNode } from 'react';

/*
 * The coach bench's hierarchy primitive. Everything used to get the same
 * bordered card, so a passive stat and an urgent decision competed for the
 * same amount of attention — nothing told the eye where to land first.
 *
 * `CoachSection` fixes that with one rule: secondary information collapses
 * to a single quiet row by default (a label, an optional count, nothing
 * else) and expands on tap — the same "one parent, indented children"
 * relationship as a file tree, not a grid of equally loud boxes. Only the
 * one thing that actually needs a decision keeps its own always-open,
 * gold-elevated card (`.card.raised`, unchanged, used directly where that
 * still applies — this component is deliberately not used there).
 *
 * Native <details>/<summary>: no JS state, keyboard/screen-reader support
 * for free, and it can't silently collapse itself under a controlled input
 * mid-edit the way a custom open/closed useState could if wired carelessly.
 */
export function CoachSection({
  title,
  eyebrow,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group border-b border-line first:border-t"
      open={defaultOpen || undefined}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2.5 marker:hidden [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="text-dim transition-transform duration-150 group-open:rotate-90"
        >
          ›
        </span>
        <span className="min-w-0 flex-1">
          {eyebrow ? <span className="mr-1.5 text-[9px] uppercase tracking-wider text-dim">{eyebrow}</span> : null}
          <span className="text-sm font-semibold text-text">{title}</span>
        </span>
        {count != null ? (
          <span className="shrink-0 rounded-full border border-line2 px-1.5 text-[10px] tabular-nums text-dim">
            {count}
          </span>
        ) : null}
      </summary>
      <div className="pb-3 pl-4">{children}</div>
    </details>
  );
}
