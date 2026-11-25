import { getLinkpath, normalizePath, type App, type TFile } from "obsidian";
import {
  buildHistoryNote,
  historyFileName,
  isHistoryStatus,
  nextHistoryId,
  type HistoryEntry,
  type HistoryNoteInput,
} from "./history-note";
import { isHistoryPath, cleanFolderName } from "./paths";
import type { LacunaSettings } from "./settings-model";

/** Where the number of the last history note is kept, so that no note has to be read to find it. */
export interface HistoryCounter {
  get(): number;
  /** Must remember the number before it returns a promise: two notes made together must not share one. */
  set(n: number): Promise<void>;
}

/** Reads and writes the history notes (the apparatus) in the vault. */
export class HistoryStore {
  constructor(
    private readonly app: App,
    private readonly settings: () => LacunaSettings,
    private readonly counter: HistoryCounter,
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

  /**
   * Write a new pending history note, with the next number. The number is one more than the
   * larger of the stored counter and the numbers in the vault, which the metadata cache
   * already holds: the stored counter alone could fall behind if `data.json` were reset or synced.
   * Never overwrites: a name that is taken (it should not be) gets a suffix.
   */
  async create(
    article: TFile,
    input: Omit<HistoryNoteInput, "articleLink" | "id">,
  ): Promise<{ file: TFile; id: number }> {
    // Before any await, so that two notes made at the same moment get different numbers.
    const id = nextHistoryId(this.counter.get(), this.list());
    const saved = this.counter.set(id);

    const folder = this.folderFor(article);
    await this.ensureFolder(folder);

    const base = historyFileName(id, article.basename, input.title);
    let path = normalizePath(`${folder}/${base}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
      path = normalizePath(`${folder}/${base} ${n}.md`);
    }
    // Obsidian keeps this link up to date if the article is renamed or moved.
    const articleLink = this.app.fileManager.generateMarkdownLink(article, path);
    const file = await this.app.vault.create(path, buildHistoryNote({ ...input, id, articleLink }));
    await saved;
    return { file, id };
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
        id: typeof fm.id === "number" && Number.isInteger(fm.id) ? fm.id : null,
        status: fm.lacuna,
        marker: typeof fm.marker === "string" ? fm.marker : "",
        articlePath: article?.path ?? null,
        asked: typeof fm.asked === "string" ? fm.asked : "",
      });
    }
    return entries;
  }
}
