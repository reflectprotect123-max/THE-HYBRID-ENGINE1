import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/*
 * Shared primitives.
 *
 * Every spacing utility below resolves through Tailwind's `--spacing`, which
 * packages/design pins to 8px — so `p-2` is 16px, `gap-1` is 8px, and the grid
 * holds by construction rather than by review. The rare 4px optical nudge is
 * written `-0.5` and is meant to stand out.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-lg border border-line bg-panel p-2 shadow-card',
        className,
      )}
      {...rest}
    />
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'brass' | 'ghost' | 'quiet';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'ghost', size = 'md', className, ...rest }: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-1 rounded-md font-[650] transition-colors duration-150 ease-standard disabled:opacity-40 disabled:pointer-events-none';
  const sizes = {
    sm: 'h-4 px-1.5 text-3',
    md: 'h-5 px-2 text-5',
    lg: 'h-7 px-3 text-6',
  }[size];
  const variants = {
    brass:
      'text-[#1b1509] shadow-brass [background:var(--brass)] hover:brightness-110 active:brightness-95',
    ghost: 'border border-line2 bg-panel2 text-text hover:border-gold-line hover:bg-well',
    quiet: 'text-muted hover:text-text',
  }[variant];
  return <button className={cx(base, sizes, variants, className)} {...rest} />;
}

export function Chip({
  on,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      aria-pressed={on}
      className={cx(
        'h-4 rounded-pill border px-1.5 text-1 font-[800] uppercase tracking-[.1em] transition-colors duration-120 ease-standard',
        on
          ? 'border-gold-line bg-gold-wash text-gold2'
          : 'border-line2 bg-panel2 text-muted hover:text-text',
        className,
      )}
      {...rest}
    />
  );
}

/** The recessed slot every typed value sits in. */
export function Field({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'num h-6 w-full rounded-md border border-line bg-well px-1.5 text-center text-7 font-[750] text-text shadow-well outline-none placeholder:text-dim focus:border-gold-line',
        className,
      )}
      {...rest}
    />
  );
}

/** The uppercase tracked micro-label, in the brand gold of the shipped app's
 * `.kicker` / `.sc-kicker` (design card 04-athlete-01/02). Pass a text- class
 * to retint where a quieter label is wanted. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('text-2 font-[800] uppercase tracking-[.18em] text-gold', className)}>
      {children}
    </div>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-8 leading-tight font-[800] text-text [overflow-wrap:anywhere]">{children}</h1>
  );
}

/** Section label between cards — the vanilla app's `.sec-head`: an uppercase
 * tracked micro-line in muted gold, so screen title > card titles > sections
 * read as three distinct levels rather than a flat stack of bold. */
export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-baseline justify-between gap-1">
      <h2 className="text-2 font-[750] uppercase tracking-[.16em] text-gold2/80 [overflow-wrap:anywhere]">
        {title}
      </h2>
      {right}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-1 py-4 text-center">
      <p className="text-6 font-[750] text-text">{title}</p>
      {body ? <p className="max-w-[34ch] text-4 text-muted">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </Card>
  );
}

/**
 * The superset/exercise marker. A pair shares one letter: A1, A2.
 *
 * Only the logger's chip is a control. Everywhere else the chip sits INSIDE the
 * button that opens the exercise, and a button nested in a button is invalid
 * HTML — React rejects the nesting outright, and a screen reader is left
 * announcing two controls where the athlete sees one label.
 */
export function LetterChip({ letter, onClick }: { letter: string; onClick?: () => void }) {
  const cls =
    'num grid h-4 min-w-4 shrink-0 place-items-center rounded-sm border border-gold-line bg-gold-wash px-0.5 text-3 font-[800] text-gold2';
  if (!onClick) return <span className={cls}>{letter}</span>;
  return (
    <button onClick={onClick} aria-label="back to session" className={cls}>
      {letter}
    </button>
  );
}

/** A progress arc. `frac` 0..1. Inline SVG — no chart library, CSP-safe. */
export function Ring({
  frac,
  size = 96,
  stroke = 8,
  color,
  track = 'var(--color-track-soft)',
  glow,
  children,
}: {
  frac: number;
  size?: number;
  stroke?: number;
  color: string;
  track?: string;
  /** Neon treatment from 01-foundations-colour-06: the lit arc glows brighter
   * than any band ink. Static light, not motion — reduced-motion safe. */
  glow?: boolean;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          style={{
            transition: 'stroke-dashoffset .3s var(--ease-standard)',
            filter: glow ? `drop-shadow(0 0 5px ${color})` : undefined,
          }}
        />
      </svg>
      <div className="absolute grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Horizontal completion bar used at the top of the logger. */
export function Meter({ pct }: { pct: number }) {
  return (
    <div className="h-0.5 w-full overflow-hidden rounded-pill bg-track">
      <span
        className="block h-full rounded-pill [background:var(--brass)]"
        style={{ width: Math.max(0, Math.min(100, pct)) + '%', transition: 'width .3s var(--ease-standard)' }}
      />
    </div>
  );
}
