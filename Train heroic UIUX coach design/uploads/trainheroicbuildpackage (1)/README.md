# TrainHeroic → Build Package

A teardown of TrainHeroic (coach + athlete surfaces, August 2026) and a proposed data
model for a strength-training app that removes TrainHeroic's central constraint.

---

## Read this first

**`index.html` already works.** It is a single self-contained file — no build step, no
dependencies, no network calls. Open it in any browser and it renders, in light or dark,
with a working interactive chart.

You do **not** need a coding agent to "rebuild" it. Hand this bundle to one only if you
want to *extend, restyle, port, or split* it. `REBUILD.md` covers that case.

---

## Contents

```
index.html                    the visual package — 19 sections, self-contained, works as-is
README.md                     this file
REBUILD.md                    instructions for a coding agent

docs/
  01-deep-dive.md             athlete logging flow · analytics math · schema rationale
  02-spec-addendum.md         machine-readable: architecture, enums, decision matrix, build order
  03-click-by-click.md        interaction flow, measured design tokens, six-host map, commercial model

src/
  schema.sql                  the proposed Postgres schema — 10 tables, runnable
  metrics-seed.csv            metric registry seed rows
  enums.json                  every verified TrainHeroic enum, exact strings
  chart-data.json             NSCA load chart + e1RM formulas
  tokens.css                  design tokens (validated palette, light + dark)

assets/screens/               reference renders of key sections, both themes
```

---

## Confidence markers — respect these

The documents use three markers, and they are load-bearing. Do not let an agent flatten them.

| Marker | Meaning |
|---|---|
| **[V] VERIFIED** | Observed directly in the live coach app, or quoted from official TrainHeroic support docs |
| **[I] INFERRED** | Reasoned from observed behaviour. Plausible, not stated by TrainHeroic |
| **[U] UNKNOWN** | Genuinely undocumented. Searched official docs, blog, forums, review sites — no public source exists |

**Specifically:** TrainHeroic's formulas for Volume, Intensity, Compliance, StackUp and
percentage rounding are all `[U]`. The formulas proposed in `docs/` are **mine**, not
theirs. Do not let anything in this bundle be cited as "how TrainHeroic does it".

**Also read `docs/03-click-by-click.md` → "Unverified claims".** A handful of statements —
most notably the *Parent Calendars 7/10 "steal this"* rating and the six Analytics report
families — rest on menu labels and hub tiles rather than direct observation. They read like
findings and are not. That section lists every one.

---

## The one thing that matters

TrainHeroic models a prescribed set as a **fixed-arity row**: `[set_count][param_1][param_2]`.
Two metrics. Hard stop.

Every limitation documented here descends from that: no tempo, no rest-as-data, no
reps+load+RPE together, units baked into metric identity, and conditioning with nowhere
to live except a free-text field that produces zero analysable data.

`src/schema.sql` replaces it with an open bag of typed metrics. If you take one thing
from this bundle, take that. It is cheap now and genuinely unfixable later.

---

## Scope and limits — stated plainly

- The UI reconstructions in `index.html` §A3 are **layout-faithful, not byte-identical**.
  They were rebuilt from screenshots without access to TrainHeroic's source, fonts or
  assets, and carry neutral branding deliberately.
- Section A4 (their data model) is **inferred** from UI affordances and endpoint shapes.
  I have not seen TrainHeroic's actual schema.
- Part D is a **proposal**, not a reconstruction.
- Copying a competitor's interface closely carries trade-dress and design-patent risk.
  Copy the *layout logic* — it is genuinely good. Do not copy the *data model*.

---

## Sources

Direct inspection of a live TrainHeroic coach account (August 2026), plus:

- <https://support.trainheroic.com/hc/en-us/articles/18170920165645-Testing-and-Updating-Athletes-Maxes>
- <https://support.trainheroic.com/hc/en-us/articles/18171015485837-Updating-Your-Working-Maxes>
- <https://support.trainheroic.com/hc/en-us/articles/18156547276557-Athlete-Pro-Readiness>
- <https://support.trainheroic.com/hc/en-us/articles/18156762137741-Analytics-for-Lifts-and-Working-Maxes>
- <https://support.trainheroic.com/hc/en-us/articles/18156702628621-Viewing-Compliance-Analytics>
- <https://support.trainheroic.com/hc/en-us/articles/18156555844237-Athlete-Pro-StackUp>
- <https://www.nsca.com/contentassets/61d813865e264c6e852cadfe247eae52/nsca_training_load_chart.pdf>
