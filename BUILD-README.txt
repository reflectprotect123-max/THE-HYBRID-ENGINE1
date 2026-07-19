THE Hybrid System — Native Logger + Builder private PWA build

For a quick preview, open index.html in a browser. For install/offline behavior,
serve the package from HTTPS or localhost; browsers do not allow service workers
or PWA installation from file:// URLs.

The app is local-first. "Private" here means the training log stays in the
browser unless you explicitly use an integration or export a backup; it does
not make a public web host private by itself.

Builder
- Logger-style focused workout builder.
- Strength and Conditioning use separate fields.
- Strength supports Sets, Reps, Reps per side, Rep range, AMRAP, %1RM, Seconds,
  For completion, Rest, side, and optional tempo/hold.
- Conditioning supports Minutes, Seconds, Distance, Calories, Rounds, and For
  completion targets.
- Builder has no load/kilos field and no previous-performance panel.

Logger
- Focused set-by-set strength logging with history and autosave.
- Easy aerobic and Intervals have separate result flows.
- Completed sets start the rest timer automatically; manual duration controls,
  workout timer, active-session recovery, and local-first persistence remain enabled.

Native app layer
- Shared mobile-first chrome, safe-area handling, touch-sized controls and reduced-motion support.
- Install prompt, offline status and user-confirmed PWA update refresh.
- Service worker caches only the static app shell; authenticated integration functions are never cached.

Deployment
- Netlify: deploy the contents of the app folder through Git, the Netlify CLI,
  or the Netlify API so `netlify/functions` is included. A static upload does
  not activate server functions.
- Set `APP_BASE_URL`, `APP_SESSION_SECRET`, `WHOOP_CLIENT_ID`, and
  `WHOOP_CLIENT_SECRET` as Netlify environment variables. Register the WHOOP
  callback and webhook URLs under `APP_BASE_URL/.netlify/functions/`.
- Rotate any provider secret that was previously exposed. Never put secrets in
  this ZIP, the browser, or a public repository.
- Local PWA test: run `python3 -m http.server 4173` from the app folder, then visit http://localhost:4173.
- Run `node checks/native-pwa-smoke.mjs` and `node checks/whoop-contract.mjs`
  from the source workspace before packaging.
