import type { Kind } from "./lang/packs";
import { OTHER_GAP, type Span } from "./context";
import { lineKind } from "./marker";

/**
 * The id of the footnote of history note number `n`: `lac-122`. A footnote belongs to one answer.
 * An article that already uses it (a passage copied from another one) gets `lac-122-2`, and so on.
 */
export function footnoteIdFor(n: number, noteText: string): string {
  for (let k = 1; k < 1000; k++) {
    const id = k === 1 ? `lac-${n}` : `lac-${n}-${k}`;
    if (!new RegExp(`\\^${id}(?![\\w-])`).test(noteText)) return id;
  }
  throw new Error("Could not find an unused footnote id");
}

/**
 * The id of the next block anchor of an article: `adloc-1`, `adloc-2`... An anchor belongs to a
 * paragraph, which can hold several lacunae, so it is numbered within the article and is not
 * named after any history note.
 */
export function blockAnchorIdFor(noteText: string): string {
  let max = 0;
  for (const m of noteText.matchAll(/\^adloc-(\d+)(?![\w-])/g)) max = Math.max(max, Number(m[1]));
  return `adloc-${max + 1}`;
}

export type CitationStyle = "footnote" | "inline";

export interface Citation {
  /** What goes in the text, right after the answer. */
  inline: string;
  /** Footnote style only: the definition to add at the end of the note. */
  definition?: string;
}

/** What the footnote says about the question, on one line and not too long. */
function footnoteQuestion(question: string): string {
  const one = question.replace(/\s+/g, " ").replace(/\[/g, "(").replace(/\]/g, ")").trim();
  if (one === "") return ".";
  const short = one.length > 80 ? `${one.slice(0, 79).trimEnd()}…` : one;
  return `: “${short}”.`;
}

/**
 * `link` is the link to the history note, already built with
 * `app.fileManager.generateMarkdownLink` so that it survives renames.
 * `id` and `question` are for the footnote style, whose definition reads
 * `See <link>: “question”.`
 */
export function buildCitation(style: CitationStyle, link: string, id?: string, question = ""): Citation {
  if (style === "footnote") {
    if (!id) throw new Error("A footnote citation needs an id");
    return { inline: `[^${id}]`, definition: `[^${id}]: See ${link}${footnoteQuestion(question)}` };
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

/** What the reader sees in a footnote: `Lacuna #122`. */
export function footnoteLabel(noteId: number): string {
  return `Lacuna #${noteId}`;
}

export interface Anchor {
  /** The block id the history note can link to (without the `^`), or null when the block cannot take one. */
  id: string | null;
  /** The edit that writes the anchor, or null when there is nothing to write (an existing one is reused). */
  edit: Edit | null;
}

const HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]/;
const QUOTE_LINE = /^[ \t]*>/;
const TABLE_LINE = /^[ \t]*\|/;
const BLANK_LINE = /^[ \t]*\r?$/;
const ANCHOR_AT_END = /[ \t]\^([A-Za-z0-9-]+)[ \t]*\r?$/;
const ANCHOR_LINE = /^\^([A-Za-z0-9-]+)[ \t]*\r?$/;

/**
 * An invisible anchor for the block that holds the marker, so that the history note can link
 * back to the answer: a block id (`^lac-122`). In a paragraph or a list item it goes at the
 * end of the last line; a table or a quote takes it on a line of its own after a blank line.
 * A block that already has an id keeps it. A heading cannot take one.
 */
export function planAnchor(text: string, span: Span, id: string): Anchor {
  const lines: { end: number; start: number; text: string }[] = [];
  let pos = 0;
  for (const t of text.split("\n")) {
    lines.push({ start: pos, end: pos + t.length, text: t });
    pos += t.length + 1;
  }
  const lineAt = (offset: number): number => Math.max(0, lines.findIndex((l) => offset >= l.start && offset <= l.end));
  const first = lineAt(span.start);
  const last = lineAt(span.end - 1);
  if (HEADING_LINE.test(lines[first].text)) return { id: null, edit: null };

  // The last line of the block, and whether the anchor needs a line of its own.
  let end = last;
  let ownLine = true;
  const extend = (belongs: (line: string) => boolean): void => {
    while (end + 1 < lines.length && belongs(lines[end + 1].text)) end++;
  };
  if (QUOTE_LINE.test(lines[last].text)) extend((l) => QUOTE_LINE.test(l));
  else if (TABLE_LINE.test(lines[last].text)) extend((l) => TABLE_LINE.test(l));
  else {
    ownLine = false;
    extend((l) => lineKind(l) === "text" && !QUOTE_LINE.test(l));
  }

  const lastLine = lines[end];
  if (!ownLine) {
    const m = ANCHOR_AT_END.exec(lastLine.text);
    if (m) return { id: m[1], edit: null };
  } else if (end + 2 < lines.length && BLANK_LINE.test(lines[end + 1].text)) {
    const m = ANCHOR_LINE.exec(lines[end + 2].text);
    if (m) return { id: m[1], edit: null };
  }

  const at = lastLine.end - (lastLine.text.endsWith("\r") ? 1 : 0);
  if (!ownLine) return { id, edit: { from: at, to: at, insert: ` ^${id}` } };
  // Blank line before the anchor, and one after it when text follows.
  const next = lines[end + 1];
  const tail = next !== undefined && !BLANK_LINE.test(next.text) ? "\n" : "";
  return { id, edit: { from: at, to: at, insert: `\n\n^${id}${tail}` } };
}

export interface AcceptInput {
  kind: Kind;
  /** The chosen or edited answer. */
  answer: string;
  /** Required for `sic`. */
  verdict?: "confirmed" | "corrected";
  style: CitationStyle;
  /** The link to the history note, built with `generateMarkdownLink`: labelled `footnoteLabel` or `CITATION_LABEL`, by style. */
  link: string;
  /** The id of the footnote: see `footnoteIdFor`. */
  footnoteId: string;
  /** The id of the block anchor, used when the paragraph has none yet: see `blockAnchorIdFor`. */
  anchorId: string;
  /** What the footnote says the lacuna was about. */
  question: string;
}

export interface AcceptPlan {
  /** Apply together. Never two at the same offset, so the order does not matter. */
  edits: Edit[];
  /** The block id of the answer in the text, or null when it has none (a heading). */
  anchor: string | null;
  /** The answered passage in a few words, to say which of several lacunae of a paragraph this was. */
  excerpt: string;
}

/**
 * Everything an accepted answer changes in the article, as edits to apply together:
 * the marker becomes the answer and its citation, a footnote definition is added at the end
 * of the note when the style asks for one, and the block gets an anchor. Applying them in
 * one go makes one undo step in the editor.
 */
export function planAccept(text: string, span: Span, input: AcceptInput): AcceptPlan {
  const cite = buildCitation(input.style, input.link, input.footnoteId, input.question);
  const replacement = buildReplacement({
    kind: input.kind,
    answer: input.answer,
    cite: cite.inline,
    block: isBlockMarker(text, span),
    verdict: input.verdict,
  });
  const edits = [markerEdit(text, span, replacement)];
  const footnote = cite.definition ? footnoteEdit(text, cite.definition) : null;
  const anchor = planAnchor(text, span, input.anchorId);
  if (anchor.edit) {
    // The block can end where the note ends. One edit there, not two at the same offset.
    if (footnote && footnote.from === anchor.edit.from) footnote.insert = anchor.edit.insert + footnote.insert;
    else edits.push(anchor.edit);
  }
  if (footnote) edits.push(footnote);
  const shown =
    input.kind === "sic" ? (input.verdict === "confirmed" ? "" : `(actually: ${input.answer})`) : input.answer;
  return { edits, anchor: anchor.id, excerpt: answerExcerpt(text, span, shown) };
}

/** Markdown that would act in a note that quotes it, made harmless; another lacuna becomes `[…]`. */
function tidy(s: string): string {
  return s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1") // [[note|label]] -> label
    .replace(/\[\^[^\]]*\]/g, "") // footnote references
    .replace(/[ \t]\^[A-Za-z0-9-]+(?=\s|$)/g, "") // block ids
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/==\?(?:(?!\r?\n[ \t]*\r?\n)[\s\S])*?==/g, OTHER_GAP)
    .replace(/\s+/g, " ");
}

/**
 * The answered passage in a few words: some of the paragraph before the marker, what was put
 * there (`shown`), and some of what follows. Said in the history note beside the link to the
 * paragraph, because a paragraph can hold several lacunae and its link cannot tell them apart.
 */
export function answerExcerpt(text: string, span: Span, shown: string, side = 45, max = 80): string {
  let lo = 0;
  let hi = text.length;
  const sep = /\r?\n[ \t]*\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = sep.exec(text))) {
    if (m.index + m[0].length <= span.start) lo = m.index + m[0].length;
    else if (m.index >= span.end) {
      hi = m.index;
      break;
    }
  }

  let before = tidy(text.slice(lo, span.start)).replace(/^ /, "");
  if (before.length > side) {
    const cut = before.slice(-side);
    const space = cut.indexOf(" ");
    before = `…${space >= 0 ? cut.slice(space + 1) : cut}`;
  }
  let after = tidy(text.slice(span.end, hi));
  if (after.length > side) {
    const cut = after.slice(0, side);
    const space = cut.lastIndexOf(" ");
    after = `${space > 0 ? cut.slice(0, space) : cut}…`;
  }
  let what = tidy(shown).trim();
  if (what.length > max) what = `${what.slice(0, max - 1).trimEnd()}…`;
  // Nothing was put in the text (a claim confirmed): the passage is what stands before the citation.
  if (what === "") return `${before.trimEnd()}${after}`.trim();
  return `${before}${what}${after}`.trim();
}
