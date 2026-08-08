# Product notes — The Hybrid Engine

Concise answers for someone picking this up cold. Written 8 August 2026 against
`main` @ `a8ff104`. Longer evidence in `docs/ACTUAL_*.md` and
`docs/COORDINATOR_AND_EVIDENCE_AUDIT.md`.

## Who is the primary user?

**One athlete who trains strength and conditioning together, logging on an
Android phone.** Singular, literally: there is no multi-athlete data access
anywhere in the backend, and the coach surface reads the signed-in user's own
data. The web app is a dashboard over the same data; the phone is where
training is actually logged.

## What problem is the app solving?

**Strength and conditioning compete for one week and one body, and something
has to decide.** Two specialist engines propose sessions; a deterministic
Coordinator resolves the collision — interference, spacing, domain caps, safety
flags — and emits a reasoned decision for every proposal it accepted or dropped.

That collision is the product. Everything else (logging, nutrition, wearables)
feeds it or records its outcome.

## The five most important workflows

1. **Log a training session** — the core loop. `Logger` on both clients.
2. **Coordinator resolves the week** — `reconcileWeeklyPlan`, the only writer of
   the weekly plan.
3. **Daily check-in / recovery capture** — manual entry plus WHOOP, feeding
   `deriveAthleteState`.
4. **Log food** — the nutrition world: quick add, catalogue search, barcode and
   label scan, weigh-ins, weekly check-in.
5. **Sync across devices** — additive merge in both directions. The single most
   safety-critical code path in the repo.

## What must automation never do?

Enforced today, verified in code:
- Treat missing data as normal. `band(null)` is `'unknown'`, not "clear"
  (`packages/whole-athlete-state/src/state.ts:19`); a missing recovery score is
  a no-op on prescribed load (`packages/engine/src/lift.ts:175`).
- Let anything outrank pain or illness — they drop a session outright rather
  than scaling it (`dropped_pain_safety`, `dropped_illness_safety`).
- Use HRV as a pain, injury or illness gate.
- Rewrite history. Log entry macros are snapshotted at log time and never
  re-derived.
- Delete by removal. Deletes stamp `deletedAt`; a spliced record returns from
  the other device and loses the deletion.

**Not enforced today — read `docs/COORDINATOR_AND_EVIDENCE_AUDIT.md` before
promising otherwise:**
- The logger **pre-fills the next set's weight with an increase**
  (`apps/web/src/screens/Logger.tsx:296-297`).
- Progression is **banked automatically at session end** with no approval step
  (`apps/web/src/screens/Training.tsx:86`).
- The automation receipt ledger is **device-local** and never syncs
  (`apps/web/src/autocoach/ledger.ts:27`).

## What should the finished product feel like?

Calm, editorial, professional. Charcoal and bronze, tabular numerals, no
gamification, no streaks, no shame. It tells the athlete what it decided and
why, and it says "unknown" when it does not know.

## Which features are production-ready?

- The engines: strength progression, conditioning, Coordinator, whole-athlete
  state. Heavily tested (594 tests in `@hybrid/engine` alone).
- The merge and sync layer, including RLS proven against a real Postgres by
  `checks/migrations-apply.mjs`.
- The nutrition engine — parity-proven against a Python reference, with its six
  inherited defects documented as data and two surfaced in the UI.
- Both clients' core logging paths.

## Which features are prototypes?

- **The coach bench.** ~2,700 lines of UI with no render tests, driven only by
  `checks/react-smoke.mjs`. It reads the signed-in user's own data — it is not
  a coach product.
- **The food catalogue is empty.** Its seed rows live in a retired repository,
  so barcode lookups miss by design and route to "create the food".
- **Label OCR is unverified in the field.** The parser is well tested; nobody
  has photographed a real packet.
- **`auto-coach` is web-only.** The mobile app does not depend on it, and real
  athletes use the phone.
- **`/coach` fails offline** — it is excluded from `navigateFallback` in
  `apps/web/vite.config.ts` on the now-false grounds that it is a separate app.

## Which decisions still require the product owner?

1. **Is the coach a different person from the athlete, or the same person in a
   different mode?** Everything about Arc, RLS and the backend follows from
   this. Nothing else can be sensibly decided first.
2. **Should progression require approval?** Today it is automatic. Making it
   approval-gated is the largest single behavioural change the stated
   constraints imply.
3. **Should the pre-filled next-set weight remain?** It is the clearest
   contradiction of "do not automatically increase load".
4. **Does the receipt ledger become synced and append-only?** Required before
   any coach surface can claim to show what automation did.
5. **What should `/coach` do offline?**
6. **Nutrition seeding** — AUSNUT only, per the standing decision.
