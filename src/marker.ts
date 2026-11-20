import { normalize, type AliasEntry } from "./lang/keywords";
import { LATIN_ID, type Kind } from "./lang/packs";

export interface Marker {
  kind: Kind;
  /** Set when the keyword typed was not the Latin one: the word as typed, and its pack. */
  alias?: { word: string; packId: string };
  question: string;
  /** The full marker text, `==?…==`. It may contain line breaks. */
  raw: string;
  /** Offsets into the parsed text; `end` is exclusive. */
  start: number;
  end: number;
  /** 0-based position of the marker's first character... */
  line: number;
  ch: number;
  /** ...and just after its last one. Equal to `line` when the marker is on one line. */
  endLine: number;
  endCh: number;
}

export interface ParseOptions {
  aliasMap: Map<string, AliasEntry>;
  /** Kind of a marker without a known keyword, or null to ignore such markers. */
  defaultKind: Kind | null;
}

type Range = [number, number];

const FRONTMATTER_RE = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Length of the YAML frontmatter at the top of a note, 0 if there is none. */
export function frontmatterLength(text: string): number {
  const m = FRONTMATTER_RE.exec(text);
  return m ? m[0].length : 0;
}

/** Same length as `text`, with the given ranges blanked out (newlines are kept). */
function blank(text: string, ranges: Range[]): string {
  if (ranges.length === 0) return text;
  let out = "";
  let prev = 0;
  for (const [s, e] of ranges) {
    out += text.slice(prev, s) + text.slice(s, e).replace(/[^\n]/g, " ");
    prev = e;
  }
  return out + text.slice(prev);
}

function fencedCodeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let offset = 0;
  let fence: { char: string; len: number; start: number } | null = null;
  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    if (fence === null) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      // A backtick fence's info string cannot contain backticks (that would be inline code).
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        fence = { char: m[1][0], len: m[1].length, start: offset };
      }
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/.exec(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len) {
        ranges.push([fence.start, lineEnd]);
        fence = null;
      }
    }
    offset = lineEnd + 1;
  }
  // An unclosed fence runs to the end of the note.
  if (fence !== null) ranges.push([fence.start, text.length]);
  return ranges;
}

function inlineCodeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const runRe = /`+/g;
  const blankLine = /\r?\n[ \t]*\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(text))) {
    const n = m[0].length;
    const open = m.index;
    // The span cannot cross a blank line.
    blankLine.lastIndex = open + n;
    const b = blankLine.exec(text);
    const limit = b ? b.index : text.length;
    const closeRe = /`+/g;
    closeRe.lastIndex = open + n;
    let close = -1;
    let c: RegExpExecArray | null;
    while ((c = closeRe.exec(text)) && c.index < limit) {
      if (c[0].length === n) {
        close = c.index + n;
        break;
      }
    }
    if (close >= 0) {
      ranges.push([open, close]);
      runRe.lastIndex = close;
    } else {
      runRe.lastIndex = open + n; // literal backticks
    }
  }
  return ranges;
}

/**
 * Same length as `text`, with everything that is not prose blanked out:
 * the YAML frontmatter (history notes quote their marker there), fenced code
 * and inline code. Offsets therefore stay valid.
 */
export function maskNonProse(text: string): string {
  let t = blank(text, [[0, frontmatterLength(text)]]);
  t = blank(t, fencedCodeRanges(t));
  t = blank(t, inlineCodeRanges(t));
  return t;
}

// How a line of Markdown relates to the paragraph around it. A highlight, and so a marker,
// can run over several lines of one paragraph, but not across these boundaries.
const BLANK_LINE = /^[ \t]*(?:>[ \t]*)*\r?$/;
const OWN_BLOCK_LINE = /^[ \t]*(?:>[ \t]*)*(?:#{1,6}[ \t]|\|)/; // heading, table row
const LIST_ITEM_START = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|1[.)])[ \t]/;

/**
 * - `blank`: ends the paragraph
 * - `single`: a heading or a table row, a block of its own that is only one line long
 * - `start`: a list item, which starts a new paragraph that its next lines continue
 * - `text`: continues the paragraph above
 */
export type LineKind = "blank" | "single" | "start" | "text";

export function lineKind(line: string): LineKind {
  if (BLANK_LINE.test(line)) return "blank";
  if (OWN_BLOCK_LINE.test(line)) return "single";
  if (LIST_ITEM_START.test(line)) return "start";
  return "text";
}

/** Cut the text into paragraphs: the ranges inside which `==` delimiters pair up. */
function proseSegments(masked: string, lineStarts: number[]): Range[] {
  const out: Range[] = [];
  let segStart = -1;
  const flush = (lineStart: number): void => {
    if (segStart >= 0) out.push([segStart, lineStart - 1]); // up to the previous line's end
    segStart = -1;
  };
  for (let i = 0; i < lineStarts.length; i++) {
    const start = lineStarts[i];
    const end = i + 1 < lineStarts.length ? lineStarts[i + 1] - 1 : masked.length;
    switch (lineKind(masked.slice(start, end))) {
      case "blank":
        flush(start);
        break;
      case "single":
        flush(start);
        out.push([start, end]);
        break;
      case "start":
        flush(start);
        segStart = start;
        break;
      case "text":
        if (segStart < 0) segStart = start;
        break;
    }
  }
  if (segStart >= 0) out.push([segStart, masked.length]);
  return out;
}

/** Find every `==?…==` in the text. */
export function parseMarkers(text: string, opts: ParseOptions): Marker[] {
  const masked = maskNonProse(text);

  const lineStarts = [0];
  for (let i = masked.indexOf("\n"); i !== -1; i = masked.indexOf("\n", i + 1)) lineStarts.push(i + 1);
  const posAt = (offset: number): { line: number; ch: number } => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, ch: offset - lineStarts[lo] };
  };

  const markers: Marker[] = [];
  for (const [from, to] of proseSegments(masked, lineStarts)) {
    // Pair the `==` delimiters of the paragraph left to right, the way Obsidian pairs
    // highlights. That way the `==?` in `==important==? yes` (a closing delimiter
    // followed by a question mark) is not mistaken for a marker.
    const segment = masked.slice(from, to);
    const delims: number[] = [];
    const re = /==/g;
    let d: RegExpExecArray | null;
    while ((d = re.exec(segment))) delims.push(d.index);
    for (let i = 0; i + 1 < delims.length; i += 2) {
      if (segment[delims[i] + 2] !== "?") continue;
      const start = from + delims[i];
      const end = from + delims[i + 1] + 2;
      const begin = posAt(start);
      const finish = posAt(end);
      const marker = buildMarker(text, start, end, begin, finish, opts);
      if (marker) markers.push(marker);
    }
  }
  return markers;
}

/** One line of text: line breaks, and the `>` of a quote on the next line, become a space. */
function oneLine(s: string): string {
  return s.replace(/\s*\r?\n[ \t]*(?:>[ \t]*)*/g, " ").trim();
}

function buildMarker(
  text: string,
  start: number,
  end: number,
  begin: { line: number; ch: number },
  finish: { line: number; ch: number },
  opts: ParseOptions,
): Marker | null {
  const raw = text.slice(start, end);
  const inner = text.slice(start + 3, end - 2);
  const where = { start, end, line: begin.line, ch: begin.ch, endLine: finish.line, endCh: finish.ch };

  // `word:` where the part before the first colon is a single token.
  const kw = /^\s*([^\s:=?]+)\s*:([\s\S]*)$/.exec(inner);
  if (kw) {
    const entry = opts.aliasMap.get(normalize(kw[1]));
    if (entry) {
      const alias = entry.packId === LATIN_ID ? undefined : { word: kw[1], packId: entry.packId };
      return { kind: entry.kind, alias, question: oneLine(kw[2]), raw, ...where };
    }
  }
  // No keyword, or an unknown one: the whole text is the question.
  if (opts.defaultKind === null) return null;
  return { kind: opts.defaultKind, question: oneLine(inner), raw, ...where };
}

/**
 * The marker with this text that is closest to `hint` (an offset), or undefined if none is left.
 * Used when the note may have been edited since the marker was listed.
 */
export function pickMarker(markers: readonly Marker[], raw: string, hint: number): Marker | undefined {
  const wanted = raw.replace(/\r\n/g, "\n");
  let best: Marker | undefined;
  let bestDistance = Infinity;
  for (const m of markers) {
    if (m.raw.replace(/\r\n/g, "\n") !== wanted) continue;
    const distance = Math.abs(m.start - hint);
    if (distance < bestDistance) {
      best = m;
      bestDistance = distance;
    }
  }
  return best;
}

/** `alias:` value of a history note, e.g. `verifica (it)`. */
export function formatAlias(alias: { word: string; packId: string }): string {
  return `${alias.word} (${alias.packId})`;
}
