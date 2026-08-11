import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildCatalogue } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { DayBuilder, type DayBuilderValue } from './DayBuilder';

/**
 * The day builder's route wrapper: it supplies the real catalogue and decides
 * which mode the screen is in from the URL.
 *
 * `/coach/day/:date` is the dated mode, reached from the Calendar.
 * `/coach/day` with no date is library mode, where the guided wizard finishes.
 *
 * Publishing is NOT wired here. `repository.publishWorkoutDraft` needs a client
 * and an existing draft with its base version, and inventing either would be
 * worse than saying so: a Publish button that silently did nothing is exactly
 * the class of defect this stage's siblings were written to avoid. The button
 * reports what it cannot do until Task 9 gives it a real draft to publish.
 */
export function DayBuilderRoute({ mode }: { mode: 'dated' | 'library' }) {
  const { date } = useParams<{ date: string }>();
  const { db } = useDb();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');

  const entries = useMemo(() => {
    const tags = (db.settings as { movementTags?: Record<string, string[]> }).movementTags;
    return buildCatalogue(db.workouts, db.sessions, tags);
  }, [db.workouts, db.sessions, db.settings]);

  function handlePublish(_value: DayBuilderValue) {
    setNotice(
      'Publishing is not connected yet — this session is not saved and nothing has been sent to an athlete.',
    );
  }

  function handleSave(_value: DayBuilderValue) {
    setNotice('Saving to the library is not connected yet — this session is not stored.');
  }

  return (
    <>
      {notice && (
        <p className="cb-note" role="status">
          {notice}
        </p>
      )}
      <DayBuilder
        mode={mode}
        date={date}
        published={false}
        entries={entries}
        onPublish={handlePublish}
        onSave={handleSave}
        onBack={() => navigate('/coach/library')}
      />
    </>
  );
}
