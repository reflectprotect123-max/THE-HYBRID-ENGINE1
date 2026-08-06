import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureSharedCore } from '@hybrid/engine';
import { appendSharedCoreEvent } from '@hybrid/shared-core';
import { useDb } from '../store/db';
import { Button, Card, cx } from '../ui';

/**
 * The quick pre-session check-in. Writes the SAME shared-core shapes the
 * Settings "Whole-athlete context" card writes — recovery observation,
 * life-load observation, safety flags — so whole-athlete-state derives from
 * one model, not two. Also emits the readiness_recorded event that the
 * schema always defined but nothing sent until now.
 *
 * The safety question comes first and is never part of any readiness sum.
 * Everything else is optional: a missing answer stays unknown.
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);

type PainChoice = 'no' | 'yes' | 'not_sure';

export function CheckInCard() {
  const { db, update } = useDb();
  const nav = useNavigate();
  const today = ymd(new Date());
  const migrated = ensureSharedCore(db);
  const existing = migrated.core?.recovery.find((x) => x.date === today && x.source === 'manual');

  const [pain, setPain] = useState<PainChoice | null>(null);
  const [painAreas, setPainAreas] = useState('');
  const [energy, setEnergy] = useState('');
  const [soreness, setSoreness] = useState('');
  const [minutes, setMinutes] = useState('');

  if (existing) {
    return (
      <Card className="flex items-baseline gap-1">
        <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Checked in</span>
        <span className="text-3 text-muted">
          {existing.energy != null ? `energy ${existing.energy}` : 'noted'}
          {existing.soreness != null ? ` · soreness ${existing.soreness}` : ''}
          {migrated.core?.safety.painHold?.active ? ' · pain flagged' : ''}
        </span>
        <button className="ml-auto text-3 text-dim underline hover:text-text" onClick={() => nav('/settings')}>
          Edit
        </button>
      </Card>
    );
  }

  const num = (v: string): number | undefined => {
    const n = Number(v);
    return v.trim() && Number.isFinite(n) ? n : undefined;
  };

  const save = () => {
    const at = Date.now();
    const hasPain = pain === 'yes' && painAreas.trim().length > 0;
    update((draft) => {
      const next = ensureSharedCore(draft, at);
      const core = next.core!;
      core.recovery = [
        ...core.recovery.filter((x) => x.date !== today || x.source !== 'manual'),
        {
          id: `manual-recovery-${today}`,
          date: today,
          energy: num(energy),
          soreness: num(soreness),
          painAreas: hasPain ? painAreas.split(',').map((x) => x.trim()).filter(Boolean) : [],
          source: 'manual',
          recordedAt: at,
        },
      ];
      core.lifeLoad = [
        ...core.lifeLoad.filter((x) => x.date !== today || x.source !== 'manual'),
        { id: `manual-life-${today}`, date: today, availableMinutes: num(minutes), source: 'manual' },
      ];
      if (hasPain) {
        core.safety = {
          ...core.safety,
          painHold: {
            active: true,
            areas: painAreas.split(',').map((x) => x.trim()).filter(Boolean),
            updatedAt: at,
          },
        };
      }
      core.updatedAt = at;
      draft.core = appendSharedCoreEvent(core, {
        type: 'readiness_recorded',
        occurredAt: new Date(at).toISOString(),
        sourceDomain: 'strength',
        idempotencyKey: `readiness:${today}`,
        payload: { date: today, quick: true, pain: pain ?? 'unanswered' },
      });
      draft.ecosystem = {
        ...(next.ecosystem || { schemaVersion: 1, partitions: {}, events: [], core: draft.core }),
        core: draft.core,
      };
    });
  };

  return (
    <Card className="flex flex-col gap-1">
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Before you train</span>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-3 text-text">Any pain, injury concern, or unusual symptom?</span>
        {(['no', 'yes', 'not_sure'] as const).map((c) => (
          <button
            key={c}
            onClick={() => setPain(c)}
            className={cx(
              'rounded-full px-1 py-0.5 text-3 outline outline-1 transition-colors',
              pain === c
                ? c === 'no'
                  ? 'text-ok outline-ok/40'
                  : 'text-warn outline-warn/40'
                : 'text-muted outline-line hover:text-text',
            )}
          >
            {c === 'not_sure' ? 'Not sure' : c === 'no' ? 'No' : 'Yes'}
          </button>
        ))}
      </div>

      {pain === 'yes' && (
        <label className="block">
          <input
            value={painAreas}
            onChange={(e) => setPainAreas(e.target.value)}
            placeholder="Where? e.g. lower back"
            className="h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
          />
          <span className="mt-0.5 block text-3 text-dim">
            A pain flag stops automatic pushing — it is not a diagnosis. If it is severe, new, or
            worsening, talk to a qualified professional.
          </span>
        </label>
      )}
      {pain === 'not_sure' && (
        <p className="text-3 text-warn">
          Not sure is a fine answer — nothing will be adapted automatically today. Consider raising
          it with your coach before training hard.
        </p>
      )}

      <div className="grid grid-cols-3 gap-1">
        <label className="block">
          <span className="text-2 uppercase tracking-wide text-dim">Energy 0–10</span>
          <input value={energy} onChange={(e) => setEnergy(e.target.value)} inputMode="numeric" className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line" />
        </label>
        <label className="block">
          <span className="text-2 uppercase tracking-wide text-dim">Soreness 0–10</span>
          <input value={soreness} onChange={(e) => setSoreness(e.target.value)} inputMode="numeric" className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line" />
        </label>
        <label className="block">
          <span className="text-2 uppercase tracking-wide text-dim">Minutes today</span>
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line" />
        </label>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-3 text-dim">Optional — skip anything. Unknown stays unknown.</span>
        <Button variant="brass" className="ml-auto" onClick={save} disabled={pain === null}>
          Check in
        </Button>
      </div>
    </Card>
  );
}
