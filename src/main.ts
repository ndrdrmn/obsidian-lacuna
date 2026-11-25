import { MarkdownView, Notice, Plugin, TFile, debounce, parseYaml, type Editor } from "obsidian";
import { acceptAnswer } from "./accept";
import { blankOtherMarkers, extractClaim, extractContext, type ContextResult } from "./context";
import { isBlockMarker } from "./apply";
import { KeywordModal, MarkerSuggest } from "./editor/suggest";
import { HistoryStore } from "./history";
import {
  jobKey,
  matchHistory,
  matchHistoryAll,
  rejectedAnswers,
  splitFrontmatter,
  toHistoryData,
  type HistoryData,
  type HistoryEntry,
} from "./history-note";
import { buildInsertion } from "./insert";
import { buildAliasMap, popupKeywords, type AliasEntry, type KeywordItem } from "./lang/keywords";
import { parseMarkers, pickMarker, type Marker, type ParseOptions } from "./marker";
import { isHistoryPath } from "./paths";
import { buildPrompt } from "./prompt";
import { JobQueue, type Job } from "./queue";
import { ClaudeCliResolver } from "./resolvers/claudeCli";
import { ManualResolver, type ManualDraft } from "./resolvers/manual";
import { splitContext } from "./resolvers/manual-answer";
import { CancelledError, type Candidate, type Resolver, type SolveResult, type Verdict } from "./resolvers/resolver";
import { replacementVerdict } from "./review";
import { MarkerIndex } from "./scanner";
import { LacunaSettingTab } from "./settings";
import {
  DEFAULT_SETTINGS,
  defaultKindOrNull,
  normalizeSettings,
  type LacunaSettings,
} from "./settings-model";
import { itemState, type ItemState } from "./status";
import { confirmAction } from "./view/confirm-modal";
import { ReviewModal } from "./view/review-modal";
import { SidebarView, VIEW_TYPE_LACUNA } from "./view/SidebarView";

/** What a job needs: where the marker was seen. It is found again in the current text when the job runs. */
export interface SolvePayload {
  path: string;
  marker: Marker;
  /**
   * Answers that were just rejected, which the metadata cache may not show as rejected yet.
   * The rejected notes found in the vault are added to them.
   */
  rejected?: readonly string[];
}

/** A marker as it is in the note right now, with what a resolver needs to know about it. */
interface Prepared {
  file: TFile;
  /** The note's text as it is now. */
  text: string;
  marker: Marker;
  context: ContextResult;
  claim?: string;
  inline: boolean;
}

export default class LacunaPlugin extends Plugin {
  settings: LacunaSettings = DEFAULT_SETTINGS;
  index!: MarkerIndex;
  history!: HistoryStore;
  /** Result of a job: the path of the pending history note. */
  queue!: JobQueue<SolvePayload, string>;
  private resolver!: Resolver;
  private manual!: ManualResolver;
  /** Markers whose "Answer myself" or review dialog is open, so that a double click does not open two. */
  private readonly manualOpen = new Set<string>();
  private readonly reviewOpen = new Set<string>();
  /** What was typed in a dialog that was closed without saving, until Obsidian restarts. */
  private readonly manualDrafts = new Map<string, ManualDraft>();
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
    this.manual = new ManualResolver(this.app);
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
  solve(path: string, marker: Marker, rejected?: readonly string[]): void {
    this.queue.enqueue(jobKey(path, marker.raw), { path, marker, rejected });
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

  /** Everything a resolver needs to know about a marker, as the note is right now. */
  private async prepare(path: string, marker: Marker): Promise<Prepared> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error("That note no longer exists.");

    // The note may have been edited since the marker was listed: find it again.
    const text = await this.readArticle(file);
    const current = pickMarker(parseMarkers(text, this.parseOptions()), marker.raw, marker.start);
    if (!current) throw new Error("The marker is no longer in the note.");

    return {
      file,
      text,
      marker: current,
      context: extractContext(text, current, this.settings.contextMode),
      claim: current.kind === "sic" ? extractClaim(text, current) : undefined,
      inline: !isBlockMarker(text, current),
    };
  }

  /** What a marker is about, in a few words: the question, or for a bare `sic` the claim. */
  private titleOf(p: Prepared): string {
    return p.marker.question || p.claim || p.marker.kind;
  }

  /** Write the pending history note. `sent` is false when nothing left the machine. */
  private async record(p: Prepared, result: SolveResult, sent: boolean): Promise<{ file: TFile; id: number }> {
    return this.history.create(p.file, {
      kind: p.marker.kind,
      alias: p.marker.alias,
      title: this.titleOf(p),
      question: p.marker.question,
      marker: p.marker.raw,
      asked: new Date(),
      resolver: result.resolver,
      verdict: p.marker.kind === "sic" ? result.verdict : undefined,
      // The passage is kept in every note, so that it shows what the marker was about. A search gets
      // the other lacunae blanked out (see `buildPrompt`), and the note says what the search got.
      context: sent ? blankOtherMarkers(p.context).text : p.context.text,
      contextSent: sent,
      candidates: result.candidates,
    });
  }

  /** One job of the queue: build the prompt, ask Claude, write the pending history note. */
  private async runSolve({ path, marker, rejected }: SolvePayload, signal: AbortSignal): Promise<string> {
    const p = await this.prepare(path, marker);
    if (p.marker.kind !== "sic" && p.marker.question === "") throw new Error("Write the question first.");
    const alreadyRejected = await this.rejectedAnswersFor(path, p.marker, rejected);

    const prompt = buildPrompt({
      kind: p.marker.kind,
      question: p.marker.question,
      noteTitle: p.file.basename,
      context: p.context,
      claim: p.claim,
      inline: p.inline,
      rejected: alreadyRejected,
      maxCandidates: this.settings.maxCandidates,
    });
    const result = await this.resolver.solve(
      { kind: p.marker.kind, prompt, question: p.marker.question, claim: p.claim, inline: p.inline },
      signal,
    );
    if (signal.aborted) throw new Error("Cancelled");
    return (await this.record(p, result, true)).file.path;
  }

  /**
   * "Answer myself": the user types the answer. It does not go through the queue, which
   * runs one job at a time and must not be held up by a dialog; and nothing is sent anywhere.
   * It leaves the same history note as Claude's, and applies the answer at once: there is
   * nothing to review in what you wrote yourself.
   */
  async answerMyself(path: string, marker: Marker): Promise<void> {
    const key = jobKey(path, marker.raw);
    if (this.manualOpen.has(key)) return;
    this.manualOpen.add(key);
    try {
      const p = await this.prepare(path, marker);
      // Nothing is sent anywhere, so the dialog can show more of the note than the search would get.
      const around = extractContext(p.text, p.marker, "paragraphPlusMinusOne");
      const result = await this.manual.solve(
        {
          kind: p.marker.kind,
          prompt: "",
          question: p.marker.question,
          claim: p.claim,
          inline: p.inline,
          context: splitContext(around, p.claim),
          draft: this.manualDrafts.get(key),
          onDraft: (d) => (d ? this.manualDrafts.set(key, d) : this.manualDrafts.delete(key)),
        },
        new AbortController().signal,
      );
      const note = await this.record(p, result, false);
      const what = p.marker.question || p.marker.kind;
      try {
        await this.applyAnswer(p, note, result.candidates[0].answer, result.verdict);
        new Notice(`Lacuna: answer applied for “${what}”.`);
      } catch (e) {
        // The answer is not lost: it waits in the history note.
        const why = e instanceof Error ? e.message : String(e);
        new Notice(`Lacuna: your answer for “${what}” was saved in its history note, but not applied. ${why}`, 10_000);
      }
    } catch (e) {
      if (!(e instanceof CancelledError)) new Notice(`Lacuna: ${e instanceof Error ? e.message : String(e)}`, 10_000);
    } finally {
      this.manualOpen.delete(key);
    }
  }

  /** Put an answer in the article in place of the marker, and mark the history note resolved. Throws when it cannot. */
  private applyAnswer(
    p: Prepared,
    note: { file: TFile; id: number },
    answer: string,
    verdict: Verdict | undefined,
  ): Promise<void> {
    return acceptAnswer(
      { app: this.app, parseOptions: this.parseOptions(), citationStyle: this.settings.citationStyle },
      {
        article: p.file,
        historyNote: note.file,
        noteId: note.id,
        question: this.titleOf(p),
        kind: p.marker.kind,
        markerRaw: p.marker.raw,
        markerStart: p.marker.start,
        answer,
        verdict: replacementVerdict(p.marker.kind, verdict),
      },
    );
  }

  /** A history note read back from its file (not from the metadata cache, which lags behind a new note). */
  private async readHistoryNote(file: TFile): Promise<HistoryData | null> {
    const { yaml, body } = splitFrontmatter(await this.app.vault.read(file));
    let properties: unknown;
    try {
      properties = parseYaml(yaml);
    } catch {
      return null;
    }
    return toHistoryData(properties, body);
  }

  private async rejectNote(file: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm.lacuna = "rejected";
    });
  }

  /** The answers a new search must not repeat: every rejected note of this marker, plus `justRejected`. */
  private async rejectedAnswersFor(
    path: string,
    marker: Marker,
    justRejected: readonly string[] = [],
  ): Promise<string[]> {
    const notes: Candidate[][] = [];
    for (const entry of matchHistoryAll(this.history.list(), path, marker.raw, "rejected")) {
      const file = this.app.vault.getFileByPath(entry.path);
      const data = file ? await this.readHistoryNote(file) : null;
      if (data) notes.push(data.candidates);
    }
    notes.push(justRejected.map((answer) => ({ answer, sources: [] })));
    // The note just rejected is in both lists once the cache has caught up.
    return [...new Set(rejectedAnswers(notes))];
  }

  /**
   * The review of Claude's candidates, in a dialog: accept one (edited or not), reject them all, or
   * search again. Closing the dialog changes nothing.
   */
  async review(path: string, marker: Marker, notePath: string): Promise<void> {
    const key = jobKey(path, marker.raw);
    if (this.reviewOpen.has(key)) return;
    this.reviewOpen.add(key);
    try {
      const file = this.app.vault.getFileByPath(notePath);
      if (!file) throw new Error("That history note no longer exists.");
      const data = await this.readHistoryNote(file);
      if (!data) throw new Error("That is not a history note Lacuna can read.");
      if (data.status !== "pending") throw new Error(`That history note is already ${data.status}.`);
      const p = await this.prepare(path, marker);
      const around = extractContext(p.text, p.marker, "paragraphPlusMinusOne");
      const note = { file, id: data.id };
      const what = p.marker.question || p.marker.kind;

      await new Promise<void>((done) => {
        const modal = new ReviewModal(
          this.app,
          {
            kind: p.marker.kind,
            question: p.marker.question,
            noteId: data.id,
            resolver: data.resolver,
            verdict: data.verdict,
            inline: p.inline,
            context: splitContext(around, p.claim),
            candidates: data.candidates,
            accept: async (answer) => {
              await this.applyAnswer(p, note, answer, data.verdict);
              this.queue.remove(key);
              new Notice(`Lacuna: answer applied for “${what}”.`);
            },
            reject: async () => {
              await this.rejectNote(file);
              // A finished job outranks the note's status in the sidebar: forget it.
              this.queue.remove(key);
              new Notice(`Lacuna: rejected the answers for “${what}”. The marker stays.`);
            },
            searchAgain: async () => {
              await this.rejectNote(file);
              this.queue.remove(key);
              this.solve(
                path,
                p.marker,
                data.candidates.map((c) => c.answer),
              );
            },
          },
          done,
        );
        modal.open();
      });
    } catch (e) {
      new Notice(`Lacuna: ${e instanceof Error ? e.message : String(e)}`, 10_000);
    } finally {
      this.reviewOpen.delete(key);
    }
  }

  /**
   * Discard an orphan: ask, and if the answer is yes move its history note to the trash (where
   * Obsidian's "Deleted files" setting says). Nothing happens if the dialog is closed or says no.
   */
  async discardNote(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      new Notice("That history note no longer exists.");
      return;
    }
    const status = this.history.list().find((e) => e.path === path)?.status;
    const what =
      status === "pending"
        ? "It still holds answers that you have not reviewed, but the marker they were for is not in the article any more."
        : "It records answers that you rejected for a marker that is not in the article any more.";
    const yes = await confirmAction(this.app, {
      title: "Move this history note to the trash?",
      message: `“${file.basename}”. ${what} It goes where Obsidian's “Deleted files” setting sends deleted notes.`,
      confirm: "Move to the trash",
      cancel: "Keep it",
    });
    if (!yes) return;
    await this.app.fileManager.trashFile(file);
    new Notice(`Lacuna: moved “${file.basename}” to the trash.`);
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
