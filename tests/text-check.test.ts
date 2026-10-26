import { describe, it, expect } from "vitest";
import { checkText, blocksPublishing, blockingCount, checkFields } from "@/lib/text-check";

/**
 * The text check reads what a clinic wrote and says what it may not promise.
 * The tests that matter most are the ones about *not* firing: a check that
 * cries wolf is one clinics learn to click past.
 */

const rules = (text: string, extra = {}) => checkText({ text, ...extra }).map((i) => i.rule);

describe("result promises", () => {
  it("refuses a guaranteed result", () => {
    expect(rules("With guaranteed results.")).toContain("result-promise");
  });

  it("refuses the other ways of promising one", () => {
    for (const text of ["Permanent hair removal", "A completely safe treatment", "Pain-free and quick", "This cures acne"]) {
      expect(rules(text), text).toContain("result-promise");
    }
  });

  it("names the exact phrase it matched", () => {
    const issue = checkText({ text: "Guaranteed results." })[0]!;
    expect(issue.rule).toBe("result-promise");
    expect(issue.match.toLowerCase()).toBe("guaranteed results");
  });

  it("does not fire inside an innocent word", () => {
    // "manicure" contains "cure".
    expect(rules("Manicure and pedicure")).not.toContain("result-promise");
  });
});

describe("prescription medicines", () => {
  it("refuses one named in an offer", () => {
    expect(rules("20% off Botox this month until 31 Oct")).toContain("prescription-name");
  });

  it("refuses the weight-loss brands too", () => {
    for (const text of ["Ozempic consultations", "Now offering Wegovy", "semaglutide programme"]) {
      expect(rules(text), text).toContain("prescription-name");
    }
  });

  it("names the exact medicine it matched", () => {
    expect(checkText({ text: "Botox" })[0]!.match.toLowerCase()).toBe("botox");
  });

  it("leaves an ordinary treatment name alone", () => {
    expect(rules("Hydrafacial Signature, 60 minutes")).toEqual([]);
  });
});

describe("“free”", () => {
  it("refuses it for something that costs money", () => {
    expect(rules("Free LED session")).toContain("free");
  });

  it("flags the conditional kind as conditional", () => {
    const issue = checkText({ text: "Free peel with any facial" }).find((i) => i.rule === "free")!;
    expect(issue.conditional).toBe(true);
  });

  it("allows it when the thing really is free", () => {
    expect(rules("Free consultation, no purchase needed", { costsNothing: true })).not.toContain("free");
  });

  it("does not fire inside another word", () => {
    expect(rules("A carefree afternoon")).not.toContain("free");
  });
});

describe("urgency", () => {
  it("refuses a deadline that does not exist", () => {
    expect(rules("Hurry, limited time!", { hasEndDate: false })).toContain("urgency-without-date");
  });

  it("allows it once there is a real end date", () => {
    expect(rules("Last chance — ends 31 Oct", { hasEndDate: true })).not.toContain("urgency-without-date");
  });

  it("names the exact urgency phrase it matched", () => {
    const issue = checkText({ text: "Act now", hasEndDate: false })[0]!;
    expect(issue.match.toLowerCase()).toBe("act now");
  });
});

describe("results vary", () => {
  it("advises adding it when results are discussed", () => {
    const issues = checkText({ text: "You'll see results after three sessions." });
    expect(issues.map((i) => i.rule)).toContain("results-vary");
    expect(issues.find((i) => i.rule === "results-vary")!.level).toBe("warn");
  });

  it("says nothing once it is there", () => {
    expect(rules("You may see results after three sessions. Results vary per person.")).toEqual([]);
  });

  it("does not pile on when the real problem is a promise", () => {
    // One clear message beats two about the same sentence.
    expect(rules("Guaranteed results in three sessions")).not.toContain("results-vary");
  });
});

describe("Dutch phrases", () => {
  it("catches the Dutch versions of a result promise", () => {
    for (const text of ["Gegarandeerd resultaat", "Pijnloos en snel", "100% veilig"]) {
      expect(rules(text), text).toContain("result-promise");
    }
  });

  it("catches the Dutch word for free", () => {
    expect(rules("Gratis LED-sessie")).toContain("free");
  });

  it("catches the Dutch conditional 'gratis'", () => {
    const issue = checkText({ text: "Gratis peeling bij elke facial" }).find((i) => i.rule === "free")!;
    expect(issue.conditional).toBe(true);
  });

  it("catches Dutch urgency without an end date", () => {
    expect(rules("Op=op, snel zijn!", { hasEndDate: false })).toContain("urgency-without-date");
  });

  it("recognises the Dutch results-vary disclaimer", () => {
    expect(rules("Je ziet resultaat na drie behandelingen. Resultaten kunnen variëren.")).toEqual([]);
  });
});

describe("what blocks publishing", () => {
  it("is the claims a clinic may not make", () => {
    expect(blocksPublishing(checkText({ text: "Guaranteed results" }))).toBe(true);
    expect(blocksPublishing(checkText({ text: "Botox" }))).toBe(true);
  });

  it("is not the advice", () => {
    const issues = checkText({ text: "Great results here." });
    expect(issues).toHaveLength(1);
    expect(blocksPublishing(issues)).toBe(false);
  });

  it("counts only what has to be fixed, for “Fix 1 issue to publish”", () => {
    const issues = checkText({ text: "Guaranteed results with Botox." });
    expect(blockingCount(issues)).toBe(2);
  });

  it("lets clean text through", () => {
    const text = "Deep cleanse, gentle exfoliation and hydration in 60 minutes. Results vary per person.";
    expect(checkText({ text })).toEqual([]);
    expect(blocksPublishing(checkText({ text }))).toBe(false);
  });

  it("says nothing at all about an empty field", () => {
    expect(checkText({ text: "" })).toEqual([]);
    expect(checkText({ text: "   " })).toEqual([]);
  });
});

describe("checking a whole form", () => {
  it("keeps each field's issues under that field", () => {
    const found = checkFields({
      title: { text: "Free Botox", hasEndDate: true },
      description: { text: "Deep cleanse. Results vary per person." },
      missing: undefined,
    });
    expect(Object.keys(found)).toEqual(["title"]);
    expect(found.title!.map((i) => i.rule).sort()).toEqual(["free", "prescription-name"]);
  });

  it("does not repeat one word twice in a field", () => {
    const issues = checkText({ text: "Guaranteed. Really, guaranteed." });
    expect(issues.filter((i) => i.rule === "result-promise")).toHaveLength(1);
  });
});

/* ------------------------------------------------- enforced on the server */

describe("where the check is enforced", () => {
  it("runs on the server, not only in the browser", async () => {
    const { readFileSync } = await import("node:fs");
    const actions = readFileSync("lib/actions/app-builder.ts", "utf8");
    // Offers, treatments and products: everything a client reads.
    expect(actions.match(/assertTextIsPublishable/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("stops a publish and lets a draft through", async () => {
    const { assertTextIsPublishable } = await import("@/lib/text-check-guard");
    await expect(assertTextIsPublishable({ title: { text: "Guaranteed results" } })).rejects.toThrow(/Fix 1 issue to publish/);
    await expect(assertTextIsPublishable({ title: { text: "Autumn skin reset" } })).resolves.toBeUndefined();
  });

  it("puts the message under the field it is about", async () => {
    const { assertTextIsPublishable } = await import("@/lib/text-check-guard");
    try {
      await assertTextIsPublishable({ title: { text: "Free Botox" }, description: { text: "Fine." } });
      throw new Error("should have thrown");
    } catch (err) {
      const fieldErrors = (err as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
      expect(Object.keys(fieldErrors)).toEqual(["title"]);
      expect(fieldErrors.title).toMatch(/prescription-only|costs the client nothing/);
    }
  });
});
