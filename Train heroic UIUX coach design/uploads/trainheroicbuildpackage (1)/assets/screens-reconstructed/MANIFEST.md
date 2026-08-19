# Reconstructed screens

**These are reconstructions, not captures.** Rebuilt in a headless browser from the
live-DOM measurements in `docs/03-click-by-click.md` plus direct visual observation of the
running app. `_source.html` is the source — edit and re-render rather than retouching PNGs.

Rendered at 1500px wide, DPR 2, in **Poppins** (the app's real typeface, confirmed via
`getComputedStyle`).

| File | Screen | Evidences |
|---|---|---|
| `01-coach-home-expanded.png` | Coach Home, card expanded | 3-state block badge · prescribed-vs-performed diff · KPI dimming |
| `02-scope-dropdown.png` | Scope select open | flat mix of system groups / self / teams, typed by icon |
| `03-calendar-empty.png` | Calendar mode | single-day stepper · empty state copy |
| `04-athletes-list.png` | Athletes list | disabled bulk actions · missing message icon · blank Athlete Type |
| `05-drawer-exercises.png` | Drawer → EXERCISES | Working Max + `ESTIMATED` + PR as `reps@weight` |
| `06-drawer-circuits.png` | Drawer → CIRCUITS | **different column pair** — Most Recent + PR |
| `07-drawer-notes.png` | Drawer → NOTES | one unstructured field, no injury model |
| `08-drawer-account.png` | Drawer → ACCOUNT | **per-athlete lb/kg toggle** |
| `09-coach-plans.png` | Settings → Coach Plans | seat pricing · marketplace seat exemption footnote |
| `10-marketplace-subs.png` | Settings → Marketplace Subscriptions | three commercial models · status badges |
| `11-session-builder.png` | **Session builder** | block category · circuit + Results unit · superset chain · prescription table · Save Prescription · exercise media card |
| `12-metric-enum.png` | Metric column dropdown | **all 20 members** — six of which exist only because unit is baked into identity |
| `13-team-calendar.png` | Team calendar | published vs `UNPUBLISHED` · Publish All · KPI ring row at quarter size · superset rail in a cell |

## Known deviations from the real UI

- **Icons are emoji placeholders.** TrainHeroic uses a custom icon set; swap yours in.
- **Logos/thumbnails are neutral blocks.** Their marks are deliberately not reproduced.
- Avatar images are flat fills.
- Exact spacing is close, not identical — type scale, colours and the 64px rail / 64px bar
  are measured; padding is estimated from the screenshots.
