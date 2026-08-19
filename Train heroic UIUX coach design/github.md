repo: reflectprotect123-max/THE-HYBRID-ENGINE1
branch: main
path: apps/web/src/coach

## Last sync
date: 2026-08-18T19:11:35Z

### Updated in this project
- Built `ARC.dc.html` grounded in the real coach app source (tokens.css palette, coach-redesign.css structure).
- Rebuilt Command Center, Readiness (WHOOP gauge + trend cards), Conditioning (progression queue, zone bar, HR donut, erg trend), Library (month calendar with hover actions), and the Day Builder — using the current block model (Conditioning/Mixed modal/Warm-up/Cooldown/Mobility; strength/superset authoring was deleted from the real app on 17 Aug 2026, so it is not present here either).
- Coach Progression and Coach Settings screens not yet built — broad-coverage pass stopped after the four screens above; can extend.

## Screen map
| Screen (ARC.dc.html) | Repo source |
|---|---|
| Command Center | apps/web/src/coach/screens/CoachCommandCenter.tsx |
| Readiness | apps/web/src/coach/pillars/Readiness.tsx |
| Conditioning | apps/web/src/coach/pillars/Conditioning.tsx |
| Library / Calendar | apps/web/src/coach/screens/CoachLibrary.tsx, apps/web/src/coach/library/CalendarMonth.tsx |
| Day Builder | apps/web/src/coach/library/BlockEditor.tsx |
| Palette / tokens | packages/design/src/tokens.css |
