import { useState } from 'react';
import { LibProvider, useLib } from './store';
import { Editor } from './Editor';
import { emptyWeek, newSession } from './model';

/*
 * The coach builder. Laptop-only by design: the athlete's phone is the logger,
 * this is where the plan is written, and trying to serve both from one layout
 * is what made the previous builder unusable on either.
 */
export function App() {
  return (
    <LibProvider>
      <Shell />
    </LibProvider>
  );
}

function Shell() {
  const { lib, day, setDay, select, update } = useLib();
  const prog = lib.programs[lib.sel.p];
  const week = prog.weeks[lib.sel.w];
  const [publishing, setPublishing] = useState(false);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-panel3/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-3 py-1.5">
          <span className="text-6 font-[800] text-gold2">THE Hybrid System</span>
          <span className="text-3 text-dim">coach</span>

          <div className="ml-auto flex items-center gap-1">
            <button
              className="h-4 rounded-md border border-line2 px-1 text-3 text-muted hover:text-text"
              onClick={() => select({ w: Math.max(0, lib.sel.w - 1) })}
              aria-label="previous week"
            >
              ‹
            </button>
            <span className="num min-w-10 text-center text-4 font-[750]">Week {lib.sel.w + 1}</span>
            <button
              className="h-4 rounded-md border border-line2 px-1 text-3 text-muted hover:text-text"
              onClick={() =>
                update((d) => {
                  const p = d.programs[d.sel.p];
                  d.sel.w += 1;
                  if (!p.weeks[d.sel.w]) p.weeks[d.sel.w] = emptyWeek();
                })
              }
              aria-label="next week"
            >
              ›
            </button>
          </div>

          <ul className="flex w-full gap-1">
            {week.days.map((s, i) => (
              <li key={i} className="flex-1">
                <button
                  onClick={() => select({ d: i })}
                  aria-current={i === lib.sel.d}
                  className={
                    'w-full rounded-md border px-1 py-1 text-3 font-[750] transition-colors duration-120 ' +
                    (i === lib.sel.d
                      ? 'border-gold-line bg-gold-wash text-gold2'
                      : s
                        ? 'border-line2 bg-panel2 text-text'
                        : 'border-line bg-panel text-dim hover:text-muted')
                  }
                >
                  Day {i + 1}
                  <span className="mt-0.5 block truncate text-2 font-[500] text-dim">
                    {s ? s.title || 'Session' : 'rest'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-3 py-3">
        {day ? (
          <Editor publishing={publishing} setPublishing={setPublishing} />
        ) : (
          <div className="rounded-lg border border-line bg-panel p-4 text-center shadow-card">
            <div className="text-2 font-[750] uppercase tracking-[.14em] text-dim">
              Week {lib.sel.w + 1} · Day {lib.sel.d + 1}
            </div>
            <h1 className="mt-1 text-8 font-[800]">Rest day</h1>
            <button
              className="mt-2 h-5 rounded-md px-2 text-5 font-[650] text-[#1b1509] shadow-brass [background:var(--brass)]"
              onClick={() => setDay(newSession('Session'))}
            >
              ＋ Add a session to this day
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
