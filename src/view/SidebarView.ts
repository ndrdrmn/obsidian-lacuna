import { ItemView, debounce, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { KIND_HINTS } from "../lang/packs";
import type { Marker } from "../marker";
import type LacunaPlugin from "../main";

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
    for (const [path, markers] of groups) {
      if (this.listScope === "vault") {
        const heading = contentEl.createDiv({ cls: "lacuna-note", attr: { title: path } });
        heading.createSpan({ text: path.replace(/\.md$/, "").split("/").pop() ?? path });
        heading.createSpan({ cls: "lacuna-count", text: String(markers.length) });
      }
      for (const marker of markers) this.renderItem(contentEl, path, marker);
    }
  }

  private renderItem(parent: HTMLElement, path: string, marker: Marker): void {
    const row = parent.createDiv({ cls: "lacuna-item", attr: { role: "button", tabindex: "0" } });
    row.createSpan({ cls: "lacuna-kind", text: marker.kind, attr: { title: KIND_HINTS[marker.kind] } });
    row.createSpan({
      cls: marker.question === "" ? "lacuna-question lacuna-empty" : "lacuna-question",
      text: marker.question === "" ? "(no question yet)" : marker.question,
    });
    const open = (): void => void this.plugin.revealMarker(path, marker);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  }
}
