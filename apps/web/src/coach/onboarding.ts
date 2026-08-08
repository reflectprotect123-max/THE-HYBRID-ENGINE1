/**
 * Athlete-zero onboarding: the checklist that takes one person — coach and
 * first athlete in the same account — from empty store to a working loop.
 * Pure derivation from real state; every step is either observably done,
 * observably not, or explicitly skipped. Nothing here is a tour.
 */

export interface OnboardingInput {
  hasCore: boolean;
  availableDays: number;
  hasPrimaryGoal: boolean;
  whoopConnected: boolean;
  c2Connected: boolean;
  plannedWorkouts: number;
  loggedSessions: number;
  skips: Record<string, number>;
}

export interface OnboardingStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  skipped: boolean;
  skippable: boolean;
  /** where the step is completed; null means "right here on the bench" */
  href: string | null;
}

export function deriveOnboarding(i: OnboardingInput): OnboardingStep[] {
  const step = (
    id: string,
    label: string,
    detail: string,
    done: boolean,
    href: string | null,
    skippable = false,
  ): OnboardingStep => ({ id, label, detail, done, href, skippable, skipped: !!i.skips[id] && !done });

  return [
    step(
      'profile',
      'Athlete profile',
      'The shared core holds who is training — the engines and the Coordinator read from it.',
      i.hasCore,
      '/coach/legacy',
    ),
    step(
      'schedule',
      'Weekly schedule',
      'Which days are available. The Coordinator places sessions only on days the athlete gave it.',
      i.availableDays > 0,
      '/coach/legacy',
    ),
    step(
      'goal',
      'Primary goal',
      'Strength-led, conditioning-led, or hybrid — it weights how conflicts resolve.',
      i.hasPrimaryGoal,
      '/coach/legacy',
    ),
    step(
      'whoop',
      'Connect Whoop',
      'Recovery, HRV and sleep feed readiness. Without it, readiness reads unknown — never assumed.',
      i.whoopConnected,
      '/coach/legacy',
      true,
    ),
    step(
      'c2',
      'Connect Concept2',
      'Erg results sync automatically instead of being typed in.',
      i.c2Connected,
      '/coach/legacy',
      true,
    ),
    step(
      'plan',
      'Plan the first week',
      'Add sessions on the grid — the + on any future day, or a weekly slot from the Library.',
      i.plannedWorkouts > 0,
      null,
    ),
    step(
      'log',
      'Log the first session',
      'Completed training arrives as a separate actual; the coach workspace never impersonates the training experience.',
      i.loggedSessions > 0,
      '/coach/legacy',
    ),
  ];
}

export function onboardingProgress(steps: OnboardingStep[]): { done: number; total: number; complete: boolean } {
  const active = steps.filter((s) => !s.skipped);
  const done = active.filter((s) => s.done).length;
  return { done, total: active.length, complete: done === active.length };
}
