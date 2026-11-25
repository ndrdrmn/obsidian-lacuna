import { OTHER_GAP, blankOtherMarkers, type ContextResult } from "./context";
import type { Kind } from "./lang/packs";

export interface PromptRequest {
  kind: Kind;
  question: string;
  noteTitle: string;
  context: ContextResult;
  /** `sic` only: the claim to verify (see `extractClaim`). */
  claim?: string;
  /** True when the marker is inside a line of text, false when it is alone on its line. */
  inline: boolean;
  /** Answers the author already rejected, so that a retry does not repeat them. */
  rejected: string[];
  maxCandidates: number;
}

export const GAP = "⟦GAP⟧";

const TASKS: Record<Exclude<Kind, "sic">, string> = {
  suppl:
    "Supply the missing information that the question asks for. Each answer is the exact text that will " +
    "replace the gap in the passage: concise, in the same register and style as the surrounding text, " +
    "with no preamble, no explanation and no mention of sources.",
  fontes:
    "Find the most reliable sources for what the passage says around the gap; the question narrows what " +
    "to look for. Each answer is a short mention naming the source (for example author, title and year), " +
    "suitable to appear in the text in place of the gap.",
  glossa:
    "Explain what the question asks, for the readers of this text: accurate, self-contained and no longer " +
    "than needed. Each answer is the explanatory text that will replace the gap.",
  cf:
    "Compare the things the question asks about: the points that matter, accurate and balanced. Each answer " +
    "is the comparison text that will replace the gap.",
};

function sicTask(claim: string | undefined): string {
  const what = claim
    ? `Check the claim that comes right before the gap: "${claim}". The question may narrow the check.`
    : "The claim to check is not directly before the gap; rely on the question and the passage.";
  return (
    `${what} Set "verdict" to "confirmed" if reliable sources support the claim, "corrected" if it is wrong ` +
    `or inaccurate, or "uncertain" if you cannot tell. If confirmed, give one candidate whose answer restates ` +
    `the verified fact in one short sentence. If corrected, each answer is only the corrected information, ` +
    `phrased so that it can follow the words "actually:".`
  );
}

export function buildPrompt(r: PromptRequest): string {
  // The other lacunae of the passage are not this question: they must not read as ones.
  const context = blankOtherMarkers(r.context);
  const passage =
    context.text.slice(0, context.markerStart) + GAP + context.text.slice(context.markerEnd);

  const parts: string[] = [];
  parts.push(
    "You are a careful research assistant helping an author fill a gap in a draft. Use web search and page " +
      "fetching to find reliable, verifiable information. Never invent a source or a URL: every source must be " +
      "a page you actually retrieved.",
  );
  parts.push(
    "Language: write every answer in the language of the passage below, not in the language of these instructions.",
  );
  parts.push(`Note title: ${r.noteTitle}`);
  parts.push(
    `The passage comes from the author's draft. The gap is marked ${GAP}.` +
      (passage.includes(OTHER_GAP)
        ? ` Other gaps, marked ${OTHER_GAP}, are separate questions that are not yours to answer: ignore them.`
        : "") +
      `\n<passage>\n${passage}\n</passage>`,
  );
  parts.push(`Task (kind: ${r.kind}): ${r.kind === "sic" ? sicTask(r.claim) : TASKS[r.kind]}`);
  parts.push(`Question: ${r.question === "" ? "(none given)" : r.question}`);
  parts.push(
    r.inline
      ? "The gap sits inside a line of text: each answer must be a single line of plain text, with no line " +
          "breaks, lists or tables."
      : "The gap is alone on its line: an answer may use several paragraphs, a list or a Markdown table when " +
          "that is the clearest form.",
  );
  if (r.rejected.length > 0) {
    parts.push(
      "The author already rejected these answers. Do not propose them again, nor close variants:\n" +
        r.rejected.map((a) => `- ${a}`).join("\n"),
    );
  }
  parts.push(
    `Return at most ${r.maxCandidates} candidate${r.maxCandidates === 1 ? "" : "s"}, best first. Each candidate ` +
      `has an answer and at least one source (title, url, and a short verbatim quote when you can). The field ` +
      `"verdict" is only for the kind "sic": omit it for every other kind.`,
  );
  parts.push(
    "Every candidate answers this gap only. The sources of a candidate, and the quotes you give, must support " +
      "that very answer: never attach a source that supports a different answer, or one that answers another " +
      "question. Return fewer candidates rather than one you found no support for.",
  );
  return parts.join("\n\n");
}
