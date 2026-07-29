import { useState } from 'react';
import { assertPublishable, type CoachSession } from '../../model';
import { useCoachCloud } from '../../cloud';
import { BRASS, Field, MICRO, WELL } from '../../ui';

export function PublishStep({ sess }: { sess: CoachSession }) {
  const cloud = useCoachCloud();
  const [athlete, setAthlete] = useState(cloud.athletes[0]?.id || '');
  const [date, setDate] = useState('');
  const [msg, setMsg] = useState('');
  const [publishing, setPublishing] = useState(false);

  const validate = () => {
    try {
      assertPublishable(sess);
      setMsg(cloud.user ? 'Ready to send.' : 'Ready to send — sign in to send this to an athlete.');
    } catch (e) {
      setMsg('Could not validate: ' + (e as Error).message);
    }
  };

  const publish = async () => {
    setPublishing(true);
    // cloud.publish already calls assertPublishable internally and returns
    // an error string on failure, null on success — see apps/coach/src/cloud.tsx.
    const err = await cloud.publish(sess, athlete, date);
    setMsg(err || 'Sent to athlete.');
    setPublishing(false);
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">Ready to send</h1>
      <Field label="Deliver">
        <div className="flex w-full max-w-[360px] flex-col gap-1">
          {cloud.user ? (
            <>
              <label className={MICRO} htmlFor="rx-athlete">Athlete</label>
              <select id="rx-athlete" value={athlete} onChange={(e) => setAthlete(e.target.value)} className={WELL + ' h-5 px-1 text-4'}>
                {cloud.athletes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <label className={MICRO} htmlFor="rx-date">Scheduled date</label>
              <input id="rx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={WELL + ' h-5 px-1 text-4'} />
              <button onClick={() => void publish()} disabled={publishing} className={BRASS + ' mt-1 w-full'}>
                {publishing ? 'Sending…' : 'Send to athlete'}
              </button>
            </>
          ) : (
            <>
              <button onClick={validate} className={BRASS + ' w-full'}>Validate &amp; publish</button>
              <p className="text-2 leading-relaxed text-dim">
                Sign in to send this to an athlete. Until then it stays on this machine — validation still runs, so you know it would cross the boundary cleanly.
              </p>
            </>
          )}
          {msg ? <p role="status" className="mt-1 rounded-md border bg-panel2 px-1.5 py-1 text-3">{msg}</p> : null}
        </div>
      </Field>
    </div>
  );
}
