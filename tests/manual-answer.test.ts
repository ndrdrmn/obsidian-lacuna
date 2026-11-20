import { describe, expect, it } from "vitest";
import { validateManualAnswer } from "../src/resolvers/manual-answer";

describe("validateManualAnswer", () => {
  it("turns the typed answer into one candidate, resolver manual", () => {
    const o = validateManualAnswer({ kind: "suppl", answer: "  August 24, 1995 \n", sourceUrl: "" });
    expect(o).toEqual({
      ok: true,
      result: {
        resolver: "manual",
        verdict: undefined,
        candidates: [{ answer: "August 24, 1995", sources: [] }],
      },
    });
  });

  it("asks for an answer", () => {
    for (const kind of ["suppl", "fontes", "glossa", "cf"] as const) {
      expect(validateManualAnswer({ kind, answer: "  \n ", sourceUrl: "" })).toEqual({
        ok: false,
        error: "Write the answer first.",
      });
    }
    expect(validateManualAnswer({ kind: "sic", verdict: "corrected", answer: "", sourceUrl: "" }).ok).toBe(false);
  });

  it("accepts an optional web link as the source, trimmed", () => {
    const o = validateManualAnswer({ kind: "suppl", answer: "x", sourceUrl: " https://example.com/page " });
    expect(o.ok && o.result.candidates[0].sources).toEqual([
      { title: "https://example.com/page", url: "https://example.com/page" },
    ]);
  });

  it("refuses a source that is not a web link", () => {
    for (const sourceUrl of ["example.com", "javascript:alert(1)", "file:///etc/passwd", "https://a b", "see page 3"]) {
      const o = validateManualAnswer({ kind: "suppl", answer: "x", sourceUrl });
      expect(o.ok, sourceUrl).toBe(false);
    }
  });

  it("sic: a wrong claim needs the correction, and records the verdict", () => {
    const o = validateManualAnswer({ kind: "sic", verdict: "corrected", answer: "July 14, 1995", sourceUrl: "" });
    expect(o.ok && o.result.verdict).toBe("corrected");
    expect(o.ok && o.result.candidates[0].answer).toBe("July 14, 1995");
  });

  it("sic: a confirmed claim needs no text", () => {
    const o = validateManualAnswer({ kind: "sic", verdict: "confirmed", answer: "", sourceUrl: "" });
    expect(o).toMatchObject({ ok: true, result: { verdict: "confirmed", candidates: [{ answer: "Confirmed." }] } });
  });

  it("only sic has a verdict", () => {
    const o = validateManualAnswer({ kind: "cf", verdict: "confirmed", answer: "x", sourceUrl: "" });
    expect(o.ok && o.result.verdict).toBeUndefined();
  });
});
