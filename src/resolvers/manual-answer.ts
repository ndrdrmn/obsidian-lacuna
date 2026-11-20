import type { Kind } from "../lang/packs";
import type { SolveResult } from "./resolver";

export interface ManualInput {
  kind: Kind;
  /** What the user typed. */
  answer: string;
  /** `sic` only: does the claim hold? */
  verdict?: "confirmed" | "corrected";
  /** Optional link to where the answer comes from. */
  sourceUrl: string;
}

export type ManualOutcome = { ok: true; result: SolveResult } | { ok: false; error: string };

export const MANUAL_RESOLVER = "manual";

/**
 * Check what the user typed in the "Answer myself" dialog and turn it into the same result
 * a model would give: one candidate. A confirmed `sic` needs no text, because the
 * sentence is left as it is and only the citation is added.
 */
export function validateManualAnswer(input: ManualInput): ManualOutcome {
  const url = input.sourceUrl.trim();
  if (url !== "" && !/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, error: "The source must be a web link, starting with http:// or https://." };
  }

  const confirmed = input.kind === "sic" && input.verdict === "confirmed";
  let answer = input.answer.trim();
  if (answer === "") {
    if (!confirmed) return { ok: false, error: "Write the answer first." };
    answer = "Confirmed.";
  }

  return {
    ok: true,
    result: {
      resolver: MANUAL_RESOLVER,
      verdict: input.kind === "sic" ? (input.verdict ?? "corrected") : undefined,
      candidates: [{ answer, sources: url === "" ? [] : [{ title: url, url }] }],
    },
  };
}
