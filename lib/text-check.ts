/**
 * The text check: what a clinic may promise its clients in writing.
 *
 * Clinics write offers, product descriptions and messages themselves, and the
 * things they most want to write are the things advertising rules forbid — a
 * guaranteed result, the name of a prescription medicine, "free" for something
 * paid for with points, a deadline with no date. This runs while they type and
 * says what to write instead.
 *
 * Two deliberate limits. It never edits anybody's words: it points at the
 * phrase and suggests a replacement, and a human decides. And it is not legal
 * advice — it catches the common cases and the handoff says the final copy
 * still wants a review. So a warning that cannot be proven wrong blocks, and
 * anything softer only advises.
 */

export type IssueLevel =
  /** Blocks publishing. The claim is one a clinic may not make at all. */
  | "block"
  /** Shown, but publishing is allowed. Usually missing context rather than a wrong claim. */
  | "warn";

export interface TextIssue {
  level: IssueLevel;
  /**
   * A stable key, for tests, for counting "Fix 1 issue to publish", and for
   * looking up the message and fix text a caller shows — this module only
   * detects, it never builds the sentence. One rule ("free") has two message
   * variants, picked by `conditional`; everything else has exactly one.
   * Message keys live under `textCheck.<camelCase(rule)>` in messages/*.json
   * (e.g. "result-promise" → textCheck.resultPromise), so clinic staff see
   * the explanation in their own portal language.
   */
  rule: string;
  /** The words in the text that triggered it, as the clinic wrote them. */
  match: string;
  /** Only set on the "free" rule — which of its two message variants applies. */
  conditional?: boolean;
}

export interface TextCheckInput {
  /** Everything a client will read, in the order they read it. */
  text: string;
  /**
   * Set when the text is attached to something with a real end date. An offer
   * without one cannot use urgency words; a product description has no
   * deadline to be wrong about, so it passes this rule by not being an offer.
   */
  hasEndDate?: boolean;
  /**
   * Set when the thing being described genuinely costs the client nothing —
   * not "free with a purchase", and never a reward, which is paid for with
   * points somebody earned.
   */
  costsNothing?: boolean;
}

/* ----------------------------------------------------------------- rules */

/**
 * Result promises. The rule is not about the word but about the promise: a
 * clinic may describe what a treatment does, not guarantee what it will do for
 * a particular person.
 */
const RESULT_PROMISES = [
  "guaranteed",
  "guarantee",
  "guarantees",
  "permanent",
  "permanently",
  "pain-free",
  "pain free",
  "painless",
  "risk-free",
  "risk free",
  "no risk",
  "100% effective",
  "100% safe",
  "completely safe",
  "always works",
  "proven results",
  "guaranteed results",
  "miracle",
  "cure",
  "cures",
  // Dutch equivalents — a clinic typing in Dutch should trip the same rules.
  // ("permanent" is spelled the same in both languages, so it's not repeated.)
  "gegarandeerd",
  "garantie",
  "pijnloos",
  "risicovrij",
  "zonder risico",
  "100% effectief",
  "100% veilig",
  "volledig veilig",
  "werkt altijd",
  "bewezen resultaten",
  "gegarandeerde resultaten",
  "wondermiddel",
  "geneest",
];

/**
 * Prescription-only medicines. Naming one in an offer or a description is
 * advertising a prescription medicine to the public, which is what the rule
 * forbids — the treatment has a name of its own and that is what to use.
 *
 * Deliberately the common injectables and weight-loss brands a clinic would
 * reach for; it is not a pharmacopoeia, and the list is easy to extend.
 */
const PRESCRIPTION_NAMES = [
  "botox",
  "botulinum",
  "dysport",
  "azzalure",
  "bocouture",
  "xeomin",
  "vistabel",
  "juvederm",
  "restylane",
  "ozempic",
  "wegovy",
  "saxenda",
  "mounjaro",
  "semaglutide",
  "tirzepatide",
  "liraglutide",
  "isotretinoin",
  "roaccutane",
  "accutane",
  "tretinoin",
  "hydroquinone",
  "finasteride",
  "minoxidil",
];

/** Urgency: allowed, but only next to a date the client can hold you to. */
const URGENCY = [
  "hurry",
  "last chance",
  "ends soon",
  "limited time",
  "limited offer",
  "while stocks last",
  "only today",
  "today only",
  "act now",
  "don't miss",
  "dont miss",
  "selling fast",
  "almost gone",
  "final hours",
  // Dutch equivalents.
  "snel zijn",
  "laatste kans",
  "bijna op",
  "beperkte tijd",
  "beperkte aanbieding",
  "op=op",
  "alleen vandaag",
  "nu bestellen",
  "mis het niet",
  "bijna uitverkocht",
];

/** "Free" is a price, and a price has to be true. */
const FREE_WORDS = [
  "free",
  "for free",
  "no cost",
  "at no cost",
  "complimentary",
  "on the house",
  "gift",
  // Dutch equivalents.
  "gratis",
  "kosteloos",
  "cadeau",
];

/**
 * Matches a phrase as whole words, case-insensitively, so "cure" does not fire
 * inside "manicure" and "free" does not fire inside "carefree".
 */
function findPhrase(text: string, phrase: string): { match: string; start: number; end: number } | null {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const found = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(text);
  return found ? { match: found[0], start: found.index, end: found.index + found[0].length } : null;
}

/**
 * The longest phrase wins where two overlap.
 *
 * "guaranteed" and "guaranteed results" are both on the list, and a clinic
 * that wrote the second should get one message about those three words rather
 * than two.
 */
function scanPhrases(text: string, phrases: readonly string[]): { match: string; start: number; end: number }[] {
  const hits: { match: string; start: number; end: number }[] = [];
  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    const hit = findPhrase(text, phrase);
    if (!hit) continue;
    if (hits.some((h) => hit.start < h.end && h.start < hit.end)) continue;
    hits.push(hit);
  }
  return hits;
}

/** "Free" next to a word that takes the promise back is the trick, not the word. */
const FREE_IS_CONDITIONAL = /\bfree\b[^.!?]{0,40}\b(with|when|after|on orders?|purchase|minimum|spend)\b/iu;
const DUTCH_FREE_IS_CONDITIONAL = /\bgratis\b[^.!?]{0,40}\b(bij|wanneer|na|vanaf|minimaal|besteding)\b/iu;

export function checkText(input: TextCheckInput): TextIssue[] {
  const { text, hasEndDate = true, costsNothing = false } = input;
  if (!text.trim()) return [];

  const issues: TextIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: TextIssue) => {
    const key = `${issue.rule}:${issue.match.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const { match } of scanPhrases(text, RESULT_PROMISES)) {
    add({ level: "block", rule: "result-promise", match });
  }

  for (const { match } of scanPhrases(text, PRESCRIPTION_NAMES)) {
    add({ level: "block", rule: "prescription-name", match });
  }

  if (!costsNothing) {
    for (const { match } of scanPhrases(text, FREE_WORDS)) {
      // "Free with any facial" is the one worth blocking: it reads as free and
      // is not. A plain "free" on something that costs money is the same lie.
      add({ level: "block", rule: "free", match, conditional: FREE_IS_CONDITIONAL.test(text) || DUTCH_FREE_IS_CONDITIONAL.test(text) });
    }
  }

  if (!hasEndDate) {
    for (const { match } of scanPhrases(text, URGENCY)) {
      add({ level: "block", rule: "urgency-without-date", match });
    }
  }

  // Advice rather than a refusal: a treatment description that never says
  // results vary is incomplete, not a false claim.
  const mentionsResults = /\b(results?|resultaten|resultaat)\b/iu.test(text);
  const hasDisclaimer = /results\s+vary|(resultaten|resultaat)\s+(kunnen\s+)?vari[eë]ren/iu.test(text);
  if (mentionsResults && !hasDisclaimer && !issues.some((i) => i.rule === "result-promise")) {
    add({ level: "warn", rule: "results-vary", match: "results" });
  }

  return issues;
}

/** Nothing may be published while a block is open; warnings are advice. */
export function blocksPublishing(issues: TextIssue[]): boolean {
  return issues.some((i) => i.level === "block");
}

/** "Fix 1 issue to publish" — only the blocking ones are counted. */
export function blockingCount(issues: TextIssue[]): number {
  return issues.filter((i) => i.level === "block").length;
}

/** Runs the check over several fields at once, keeping each field's issues. */
export function checkFields(fields: Record<string, TextCheckInput | undefined>): Record<string, TextIssue[]> {
  const out: Record<string, TextIssue[]> = {};
  for (const [name, input] of Object.entries(fields)) {
    if (!input) continue;
    const issues = checkText(input);
    if (issues.length > 0) out[name] = issues;
  }
  return out;
}
