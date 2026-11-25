import { describe, expect, it } from "vitest";
import {
  appendFootnoteDefinition,
  applyEdits,
  buildCitation,
  buildReplacement,
  isBlockMarker,
  newFootnoteId,
  planAccept,
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

  it("is true for a marker over several lines that fills them", () => {
    const t = "intro\n==?glossa: how it\nworked==\noutro";
    expect(isBlockMarker(t, span(t))).toBe(true);
  });

  it("is false when text shares the first or the last line of a multi-line marker", () => {
    for (const t of ["see ==?glossa: how it\nworked==", "==?glossa: how it\nworked== more"]) {
      expect(isBlockMarker(t, span(t))).toBe(false);
    }
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

describe("planAccept", () => {
  const link = "[[Apparatus/n|ad loc.]]";
  const spanOf = (text: string) => {
    const start = text.indexOf("==?");
    return { start, end: text.indexOf("==", start + 3) + 2 };
  };
  const accept = (text: string, over: Partial<Parameters<typeof planAccept>[2]> = {}) =>
    applyEdits(
      text,
      planAccept(text, spanOf(text), { kind: "suppl", answer: "1995", style: "footnote", link, footnoteId: "lac-abcd", ...over }),
    );

  it("replaces the marker and adds the footnote at the end", () => {
    expect(accept("Released in ==?suppl: year== by MS.\n")).toBe(
      "Released in 1995[^lac-abcd] by MS.\n\n[^lac-abcd]: [[Apparatus/n|ad loc.]]\n",
    );
  });

  it("stacks the footnote under existing ones", () => {
    expect(accept("A ==?suppl: x==[^1].\n\n[^1]: old\n")).toBe(
      "A 1995[^lac-abcd][^1].\n\n[^1]: old\n[^lac-abcd]: [[Apparatus/n|ad loc.]]\n",
    );
  });

  it("inline style changes only the marker", () => {
    expect(accept("Released in ==?suppl: year== by MS.\n", { style: "inline", footnoteId: undefined })).toBe(
      "Released in 1995 [[Apparatus/n|ad loc.]] by MS.\n",
    );
  });

  it("works when the marker is the last thing in the note", () => {
    expect(accept("Released ==?suppl: year==")).toBe("Released 1995[^lac-abcd]\n\n[^lac-abcd]: [[Apparatus/n|ad loc.]]\n");
  });

  it("sic: a confirmed claim leaves only the citation, a wrong one a correction", () => {
    expect(accept("It was 1995 ==?sic:==.\n", { kind: "sic", verdict: "confirmed" })).toBe(
      "It was 1995 [^lac-abcd].\n\n[^lac-abcd]: [[Apparatus/n|ad loc.]]\n",
    );
    expect(accept("It was 1996 ==?sic:==.\n", { kind: "sic", verdict: "corrected", answer: "1995" })).toBe(
      "It was 1996 (actually: 1995[^lac-abcd]).\n\n[^lac-abcd]: [[Apparatus/n|ad loc.]]\n",
    );
  });

  it("a block marker keeps a multi-line answer", () => {
    expect(accept("Before.\n\n==?glossa: what==\n\nAfter.\n", { kind: "glossa", answer: "Line one.\nLine two." })).toBe(
      "Before.\n\nLine one.\nLine two.[^lac-abcd]\n\nAfter.\n\n[^lac-abcd]: [[Apparatus/n|ad loc.]]\n",
    );
  });

  it("an inline marker joins the lines of the answer", () => {
    expect(accept("See ==?suppl: x== now.\n", { answer: "one\ntwo", style: "inline", footnoteId: undefined })).toBe(
      "See one two [[Apparatus/n|ad loc.]] now.\n",
    );
  });

  it("a table answer puts the citation under the table", () => {
    expect(accept("==?cf: compare==\n", { kind: "cf", answer: "| a | b |\n|---|---|\n| 1 | 2 |" })).toBe(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n[^lac-abcd]\n\n[^lac-abcd]: [[Apparatus/n|ad loc.]]\n",
    );
  });

  it("needs an id for a footnote", () => {
    expect(() => accept("A ==?suppl: x==\n", { footnoteId: undefined })).toThrow();
  });
});
