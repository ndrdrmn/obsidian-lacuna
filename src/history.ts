import { getLinkpath, normalizePath, type App, type TFile } from "obsidian";
import {
  buildHistoryNote,
  historyFileName,
  historyNumberOfName,
  isHistoryStatus,
  nextHistoryId,
  type HistoryEntry,
  type HistoryNoteInput,
} from "./history-note";
import { KINDS, type Kind } from "./lang/packs";
import { isHistoryPath, cleanFolderName } from "./paths";
import type { LacunaSettings } from "./settings-model";

/** Reads and writes the history notes (the apparatus) in the vault. */
export class HistoryStore {
  /** The last number handed out in this session: a note made a moment ago may not show in the vault yet. */
  private issued = 0;

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

  /**
   * Write a new pending history note, with the next number: one more than the highest in the
   * vault. There is no stored counter, so there is no state apart from the notes themselves: delete
   * them and the numbering starts again. The vault is read twice, because each is blind in a way
   * the other is not: file names are there from the first moment (the metadata cache is filled
   * in gradually while Obsidian starts), and a note may have been renamed or moved, which the
   * `id` property survives.
   * Never overwrites: a name that is taken (it should not be) gets a suffix.
   */
  async create(
    article: TFile,
    input: Omit<HistoryNoteInput, "articleLink" | "id">,
  ): Promise<{ file: TFile; id: number }> {
    const known: (number | null)[] = [this.issued];
    for (const file of this.app.vault.getMarkdownFiles()) known.push(historyNumberOfName(file.basename));
    for (const entry of this.list()) known.push(entry.id);
    const id = nextHistoryId(known);
    // Before any await, so that two notes made at the same moment get different numbers.
    this.issued = id;

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
        kind: typeof fm.kind === "string" && (KINDS as readonly string[]).includes(fm.kind) ? (fm.kind as Kind) : undefined,
        question: typeof fm.question === "string" ? fm.question : undefined,
      });
    }
    return entries;
  }
}
