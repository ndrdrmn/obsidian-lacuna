import type { CitationStyle } from "./apply";
import type { ContextMode } from "./context";
import { isValidAliasFormat, validateAlias, type Idiolect } from "./lang/keywords";
import { ALL_PACK_IDS, KINDS, LATIN_ID, type Kind } from "./lang/packs";
import { cleanFolderName } from "./paths";

export type DefaultKind = Kind | "none";
export type HistoryLocation = "vault" | "article";

export const CONTEXT_MODES: readonly ContextMode[] = ["sentence", "paragraph", "paragraphPlusMinusOne", "note"];
export const HISTORY_LOCATIONS: readonly HistoryLocation[] = ["vault", "article"];
export const CITATION_STYLES: readonly CitationStyle[] = ["footnote", "inline"];

export interface LacunaSettings {
  /** Ids of the packs whose keywords are recognised. Never empty. */
  enabledLangs: string[];
  /** The one language listed in the keyword popup. Always one of `enabledLangs`. */
  popupLang: string;
  /** The user's own words. Only used while the Idiolect pack is enabled. */
  idiolect: Idiolect;
  /** Kind of a marker without a known keyword, or "none" to ignore such markers. */
  defaultKind: DefaultKind;
  /** Folder of the history notes (the apparatus). Notes inside it are never scanned for markers. */
  historyFolder: string;
  /**
   * `vault`: one apparatus folder for the whole vault. `article`: an apparatus folder of that name in the
   * folder of each article that has lacunae, shared by the articles in it.
   */
  historyLocation: HistoryLocation;
  /** How much of the note is sent to the search, besides its title. */
  contextMode: ContextMode;
  /** How an accepted answer points to its history note. */
  citationStyle: CitationStyle;
  /** `claude`, or the full path to `claude.exe`. */
  claudePath: string;
  model: string;
  timeoutSec: number;
  maxCandidates: number;
}

export const DEFAULT_SETTINGS: LacunaSettings = {
  enabledLangs: [LATIN_ID, "en"],
  popupLang: LATIN_ID,
  idiolect: {},
  defaultKind: "suppl",
  historyFolder: "Apparatus",
  historyLocation: "vault",
  contextMode: "paragraph",
  citationStyle: "footnote",
  claudePath: "claude",
  model: "sonnet",
  timeoutSec: 180,
  maxCandidates: 3,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** A model name goes into the command line: letters, digits and `. _ : [ ] -`, not starting with `-`. */
export function isValidModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/.test(model);
}

/** Turn whatever `loadData()` returned into valid settings. */
export function normalizeSettings(raw: unknown): LacunaSettings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  let enabled = Array.isArray(r.enabledLangs)
    ? r.enabledLangs.filter((x): x is string => typeof x === "string" && ALL_PACK_IDS.includes(x))
    : [...DEFAULT_SETTINGS.enabledLangs];
  enabled = [...new Set(enabled)];
  if (enabled.length === 0) enabled = [LATIN_ID];

  // Choosing a popup language also enables it.
  const popupLang = typeof r.popupLang === "string" && ALL_PACK_IDS.includes(r.popupLang) ? r.popupLang : enabled[0];
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

  const folder = typeof r.historyFolder === "string" ? cleanFolderName(r.historyFolder) : "";
  const historyFolder = folder !== "" ? folder : DEFAULT_SETTINGS.historyFolder;

  const historyLocation = (HISTORY_LOCATIONS as readonly unknown[]).includes(r.historyLocation)
    ? (r.historyLocation as HistoryLocation)
    : DEFAULT_SETTINGS.historyLocation;
  const contextMode = (CONTEXT_MODES as readonly unknown[]).includes(r.contextMode)
    ? (r.contextMode as ContextMode)
    : DEFAULT_SETTINGS.contextMode;
  const citationStyle = (CITATION_STYLES as readonly unknown[]).includes(r.citationStyle)
    ? (r.citationStyle as CitationStyle)
    : DEFAULT_SETTINGS.citationStyle;

  const claudePath =
    typeof r.claudePath === "string" && r.claudePath.trim() !== "" && !/[\r\n]/.test(r.claudePath)
      ? r.claudePath.trim()
      : DEFAULT_SETTINGS.claudePath;
  const model =
    typeof r.model === "string" && isValidModel(r.model.trim()) ? r.model.trim() : DEFAULT_SETTINGS.model;

  return {
    enabledLangs: enabled,
    popupLang,
    idiolect,
    defaultKind,
    historyFolder,
    historyLocation,
    contextMode,
    citationStyle,
    claudePath,
    model,
    timeoutSec: clampInt(r.timeoutSec, 10, 900, DEFAULT_SETTINGS.timeoutSec),
    maxCandidates: clampInt(r.maxCandidates, 1, 5, DEFAULT_SETTINGS.maxCandidates),
  };
}

/**
 * The user types a word for `kind` in the Idiolect editor. A word that is acceptable (see
 * `validateAlias`: one word, and not already another kind's in any pack or in the Idiolect) is stored,
 * trimmed; an empty one removes the alias. A refused word changes nothing and says why.
 */
export function setIdiolectWord(
  s: LacunaSettings,
  kind: Kind,
  word: string,
): { settings: LacunaSettings; error: string | null } {
  const error = validateAlias(word, kind, s.idiolect);
  if (error) return { settings: s, error };
  const idiolect: Idiolect = { ...s.idiolect };
  const w = word.trim();
  if (w === "") delete idiolect[kind];
  else idiolect[kind] = w;
  return { settings: { ...s, idiolect }, error: null };
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
