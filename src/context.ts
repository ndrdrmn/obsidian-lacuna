import { frontmatterLength } from "./marker";

export type ContextMode = "sentence" | "paragraph" | "paragraphPlusMinusOne" | "note";

export interface Span {
  start: number;
  end: number;
}

export interface ContextResult {
  /** The text to send. It still contains the marker. */
  text: string;
  /** Where the marker sits inside `text`. */
  markerStart: number;
  markerEnd: number;
}

interface Boundary {
  /** End of the sentence before the boundary (exclusive). */
  end: number;
  /** Start of the sentence after it. */
  next: number;
}

type Bounds = [number, number];

/**
 * Markers contain `?`, which must not be taken for the end of a sentence.
 * A marker may run over several lines, but never across a blank line; line breaks are kept.
 */
function maskMarkers(text: string): string {
  return text.replace(/==\?(?:(?!\r?\n[ \t]*\r?\n)[\s\S])*?==/g, (m) => m.replace(/[^\r\n]/g, "x"));
}

/** Sentence ends (. ! ? …), and the start of a list item, heading or quote on a new line. */
function sentenceBoundaries(masked: string): Boundary[] {
  const out: Boundary[] = [];
  const re = /[.!?…]+["'”’»)\]]*(?=\s|$)|\n(?=[ \t]*(?:[-*+>]|#{1,6}|\d+[.)])[ \t])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const isNewline = m[0] === "\n";
    const end = isNewline ? m.index : m.index + m[0].length;
    let next = m.index + m[0].length;
    while (next < masked.length && /\s/.test(masked[next])) next++;
    out.push({ end, next });
  }
  return out;
}

/** The blank-line-separated block containing `pos`, trimmed. */
function paragraphBounds(body: string, pos: number): Bounds {
  let start = 0;
  let end = body.length;
  const sep = /\r?\n[ \t]*\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = sep.exec(body))) {
    if (m.index + m[0].length <= pos) {
      start = m.index + m[0].length;
    } else {
      end = m.index;
      break;
    }
  }
  while (start < end && /\s/.test(body[start])) start++;
  while (end > start && /\s/.test(body[end - 1])) end--;
  return [start, end];
}

function sentenceBounds(body: string, ms: number, me: number): Bounds {
  const [lo, hi] = paragraphBounds(body, ms);
  const masked = maskMarkers(body.slice(lo, hi));
  const boundaries = sentenceBoundaries(masked);
  const rs = ms - lo;
  const re = me - lo;
  let s = 0;
  for (const b of boundaries) {
    if (b.next <= rs) s = b.next;
    else break;
  }
  let e = masked.length;
  for (const b of boundaries) {
    if (b.end >= re) {
      e = b.end;
      break;
    }
  }
  return [lo + s, lo + e];
}

/**
 * The text sent to the resolver around a marker. The YAML frontmatter is never sent.
 * `marker` offsets refer to the full note text.
 */
export function extractContext(text: string, marker: Span, mode: ContextMode): ContextResult {
  const off = frontmatterLength(text);
  const body = text.slice(off);
  const ms = marker.start - off;
  const me = marker.end - off;

  let bounds: Bounds;
  switch (mode) {
    case "note":
      bounds = [0, body.length];
      break;
    case "sentence":
      bounds = sentenceBounds(body, ms, me);
      break;
    case "paragraph":
      bounds = paragraphBounds(body, ms);
      break;
    case "paragraphPlusMinusOne": {
      const [s, e] = paragraphBounds(body, ms);
      let from = s;
      let to = e;
      let p = s - 1;
      while (p > 0 && /\s/.test(body[p])) p--;
      if (p >= 0 && s > 0) from = paragraphBounds(body, p)[0];
      let n = e;
      while (n < body.length && /\s/.test(body[n])) n++;
      if (n < body.length) to = paragraphBounds(body, n)[1];
      bounds = [from, to];
      break;
    }
  }
  return { text: body.slice(bounds[0], bounds[1]), markerStart: ms - bounds[0], markerEnd: me - bounds[0] };
}

/**
 * The claim a `sic` marker verifies: the words of its sentence before the marker,
 * or the whole previous sentence when the marker starts a sentence.
 * Empty when there is nothing before the marker in its paragraph.
 */
export function extractClaim(text: string, marker: Span): string {
  const off = frontmatterLength(text);
  const body = text.slice(off);
  const ms = marker.start - off;
  const [lo, hi] = paragraphBounds(body, ms);
  const boundaries = sentenceBoundaries(maskMarkers(body.slice(lo, hi)));
  const rs = ms - lo;
  let sentenceStart = 0;
  let index = -1;
  boundaries.forEach((b, i) => {
    if (b.next <= rs) {
      sentenceStart = b.next;
      index = i;
    }
  });
  let claim = body.slice(lo + sentenceStart, ms).trim();
  if (claim === "" && index >= 0) {
    const prevStart = index > 0 ? boundaries[index - 1].next : 0;
    claim = body.slice(lo + prevStart, lo + boundaries[index].end).trim();
  }
  return claim;
}
