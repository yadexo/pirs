/**
 * When, and in what shape, the client app asks a client to turn notifications
 * on. Pure, with no imports, so the decision runs the same in the browser that
 * renders it and in the tests that pin it down.
 *
 * The rule in one paragraph: a client who has not decided gets a bottom sheet
 * on their first Home visit in the installed app. "Not now" starts a schedule —
 * a smaller card after 3 days, another after 14 more, then nothing for good.
 * Anyone who has granted or denied the device's own permission is never shown
 * the prompt; a denial is the one exception, and only to say how to undo it,
 * on that same schedule.
 */

/** Days to wait after the nth decline before asking again. The list's length is how many reminders there are. */
export const REMINDER_DELAYS_DAYS = [3, 14] as const;

const DAY_MS = 864e5;

/** What the server remembers about this client and the prompt. */
export interface PromptHistory {
  /** "Not now"s plus device-level denials: every time the answer was no. */
  declines: number;
  /** ISO time of the latest one, or null if there has never been one. */
  lastDeclinedAt: string | null;
  /** Whether the client has ever chosen for themselves whether to get offers. */
  offersDecided: boolean;
}

export const NO_HISTORY: PromptHistory = { declines: 0, lastDeclinedAt: null, offersDecided: false };

/** The states the notifications hook reports for this device (components/client-app/push.tsx). */
export type PushState = "loading" | "unsupported" | "install-first" | "unconfigured" | "denied" | "off" | "on";

/**
 * "install" used to be one of these: a card in a browser tab on an iPhone,
 * saying to install the app because notifications cannot work without it. The
 * install nudge owns that question now (lib/install-nudge.ts), so this asks
 * only about notifications, and only where they are possible. The INSTALL
 * value stays in the database enum, because rows were written with it.
 */
export type PromptSurface = "sheet" | "card" | "settings-help";

export interface PromptChoice {
  surface: PromptSurface;
  /** Declines so far — which step of the schedule this is. */
  stage: number;
}

export interface PromptInput {
  state: PushState;
  /** The device's own permission, or null where it can't be read. */
  permission: NotificationPermission | null;
  /** Running as an installed app rather than in a browser tab. */
  standalone: boolean;
  history: PromptHistory;
  now: number;
}

/** Is the next ask due? True before the first decline, then once the wait after the latest has passed. */
export function reminderDue(history: Pick<PromptHistory, "declines" | "lastDeclinedAt">, now: number): boolean {
  if (history.declines === 0) return true;
  // After the last reminder there is no next one.
  const wait = REMINDER_DELAYS_DAYS[history.declines - 1];
  if (wait === undefined || history.lastDeclinedAt === null) return false;
  const last = Date.parse(history.lastDeclinedAt);
  // An unreadable time must not turn into "asks on every visit".
  if (Number.isNaN(last)) return false;
  return now - last >= wait * DAY_MS;
}

/**
 * What to show on Home right now, or null for nothing.
 *
 * "Decided" is read from the device, not from us: permission "granted" or
 * "denied" means the client has already answered the real question, whatever
 * our own records say. "Not now" is the answer only we can remember.
 */
export function choosePrompt(input: PromptInput): PromptChoice | null {
  const { state, permission, standalone, history, now } = input;
  const stage = history.declines;

  switch (state) {
    case "loading":
    case "unsupported":
    case "unconfigured":
    case "on":
      return null;

    // A browser tab on an iPhone can't get notifications at all until the app
    // is installed, and asking for that is the install nudge's job now. Two
    // cards saying the same thing used to come up on this one screen — this
    // and the install prompt in the layout — in different words, each with its
    // own cooldown. Nothing here counts as an answer about notifications, so
    // the sheet still comes up on the first visit inside the installed app.
    case "install-first":
      return null;

    // Denied: never the prompt. Only, once they have said no through us and
    // the wait is over, a reminder of where the switch is.
    case "denied":
      if (stage === 0 || !reminderDue(history, now)) return null;
      return { surface: "settings-help", stage };

    case "off":
      // Granted but not subscribed means they turned it off themselves.
      if (permission === "granted") return null;
      if (!reminderDue(history, now)) return null;
      return { surface: stage === 0 && standalone ? "sheet" : "card", stage };
  }
}
