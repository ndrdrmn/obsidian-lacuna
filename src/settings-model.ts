import { isValidAliasFormat, type Idiolect } from "./lang/keywords";
import { ALL_PACK_IDS, KINDS, LATIN_ID, type Kind } from "./lang/packs";

export type DefaultKind = Kind | "none";

export interface LacunaSettings {
  /** Ids of the packs whose keywords are recognised. Never empty. */
  enabledLangs: string[];
  /** The one language listed in the keyword popup. Always one of `enabledLangs`. */
  popupLang: string;
  /** The user's own words. Only used while the Idiolect pack is enabled. */
  idiolect: Idiolect;
  /** Kind of a marker without a known keyword, or "none" to ignore such markers. */
  defaultKind: DefaultKind;
}

export const DEFAULT_SETTINGS: LacunaSettings = {
  enabledLangs: [LATIN_ID, "en"],
  popupLang: LATIN_ID,
  idiolect: {},
  defaultKind: "suppl",
};

/** Turn whatever `loadData()` returned into valid settings. */
export function normalizeSettings(raw: unknown): LacunaSettings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  let enabled = Array.isArray(r.enabledLangs)
    ? r.enabledLangs.filter((x): x is string => typeof x === "string" && ALL_PACK_IDS.includes(x))
    : [...DEFAULT_SETTINGS.enabledLangs];
  enabled = [...new Set(enabled)];
  if (enabled.length === 0) enabled = [LATIN_ID];

  // Choosing a popup language also enables it.
  let popupLang = typeof r.popupLang === "string" && ALL_PACK_IDS.includes(r.popupLang) ? r.popupLang : enabled[0];
  if (!enabled.includes(popupLang)) enabled.push(popupLang);

  const idiolect: Idiolect = {};
  if (typeof r.idiolect === "object" && r.idiolect !== null) {
    const src = r.idiolect as Record<string, unknown>;
    for (const kind of KINDS) {
      const word = src[kind];
      if (typeof word === "string" && isValidAliasFormat(word.trim())) idiolect[kind] = word.trim();
    }
  }

  const defaultKind: DefaultKind =
    r.defaultKind === "none" || (KINDS as readonly unknown[]).includes(r.defaultKind)
      ? (r.defaultKind as DefaultKind)
      : DEFAULT_SETTINGS.defaultKind;

  return { enabledLangs: enabled, popupLang, idiolect, defaultKind };
}

/** Check or uncheck a language. Unchecking the last one checks Latin again. */
export function toggleLang(s: LacunaSettings, id: string, on: boolean): LacunaSettings {
  let enabled = on ? [...new Set([...s.enabledLangs, id])] : s.enabledLangs.filter((x) => x !== id);
  if (enabled.length === 0) enabled = [LATIN_ID];
  const popupLang = enabled.includes(s.popupLang) ? s.popupLang : enabled[0];
  return { ...s, enabledLangs: enabled, popupLang };
}

/** Choose the popup language. It also becomes a recognised language. */
export function setPopupLang(s: LacunaSettings, id: string): LacunaSettings {
  const enabledLangs = s.enabledLangs.includes(id) ? s.enabledLangs : [...s.enabledLangs, id];
  return { ...s, enabledLangs, popupLang: id };
}

export function defaultKindOrNull(s: LacunaSettings): Kind | null {
  return s.defaultKind === "none" ? null : s.defaultKind;
}
