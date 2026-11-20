import { describe, expect, it } from "vitest";
import { extractClaim, extractContext, type ContextMode } from "../src/context";

const MARKER = "==?suppl: exact date==";
const DOC = [
  "---",
  "title: Windows 95",
  "---",
  "First paragraph here.",
  "",
  `Windows 95 was released in 1995. It was a big deal ${MARKER} for Microsoft. Another sentence.`,
  "",
  "Last paragraph.",
].join("\n");

function ctx(mode: ContextMode, text = DOC) {
  const start = text.indexOf(MARKER);
  const result = extractContext(text, { start, end: start + MARKER.length }, mode);
  // The marker must always be found where the result says it is.
  expect(result.text.slice(result.markerStart, result.markerEnd)).toBe(MARKER);
  return result;
}

describe("extractContext", () => {
  it("sentence: only the sentence holding the marker", () => {
    expect(ctx("sentence").text).toBe(`It was a big deal ${MARKER} for Microsoft.`);
  });

  it("paragraph: the block between blank lines", () => {
    expect(ctx("paragraph").text).toBe(
      `Windows 95 was released in 1995. It was a big deal ${MARKER} for Microsoft. Another sentence.`,
    );
  });

  it("paragraph ±1: also the previous and next paragraphs", () => {
    const t = ctx("paragraphPlusMinusOne").text;
    expect(t.startsWith("First paragraph here.")).toBe(true);
    expect(t.endsWith("Last paragraph.")).toBe(true);
    expect(t).toContain(MARKER);
  });

  it("paragraph ±1: works at the start and at the end of a note", () => {
    const first = `${MARKER} start.\n\nSecond.\n\nThird.`;
    expect(ctx("paragraphPlusMinusOne", first).text).toBe(`${MARKER} start.\n\nSecond.`);
    const last = `First.\n\nSecond.\n\nEnd ${MARKER}`;
    expect(ctx("paragraphPlusMinusOne", last).text).toBe(`Second.\n\nEnd ${MARKER}`);
  });

  it("note: the whole body, without the frontmatter", () => {
    const t = ctx("note").text;
    expect(t.startsWith("First paragraph here.")).toBe(true);
    expect(t).not.toContain("title:");
    expect(t.endsWith("Last paragraph.")).toBe(true);
  });

  it("never sends the frontmatter, whatever the mode", () => {
    for (const mode of ["sentence", "paragraph", "paragraphPlusMinusOne", "note"] as const) {
      expect(ctx(mode).text).not.toContain("Windows 95\n---");
      expect(ctx(mode).text).not.toContain("title:");
    }
  });

  it("is not fooled by the ? of another marker", () => {
    const text = "Before ==? foo== and ==?cf: x== then ==?suppl: y== end. Next.";
    const start = text.indexOf("==?suppl");
    const r = extractContext(text, { start, end: start + "==?suppl: y==".length }, "sentence");
    expect(r.text).toBe("Before ==? foo== and ==?cf: x== then ==?suppl: y== end.");
  });

  it("handles a marker that runs over a line break", () => {
    const text = "Before. It was ==?suppl: exact\ndate== for Microsoft. After.";
    const start = text.indexOf("==?");
    const end = text.indexOf("date==") + "date==".length;
    const r = extractContext(text, { start, end }, "sentence");
    expect(r.text).toBe("It was ==?suppl: exact\ndate== for Microsoft.");
    expect(r.text.slice(r.markerStart, r.markerEnd)).toBe("==?suppl: exact\ndate==");
  });

  it("starts a new sentence at a list item", () => {
    const text = `- first item\n- second ${MARKER} item`;
    const r = ctx("sentence", text);
    expect(r.text).toBe(`- second ${MARKER} item`);
  });
});

describe("extractClaim", () => {
  const claimOf = (text: string) => {
    const start = text.indexOf("==?");
    return extractClaim(text, { start, end: text.indexOf("==", start + 3) + 2 });
  };

  it("takes the words of the sentence before the marker", () => {
    expect(claimOf("Intro. Windows 95 was released in 1995 ==?sic==. More.")).toBe(
      "Windows 95 was released in 1995",
    );
  });

  it("takes the previous sentence when the marker starts a sentence", () => {
    expect(claimOf("Windows 95 was released in 1995. ==?sic== It was good.")).toBe(
      "Windows 95 was released in 1995.",
    );
  });

  it("is empty when nothing precedes the marker in its paragraph", () => {
    expect(claimOf("Earlier paragraph.\n\n==?sic== alone")).toBe("");
  });

  it("ignores the frontmatter", () => {
    expect(claimOf("---\ntitle: x. y.\n---\nThe sky is green ==?sic==")).toBe("The sky is green");
  });
});
