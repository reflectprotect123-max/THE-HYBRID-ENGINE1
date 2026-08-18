// packages/strength-engine/src/coachingNotesFixture.test.ts
//
// Colocated (per CLAUDE.md's "where a test goes" rule — test/ holds only
// fixtures, not tests) baseline over
// `test/fixtures/coaching-notes.json`, the seeded synthetic corpus the Phase
// F plan (docs/superpowers/specs/2026-08-17-adaptive-engine-v2-design.md,
// Slice 34/36) staged for a Phase G retrieval baseline. Phase G (the
// AI-backed decision call that would actually embed and search this corpus)
// is on hold, so nothing reads this fixture yet — this test is what keeps it
// from being silently orphaned in the meantime: it pins the fixture's shape
// and count so a future Phase G build has a documented, stable baseline to
// build against, and so an accidental edit to the fixture is caught here
// rather than discovered mid-Phase-G.
//
// Deliberately NOT `coaching_note`-row-shaped: the fixture is seed CONTENT
// (`body` + `tags`), not rows. `owner_id` (not null on the table) and `id`
// are assigned at insert time by whatever seeds the table for real — the
// fixture has no owner to assign and no reason to pin ids that a seeding
// script would generate anyway. Whoever writes that Phase G seeding step
// owns pairing this content with a real `owner_id`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface CoachingNoteSeed {
  body: string;
  tags: string[];
}

const notes: CoachingNoteSeed[] = JSON.parse(
  readFileSync(new URL('../test/fixtures/coaching-notes.json', import.meta.url), 'utf8'),
);

describe('coaching-notes.json fixture', () => {
  it('has the ~20-note count the Phase F plan staged it at', () => {
    expect(notes.length).toBe(20);
  });

  it('every note has a non-empty body and at least one tag', () => {
    for (const note of notes) {
      expect(typeof note.body).toBe('string');
      expect(note.body.length).toBeGreaterThan(0);
      expect(Array.isArray(note.tags)).toBe(true);
      expect(note.tags.length).toBeGreaterThan(0);
      for (const tag of note.tags) expect(typeof tag).toBe('string');
    }
  });

  it('carries only seed content — no id or owner_id, which a real seeding step assigns', () => {
    for (const note of notes) {
      expect(Object.keys(note).sort()).toEqual(['body', 'tags']);
    }
  });

  it('has no duplicate note bodies', () => {
    const bodies = new Set(notes.map(n => n.body));
    expect(bodies.size).toBe(notes.length);
  });
});
