import { describe, it, expect } from "vitest";
import {
  choosePrompt,
  INSTALL_CARD_HIDDEN_DAYS,
  NO_HISTORY,
  REMINDER_DELAYS_DAYS,
  reminderDue,
  type PromptHistory,
  type PromptInput,
} from "@/lib/notification-prompt";

const DAY = 864e5;
const NOW = Date.parse("2026-11-08T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const declined = (declines: number, daysAgo: number): PromptHistory => ({ declines, lastDeclinedAt: ago(daysAgo), offersDecided: false });

/** An installed app, device undecided, nothing remembered — the first Home visit. */
const base: PromptInput = {
  state: "off",
  permission: "default",
  standalone: true,
  history: NO_HISTORY,
  installClosedAt: null,
  now: NOW,
};
const pick = (over: Partial<PromptInput>) => choosePrompt({ ...base, ...over });

describe("the reminder schedule", () => {
  it("is 3 days, then 14, then nothing", () => {
    expect([...REMINDER_DELAYS_DAYS]).toEqual([3, 14]);
  });

  it("is due straight away before any decline", () => {
    expect(reminderDue(NO_HISTORY, NOW)).toBe(true);
  });

  it("waits 3 days after the first decline", () => {
    expect(reminderDue(declined(1, 2.9), NOW)).toBe(false);
    expect(reminderDue(declined(1, 3), NOW)).toBe(true);
    expect(reminderDue(declined(1, 30), NOW)).toBe(true);
  });

  it("waits 14 days after the second, counted from that decline", () => {
    expect(reminderDue(declined(2, 13.9), NOW)).toBe(false);
    expect(reminderDue(declined(2, 14), NOW)).toBe(true);
    // Three days after the second decline is not enough, whatever the first was.
    expect(reminderDue(declined(2, 3), NOW)).toBe(false);
  });

  it("stops after the third decline, however long ago", () => {
    expect(reminderDue(declined(3, 400), NOW)).toBe(false);
    expect(reminderDue(declined(7, 400), NOW)).toBe(false);
  });

  it("never turns an unreadable time into asking on every visit", () => {
    expect(reminderDue({ declines: 1, lastDeclinedAt: "not a date" }, NOW)).toBe(false);
    expect(reminderDue({ declines: 1, lastDeclinedAt: null }, NOW)).toBe(false);
  });
});

describe("who is asked", () => {
  it("asks a client who has never decided, on the first visit, with a sheet", () => {
    expect(pick({})).toEqual({ surface: "sheet", stage: 0 });
  });

  it("asks brand-new accounts the same way — nothing is needed but an empty history", () => {
    expect(pick({ history: { declines: 0, lastDeclinedAt: null, offersDecided: false } })).toEqual({ surface: "sheet", stage: 0 });
  });

  it("never asks someone who has already granted the device's permission", () => {
    expect(pick({ state: "on", permission: "granted" })).toBeNull();
    // Granted but switched off in Settings is still an answer; it is theirs to undo.
    expect(pick({ state: "off", permission: "granted" })).toBeNull();
    expect(pick({ state: "off", permission: "granted", history: declined(1, 100) })).toBeNull();
  });

  it("never offers the prompt to someone whose device said no", () => {
    expect(pick({ state: "denied", permission: "denied" })).toBeNull();
    expect(pick({ state: "denied", permission: "denied", history: NO_HISTORY })).toBeNull();
  });

  it("shows nothing while loading, or where notifications can't work", () => {
    for (const state of ["loading", "unsupported", "unconfigured"] as const) expect(pick({ state })).toBeNull();
  });

  it("whether offers were decided makes no difference to who is asked", () => {
    expect(pick({ history: { ...NO_HISTORY, offersDecided: true } })).toEqual({ surface: "sheet", stage: 0 });
  });
});

describe("after Not now", () => {
  it("is quiet for 3 days", () => {
    expect(pick({ history: declined(1, 1) })).toBeNull();
    expect(pick({ history: declined(1, 2.9) })).toBeNull();
  });

  it("then a smaller card, not another sheet", () => {
    expect(pick({ history: declined(1, 3) })).toEqual({ surface: "card", stage: 1 });
  });

  it("then 14 days of quiet after that card is closed, and one more card", () => {
    expect(pick({ history: declined(2, 13) })).toBeNull();
    expect(pick({ history: declined(2, 14) })).toEqual({ surface: "card", stage: 2 });
  });

  it("then it stops for good", () => {
    expect(pick({ history: declined(3, 1000) })).toBeNull();
  });

  it("is quiet on the very day, so a decline is not undone by the next visit", () => {
    expect(pick({ history: declined(1, 0) })).toBeNull();
  });
});

describe("when the device said no", () => {
  it("says how to undo it, on the same schedule, once it was a no given through us", () => {
    expect(pick({ state: "denied", permission: "denied", history: declined(1, 1) })).toBeNull();
    expect(pick({ state: "denied", permission: "denied", history: declined(1, 3) })).toEqual({ surface: "settings-help", stage: 1 });
    expect(pick({ state: "denied", permission: "denied", history: declined(2, 14) })).toEqual({ surface: "settings-help", stage: 2 });
    expect(pick({ state: "denied", permission: "denied", history: declined(3, 400) })).toBeNull();
  });
});

describe("in a browser tab", () => {
  it("on an iPhone, says to install rather than showing a button that cannot work", () => {
    expect(pick({ state: "install-first", permission: null, standalone: false })).toEqual({ surface: "install", stage: 0 });
  });

  it("stays away after the card was closed, then returns", () => {
    const closed = (daysAgo: number) => NOW - daysAgo * DAY;
    expect(pick({ state: "install-first", standalone: false, installClosedAt: closed(1) })).toBeNull();
    expect(pick({ state: "install-first", standalone: false, installClosedAt: closed(INSTALL_CARD_HIDDEN_DAYS - 1) })).toBeNull();
    expect(pick({ state: "install-first", standalone: false, installClosedAt: closed(INSTALL_CARD_HIDDEN_DAYS) })).toEqual({ surface: "install", stage: 0 });
  });

  it("does not count closing the install card as a decision about notifications", () => {
    // The install card ignores the schedule entirely, so a client who closed it
    // in Safari gets the sheet on their first visit in the app they install.
    expect(pick({ state: "install-first", standalone: false, history: declined(3, 1) })).toEqual({ surface: "install", stage: 0 });
    expect(pick({ state: "off", permission: "default", standalone: true, history: NO_HISTORY })).toEqual({ surface: "sheet", stage: 0 });
  });

  it("where notifications work in a tab, a card rather than a sheet", () => {
    expect(pick({ standalone: false })).toEqual({ surface: "card", stage: 0 });
  });
});
