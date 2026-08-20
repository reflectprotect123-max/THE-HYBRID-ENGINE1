import { App } from './App';

/*
 * The root component Metro resolves per platform.
 *
 * `root.web.tsx` — the parity harness's web-only sibling of this file — was
 * deleted on 21 August 2026 with the parity gates: the harness recorded the
 * OLD strength logger's behaviour, and its restore condition ("Phase C ships
 * the new logger") belongs to reflectprotect123-max/strengthside now, where
 * a reference copy of the harness lives under docs/reference/parity-harness.
 * The extensionless `./src/root` import in index.js stays — it resolves here
 * for android/ios exactly as before, and a future web sibling would slot in
 * without touching the release path.
 */
export const Root = App;
