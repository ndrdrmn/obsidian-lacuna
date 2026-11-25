import { describe, expect, it } from "vitest";
import {
  addAnsweredAt,
  buildHistoryNote,
  formatLocalDateTime,
  historyFileName,
  isHistoryStatus,
  jobKey,
  matchHistory,
  nextHistoryId,
  normalizeMarker,
  type HistoryEntry,
  type HistoryNoteInput,
} from "../src/history-note";

const asked = new Date(2026, 10, 20, 16, 40);

function input(over: Partial<HistoryNoteInput> = {}): HistoryNoteInput {
  return {
    id: 122,
    kind: "suppl",
    title: "exact release date",
    question: "exact release date",
    articleLink: "[[Windows 95]]",
    marker: "==?suppl: exact release date==",
    asked,
    resolver: "claude-cli/sonnet",
    context: "Windows 95 was released on ==?suppl: exact release date== by Microsoft.",
    contextSent: true,
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
    expect(note.startsWith("---\nlacuna: pending\nid: 122\nkind: suppl\n")).toBe(true);
    expect(front(note, "question")).toBe("exact release date");
    expect(front(note, "article")).toBe("[[Windows 95]]");
    expect(front(note, "marker")).toBe("==?suppl: exact release date==");
    expect(front(note, "asked")).toBe("2026-11-20T16:40");
    expect(front(note, "resolver")).toBe("claude-cli/sonnet");
    expect(note).toContain("\nanswer:\nanswered:\n---\n");
  });

  it("has an empty `at` right after `article`, for the answer's anchor", () => {
    const keys = note.split("\n---\n")[0].split("\n").slice(1).map((l) => l.split(":")[0]);
    expect(keys.indexOf("at")).toBe(keys.indexOf("article") + 1);
    expect(front(note, "at")).toBe("");
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
    expect(note).toContain("\n# Lacuna 122 · exact release date\n");
    expect(note).toContain("> Context sent to the search:\n>\n> Windows 95 was released on ==?suppl: exact release date== by Microsoft.");
    const multi = buildHistoryNote(input({ context: "one\n\ntwo" }));
    expect(multi).toContain("> one\n>\n> two");
  });

  it("labels the context 'Context', not 'sent', when nothing was sent (Answer myself)", () => {
    const n = buildHistoryNote(input({ resolver: "manual", contextSent: false }));
    expect(n).not.toContain("Context sent");
    expect(n).toContain("> Context:\n>\n> Windows 95 was released on");
    expect(front(n, "resolver")).toBe("manual");
  });

  it("has no context block when there is no context", () => {
    const n = buildHistoryNote(input({ context: " \n" }));
    expect(n).not.toContain("Context");
    expect(n).toContain("# Lacuna 122 · exact release date\n\n## Candidate 1\n");
  });

  it("lists the candidates with their sources", () => {
    expect(note).toContain(
      "## Candidate 1\nAugust 24, 1995\n\n- [Microsoft – launch](https://example.com/a) — “launched on August 24”",
    );
    expect(note).toContain("## Candidate 2\nJuly 14, 1995\n");
    expect(note.endsWith("July 14, 1995\n")).toBe(true);
  });

  it("writes a source without a link as plain text", () => {
    const n = buildHistoryNote(
      input({
        candidates: [{ answer: "a", sources: [{ title: "Petzold,  *Code*,\np. 212" }, { title: "from memory" }] }],
      }),
    );
    expect(n).toContain("## Candidate 1\na\n\n- Petzold, *Code*, p. 212\n- from memory\n");
  });

  it("makes titles and urls safe inside a Markdown link", () => {
    const n = buildHistoryNote(
      input({ candidates: [{ answer: "a", sources: [{ title: "A [b] c", url: "https://e.com/x (y z)" }] }] }),
    );
    expect(n).toContain("- [A (b) c](https://e.com/x%20%28y%20z%29)");
  });
});

describe("historyFileName", () => {
  it("follows 'Lacuna N — article — question', with no date", () => {
    expect(historyFileName(122, "Windows 95", "exact release date")).toBe(
      "Lacuna 122 — Windows 95 — exact release date",
    );
  });

  it("drops characters that cannot be in a file name or break a link", () => {
    expect(historyFileName(1, "a/b", 'who? "why": #1 [x] ^y')).toBe("Lacuna 1 — a b — who why 1 x y");
  });

  it("cuts a long question at a word", () => {
    const name = historyFileName(1, "n", "word ".repeat(40));
    expect(name.length).toBeLessThan(90);
    expect(name.endsWith("word")).toBe(true);
  });

  it("never ends with a dot or a space, and copes with empty parts", () => {
    expect(historyFileName(3, "n", "what...")).toBe("Lacuna 3 — n — what");
    expect(historyFileName(3, "", "")).toBe("Lacuna 3 — note — lacuna");
  });
});

describe("nextHistoryId", () => {
  const e = (id: number | null) => ({ id });

  it("starts at 1", () => {
    expect(nextHistoryId(0, [])).toBe(1);
  });

  it("follows the stored counter", () => {
    expect(nextHistoryId(121, [e(5), e(null)])).toBe(122);
  });

  it("follows the notes in the vault when the stored counter is behind (a reset or synced data.json)", () => {
    expect(nextHistoryId(3, [e(7), e(120), e(9)])).toBe(121);
    expect(nextHistoryId(0, [e(4)])).toBe(5);
  });

  it("ignores a damaged counter", () => {
    expect(nextHistoryId(NaN, [e(2)])).toBe(3);
    expect(nextHistoryId(-5, [])).toBe(1);
  });
});

describe("addAnsweredAt", () => {
  const note =
    "---\nlacuna: resolved\n---\n\n# Lacuna 7 · why\n\n> Context:\n>\n> # not the title\n\n## Candidate 1\nx\n";

  it("puts the link under the title", () => {
    expect(addAnsweredAt(note, "[[Windows 95#^lac-7]]")).toBe(
      "---\nlacuna: resolved\n---\n\n# Lacuna 7 · why\n\nAnswered at [[Windows 95#^lac-7]]\n\n> Context:\n>\n> # not the title\n\n## Candidate 1\nx\n",
    );
  });

  it("quotes the answered passage when it is given", () => {
    const out = addAnsweredAt(note, "[[Windows 95#^adloc-1|ad loc.]]", "…under the codename Chicago and went on…");
    expect(out).toContain(
      "# Lacuna 7 · why\n\nAnswered at [[Windows 95#^adloc-1|ad loc.]] — “…under the codename Chicago and went on…”\n\n> Context:",
    );
  });

  it("does not look in the frontmatter, and leaves a note without a title alone", () => {
    const odd = "---\n# comment\n---\ntext\n";
    expect(addAnsweredAt(odd, "[[x]]")).toBe(odd);
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
    id: 1,
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
