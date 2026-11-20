/** Trim, use forward slashes, drop surrounding slashes. Empty if nothing usable is left. */
export function cleanFolderName(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  // A folder name that climbs out of its place is not a folder name.
  if (/(^|\/)\.\.?(\/|$)/.test(cleaned)) return "";
  return cleaned;
}

/**
 * Is `path` inside a history folder? History notes quote their marker, so they must
 * never be scanned. The folder may sit anywhere: with the "next to the article" location
 * there is one per directory, so any directory of the path may match. Case-insensitive.
 */
export function isHistoryPath(path: string, folder: string): boolean {
  const wanted = cleanFolderName(folder).toLowerCase().split("/").filter(Boolean);
  if (wanted.length === 0) return false;
  const dirs = path.toLowerCase().split("/").slice(0, -1);
  for (let i = 0; i + wanted.length <= dirs.length; i++) {
    if (wanted.every((name, j) => dirs[i + j] === name)) return true;
  }
  return false;
}
