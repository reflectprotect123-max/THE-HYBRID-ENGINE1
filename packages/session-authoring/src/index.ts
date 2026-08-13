/**
 * The headless engine for running a training session.
 *
 * `apps/web` is React DOM and `apps/mobile` is React Native, so no screen can be
 * shared between them — a `<div>` does not render on Android. What both already
 * depend on is `react` itself, and a hook contains no JSX and touches no DOM.
 * So the shared thing is a hook, and each app renders its own body on it.
 *
 * Everything here is pure except `useSession`, which is glue. Nothing here
 * decides what a set should weigh: that is `@hybrid/engine`'s `foldExercise`,
 * the single owner of the coaching rule, and this package calls it.
 */
export const SESSION_AUTHORING_VERSION = '1.0.0';
