/**
 * When to ask a client to install the clinic's app, and how loudly.
 *
 * Pure, with no imports and `now` passed in — the same shape as
 * lib/notification-prompt.ts, for the same reason: this is the part with
 * rules in it, and rules are what tests are for.
 *
 * The schedule nudges and then gives up. It never blocks: every surface this
 * returns is dismissible, and nothing here can stop a client browsing,
 * ordering or paying.
 */

/**
 * Days to wait after the nth "Not now" before asking again. The list's length
 * is how many times we ask after the first — three in all, then silence.
 *
 * The first entry is 0 because the second ask is "next visit", not "in n
 * days". A visit is a session, not a duration, so `shownThisSession` carries
 * that half of it (see `chooseNudge`).
 */
export const NUDGE_DELAYS_DAYS = [0, 3, 14] as const;

const DAY_MS = 864e5;

/** What the client has already told us, counted from the stored events. */
export interface NudgeHistory {
  /** How many times they have said "Not now". */
  dismissals: number;
  /** When the last one was, ISO, or null if never. */
  lastDismissedAt: string | null;
  /** They asked not to be asked again, on this clinic and this address. */
  neverAgain: boolean;
}

export const NO_NUDGE_HISTORY: NudgeHistory = { dismissals: 0, lastDismissedAt: null, neverAgain: false };

/** The full-screen walkthrough the first time; a small banner after that. */
export type NudgeSurface = "walkthrough" | "banner";

export interface NudgeChoice {
  surface: NudgeSurface;
  /** How many dismissals came before this ask — what the stored event records. */
  stage: number;
}

export interface NudgeInput {
  /**
   * Whether the app is already installed *on this device*, from
   * display-mode or navigator.standalone.
   *
   * Deliberately a device fact and not a stored one: a client who installed
   * on their phone should still be offered the app on their laptop, where
   * they have not. An "installed" row in the database would silence both.
   */
  standalone: boolean;
  /** The clinic's own switch, in App Builder. */
  enabled: boolean;
  history: NudgeHistory;
  /** Whether a nudge has already been shown in this browser session. */
  shownThisSession: boolean;
  now: number;
}

/**
 * Whether enough time has passed since the last "Not now".
 *
 * An unreadable or missing timestamp means "no", never "ask again now" — the
 * failure a client would actually notice is being asked on every single
 * visit, so that is the one this fails away from.
 */
export function nudgeDue(history: Pick<NudgeHistory, "dismissals" | "lastDismissedAt">, now: number): boolean {
  if (history.dismissals <= 0) return true;
  const delay = NUDGE_DELAYS_DAYS[history.dismissals - 1];
  if (delay === undefined) return false; // asked enough times
  if (!history.lastDismissedAt) return false;
  const last = Date.parse(history.lastDismissedAt);
  if (Number.isNaN(last)) return false;
  return now - last >= delay * DAY_MS;
}

/**
 * The one surface to show, or nothing.
 *
 * `shownThisSession` is a suppression rather than a gate: it stops a second
 * ask in the same sitting, but it can never be the reason a client is never
 * asked. Written the other way round — "stage 1 needs a new session" — a tab
 * left open for a week would reach the end of the schedule without ever
 * showing anything, and on a desktop, where a session is one tab, every new
 * tab would count as a fresh visit.
 */
export function chooseNudge(input: NudgeInput): NudgeChoice | null {
  if (!input.enabled) return null;
  // Already installed here: there is nothing to ask for.
  if (input.standalone) return null;
  if (input.history.neverAgain) return null;
  if (input.shownThisSession) return null;
  if (!nudgeDue(input.history, input.now)) return null;

  const stage = input.history.dismissals;
  // The first ask earns the full screen. After someone has said no once, a
  // banner is as much room as the question deserves.
  return { surface: stage === 0 ? "walkthrough" : "banner", stage };
}
