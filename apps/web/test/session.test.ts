import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveDayTarget } from "../src/lib/session";

/*
 * resolveDayTarget: the ONE place a tapped calendar day (or Home's date) is
 * turned into a navigation target — shared by Calendar and Home so their
 * "what happens when you tap this day" logic cannot diverge.
 */
describe("resolveDayTarget", () => {
  it('returns recap when a sessionId is present, even if the date is today — a completed session wins over the "start" flow', () => {
    assert.deepEqual(resolveDayTarget("2026-07-29", "2026-07-29", "w1", "s1"), { kind: "recap", id: "s1" });
  });

  it("returns today when the date matches today and there is no sessionId", () => {
    assert.deepEqual(resolveDayTarget("2026-07-29", "2026-07-29"), { kind: "today" });
  });

  it("returns preview with the workoutId passed through for any other date", () => {
    assert.deepEqual(resolveDayTarget("2026-07-30", "2026-07-29", "w1"), { kind: "preview", date: "2026-07-30", workoutId: "w1" });
  });

  it("returns preview with workoutId undefined when nothing is scheduled — a valid preview state", () => {
    assert.deepEqual(resolveDayTarget("2026-07-30", "2026-07-29"), { kind: "preview", date: "2026-07-30", workoutId: undefined });
  });
});
