export type Insertion = { text: string; cursor: number } | { error: string };

/**
 * The text that `/adloc`, the hotkey and the right-click entry put in the note.
 *
 * - no selection, no keyword: `==? ==`, cursor before the closing `==`
 * - no selection, keyword:    `==?kw: ==`, cursor before the closing `==`
 * - selection: the selection becomes the question (on one line), cursor after the marker
 *
 * `keyword` is only given when the default kind is None, because a marker
 * without a keyword would then be ignored.
 * `cursor` is an offset into `text`, which never contains a newline.
 */
export function buildInsertion(selection: string, keyword?: string): Insertion {
  const sel = selection.replace(/\s*\n\s*/g, " ").trim();
  if (sel.includes("==")) {
    return { error: "The selection contains '==', which cannot be inside a marker." };
  }
  const head = keyword ? `==?${keyword}: ` : "==?";
  if (sel === "") {
    return keyword ? { text: `${head}==`, cursor: head.length } : { text: "==? ==", cursor: 4 };
  }
  const text = `${head}${sel}==`;
  return { text, cursor: text.length };
}

/**
 * Is the cursor right after `==?` and the start of a keyword (before any space or colon)?
 * `linePrefix` is the line up to the cursor. `start` is where the keyword begins in the line.
 */
export function matchTrigger(linePrefix: string): { start: number; query: string } | null {
  const m = /==\?([^\s:=?]*)$/.exec(linePrefix);
  if (!m) return null;
  const idx = m.index;
  if (idx > 0 && linePrefix[idx - 1] === "=") return null;
  // An odd number of `==` before it means this `==` closes a highlight: `==a==?x`.
  const before = (linePrefix.slice(0, idx).match(/==/g) ?? []).length;
  if (before % 2 === 1) return null;
  return { start: idx + 3, query: m[1] };
}
