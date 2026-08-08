# Actual test catalogue

Written 8 August 2026 against `main` @ `a8ff104`.

**Tests are colocated** as of PR #24: `src/lift.ts` is tested by
`src/lift.test.ts`. No `*.test.ts` exists under any `test/` directory; those
now hold only fixtures, golden vectors and the mobile Jest setup.

**Two runners.** Vitest for web and packages; **Jest with `jest-expo` and
injected globals** for mobile (no runner import). Mixing them up is the most
common failure when adding a test.

## Inventory

| Project | Files | Tests |
|---|---:|---:|
| `@hybrid/engine` | 25 | 594 |
| `@hybrid/mobile` (Jest) | 23 | 243 |
| `@hybrid/nutrition-engine` | 4 | 175 |
| `@hybrid/nutrition-core` | 7 | 127 |
| `@hybrid/web` | 15 | 103 (+2 skipped, live-gated) |
| `@hybrid/nutrition-adapter` | 2 | 35 |
| `@hybrid/auto-coach` | 4 | 34 |
| `@hybrid/guided-flow` | 1 | 15 |
| `@hybrid/shared-core` | 1 | 13 |
| `@hybrid/whole-athlete-state` | 2 | 13 |
| `@hybrid/design` | 1 | 11 |
| `@hybrid/coordinator` | 2 | 6 |
| `@hybrid/product-scope`, `coordinator-adapter` | 1 each | 2 each |
| `@hybrid/strength-engine`, `conditioning-engine` | 1 each | 1 each |

**Totals: 91 files, 1,375 tests.**

## Executable checks (`checks/*.mjs`)

More authoritative than prose. `migrations-apply.mjs` applies every migration to
a real throwaway Postgres and proves RLS isolates two athletes, including six
cross-owner writes. `react-smoke.mjs` drives real Chromium including the coach
bench. `contrast.mjs` checks every ink/surface pair in every palette.
`ecosystem-contract.mjs`, `docs.mjs`, `pentest.mjs`, `web-touch.mjs`,
`mobile-touch.mjs`, `deploy-smoke.mjs` complete the set.

## Coverage by area

| Area | Covered | Gap |
|---|---|---|
| Primary journeys | `react-smoke.mjs` drives real journeys; mobile `screens.test.tsx` renders every screen | — |
| Data loss / merge | Strong. Additive merge asserted both directions; tombstones; fingerprint isolation in 8 files | — |
| Synchronization | `sync-merged.test.tsx` (mobile), `sync-e2e.live.test.ts` (gated) | **No web `SyncProvider` test at all** |
| Conflict handling | Revision guard proven in `migrations-apply.mjs` | Client reaction to a refused write is untested |
| Authorization / tenancy | RLS proven against real Postgres | — |
| Authentication | Session persistence shape covered | No sign-in/sign-out flow test |
| Safety input | Pain/illness precedence covered in coordinator + state tests, incl. a merge regression suite added 7 Aug | — |
| Coordinator rules | `coordinator.test.ts`, `nutrition-boundary.test.ts` | `staleness` weighting untested |
| Plan vs actual separation | Snapshot-at-log-time proven for nutrition | **No equivalent for training** |
| Accessibility | `contrast.mjs`, `web-touch.mjs`, `mobile-touch.mjs` | **No keyboard-navigation, focus-order, screen-reader or 200%-zoom test** |
| Offline behaviour | — | **None.** No test exercises offline load/write/recovery |
| Export / restore | Partial | **Destructive-restore path untested** |
| Responsive layouts | Touch-target floors only | No breakpoint/reflow test |
| Coach bench | Logic unit-tested | **No render tests** — ~2,700 lines driven only by react-smoke |

## The five most valuable missing tests

1. **Web `SyncProvider`** — the merge defect fixed on 7 August lived there
   precisely because nothing tested it.
2. **Offline behaviour** — the product is offline-first and has no offline test.
3. **Keyboard and screen-reader navigation** — contrast and touch targets are
   checked; operability is not.
4. **Destructive restore** — a restore that silently overwrites is exactly the
   class this repo has been bitten by twice.
5. **Coach bench rendering** — before any rebuild, so a rebuild has something to
   be judged against.

## Notes on test integrity

Two checks were found on 7-8 August that **could not fail in CI** — `docs.mjs`
asserted a gitignored build artifact existed (green only on machines that had
run the browser suite), and `migrations-apply.mjs` assumed root and had never
once passed in CI. Both are fixed, and CI now fails if `migrations-apply`
skips. Treat "the suite is green" as a claim to be verified, not a guarantee.
