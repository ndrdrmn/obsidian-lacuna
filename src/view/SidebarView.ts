import { ItemView, debounce, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { HistoryEntry } from "../history-note";
import { KIND_HINTS } from "../lang/packs";
import type { Marker } from "../marker";
import { findOrphans } from "../orphans";
import type LacunaPlugin from "../main";
import type { ItemState } from "../status";

export const VIEW_TYPE_LACUNA = "lacuna-sidebar";

type ListScope = "note" | "vault";

/** The list of lacunae: this note, or the whole vault grouped by note. */
export class SidebarView extends ItemView {
  /** Not called `scope`: ItemView already has a `scope` (its key bindings). */
  private listScope: ListScope = "note";
  /** Only the latest render may touch the DOM. */
  private renderId = 0;
  private readonly requestRender = debounce(() => void this.render(), 100, true);

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LacunaPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_LACUNA;
  }

  getDisplayText(): string {
    return "Lacuna";
  }

  getIcon(): string {
    // Not "search": that is the icon of the core Search pane, and the two get confused.
    return "highlighter";
  }

  getState(): Record<string, unknown> {
    return { scope: this.listScope };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const scope = (state as { scope?: unknown } | null)?.scope;
    if (scope === "note" || scope === "vault") this.listScope = scope;
    await super.setState(state, result);
    void this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("lacuna-view");
    this.register(this.plugin.index.onChange(() => this.requestRender()));
    this.register(this.plugin.queue.onChange(() => this.requestRender()));
    // A history note that has just been written shows up in the metadata cache a moment later.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.requestRender()));
    await this.render();
  }

  private setScope(scope: ListScope): void {
    if (scope === this.listScope) return;
    this.listScope = scope;
    // Persist it with the workspace layout.
    this.app.workspace.requestSaveLayout();
    void this.render();
  }

  private async render(): Promise<void> {
    const id = ++this.renderId;
    const { contentEl } = this;
    const index = this.plugin.index;

    // Gather first, draw after: the DOM is only touched once the data is there.
    let groups: [string, readonly Marker[]][] = [];
    let message: string | null = null;
    let history: HistoryEntry[] = [];
    let orphans: HistoryEntry[] = [];

    if (this.listScope === "vault") {
      if (!index.isBuilt()) {
        await index.build();
        if (id !== this.renderId) return;
      }
      groups = index.all();
      if (groups.length === 0) message = "No lacuna in the vault.";
      // One look at the history notes for the whole list, not one per marker.
      history = this.plugin.history.list();
      orphans = findOrphans(history, (path) => index.get(path));
    } else {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") {
        message = "Open a note to see its lacunae.";
      } else {
        await index.ensure(file);
        if (id !== this.renderId) return;
        const markers = index.get(file.path);
        if (markers.length > 0) groups = [[file.path, markers]];
        else message = "No lacuna in this note. Run /adloc to add one.";
        history = this.plugin.history.list();
        orphans = findOrphans(history, (path) => (index.has(path) ? index.get(path) : undefined), file.path);
      }
    }
    if (id !== this.renderId) return;

    contentEl.empty();
    const bar = contentEl.createDiv({ cls: "lacuna-toolbar" });
    for (const [scope, label] of [
      ["note", "This note"],
      ["vault", "Whole vault"],
    ] as const) {
      const button = bar.createEl("button", { text: label, cls: this.listScope === scope ? "mod-cta" : undefined });
      button.addEventListener("click", () => this.setScope(scope));
    }
    const count = groups.reduce((n, [, ms]) => n + ms.length, 0);
    const orphanCount = orphans.length === 0 ? "" : orphans.length === 1 ? " · 1 orphan" : ` · ${orphans.length} orphans`;
    bar.createSpan({ cls: "lacuna-count", text: (count === 1 ? "1 lacuna" : `${count} lacunae`) + orphanCount });

    if (message !== null) contentEl.createDiv({ cls: "lacuna-message", text: message });
    for (const [path, markers] of message === null ? groups : []) {
      if (this.listScope === "vault") {
        const heading = contentEl.createDiv({ cls: "lacuna-note", attr: { title: path } });
        heading.createSpan({ text: path.replace(/\.md$/, "").split("/").pop() ?? path });
        heading.createSpan({ cls: "lacuna-count", text: String(markers.length) });
      }
      for (const marker of markers) this.renderItem(contentEl, path, marker, this.plugin.stateOf(path, marker, history));
    }
    if (orphans.length > 0) this.renderOrphans(contentEl, orphans);
  }

  /** The history notes whose marker is not in the article any more, with what can be done about them. */
  private renderOrphans(parent: HTMLElement, orphans: readonly HistoryEntry[]): void {
    const heading = parent.createDiv({
      cls: "lacuna-note",
      attr: { title: "History notes that are still waiting or were rejected, whose marker is not in the article any more" },
    });
    heading.createSpan({ text: "Orphans" });
    heading.createSpan({ cls: "lacuna-count", text: String(orphans.length) });

    for (const entry of orphans) {
      const item = parent.createDiv({ cls: "lacuna-item lacuna-orphan" });
      const line = item.createDiv({ cls: "lacuna-line" });
      if (entry.kind) line.createSpan({ cls: "lacuna-kind", text: entry.kind, attr: { title: KIND_HINTS[entry.kind] } });
      const asked = entry.question && entry.question !== "" ? entry.question : "(no question)";
      line.createSpan({ cls: "lacuna-question", text: asked });

      // Which article, in the vault list: there the orphans are not under their article's heading.
      const article = entry.articlePath
        ? (entry.articlePath.replace(/\.md$/, "").split("/").pop() ?? entry.articlePath)
        : "article not found";
      const why = entry.status === "pending" ? "answers not reviewed" : "rejected";
      const meta = item.createDiv({ cls: "lacuna-meta" });
      meta.createSpan({ text: `${entry.id !== null ? `Lacuna #${entry.id} · ` : ""}${why} · marker not in the note` });
      if (this.listScope === "vault") meta.createSpan({ text: ` · ${article}`, attr: { title: entry.articlePath ?? "" } });

      const actions = item.createDiv({ cls: "lacuna-actions" });
      actions.createEl("button", { text: "Open note" }).addEventListener("click", () => void this.plugin.openNote(entry.path));
      const discard = actions.createEl("button", { text: "Discard…", attr: { title: "Move this history note to the trash, after asking" } });
      discard.addEventListener("click", () => void this.plugin.discardNote(entry.path));
    }
  }

  private renderItem(parent: HTMLElement, path: string, marker: Marker, state: ItemState): void {
    const item = parent.createDiv({ cls: "lacuna-item" });

    // The line with the question jumps to the marker.
    const line = item.createDiv({ cls: "lacuna-line", attr: { role: "button", tabindex: "0" } });
    line.createSpan({ cls: "lacuna-kind", text: marker.kind, attr: { title: KIND_HINTS[marker.kind] } });
    line.createSpan({
      cls: marker.question === "" ? "lacuna-question lacuna-empty" : "lacuna-question",
      text: marker.question === "" ? "(no question yet)" : marker.question,
    });
    const jump = (): void => void this.plugin.revealMarker(path, marker);
    line.addEventListener("click", jump);
    line.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jump();
      }
    });

    // Below it, what is going on and what can be done.
    const actions = item.createDiv({ cls: "lacuna-actions" });
    const status = (text: string, cls: string, title?: string): void => {
      actions.createSpan({ cls: `lacuna-status ${cls}`, text, attr: title ? { title } : {} });
    };
    const button = (text: string, onClick: () => void, opts: { cta?: boolean; title?: string; disabled?: boolean } = {}): void => {
      const b = actions.createEl("button", { text, cls: opts.cta ? "mod-cta" : undefined, attr: opts.title ? { title: opts.title } : {} });
      b.disabled = opts.disabled ?? false;
      b.addEventListener("click", onClick);
    };
    // Every kind but `sic` needs a question; `sic` checks the claim before the marker.
    const needsQuestion = marker.kind !== "sic" && marker.question === "";
    const solve = (): void => this.plugin.solve(path, marker);
    const answerMyself = (): void => void this.plugin.answerMyself(path, marker);
    const answerButton = (): void =>
      button("Answer myself", answerMyself, { title: "Type the answer yourself: nothing is searched or sent" });

    switch (state.state) {
      case "idle":
        button("Solve", solve, {
          cta: true,
          disabled: needsQuestion,
          title: needsQuestion ? "Write the question first" : "Search for an answer",
        });
        answerButton();
        break;
      case "queued":
        status("queued", "lacuna-status-wait");
        button("Cancel", () => this.plugin.cancel(path, marker));
        break;
      case "searching":
        status("searching…", "lacuna-status-wait");
        button("Cancel", () => this.plugin.cancel(path, marker));
        break;
      case "failed":
        status("failed", "lacuna-status-failed", state.error);
        button("Retry", solve);
        answerButton();
        actions.createDiv({ cls: "lacuna-error", text: state.error });
        break;
      case "ready":
        status("answers ready", "lacuna-status-ready");
        button("Review", () => void this.plugin.review(path, marker, state.notePath), {
          cta: true,
          title: "Read the answers, accept one, edit it, or reject them",
        });
        button("Open note", () => void this.plugin.openNote(state.notePath));
        break;
      case "rejected":
        status("rejected", "lacuna-status-rejected");
        button("Open note", () => void this.plugin.openNote(state.notePath));
        button("Solve again", solve, {
          disabled: needsQuestion,
          title: "Search again, asking Claude not to repeat the rejected answers",
        });
        answerButton();
        break;
    }
  }
}
