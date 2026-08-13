import { useState } from 'react';
import { View } from 'react-native';
import { useSync } from '../cloud/sync';
import { Btn, Card, Kicker, T } from '../ui';

/*
 * A real coach's proposed program, waiting for THIS athlete to say yes or no.
 *
 * Ported from apps/web/src/autocoach/ArcAssignmentCard.tsx — same behaviour,
 * same copy, React Native rather than JSX-for-a-browser. It is a port and not
 * an import because apps/mobile may not reach into apps/web; see the header of
 * cloud/arc-assignments.ts for the full reasoning.
 *
 * Renders NOTHING for the overwhelming majority of accounts, which have no
 * coaching relationship at all — `pendingAssignments` is only ever non-empty
 * for an account enrolled in a real ARC organisation.
 *
 * Accepting records consent (accept_program_assignment writes an immutable
 * decision + receipt); the sync that follows materializes the assignment's
 * coach-authored program version into a real local Workout recurring on its
 * preferred weekdays. That workout is a PROPOSAL into the week, not the week:
 * the existing Coordinator pipeline places it exactly like a self-authored
 * recurring session and may still hold it back.
 */
export function ArcAssignmentCard() {
  const { pendingAssignments, acceptAssignment, declineAssignment } = useSync();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (pendingAssignments.length === 0) return null;

  const respond = async (assignmentId: string, action: 'accept' | 'decline') => {
    setBusyId(assignmentId);
    setError(null);
    try {
      if (action === 'accept') await acceptAssignment(assignmentId);
      else await declineAssignment(assignmentId);
    } catch {
      // Deliberately the web wording, and deliberately reassuring about state:
      // the RPC either recorded the decision or it did not, and a failed one
      // leaves the assignment exactly where it was.
      setError('That could not be recorded. Nothing has changed — try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mt-2">
      <Kicker>From your coach</Kicker>
      <T className="mt-0.5 text-3 text-dim">
        {pendingAssignments.length} program{' '}
        {pendingAssignments.length === 1 ? 'assignment awaits' : 'assignments await'} your response.
      </T>
      {error ? <T className="mt-1 text-3 text-bad">{error}</T> : null}
      <View className="mt-1.5">
        {pendingAssignments.map((assignment) => (
          <View key={assignment.id} className="mt-1 rounded-md border border-line p-1.5">
            <T num className="text-3 text-dim">
              Preferred start {assignment.preferredStartDate}
            </T>
            <View className="mt-1 flex-row gap-1">
              <Btn
                variant="brass"
                disabled={busyId === assignment.id}
                onPress={() => void respond(assignment.id, 'accept')}
                label={`accept program starting ${assignment.preferredStartDate}`}
              >
                Accept
              </Btn>
              <Btn
                disabled={busyId === assignment.id}
                onPress={() => void respond(assignment.id, 'decline')}
                label={`decline program starting ${assignment.preferredStartDate}`}
              >
                Decline
              </Btn>
            </View>
          </View>
        ))}
      </View>
      <T className="mt-1.5 text-3 text-dim">
        Accepting adds this to your training. Your week is still arranged for you — nothing here
        overrides a rest day or a safety stop.
      </T>
    </Card>
  );
}
