import type { Kind } from "./lang/packs";
import type { Verdict } from "./resolvers/resolver";

/**
 * What the review dialog offers for a history note:
 * - `pick`: each candidate is an answer to accept (or to edit, then accept);
 * - `confirm`: a `sic` whose claim is right, which has nothing to replace: a single Accept that
 *   only adds the citation;
 * - `none`: nothing to accept, because Claude could not tell. Only reject or search again.
 */
export type ReviewMode = "pick" | "confirm" | "none";

export function reviewMode(kind: Kind, verdict: Verdict | undefined): ReviewMode {
  if (kind !== "sic") return "pick";
  if (verdict === "confirmed") return "confirm";
  if (verdict === "corrected") return "pick";
  return "none"; // uncertain, or a note that has no verdict
}

/** The verdict `buildReplacement` wants: only for `sic`, and never `uncertain`. */
export function replacementVerdict(kind: Kind, verdict: Verdict | undefined): "confirmed" | "corrected" | undefined {
  if (kind !== "sic") return undefined;
  return verdict === "confirmed" || verdict === "corrected" ? verdict : undefined;
}
