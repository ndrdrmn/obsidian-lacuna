import { describe, expect, it } from "vitest";
import { extractContext, extractClaim } from "../src/context";
import { parseMarkers } from "../src/marker";
import { buildAliasMap } from "../src/lang/keywords";
import { LATIN_ID } from "../src/lang/packs";
import { parseSource, splitContext, validateManualAnswer } from "../src/resolvers/manual-answer";

describe("validateManualAnswer", () => {
  it("turns the typed answer into one candidate, resolver manual", () => {
    const o = validateManualAnswer({ kind: "suppl", answer: "  August 24, 1995 \n", source: "" });
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
      expect(validateManualAnswer({ kind, answer: "  \n ", source: "" })).toEqual({
        ok: false,
        error: "Write the answer first.",
      });
    }
    expect(validateManualAnswer({ kind: "sic", verdict: "corrected", answer: "", source: "" }).ok).toBe(false);
  });

  it("refuses an answer with a heading, wherever it is", () => {
    for (const answer of ["# Title", "intro\n## Section\ntext", "text\n   ### deep", "a\n######"]) {
      const o = validateManualAnswer({ kind: "glossa", answer, source: "" });
      expect(o.ok, answer).toBe(false);
      expect(!o.ok && o.error).toMatch(/heading/);
    }
  });

  it("allows a # that is not a heading", () => {
    for (const answer of ["C# is a language", "issue #42", "a\n#hashtag", "x\n    # indented code"]) {
      expect(validateManualAnswer({ kind: "glossa", answer, source: "" }).ok, answer).toBe(true);
    }
  });

  it("keeps a web link as a source, titled with its host", () => {
    const o = validateManualAnswer({ kind: "suppl", answer: "x", source: " https://www.example.com/page " });
    expect(o.ok && o.result.candidates[0].sources).toEqual([
      { title: "example.com", url: "https://www.example.com/page" },
    ]);
  });

  it("keeps anything else as free text, without a link", () => {
    for (const source of ["Petzold, Code, p. 212", "from memory", "example.com", "https://a b", "javascript:alert(1)"]) {
      const o = validateManualAnswer({ kind: "suppl", answer: "x", source });
      expect(o.ok && o.result.candidates[0].sources, source).toEqual([{ title: source }]);
    }
  });

  it("sic: a wrong claim needs the correction, and records the verdict", () => {
    const o = validateManualAnswer({ kind: "sic", verdict: "corrected", answer: "July 14, 1995", source: "" });
    expect(o.ok && o.result.verdict).toBe("corrected");
    expect(o.ok && o.result.candidates[0].answer).toBe("July 14, 1995");
  });

  it("sic: a confirmed claim needs no text", () => {
    const o = validateManualAnswer({ kind: "sic", verdict: "confirmed", answer: "", source: "" });
    expect(o).toMatchObject({ ok: true, result: { verdict: "confirmed", candidates: [{ answer: "Confirmed." }] } });
  });

  it("sic: a confirmed claim keeps the note the user wrote", () => {
    const o = validateManualAnswer({ kind: "sic", verdict: "confirmed", answer: "Checked in the manual.", source: "" });
    expect(o.ok && o.result.candidates[0].answer).toBe("Checked in the manual.");
  });

  it("only sic has a verdict", () => {
    const o = validateManualAnswer({ kind: "cf", verdict: "confirmed", answer: "x", source: "" });
    expect(o.ok && o.result.verdict).toBeUndefined();
  });
});

describe("parseSource", () => {
  it("is null for nothing", () => {
    expect(parseSource("")).toBeNull();
    expect(parseSource("  \n ")).toBeNull();
  });

  it("squeezes the spaces of free text", () => {
    expect(parseSource("  my   own\n notes ")).toEqual({ title: "my own notes" });
  });
});

describe("splitContext", () => {
  const opts = { aliasMap: buildAliasMap([LATIN_ID, "en"], {}), defaultKind: "suppl" as const };

  function pieces(text: string, claimOf = false) {
    const marker = parseMarkers(text, opts)[0];
    const ctx = extractContext(text, marker, "paragraphPlusMinusOne");
    return splitContext(ctx, claimOf ? extractClaim(text, marker) : undefined);
  }

  it("mutes the neighbouring paragraphs and marks the marker", () => {
    const p = pieces("Before it.\n\nThe date is ==?suppl: when== it was.\n\nAfter it.");
    expect(p).toEqual([
      { text: "Before it.\n\n", role: "muted" },
      { text: "The date is ", role: "plain" },
      { text: "==?suppl: when==", role: "marker" },
      { text: " it was.", role: "plain" },
      { text: "\n\nAfter it.", role: "muted" },
    ]);
  });

  it("joins back into the context", () => {
    const text = "One.\n\nTwo ==?suppl: x== and more.\n\nThree.";
    const marker = parseMarkers(text, opts)[0];
    const ctx = extractContext(text, marker, "paragraphPlusMinusOne");
    expect(splitContext(ctx).map((x) => x.text).join("")).toBe(ctx.text);
  });

  it("has no muted pieces when the marker is alone in the note", () => {
    const p = pieces("==?glossa: what is this==");
    expect(p).toEqual([{ text: "==?glossa: what is this==", role: "marker" }]);
  });

  it("highlights the claim of a sic marker", () => {
    const p = pieces("It was Windows 95 in 1996 ==?sic:== indeed.", true);
    expect(p.find((x) => x.role === "claim")?.text).toBe("It was Windows 95 in 1996");
  });

  it("highlights a claim that is the previous sentence", () => {
    const p = pieces("Windows 95 came out in 1996. ==?sic:==", true);
    expect(p.find((x) => x.role === "claim")?.text).toBe("Windows 95 came out in 1996.");
  });

  it("copes with a marker over several lines", () => {
    const p = pieces("Before.\n\nA ==?suppl: two\nlines== here.\n\nAfter.");
    expect(p.find((x) => x.role === "marker")?.text).toBe("==?suppl: two\nlines==");
  });
});
