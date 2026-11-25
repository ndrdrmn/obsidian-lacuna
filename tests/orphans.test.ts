import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../src/history-note";
import { findOrphans } from "../src/orphans";

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  path: "Apparatus/a.md",
  id: 1,
  status: "pending",
  marker: "==?suppl: x==",
  articlePath: "Windows 95.md",
  asked: "2026-11-25T10:00",
  ...over,
});

/** The markers of each article, as the index would give them. */
const index =
  (articles: Record<string, string[]>) =>
  (path: string): { raw: string }[] | undefined =>
    articles[path]?.map((raw) => ({ raw }));

describe("findOrphans", () => {
  it("is a note, pending or rejected, whose marker is not in its article", () => {
    const pending = entry({ id: 1 });
    const rejected = entry({ id: 2, status: "rejected" });
    const out = findOrphans([pending, rejected], index({ "Windows 95.md": ["==?suppl: other=="] }));
    expect(out).toEqual([pending, rejected]);
  });

  it("is not a note whose marker is still there, rejected ones of a live marker included", () => {
    const markers = index({ "Windows 95.md": ["==?suppl: x=="] });
    expect(findOrphans([entry({}), entry({ id: 2, status: "rejected" })], markers)).toEqual([]);
  });

  it("is never a resolved note: its marker was replaced on purpose", () => {
    expect(findOrphans([entry({ status: "resolved" })], index({ "Windows 95.md": [] }))).toEqual([]);
  });

  it("compares markers with their line endings normalized", () => {
    const e = entry({ marker: "==?suppl: a\nb==" });
    expect(findOrphans([e], index({ "Windows 95.md": ["==?suppl: a\r\nb=="] }))).toEqual([]);
  });

  it("an article without any marker leaves its notes orphans", () => {
    const e = entry({});
    expect(findOrphans([e], index({ "Windows 95.md": [] }))).toEqual([e]);
  });

  it("does not call a note an orphan before its article has been scanned", () => {
    expect(findOrphans([entry({})], index({}))).toEqual([]);
  });

  it("a note whose article cannot be found is an orphan", () => {
    const lost = entry({ articlePath: null });
    expect(findOrphans([lost], index({}))).toEqual([lost]);
  });

  it("with `only`, keeps the notes of that article, and leaves out those with no article", () => {
    const mine = entry({ id: 1 });
    const other = entry({ id: 2, articlePath: "Other.md" });
    const lost = entry({ id: 3, articlePath: null });
    const markers = index({ "Windows 95.md": [], "Other.md": [] });
    expect(findOrphans([mine, other, lost], markers, "Windows 95.md")).toEqual([mine]);
  });

  it("sorts by article, then oldest first, with the lost ones last", () => {
    const b2 = entry({ id: 4, articlePath: "B.md", asked: "2026-11-25T12:00" });
    const b1 = entry({ id: 3, articlePath: "B.md", asked: "2026-11-25T09:00" });
    const a = entry({ id: 5, articlePath: "A.md" });
    const lost = entry({ id: 1, articlePath: null });
    const markers = index({ "A.md": [], "B.md": [] });
    expect(findOrphans([lost, b2, a, b1], markers)).toEqual([a, b1, b2, lost]);
  });
});
