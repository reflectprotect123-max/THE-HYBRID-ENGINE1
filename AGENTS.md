# AGENTS.md

See [`README.md`](README.md) for the product overview and [`CLAUDE.md`](CLAUDE.md)
for the operating contract and architecture decisions. Standard commands live in
the root [`package.json`](package.json) scripts and
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). This file only records
non-obvious things a fresh session cannot infer from those.

## Cursor Cloud specific instructions

Environment: Node 22 and `pnpm@10.33.0` are preinstalled and match the repo's
`packageManager`/`engines`. The startup update script runs `pnpm install`, so a
fresh Cloud VM already has dependencies installed — do not re-run install unless
a lockfile changed.

### Services and how to run them

- **Coach web workspace (`apps/web`)** is the browser-runnable product. Start it
  with `pnpm run dev:web` (Vite on `http://localhost:5173`; the app lives under
  `/coach`). It is local-first — data persists in the browser's `localStorage`,
  no backend needed for authoring.
- **Athlete app (`apps/mobile`)** is an Expo/React Native Android app that needs
  an Android emulator/device and a **custom Expo dev client** (native modules:
  BLE heart rate, camera barcode, ML Kit label OCR, maps). It cannot be run in
  this Cloud VM. Its code is still verified here through `pnpm run typecheck` and
  `pnpm run test` (Jest). Do not try to boot Metro/an emulator to "prove" mobile.

### Non-obvious gotchas

- **`/coach` (the Command Center) shows "Loading coach workspace…" forever when
  signed out.** This is by design, not a bug: the client roster requires an
  authenticated Supabase session, and signed-out `listClients()` returns empty.
  To exercise the app offline, go straight to **`/coach/library`** and open a day
  (`/coach/day/:date`) — the Library calendar and the DayBuilder render without a
  client and are the local-first authoring surface. Authoring a session there
  writes an engine `Workout` to `localStorage` and it appears back on the
  calendar. This is the simplest end-to-end smoke of the coach product.
- To make the Command Center and pillar screens render, sign in from
  `/coach/settings` against the hosted Supabase (`packages/config`). Signup
  auto-confirms (`mailer_autoconfirm`), but the client list only refreshes after
  a page reload because the fetch is keyed on the repository, not on auth state.
- In dev the coach access gate fail-opens (`coachAllowed(..., isDev=true)`), so
  no allowlist/login is needed to reach `/coach/*` routes.

### Lint / test / build

- There is **no ESLint and no `lint` script**. The "lint" role is filled by
  `pnpm run typecheck` plus the `checks/*.mjs` contract suite.
- `pnpm run verify` is the CI-equivalent gate that needs no browser. Browser and
  mobile-parity checks are CI-only (Playwright / Expo export) — see the comments
  in `.github/workflows/ci.yml` for what runs where and why.
- `pnpm run verify` includes `node checks/migrations-apply.mjs`, which needs a
  local Postgres (with `pgvector`). On a VM without Postgres it prints
  `SKIP — no local postgres` and passes locally; CI installs Postgres+pgvector
  and treats that skip as a failure. Don't add Postgres just to satisfy it locally.
- `pnpm install` reports ignored build scripts for `dtrace-provider` and
  `tesseract.js` (mobile-only native deps). This is expected and harmless for web
  dev; do not run the interactive `pnpm approve-builds`.
