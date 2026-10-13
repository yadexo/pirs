import { ActionError } from "@/lib/action-error";
import { blockingCount, checkFields, type TextCheckInput } from "@/lib/text-check";

/**
 * Refuses to publish text that breaks the content rules.
 *
 * The editor runs the same check while the clinic types; this is the one that
 * decides. A browser can be worked around, and the rules here are about what a
 * clinic may tell its clients — not a nicety of the form.
 *
 * Only blocking issues stop a save. Advice stays advice.
 */
export function assertTextIsPublishable(fields: Record<string, TextCheckInput | undefined>): void {
  const byField = checkFields(fields);
  const blocking = Object.values(byField).flat().filter((i) => i.level === "block");
  if (blocking.length === 0) return;

  const fieldErrors: Record<string, string> = {};
  for (const [name, issues] of Object.entries(byField)) {
    const first = issues.find((i) => i.level === "block");
    if (first) fieldErrors[name] = `${first.message} ${first.fix}`;
  }

  const count = blockingCount(blocking);
  throw new ActionError(`Fix ${count} issue${count === 1 ? "" : "s"} to publish.`, fieldErrors);
}
