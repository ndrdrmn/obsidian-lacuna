import {
  getPack,
  IDIOLECT_ID,
  IDIOLECT_NAME,
  KINDS,
  PACKS,
  type Kind,
} from "./packs";

/** The user's own words: one optional alias per kind. */
export type Idiolect = Partial<Record<Kind, string>>;

export interface AliasEntry {
  kind: Kind;
  packId: string;
}

export interface KeywordItem {
  kind: Kind;
  word: string;
}

export interface Collision {
  /** The kind the word already means. */
  kind: Kind;
  /** The pack that gives it that meaning. */
  packName: string;
}

/** Lowercase, accents stripped: `Vérifier` and `verifier` are the same keyword. */
export function normalize(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** A keyword is one word: no spaces, and none of `:` `=` `?`, which the grammar uses. */
export function isValidAliasFormat(word: string): boolean {
  return /^[^\s:=?]+$/.test(word);
}

function addAlias(map: Map<string, AliasEntry>, word: string | undefined, entry: AliasEntry): void {
  if (!word || !isValidAliasFormat(word)) return;
  const key = normalize(word);
  // First one wins. Built-in packs go first, so they always beat the Idiolect.
  if (!map.has(key)) map.set(key, entry);
}

/**
 * Normalised alias → kind, built from the enabled packs.
 * The parser only ever does a Map lookup, so the number of languages costs nothing.
 */
export function buildAliasMap(enabledIds: readonly string[], idiolect: Idiolect): Map<string, AliasEntry> {
  const map = new Map<string, AliasEntry>();
  for (const id of enabledIds) {
    if (id === IDIOLECT_ID) continue;
    const pack = getPack(id);
    if (!pack) continue;
    for (const kind of KINDS) addAlias(map, pack.aliases[kind], { kind, packId: pack.id });
  }
  if (enabledIds.includes(IDIOLECT_ID)) {
    for (const kind of KINDS) addAlias(map, idiolect[kind], { kind, packId: IDIOLECT_ID });
  }
  return map;
}

/**
 * Does `word`, proposed as the alias of `kind`, already mean something else?
 * Reusing a word for the same kind is not a collision.
 * Checks every built-in pack (enabled or not) and the rest of the Idiolect.
 */
export function findCollision(word: string, kind: Kind, idiolect: Idiolect): Collision | null {
  const key = normalize(word);
  if (key === "") return null;
  for (const pack of PACKS) {
    for (const k of KINDS) {
      if (k !== kind && normalize(pack.aliases[k]) === key) return { kind: k, packName: pack.name };
    }
  }
  for (const k of KINDS) {
    if (k === kind) continue;
    const other = idiolect[k];
    if (other && normalize(other) === key) return { kind: k, packName: IDIOLECT_NAME };
  }
  return null;
}

/** Error message for an Idiolect alias being typed, or null when it is acceptable. Empty = no alias. */
export function validateAlias(word: string, kind: Kind, idiolect: Idiolect): string | null {
  const w = word.trim();
  if (w === "") return null;
  if (!isValidAliasFormat(w)) {
    return "A keyword must be a single word, without spaces and without ':', '=' or '?'.";
  }
  const c = findCollision(w, kind, idiolect);
  return c ? `"${w}" already means ${c.kind} in ${c.packName}.` : null;
}

/**
 * Re-check a stored Idiolect, for instance after a plugin update added a built-in
 * pack containing one of its words. About 40 comparisons.
 */
export function findIdiolectConflicts(idiolect: Idiolect): { kind: Kind; word: string; collision: Collision }[] {
  const out: { kind: Kind; word: string; collision: Collision }[] = [];
  for (const kind of KINDS) {
    const word = idiolect[kind];
    if (!word) continue;
    const collision = findCollision(word, kind, idiolect);
    if (collision) out.push({ kind, word, collision });
  }
  return out;
}

/**
 * Keywords offered by the popup: those of one pack, the default kind first.
 * A pack that has no word for a kind (an incomplete Idiolect) simply omits it.
 */
export function popupKeywords(packId: string, idiolect: Idiolect, defaultKind: Kind | null): KeywordItem[] {
  const words: Partial<Record<Kind, string>> = packId === IDIOLECT_ID ? idiolect : getPack(packId)?.aliases ?? {};
  const items: KeywordItem[] = [];
  for (const kind of KINDS) {
    const word = words[kind];
    if (word && isValidAliasFormat(word)) items.push({ kind, word });
  }
  if (defaultKind) {
    items.sort((a, b) => Number(b.kind === defaultKind) - Number(a.kind === defaultKind));
  }
  return items;
}
