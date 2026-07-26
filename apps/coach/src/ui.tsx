import type { ReactNode } from 'react';

/*
 * The coach builder's shared visual vocabulary.
 *
 * Every rule here is transcribed from a card in design/cards/ rather than
 * invented, so a change to the kit has one place to land:
 *
 *   Ltr            → 03-shared-06 (letter chip) + the concept mock's .lgltr
 *   Chip           → 03-shared-02 (chips)
 *   Field          → 05-coach-04 (coach instructions field: floating label
 *                    sitting on the top border of a panel)
 *   Toast          → 03-shared-03 (toast), rendered inline — see Editor
 *   BRASS/GHOST/ADD→ 03-shared-01 (buttons: bigbtn / addbtn / markall)
 *   MICRO          → the uppercase tracked micro-label idiom the token doc
 *                    tells us to preserve
 *
 * Spacing is Tailwind's numeric scale over `--spacing: 8px`, so `p-1` is 8px
 * and `gap-2` is 16px. Nothing here reaches for a literal pixel margin.
 */

/** The uppercase tracked micro-label. `--fs-1`, `--fw-bold`, .14em. */
export const MICRO = 'text-1 font-[800] uppercase tracking-[.14em] text-dim';

/** 03-shared-01 `.bigbtn` — the one brass control on a surface. */
export const BRASS =
  'inline-flex h-5 items-center justify-center gap-1 rounded-md px-2 text-4 font-[800] text-[#1b1509] ' +
  'shadow-brass transition-[filter] duration-150 [background:var(--brass)] hover:brightness-110 disabled:opacity-40';

/** A quiet bordered control. */
export const GHOST =
  'inline-flex h-4 items-center justify-center gap-0.5 rounded-md border border-line2 px-1.5 text-3 ' +
  'font-[650] text-muted transition-colors duration-150 hover:border-gold-line hover:text-gold2';

/** 03-shared-01 `.addbtn` — dashed, reads as "there could be more here". */
export const ADD =
  'inline-flex h-6 items-center justify-center gap-0.5 rounded-md border border-dashed border-line2 px-2 ' +
  'text-4 font-[750] text-muted transition-colors duration-150 hover:border-gold-line hover:text-gold2';

/** A sunk text field. `--well` + `--shadow-well`, gold on focus. */
export const WELL =
  'rounded-md border border-line bg-well text-text shadow-well outline-none transition-colors duration-150 ' +
  'placeholder:text-dim focus:border-gold-line';

/**
 * The letter chip.
 *
 * 03-shared-06 flags that this object has three different treatments across the
 * two apps and says it is "worth unifying". Unified here on the athlete app's
 * brass plate (`.lgltr`), because that is the treatment the phone already ships
 * and the coach is the surface that moved.
 */
export function Ltr({ children, cond }: { children: ReactNode; cond?: boolean }) {
  return (
    <span
      className={
        'num grid h-4 min-w-4 shrink-0 place-items-center rounded-sm border px-0.5 text-3 font-[800] shadow-brass ' +
        (cond
          ? 'border-zone-green/40 text-zone-green [background:linear-gradient(180deg,rgba(51,192,122,.14),rgba(51,192,122,.04))]'
          : 'border-gold-line text-gold2 [background:var(--brass-wash)]')
      }
    >
      {children}
    </span>
  );
}

/** 03-shared-02 `.chip`. `cond` is the green conditioning variant. */
export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'gold' | 'cond' }) {
  return (
    <span
      className={
        'inline-flex items-center gap-0.5 rounded-pill border px-1 py-0.5 text-1 font-[800] uppercase tracking-[.1em] ' +
        (tone === 'gold'
          ? 'border-gold-line bg-gold-wash text-gold2'
          : tone === 'cond'
            ? 'border-zone-green/30 bg-zone-green/10 text-zone-green'
            : 'border-line2 text-muted')
      }
    >
      {children}
    </span>
  );
}

/**
 * 05-coach-04. A panel whose label sits ON its top border, so a group of
 * controls reads as one named thing instead of a heading floating above a box.
 * The label's background has to match the panel's or it will not cut the rule.
 */
export function Field({
  label,
  children,
  className = '',
  right,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className={'relative rounded-md border border-line bg-panel px-1.5 py-2 shadow-card ' + className}>
      <span className="absolute -top-1 left-1.5 bg-panel px-1 text-3 font-[750] text-muted">{label}</span>
      {right ? <span className="absolute -top-1 right-1.5 bg-panel px-1">{right}</span> : null}
      {children}
    </div>
  );
}

/* --- icons. Every one is aria-hidden; the control around it carries the name. --- */

const S = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true } as const;

export const IconUp = ({ size = 16 }: { size?: number }) => (
  <svg {...S} width={size} height={size}>
    <path d="m6 14 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconDown = ({ size = 16 }: { size?: number }) => (
  <svg {...S} width={size} height={size}>
    <path d="m6 10 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconRight = ({ size = 16 }: { size?: number }) => (
  <svg {...S} width={size} height={size}>
    <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 05-coach-01 `.c-assign` carries this paper-plane next to "Assign to phone". */
export const IconSend = ({ size = 16 }: { size?: number }) => (
  <svg {...S} width={size} height={size} strokeWidth={2}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconLink = ({ size = 14 }: { size?: number }) => (
  <svg {...S} width={size} height={size} strokeWidth={2}>
    <path d="M9 12h6M8 8.5 5.5 11a3.5 3.5 0 0 0 5 5L13 13.5M16 15.5l2.5-2.5a3.5 3.5 0 0 0-5-5L11 10.5" />
  </svg>
);

/** 03-shared-04's empty state pairs its copy with one brass-plated glyph. */
export const IconRest = ({ size = 22 }: { size?: number }) => (
  <svg {...S} width={size} height={size}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
  </svg>
);

export const IconCheck = ({ size = 14 }: { size?: number }) => (
  <svg {...S} width={size} height={size} strokeWidth={2.4}>
    <path d="m5 13 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
