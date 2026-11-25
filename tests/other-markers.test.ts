import { describe, expect, it } from "vitest";
import { blankOtherMarkers, type ContextResult } from "../src/context";
import { buildPrompt, GAP } from "../src/prompt";

/** A context whose own marker is the first one containing `own`. */
function ctx(text: string, own: string): ContextResult {
  const markerStart = text.indexOf(own);
  return { text, markerStart, markerEnd: markerStart + own.length };
}

describe("blankOtherMarkers", () => {
  const OWN = "==?fill: the codename==";
  const OTHER = "==?suppl: exact retail release date==";

  it("blanks the markers after the own one, and keeps the own marker", () => {
    const c = blankOtherMarkers(ctx(`Under the codename ${OWN} and sold on ${OTHER}.`, OWN));
    expect(c.text).toBe(`Under the codename ${OWN} and sold on […].`);
    expect(c.text.slice(c.markerStart, c.markerEnd)).toBe(OWN);
  });

  it("blanks the markers before it, and moves the offsets", () => {
    const c = blankOtherMarkers(ctx(`Sold on ${OTHER} under the codename ${OWN}.`, OWN));
    expect(c.text).toBe(`Sold on […] under the codename ${OWN}.`);
    expect(c.text.slice(c.markerStart, c.markerEnd)).toBe(OWN);
  });

  it("blanks a marker over several lines, and one in another paragraph", () => {
    const text = `First ==?suppl: two\nlines== here.\n\nThen ${OWN} and ==?sic:==.`;
    const c = blankOtherMarkers(ctx(text, OWN));
    expect(c.text).toBe(`First […] here.\n\nThen ${OWN} and […].`);
    expect(c.text.slice(c.markerStart, c.markerEnd)).toBe(OWN);
  });

  it("leaves a plain highlight and a text without other markers alone", () => {
    const text = `A ==plain highlight== and ${OWN}.`;
    expect(blankOtherMarkers(ctx(text, OWN))).toEqual(ctx(text, OWN));
  });
});

describe("buildPrompt and the other lacunae", () => {
  const OWN = "==?fill: the codename==";
  const TEXT = `Under the codename ${OWN} and sold on ==?suppl: exact retail release date==.`;
  const base = {
    kind: "suppl" as const,
    question: "the codename",
    noteTitle: "Windows 95",
    context: ctx(TEXT, OWN),
    inline: true,
    rejected: [],
    maxCandidates: 3,
  };

  it("sends the other markers as [...], never as questions", () => {
    const p = buildPrompt(base);
    expect(p).toContain(`Under the codename ${GAP} and sold on […].`);
    expect(p).not.toContain("==?");
    expect(p).not.toContain("exact retail release date");
  });

  it("tells the search that [...] are not its question, but only when there are some", () => {
    expect(buildPrompt(base)).toContain("Other gaps, marked […], are separate questions");
    const alone = buildPrompt({ ...base, context: ctx(`Under the codename ${OWN}.`, OWN) });
    expect(alone).not.toContain("Other gaps");
  });

  it("asks for sources that support their own candidate, and for fewer candidates rather than guesses", () => {
    const p = buildPrompt(base);
    expect(p).toContain("must support that very answer");
    expect(p).toContain("Return fewer candidates rather than one you found no support for.");
  });
});
