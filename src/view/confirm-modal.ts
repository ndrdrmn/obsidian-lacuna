import { Modal, type App } from "obsidian";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** The button that goes ahead, and the one that does not. */
  confirm: string;
  cancel: string;
}

class ConfirmModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private readonly options: ConfirmOptions,
    private readonly resolve: (yes: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, options } = this;
    this.setTitle(options.title);
    contentEl.createEl("p", { text: options.message });

    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const decide = (yes: boolean): void => {
      this.decided = true;
      this.resolve(yes);
      this.close();
    };
    // The safe answer comes first and has the focus: Enter keeps things as they are.
    const cancel = footer.createEl("button", { text: options.cancel });
    cancel.addEventListener("click", () => decide(false));
    footer.createEl("button", { text: options.confirm, cls: "mod-warning" }).addEventListener("click", () => decide(true));
    cancel.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    // Closed with Esc or a click outside: no.
    if (!this.decided) this.resolve(false);
  }
}

/** Ask a yes or no question in a dialog. Closing the dialog any other way than the confirm button is a no. */
export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, options, resolve).open());
}
