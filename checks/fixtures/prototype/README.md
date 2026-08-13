# The prototype is the specification

`rolling-logger.html` in this directory is not a demo and not a design
reference to eyeball — it is the specification the rebuilt round-major logger
is measured against. The parity checks load this file as their baseline: they
drive it and the rebuilt app through identical steps and diff the results.
Where this file and the app disagree, the app is wrong, not the fixture.

## `data-parity` is a contract, not decoration

Every `data-parity="..."` attribute in this file is a hook a shared parity
script uses to drive both the prototype and the rebuilt app through the same
steps without a per-target adapter. The vocabulary — the exact set of hook
values and what each one means — binds the app too: the rebuilt logger must
expose the same hooks, on elements that mean the same thing, for the parity
checks to compare anything at all. The full list, with the meaning of each
value:

| value | on | meaning |
| --- | --- | --- |
| `add-block` | button | start adding a block |
| `kind-warm`, `kind-lift`, `kind-ss`, `kind-cool` | button | choose a block kind |
| `name` | text input | the name field on the current step |
| `equip-barbell`, `equip-dumbbell`, `equip-machine`, `equip-bodyweight` | button | equipment choice |
| `scheme-straight`, `scheme-ladder`, `scheme-custom` | button | set-shape choice |
| `next` | button | advance the builder |
| `back` | button | go back a step |
| `add-piece` | button | add a warm-up/cool-down piece |
| `done-block` | button | commit the block being authored |
| `start` | button | leave the builder, begin the session |
| `hot-name` | element | the live card's movement or set name |
| `hot-presc` | element | the live card's prescription line |
| `hot-why` | element | the coaching message |
| `hot-kg` | element | the live card's weight |
| `reps-up`, `reps-down` | button | rep stepper |
| `rpe-7`, `rpe-75`, `rpe-8`, `rpe-85`, `rpe-9`, `rpe-95`, `rpe-10` | button | rating chips (dot removed from the value) |
| `log` | button | log the set |
| `grip` | button | the superset rotate handle |
| `seg-0`, `seg-1`, … | button | block strip segments, by index |
| `rest-dial` | element | the rest countdown |
| `rest-go` | button | leave the rest takeover |
| `receipt-0`, `receipt-1`, … | element | logged set receipts, by index |

`docs/superpowers/specs/2026-08-12-round-major-logger-design.md` is the
design document this prototype implements; its header points at both the
hosted prototype and this in-repo copy.

Do not treat these attributes as styling hooks, test IDs invented on the fly,
or anything else free to rename. Adding, removing, renaming, or moving a
`data-parity` value changes the contract on both sides at once.

## Editing this file changes what "correct" means

This file was copied in byte for byte from the design exploration, with only
`data-parity` attributes added on top — no reformatting, no rewritten
comments, no behavioural changes. The comments throughout the file are load
-bearing: they record why a decision was made (why `clip` and not `hidden` on
the carousel stage, why the rest dial suppresses a dead `0:00`, why the grip
alone owns pointer events), and stripping them would lose that record even
though the markup would still render the same.

Because this file defines what "correct" looks like for the rebuild:

- It is edited only as a deliberate design decision — the design changes, so
  the specification changes to match.
- It is never edited to make a failing parity check pass. If the app and the
  prototype disagree, fix the app. Editing the fixture to agree with a buggy
  rebuild silently redefines the target and defeats the entire point of
  having a gate.
- Any edit should be reviewed as a spec change, not as a fixture tweak.

## Where this came from

The prototype originally lived only at an ephemeral scratchpad path with no
guarantee of surviving past a single working session. A gate whose reference
can vanish is not a gate, so this copy exists to make the specification a
durable, versioned part of the repository.
