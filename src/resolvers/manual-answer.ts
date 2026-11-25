import type { ContextResult } from "../context";
import type { Kind } from "../lang/packs";
import type { Source, SolveResult } from "./resolver";

export interface ManualInput {
  kind: Kind;
  /** What the user typed. */
  answer: string;
  /** `sic` only: does the claim hold? */
  verdict?: "confirmed" | "corrected";
  /** Optional: a web link, or free text (a book, "from memory"). */
  source: string;
}

export type ManualOutcome = { ok: true; result: SolveResult } | { ok: false; error: string };

export const MANUAL_RESOLVER = "manual";

/** A line that starts a Markdown heading. The history note's candidates are found by their headings. */
const HEADING_LINE = /^ {0,3}#{1,6}(?:\s|$)/m;

/** A link becomes `{ title: host, url }`; anything else is kept as the reference it is. */
export function parseSource(raw: string): Source | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      return { title: new URL(text).hostname.replace(/^www\./, ""), url: text };
    } catch {
      // Not a valid address after all: fall through and keep the text.
    }
  }
  return { title: text };
}

/**
 * Check what the user typed in the "Answer myself" dialog and turn it into the same result
 * a model would give: one candidate. A confirmed `sic` needs no text, because the
 * sentence is left as it is and only the citation is added.
 */
export function validateManualAnswer(input: ManualInput): ManualOutcome {
  const confirmed = input.kind === "sic" && input.verdict === "confirmed";
  let answer = input.answer.trim();
  if (answer === "") {
    if (!confirmed) return { ok: false, error: "Write the answer first." };
    answer = "Confirmed.";
  }
  if (HEADING_LINE.test(answer)) {
    return { ok: false, error: "The answer can't have a heading: remove the # at the start of a line." };
  }

  const source = parseSource(input.source);
  return {
    ok: true,
    result: {
      resolver: MANUAL_RESOLVER,
      verdict: input.kind === "sic" ? (input.verdict ?? "corrected") : undefined,
      candidates: [{ answer, sources: source ? [source] : [] }],
    },
  };
}

/** How a stretch of the context is drawn in the dialog. */
export type ContextRole = "muted" | "plain" | "claim" | "marker";

export interface ContextPiece {
  text: string;
  role: ContextRole;
}

/**
 * Cut the context (the marker's paragraph and its neighbours) into pieces to draw:
 * the neighbouring paragraphs muted, the marker's own paragraph plain, the marker and,
 * for `sic`, the claim it checks highlighted. Joining the texts gives back `ctx.text`.
 */
export function splitContext(ctx: ContextResult, claim?: string): ContextPiece[] {
  const { text, markerStart, markerEnd } = ctx;
  const blank = /\r?\n[ \t]*\r?\n/g;

  let paraStart = 0;
  let paraEnd = text.length;
  let m: RegExpExecArray | null;
  while ((m = blank.exec(text))) {
    if (m.index + m[0].length <= markerStart) paraStart = m.index + m[0].length;
    else if (m.index >= markerEnd) {
      paraEnd = m.index;
      break;
    }
  }

  const head = text.slice(paraStart, markerStart);
  const claimAt = claim ? head.lastIndexOf(claim) : -1;

  const pieces: ContextPiece[] = [{ text: text.slice(0, paraStart), role: "muted" }];
  if (claimAt >= 0 && claim) {
    pieces.push(
      { text: head.slice(0, claimAt), role: "plain" },
      { text: claim, role: "claim" },
      { text: head.slice(claimAt + claim.length), role: "plain" },
    );
  } else {
    pieces.push({ text: head, role: "plain" });
  }
  pieces.push(
    { text: text.slice(markerStart, markerEnd), role: "marker" },
    { text: text.slice(markerEnd, paraEnd), role: "plain" },
    { text: text.slice(paraEnd), role: "muted" },
  );
  return pieces.filter((p) => p.text !== "");
}
