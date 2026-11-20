import { describe, expect, it } from "vitest";
import {
  appendFootnoteDefinition,
  buildCitation,
  buildReplacement,
  isBlockMarker,
  newFootnoteId,
  replaceMarker,
} from "../src/apply";

describe("newFootnoteId", () => {
  it("has the lac-xxxx shape", () => {
    expect(newFootnoteId("")).toMatch(/^lac-[a-z0-9]{4}$/);
  });

  it("skips an id already used in the note", () => {
    // First draw gives 'aaaa', second 'bbbb'.
    const draws = [...Array(4).fill(0), ...Array(4).fill(1 / 36)];
    let i = 0;
    const rng = () => draws[i++ % draws.length];
    expect(newFootnoteId("text [^lac-aaaa] more", rng)).toBe("lac-bbbb");
  });
});

describe("buildCitation", () => {
  it("builds a footnote reference and its definition", () => {
    expect(buildCitation("footnote", "[[Apparatus/n|ai-source]]", "lac-k3f9")).toEqual({
      inline: "[^lac-k3f9]",
      definition: "[^lac-k3f9]: [[Apparatus/n|ai-source]]",
    });
  });

  it("builds an inline link with a leading space", () => {
    expect(buildCitation("inline", "[ai-source](x.md)")).toEqual({ inline: " [ai-source](x.md)" });
  });

  it("refuses a footnote without an id", () => {
    expect(() => buildCitation("footnote", "[[x]]")).toThrow();
  });
});

describe("buildReplacement", () => {
  const base = { cite: "[^lac-k3f9]", block: false };

  it("suppl, fontes, glossa and cf: the answer followed by the citation", () => {
    for (const kind of ["suppl", "fontes", "glossa", "cf"] as const) {
      expect(buildReplacement({ ...base, kind, answer: "August 24, 1995" })).toBe("August 24, 1995[^lac-k3f9]");
    }
  });

  it("sic confirmed: the citation alone, the sentence is untouched", () => {
    expect(buildReplacement({ ...base, kind: "sic", answer: "ok", verdict: "confirmed" })).toBe("[^lac-k3f9]");
  });

  it("sic corrected: (actually: …) with the citation", () => {
    expect(buildReplacement({ ...base, kind: "sic", answer: "July 14, 1995", verdict: "corrected" })).toBe(
      "(actually: July 14, 1995[^lac-k3f9])",
    );
  });

  it("sic needs a verdict", () => {
    expect(() => buildReplacement({ ...base, kind: "sic", answer: "x" })).toThrow();
  });

  it("keeps an inline answer on one line", () => {
    expect(buildReplacement({ ...base, kind: "glossa", answer: "one\n\n two\nthree" })).toBe(
      "one two three[^lac-k3f9]",
    );
  });

  it("keeps the paragraphs of a block answer", () => {
    const r = buildReplacement({ ...base, kind: "glossa", block: true, answer: "one\n\ntwo" });
    expect(r).toBe("one\n\ntwo[^lac-k3f9]");
  });

  it("puts the citation after a table, not inside its last row", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(buildReplacement({ ...base, kind: "cf", block: true, answer: table })).toBe(`${table}\n\n[^lac-k3f9]`);
    expect(buildReplacement({ kind: "cf", block: true, answer: table, cite: " [l](x.md)" })).toBe(
      `${table}\n\n[l](x.md)`,
    );
  });
});

describe("replaceMarker", () => {
  it("replaces the span", () => {
    const text = "a ==?suppl: x== b";
    expect(replaceMarker(text, { start: 2, end: 15 }, "1995[^lac-k3f9]")).toBe("a 1995[^lac-k3f9] b");
  });

  it("drops the leading space of an inline citation that would double one", () => {
    const text = "claim ==?sic== end";
    expect(replaceMarker(text, { start: 6, end: 14 }, " [l](x.md)")).toBe("claim [l](x.md) end");
    expect(replaceMarker("==?sic== end", { start: 0, end: 8 }, " [l](x.md)")).toBe("[l](x.md) end");
  });

  it("keeps the leading space when it is needed", () => {
    expect(replaceMarker("claim==?sic==", { start: 5, end: 13 }, " [l](x.md)")).toBe("claim [l](x.md)");
  });
});

describe("isBlockMarker", () => {
  const span = (text: string) => {
    const start = text.indexOf("==?");
    return { start, end: text.indexOf("==", start + 3) + 2 };
  };

  it("is true when the marker is alone on its line", () => {
    const t = "intro\n==?glossa: x==\noutro";
    expect(isBlockMarker(t, span(t))).toBe(true);
    const crlf = "intro\r\n  ==?glossa: x==  \r\noutro";
    expect(isBlockMarker(crlf, span(crlf))).toBe(true);
    const only = "==?glossa: x==";
    expect(isBlockMarker(only, span(only))).toBe(true);
  });

  it("is false when other text shares the line", () => {
    for (const t of ["see ==?glossa: x==", "==?glossa: x== more", "a ==?glossa: x== b"]) {
      expect(isBlockMarker(t, span(t))).toBe(false);
    }
  });
});

describe("appendFootnoteDefinition", () => {
  it("adds the definition after a blank line", () => {
    expect(appendFootnoteDefinition("Text[^lac-a].\n", "[^lac-a]: link")).toBe("Text[^lac-a].\n\n[^lac-a]: link\n");
  });

  it("stacks it under existing definitions", () => {
    const text = "Text[^1][^lac-b].\n\n[^1]: first\n";
    expect(appendFootnoteDefinition(text, "[^lac-b]: link")).toBe("Text[^1][^lac-b].\n\n[^1]: first\n[^lac-b]: link\n");
  });

  it("handles a note without a trailing newline, and an empty note", () => {
    expect(appendFootnoteDefinition("Text", "[^a]: l")).toBe("Text\n\n[^a]: l\n");
    expect(appendFootnoteDefinition("", "[^a]: l")).toBe("[^a]: l\n");
  });
});
