import { useState } from 'react';
import { assertPublishable, type CoachSession } from '../../model';
import { useCoachCloud } from '../../cloud';
import { BRASS, Field, IconSend, MICRO, WELL } from '../../ui';

export function PublishStep({ sess }: { sess: CoachSession }) {
  const cloud = useCoachCloud();
  const [athlete, setAthlete] = useState(cloud.athletes[0]?.id || '');
  const [date, setDate] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const validate = () => {
    try {
      assertPublishable(sess);
      setMsg({ tone: 'ok', text: cloud.user ? 'Ready to send.' : 'Ready to send — sign in to send this to an athlete.' });
    } catch (e) {
      setMsg({ tone: 'warn', text: 'Could not validate: ' + (e as Error).message });
    }
  };

  const publish = async () => {
    setPublishing(true);
    // cloud.publish already calls assertPublishable internally and returns
    // an error string on failure, null on success — see apps/coach/src/cloud.tsx.
    const err = await cloud.publish(sess, athlete, date);
    setMsg(err ? { tone: 'warn', text: err } : { tone: 'ok', text: 'Sent to athlete.' });
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
              {cloud.athletes.length ? (
                <select id="rx-athlete" value={athlete} onChange={(e) => setAthlete(e.target.value)} className={WELL + ' h-5 px-1 text-4'}>
                  {cloud.athletes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              ) : (
                <p className="text-3 text-muted">
                  {cloud.loadError || 'No athletes yet — create an invite from the dashboard, and "Myself" appears once your account loads.'}
                </p>
              )}
              <label className={MICRO} htmlFor="rx-date">Scheduled date</label>
              <input id="rx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={WELL + ' h-5 px-1 text-4'} />
              <button onClick={() => void publish()} disabled={publishing || !athlete} className={BRASS + ' mt-1 w-full'}>
                {publishing ? 'Sending…' : 'Send to athlete'}
              </button>
            </>
          ) : (
            <>
              <button onClick={validate} className={BRASS + ' w-full'}>Validate</button>
              <p className="text-2 leading-relaxed text-dim">
                Sign in to send this to an athlete. Until then it stays on this machine — validation still runs, so you know it would cross the boundary cleanly.
              </p>
            </>
          )}
          {msg ? (
            <p
              role="status"
              className={
                'mt-1 flex items-center gap-0.5 rounded-md border px-1.5 py-1 text-3 ' +
                (msg.tone === 'ok'
                  ? 'border-gold-line bg-gold-wash text-gold2'
                  : 'border-[color:var(--color-warn)]/40 bg-panel2 text-warn')
              }
            >
              {msg.tone === 'ok' ? <IconSend size={14} /> : null}
              <span>{msg.text}</span>
            </p>
          ) : null}
        </div>
      </Field>
    </div>
  );
}
