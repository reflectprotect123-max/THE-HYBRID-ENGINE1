/*
 * parseBackup: the validating half of Settings' restore-from-paste. It must
 * accept what the export produces, refuse garbage with a PLAIN sentence
 * (never a raw parser message), and report what it found so the confirm step
 * can say what "Replace" means before anything is overwritten.
 */
import { uid, ymd, type EngineDB } from '@hybrid/engine';
import { parseBackup } from '../src/store/restore';

const backup = (): EngineDB => ({
  workouts: [],
  sessions: [
    { id: uid(), date: '2026-07-01', status: 'completed', blocks: [] },
    { id: uid(), date: ymd(new Date()), status: 'completed', blocks: [] },
  ],
  settings: {} as EngineDB['settings'],
});

describe('parseBackup', () => {
  it('round-trips a real export and reports what it found', () => {
    const r = parseBackup(JSON.stringify(backup()));
    if ('error' in r) throw new Error('expected success, got: ' + r.error);
    expect(r.sessions).toBe(2);
    expect(r.lastDate).toBe(ymd(new Date()));
    expect(r.db.sessions.length).toBe(2);
  });

  it('refuses garbage text with a plain sentence, never the raw parser error', () => {
    const r = parseBackup('definitely not json {');
    if (!('error' in r)) throw new Error('expected an error');
    expect(r.error).toMatch(/backup/i);
    expect(r.error).not.toMatch(/Unexpected token|JSON/);
  });

  it('refuses JSON that is not a backup (an empty object)', () => {
    const r = parseBackup('{}');
    if (!('error' in r)) throw new Error('expected an error');
    expect(r.error).toMatch(/backup/i);
  });
});
