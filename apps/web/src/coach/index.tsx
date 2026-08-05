import { CoachShell } from './CoachShell';

/**
 * Default export so App.tsx can `React.lazy(() => import('./coach'))` — the
 * entire bench is one chunk that athlete navigation never fetches.
 */
export default function Coach() {
  return <CoachShell />;
}
