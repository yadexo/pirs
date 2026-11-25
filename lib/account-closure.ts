/**
 * Closing a client account: the word that confirms it, shared by the sheet
 * (to enable the button) and the server action (which checks it again — the
 * button is a convenience, not a guard).
 *
 * The Dutch screen asks for VERWIJDER, the English one for DELETE; either is
 * accepted in either language and any capitalisation, because phones
 * capitalise the first letter and nobody should be stuck on "Delete".
 *
 * What closing does (decisions D1–D5, round 1): every live membership is
 * cancelled immediately on Stripe, with no refund for the current period;
 * unused credit, items and package sessions lapse with the account; the
 * clinic keeps the records it must; one last email confirms it.
 */
const WORDS = new Set(["delete", "verwijder"]);

export function isDeleteConfirmation(text: string): boolean {
  return WORDS.has(text.trim().toLowerCase());
}

/** The word shown on the screen in each language. */
export function deleteWordFor(locale: "nl" | "en"): string {
  return locale === "nl" ? "VERWIJDER" : "DELETE";
}
