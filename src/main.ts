import { MarkdownView, Notice, Plugin, TFile, debounce, type Editor } from "obsidian";
import { extractClaim, extractContext } from "./context";
import { isBlockMarker } from "./apply";
import { KeywordModal, MarkerSuggest } from "./editor/suggest";
import { HistoryStore } from "./history";
import { jobKey, matchHistory, type HistoryEntry } from "./history-note";
import { buildInsertion } from "./insert";
import { buildAliasMap, popupKeywords, type AliasEntry, type KeywordItem } from "./lang/keywords";
import { parseMarkers, pickMarker, type Marker, type ParseOptions } from "./marker";
import { isHistoryPath } from "./paths";
import { buildPrompt } from "./prompt";
import { JobQueue, type Job } from "./queue";
import { ClaudeCliResolver } from "./resolvers/claudeCli";
import type { Resolver } from "./resolvers/resolver";
import { MarkerIndex } from "./scanner";
import { LacunaSettingTab } from "./settings";
import {
  DEFAULT_SETTINGS,
  defaultKindOrNull,
  normalizeSettings,
  type LacunaSettings,
} from "./settings-model";
import { itemState, type ItemState } from "./status";
import { SidebarView, VIEW_TYPE_LACUNA } from "./view/SidebarView";

/** What a job needs: where the marker was seen. It is found again in the current text when the job runs. */
export interface SolvePayload {
  path: string;
  marker: Marker;
}

export default class LacunaPlugin extends Plugin {
  settings: LacunaSettings = DEFAULT_SETTINGS;
  index!: MarkerIndex;
  history!: HistoryStore;
  /** Result of a job: the path of the pending history note. */
  queue!: JobQueue<SolvePayload, string>;
  private resolver!: Resolver;
  private aliasMap: Map<string, AliasEntry> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.index = new MarkerIndex(this.app, {
      parseOptions: () => this.parseOptions(),
      isExcluded: (path) => isHistoryPath(path, this.settings.historyFolder),
    });
    this.history = new HistoryStore(this.app, () => this.settings);
    this.resolver = new ClaudeCliResolver(() => ({
      executable: this.settings.claudePath,
      model: this.settings.model,
      timeoutSec: this.settings.timeoutSec,
      maxCandidates: this.settings.maxCandidates,
    }));
    this.queue = new JobQueue((payload, signal) => this.runSolve(payload, signal));
    this.queue.onChange((job) => this.announce(job));

    this.addSettingTab(new LacunaSettingTab(this.app, this));
    this.registerEditorSuggest(new MarkerSuggest(this));
    this.registerView(VIEW_TYPE_LACUNA, (leaf) => new SidebarView(leaf, this));
    // Not "search": that is the icon of the core Search pane, and the two get confused.
    this.addRibbonIcon("highlighter", "Open Lacuna", () => void this.activateView());

    // The Slash commands core plugin lists every command by name, so typing /adloc finds this one.
    // No default hotkey: assign one in Settings > Hotkeys to wrap a selection from the keyboard.
    this.addCommand({
      id: "insert-marker",
      name: "Insert marker (adloc)",
      editorCallback: (editor) => this.insertMarker(editor),
    });
    this.addCommand({
      id: "open-sidebar",
      name: "Open sidebar",
      callback: () => void this.activateView(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) =>
          item
            .setTitle("Ask about this…")
            .setIcon("search")
            .onClick(() => this.insertMarker(editor)),
        );
      }),
    );

    this.registerIndexEvents();
  }

  onunload(): void {
    // Do not leave a search running in the background after the plugin is gone.
    this.queue.cancelAll();
  }

  /**
   * Keep the index fresh. Obsidian's metadata cache does not know about highlights, so it
   * is only used to learn *which* note changed; that note is then read and parsed again.
   */
  private registerIndexEvents(): void {
    // While typing, parse the editor's text without waiting for the file to be saved.
    const live = debounce((path: string, text: string) => this.index.setFromText(path, text), 250, true);
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        if (info.file) live(info.file.path, editor.getValue());
      }),
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        // Before the vault scan only the open note matters. This also avoids reading
        // every note while Obsidian is indexing at startup.
        if (this.index.isBuilt() || file.path === this.app.workspace.getActiveFile()?.path) {
          void this.index.updateFile(file);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) this.index.rename(oldPath, file);
      }),
    );
    this.registerEvent(this.app.vault.on("delete", (file) => this.index.remove(file.path)));
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Save, and make everything that depends on the settings (keywords, default kind, folder) catch up. */
  async applySettings(): Promise<void> {
    this.aliasMap = null;
    await this.saveSettings();
    this.index.reset();
  }

  parseOptions(): ParseOptions {
    const s = this.settings;
    this.aliasMap ??= buildAliasMap(s.enabledLangs, s.idiolect);
    return { aliasMap: this.aliasMap, defaultKind: defaultKindOrNull(s) };
  }

  /** The keywords of the popup language, the default kind first. */
  popupItems(): KeywordItem[] {
    const s = this.settings;
    return popupKeywords(s.popupLang, s.idiolect, defaultKindOrNull(s));
  }

  // ---- Solving ------------------------------------------------------------

  /** Queue a search for this marker. Does nothing if one is already queued or running. */
  solve(path: string, marker: Marker): void {
    this.queue.enqueue(jobKey(path, marker.raw), { path, marker });
  }

  cancel(path: string, marker: Marker): void {
    this.queue.cancel(jobKey(path, marker.raw));
  }

  /** What the sidebar shows for a marker. `entries` is `this.history.list()`, read once per render. */
  stateOf(path: string, marker: Marker, entries: readonly HistoryEntry[]): ItemState {
    return itemState(this.queue.get(jobKey(path, marker.raw)), matchHistory(entries, path, marker.raw));
  }

  /** The note's text as it is now, including what has not been saved yet. */
  private async readArticle(file: TFile): Promise<string> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) return leaf.view.getViewData();
    }
    return this.app.vault.read(file);
  }

  /** One job: build the prompt, ask the resolver, write the pending history note. */
  private async runSolve({ path, marker }: SolvePayload, signal: AbortSignal): Promise<string> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error("That note no longer exists.");

    // The note may have been edited since the marker was listed: find it again.
    const text = await this.readArticle(file);
    const current = pickMarker(parseMarkers(text, this.parseOptions()), marker.raw, marker.start);
    if (!current) throw new Error("The marker is no longer in the note.");
    if (current.kind !== "sic" && current.question === "") throw new Error("Write the question first.");

    const context = extractContext(text, current, this.settings.contextMode);
    const claim = current.kind === "sic" ? extractClaim(text, current) : undefined;
    const prompt = buildPrompt({
      kind: current.kind,
      question: current.question,
      noteTitle: file.basename,
      context,
      claim,
      inline: !isBlockMarker(text, current),
      rejected: [],
      maxCandidates: this.settings.maxCandidates,
    });

    const result = await this.resolver.solve({ kind: current.kind, prompt }, signal);
    if (signal.aborted) throw new Error("Cancelled");

    const note = await this.history.create(file, {
      kind: current.kind,
      alias: current.alias,
      title: current.question || claim || current.kind,
      question: current.question,
      marker: current.raw,
      asked: new Date(),
      resolver: result.resolver,
      verdict: current.kind === "sic" ? result.verdict : undefined,
      context: context.text,
      candidates: result.candidates,
    });
    return note.path;
  }

  /** Tell the user when a search ends, even if the sidebar is closed. */
  private announce(job: Job<SolvePayload, string> | undefined): void {
    if (!job) return;
    const what = job.payload.marker.question || job.payload.marker.kind;
    if (job.status === "ready") new Notice(`Lacuna: answers ready for “${what}”.`);
    if (job.status === "failed") new Notice(`Lacuna: ${job.error}`, 10_000);
  }

  async openNote(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      new Notice("That note no longer exists.");
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  // ---- Sidebar and editor -------------------------------------------------

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_LACUNA)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      await right.setViewState({ type: VIEW_TYPE_LACUNA, active: true });
      leaf = right;
    }
    await workspace.revealLeaf(leaf);
  }

  /** Open the note and select the marker. */
  async revealMarker(path: string, marker: Marker): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      new Notice("That note no longer exists.");
      return;
    }
    const open = this.app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view instanceof MarkdownView && l.view.file?.path === path);
    const leaf = open ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    if (view.getMode() === "preview") {
      await view.setState({ ...view.getState(), mode: "source" }, { history: false });
    }

    // The index is kept fresh, but check the text anyway: the note may have just changed.
    // The editor always uses "\n", whatever the file uses.
    const editor = view.editor;
    const raw = marker.raw.replace(/\r\n/g, "\n");
    let from = { line: marker.line, ch: marker.ch };
    let to = { line: marker.endLine, ch: marker.endCh };
    if (editor.getRange(from, to) !== raw) {
      // Moved: take the occurrence closest to where it was.
      const text = editor.getValue();
      let best = -1;
      let bestDistance = Infinity;
      for (let i = text.indexOf(raw); i !== -1; i = text.indexOf(raw, i + 1)) {
        const distance = Math.abs(editor.offsetToPos(i).line - marker.line);
        if (distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      }
      if (best === -1) {
        // Gone: at least land on the line.
        const line = Math.min(marker.line, editor.lastLine());
        from = to = { line, ch: 0 };
        editor.setCursor(from);
        editor.scrollIntoView({ from, to }, true);
        return;
      }
      from = editor.offsetToPos(best);
      to = editor.offsetToPos(best + raw.length);
    }
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  }

  /**
   * Insert `==? ==` at the cursor, or wrap the selection. When the default kind is None
   * a marker without keyword would be ignored, so the kind is asked for first.
   */
  insertMarker(editor: Editor): void {
    // Read the editor now: a modal steals focus and the selection with it.
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const selection = editor.getSelection();

    const insert = (keyword?: string): void => {
      const result = buildInsertion(selection, keyword);
      if ("error" in result) {
        new Notice(result.error);
        return;
      }
      // The text may span lines, so work with offsets rather than adding to `ch`.
      const startOffset = editor.posToOffset(from);
      editor.replaceRange(result.text, from, to);
      editor.setCursor(editor.offsetToPos(startOffset + result.cursor));
      editor.focus();
    };

    if (defaultKindOrNull(this.settings) !== null) {
      insert();
      return;
    }
    const items = this.popupItems();
    if (items.length === 0) {
      new Notice("The popup language has no keyword defined. Choose another one in Lacuna's settings.");
      return;
    }
    new KeywordModal(this.app, items, (item) => insert(item.word)).open();
  }
}
