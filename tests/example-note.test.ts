import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAliasMap } from "../src/lang/keywords";
import { LATIN_ID } from "../src/lang/packs";
import { parseMarkers } from "../src/marker";

/**
 * `test-vault/Windows 95.md` is the first thing anyone who forks the repository opens.
 * This keeps it a good example: what it shows as markers must be markers, and nothing else.
 */
describe("the example note of the test vault", () => {
  const text = readFileSync(new URL("../test-vault/Windows 95.md", import.meta.url), "utf8");
  // The settings of a new vault: Latin and English, and suppl for a marker without a keyword.
  const markers = parseMarkers(text, { aliasMap: buildAliasMap([LATIN_ID, "en"], {}), defaultKind: "suppl" });

  it("lists one marker of each kind, in Latin and English", () => {
    const summary = markers.map((m) => `${m.kind}: ${m.question}`);
    expect(summary).toEqual([
      "suppl: the codename",
      "suppl: exact retail release date",
      "sic: ",
      "fontes: the sales figures for the launch week",
      "cf: how Windows 95 and Windows 3.1 handled memory",
      "suppl: who composed it",
      "glossa: what Plug and Play detection did",
      "suppl: the editions and what set each of them apart",
      // Italian is not switched on: no known keyword, so the whole text is the question.
      "suppl: verifica: Windows 95 non richiedeva MS-DOS per avviarsi",
    ]);
  });

  it("has a marker with an English keyword, one without a keyword and one over two lines", () => {
    expect(markers.find((m) => m.question === "the codename")?.raw).toBe("==?fill: the codename==");
    expect(markers.find((m) => m.question === "who composed it")?.alias).toBeUndefined();
    expect(markers.some((m) => m.endLine > m.line)).toBe(true);
  });

  it("lists nothing from its 'Not markers' section or its frontmatter", () => {
    const notMarkers = text.indexOf("## Not markers");
    expect(notMarkers).toBeGreaterThan(0);
    expect(markers.every((m) => m.end < notMarkers)).toBe(true);
    expect(text.slice(0, text.indexOf("\n---\n", 4))).toContain("==?suppl: a marker in the frontmatter");
    expect(markers.every((m) => m.start > text.indexOf("\n---\n", 4))).toBe(true);
  });
});
