import { describe, expect, it } from "vitest";
import {
  buildAliasMap,
  findCollision,
  findIdiolectConflicts,
  isValidAliasFormat,
  normalize,
  popupKeywords,
  validateAlias,
} from "../src/lang/keywords";

describe("normalize", () => {
  it("lowercases and strips accents", () => {
    expect(normalize("Vérifier")).toBe("verifier");
    expect(normalize("PRÜFEN")).toBe("prufen");
    expect(normalize("  ergänzen ")).toBe("erganzen");
  });
});

describe("isValidAliasFormat", () => {
  it("accepts a single word and rejects the grammar's characters", () => {
    expect(isValidAliasFormat("integra")).toBe(true);
    expect(isValidAliasFormat("two words")).toBe(false);
    expect(isValidAliasFormat("a:b")).toBe(false);
    expect(isValidAliasFormat("a=b")).toBe(false);
    expect(isValidAliasFormat("why?")).toBe(false);
    expect(isValidAliasFormat("")).toBe(false);
  });
});

describe("buildAliasMap", () => {
  it("maps the words of the enabled packs only", () => {
    const map = buildAliasMap(["la", "en"], {});
    expect(map.get("fill")).toEqual({ kind: "suppl", packId: "en" });
    expect(map.get("suppl")).toEqual({ kind: "suppl", packId: "la" });
    expect(map.has("integra")).toBe(false);
  });

  it("does not need Latin to be enabled", () => {
    const map = buildAliasMap(["it"], {});
    expect(map.get("verifica")).toEqual({ kind: "sic", packId: "it" });
    expect(map.has("sic")).toBe(false);
  });

  it("keys are normalised, so lookups ignore case and accents", () => {
    const map = buildAliasMap(["fr", "de"], {});
    expect(map.get(normalize("Compléter"))?.kind).toBe("suppl");
    expect(map.get(normalize("PRÜFEN"))?.kind).toBe("sic");
  });

  it("adds the Idiolect only when it is enabled", () => {
    const idiolect = { suppl: "gap", cf: "versus" };
    expect(buildAliasMap(["la"], idiolect).has("gap")).toBe(false);
    expect(buildAliasMap(["la", "idiolect"], idiolect).get("gap")).toEqual({ kind: "suppl", packId: "idiolect" });
  });

  it("lets a built-in pack win over the Idiolect", () => {
    const map = buildAliasMap(["en", "idiolect"], { suppl: "fill" });
    expect(map.get("fill")?.packId).toBe("en");
  });

  it("ignores ill-formed Idiolect words and unknown pack ids", () => {
    const map = buildAliasMap(["klingon", "idiolect"], { suppl: "two words" });
    expect(map.size).toBe(0);
  });
});

describe("findCollision", () => {
  it("finds a word that already means another kind in a built-in pack", () => {
    expect(findCollision("verifica", "suppl", {})).toEqual({ kind: "sic", packName: "Italiano" });
    expect(findCollision("sic", "cf", {})).toEqual({ kind: "sic", packName: "Latina" });
  });

  it("ignores case and accents", () => {
    expect(findCollision("Vérifier", "suppl", {})).toEqual({ kind: "sic", packName: "Français" });
  });

  it("allows reusing a word for the same kind", () => {
    expect(findCollision("fill", "suppl", {})).toBeNull();
    expect(findCollision("verifica", "sic", {})).toBeNull();
  });

  it("checks the rest of the Idiolect", () => {
    expect(findCollision("foo", "sic", { suppl: "foo" })).toEqual({ kind: "suppl", packName: "Idiolect" });
    expect(findCollision("foo", "suppl", { suppl: "foo" })).toBeNull();
  });

  it("finds nothing for a free or empty word", () => {
    expect(findCollision("zzzz", "sic", {})).toBeNull();
    expect(findCollision("", "sic", {})).toBeNull();
  });
});

describe("validateAlias", () => {
  it("returns null for an empty or acceptable alias", () => {
    expect(validateAlias("", "sic", {})).toBeNull();
    expect(validateAlias("  ", "sic", {})).toBeNull();
    expect(validateAlias("zzzz", "sic", {})).toBeNull();
  });

  it("explains a bad format", () => {
    expect(validateAlias("two words", "sic", {})).toMatch(/single word/);
    expect(validateAlias("a:b", "sic", {})).toMatch(/single word/);
  });

  it("explains a collision", () => {
    expect(validateAlias("verifica", "suppl", {})).toBe('"verifica" already means sic in Italiano.');
  });
});

describe("findIdiolectConflicts", () => {
  it("reports words that collide, for instance after an update added a pack", () => {
    const conflicts = findIdiolectConflicts({ suppl: "verifica", sic: "zzzz" });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "suppl", word: "verifica" });
  });

  it("reports nothing for a clean Idiolect", () => {
    expect(findIdiolectConflicts({ suppl: "gap", sic: "doubt" })).toEqual([]);
  });
});

describe("popupKeywords", () => {
  it("lists one pack's words, the default kind first", () => {
    const items = popupKeywords("it", {}, "sic");
    expect(items[0]).toEqual({ kind: "sic", word: "verifica" });
    expect(items.map((i) => i.kind).sort()).toEqual(["cf", "fontes", "glossa", "sic", "suppl"]);
  });

  it("keeps the natural order when there is no default kind", () => {
    expect(popupKeywords("la", {}, null).map((i) => i.word)).toEqual(["suppl", "sic", "fontes", "glossa", "cf"]);
  });

  it("omits the kinds an Idiolect has no word for", () => {
    expect(popupKeywords("idiolect", { suppl: "gap" }, null)).toEqual([{ kind: "suppl", word: "gap" }]);
  });

  it("returns nothing for an unknown pack", () => {
    expect(popupKeywords("klingon", {}, null)).toEqual([]);
  });
});
