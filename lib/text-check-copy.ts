import type { TextIssue } from "@/lib/text-check";

/**
 * Turns a detected issue into the sentence shown to the clinic — kept out of
 * lib/text-check.ts so that module stays a pure, locale-agnostic matcher.
 * `t` is a next-intl translator scoped to the "textCheck" namespace, from
 * either useTranslations (the live editor) or getTranslations (the
 * publish-time guard) — whichever the caller has.
 */
type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

export function issueCopy(issue: TextIssue, t: Translator): { message: string; fix: string } {
  switch (issue.rule) {
    case "result-promise":
      return { message: t("resultPromise.message", { match: issue.match }), fix: t("resultPromise.fix") };
    case "prescription-name":
      return { message: t("prescriptionName.message", { match: issue.match }), fix: t("prescriptionName.fix") };
    case "free":
      return {
        message: t(issue.conditional ? "free.conditionalMessage" : "free.message", { match: issue.match }),
        fix: t("free.fix"),
      };
    case "urgency-without-date":
      return { message: t("urgencyWithoutDate.message", { match: issue.match }), fix: t("urgencyWithoutDate.fix") };
    case "results-vary":
      return { message: t("resultsVary.message"), fix: t("resultsVary.fix") };
    default:
      return { message: issue.match, fix: "" };
  }
}
