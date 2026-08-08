import { useState } from 'react';
import { useSync } from '../cloud/sync';
import { Button, Card } from '../ui';

/*
 * A real coach's proposed program, waiting for THIS athlete to say yes or
 * no. Renders nothing for the overwhelming majority of accounts, which have
 * no coaching relationship at all — `pendingAssignments` is only ever
 * non-empty for an account enrolled in a real ARC organisation.
 *
 * Accepting records consent (accept_program_assignment writes an immutable
 * decision + receipt); the next sync then materializes the assignment's
 * coach-authored program version into a real local Workout (recurring on
 * its preferred weekdays), which the existing Coordinator pipeline picks up
 * and schedules exactly like a self-authored session — see
 * `materializeAcceptedAssignments` in cloud/arc-athlete-sync.ts.
 */
export function ArcAssignmentCard() {
  const { pendingAssignments, acceptAssignment, declineAssignment } = useSync();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (pendingAssignments.length === 0) return null;

  async function respond(assignmentId: string, action: 'accept' | 'decline') {
    setBusyId(assignmentId);
    setError(null);
    try {
      if (action === 'accept') await acceptAssignment(assignmentId);
      else await declineAssignment(assignmentId);
    } catch {
      setError('That could not be recorded. Nothing has changed — try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <p className="text-3 font-semibold">From your coach</p>
      <p className="mt-0.5 text-2 text-dim">
        {pendingAssignments.length} program {pendingAssignments.length === 1 ? 'assignment awaits' : 'assignments await'} your response.
      </p>
      {error && <p className="mt-1 text-2 text-bad">{error}</p>}
      <div className="mt-1.5 space-y-1.5">
        {pendingAssignments.map((assignment) => (
          <div key={assignment.id} className="rounded border border-line p-1.5">
            <p className="text-2 text-dim">Preferred start {assignment.preferredStartDate}</p>
            <div className="mt-1 flex gap-1">
              <Button variant="brass" disabled={busyId === assignment.id} onClick={() => respond(assignment.id, 'accept')}>
                Accept
              </Button>
              <Button disabled={busyId === assignment.id} onClick={() => respond(assignment.id, 'decline')}>
                Decline
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-2 text-dim">
        Accepting adds this to your training the next time you sync.
      </p>
    </Card>
  );
}
