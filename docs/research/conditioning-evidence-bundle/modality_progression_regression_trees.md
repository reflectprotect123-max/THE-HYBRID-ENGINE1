# Five-Modality Progression and Regression Trees

These diagrams are the visual companion to `modality_progression_regression_trees.json`. The exact confirmation count and dose changes are configurable product rules, not universal research thresholds.

## Shared state machine

```mermaid
flowchart TD
    A[Screen pain illness setup] -->|unsafe| B[Stop or safety route]
    A -->|ready| C[Run the prescribed session]
    C --> D{Target work and technique completed?}
    D -->|yes| E{Comparable recent exposures stable?}
    E -->|yes| F[Advance one lever]
    E -->|no| G[Repeat for confirmation]
    D -->|borderline| G
    D -->|nonpain failure| H[Repeat or reduce]
    D -->|cardio target but local failure| I[Cardio pass mechanical fail]
    C -->|absent| J[Hold last successful dose]
```

## Running

```mermaid
flowchart TD
    A[Impact and gait screen] -->|fail| B[Stop or refer]
    A -->|pass| C[Walk-run or easy duration]
    C --> D{Form and symptoms stable?}
    D -->|no pain| E[Repeat or shorten bouts]
    D -->|yes| F[Add duration or reduce walk]
    F --> G[Threshold/cruise work]
    G --> H{Pace and form stable?}
    H -->|no| I[Repeat or regress]
    H -->|yes| J[VO2 intervals, one lever]
```

## Rowing

```mermaid
flowchart TD
    A[Back rib shoulder hip screen] -->|fail| B[Stop or reduce]
    A -->|pass| C[Low-rate technique]
    C --> D{Sequence and posture stable?}
    D -->|no pain| E[Shorter pieces, repeat]
    D -->|yes| F[Steady duration and distance]
    F --> G[Medium and high-rate pieces]
    G --> H{Pace and technique stable?}
    H -->|no| I[Reduce rate/work]
    H -->|yes| J[Optional trained-athlete test]
```

## SkiErg / Nordic

```mermaid
flowchart TD
    A[Shoulder elbow rib lumbar screen] -->|fail| B[Stop or reduce]
    A -->|pass| C[Hinge and finish technique]
    C --> D{Upper-body technique stable?}
    D -->|no pain| E[Short easy pieces]
    D -->|yes| F[Steady duration/distance]
    F --> G[Hard/easy intervals]
    G --> H{Local fatigue changes technique?}
    H -->|yes| I[Reduce work or reps]
    H -->|no| J[Progress one interval lever]
```

## Conventional cycling

```mermaid
flowchart TD
    A[Fit pain illness screen] -->|fail| B[Stop or refit]
    A -->|pass| C[Easy consistency]
    C --> D{Cycling benchmark known?}
    D -->|no| E[Use duration RPE cadence]
    D -->|yes| F[Use protocol-specific FTP zones]
    E --> G[Controlled tempo]
    F --> G
    G --> H[Threshold then VO2]
    H --> I{Power and RPE stable?}
    I -->|no| J[Repeat or reduce]
    I -->|yes| K[Progress one lever]
```

## Combined arm-and-leg air bike

```mermaid
flowchart TD
    A[Setup pain symptom screen] -->|fail| B[Stop or safety route]
    A -->|pass| C[Easy handles plus pedals]
    C --> D{Rhythm trunk and shoulders stable?}
    D -->|no pain| E[Familiarise, shorten, repeat]
    D -->|yes| F[Steady duration and RPE]
    F --> G{Threshold anchor available?}
    G -->|no| H[Controlled hard work by RPE/output]
    G -->|yes| I[Device-specific threshold work]
    H --> J[Intervals: reps work recovery]
    I --> J
    J --> K{Cardio target but local failure?}
    K -->|yes| L[Mechanical fail: repeat or reduce]
    K -->|no| M{Output and technique stable?}
    M -->|no| L
    M -->|yes| N[Progress one lever]
```

## Air-bike benchmark gate

```mermaid
flowchart TD
    A[Same model and console?] -->|no| B[Rebaseline; do not compare]
    A -->|yes| C[Familiarisation complete?]
    C -->|no| D[Submaximal onboarding]
    C -->|yes| E{Test type}
    E -->|ramp or VO2peak| F[Device-specific lab or staged protocol]
    E -->|5/10 min or distance| G[Personal same-device time trial]
    E -->|sprint or Wingate-style| H[Label nonstandard; same-device only]
    F --> I[Store raw protocol and device metadata]
    G --> I
    H --> I
```
