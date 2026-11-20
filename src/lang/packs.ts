/**
 * Kinds of lacunae and the built-in language packs.
 *
 * Latin is the canonical form: the history note always stores the Latin kind.
 * A pack is pure data, so adding a language never touches the parser.
 */

export const KINDS = ["suppl", "sic", "fontes", "glossa", "cf"] as const;
export type Kind = (typeof KINDS)[number];

/** One-line description of each kind, shown in the popup and the settings. */
export const KIND_HINTS: Record<Kind, string> = {
  suppl: "supply a missing value",
  sic: "verify the claim before the marker",
  fontes: "find sources",
  glossa: "explain",
  cf: "compare",
};

export interface LangPack {
  id: string;
  /** The language's name in itself (endonym). */
  name: string;
  /** One single-word keyword per kind. TypeScript rejects a pack missing a kind. */
  aliases: Record<Kind, string>;
}

export const LATIN_ID = "la";
/** The user's own pack. Its words live in the settings, not here. */
export const IDIOLECT_ID = "idiolect";
export const IDIOLECT_NAME = "Idiolect";

export const PACKS: readonly LangPack[] = [
  {
    id: LATIN_ID,
    name: "Latina",
    aliases: { suppl: "suppl", sic: "sic", fontes: "fontes", glossa: "glossa", cf: "cf" },
  },
  {
    id: "en",
    name: "English",
    aliases: { suppl: "fill", sic: "check", fontes: "find", glossa: "explain", cf: "compare" },
  },
  {
    id: "fr",
    name: "Français",
    aliases: { suppl: "compléter", sic: "vérifier", fontes: "sources", glossa: "expliquer", cf: "comparer" },
  },
  {
    id: "it",
    name: "Italiano",
    aliases: { suppl: "integra", sic: "verifica", fontes: "fonti", glossa: "spiega", cf: "confronta" },
  },
  {
    id: "es",
    name: "Español",
    aliases: { suppl: "completar", sic: "verificar", fontes: "fuentes", glossa: "explicar", cf: "comparar" },
  },
  {
    id: "de",
    name: "Deutsch",
    aliases: { suppl: "ergänzen", sic: "prüfen", fontes: "quellen", glossa: "erklären", cf: "vergleichen" },
  },
  {
    id: "eo",
    name: "Esperanto",
    aliases: { suppl: "kompletigi", sic: "kontroli", fontes: "fontoj", glossa: "klarigi", cf: "kompari" },
  },
];

/** Every id a settings file may legitimately contain. */
export const ALL_PACK_IDS: readonly string[] = [...PACKS.map((p) => p.id), IDIOLECT_ID];

export function getPack(id: string): LangPack | undefined {
  return PACKS.find((p) => p.id === id);
}

/** Display name for any pack id, the Idiolect included. */
export function packName(id: string): string {
  if (id === IDIOLECT_ID) return IDIOLECT_NAME;
  return getPack(id)?.name ?? id;
}
