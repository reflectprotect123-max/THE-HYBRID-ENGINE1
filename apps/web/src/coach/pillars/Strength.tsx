import { PillarBack } from './PillarBack';
import '../coach-redesign.css';

/*
 * Strength progression, lift trends and the strength progression queue were
 * deleted with `@hybrid/engine`'s strength half (CLAUDE.md, 15 August 2026).
 * This pillar had no conditioning or nutrition content of its own — every
 * card, the progression queue and the hard-session budget copy all read
 * strength-only data — so nothing here can be salvaged, and the whole screen
 * is replaced with a placeholder rather than partially gutted.
 *
 * The route (`/coach/strength`, `coach/index.tsx`) and its `checks/screens.mjs`
 * shot stay wired to this component unchanged — CLAUDE.md requires every
 * `/coach` route to keep rendering at both widths, and this still does.
 */
export function Strength() {
  return (
    <div className="rd-content">
      <PillarBack />
      <section className="rd-panel" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
        <h2>Strength is being rebuilt</h2>
        <p className="rd-panel-note">
          The strength trend dashboard is being rebuilt from scratch. Conditioning and nutrition are
          unaffected.
        </p>
      </section>
    </div>
  );
}
