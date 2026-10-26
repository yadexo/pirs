import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { clientNumber, clientNumberLabel } from "@/lib/client-number";

/**
 * Scan, Rewards and Profile. Mostly about what must not be lost: a tab that
 * became a sheet still has to be reachable, and a screen that shows somebody
 * their own money has to call it the same thing everywhere.
 */

const SCAN = readFileSync("app/app/[merchantSlug]/scan/scan-view.tsx", "utf8");
const REWARDS = readFileSync("app/app/[merchantSlug]/rewards/rewards-view.tsx", "utf8");
const PROFILE = readFileSync("app/app/[merchantSlug]/profile/profile-view.tsx", "utf8");
const ITEMS = readFileSync("app/app/[merchantSlug]/profile/my-items.tsx", "utf8");

describe("the client's number", () => {
  it("is the same every time for the same client", () => {
    expect(clientNumber("cmsjqbf8h004s918kkhb7uyaa")).toBe(clientNumber("cmsjqbf8h004s918kkhb7uyaa"));
  });

  it("is eight digits, grouped so it can be read aloud", () => {
    expect(clientNumber("cmsjqbf8h004s918kkhb7uyaa")).toMatch(/^\d{4} \d{4}$/);
  });

  it("differs between clients", () => {
    const a = clientNumber("profile-one");
    const b = clientNumber("profile-two");
    expect(a).not.toBe(b);
  });

  it("carries the agency's own name, never a hardcoded one", () => {
    expect(clientNumberLabel("profile-one", "Lumière Group")).toMatch(/^Lumière Group \d{4} \d{4}$/);
    // A platform that has not named itself contributes nothing rather than a
    // default somebody else's clients would see.
    expect(clientNumberLabel("profile-one", "").trim()).toMatch(/^\d{4} \d{4}$/);
  });
});

describe("the Scan screen", () => {
  it("shows the code, who it belongs to, and what they can spend", () => {
    expect(SCAN).toMatch(/<QrCode/);
    expect(SCAN).toMatch(/clientNumber/);
    // "Points" and "Credit" are translated (messages/*.json) — the structural
    // check is that both rows are still wired to the clientApp.scan keys.
    expect(SCAN).toMatch(/t\("points"\)/);
    expect(SCAN).toMatch(/t\("credit"\)/);
  });

  it("refreshes the token, so a screenshot stops working", () => {
    expect(SCAN).toMatch(/mintScanTokenAction/);
    expect(SCAN).toMatch(/60_000/);
  });

  it("asks the client to turn the brightness up rather than doing it for them", () => {
    expect(SCAN).toMatch(/t\("tip"\)/);
    expect(SCAN).not.toMatch(/screen\.brightness|setBrightness/);
  });
});

describe("the Rewards screen", () => {
  it("separates what can be taken now from what is still being earned", () => {
    // Translated (messages/*.json clientApp.rewards.*) — check the keys stayed wired, not the English wording.
    expect(REWARDS).toMatch(/t\("readyToRedeem"\)/);
    expect(REWARDS).toMatch(/t\("keepEarning"\)/);
    expect(REWARDS).toMatch(/t\("earnFaster"\)/);
  });

  it("keeps every way of earning that the clinic configured", () => {
    for (const action of ["clientReviewAction", "clientReferralAction", "clientRedeemRewardAction"]) {
      expect(REWARDS, action).toContain(action);
    }
  });

  it("says Credit, not the old names", () => {
    expect(REWARDS).toMatch(/t\("credit"\)/);
    expect(REWARDS).not.toMatch(/Patient App Cash|account credit/i);
  });
});

describe("the Profile screen", () => {
  it("has the handoff's three tabs", () => {
    // Labels are translated (messages/*.json clientApp.profile.sections.*) — the
    // structural check is the three segment values and their tp() lookup.
    expect(PROFILE).toMatch(/SEGMENT_VALUES = \["items", "membership", "settings"\]/);
    expect(PROFILE).toMatch(/tp\(`sections\.\$\{s\}`\)/);
    // The fourth tab is gone, not its contents.
    expect(PROFILE).not.toMatch(/"treatments"/);
  });

  it("keeps appointments and orders reachable from My items", () => {
    expect(PROFILE).toMatch(/sheet === "appointments"/);
    expect(PROFILE).toMatch(/setSheet\("appointments"\)/);
    expect(PROFILE).toMatch(/setSheet\("orders"\)/);
  });

  it("keeps everything an appointment could do", () => {
    expect(PROFILE).toMatch(/clientCancelAppointmentAction/);
    expect(PROFILE).toMatch(/setReschedule/);
    expect(PROFILE).toMatch(/BookingSheet/);
  });

  it("keeps every account action, including the destructive ones", () => {
    for (const sheet of ["personal", "notifications", "payment", "balances", "referral", "language", "help", "legal", "delete"]) {
      expect(PROFILE, sheet).toContain(`setSheet("${sheet}")`);
    }
    expect(PROFILE).toMatch(/signOutOfClinicAction/);
    expect(PROFILE).toMatch(/clientCancelPlanAction/);
  });

  it("is powered by whatever the agency calls itself, or by nobody", () => {
    // Translated (messages/*.json clientApp.profile.poweredByPrefix) — the
    // structural check is that the name is still interpolated conditionally.
    expect(PROFILE).toContain('tp("poweredByPrefix", { name: platformName })');
    // A platform with no name of its own leaves no gap behind.
    expect(PROFILE).toContain("platformName ?");
  });
});

describe("My items", () => {
  it("splits what is usable from what is finished", () => {
    // Translated (messages/*.json clientApp.myItems.readyToUse / pastItems).
    expect(ITEMS).toMatch(/t\("readyToUse"\)/);
    expect(ITEMS).toMatch(/t\("pastItems"\)/);
  });

  it("still watches an open item so a redemption shows up while it is on screen", () => {
    expect(ITEMS).toMatch(/setInterval\(tick, 3000\)/);
  });

  it("still carries the code the desk scans, and the one they can type", () => {
    expect(ITEMS).toMatch(/redeemQrValue\(open\.token\)/);
    expect(ITEMS).toMatch(/ca-itemcode/);
  });
});
