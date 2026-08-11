import { Link } from 'react-router-dom';

/** The mockup's `.rd-back` control, shared by all four pillar screens. */
export function PillarBack() {
  return (
    <Link to="/coach" className="rd-back">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      Command Center
    </Link>
  );
}
