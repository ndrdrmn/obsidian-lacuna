import { normalize, type AliasEntry } from "./lang/keywords";
import { LATIN_ID, type Kind } from "./lang/packs";

export interface Marker {
  kind: Kind;
  /** Set when the keyword typed was not the Latin one: the word as typed, and its pack. */
  alias?: { word: string; packId: string };
  question: string;
  /** The full marker text, `==?…==`. */
  raw: string;
  /** Offsets into the parsed text; `end` is exclusive. */
  start: number;
  end: number;
  /** 0-based position of the marker's first character. */
  line: number;
  ch: number;
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

/** Find every `==?…==` in the text. */
export function parseMarkers(text: string, opts: ParseOptions): Marker[] {
  const masked = maskNonProse(text);
  const markers: Marker[] = [];
  let lineStart = 0;
  let lineNo = 0;
  for (const line of masked.split("\n")) {
    // Pair the `==` delimiters on the line left to right, the way Obsidian pairs
    // highlights. That way the `==?` in `==important==? yes` (a closing delimiter
    // followed by a question mark) is not mistaken for a marker.
    const delims: number[] = [];
    const re = /==/g;
    let d: RegExpExecArray | null;
    while ((d = re.exec(line))) delims.push(d.index);
    for (let i = 0; i + 1 < delims.length; i += 2) {
      const open = delims[i];
      const close = delims[i + 1];
      if (line[open + 2] !== "?") continue;
      const start = lineStart + open;
      const end = lineStart + close + 2;
      const marker = buildMarker(text, start, end, lineNo, open, opts);
      if (marker) markers.push(marker);
    }
    lineStart += line.length + 1;
    lineNo++;
  }
  return markers;
}

function buildMarker(
  text: string,
  start: number,
  end: number,
  line: number,
  ch: number,
  opts: ParseOptions,
): Marker | null {
  const raw = text.slice(start, end);
  const inner = text.slice(start + 3, end - 2);

  // `word:` where the part before the first colon is a single token.
  const kw = /^\s*([^\s:=?]+)\s*:(.*)$/.exec(inner);
  if (kw) {
    const entry = opts.aliasMap.get(normalize(kw[1]));
    if (entry) {
      const alias = entry.packId === LATIN_ID ? undefined : { word: kw[1], packId: entry.packId };
      return { kind: entry.kind, alias, question: kw[2].trim(), raw, start, end, line, ch };
    }
  }
  // No keyword, or an unknown one: the whole text is the question.
  if (opts.defaultKind === null) return null;
  return { kind: opts.defaultKind, question: inner.trim(), raw, start, end, line, ch };
}

/** `alias:` value of a history note, e.g. `verifica (it)`. */
export function formatAlias(alias: { word: string; packId: string }): string {
  return `${alias.word} (${alias.packId})`;
}
