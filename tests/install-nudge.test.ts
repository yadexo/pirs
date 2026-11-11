import { describe, it, expect } from "vitest";
import { chooseNudge, nudgeDue, NO_NUDGE_HISTORY, NUDGE_DELAYS_DAYS, type NudgeHistory, type NudgeInput } from "@/lib/install-nudge";

const DAY = 864e5;
const NOW = Date.parse("2026-11-11T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const dismissed = (dismissals: number, daysAgo: number): NudgeHistory => ({ dismissals, lastDismissedAt: ago(daysAgo), neverAgain: false });

/** A signed-in client in a browser, on a clinic that has the nudge on. */
const base: NudgeInput = {
  standalone: false,
  enabled: true,
  history: NO_NUDGE_HISTORY,
  shownThisSession: false,
  now: NOW,
};
const pick = (over: Partial<NudgeInput>) => chooseNudge({ ...base, ...over });

describe("the schedule", () => {
  it("is next visit, then 3 days, then 14, then nothing", () => {
    expect([...NUDGE_DELAYS_DAYS]).toEqual([0, 3, 14]);
  });

  it("is due straight away before anyone has said no", () => {
    expect(nudgeDue(NO_NUDGE_HISTORY, NOW)).toBe(true);
  });

  it("is due again immediately after the first no — the session rule is what holds it", () => {
    // "Next visit" is a session boundary, not a duration, so the delay here
    // is zero and chooseNudge's shownThisSession does the waiting.
    expect(nudgeDue(dismissed(1, 0), NOW)).toBe(true);
  });

  it("waits three days after the second, counted from that one", () => {
    expect(nudgeDue(dismissed(2, 2.9), NOW)).toBe(false);
    expect(nudgeDue(dismissed(2, 3), NOW)).toBe(true);
  });

  it("waits fourteen after the third", () => {
    expect(nudgeDue(dismissed(3, 13.9), NOW)).toBe(false);
    expect(nudgeDue(dismissed(3, 14), NOW)).toBe(true);
    // Three days is not enough at this stage, whatever the earlier gaps were.
    expect(nudgeDue(dismissed(3, 3), NOW)).toBe(false);
  });

  it("stops for good after the fourth no", () => {
    expect(nudgeDue(dismissed(4, 400), NOW)).toBe(false);
    expect(nudgeDue(dismissed(9, 4000), NOW)).toBe(false);
  });

  it("never turns an unreadable time into asking on every visit", () => {
    expect(nudgeDue({ dismissals: 2, lastDismissedAt: "not a date" }, NOW)).toBe(false);
    expect(nudgeDue({ dismissals: 2, lastDismissedAt: null }, NOW)).toBe(false);
  });
});

describe("who gets asked, and with what", () => {
  it("gives the first ask the whole screen", () => {
    expect(pick({})).toEqual({ surface: "walkthrough", stage: 0 });
  });

  it("gives every later ask a banner", () => {
    expect(pick({ history: dismissed(1, 0) })).toEqual({ surface: "banner", stage: 1 });
    expect(pick({ history: dismissed(2, 3) })).toEqual({ surface: "banner", stage: 2 });
    expect(pick({ history: dismissed(3, 14) })).toEqual({ surface: "banner", stage: 3 });
  });

  it("says nothing at all once the schedule is spent", () => {
    expect(pick({ history: dismissed(4, 999) })).toBeNull();
  });

  it("never asks someone who already has the app on this device", () => {
    // A device fact, not a stored one: the same client on a laptop they have
    // not installed on is still asked there.
    expect(pick({ standalone: true })).toBeNull();
    expect(pick({ standalone: true, history: dismissed(1, 100) })).toBeNull();
  });

  it("never asks again once they have said don't ask again", () => {
    expect(pick({ history: { dismissals: 1, lastDismissedAt: ago(90), neverAgain: true } })).toBeNull();
    // Even before they have dismissed anything.
    expect(pick({ history: { ...NO_NUDGE_HISTORY, neverAgain: true } })).toBeNull();
  });

  it("says nothing when the clinic has switched it off", () => {
    expect(pick({ enabled: false })).toBeNull();
    expect(pick({ enabled: false, history: dismissed(2, 30) })).toBeNull();
  });

  it("asks once in a sitting, not once a render", () => {
    expect(pick({ shownThisSession: true })).toBeNull();
    expect(pick({ shownThisSession: true, history: dismissed(2, 30) })).toBeNull();
  });

  it("is quiet for the rest of the visit after a no, and back on the next one", () => {
    // The whole of "next visit", in two lines: the same session is silent,
    // a new one is not.
    const justSaidNo = dismissed(1, 0);
    expect(pick({ history: justSaidNo, shownThisSession: true })).toBeNull();
    expect(pick({ history: justSaidNo, shownThisSession: false })).toEqual({ surface: "banner", stage: 1 });
  });

  it("cannot be silenced for good by a tab left open", () => {
    // The session flag suppresses, it does not gate: a client who left the
    // tab open for a week still gets asked when they come back to it.
    expect(pick({ history: dismissed(2, 7), shownThisSession: false })).toEqual({ surface: "banner", stage: 2 });
  });
});
