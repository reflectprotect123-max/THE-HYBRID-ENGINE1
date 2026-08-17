# THE Hybrid Engine — adaptive-layer evidence bundle

**Research date:** 1 August 2026  
**Scope:** A local-first, deterministic strength-and-conditioning rules engine. No AI model is assumed.  
**Purpose:** Evidence for the eight proposed adaptive mechanisms, with a clear boundary between tested evidence, adjacent evidence, coaching precedent, and engineering choice.

## High-Level Overview

### Executive verdict

The evidence supports building a controlled adaptive layer, but it does **not** support pretending that the common thresholds already used in training software are validated science.

The strongest defensible conclusions are:

- RPE/RIR is a useful, conditionally valid input for load prescription, especially for familiar exercises, trained users, and sets close to failure. It is not perfectly accurate, and comparative studies do not establish that RPE/RIR is universally superior to fixed percentages.
- Deloads are common coaching practice, but no study located here validates “two missed sessions,” “three failed sets,” or any other universal consecutive-failure trigger. Exact deload timing, duration, and dose remain under-researched.
- Reliability science supports estimating measurement error and treating small changes as uncertain. It does not provide a universal number of logged sessions or a universal trailing window for e1RM or volume trends.
- HRV can sometimes help redistribute endurance training, but evidence for same-day strength-load modulation is small and mixed. HRV is not a direct measure of local muscle, tendon, pain, technique, or injury readiness.
- Short training breaks do not imply a validated percentage reduction. A return after a layoff should be a conservative calibration exposure, not an automatic “one week off equals 10% down” formula.
- Pain-monitoring evidence is useful in specific rehabilitation conditions, especially tendinopathy, but it does not validate a general traffic-light model or a universal pain threshold for recreational training.
- Uncertainty communication is evidence-informed as a discipline of calibration, transparency, data coverage, and action-linked abstention. A generic confidence percentage or red/amber/green badge is not itself validated.
- MacroFactor and Juggernaut/RTS provide valuable product and coaching precedent. Their public documentation does not validate THE Hybrid Engine, and the proprietary portions of their algorithms cannot be reproduced from the public material.

### Evidence hierarchy used for every claim

1. **Peer-reviewed direct evidence:** a study on the exact population and mechanism in question.
2. **Peer-reviewed adjacent evidence:** informs the mechanism but is not directly transferable to the proposed app rule.
3. **Established coaching methodology:** a named, published or creator-documented system such as RTS, the Juggernaut Method, or DUP. This is practice precedent, not proof.
4. **Product-design convention:** an explicit engineering choice made because direct evidence is thin, such as a hold state, conservative gate, or data-completeness policy.

“Not found” means that this review did not find a source validating the exact rule. It does not prove that no unpublished or inaccessible study exists.

### Decision summary

| Mechanism | Evidence status | Safe interpretation for the app |
|---|---|---|
| 1. RPE/RIR load prescription | Moderate, conditional | Use RPE/RIR as a load-adjustment input with an uncertainty flag; do not claim superiority over percentages. |
| 2. Deload and repeated-failure thresholds | Sparse for deload efficacy; exact thresholds not found | Use repeated, corroborated deterioration rather than a universal miss count; label any count as a product heuristic. |
| 3. Minimum data for trends | Reliability principles supported; exact window not found | Estimate individual error, standardize exposures, and hold when the data cannot distinguish signal from noise. |
| 4. HRV/recovery modulation | More support in endurance than strength; HRV-only gate unsupported | Use HRV as one advisory signal, never as an autonomous safety or tissue-readiness oracle. |
| 5. Return after layoff | Detraining effects are duration-, population-, and modality-dependent | Use a conservative re-entry session and observe current RPE/performance; no universal percentage formula. |
| 6. Pain versus fatigue | Narrow rehab evidence; general app rule not validated | Separate pain from exertional fatigue, stop or modify safely, and block automatic progression until the symptom state is clarified. |
| 7. Confidence and uncertainty | Communication/calibration principles supported; specific UI not validated | Show what is estimated, the evidence window, missing data, reasons, and the action taken; abstain when uncertainty matters. |
| 8. Juggernaut/RTS and MacroFactor | Strong precedent; not independent validation | Borrow the feedback-loop pattern, not their marketing claims or undisclosed equations. |

## Deep Dive Analysis

### 1. RPE/RIR-based autoregulation for load prescription

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| RPE/RIR tracks proximity to failure and relates to load or velocity. | In trained and novice squatters, the resistance-specific scale showed strong relationships between velocity and perceived effort. Similar acute relationships have been reported in powerlifters and bench press samples. This supports concurrent validity, not perfect knowledge of the “true” remaining repetitions. | Accept RPE/RIR as a structured input for familiar exercises. Store exercise, load, reps, set position, and whether the set was near failure. | **Peer-reviewed direct evidence.** Zourdos et al. (2016), *Journal of Strength and Conditioning Research*, n=29; Helms et al. (2017), *JSCR*, n=15; Ormsbee et al. (2019), *JSCR*, n=27. [Zourdos DOI](https://doi.org/10.1519/JSC.0000000000001049), [Helms DOI](https://doi.org/10.1519/JSC.0000000000001517), [Ormsbee DOI](https://doi.org/10.1519/JSC.0000000000001901) |
| RPE/RIR can produce repeatable load prescriptions in some lifters. | Small repeated-measures studies found good repeatability when participants were trained or familiarized, but repeatability is not the same as objective accuracy. | Track user-specific RPE bias over time. Do not assume that a new user’s RPE 8 has the same meaning as a trained user’s RPE 8. | **Peer-reviewed direct evidence.** Helms et al. (2017), *JSCR*, n=12; Lovegrove et al. (2022), *JSCR*, n=15. [Helms DOI](https://doi.org/10.1519/JSC.0000000000002097), [Lovegrove DOI](https://doi.org/10.1519/JSC.0000000000003952) |
| RIR estimates are less reliable when many repetitions remain or the exercise/set is unfamiliar. | Participants can misjudge how many repetitions remain. Accuracy generally improves nearer failure and with experience; pooled evidence is heterogeneous. | For high-repetition, novel, technically complex, or low-confidence sets, use RPE/RIR as advisory and require performance, technique, symptoms, or completion data before progressing. | **Peer-reviewed adjacent evidence.** Mansfield et al. (2020), n=20; Hughes et al. (2020), n=21; Steele et al. (2017), n=141; Halperin et al. (2022), 16 publications and 414 participants in the exploratory meta-analysis. [Mansfield DOI](https://doi.org/10.1519/JSC.0000000000003779), [Hughes DOI](https://doi.org/10.1519/JSC.0000000000003865), [Steele DOI](https://doi.org/10.7717/peerj.4105), [Halperin DOI](https://doi.org/10.1007/s40279-021-01559-x) |
| RPE/RIR is superior to fixed percentages for long-term strength. | Some trials favor RIR, but the RIR groups often trained at a higher achieved intensity. Other trials show no between-group difference. Meta-analyses do not establish a clear RPE-specific advantage. | Do not make “RPE is scientifically superior” a product claim. Support both percentage-based and RPE/RIR-based prescriptions, with RPE/RIR allowed to correct stale 1RM estimates and day-to-day variation. | **Peer-reviewed direct and adjacent evidence is mixed.** Helms et al. (2018), *Frontiers in Physiology*, n=21, found no significant between-group strength or hypertrophy difference; Graham & Cleather (2021), *JSCR*, n=31, favored RIR but with higher achieved intensity; Hickmott et al. (2022), 15 studies, and Zhang et al. (2021), 8 studies/166 athletes, do not establish RPE superiority. [Helms full text](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2018.00247/full), [Graham DOI](https://doi.org/10.1519/JSC.0000000000003164), [Hickmott DOI](https://doi.org/10.1186/s40798-021-00404-9), [Zhang full text](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2021.651112/full) |
| RPE/RIR can be the primary within-session adjustment signal. | The literature supports it conditionally, not universally: the strongest transfer is to familiar resistance exercises in trained users and sets within a modest distance of failure. | Use it as the primary *within-session* adjustment input where the context is familiar and data quality is adequate; require corroboration for high-rep, novel, painful, or technically unstable work. | **Peer-reviewed adjacent evidence translated into a product rule.** The conditional boundary is evidence-informed; the exact app routing is **Product-design convention**. |

#### Counterpoints and evidence gaps

- Fixed percentages are not automatically more objective: a stale 1RM and changing daily readiness can make a percentage misleading.
- RPE/RIR is not automatically subjective noise: it can be repeatable and useful, but the user’s calibration must be learned.
- The evidence base is concentrated in trained men, powerlifters, laboratory protocols, and familiar exercises. It does not prove the same performance for recreational adults, mixed-modality sessions, pain-affected movements, or unsupervised beginners.
- No direct study located here validates a complete deterministic rule such as “RPE 7 for two sessions means add 2.5%.” The adjustment size and exposure count remain product choices.
- No direct study located here validates a universal RPE/RIR mapping across all exercises, rep ranges, modalities, devices, or users.

### 2. Deloading and repeated-failure thresholds

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| A fixed number of consecutive missed sessions or failed sets is a validated trigger. | No study located here validates “two misses,” “three failed sets,” or any universal `N` before reducing load or entering a deload. | If the app uses a count, call it a configurable product trigger. Prefer repeated deterioration that exceeds expected measurement error and is corroborated by fatigue, pain, readiness, or technique data. | **Not found. Product-design convention only.** The exact threshold is unsupported by the reviewed evidence. |
| Training to failure creates fatigue and short-term performance impairment. | Meta-analytic evidence supports acute fatigue and performance costs from failure training, but it does not convert those effects into a multi-session deload threshold. | Use failure exposure as one fatigue-context feature, not as a standalone automatic deload trigger. | **Peer-reviewed adjacent evidence.** Vieira et al. (2022), systematic review/meta-analysis. [PubMed](https://pubmed.ncbi.nlm.nih.gov/34881412/) |
| Deloads are commonly used every four-to-eight weeks for about a week. | A survey of 246 competitive strength and physique athletes reported typical deloads of 6.4 ± 1.7 days every 5.6 ± 2.3 weeks. It describes practice, not optimal timing or causal benefit. | Treat 5–7 days and roughly 4–8 weeks as plausible starting parameters only when a programme needs a scheduled recovery microcycle; expose them as configurable and testable. | **Peer-reviewed adjacent evidence.** Rogerson et al. (2024), *Sports Medicine–Open*, n=246. The authors explicitly call for empirical evaluation. [Full text](https://link.springer.com/article/10.1186/s40798-024-00691-y) |
| Expert consensus supports deloading as a reduction in training stress to manage fatigue and preparedness. | Consensus defines the practice and offers terminology; consensus cannot establish that one timing, load reduction, or volume reduction is optimal. | Encode a deload as a state that reduces training stress while preserving the session purpose where safe. Do not present consensus as efficacy evidence. | **Established coaching methodology / peer-reviewed consensus.** Bell et al. (2023), international Delphi consensus. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/) |
| A planned deload at a particular point preserves adaptation. | A 2026 within-subject study in 19 untrained young men found that a specific deload arrangement during weeks 4 and 8 did not hinder hypertrophy or 10RM strength-endurance. It did not test trained athletes, reactive triggers, mixed modalities, or the best timing. Other studies have found different strength outcomes. | Use the study as narrow reassurance that a particular planned reduction need not erase progress—not as a universal deload schedule. | **Peer-reviewed direct evidence, narrow population and protocol.** Pancar et al. (2026), *Scientific Reports*, n=19. [Full text](https://www.nature.com/articles/s41598-026-40612-5); see also Coleman et al. (2024), *PeerJ*, [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/) |

#### Counterpoints and evidence gaps

- “Deload” is not one intervention: it can reduce sets, repetitions, load, effort, frequency, or some combination. Studies that use different definitions cannot answer the same question.
- A scheduled deload and a reactive response to repeated failures are different mechanisms.
- Reducing training because of pain is not the same as deloading for accumulated fatigue; pain may require a safety or clinical pathway.
- The exact frequency, duration, and magnitude of deloading remain unresolved. No dose-response study located here establishes an optimal rule for recreational adults.
- A “two missed sessions” rule may be useful for a product’s workflow, but it must be labelled as a conservative operational heuristic, not a physiological threshold.

### 3. Minimum data before trusting a trend

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| There is a universal minimum number of observations before trusting e1RM or volume trends. | No universal session count or trailing window was found. The correct amount depends on measurement error, sampling frequency, exercise consistency, missingness, and the size of change that matters. | Store the data needed to estimate within-user error and declare the lookback window in the engine version. Return “insufficient evidence” when the observed change is not distinguishable from error. | **Not found. Peer-reviewed adjacent reliability guidance does not establish a universal app threshold.** Hopkins (2000); Atkinson & Nevill (1998). [Hopkins](https://pubmed.ncbi.nlm.nih.gov/10907753/), [Atkinson & Nevill](https://pubmed.ncbi.nlm.nih.gov/9820922/) |
| Reliability statistics can inform whether a change is meaningful. | Typical error, standard error of measurement, coefficient of variation, limits of agreement, and minimum detectable change are more informative than a raw correlation alone. | For each exercise or metric, estimate repeatability where data allow; suppress automatic progression when change is smaller than the estimated error band. | **Peer-reviewed adjacent evidence.** Hopkins (2000), *Sports Medicine*; Atkinson & Nevill (1998), *Sports Medicine*. |
| 1RM/e1RM reliability is transferable across exercises and populations. | Reliability varies with exercise, method, loading, standardization, population, and familiarity. A reliable laboratory 1RM protocol does not validate a universal app-derived e1RM formula. | Keep e1RM modality- and exercise-specific. Record formula/version, reps, load, RPE/RIR, technique/context, and whether the set was valid for trend use. | **Peer-reviewed adjacent evidence.** Grgic et al. (2020), systematic review of 1RM reliability. [PubMed](https://pubmed.ncbi.nlm.nih.gov/32681399/) |
| A three-point moving average proves a three-session trend window. | Moving averages can reduce noise in a particular measurement context, but a three-point average studied for a specific resistance-training signal is not a universal longitudinal e1RM rule. | Use a declared smoothing function as a product parameter, validate it against historical replay and user-level error, and expose the number and quality of observations behind a decision. | **Peer-reviewed adjacent evidence.** Chiu & Salem (2010) studied a specific three-point moving-average context. [DOI](https://doi.org/10.1519/JSC.0b013e3181bd452e) |
| Two or three successful comparable exposures are enough to trust progression. | No direct source located here validates “two,” “three,” or “3–5” exposures as a universal minimum for e1RM or volume trends. | Keep 2–3 or 3–5 exposures only as a transparent, configurable product confirmation heuristic. Mark the resulting confidence as heuristic, not scientifically validated. | **Product-design convention.** Evidence gap explicitly retained. |

#### Counterpoints and evidence gaps

- More data do not automatically mean better data if the exercise, range of motion, device, rest interval, or technique changes.
- A short window reacts quickly but is noisy; a long window is stable but can hide a genuine change. This is a control-system trade-off, not a known physiological constant.
- A trend threshold should be tied to the decision cost. A small uncertain improvement may justify “hold,” while a suspected safety deterioration may justify a conservative reduction immediately.
- No validated universal minimum exists for mixed strength/conditioning data, wearable data, device-derived power, or self-reported RPE.

### 4. Recovery and HRV-based same-day load modulation

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| HRV-guided training can improve training distribution or endurance outcomes in some users. | Systematic reviews and individualized endurance trials report modest or inconsistent benefits. They support the possibility of redistributing hard exposures, not a universal readiness detector. | Use HRV to inform whether a high-intensity session should be offered, held, or replaced with an easier version only in combination with context and performance data. | **Peer-reviewed adjacent evidence, with some direct endurance evidence.** Bellenger et al. (2016), 27 studies/24 in meta-analysis; Manresa-Rocamora et al. (2021), 199 participants; Kiviniemi et al. (2007), n=26; Vesterinen et al. (2016), n=31. [Bellenger DOI](https://doi.org/10.1007/s40279-016-0484-2), [Manresa DOI](https://doi.org/10.3390/ijerph181910299), [Kiviniemi DOI](https://doi.org/10.1007/s00421-007-0552-2), [Vesterinen DOI](https://doi.org/10.1249/MSS.0000000000000910) |
| HRV-only modulation is superior for strength training. | Small strength studies do not establish superiority. Examples include a trial in 20 young men and a trial in 21 older women reporting no clear HRV-guided advantage for strength, hypertrophy, or function. | Do not allow HRV alone to increase load, volume, intensity, or exercise risk. An isolated low HRV should usually produce an uncertainty flag, not an automatic demotion; a corroborated deterioration can cap intensity. | **Peer-reviewed direct evidence is limited and mixed.** de Oliveira et al. (2019), n=20, [DOI](https://doi.org/10.1080/17461391.2019.1572227); Bittencourt et al. (2024), n=21, [DOI](https://doi.org/10.3389/fphys.2024.1472702) |
| HRV is a direct measure of local muscle, tendon, pain, or injury readiness. | HRV reflects autonomic regulation and is affected by measurement protocol, sleep, illness, stress, posture, breathing, and other factors. It did not distinctly track local strength recovery or creatine kinase in a small resistance-exercise study. | Never use HRV as a medical, injury, or tissue-capacity gate. Keep pain, symptoms, technique, performance, and user-reported recovery as separate fields. | **Peer-reviewed adjacent evidence.** Thamm et al. (2019), n=10 trained men; Bellenger et al. (2016). [Thamm DOI](https://doi.org/10.3390/ijerph16224353) |
| Multi-signal readiness is validated for a mixed recreational app. | Combining HRV with perceived recovery, resting heart rate, performance, sleep, and well-being is more plausible than HRV-only control and appears in individualized studies, but no validated fusion algorithm for recreational mixed strength/conditioning was found. | Use a transparent multi-signal evidence record rather than a black-box readiness score. Show which signals were present, stale, missing, or contradictory. | **Peer-reviewed adjacent evidence plus product-design convention.** Nuuttila et al. (2017), individualized endurance training; Alfonso et al. (2025), n=28 experienced cyclists, combined signals. [Nuuttila DOI](https://doi.org/10.1055/s-0043-115122), [Alfonso full text](https://www.nature.com/articles/s41598-025-13540-z) |
| A consumer device’s absolute HRV threshold transfers across users and devices. | No universal cross-device or cross-user threshold was found. Personal baselines and protocol consistency are necessary because measurement properties and context vary. | Normalize within user and device/protocol; require a minimum valid baseline before using HRV directionally; hold or downgrade confidence when measurement quality is poor. | **Not found for a universal threshold. Product-design convention informed by adjacent HRV-monitoring literature.** |

#### Counterpoints and evidence gaps

- HRV may help decide *when to distribute hard work* without telling the system whether a specific joint, tendon, or muscle is safe.
- A lower HRV can reflect a useful training stimulus, illness, sleep loss, measurement artifact, or unrelated stress. The same number can have different meanings.
- Wearable readiness scores may combine proprietary inputs and may not expose raw HRV, preprocessing, artifact rejection, or baseline logic.
- No adequately powered trial located here compares fixed programming, HRV-only control, and multi-signal control in recreational mixed strength/conditioning.
- No validated universal rule says “red HRV means skip,” “green HRV means progress,” or “HRV below X means reduce load by Y%.”

### 5. Return to training after a layoff

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| One week off causes a predictable strength loss requiring a fixed percentage reduction. | Short-term cessation studies often show substantial retention of strength or muscle size, but performance expression, exercise skill, readiness, and conditioning can still vary. | Treat a one-week gap as a caution flag and use a calibration exposure; do not force a universal percentage reduction. | **Peer-reviewed adjacent evidence.** Hwang et al. (2017), trained men after two weeks’ detraining; Coleman et al. (2024), supervised resistance-training deload/cessation protocol. [Hwang PubMed](https://pubmed.ncbi.nlm.nih.gov/28328712/), [Coleman PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/) |
| Three or more weeks off implies a known percentage reduction. | Some narrow studies report retained strength or muscle thickness after several weeks, while broader detraining reviews show that effects vary with training status, duration, modality, and outcome. | Use time off as a caution multiplier for confidence and volume, not a deterministic load equation. | **Peer-reviewed adjacent evidence.** Ogasawara et al. (2013), [PubMed](https://pubmed.ncbi.nlm.nih.gov/23053130/); Gavanda et al. (2020), [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7241623/); Encarnação et al. (2022), systematic review, [MDPI](https://www.mdpi.com/2813-0413/1/1/1) |
| Detraining is the same across strength, cycling, rowing, and technical exercises. | Cardiorespiratory, strength, hypertrophy, skill, and connective-tissue responses have different time courses. Evidence from one modality cannot be used as a cross-modality conversion table. | Keep layoff handling modality-specific. A return after a cycling gap must not automatically prescribe a barbell or rower reduction using the same formula. | **Peer-reviewed adjacent evidence translated into a product boundary.** Mujika & Padilla (2000) and later detraining literature support modality- and outcome-specific interpretation. [Part I PubMed](https://pubmed.ncbi.nlm.nih.gov/10966148/) |
| There is a validated “one week = 10% down” or “three weeks = 20% down” rule. | No validated time-off-to-percentage-load equation was found. Such percentages are coaching or product conventions. | First session after a gap: reduce complexity and/or volume conservatively, cap effort, observe technique and RPE/RIR, then update from current evidence and next-day response. | **Not found. Product-design convention only.** |

#### Counterpoints and evidence gaps

- Retained 1RM does not guarantee normal readiness for volume, conditioning, coordination, or connective-tissue loading.
- A layoff caused by travel is not equivalent to one caused by illness, injury, immobilization, severe sleep loss, or medication change.
- The first session after a gap is both training and measurement. Making it a maximal test can destroy the information needed for safe re-entry.
- No universal percentage rule was found across trained status, age, exercise, body region, modality, or reason for absence.
- Injury, surgery, illness, or unexplained symptoms require a separate clinical return-to-training pathway; the rules engine must not improvise one.

### 6. Pain versus non-painful fatigue

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| Pain-monitoring can allow continued loading during rehabilitation. | In a 38-person Achilles tendinopathy randomized study, a condition-specific pain-monitoring model allowed activity up to a defined pain level with next-morning and week-to-week checks; continued activity was not worse than active rest. | Use this as a precedent for symptom-monitored rehabilitation only when the condition and protocol are known. Do not generalize the threshold to all users or exercises. | **Peer-reviewed direct evidence for a narrow clinical population.** Silbernagel et al. (2007), *American Journal of Sports Medicine*, n=38. [DOI](https://doi.org/10.1177/0363546506298279) |
| A 5/10 pain threshold is a universal safe training rule. | The threshold belongs to specific tendinopathy rehabilitation protocols. A pilot in patellar tendinopathy and broader reviews do not validate a universal threshold across diagnoses or recreational training. | Never display “5/10 is safe” as a general law. Ask about location, quality, onset, function, progression, and next-day response; route red flags out of autonomous training. | **Peer-reviewed adjacent evidence; universal rule not found.** Sprague et al. (2021), n=15 pilot, [DOI](https://doi.org/10.1186/s40814-021-00792-5); Tran et al. (2025), 16 trials/1,026 participants, low/very-low certainty, [DOI](https://doi.org/10.2519/jospt.2025.13253) |
| Pain and exertional fatigue can be treated as the same signal. | Pain, fatigue, soreness, technique breakdown, and breathlessness have different meanings and cannot be safely collapsed into one RPE-like field. Return-to-sport criteria are inconsistent and often not operationalized. | Store pain/symptoms separately from effort and fatigue. Pain or neurological/cardiopulmonary red flags must block automatic progression; non-painful fatigue can be handled by conservative repeat/hold logic when safe. | **Peer-reviewed adjacent evidence plus product-design convention.** Habets et al. (2018) reviewed 35 Achilles return-to-sport studies and found only 19 described criteria, with inconsistent operational cutoffs. [DOI](https://doi.org/10.1007/s40279-017-0833-9) |
| A general traffic-light pain model is validated for this app. | Clinical traffic-light tools and pain-monitoring models are useful practice precedents, but no general validation across injuries, exercises, modalities, and recreational users was found. | A traffic-light state can be implemented as a conservative safety UX, explicitly labelled product policy. It must not diagnose or grant medical clearance. | **Product-design convention.** The clinical precedent is condition-specific; general app validation was not found. |
| Holding a prescription until the user explicitly acknowledges a pain-stop event is evidence-based. | No study located here validates an app acknowledgement gate. It may be a defensible safety interaction because it prevents silent progression after an unresolved symptom, but that is an engineering decision. | After a pain-stop, block automatic progression for the affected movement/pattern until the user records a symptom update; escalate red flags. Label the gate as a safety policy, not science. | **Not found. Product-design convention only.** |

#### Counterpoints and evidence gaps

- Blanket “never train with pain” may be too conservative for diagnosed, supervised rehabilitation, while generic “pain is okay” is unsafe for an app that cannot diagnose.
- Pain intensity alone is insufficient: location, quality, function, trajectory, and next-day response matter.
- Pain may be absent while capacity is still reduced, and pain may persist without indicating tissue damage; the rules engine must not infer a diagnosis.
- No general traffic-light threshold, acknowledgement gate, or automatic substitution rule was validated for mixed recreational strength and conditioning.
- Any chest pain, fainting/dizziness, acute traumatic event, neurological symptoms, severe shortness of breath, or rapidly worsening pain should leave the autonomous training pathway.

### 7. Confidence-scoring and uncertainty communication

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| A confidence score is meaningful only if it is calibrated to a defined outcome and horizon. | Calibration research shows that a high apparent confidence can be poorly matched to real-world correctness. The user must know confidence in what, over what period, and conditional on which data. | Never show an unqualified “confidence 72%.” Name the decision, evidence window, data completeness, and expected horizon. | **Peer-reviewed adjacent evidence.** Guo et al. (2017), calibration of modern neural networks; Hüllermeier & Waegeman (2021), uncertainty taxonomy. [Guo](https://proceedings.mlr.press/v70/guo17a.html), [Hüllermeier & Waegeman](https://link.springer.com/article/10.1007/s10994-021-05946-3) |
| Appropriate reliance is safer than maximizing trust. | Human-automation research distinguishes appropriate reliance from simple trust. Explanations can reduce or increase over-reliance depending on task difficulty and whether the user can verify the recommendation. | Make verification cheap: show the exact drivers and what would change the decision. Use a hold/ask-more-data state for high-impact uncertainty instead of persuasive prose. | **Peer-reviewed adjacent evidence.** Lee & See (2004); Bussone et al. (2015); Vasconcelos et al. (2023). [Lee & See](https://journals.sagepub.com/doi/10.1518/hfes.46.1.50_30392), [Bussone](https://openaccess.city.ac.uk/id/eprint/13150/), [Vasconcelos](https://dl.acm.org/doi/10.1145/3579605) |
| Ranges, frequencies, denominators, and context can improve interpretation of uncertain outcomes. | Risk-communication research supports consistent formats, explicit denominators, and context; different displays work differently depending on task and numeracy. | Prefer a plain-language range or evidence statement to a pseudo-precise scalar. Test the UI with the actual training decision rather than assuming more detail is safer. | **Peer-reviewed adjacent evidence.** Trevena et al. (2013) consensus primer; Gigerenzer & Hoffrage (1995); Fernandes et al. (2018) visualization study. [Trevena](https://doi.org/10.1186/1472-6947-13-S2-S7), [Gigerenzer](https://doi.org/10.1037/0033-295X.102.4.684), [Fernandes](https://dl.acm.org/doi/10.1145/3173574.3173718) |
| Data coverage and freshness should be visible. | Clinical decision-support and HCI work supports understandability, evidence, and actionability as conditions for appropriate reliance. It does not establish one completeness threshold for this app. | Show “based on X comparable sessions,” “last valid HRV,” missing fields, conflicts, and whether the estimate is observed or inferred. | **Peer-reviewed adjacent evidence translated into a product rule.** Exact labels and thresholds are **Product-design convention**. |
| Uncertainty should cause a useful action rather than merely lower a score. | Uncertainty-aware systems can abstain or target cases for review. However, friction and uncertainty displays can also reduce satisfaction or cause avoidance. | Map uncertainty to `approved`, `held`, `reduced`, `blocked`, `needs_input`, or `needs_clinical_review`. Do not let a low number silently change the prescription. | **Peer-reviewed adjacent evidence.** Kompa et al. (2021) on abstention/uncertainty in medical ML; Kang et al. (2021) on uncertainty-guided review; Politi et al. (2011) on uncertainty trade-offs. [Kompa](https://doi.org/10.1038/s41746-020-00367-3), [Kang](https://www.nature.com/articles/s41746-021-00515-3), [Politi](https://pubmed.ncbi.nlm.nih.gov/20860780/) |
| A red/amber/green confidence badge improves safety or adherence. | No direct study located here validates a particular badge, colour, threshold, smoothing rule, or effect on training outcomes. | If colours are used, pair them with text, reason codes, data coverage, and the action. Validate appropriate reliance and decision quality, not just perceived trust. | **Not found. Product-design convention only.** |

#### Counterpoints and evidence gaps

- Uncertainty is not cost-free: it can lower satisfaction, create avoidance, or increase acceptance without improving decisions.
- A calibrated model can still prescribe a bad action; calibration of the estimate is not validation of the policy.
- A user may over-trust a persuasive explanation or under-trust a correct conservative recommendation.
- No study located here establishes that a confidence UI in a consumer training app improves adherence, safety, performance, or health outcomes.
- The product should validate calibration, missing-data robustness, over-reliance, under-reliance, and whether the hold action is understood.

### 8. Juggernaut Method, RTS, and MacroFactor

#### Evidence table

| Claim | What the evidence actually supports | Recommended app rule | Evidence status/citation |
|---|---|---|---|
| MacroFactor uses a deterministic feedback loop rather than a conversational AI deciding calories. | MacroFactor publicly describes an initial estimate, logged intake, trend weight, energy-balance estimation, smoothing, and periodic target adjustments. | Borrow the pattern: observed data → smoothed state estimate → bounded adjustment → repeat. Keep formulas, versions, inputs, and confidence explicit in THE Hybrid Engine. | **Product-design convention.** MacroFactor’s [algorithm and core philosophy](https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/) and [expenditure documentation](https://help.macrofactorapp.com/en/articles/20-expenditure) |
| MacroFactor deliberately smooths noisy data and avoids reacting to one or a few abnormal observations. | Its public material describes trend weight, recent weighting, gradual weekly adjustments, and a data-sufficiency hold. The exact V3 equations and smoothing parameters are not public. | Use smoothing and damped updates as a product precedent. Store the raw observations alongside the estimate and expose the reason for a hold or update. | **Product-design convention.** [Weight Trend](https://help.macrofactorapp.com/en/articles/21-weight-trend), [V3 algorithm](https://macrofactor.com/expenditure-v3/), [weekly adjustment logic](https://help.macrofactorapp.com/en/articles/222-how-does-macrofactor-make-adjustments-for-a-weight-gain-or-weight-loss-goal) |
| MacroFactor’s minimum logging requirements are universal scientific minimums. | Public requirements such as nutrition on at least 4 of 7 days and weight at least once weekly are operational product gates, not universal statistical or physiological guarantees. | Treat minimum data thresholds as versioned product parameters. Test them on the Hybrid Engine’s own metrics; do not cite MacroFactor’s thresholds as science. | **Product-design convention.** [Expenditure version and requirements](https://help.macrofactorapp.com/en/articles/74-expenditure-version), [logging frequency](https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition-for-the-expenditure-algorithm-and-weekly-coaching-updates) |
| MacroFactor has independently validated true TDEE measurement. | MacroFactor’s public accuracy material describes prediction of observed weight change from estimated expenditure and intake. That is predictive validity in its own analysis, not direct validation against chamber calorimetry or doubly labelled water. | Describe MacroFactor as product precedent. Do not claim that its current estimate is a gold-standard measurement or that its internal accuracy analysis transfers to training-state estimation. | **Product-design convention; independent direct validation not found in the reviewed public material.** [Algorithm accuracy](https://macrofactor.com/algorithm-accuracy/) |
| JuggernautAI is a reproducible, peer-reviewed algorithm. | The official product pages describe individualized inputs, proprietary algorithms, and feedback across sets, sessions, weeks, blocks, and programmes. They do not disclose equations, weights, thresholds, or a full decision table. | Borrow the idea of structured programming with feedback, but keep THE Hybrid Engine’s rules explicit, versioned, deterministic, and auditable. | **Product-design convention.** [JuggernautAI official description](https://www.jtsstrength.com/juggernautai), [official app site](https://www.juggernautai.app/) |
| RTS and the original Juggernaut Method are scientific validation. | RTS documents RPE/RIR targets, fatigue percentages, lift-specific charts, performance downturns, and autoregulated adjustments as coaching methodology. The Juggernaut Method documents wave progression, working-max updates, and rep-record feedback. These are practice precedents, not controlled validation of the complete systems. | Use them to generate candidate rule families and terminology. Mark every adopted rule as coaching methodology or product design unless a direct study supports it. | **Established coaching methodology.** RTS materials: [Beginning RTS](https://store.reactivetrainingsystems.com/blogs/rts-basics/beginning-rts), [fatigue percentages](https://store.reactivetrainingsystems.com/blogs/advanced-concepts/fatigue-percents-revisited), [performance downturns](https://store.reactivetrainingsystems.com/blogs/advanced-concepts/performance-downturns). Juggernaut: [official method article](https://www.jtsstrength.com/going-heavy-on-the-juggernaut-method), [book record](https://books.apple.com/us/book/the-juggernaut-method-2-0/id669190546) |
| The Hybrid Engine should copy either product wholesale. | MacroFactor is nutrition/weight feedback; Juggernaut and RTS are primarily resistance-training coaching systems. Their domains, measures, and proprietary choices differ from a mixed strength/conditioning app. | Combine principles, not code or claims: modality-specific metrics, structured plan, feedback, smoothing, confidence, hold states, reason codes, and deterministic authority. | **Product-design convention informed by established coaching methodology.** Cross-modality equivalence remains unsupported. |

#### Counterpoints and evidence gaps

- Product documentation is evidence of what a creator says the product does, not independent validation of efficacy or generalizability.
- MacroFactor’s public documentation explicitly leaves important V3 implementation details proprietary; no responsible audit can reconstruct its exact formula from marketing or help pages.
- JuggernautAI’s current product should not be treated as identical to the original Juggernaut Method.
- RTS and Juggernaut are strongest as named coaching precedents for autoregulation and periodization, not as evidence that every threshold or progression rule is optimal for recreational mixed-modality users.
- No peer-reviewed study located here validates the complete RTS system, the complete original Juggernaut Method, or the current JuggernautAI algorithm in recreational self-directed adults.

## Counterpoints/Challenges

### The strongest objections to the common assumptions

1. **“If it is common in coaching, it must be validated.”** Common practice can be useful and still be a heuristic. The bundle should retain named coaching precedent while refusing to upgrade it into direct science.
2. **“More signals automatically make the decision more accurate.”** More signals can add noise, missingness, contradictions, and false precision. The engine should show signal quality and conflicts, not just average them into a larger score.
3. **“The number of sessions is the evidence.”** Three noisy, non-comparable sessions are not stronger than one high-quality standardized observation. Count, comparability, error, and context must be separate fields.
4. **“RPE/RIR solves day-to-day variation.”** It can help, but users can misestimate effort and may need familiarization. RPE is a measurement with error, not a truth oracle.
5. **“HRV is readiness.”** HRV is autonomic information, not local tissue capacity, pain status, or medical clearance.
6. **“Pain is either harmless or an automatic stop.”** Both extremes are unsafe. Some diagnosed rehabilitation protocols permit monitored pain; a general app cannot infer the diagnosis or transfer the protocol.
7. **“A confidence score makes the system safe.”** An uncalibrated score can create false reassurance. Safety comes from calibrated estimates, explicit limits, abstention, reason codes, and appropriate user action.
8. **“MacroFactor/Juggernaut proved the architecture.”** They provide compelling precedents, but the Hybrid Engine has different outcomes, modalities, data quality, and safety boundaries.

### Evidence gaps that must remain visible

- No validated universal consecutive-failure or missed-session threshold.
- No validated universal e1RM/volume trend window or minimum number of exposures.
- No validated universal HRV cutoff, cross-device threshold, or HRV-only strength gate.
- No validated time-off-to-percentage-load-reduction equation.
- No validated general traffic-light pain model for recreational mixed training.
- No validation of a post-pain-stop acknowledgement gate.
- No evidence that a consumer training confidence meter improves adherence, performance, or safety.
- No independent, reproducible validation of MacroFactor’s current V3 expenditure algorithm against a gold-standard expenditure measure in the public sources reviewed.
- No peer-reviewed validation of the complete RTS system, complete original Juggernaut Method, or current JuggernautAI algorithm in recreational self-directed adults.

## Actionable Next Steps

### Evidence-safe rules to implement first

1. **Preserve the deterministic authority.** Every adaptive output should include the engine version, state, action, reason codes, data-quality flags, and the observed inputs used.
2. **Separate observed data from estimated state.** Keep raw sets, reps, load, RPE/RIR, symptoms, sleep, HRV, device metrics, and completion status separate from e1RM, fatigue, readiness, and trend estimates.
3. **Use RPE/RIR conditionally.** Require familiarization and learn user-specific bias. Use corroboration for high-repetition, novel, painful, or technically unstable work.
4. **Replace hard-coded folklore thresholds with explicit heuristics.** If the app uses “two misses,” “three exposures,” “5–7 days,” or a percentage reduction, label it `product_heuristic`, version it, and make it testable.
5. **Use corroborated deterioration.** A repeated performance decline beyond estimated error plus fatigue, pain, readiness, or technique evidence is stronger than a single failed set.
6. **Make HRV advisory.** Normalize within user and protocol; never allow HRV alone to escalate training or authorize loading through pain.
7. **Make layoff return a calibration state.** Lower complexity and/or volume conservatively, cap effort, observe current RPE/RIR and technique, and progress only from new evidence. Route illness, injury, surgery, and red flags outside the autonomous engine.
8. **Keep pain separate.** After a pain-stop, stop or modify the affected movement, record structured symptoms, block automatic progression for that movement/pattern, and require an explicit symptom update. Label this as safety policy, not validated science.
9. **Use confidence as an action-linked state, not decoration.** Prefer `approved`, `held`, `reduced`, `blocked`, `needs_input`, and `needs_clinical_review` over an unexplained percentage.
10. **Validate the policy itself.** Replay difficult cases: missing data, contradictory devices, poor sleep, pain, illness, repeated failure, long layoff, false-positive HRV, overestimated RPE, and a desire to make up missed work.

### Minimum evidence tests for the rules engine

- **Determinism:** identical versioned input produces identical output.
- **Missingness:** missing RPE, HRV, sleep, heart rate, or device data cannot be silently treated as normal.
- **Conflicts:** contradictory device and user data produce a visible conflict state, not an averaged fiction.
- **Pain:** pain never becomes “fatigue” merely because the user wants to continue.
- **No overreaction:** one bad session does not force a large progression or demotion unless a safety rule is triggered.
- **Trend error:** changes within the user’s estimated measurement error do not cause automatic progression.
- **Layoff:** first return session is conservative and informative; the engine does not apply an invented percentage law.
- **Modality separation:** cycling, Air Bike, rowing, SkiErg, and barbell metrics cannot be silently exchanged.
- **Recovery:** HRV-only changes cannot escalate intensity; multi-signal contradictions reduce confidence.
- **Missed work:** the engine does not stack excessive work to “make up” missed sessions.
- **Auditability:** every change has a reason code and evidence status.

### Final recommendation

Build the adaptive layer now, but build it as a **versioned, deterministic state estimator and bounded decision policy**. Use RPE/RIR, smoothing, multi-signal context, and explicit hold states. Do not market any exact session count, deload schedule, HRV cutoff, pain threshold, or layoff percentage as validated science unless a future study directly tests that rule.

The first valuable version is not an AI coach. It is a transparent engine that can say:

> “Hold progression. The last two comparable exposures are within measurement noise; HRV is missing; readiness is lower; no pain was reported. The session purpose is preserved, but there is not enough reliable evidence to increase the dose.”

That statement is scientifically honest, operationally useful, and testable.

## Human Logic Layer — bounded coaching judgment

### Evidence status and scope

This section defines the intended **human-like behaviour** of the product. It is not presented as a validated physiological model. The evidence bundle supports the need for conservative, explainable, uncertainty-aware decisions; the specific interaction rules below are **product-design conventions and safety policies**.

“Human logic” must not mean an unconstrained AI coach, a hidden intuition score, or permission to override the deterministic engine. It means that the engine considers the athlete’s real situation and chooses the next useful move while respecting hard safety limits.

The rule engine remains authoritative:

```text
Observed data + athlete context
        ↓
Training-state estimate with uncertainty
        ↓
Bounded human-logic policy
        ↓
Validated session decision
        ↓
Deterministic explanation
```

No AI model is required for this layer. The first implementation should use typed inputs, ordered rules, reason codes, and deterministic message templates. A future AI coach may translate the result into natural language, but it must not bypass or rewrite the decision.

### What the human-logic layer is trying to preserve

The system should behave like a calm, experienced coach who understands that the athlete is a person living a real life:

- Preserve the purpose of the session where safely possible.
- Account for sleep, energy, stress, soreness, pain, illness, work, time and equipment constraints.
- Distinguish “the athlete feels flat” from “the movement is painful” and from “the device data is unreliable.”
- Avoid cancelling a useful session because of one soft negative signal.
- Avoid progressing because of one unusually good signal.
- Reduce the dose before abandoning the training habit when the athlete has a difficult day.
- Never shame, punish, or make the athlete repay missed training with stacked volume.
- Give the athlete the next useful move, not merely a score or a warning.
- Explain what was observed, what was inferred, what changed, and what would change the decision next time.

### Decision priority order

The policy must evaluate signals in this order. Lower-priority context cannot override a higher-priority safety state.

1. **Hard safety gate:** chest pain, fainting, serious dizziness, acute injury, severe illness symptoms, dangerous technique, or other configured red flags. Stop or block the session and route to appropriate professional/urgent guidance. Do not diagnose.
2. **Pain and symptom state:** pain is not interchangeable with exertional fatigue. Stop, modify, or substitute the affected movement as appropriate; do not automatically progress that movement until the symptom state is updated.
3. **Immediate training quality:** technique, control, completion, local failure, unusual RPE, and whether the intended work was actually performed.
4. **Session purpose:** strength, hypertrophy, aerobic base, threshold, intervals, skill, recovery, or minimum viable maintenance. Preserve the purpose with the smallest safe dose.
5. **Real-world constraints:** available time, equipment, work or life stress, motivation, and willingness to train today.
6. **Recent comparable evidence:** performance trends, RPE/RIR calibration, completed volume, missed work, and repeated deterioration.
7. **Advisory signals:** HRV, wearable recovery scores, one poor night of sleep, one unusual device reading, or one low-motivation report. These may lower confidence or support a hold; they must not independently escalate, block, or authorise risky loading.

### Context-to-action policy

| Situation | Human interpretation | Default engine action | What the engine must not do |
|---|---|---|---|
| Readiness and comparable performance are normal | The planned dose is reasonable | Proceed; progress one lever only when evidence and confidence allow | Change multiple variables automatically |
| Readiness is low but performance and technique are acceptable | The athlete may complete the purpose, but the data does not justify escalation | Complete or hold the current dose; do not progress | Treat low readiness as proof of incapacity |
| Readiness and performance are both poor, without pain | The planned dose is probably too expensive today | Reduce intensity, volume, density, or complexity by one controlled lever; offer a minimum viable or recovery session | Force the full plan or declare the athlete failed |
| One poor session with otherwise stable history | This may be noise, context, equipment error, or a bad day | Hold, gather context, and repeat or proceed conservatively | Trigger a large demotion or deload from one observation |
| Good readiness but poor performance | The signals conflict | Hold progression, inspect technique, sleep, equipment, data quality and recent load | Assume the readiness score is correct and push harder |
| Poor readiness but unexpectedly strong performance | The signals conflict in the opposite direction | Complete the planned purpose if safe, but avoid automatic escalation | Treat one good session as proof that recovery concerns are irrelevant |
| The athlete has limited time | A shortened useful session is better than an all-or-nothing failure | Keep the warm-up and highest-value primary work; remove accessories or finishers first | Cram missed work or randomly cut the main stimulus |
| The athlete is unmotivated but physically safe | The barrier may be mental energy, not physical inability | Offer a minimum viable session with a clear stopping point | Shame the athlete or prescribe punishment |
| A session was missed | The plan must move forward, not collect debt | Roll to the next useful session; preserve recovery spacing | Stack sessions, double volume, or “make up” everything |
| Several sessions were missed or there was a long gap | Current capacity is uncertain | Enter a calibration state; use a conservative, informative exposure | Apply an invented universal percentage reduction |
| Pain appears in a movement | Pain requires a separate symptom pathway | Stop, modify or substitute; record the symptom; block automatic progression for that movement until reviewed | Re-label pain as normal fatigue because the athlete wants to continue |
| HRV or wearable data is missing | The estimate is less certain, not automatically worse | Use the remaining reliable inputs; lower confidence or hold progression | Treat missing data as normal or fabricate a value |
| Device data conflicts with user report or completed work | There is a data-quality conflict | Prefer transparent conflict handling and conservative action; request one useful clarification | Average incompatible signals into a false precise score |
| The athlete asks to push through a blocked state | Motivation is not a safety override | Offer a safe alternative or recovery action | Override a hard gate because the athlete insists |

The exact reduction amount, number of confirming exposures, and trend window must remain versioned heuristics unless directly validated. The policy is about the **decision shape**, not a claim that one percentage or count is scientifically correct.

### The minimum viable session rule

For a difficult but non-dangerous day, the engine should preserve the smallest dose that still serves the session’s purpose. This may mean:

- one primary strength movement instead of the full accessory menu;
- fewer sets while retaining the target movement pattern;
- an easier aerobic session instead of intervals;
- technique work, mobility, or recovery conditioning instead of high intensity;
- a short check-in and warm-up that permits the athlete to stop honestly if capacity does not improve.

This is a practical adherence and fatigue-management policy, not proof that a particular “minimum dose” produces a defined adaptation. The engine must show which part of the original purpose was preserved and which part was deferred.

### The no-punishment and no-make-up rules

Missing a session is an event to interpret, not a failure to punish. The default behaviour is:

1. Record the missed session and the known reason, if provided.
2. Do not add the missed volume to the next session.
3. Preserve recovery spacing and the order of important training exposures.
4. Resume with the next useful session, using a calibration state if the gap is long enough to make current capacity uncertain.
5. Explain: “You are not behind. We are protecting the next productive exposure.”

This exact policy is a product convention. The evidence bundle found no universal validated missed-session threshold or make-up rule.

### OODA reset points

The engine should use a small decision loop at three points:

```text
Observe  →  record symptoms, context, performance and data quality
Orient   →  interpret them against today’s purpose and recent comparable history
Decide   →  choose proceed, hold, reduce, substitute, recover or block
Act      →  execute, monitor, and re-evaluate when new information appears
```

Run the loop:

- before the session;
- during the session after unexpected pain, technique loss, output collapse, abnormal symptoms, or major RPE mismatch;
- after the session before updating progression.

An OODA reset may change the rest of the session, but it must not silently rewrite the historical record or retroactively pretend that incomplete work was completed.

### Required decision contract

Every human-logic decision should expose enough information for a user, coach, test, or audit to understand it:

```ts
type HumanLogicDecision = {
  status:
    | "approved"
    | "held"
    | "reduced"
    | "repeated"
    | "substituted"
    | "recovery"
    | "calibration"
    | "blocked"
    | "needs_input"
    | "needs_clinical_review";
  mode:
    | "normal"
    | "conservative"
    | "minimum_viable"
    | "recovery"
    | "calibration"
    | "blocked";
  sessionPurpose: string;
  action: string;
  prescription: unknown;
  reasonCodes: string[];
  observedSignals: string[];
  estimatedState: string[];
  conflicts: string[];
  missingData: string[];
  confidenceState: "high" | "moderate" | "low" | "insufficient";
  evidenceStatus: "coaching_precedent" | "product_design_convention" | "safety_policy";
  recheckAt: "next_set" | "mid_session" | "next_session" | "next_block";
};
```

The `prescription` may be typed more precisely in the implementation. It must never be an opaque free-form paragraph. Identical versioned inputs must produce identical decisions.

### Human-readable explanation template

Use deterministic templates before adding AI:

```text
What I noticed: [observed facts].
What that means today: [bounded interpretation and confidence].
What we are doing: [specific action and preserved session purpose].
Why: [reason codes in plain language].
What would change it: [next check or missing information].
```

Preferred voice: calm, direct, practical, experienced, and non-punitive. Avoid diagnosis, motivational theatre, false certainty, and phrases such as “your nervous system is fried” unless the product has an explicitly supported definition—which it currently does not.

### Required regression cases

Before calling this layer complete, replay at minimum:

- normal readiness / normal performance;
- one poor night of sleep but normal performance;
- low readiness plus poor performance;
- good readiness plus poor performance;
- low motivation with no safety concern;
- a time-limited session;
- one missed session;
- a longer training gap;
- non-painful local fatigue;
- movement-specific pain;
- chest pain or dizziness red flag;
- missing HRV;
- missing heart rate during short intervals;
- conflicting wearable, machine, and self-report data;
- a user asking to make up missed work;
- a user asking to override a blocked state.

The acceptance criterion is not that the engine always finds a way to train. It is that it makes a safe, proportionate, explainable, context-aware decision and does not invent certainty where the evidence is weak.
