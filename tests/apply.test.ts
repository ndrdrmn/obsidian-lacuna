import { describe, expect, it } from "vitest";
import {
  appendFootnoteDefinition,
  applyEdits,
  buildCitation,
  buildReplacement,
  isBlockMarker,
  anchorIdFor,
  planAccept,
  planAnchor,
  replaceMarker,
} from "../src/apply";

describe("anchorIdFor", () => {
  it("is lac- and the number of the history note", () => {
    expect(anchorIdFor(122, "")).toBe("lac-122");
  });

  it("skips an id the note already uses, as a footnote or as an anchor", () => {
    expect(anchorIdFor(7, "text[^lac-7]\n\n[^lac-7]: x")).toBe("lac-7-2");
    expect(anchorIdFor(7, "para ^lac-7\n\ncopy[^lac-7-2]")).toBe("lac-7-3");
  });

  it("does not mistake a longer number for the same one", () => {
    expect(anchorIdFor(12, "text[^lac-122]")).toBe("lac-12");
  });
});

describe("buildCitation", () => {
  it("builds a footnote reference and a definition that names the note and the question", () => {
    expect(buildCitation("footnote", "[[Apparatus/n|Lacuna #122]]", "lac-122", "what is it")).toEqual({
      inline: "[^lac-122]",
      definition: "[^lac-122]: See [[Apparatus/n|Lacuna #122]]: “what is it”.",
    });
  });

  it("shortens a long question, on one line, without brackets", () => {
    const d = buildCitation("footnote", "[[n]]", "lac-1", `a [b]\nc ${"x".repeat(100)}`).definition;
    expect(d).toMatch(/^\[\^lac-1\]: See \[\[n\]\]: “a \(b\) c x+…”\.$/);
    expect(d?.length).toBeLessThan(110);
  });

  it("has no quotation when there is no question", () => {
    expect(buildCitation("footnote", "[[n]]", "lac-1").definition).toBe("[^lac-1]: See [[n]].");
  });

  it("builds an inline link with a leading space", () => {
    expect(buildCitation("inline", "[ad loc.](x.md)")).toEqual({ inline: " [ad loc.](x.md)" });
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

const spanOf = (text: string) => {
  const start = text.indexOf("==?");
  return { start, end: text.indexOf("==", start + 3) + 2 };
};

describe("planAccept", () => {
  const link = "[[Apparatus/n|Lacuna #122]]";
  const note = "See [[Apparatus/n|Lacuna #122]]: “q”.";
  const accept = (text: string, over: Partial<Parameters<typeof planAccept>[2]> = {}) =>
    applyEdits(
      text,
      planAccept(text, spanOf(text), {
        kind: "suppl",
        answer: "1995",
        style: "footnote",
        link,
        id: "lac-122",
        question: "q",
        ...over,
      }).edits,
    );

  it("replaces the marker, anchors the paragraph and adds the footnote at the end", () => {
    expect(accept("Released in ==?suppl: year== by MS.\n")).toBe(
      `Released in 1995[^lac-122] by MS. ^lac-122\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("stacks the footnote under existing ones", () => {
    expect(accept("A ==?suppl: x==[^1].\n\n[^1]: old\n")).toBe(
      `A 1995[^lac-122][^1]. ^lac-122\n\n[^1]: old\n[^lac-122]: ${note}\n`,
    );
  });

  it("inline style adds no footnote, only the anchor", () => {
    const link = "[[Apparatus/n|ad loc.]]";
    expect(accept("Released in ==?suppl: year== by MS.\n", { style: "inline", link })).toBe(
      "Released in 1995 [[Apparatus/n|ad loc.]] by MS. ^lac-122\n",
    );
  });

  it("works when the marker is the last thing in the note", () => {
    expect(accept("Released ==?suppl: year==")).toBe(`Released 1995[^lac-122] ^lac-122\n\n[^lac-122]: ${note}\n`);
  });

  it("sic: a confirmed claim leaves only the citation, a wrong one a correction", () => {
    expect(accept("It was 1995 ==?sic:==.\n", { kind: "sic", verdict: "confirmed" })).toBe(
      `It was 1995 [^lac-122]. ^lac-122\n\n[^lac-122]: ${note}\n`,
    );
    expect(accept("It was 1996 ==?sic:==.\n", { kind: "sic", verdict: "corrected" })).toBe(
      `It was 1996 (actually: 1995[^lac-122]). ^lac-122\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("a block marker keeps a multi-line answer, and the anchor goes at its end", () => {
    expect(accept("Before.\n\n==?glossa: what==\n\nAfter.\n", { kind: "glossa", answer: "Line one.\nLine two." })).toBe(
      `Before.\n\nLine one.\nLine two.[^lac-122] ^lac-122\n\nAfter.\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("an inline marker joins the lines of the answer", () => {
    const link = "[[n|ad loc.]]";
    expect(accept("See ==?suppl: x== now.\n", { answer: "one\ntwo", style: "inline", link })).toBe(
      "See one two [[n|ad loc.]] now. ^lac-122\n",
    );
  });

  it("a table answer puts the citation under the table", () => {
    expect(accept("==?cf: compare==\n", { kind: "cf", answer: "| a | b |\n|---|---|\n| 1 | 2 |" })).toBe(
      `| a | b |\n|---|---|\n| 1 | 2 |\n\n[^lac-122] ^lac-122\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("a heading takes no anchor, and says so", () => {
    const text = "## Title ==?suppl: x==\n";
    const plan = planAccept(text, spanOf(text), {
      kind: "suppl", answer: "A", style: "inline", link: "[[n|ad loc.]]", id: "lac-1", question: "",
    });
    expect(plan.anchor).toBeNull();
    expect(applyEdits(text, plan.edits)).toBe("## Title A [[n|ad loc.]]\n");
  });

  it("reuses an anchor the block already has, and returns it", () => {
    const text = "Text ==?suppl: x== here. ^mine\n";
    const plan = planAccept(text, spanOf(text), {
      kind: "suppl", answer: "A", style: "inline", link: "[[n|ad loc.]]", id: "lac-1", question: "",
    });
    expect(plan.anchor).toBe("mine");
    expect(applyEdits(text, plan.edits)).toBe("Text A [[n|ad loc.]] here. ^mine\n");
  });

  it("returns the anchor it wrote", () => {
    const text = "Text ==?suppl: x==\n";
    const plan = planAccept(text, spanOf(text), {
      kind: "suppl", answer: "A", style: "inline", link: "[[n|ad loc.]]", id: "lac-1", question: "",
    });
    expect(plan.anchor).toBe("lac-1");
  });
});

describe("planAnchor", () => {
  const anchored = (text: string, id = "lac-1") => {
    const a = planAnchor(text, spanOf(text), id);
    return { id: a.id, text: a.edit ? applyEdits(text, [a.edit]) : text };
  };

  it("goes at the end of the last line of a paragraph", () => {
    expect(anchored("Para ==?suppl: x== end.\nsecond line.\n\nNext.").text).toBe(
      "Para ==?suppl: x== end.\nsecond line. ^lac-1\n\nNext.",
    );
  });

  it("goes at the end of a list item, not of the list", () => {
    expect(anchored("- item ==?suppl: x==\n- other\n").text).toBe("- item ==?suppl: x== ^lac-1\n- other\n");
  });

  it("goes at the end of the paragraph when the marker spans several lines", () => {
    expect(anchored("Start ==?suppl: two\nlines== end.\nmore\n\nNext").text).toBe(
      "Start ==?suppl: two\nlines== end.\nmore ^lac-1\n\nNext",
    );
  });

  it("goes at the end of the note when there is no newline", () => {
    expect(anchored("Text ==?suppl: x==").text).toBe("Text ==?suppl: x== ^lac-1");
  });

  it("goes before the line break of a CRLF file", () => {
    expect(anchored("Para ==?suppl: x==\r\n\r\nNext").text).toBe("Para ==?suppl: x== ^lac-1\r\n\r\nNext");
  });

  it("takes a line of its own after a table", () => {
    expect(anchored("| a | b |\n|---|---|\n| ==?suppl: x== | 2 |\n\nafter\n").text).toBe(
      "| a | b |\n|---|---|\n| ==?suppl: x== | 2 |\n\n^lac-1\n\nafter\n",
    );
  });

  it("takes a line of its own after a quote, with a blank line before the next block", () => {
    expect(anchored("> a ==?suppl: x==\n> b\n\nNext").text).toBe("> a ==?suppl: x==\n> b\n\n^lac-1\n\nNext");
    expect(anchored("> a ==?suppl: x==\n# H\n").text).toBe("> a ==?suppl: x==\n\n^lac-1\n\n# H\n");
  });

  it("does not take a heading", () => {
    expect(anchored("## Title ==?suppl: x==\n")).toEqual({ id: null, text: "## Title ==?suppl: x==\n" });
  });

  it("reuses the id a block already has", () => {
    expect(anchored("Text ==?suppl: x== here. ^abc-1\n")).toEqual({ id: "abc-1", text: "Text ==?suppl: x== here. ^abc-1\n" });
    expect(anchored("> q ==?suppl: x==\n\n^qq\n\nNext").id).toBe("qq");
  });
});
