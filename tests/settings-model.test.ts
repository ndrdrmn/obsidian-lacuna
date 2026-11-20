import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  defaultKindOrNull,
  normalizeSettings,
  setPopupLang,
  toggleLang,
  type LacunaSettings,
} from "../src/settings-model";

const base = (over: Partial<LacunaSettings> = {}): LacunaSettings => ({ ...DEFAULT_SETTINGS, ...over });

describe("normalizeSettings", () => {
  it("gives the defaults for nothing, and for garbage", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const s = normalizeSettings({
      enabledLangs: ["it", "idiolect"],
      popupLang: "it",
      idiolect: { suppl: "gap" },
      defaultKind: "none",
      historyFolder: "Notes/Apparatus",
    });
    expect(s).toEqual({
      enabledLangs: ["it", "idiolect"],
      popupLang: "it",
      idiolect: { suppl: "gap" },
      defaultKind: "none",
      historyFolder: "Notes/Apparatus",
    });
  });

  it("drops unknown languages and duplicates", () => {
    expect(normalizeSettings({ enabledLangs: ["en", "klingon", "en", 3] }).enabledLangs).toEqual(["en"]);
  });

  it("falls back to Latin when no language is left", () => {
    const s = normalizeSettings({ enabledLangs: [] });
    expect(s.enabledLangs).toEqual(["la"]);
    expect(s.popupLang).toBe("la");
  });

  it("enables the popup language", () => {
    const s = normalizeSettings({ enabledLangs: ["en"], popupLang: "fr" });
    expect(s.enabledLangs).toEqual(["en", "fr"]);
    expect(s.popupLang).toBe("fr");
  });

  it("falls back to an enabled language for an unknown popup language", () => {
    expect(normalizeSettings({ enabledLangs: ["de"], popupLang: "klingon" }).popupLang).toBe("de");
  });

  it("rejects an unknown default kind", () => {
    expect(normalizeSettings({ defaultKind: "explain" }).defaultKind).toBe("suppl");
    expect(normalizeSettings({ defaultKind: "cf" }).defaultKind).toBe("cf");
  });

  it("cleans the history folder and falls back to Apparatus", () => {
    expect(normalizeSettings({ historyFolder: " Research/Apparatus/ " }).historyFolder).toBe("Research/Apparatus");
    expect(normalizeSettings({ historyFolder: "" }).historyFolder).toBe("Apparatus");
    expect(normalizeSettings({ historyFolder: "../x" }).historyFolder).toBe("Apparatus");
    expect(normalizeSettings({ historyFolder: 3 }).historyFolder).toBe("Apparatus");
  });

  it("keeps only well-formed Idiolect words, trimmed", () => {
    const s = normalizeSettings({ idiolect: { suppl: " gap ", sic: "two words", fontes: 3, bogus: "x" } });
    expect(s.idiolect).toEqual({ suppl: "gap" });
  });
});

describe("toggleLang", () => {
  it("checks and unchecks a language", () => {
    const on = toggleLang(base(), "it", true);
    expect(on.enabledLangs).toEqual(["la", "en", "it"]);
    expect(toggleLang(on, "en", false).enabledLangs).toEqual(["la", "it"]);
  });

  it("checks Latin again when the last language is unchecked", () => {
    const s = toggleLang(base({ enabledLangs: ["it"], popupLang: "it" }), "it", false);
    expect(s.enabledLangs).toEqual(["la"]);
    expect(s.popupLang).toBe("la");
  });

  it("moves the popup language when it is unchecked", () => {
    const s = toggleLang(base({ enabledLangs: ["la", "it"], popupLang: "it" }), "it", false);
    expect(s.popupLang).toBe("la");
  });

  it("does not change the popup language otherwise, and does not mutate", () => {
    const before = base();
    const s = toggleLang(before, "fr", true);
    expect(s.popupLang).toBe("la");
    expect(before.enabledLangs).toEqual(["la", "en"]);
  });
});

describe("setPopupLang", () => {
  it("also enables the language", () => {
    const s = setPopupLang(base(), "eo");
    expect(s.popupLang).toBe("eo");
    expect(s.enabledLangs).toContain("eo");
  });

  it("does not duplicate an already enabled language", () => {
    expect(setPopupLang(base(), "en").enabledLangs).toEqual(["la", "en"]);
  });
});

describe("defaultKindOrNull", () => {
  it("maps none to null", () => {
    expect(defaultKindOrNull(base({ defaultKind: "none" }))).toBeNull();
    expect(defaultKindOrNull(base({ defaultKind: "sic" }))).toBe("sic");
  });
});
