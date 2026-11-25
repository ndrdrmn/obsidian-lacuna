import { describe, expect, it } from "vitest";
import {
  appendFootnoteDefinition,
  applyEdits,
  buildCitation,
  buildReplacement,
  isBlockMarker,
  answerExcerpt,
  blockAnchorIdFor,
  footnoteIdFor,
  planAccept,
  planAnchor,
  replaceMarker,
} from "../src/apply";

describe("footnoteIdFor", () => {
  it("is lac- and the number of the history note", () => {
    expect(footnoteIdFor(122, "")).toBe("lac-122");
  });

  it("skips an id the article already uses, as a footnote or as an old-style anchor", () => {
    expect(footnoteIdFor(7, "text[^lac-7]\n\n[^lac-7]: x")).toBe("lac-7-2");
    expect(footnoteIdFor(7, "para ^lac-7\n\ncopy[^lac-7-2]")).toBe("lac-7-3");
  });

  it("does not mistake a longer number for the same one", () => {
    expect(footnoteIdFor(12, "text[^lac-122]")).toBe("lac-12");
  });
});

describe("blockAnchorIdFor", () => {
  it("numbers the anchors of an article: adloc-1, then the next free number", () => {
    expect(blockAnchorIdFor("")).toBe("adloc-1");
    expect(blockAnchorIdFor("a ^adloc-1\n\nb ^adloc-2\n")).toBe("adloc-3");
    expect(blockAnchorIdFor("a ^adloc-7\n")).toBe("adloc-8");
  });

  it("is not named after a history note, and ignores other block ids", () => {
    expect(blockAnchorIdFor("a ^lac-7\n\nb ^mine\n\nc[^lac-9]")).toBe("adloc-1");
  });

  it("does not take a longer id for one of its own", () => {
    expect(blockAnchorIdFor("a ^adloc-2-copy\n")).toBe("adloc-1");
  });
});

describe("two lacunae in one paragraph", () => {
  const link = "[[Apparatus/n|Lacuna #8]]";
  const opts = (n: number, text: string) => ({
    kind: "suppl" as const,
    answer: "Chicago",
    style: "footnote" as const,
    link,
    footnoteId: footnoteIdFor(n, text),
    anchorId: blockAnchorIdFor(text),
    question: "q",
  });

  it("the second answer reuses the paragraph's anchor, and keeps its own footnote", () => {
    const first = "Under the codename ==?fill: x== it sold on ==?suppl: y==.\n";
    const p1 = planAccept(first, spanOf(first), opts(7, first));
    expect(p1.anchor).toBe("adloc-1");
    const afterFirst = applyEdits(first, p1.edits);
    expect(afterFirst).toContain("sold on ==?suppl: y==. ^adloc-1\n");

    const span2 = { start: afterFirst.indexOf("==?suppl"), end: afterFirst.indexOf("==.", afterFirst.indexOf("==?suppl")) + 2 };
    const p2 = planAccept(afterFirst, span2, opts(8, afterFirst));
    expect(p2.anchor).toBe("adloc-1");
    const done = applyEdits(afterFirst, p2.edits);
    expect(done.match(/\^adloc-1(?![\w-])/g)).toHaveLength(1);
    expect(done).toContain("[^lac-7]");
    expect(done).toContain("[^lac-8]");
  });
});

describe("answerExcerpt", () => {
  const find = (text: string) => spanOf(text);

  it("shows the words around the answer, in the paragraph only", () => {
    const text = "Before.\n\nIt was developed under the codename ==?fill: x== and went on sale.\n\nAfter.";
    expect(answerExcerpt(text, find(text), "Chicago")).toBe("It was developed under the codename Chicago and went on sale.");
  });

  it("cuts a long paragraph at word boundaries", () => {
    const left = "word ".repeat(30);
    const right = " word".repeat(30);
    const text = `${left}==?fill: x==${right}`;
    const e = answerExcerpt(text, find(text), "Chicago", 20);
    expect(e.startsWith("…")).toBe(true);
    expect(e.endsWith("…")).toBe(true);
    expect(e).toMatch(/word Chicago word/);
    expect(e.length).toBeLessThan(60);
  });

  it("blanks another lacuna, and drops footnote references, anchors and link brackets", () => {
    const text = "See [[Other|the other note]] and ==?sic:== here[^lac-3] ==?fill: x== then [x] ^adloc-2";
    const span = { start: text.indexOf("==?fill"), end: text.indexOf("== then") + 2 };
    expect(answerExcerpt(text, span, "Y")).toBe("See the other note and […] here Y then (x)");
  });

  it("shortens a long answer, on one line", () => {
    const text = "A ==?glossa: x== B";
    const e = answerExcerpt(text, find(text), `one\ntwo ${"x".repeat(200)}`, 45, 30);
    expect(e).toMatch(/^A one two x+… B$/);
  });

  it("shows only what stands before the citation when nothing replaces the marker", () => {
    const text = "It reached the shops in 1996 ==?sic:== and was promoted.";
    expect(answerExcerpt(text, find(text), "")).toBe("It reached the shops in 1996 and was promoted.");
  });

  it("is part of the plan: a sic correction shows the correction", () => {
    const text = "It was 1996 ==?sic:==.\n";
    const plan = planAccept(text, find(text), {
      kind: "sic", verdict: "corrected", answer: "1995", style: "inline", link: "[[n|ad loc.]]",
      footnoteId: "lac-1", anchorId: "adloc-1", question: "",
    });
    expect(plan.excerpt).toBe("It was 1996 (actually: 1995).");
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
        footnoteId: "lac-122",
        anchorId: "adloc-1",
        question: "q",
        ...over,
      }).edits,
    );

  it("replaces the marker, anchors the paragraph and adds the footnote at the end", () => {
    expect(accept("Released in ==?suppl: year== by MS.\n")).toBe(
      `Released in 1995[^lac-122] by MS. ^adloc-1\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("stacks the footnote under existing ones", () => {
    expect(accept("A ==?suppl: x==[^1].\n\n[^1]: old\n")).toBe(
      `A 1995[^lac-122][^1]. ^adloc-1\n\n[^1]: old\n[^lac-122]: ${note}\n`,
    );
  });

  it("inline style adds no footnote, only the anchor", () => {
    const link = "[[Apparatus/n|ad loc.]]";
    expect(accept("Released in ==?suppl: year== by MS.\n", { style: "inline", link })).toBe(
      "Released in 1995 [[Apparatus/n|ad loc.]] by MS. ^adloc-1\n",
    );
  });

  it("works when the marker is the last thing in the note", () => {
    expect(accept("Released ==?suppl: year==")).toBe(`Released 1995[^lac-122] ^adloc-1\n\n[^lac-122]: ${note}\n`);
  });

  it("sic: a confirmed claim leaves only the citation, a wrong one a correction", () => {
    expect(accept("It was 1995 ==?sic:==.\n", { kind: "sic", verdict: "confirmed" })).toBe(
      `It was 1995 [^lac-122]. ^adloc-1\n\n[^lac-122]: ${note}\n`,
    );
    expect(accept("It was 1996 ==?sic:==.\n", { kind: "sic", verdict: "corrected" })).toBe(
      `It was 1996 (actually: 1995[^lac-122]). ^adloc-1\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("a block marker keeps a multi-line answer, and the anchor goes at its end", () => {
    expect(accept("Before.\n\n==?glossa: what==\n\nAfter.\n", { kind: "glossa", answer: "Line one.\nLine two." })).toBe(
      `Before.\n\nLine one.\nLine two.[^lac-122] ^adloc-1\n\nAfter.\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("an inline marker joins the lines of the answer", () => {
    const link = "[[n|ad loc.]]";
    expect(accept("See ==?suppl: x== now.\n", { answer: "one\ntwo", style: "inline", link })).toBe(
      "See one two [[n|ad loc.]] now. ^adloc-1\n",
    );
  });

  it("a table answer puts the citation under the table", () => {
    expect(accept("==?cf: compare==\n", { kind: "cf", answer: "| a | b |\n|---|---|\n| 1 | 2 |" })).toBe(
      `| a | b |\n|---|---|\n| 1 | 2 |\n\n[^lac-122] ^adloc-1\n\n[^lac-122]: ${note}\n`,
    );
  });

  it("a heading takes no anchor, and says so", () => {
    const text = "## Title ==?suppl: x==\n";
    const plan = planAccept(text, spanOf(text), {
      kind: "suppl", answer: "A", style: "inline", link: "[[n|ad loc.]]", footnoteId: "lac-1", anchorId: "adloc-1", question: "",
    });
    expect(plan.anchor).toBeNull();
    expect(applyEdits(text, plan.edits)).toBe("## Title A [[n|ad loc.]]\n");
  });

  it("reuses an anchor the block already has, and returns it", () => {
    const text = "Text ==?suppl: x== here. ^mine\n";
    const plan = planAccept(text, spanOf(text), {
      kind: "suppl", answer: "A", style: "inline", link: "[[n|ad loc.]]", footnoteId: "lac-1", anchorId: "adloc-1", question: "",
    });
    expect(plan.anchor).toBe("mine");
    expect(applyEdits(text, plan.edits)).toBe("Text A [[n|ad loc.]] here. ^mine\n");
  });

  it("returns the anchor it wrote", () => {
    const text = "Text ==?suppl: x==\n";
    const plan = planAccept(text, spanOf(text), {
      kind: "suppl", answer: "A", style: "inline", link: "[[n|ad loc.]]", footnoteId: "lac-1", anchorId: "adloc-1", question: "",
    });
    expect(plan.anchor).toBe("adloc-1");
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
