# Electron desktop wrap

## Problem

The only way to run THE Hybrid System on a Windows desktop today is a browser tab (or the PWA's "Install app" shortcut, which is still just a browser frame). The user wants a real `.exe` installer with its own taskbar identity.

## Goal

A new `apps/desktop` package that wraps the existing, already-deployed web app in Electron and packages to a Windows `.exe` installer. No changes to `apps/web`, `apps/mobile`, or any `packages/*` — this is purely a new, additive package.

## Non-goals

- No system-tray always-on-top mini widget (set/rest timer, HR ring). Explicitly deferred — separate future request.
- No bundled/offline static build. The window loads the live deployed site over the network.
- No macOS/Linux packaging target. Windows `.exe` only, per what was asked.
- No code-signing. No certificate exists; the installer ships unsigned, and Windows SmartScreen will show an "unknown publisher" warning on first run. This is expected, not a defect to chase in this pass.
- No change to how WHOOP/Concept2 OAuth works. See Known Limitation below — accepted as-is for this pass.

## Design

### Why remote-URL, not a bundled build

Checked the actual server dependency first: WHOOP and Concept2 integrations (`netlify/functions/whoop-*.mjs`, `concept2-*.mjs`) are real Netlify serverless functions, called via relative, same-origin `fetch()` (`apps/web/src/cloud/whoop.tsx`, `concept2.tsx`). A bundled static build loaded from `file://` would need every one of those calls rewritten to an absolute production URL, plus the PWA service worker disabled (it doesn't work from `file://` either). Pointing the Electron window at the already-deployed site (`https://thehybridengine1.netlify.app` — confirmed the only live deployment; `README.md:175` and the OAuth callback URLs registered with WHOOP/Concept2 all point at this one origin) means every one of those calls stays same-origin exactly as it is today. Zero code changes to `apps/web` or the functions. Confirmed via `apps/web/src/product.ts` and the earlier product-partition work that this one deployment already shows both strength and conditioning data — there is no "which product" decision to make here.

### `apps/desktop` package layout

- `apps/desktop/package.json` — `electron`, `electron-builder` as devDependencies. Scripts: `start` (launch for local smoke-testing), `dist` (electron-builder package).
- `apps/desktop/src/main.ts` — the entire main process. Creates one `BrowserWindow` (sensible default size, e.g. 1280x860, resizable), calls `win.loadURL('https://thehybridengine1.netlify.app')`. `webPreferences` left at Electron's secure defaults: `contextIsolation: true`, `nodeIntegration: false`. No preload script — nothing native is exposed to the page, so there's nothing for a preload to bridge.
- `apps/desktop/build/icon.ico` — converted from `apps/web/public/icons/icon-512.png` (the existing PWA icon) via a one-time `png-to-ico` conversion step, committed as a binary asset like the existing PWA icons are.
- `apps/desktop/electron-builder.yml` — `appId`, `productName: "THE Hybrid System"`, `win.target: nsis`, `icon` pointing at the `.ico` above.

### Known limitation: OAuth address-bar visibility

`netlify/functions/whoop-connect.mjs` and `concept2-connect.mjs` both carry a comment: the handshake "has to happen in the address bar where the athlete can see who they are trusting." A default `BrowserWindow` has no address bar. This wrap does not fix that — WHOOP and Concept2 do not block embedded webviews the way Google does, so the OAuth flow still functions, but the user loses visibility into which domain they're authenticating against mid-flow. The real fix (hand the OAuth URL to the system browser via `shell.openExternal`, register a custom URL scheme for the callback to hand control back to the app — the same pattern the mobile app already uses for its native OAuth return) is real additional scope and is called out here as a candidate follow-up, not built in this pass.

### CI: build + verification

New `.github/workflows/desktop-build.yml`, manual `workflow_dispatch` only (matches `mobile-eas.yml`'s pattern), runs on `windows-latest` (a real Windows runner is required for `electron-builder`'s NSIS target to produce a working installer). Steps: checkout, install workspace deps, `pnpm --filter @hybrid/desktop dist`, upload the produced `.exe` as a workflow run artifact via `actions/upload-artifact`.

There is no Windows GUI in this environment to run the installer or the packaged app — verification is necessarily a real human step: dispatch the workflow, download the artifact from the run page, install it on an actual Windows machine, confirm the window opens, loads the real site, and behaves like the browser version (sign-in, sync, a WHOOP/Concept2 connect attempt if the user wants to check the OAuth flow specifically).

## Testing

There is no meaningful automated test for "does an Electron window load a URL correctly" beyond a typecheck of `main.ts` — this is a thin config/wiring package, not logic. No new unit tests are added; `pnpm --filter @hybrid/desktop` gets a `typecheck` script matching the monorepo's convention, run in CI before the package step. The real verification is the manual Windows install-and-launch check above.
