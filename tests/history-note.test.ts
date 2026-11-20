import { describe, expect, it } from "vitest";
import {
  buildHistoryNote,
  formatLocalDateTime,
  historyFileName,
  isHistoryStatus,
  jobKey,
  matchHistory,
  normalizeMarker,
  type HistoryEntry,
  type HistoryNoteInput,
} from "../src/history-note";

const asked = new Date(2026, 10, 20, 16, 40);

function input(over: Partial<HistoryNoteInput> = {}): HistoryNoteInput {
  return {
    kind: "suppl",
    title: "exact release date",
    question: "exact release date",
    articleLink: "[[Windows 95]]",
    marker: "==?suppl: exact release date==",
    asked,
    resolver: "claude-cli/sonnet",
    context: "Windows 95 was released on ==?suppl: exact release date== by Microsoft.",
    candidates: [
      {
        answer: "August 24, 1995",
        sources: [{ title: "Microsoft – launch", url: "https://example.com/a", quote: "launched on August 24" }],
      },
      { answer: "July 14, 1995", sources: [] },
    ],
    ...over,
  };
}

/** The value of a frontmatter line, JSON-decoded when it is a quoted string. */
function front(note: string, key: string): unknown {
  const block = note.split("\n---\n")[0];
  const line = block.split("\n").find((l) => l.startsWith(`${key}:`));
  if (line === undefined) return undefined;
  const raw = line.slice(key.length + 1).trim();
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

describe("buildHistoryNote", () => {
  const note = buildHistoryNote(input());

  it("starts with the frontmatter of a pending note", () => {
    expect(note.startsWith("---\nlacuna: pending\nkind: suppl\n")).toBe(true);
    expect(front(note, "question")).toBe("exact release date");
    expect(front(note, "article")).toBe("[[Windows 95]]");
    expect(front(note, "marker")).toBe("==?suppl: exact release date==");
    expect(front(note, "asked")).toBe("2026-11-20T16:40");
    expect(front(note, "resolver")).toBe("claude-cli/sonnet");
    expect(note).toContain("\nanswer:\nanswered:\n---\n");
  });

  it("leaves out alias and verdict when there are none", () => {
    expect(note).not.toContain("alias:");
    expect(note).not.toContain("verdict:");
  });

  it("records the alias typed and the verdict", () => {
    const n = buildHistoryNote(input({ alias: { word: "integra", packId: "it" }, verdict: "corrected", kind: "sic" }));
    expect(front(n, "kind")).toBe("sic");
    expect(front(n, "alias")).toBe("integra (it)");
    expect(front(n, "verdict")).toBe("corrected");
  });

  it("quotes values that would break YAML", () => {
    const n = buildHistoryNote(input({ question: 'why: "this" # that', articleLink: "[[a: b]]" }));
    expect(front(n, "question")).toBe('why: "this" # that');
    expect(front(n, "article")).toBe("[[a: b]]");
  });

  it("writes a multi-line marker on one line, with escapes", () => {
    const n = buildHistoryNote(input({ marker: "==?suppl: a\r\nb==" }));
    expect(front(n, "marker")).toBe("==?suppl: a\nb==");
    expect(n.split("\n---\n")[0]).not.toContain("\nb==");
  });

  it("has a title, and the context sent as a block quote", () => {
    expect(note).toContain("\n# exact release date\n");
    expect(note).toContain("> Context sent to the search:\n>\n> Windows 95 was released on ==?suppl: exact release date== by Microsoft.");
    const multi = buildHistoryNote(input({ context: "one\n\ntwo" }));
    expect(multi).toContain("> one\n>\n> two");
  });

  it("lists the candidates with their sources", () => {
    expect(note).toContain(
      "## Candidate 1\nAugust 24, 1995\n\n- [Microsoft – launch](https://example.com/a) — “launched on August 24”",
    );
    expect(note).toContain("## Candidate 2\nJuly 14, 1995\n");
    expect(note.endsWith("July 14, 1995\n")).toBe(true);
  });

  it("makes titles and urls safe inside a Markdown link", () => {
    const n = buildHistoryNote(
      input({ candidates: [{ answer: "a", sources: [{ title: "A [b] c", url: "https://e.com/x (y z)" }] }] }),
    );
    expect(n).toContain("- [A (b) c](https://e.com/x%20%28y%20z%29)");
  });
});

describe("historyFileName", () => {
  it("follows 'YYYY-MM-DD article — question'", () => {
    expect(historyFileName(asked, "Windows 95", "exact release date")).toBe(
      "2026-11-20 Windows 95 — exact release date",
    );
  });

  it("drops characters that cannot be in a file name or break a link", () => {
    expect(historyFileName(asked, "a/b", 'who? "why": #1 [x] ^y')).toBe("2026-11-20 a b — who why 1 x y");
  });

  it("cuts a long question at a word", () => {
    const name = historyFileName(asked, "n", "word ".repeat(40));
    expect(name.length).toBeLessThan(90);
    expect(name.endsWith("word")).toBe(true);
  });

  it("never ends with a dot or a space, and copes with empty parts", () => {
    expect(historyFileName(asked, "n", "what...")).toBe("2026-11-20 n — what");
    expect(historyFileName(asked, "", "")).toBe("2026-11-20 note — lacuna");
  });
});

describe("small helpers", () => {
  it("formats local time", () => {
    expect(formatLocalDateTime(new Date(2026, 0, 5, 3, 7))).toBe("2026-01-05T03:07");
  });

  it("normalizes line endings in markers and keys", () => {
    expect(normalizeMarker("a\r\nb")).toBe("a\nb");
    expect(jobKey("n.md", "a\r\nb")).toBe(jobKey("n.md", "a\nb"));
    expect(jobKey("n.md", "x")).not.toBe(jobKey("m.md", "x"));
  });

  it("knows the statuses", () => {
    expect(isHistoryStatus("pending")).toBe(true);
    expect(isHistoryStatus("done")).toBe(false);
  });
});

describe("matchHistory", () => {
  const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
    path: "Apparatus/a.md",
    status: "pending",
    marker: "==?suppl: x==",
    articlePath: "Windows 95.md",
    asked: "2026-11-20T10:00",
    ...over,
  });

  it("finds the note of the same article and marker", () => {
    const e = entry({});
    expect(matchHistory([e], "Windows 95.md", "==?suppl: x==")).toBe(e);
  });

  it("ignores other articles, other markers and unresolved links", () => {
    expect(matchHistory([entry({ articlePath: "Other.md" })], "Windows 95.md", "==?suppl: x==")).toBeUndefined();
    expect(matchHistory([entry({ articlePath: null })], "Windows 95.md", "==?suppl: x==")).toBeUndefined();
    expect(matchHistory([entry({})], "Windows 95.md", "==?suppl: y==")).toBeUndefined();
  });

  it("ignores a resolved note: its marker has been replaced", () => {
    expect(matchHistory([entry({ status: "resolved" })], "Windows 95.md", "==?suppl: x==")).toBeUndefined();
  });

  it("compares markers whatever the line endings", () => {
    const e = entry({ marker: "==?suppl: a\nb==" });
    expect(matchHistory([e], "Windows 95.md", "==?suppl: a\r\nb==")).toBe(e);
  });

  it("prefers a pending note to a rejected one, then the latest", () => {
    const rejected = entry({ path: "r.md", status: "rejected", asked: "2026-11-21T10:00" });
    const oldPending = entry({ path: "p1.md", asked: "2026-11-19T10:00" });
    const newPending = entry({ path: "p2.md", asked: "2026-11-20T10:00" });
    expect(matchHistory([rejected, oldPending], "Windows 95.md", "==?suppl: x==")).toBe(oldPending);
    expect(matchHistory([oldPending, rejected, newPending], "Windows 95.md", "==?suppl: x==")).toBe(newPending);
    expect(matchHistory([rejected], "Windows 95.md", "==?suppl: x==")).toBe(rejected);
  });
});
