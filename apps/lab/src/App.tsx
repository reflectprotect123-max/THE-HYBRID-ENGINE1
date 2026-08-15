import { useState } from 'react';
import { CON_FORMATS } from '@hybrid/engine';
import type { CondFmtKey, Modality } from '@hybrid/engine';
import { FORMATS, MODALITIES, MODALITY_LABEL, type Rig } from './rig';
import { Formats } from './panels/Formats';
import { Progression } from './panels/Progression';
import { Adapt } from './panels/Adapt';
import { RunIt } from './panels/RunIt';

const TABS = [
  { id: 'formats', label: 'Formats' },
  { id: 'progression', label: 'Progression' },
  { id: 'adapt', label: 'Adapt' },
  { id: 'run', label: 'Run it' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * The rig sits here rather than in each panel so switching tabs keeps the same
 * athlete in view. Looking at a level-6 rower's phases and then at the
 * progression table for a level-0 runner would invite exactly the wrong
 * conclusion about whether progression moves.
 */
export function App() {
  const [tab, setTab] = useState<TabId>('formats');
  const [rig, setRig] = useState<Rig>({ fmt: 'intervals', modality: 'row', level: 0, rec: null });

  const set = <K extends keyof Rig>(k: K, v: Rig[K]) => setRig((r) => ({ ...r, [k]: v }));

  return (
    <div className="wrap">
      <header className="masthead">
        <h1>Conditioning Lab</h1>
        <p>
          A bench onto <code>@hybrid/engine</code>&rsquo;s conditioning decisions. Every number below
          comes from the same functions the Android app runs — nothing here reimplements them, so a
          format that behaves well here behaves the same way on a phone.
        </p>
      </header>

      <div className="panel">
        <div className="controls">
          <div className="field">
            <label htmlFor="rig-fmt">Format</label>
            <select
              id="rig-fmt"
              value={rig.fmt}
              onChange={(e) => set('fmt', e.target.value as CondFmtKey)}
            >
              {FORMATS.map((k) => (
                <option key={k} value={k}>
                  {CON_FORMATS[k].name} — {CON_FORMATS[k].desc}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="rig-mod">Modality</label>
            <select
              id="rig-mod"
              value={rig.modality}
              onChange={(e) => set('modality', e.target.value as Modality)}
            >
              {MODALITIES.map((m) => (
                <option key={m} value={m}>
                  {MODALITY_LABEL[m]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="rig-level">Earned level (0–20)</label>
            <input
              id="rig-level"
              type="number"
              min={0}
              max={20}
              value={rig.level}
              onChange={(e) =>
                set('level', Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)))
              }
            />
          </div>

          <div className="field">
            <label htmlFor="rig-rec">Recovery % (blank = no strap)</label>
            <input
              id="rig-rec"
              type="number"
              min={0}
              max={100}
              value={rig.rec ?? ''}
              placeholder="—"
              onChange={(e) => {
                const raw = e.target.value.trim();
                set('rec', raw === '' ? null : Math.max(0, Math.min(100, parseInt(raw, 10) || 0)));
              }}
            />
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Lab panels">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'formats' && <Formats rig={rig} />}
      {tab === 'progression' && <Progression rig={rig} />}
      {tab === 'adapt' && <Adapt rig={rig} />}
      {tab === 'run' && <RunIt rig={rig} />}
    </div>
  );
}
