# R2: an approve/decline gate for self-coached autonomous adjustments

## Problem

`docs/RISK_REGISTER.md`'s R2 named this as an open product question: for a
self-coached athlete (no relationship to a human coach — the majority of
users), today's autonomous progression/session adjustment computes via
`resolveSession()` and applies **immediately** on a single click, then an
`AthleteAutocoachReceipt`-equivalent (a local `LedgerEntry`) records what
happened, reviewable only after the fact. There is a separate, already-built,
coach-supervised flow — `apps/web/src/coach/CoachProgression.tsx`'s
`RosterProgressionView` — where a human coach must Approve or Decline a
pending `AthleteProgressionProposal` before anything is banked; nothing
applies without a decision first.

Decision made (by the user, via clarifying questions, not assumed): self-coached
athletes get the same shape of gate — propose, then decide — instead of
auto-apply-then-receipt.

## Current flow (as verified against the code, not assumed)

1. `SessionReceipt.tsx` (`apps/web/src/autocoach/SessionReceipt.tsx:52-63`)
   finds today's workout and calls `resolveSession()`
   (`packages/auto-coach/src/resolve.ts:52`) fresh on every render. Nothing is
   persisted at this point — the resolution is pure, ephemeral render output.
2. `resolveSession()`'s hard-safety gate (`resolve.ts:78-105`) runs first,
   unconditional: any pain/illness hard constraint forces
   `state: 'safety_stop'`, `autoApplyAllowed: false`, regardless of readiness,
   confidence, or policy mode. This is already a structural guarantee,
   property-tested (`packages/auto-coach/src/properties.test.ts`).
3. `canApply()` (`applyResolution.ts:87-95`) excludes `state === 'safety_stop'`
   from ever being appliable at all — today's single "Apply" button never even
   renders for a safety_stop resolution; the athlete instead sees a "Review
   check-in" link. **This means a pain/illness-driven change is already
   impossible to bank today, gated or not — the new design only has to
   preserve that, not invent it.**
4. Clicking "Apply" (`handleApply`, `SessionReceipt.tsx:75-95`) synchronously:
   mutates the workout via `useDb().update()`, and calls `recordApply()` to
   write a `LedgerEntry{action:'applied', ...}` to `localStorage`. Mutation
   and receipt-write happen in the same click — there is no persisted
   "pending" object anywhere in this path today.
5. Only if the athlete also has a real ARC coaching-org relationship (the
   minority case) does the next sync best-effort mirror the already-applied
   `LedgerEntry` to a coach, read-only, via `push_autocoach_receipt`. A
   self-coached athlete with no org never triggers this; irrelevant to this
   design.

## Decisions (from clarifying questions)

1. **While a proposal is pending, the athlete trains today's session exactly
   as authored.** The suggestion is an optional, non-blocking card the athlete
   can approve, decline, or simply ignore and train around. Declining, or
   never deciding, is always safe — as-authored is what would have been
   trained anyway.
2. **If a new pain/illness hard constraint appears after a proposal was
   raised but before it's decided, the proposal is withdrawn silently** — no
   explanation shown, since nothing was ever blocking and there is nothing
   left to act on.

## Design

### Ownership (unchanged, verified against CLAUDE.md)

`packages/auto-coach` stays pure — no storage, no network, no persisted
proposal concept, computes `AutoCoachResolution` and nothing else.
`apps/web/src/autocoach` gains the new responsibility (holding one session's
proposal state), consistent with its existing charter: applies constraints to
one session, never programs a week. `@hybrid/coordinator` and
`@hybrid/coordinator-adapter` are never touched or made aware — a proposal
never becomes a weekly-plan concern.

`SelfCoachProgressionView` (`CoachProgression.tsx:237-353`) is a
plausible-looking but wrong reuse target: same file, similar
Approve/Decline vocabulary, but it operates on a structurally unrelated type
(`ProgressionProposal`, next-session weight/level increases, via its own
`progression-store.ts` ledger) and has never been connected to
`AthleteProgressionProposal` or per-session auto-coach resolutions. The
coach-supervised flow (`RosterProgressionView`) is the pattern to copy
**structurally** — propose, decide, apply-on-decide — not a type to reuse
directly.

### Data model — new file `apps/web/src/autocoach/pendingProposal.ts`

Own `localStorage` key (`hybrid-auto-coach-pending-v1`), same idiom as its
siblings `ledger.ts`/`policy.ts`/`consent.ts`. Holds at most one record,
date-keyed (not workout-id-keyed, since a fork changes the workout's id — the
same reason `SessionReceipt`/`ledger.ts` already match by date):

```ts
type PendingProposal = {
  date: string;                    // matches todaysWorkout()'s date key
  sourceWorkoutId: string;
  sourceWorkoutUpdatedAt: string;  // staleness anchor for the source workout
  resolvedBlocks: Block[];         // frozen proposed blocks, captured at propose time
  operations: Operation[];
  reasonCodes: ReasonCode[];
  status: 'pending' | 'approved' | 'declined';
};
```

`LedgerEntry` (`ledger.ts`) keeps its current `action: 'applied' | 'undone'`
unchanged. A proposal only ever touches the ledger after approval, via the
same `recordApply` call that runs today. This keeps the two concerns
separate (rejected alternative: widening `LedgerEntry.action` to include
`'pending'`/`'declined'` — touches every existing action-keyed consumer,
including the coach-receipt sync's `action` check, for no real benefit).

### Flow

**Propose.** On render, if `canApply(r)` is true and there's no existing
`PendingProposal` or `LedgerEntry` for today, `handlePropose` freezes the
current resolution into the store with `status: 'pending'`. Proposing is now
automatic; applying is not.

**Rendering on later renders.** `resolveSession()` recomputes fresh every
render, so `SessionReceipt` defers to the *stored* decision once one exists
for today: if `status` is `'declined'` or `'approved'` (or a `LedgerEntry`
already exists), the card doesn't render again. Only a fresh day, or no
record yet, proposes anew.

**Staleness re-check, on every render a pending proposal exists.** Re-run
`resolveSession()` fresh against current inputs and check its `state`,
reusing the resolver's own unconditional hard-safety gate rather than
reimplementing safety logic. If it now returns `'safety_stop'`, delete the
pending record — silent withdrawal, per the decision above. If not, the
original frozen content keeps showing unchanged; a softer drift in the
resolver's output does not silently swap the card's content — only the
hard-safety re-check can withdraw it (narrow re-check, matching the two
existing precedents `proposalIsStale`/`structurallyEqual`, which also diff
narrowly rather than re-merging wholesale).

**Approve.** `handleApprove` re-runs that same fresh safety check first
(belt-and-braces, mirroring `RosterProgressionView`'s
`disabled={proposal.direction==='review' || proposal.hard}` pattern,
`CoachProgression.tsx:146`) — by this point the card should already be gone
if unsafe, so this is the defence-in-depth backstop, not the primary gate. If
it passes, apply the **frozen** blocks captured at propose time (not a fresh
re-resolve — predictable: what the athlete saw is what gets applied), via the
existing unchanged `planApply → update → recordApply` sequence. Mark the
record `status: 'approved'`.

**Decline.** Marks `status: 'declined'`. No mutation, no ledger entry —
final for the day, same as `RosterProgressionView`'s Decline.

**Day boundary.** `PendingProposal.date !== today` reads as absent — no
expiry job, just a date check on read, matching the convention
`SessionReceipt` already uses for `appliedEntry`. Nothing carries forward.

### UI

Today's as-authored blocks render unconditionally — no change, since
as-authored is always trainable. Above it, when a `PendingProposal` is
`'pending'`, a card reuses the existing operations/reason-code summary
formatting `SessionReceipt` already has for the post-apply receipt (e.g.
"Suggested: cap intensity on Block 2 (hard constraint active)") with
`[Approve]` `[Decline]`. Once approved, the card is replaced by today's
existing applied-state UI (the Undo affordance) — unchanged. Once declined,
the card disappears; nothing else changes.

### Copy that must move in lockstep

Two places describe the old immediate-apply behavior and need updating so
athletes aren't consenting to language that no longer matches what happens:

- `ModeSwitcher.tsx`'s `auto_daily` description ("Applies permitted changes
  to today's session automatically...").
- `consent.ts`'s `COMPREHENSION_STATEMENTS`.

Exact wording drafted against the real files during implementation, in these
files' existing style — not decided here.

### Out of scope (explicitly)

`AthleteAutocoachReceipt`/`autocoach_receipts` (action check
`'applied'|'undone'` only, no status column,
`supabase/migrations/20260808_arc_receipts_autocoach.sql:80-95`) need no
change. That mirror only ever carries already-decided entries to a roster
coach, and a genuinely self-coached athlete usually has no coach to sync to
at all. Making a self-coached athlete's *pending* decision visible to an
occasional/future coach before it's decided is a real but separate design
question — not required for the core gate, and not built here.

## Testing

- **`pendingProposal.ts` (new, pure store logic)** — create/read, date-boundary
  expiry (`date !== today` reads as absent), status transitions, single record
  per day.
- **`SessionReceipt.tsx` (new colocated render test)** — no render-level test
  exists for this component today (only the pure logic it calls does), so
  this is new coverage. Uses the `@testing-library/react`/jsdom harness
  already added to `apps/web` this session. Cases: propose shows the card
  without mutating; approve re-checks safety then runs the exact existing
  apply sequence; decline marks declined without mutating; a new hard
  constraint appearing after propose silently withdraws the card
  (mutation-tested: temporarily skip the re-check, confirm the test catches
  an unsafe approve, restore); a decided proposal doesn't re-render its card
  later the same day; a new day computes fresh.
- **Regression guard** — `autocoach-apply.test.ts`, `autocoach-consent.test.ts`,
  `packages/auto-coach`'s `resolve.test.ts`/`properties.test.ts` re-run
  unchanged, since `resolve.ts`, `applyResolution.ts`, and `ledger.ts`'s
  existing functions are not modified, only called from a new call site.

## Risks and mitigations (carried from research, resolved or accepted here)

| Risk | Resolution |
|---|---|
| Same-person approval is weaker than the coach-supervised model (same athlete who'd have clicked Apply now clicks Approve) | Accepted — decisions above establish this as a deliberate pause/confirmation point, not an independent second-party check; the safety property that actually matters (pain/illness can never be banked) is enforced by the unconditional hard-safety gate, not by who clicks. |
| Staleness at approval time | Resolved — fresh `resolveSession()` re-check on every render a pending proposal exists, plus a second check at approve time. |
| One-per-day identity / proposal outlives its day | Resolved — date-keyed, absent-if-not-today, no carry-forward. |
| Consent/UI copy promises immediate apply | Tracked as in-scope, not follow-on debt (see "Copy that must move in lockstep"). |
| Multi-tab race (no `storage` event listener on sibling stores) | Accepted as-is — none of `ledger.ts`/`policy.ts`/`consent.ts` have this listener either; not a new gap this feature introduces. |
| Coach-visibility scope creep | Explicitly out of scope (see above) — do not extend `autocoach_receipts` to carry pending state. |
