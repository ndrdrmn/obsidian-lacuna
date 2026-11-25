import { normalizeMarker, type HistoryEntry } from "./history-note";

/**
 * The orphans: history notes still waiting (`pending`) or rejected whose marker is not in their
 * article any more, because it was deleted or its text was changed. A `resolved` note is never
 * one: its marker was replaced on purpose.
 *
 * `markersOf` gives the markers an article has now, or `undefined` while that article has not been
 * scanned yet: its notes are not called orphans before anyone knows. A note whose article cannot be
 * found at all is an orphan too. With `only`, just the notes of that article (a note that has no
 * article is then left out).
 */
export function findOrphans(
  entries: readonly HistoryEntry[],
  markersOf: (articlePath: string) => readonly { raw: string }[] | undefined,
  only?: string,
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const e of entries) {
    if (e.status === "resolved") continue;
    if (only !== undefined && e.articlePath !== only) continue;
    if (e.articlePath === null) {
      out.push(e);
      continue;
    }
    const markers = markersOf(e.articlePath);
    if (markers === undefined) continue;
    const wanted = normalizeMarker(e.marker);
    if (!markers.some((m) => normalizeMarker(m.raw) === wanted)) out.push(e);
  }
  // By article (those whose article is missing last), then oldest first.
  return out.sort(
    (a, b) =>
      (a.articlePath ?? "￿").localeCompare(b.articlePath ?? "￿") ||
      (a.asked < b.asked ? -1 : a.asked > b.asked ? 1 : (a.id ?? 0) - (b.id ?? 0)),
  );
}
