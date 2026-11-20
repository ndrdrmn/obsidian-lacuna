import type { Kind } from "./lang/packs";
import type { Span } from "./context";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A fresh footnote id such as `lac-k3f9`, not yet used in `noteText`. */
export function newFootnoteId(noteText: string, rng: () => number = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = "lac-";
    for (let i = 0; i < 4; i++) id += ID_CHARS[Math.floor(rng() * ID_CHARS.length)];
    if (!noteText.includes(`[^${id}]`)) return id;
  }
  throw new Error("Could not find an unused footnote id");
}

export type CitationStyle = "footnote" | "inline";

export interface Citation {
  /** What goes in the text, right after the answer. */
  inline: string;
  /** Footnote style only: the definition to add at the end of the note. */
  definition?: string;
}

/**
 * `link` is the link to the history note, already built with
 * `app.fileManager.generateMarkdownLink` so that it survives renames.
 * `id` is required for the footnote style.
 */
export function buildCitation(style: CitationStyle, link: string, id?: string): Citation {
  if (style === "footnote") {
    if (!id) throw new Error("A footnote citation needs an id");
    return { inline: `[^${id}]`, definition: `[^${id}]: ${link}` };
  }
  return { inline: ` ${link}` };
}

export interface ReplacementInput {
  kind: Kind;
  /** The chosen or edited answer. */
  answer: string;
  /** `Citation.inline`. */
  cite: string;
  /** True when the marker sits alone on its line, so a multi-line answer is allowed. */
  block: boolean;
  /** Required for `sic`. An `uncertain` verdict has no replacement: the review UI must not offer Accept. */
  verdict?: "confirmed" | "corrected";
}

function formatAnswer(answer: string, block: boolean): string {
  const a = answer.trim();
  // Inline answers stay on one line, even if the agent returned several.
  return block ? a : a.replace(/\s*\n\s*/g, " ");
}

/** The text that replaces the marker. */
export function buildReplacement(input: ReplacementInput): string {
  const { kind, cite, block } = input;
  const answer = formatAnswer(input.answer, block);

  if (kind === "sic") {
    if (input.verdict === undefined) throw new Error("A sic replacement needs a verdict");
    // The user's sentence is never rewritten.
    if (input.verdict === "confirmed") return cite;
    return `(actually: ${answer}${cite})`;
  }

  // A citation glued to the last row of a table would break the table.
  if (block && /(^|\n)\s*\|[^\n]*$/.test(answer)) return `${answer}\n\n${cite.trimStart()}`;
  return `${answer}${cite}`;
}

/** Replace `[start, end)` of `text`. A citation's leading space is dropped when it would double one. */
export function replaceMarker(text: string, span: Span, replacement: string): string {
  let rep = replacement;
  if (rep.startsWith(" ") && (span.start === 0 || /\s/.test(text[span.start - 1]))) {
    rep = rep.replace(/^ +/, "");
  }
  return text.slice(0, span.start) + rep + text.slice(span.end);
}

/** Is the marker alone on its line (so that a block answer is allowed)? */
export function isBlockMarker(text: string, span: Span): boolean {
  const lineStart = text.lastIndexOf("\n", span.start - 1) + 1;
  const nl = text.indexOf("\n", span.end);
  const lineEnd = nl === -1 ? text.length : nl;
  return text.slice(lineStart, span.start).trim() === "" && text.slice(span.end, lineEnd).trim() === "";
}

/** Add a footnote definition at the end of the note, next to the existing ones if any. */
export function appendFootnoteDefinition(noteText: string, definition: string): string {
  const body = noteText.replace(/\s+$/, "");
  if (body === "") return `${definition}\n`;
  const lastLine = body.slice(body.lastIndexOf("\n") + 1);
  const sep = /^\[\^[^\]]+\]:/.test(lastLine) ? "\n" : "\n\n";
  return `${body}${sep}${definition}\n`;
}
