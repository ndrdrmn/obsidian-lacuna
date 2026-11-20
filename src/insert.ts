export type Insertion = { text: string; cursor: number } | { error: string };

/**
 * The text that `/adloc`, the hotkey and the right-click entry put in the note.
 *
 * - no selection, no keyword: `==? ==`, cursor before the closing `==`
 * - no selection, keyword:    `==?kw: ==`, cursor before the closing `==`
 * - selection: the selection becomes the question, cursor after the marker.
 *   A highlight may run over several lines, so the line breaks stay; blank lines
 *   are dropped, because a blank line would end the highlight.
 *
 * `keyword` is only given when the default kind is None, because a marker
 * without a keyword would then be ignored.
 * `cursor` is an offset into `text`, which may now contain line breaks.
 */
export function buildInsertion(selection: string, keyword?: string): Insertion {
  const sel = selection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
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
 *
 * `paragraphPrefix` is the text of the paragraph up to the cursor, possibly over several
 * lines: a marker can run over several lines, so an earlier line may hold its opening `==`.
 * `query` is what has been typed of the keyword; it ends at the cursor.
 */
export function matchTrigger(paragraphPrefix: string): { query: string } | null {
  const m = /==\?([^\s:=?]*)$/.exec(paragraphPrefix);
  if (!m) return null;
  const idx = m.index;
  if (idx > 0 && paragraphPrefix[idx - 1] === "=") return null;
  // An odd number of `==` before it means this `==` closes a highlight: `==a==?x`.
  const before = (paragraphPrefix.slice(0, idx).match(/==/g) ?? []).length;
  if (before % 2 === 1) return null;
  return { query: m[1] };
}
