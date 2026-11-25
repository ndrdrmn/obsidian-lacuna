import { describe, expect, it } from "vitest";
import {
  buildHistoryNote,
  matchHistoryAll,
  parseCandidates,
  rejectedAnswers,
  splitFrontmatter,
  toHistoryData,
  type HistoryEntry,
  type HistoryNoteInput,
} from "../src/history-note";
import { replacementVerdict, reviewMode } from "../src/review";
import type { Candidate } from "../src/resolvers/resolver";

function input(candidates: Candidate[], over: Partial<HistoryNoteInput> = {}): HistoryNoteInput {
  return {
    id: 7,
    kind: "suppl",
    title: "release date",
    question: "release date",
    articleLink: "[[Windows 95]]",
    marker: "==?suppl: release date==",
    asked: new Date(2026, 10, 25, 10, 0),
    resolver: "claude-cli/sonnet",
    context: "Windows 95 went on sale on ==?suppl: release date==.\n\nNext paragraph.",
    contextSent: true,
    candidates,
    ...over,
  };
}

const roundTrip = (candidates: Candidate[]): Candidate[] =>
  parseCandidates(splitFrontmatter(buildHistoryNote(input(candidates))).body);

describe("parseCandidates", () => {
  it("reads back what buildHistoryNote wrote: answers, sources and quotes", () => {
    const candidates: Candidate[] = [
      {
        answer: "August 24, 1995",
        sources: [
          { title: "Microsoft – launch", url: "https://example.com/a", quote: "launched on August 24" },
          { title: "PCjs", url: "https://www.pcjs.org/x" },
        ],
      },
      { answer: "July 14, 1995", sources: [{ title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Windows_95" }] },
    ];
    expect(roundTrip(candidates)).toEqual(candidates);
  });

  it("keeps a multi-paragraph answer, and a list inside it", () => {
    const answer = "First paragraph.\n\nSecond one:\n\n- item one\n- item two\n\nLast words.";
    const read = roundTrip([{ answer, sources: [{ title: "S", url: "https://e.com" }] }]);
    expect(read).toEqual([{ answer, sources: [{ title: "S", url: "https://e.com" }] }]);
  });

  it("keeps a table answer", () => {
    const answer = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(roundTrip([{ answer, sources: [] }])).toEqual([{ answer, sources: [] }]);
  });

  it("reads a candidate without sources, and a source without a quote", () => {
    expect(roundTrip([{ answer: "only this", sources: [] }])).toEqual([{ answer: "only this", sources: [] }]);
  });

  it("reads titles and URLs the way they were made safe", () => {
    const read = roundTrip([{ answer: "a", sources: [{ title: "A [b] c", url: "https://e.com/x (y z)" }] }]);
    expect(read[0].sources).toEqual([{ title: "A (b) c", url: "https://e.com/x%20%28y%20z%29" }]);
  });

  it("does not take a list that follows the answer directly for sources", () => {
    const body = "## Candidate 1\n- [not](https://a.com)\n";
    expect(parseCandidates(body)).toEqual([{ answer: "- [not](https://a.com)", sources: [] }]);
  });

  it("is not fooled by a heading inside an answer, or by a quoted context", () => {
    const body = "# Lacuna 1 · q\n\n> Context:\n>\n> ## Candidate 9\n\n## Candidate 1\nText\n## Not a candidate\nmore\n";
    expect(parseCandidates(body)).toEqual([{ answer: "Text\n## Not a candidate\nmore", sources: [] }]);
  });

  it("copes with CRLF", () => {
    const note = buildHistoryNote(input([{ answer: "a\n\nb", sources: [{ title: "S", url: "https://e.com" }] }]));
    expect(parseCandidates(note.replace(/\n/g, "\r\n"))).toEqual([
      { answer: "a\n\nb", sources: [{ title: "S", url: "https://e.com" }] },
    ]);
  });

  it("finds nothing in a body without candidates", () => {
    expect(parseCandidates("# Title\n\nJust text.\n")).toEqual([]);
  });
});

describe("splitFrontmatter", () => {
  it("separates the properties from the body", () => {
    expect(splitFrontmatter("---\na: 1\nb: 2\n---\n\n# T\n")).toEqual({ yaml: "a: 1\nb: 2\n", body: "\n# T\n" });
  });

  it("copes with an empty frontmatter, CRLF and no frontmatter at all", () => {
    expect(splitFrontmatter("---\n---\ntext")).toEqual({ yaml: "", body: "text" });
    expect(splitFrontmatter("---\r\na: 1\r\n---\r\nx").yaml).toBe("a: 1\r\n");
    expect(splitFrontmatter("no frontmatter")).toEqual({ yaml: "", body: "no frontmatter" });
  });
});

describe("toHistoryData", () => {
  const body = "## Candidate 1\nAnswer\n";
  const fm = { lacuna: "pending", id: 7, kind: "sic", question: "q", marker: "==?sic: x==", resolver: "claude-cli/sonnet", verdict: "corrected" };

  it("reads a Lacuna note", () => {
    expect(toHistoryData(fm, body)).toEqual({
      id: 7,
      status: "pending",
      kind: "sic",
      question: "q",
      marker: "==?sic: x==",
      resolver: "claude-cli/sonnet",
      verdict: "corrected",
      candidates: [{ answer: "Answer", sources: [] }],
    });
  });

  it("takes a null question for an empty one, and drops an unknown verdict", () => {
    const d = toHistoryData({ ...fm, question: null, verdict: "maybe" }, body);
    expect(d?.question).toBe("");
    expect(d?.verdict).toBeUndefined();
  });

  it("normalizes the line endings of the marker", () => {
    expect(toHistoryData({ ...fm, marker: "==?sic: a\r\nb==" }, body)?.marker).toBe("==?sic: a\nb==");
  });

  it("is null for anything that is not a Lacuna note", () => {
    for (const bad of [null, "x", {}, { ...fm, id: undefined }, { ...fm, id: 1.5 }, { ...fm, kind: "wat" }, { ...fm, lacuna: "done" }, { ...fm, marker: "" }]) {
      expect(toHistoryData(bad, body)).toBeNull();
    }
  });
});

describe("rejectedAnswers", () => {
  const c = (answer: string): Candidate => ({ answer, sources: [] });

  it("flattens the notes in order, on one line each", () => {
    expect(rejectedAnswers([[c("a"), c("b\nc")], [c("d")]])).toEqual(["a", "b c", "d"]);
  });

  it("keeps only the most recent ones", () => {
    const many = Array.from({ length: 20 }, (_, i) => c(`answer ${i}`));
    const out = rejectedAnswers([many], 12);
    expect(out).toHaveLength(12);
    expect(out[0]).toBe("answer 8");
    expect(out[11]).toBe("answer 19");
  });

  it("cuts a long answer, and skips empty ones", () => {
    const out = rejectedAnswers([[c("x".repeat(500)), c("  ")]], 12, 300);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(300);
    expect(out[0].endsWith("…")).toBe(true);
  });
});

describe("matchHistoryAll", () => {
  const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
    path: "Apparatus/a.md",
    id: 1,
    status: "rejected",
    marker: "==?suppl: x==",
    articlePath: "Windows 95.md",
    asked: "2026-11-25T10:00",
    ...over,
  });

  it("finds the notes of one status for the marker, oldest first", () => {
    const newer = entry({ path: "n.md", id: 3, asked: "2026-11-25T12:00" });
    const older = entry({ path: "o.md", id: 2, asked: "2026-11-25T09:00" });
    expect(matchHistoryAll([newer, older], "Windows 95.md", "==?suppl: x==", "rejected")).toEqual([older, newer]);
  });

  it("ignores other statuses, other articles and other markers", () => {
    const entries = [
      entry({ status: "pending" }),
      entry({ status: "resolved" }),
      entry({ articlePath: "Other.md" }),
      entry({ marker: "==?suppl: y==" }),
      entry({ articlePath: null }),
    ];
    expect(matchHistoryAll(entries, "Windows 95.md", "==?suppl: x==", "rejected")).toEqual([]);
  });

  it("compares markers with their line endings normalized", () => {
    const e = entry({ marker: "==?suppl: a\nb==" });
    expect(matchHistoryAll([e], "Windows 95.md", "==?suppl: a\r\nb==", "rejected")).toEqual([e]);
  });
});

describe("reviewMode", () => {
  it("offers every candidate for the kinds that replace text", () => {
    for (const kind of ["suppl", "fontes", "glossa", "cf"] as const) {
      expect(reviewMode(kind, undefined)).toBe("pick");
    }
  });

  it("sic: corrected offers the corrections, confirmed a single accept, anything else nothing", () => {
    expect(reviewMode("sic", "corrected")).toBe("pick");
    expect(reviewMode("sic", "confirmed")).toBe("confirm");
    expect(reviewMode("sic", "uncertain")).toBe("none");
    expect(reviewMode("sic", undefined)).toBe("none");
  });
});

describe("replacementVerdict", () => {
  it("is only for sic, and never uncertain", () => {
    expect(replacementVerdict("sic", "confirmed")).toBe("confirmed");
    expect(replacementVerdict("sic", "corrected")).toBe("corrected");
    expect(replacementVerdict("sic", "uncertain")).toBeUndefined();
    expect(replacementVerdict("suppl", "confirmed")).toBeUndefined();
  });
});
