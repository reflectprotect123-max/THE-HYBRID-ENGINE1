import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  impParse,
  impToWorkout,
  learnMove,
  learnWord,
  lexiconOf,
  uid,
  unlearn,
  type ImpIssue,
  type ImpResult,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Empty, Kicker, ScreenTitle, SectionHead, cx } from '../ui';

/*
 * Import: paste, dictate or photograph a workout and turn it into a session.
 *
 * The parser deliberately guesses, and every guess it is unsure about comes
 * back as a QUESTION rather than a silent assumption. Answering one teaches the
 * app permanently — that is the whole point of the lexicon, and why the answers
 * are worth asking for rather than just letting the athlete fix the result.
 */
export function Import() {
  const nav = useNavigate();
  const { settings, update } = useDb();
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState<Set<number>>(new Set());
  const [listening, setListening] = useState(false);
  const [ocrMsg, setOcrMsg] = useState('');

  const lex = useMemo(() => lexiconOf(settings), [settings]);
  const parsed: ImpResult | null = useMemo(() => (text.trim() ? impParse(text, lex) : null), [text, lex]);

  const open = parsed ? parsed.issues.filter((i) => !resolved.has(i.id)) : [];

  function saveWorkout() {
    if (!parsed) return;
    const w = impToWorkout(parsed, uid);
    update((draft) => {
      draft.workouts.push(w as (typeof draft.workouts)[number]);
    });
    nav('/library');
  }

  function teachWord(word: string) {
    update((draft) => {
      draft.settings.lexicon = learnWord(lexiconOf(draft.settings), word, 'rest');
    });
  }

  function teachMove(alias: string, name: string, mode: string) {
    update((draft) => {
      draft.settings.lexicon = learnMove(lexiconOf(draft.settings), alias, name, mode as 'reps');
    });
  }

  function forget(type: 'kw' | 'ex', key: string) {
    update((draft) => {
      draft.settings.lexicon = unlearn(lexiconOf(draft.settings), type, key);
    });
  }

  /** Dictation goes through the same parser as paste — one code path. */
  function dictate() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Rec = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Rec) {
      setOcrMsg('This browser has no speech recognition. The Android app does.');
      return;
    }
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-GB';
    const base = text;
    rec.onresult = (e: SpeechEvent) => {
      let add = '';
      for (let i = e.resultIndex; i < e.results.length; i++) add += e.results[i][0].transcript + '\n';
      setText((base ? base + '\n' : '') + add);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
  }

  return (
    <>
      <Kicker>Import</Kicker>
      <ScreenTitle>Bring a workout in</ScreenTitle>

      <Card className="mt-2">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResolved(new Set());
          }}
          rows={8}
          placeholder={'Paste it exactly as written.\n\nLower A\nA1) Back squat 5x5 @8\nA2) RDL 3x10\nrest 120'}
          aria-label="workout text"
          className="w-full resize-y rounded-md border border-line bg-well px-1 py-1 text-4 outline-none focus:border-gold-line"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          <Button size="sm" onClick={dictate} disabled={listening}>
            {listening ? 'Listening…' : '🎤 Dictate'}
          </Button>
          <Button
            size="sm"
            onClick={() => setOcrMsg('Photo import runs on-device in the Android app, where the OCR model ships with it.')}
          >
            📷 Photo
          </Button>
          {text ? (
            <Button size="sm" variant="quiet" onClick={() => setText('')}>
              Clear
            </Button>
          ) : null}
        </div>
        {ocrMsg ? <p className="mt-1 text-3 text-muted">{ocrMsg}</p> : null}
      </Card>

      {!parsed ? (
        <Empty
          title="Nothing to read yet"
          body="Paste a session above. Whiteboard shorthand is fine — 5x5, ladders, A1/A2 pairs, rest 120."
        />
      ) : (
        <>
          {open.length ? (
            <>
              <SectionHead title={`${open.length} thing${open.length === 1 ? '' : 's'} to check`} />
              <div className="flex flex-col gap-1">
                {open.map((i) => (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    onDismiss={() => setResolved((s) => new Set(s).add(i.id))}
                    onTeachWord={teachWord}
                    onTeachMove={teachMove}
                  />
                ))}
              </div>
            </>
          ) : null}

          <SectionHead title={parsed.name} />
          {parsed.blocks.length ? (
            <div className="flex flex-col gap-1">
              {parsed.blocks.map((b, bi) => (
                <Card key={bi}>
                  <div className="flex items-baseline gap-1">
                    <span className="text-5 font-[750]">{b.heading}</span>
                    {b.superset ? (
                      <span className="text-2 font-[750] uppercase tracking-[.14em] text-gold2">superset</span>
                    ) : null}
                    {b.format ? <span className="text-3 text-dim">{b.format}</span> : null}
                  </div>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {b.exercises.map((e, ei) => (
                      <li key={ei} className="num text-4">
                        <span className="font-[650] text-text">{e.name || '(unnamed)'}</span>{' '}
                        <span className="text-muted">
                          {e.varied ? e.varied.join('-') : `${e.sets} × ${e.range || e.secs || e.reps || '—'}`}
                          {e.secs ? 's' : ''}
                          {e.rpe ? ` @RPE ${e.rpe}` : ''}
                          {e.kg ? ` · ${e.kg}kg` : ''}
                          {e.eachSide ? ' · each side' : ''}
                          {e.rest ? ` · rest ${e.rest}s` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          ) : (
            <Empty title="Couldn't find any movements" body="Check the text above — or add them by hand in the Library." />
          )}

          {parsed.notes.length ? (
            <>
              <SectionHead title="Notes kept" />
              <Card>
                <ul className="flex flex-col gap-0.5 text-4 text-muted">
                  {parsed.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}

          <Button variant="brass" size="lg" className="mt-3 w-full" onClick={saveWorkout} disabled={!parsed.blocks.length}>
            Save to Library
          </Button>
        </>
      )}

      <LearnedList lex={lex} onForget={forget} />
    </>
  );
}

function IssueCard({
  issue,
  onDismiss,
  onTeachWord,
  onTeachMove,
}: {
  issue: ImpIssue;
  onDismiss: () => void;
  onTeachWord: (w: string) => void;
  onTeachMove: (alias: string, name: string, mode: string) => void;
}) {
  if (issue.kind === 'typo') {
    return (
      <Card className="border-gold-line">
        <p className="text-4">
          Read <b className="text-gold2">“{issue.word}”</b> as a rest of {issue.rest}s. Is that right?
        </p>
        <div className="mt-1 flex gap-1">
          <Button
            size="sm"
            variant="brass"
            onClick={() => {
              onTeachWord(issue.word);
              onDismiss();
            }}
          >
            Yes — remember it
          </Button>
          <Button size="sm" onClick={onDismiss}>
            Just this once
          </Button>
        </div>
      </Card>
    );
  }

  if (issue.kind === 'confirmName') {
    return (
      <Card className="border-gold-line">
        <p className="text-4">
          {issue.fuzzy ? 'Did you mean' : 'Not in the library:'}{' '}
          <b className="text-gold2">{issue.name}</b>
          {issue.fuzzy ? '?' : ''}{' '}
          <span className="text-dim">(from “{issue.raw}”)</span>
        </p>
        <div className="mt-1 flex gap-1">
          <Button
            size="sm"
            variant="brass"
            onClick={() => {
              onTeachMove(issue.raw, issue.name, issue.ref.mode);
              onDismiss();
            }}
          >
            Yes — remember it
          </Button>
          <Button size="sm" onClick={onDismiss}>
            Leave as is
          </Button>
        </div>
      </Card>
    );
  }

  if (issue.kind === 'nameOrSection') {
    return (
      <Card className="border-gold-line">
        <p className="text-4">
          <b className="text-gold2">{issue.block}</b> had a rep scheme but no movement. Name it in the Library after saving.
        </p>
        <Button size="sm" className="mt-1" onClick={onDismiss}>
          Got it
        </Button>
      </Card>
    );
  }

  return (
    <Card className="border-line2">
      <p className="text-4">
        Couldn&apos;t read: <span className="text-muted">“{issue.text}”</span>
      </p>
      <Button size="sm" className="mt-1" onClick={onDismiss}>
        Skip it
      </Button>
    </Card>
  );
}

function LearnedList({
  lex,
  onForget,
}: {
  lex: ReturnType<typeof lexiconOf>;
  onForget: (t: 'kw' | 'ex', k: string) => void;
}) {
  const kw = Object.keys(lex.kw);
  const ex = Object.keys(lex.ex);
  if (!kw.length && !ex.length) return null;
  return (
    <>
      <SectionHead title="What it has learned" />
      <Card>
        <ul className="flex flex-col gap-0.5">
          {ex.map((k) => (
            <LearnedRow key={'e' + k} label={`“${k}” → ${lex.ex[k].name}`} onForget={() => onForget('ex', k)} />
          ))}
          {kw.map((k) => (
            <LearnedRow key={'k' + k} label={`“${k}” → ${lex.kw[k]}`} onForget={() => onForget('kw', k)} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function LearnedRow({ label, onForget }: { label: string; onForget: () => void }) {
  return (
    <li className="flex items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-4 text-muted">{label}</span>
      <button onClick={onForget} className={cx('text-3 text-dim hover:text-bad')} aria-label={'forget ' + label}>
        forget
      </button>
    </li>
  );
}

/* Minimal shapes for the Web Speech API, which TypeScript's DOM lib does not
   ship because it is not a standard. */
interface SpeechEvent {
  resultIndex: number;
  results: { [i: number]: { [j: number]: { transcript: string } }; length: number };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (e: SpeechEvent) => void;
  onend: () => void;
  onerror: () => void;
  start(): void;
}
