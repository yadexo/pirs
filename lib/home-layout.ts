/**
 * Which Home sections appear, and in what order.
 *
 * Kept out of lib/client-app-home.ts because that module reads the database
 * and is marked "server-only"; the screen needs this decision in the browser,
 * and importing it from there would drag the whole read layer into the client
 * bundle. The rule itself is one line and belongs to both.
 */

export type HomeSectionKey =
  | "itemsToRedeem"
  | "personalOffer"
  | "buyAgain"
  | "offers"
  | "popularTreatments"
  | "membershipPitch"
  | "products"
  | "nextReward";

/**
 * A returning client is shown what is theirs first — what they can collect,
 * their own offer, what they bought before — and the shop below it. A client
 * with nothing of their own yet would see three empty sections, so they get
 * the shop first and the points explanation last.
 */
export function homeOrder(returning: boolean): HomeSectionKey[] {
  return returning
    ? ["itemsToRedeem", "personalOffer", "buyAgain", "offers", "popularTreatments", "membershipPitch", "products", "nextReward"]
    : ["offers", "popularTreatments", "membershipPitch", "products", "nextReward"];
}
