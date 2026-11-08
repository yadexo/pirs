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

/** How long a browser-tab client's "Install the app" card stays closed. Matches the install nudge's own. */
export const INSTALL_CARD_HIDDEN_DAYS = 30;

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

export type PromptSurface = "sheet" | "card" | "install" | "settings-help";

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
  /** When the client last closed the "install the app" card on this device, ms since epoch. */
  installClosedAt: number | null;
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
  const { state, permission, standalone, history, installClosedAt, now } = input;
  const stage = history.declines;

  switch (state) {
    case "loading":
    case "unsupported":
    case "unconfigured":
    case "on":
      return null;

    // A browser tab on an iPhone can't get notifications at all, so the one
    // useful thing to say is how to install. Closing it is not a decision
    // about notifications — it is not counted, or a client who dismissed it
    // in Safari would then wait days for the sheet in the app they installed.
    case "install-first":
      if (installClosedAt !== null && now - installClosedAt < INSTALL_CARD_HIDDEN_DAYS * DAY_MS) return null;
      return { surface: "install", stage: 0 };

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
