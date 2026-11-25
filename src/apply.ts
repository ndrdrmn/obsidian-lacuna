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

/** Replace `[from, to)` of a text by `insert`. Offsets refer to the text before any edit. */
export interface Edit {
  from: number;
  to: number;
  insert: string;
}

export function applyEdits(text: string, edits: readonly Edit[]): string {
  // From the end, so that an edit does not move the ones before it.
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((t, e) => t.slice(0, e.from) + e.insert + t.slice(e.to), text);
}

/** The edit that replaces `[start, end)`. A citation's leading space is dropped when it would double one. */
function markerEdit(text: string, span: Span, replacement: string): Edit {
  let rep = replacement;
  if (rep.startsWith(" ") && (span.start === 0 || /\s/.test(text[span.start - 1]))) {
    rep = rep.replace(/^ +/, "");
  }
  return { from: span.start, to: span.end, insert: rep };
}

export function replaceMarker(text: string, span: Span, replacement: string): string {
  return applyEdits(text, [markerEdit(text, span, replacement)]);
}

/** Is the marker alone on its line (so that a block answer is allowed)? */
export function isBlockMarker(text: string, span: Span): boolean {
  const lineStart = text.lastIndexOf("\n", span.start - 1) + 1;
  const nl = text.indexOf("\n", span.end);
  const lineEnd = nl === -1 ? text.length : nl;
  return text.slice(lineStart, span.start).trim() === "" && text.slice(span.end, lineEnd).trim() === "";
}

/** The edit that adds a footnote definition at the end of the note, next to the existing ones if any. */
function footnoteEdit(noteText: string, definition: string): Edit {
  const body = noteText.replace(/\s+$/, "");
  if (body === "") return { from: 0, to: noteText.length, insert: `${definition}\n` };
  const lastLine = body.slice(body.lastIndexOf("\n") + 1);
  const sep = /^\[\^[^\]]+\]:/.test(lastLine) ? "\n" : "\n\n";
  return { from: body.length, to: noteText.length, insert: `${sep}${definition}\n` };
}

export function appendFootnoteDefinition(noteText: string, definition: string): string {
  return applyEdits(noteText, [footnoteEdit(noteText, definition)]);
}

/** The text of the link to a history note: what the reader sees where the marker was. */
export const CITATION_LABEL = "ad loc.";

export interface AcceptInput {
  kind: Kind;
  /** The chosen or edited answer. */
  answer: string;
  /** Required for `sic`. */
  verdict?: "confirmed" | "corrected";
  style: CitationStyle;
  /** The link to the history note, built with `generateMarkdownLink` and `CITATION_LABEL`. */
  link: string;
  /** Footnote style only: see `newFootnoteId`. */
  footnoteId?: string;
}

/**
 * Everything an accepted answer changes in the article, as edits to apply together:
 * the marker becomes the answer and its citation, and a footnote definition is added
 * at the end of the note when the style asks for one. Applying them in one go makes
 * one undo step in the editor.
 */
export function planAccept(text: string, span: Span, input: AcceptInput): Edit[] {
  const cite = buildCitation(input.style, input.link, input.footnoteId);
  const replacement = buildReplacement({
    kind: input.kind,
    answer: input.answer,
    cite: cite.inline,
    block: isBlockMarker(text, span),
    verdict: input.verdict,
  });
  const edits = [markerEdit(text, span, replacement)];
  if (cite.definition) edits.push(footnoteEdit(text, cite.definition));
  return edits;
}
