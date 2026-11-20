import { describe, expect, it } from "vitest";
import { isValidAliasFormat, normalize } from "../src/lang/keywords";
import { ALL_PACK_IDS, IDIOLECT_ID, KINDS, LATIN_ID, PACKS } from "../src/lang/packs";

describe("built-in packs", () => {
  it("have unique ids, and Latin comes first", () => {
    const ids = PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(LATIN_ID);
    expect(ALL_PACK_IDS).toContain(IDIOLECT_ID);
  });

  it("give Latin the canonical kind names", () => {
    const latin = PACKS[0];
    for (const kind of KINDS) expect(latin.aliases[kind]).toBe(kind);
  });

  it("define every kind with a well-formed single word", () => {
    for (const pack of PACKS) {
      for (const kind of KINDS) {
        const word = pack.aliases[kind];
        expect(word, `${pack.id}/${kind}`).toBeTruthy();
        expect(isValidAliasFormat(word), `${pack.id}/${kind}: "${word}"`).toBe(true);
      }
    }
  });

  it("never reuse a word, across all packs, after case and accent folding", () => {
    const seen = new Map<string, string>();
    for (const pack of PACKS) {
      for (const kind of KINDS) {
        const key = normalize(pack.aliases[kind]);
        const where = `${pack.id}/${kind}`;
        expect(seen.get(key), `"${key}" is used by ${seen.get(key)} and ${where}`).toBeUndefined();
        seen.set(key, where);
      }
    }
  });
});
