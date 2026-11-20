import { getLinkpath, normalizePath, type App, type TFile } from "obsidian";
import {
  buildHistoryNote,
  historyFileName,
  isHistoryStatus,
  type HistoryEntry,
  type HistoryNoteInput,
} from "./history-note";
import { isHistoryPath, cleanFolderName } from "./paths";
import type { LacunaSettings } from "./settings-model";

/** Reads and writes the history notes (the apparatus) in the vault. */
export class HistoryStore {
  constructor(
    private readonly app: App,
    private readonly settings: () => LacunaSettings,
  ) {}

  /** Where the history notes of this article go. */
  folderFor(article: TFile): string {
    const s = this.settings();
    const name = cleanFolderName(s.historyFolder);
    if (s.historyLocation === "article") {
      const parent = article.parent?.path ?? "";
      return normalizePath(parent === "" || parent === "/" ? name : `${parent}/${name}`);
    }
    return normalizePath(name);
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {
      current = current === "" ? part : `${current}/${part}`;
      if (!this.app.vault.getFolderByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  /** Write a new pending history note. Never overwrites: a name that is taken gets a number. */
  async create(article: TFile, input: Omit<HistoryNoteInput, "articleLink">): Promise<TFile> {
    const folder = this.folderFor(article);
    await this.ensureFolder(folder);

    const base = historyFileName(input.asked, article.basename, input.title);
    let path = normalizePath(`${folder}/${base}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
      path = normalizePath(`${folder}/${base} ${n}.md`);
    }
    // Obsidian keeps this link up to date if the article is renamed or moved.
    const articleLink = this.app.fileManager.generateMarkdownLink(article, path);
    return this.app.vault.create(path, buildHistoryNote({ ...input, articleLink }));
  }

  /**
   * Every history note in the vault, from the metadata cache: no file is read.
   * A note is recognised by its `lacuna` property.
   */
  list(): HistoryEntry[] {
    const { vault, metadataCache } = this.app;
    const folder = this.settings().historyFolder;
    const entries: HistoryEntry[] = [];
    for (const file of vault.getMarkdownFiles()) {
      if (!isHistoryPath(file.path, folder)) continue;
      const cache = metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      if (!fm || !isHistoryStatus(fm.lacuna)) continue;

      const link = cache?.frontmatterLinks?.find((l) => l.key === "article");
      const article = link ? metadataCache.getFirstLinkpathDest(getLinkpath(link.link), file.path) : null;
      entries.push({
        path: file.path,
        status: fm.lacuna,
        marker: typeof fm.marker === "string" ? fm.marker : "",
        articlePath: article?.path ?? null,
        asked: typeof fm.asked === "string" ? fm.asked : "",
      });
    }
    return entries;
  }
}
