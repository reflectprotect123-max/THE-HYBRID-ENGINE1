import { Screen, Title, T, Tap } from '../ui';

/**
 * Stands in for the strength authoring/logging screens while they're
 * rebuilt from scratch (fire-sale rebuild, 17 August 2026) — the old
 * builder/wizard/live-logger were deleted deliberately, engine math
 * included. Conditioning and nutrition are untouched and unaffected;
 * this screen is reached only from a route that used to open the old
 * strength logger.
 */
export function StrengthRebuilding({ onLeave }: { onLeave?: () => void }) {
  return (
    <Screen>
      <Title>Strength is being rebuilt</Title>
      <T className="mt-2 text-center opacity-70">
        The strength builder and logger are being rebuilt from scratch. Conditioning and nutrition
        are unaffected.
      </T>
      {onLeave ? (
        <Tap onPress={onLeave} className="mt-6 self-center rounded-full bg-white/10 px-5 py-3">
          <T>Back to Training</T>
        </Tap>
      ) : null}
    </Screen>
  );
}
