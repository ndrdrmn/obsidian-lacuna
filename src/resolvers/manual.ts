import { Modal, Setting, type App } from "obsidian";
import { KIND_HINTS } from "../lang/packs";
import { MANUAL_RESOLVER, validateManualAnswer } from "./manual-answer";
import { CancelledError, type Resolver, type SolveRequest, type SolveResult } from "./resolver";

const ANSWER_LABEL: Record<SolveRequest["kind"], string> = {
  suppl: "The text that replaces the marker",
  sic: "The correct information (leave empty if the claim is right)",
  fontes: "A short mention of the source",
  glossa: "Your explanation",
  cf: "Your comparison",
};

class ManualModal extends Modal {
  private submitted = false;

  constructor(
    app: App,
    private readonly request: SolveRequest,
    private readonly onSubmit: (result: SolveResult) => void,
    private readonly onCancel: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, request } = this;
    this.setTitle("Answer myself");

    contentEl.createDiv({ cls: "lacuna-modal-what" }).append(
      createSpan({ cls: "lacuna-kind", text: request.kind, attr: { title: KIND_HINTS[request.kind] } }),
      createSpan({ text: ` ${request.question || "(no question)"}` }),
    );
    if (request.claim) {
      contentEl.createDiv({ cls: "lacuna-modal-claim", text: `The claim: “${request.claim}”` });
    }

    let verdict: "confirmed" | "corrected" = "corrected";
    if (request.kind === "sic") {
      new Setting(contentEl).setName("The claim is").addDropdown((dd) => {
        dd.addOption("corrected", "wrong or inaccurate");
        dd.addOption("confirmed", "right");
        dd.setValue(verdict).onChange((v) => (verdict = v as typeof verdict));
      });
    }

    const answer = contentEl.createEl("textarea", {
      cls: "lacuna-modal-answer",
      attr: {
        rows: request.inline ? "2" : "6",
        "aria-label": ANSWER_LABEL[request.kind],
        placeholder: ANSWER_LABEL[request.kind],
      },
    });
    const source = contentEl.createEl("input", {
      type: "text",
      cls: "lacuna-modal-source",
      attr: { placeholder: "Source link (optional)", "aria-label": "Source link (optional)" },
    });
    const error = contentEl.createDiv({ cls: "lacuna-error" });

    const save = (): void => {
      const outcome = validateManualAnswer({
        kind: request.kind,
        answer: answer.value,
        verdict: request.kind === "sic" ? verdict : undefined,
        sourceUrl: source.value,
      });
      if (!outcome.ok) {
        error.setText(outcome.error);
        return;
      }
      this.submitted = true;
      this.close();
      this.onSubmit(outcome.result);
    };

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Save").setCta().onClick(save))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
    // Ctrl+Enter saves, whichever field has the focus.
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    });
    answer.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.onCancel();
  }
}

/** "Answer myself": no model, no network. The user types the answer, which then goes through the same pending note. */
export class ManualResolver implements Resolver {
  readonly id = MANUAL_RESOLVER;
  readonly name = "Answer myself";

  constructor(private readonly app: App) {}

  solve(request: SolveRequest, signal: AbortSignal): Promise<SolveResult> {
    return new Promise((resolve, reject) => {
      const modal = new ManualModal(this.app, request, resolve, () => reject(new CancelledError()));
      signal.addEventListener("abort", () => modal.close(), { once: true });
      modal.open();
    });
  }
}
