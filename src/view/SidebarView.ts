import { ItemView, debounce, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { KIND_HINTS } from "../lang/packs";
import type { Marker } from "../marker";
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

    if (this.listScope === "vault") {
      if (!index.isBuilt()) {
        await index.build();
        if (id !== this.renderId) return;
      }
      groups = index.all();
      if (groups.length === 0) message = "No lacuna in the vault.";
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
    bar.createSpan({ cls: "lacuna-count", text: count === 1 ? "1 lacuna" : `${count} lacunae` });

    if (message !== null) {
      contentEl.createDiv({ cls: "lacuna-message", text: message });
      return;
    }
    // One look at the history notes for the whole list, not one per marker.
    const history = this.plugin.history.list();
    for (const [path, markers] of groups) {
      if (this.listScope === "vault") {
        const heading = contentEl.createDiv({ cls: "lacuna-note", attr: { title: path } });
        heading.createSpan({ text: path.replace(/\.md$/, "").split("/").pop() ?? path });
        heading.createSpan({ cls: "lacuna-count", text: String(markers.length) });
      }
      for (const marker of markers) this.renderItem(contentEl, path, marker, this.plugin.stateOf(path, marker, history));
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

    switch (state.state) {
      case "idle":
        button("Solve", solve, {
          cta: true,
          disabled: needsQuestion,
          title: needsQuestion ? "Write the question first" : "Search for an answer",
        });
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
        actions.createDiv({ cls: "lacuna-error", text: state.error });
        break;
      case "ready":
        status("answers ready", "lacuna-status-ready");
        button("Open note", () => void this.plugin.openNote(state.notePath), { cta: true });
        break;
      case "rejected":
        status("rejected", "lacuna-status-rejected");
        button("Open note", () => void this.plugin.openNote(state.notePath));
        button("Solve again", solve, { disabled: needsQuestion });
        break;
    }
  }
}
