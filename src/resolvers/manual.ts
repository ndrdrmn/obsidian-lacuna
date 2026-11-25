import { Modal, Platform, type App } from "obsidian";
import { KIND_HINTS } from "../lang/packs";
import { renderContext } from "../view/context-box";
import { MANUAL_RESOLVER, validateManualAnswer, type ContextPiece } from "./manual-answer";
import { CancelledError, type Resolver, type SolveRequest, type SolveResult } from "./resolver";

/** What the user has typed so far. It outlives the dialog, so that a stray click does not lose it. */
export interface ManualDraft {
  answer: string;
  source: string;
  verdict: "confirmed" | "corrected";
}

/** What the dialog needs besides the question. */
export interface ManualRequest extends SolveRequest {
  /** The paragraph of the marker and its neighbours, cut into pieces to draw. */
  context: ContextPiece[];
  draft?: ManualDraft;
  /** Called with the draft as it changes, and with null once it is saved or discarded. */
  onDraft: (draft: ManualDraft | null) => void;
}

const ANSWER_LABEL: Record<SolveRequest["kind"], string> = {
  suppl: "The text that replaces the marker",
  sic: "The correct information",
  fontes: "A short mention of the source",
  glossa: "Your explanation",
  cf: "Your comparison",
};

const SOURCE_PLACEHOLDER = "A link, or free text: a book, an article, “from memory”…";

class ManualModal extends Modal {
  private submitted = false;

  constructor(
    app: App,
    private readonly request: ManualRequest,
    private readonly onSubmit: (result: SolveResult) => void,
    private readonly onCancel: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, request } = this;
    this.modalEl.addClass("lacuna-answer-modal");
    this.setTitle("Answer myself");

    const draft: ManualDraft = request.draft ?? { answer: "", source: "", verdict: "corrected" };
    const remember = (): void => {
      const empty = draft.answer === "" && draft.source === "";
      request.onDraft(empty ? null : { ...draft });
    };

    // What the marker is about.
    const what = contentEl.createDiv({ cls: "lacuna-modal-what" });
    what.createSpan({ cls: "lacuna-kind", text: request.kind, attr: { title: KIND_HINTS[request.kind] } });
    const asked = request.question || (request.kind === "sic" ? "Is the claim right?" : "(no question)");
    what.createSpan({ text: ` ${asked}` });

    // Where it is: the paragraph before, its own, and the one after.
    renderContext(contentEl, request.context);

    // `sic`: is the claim right?
    let answerLabel: HTMLElement | null = null;
    const label = (): string =>
      request.kind === "sic" && draft.verdict === "confirmed" ? "A note (optional)" : ANSWER_LABEL[request.kind];
    if (request.kind === "sic") {
      const row = contentEl.createDiv({ cls: "lacuna-modal-verdict" });
      row.createSpan({ text: "The claim is" });
      const group = row.createDiv({ cls: "lacuna-segmented", attr: { role: "group", "aria-label": "The claim is" } });
      const buttons = new Map<"corrected" | "confirmed", HTMLButtonElement>();
      const show = (): void => {
        for (const [v, b] of buttons) {
          b.toggleClass("is-active", v === draft.verdict);
          b.setAttr("aria-pressed", String(v === draft.verdict));
        }
        answerLabel?.setText(label());
      };
      for (const [v, text] of [
        ["corrected", "Wrong"],
        ["confirmed", "Right"],
      ] as const) {
        const b = group.createEl("button", { text, attr: { type: "button" } });
        b.addEventListener("click", () => {
          draft.verdict = v;
          remember();
          show();
        });
        buttons.set(v, b);
      }
      queueMicrotask(show);
    }

    // The answer.
    const answerField = contentEl.createEl("label", { cls: "lacuna-field" });
    answerLabel = answerField.createSpan({ cls: "lacuna-field-label", text: label() });
    if (request.inline) {
      answerField.createSpan({
        cls: "lacuna-field-hint",
        text: "The marker is inside a line of text: line breaks will be joined.",
      });
    }
    const answer = answerField.createEl("textarea", {
      cls: "lacuna-modal-answer",
      attr: { rows: request.inline ? "3" : "8" },
    });
    answer.value = draft.answer;

    // The source.
    const sourceField = contentEl.createEl("label", { cls: "lacuna-field" });
    sourceField.createSpan({ cls: "lacuna-field-label", text: "Source (optional)" });
    const source = sourceField.createEl("input", {
      type: "text",
      cls: "lacuna-modal-source",
      attr: { placeholder: SOURCE_PLACEHOLDER },
    });
    source.value = draft.source;

    const error = contentEl.createDiv({ cls: "lacuna-error", attr: { role: "alert" } });

    const typed = (): void => {
      draft.answer = answer.value;
      draft.source = source.value;
      error.setText("");
      remember();
    };
    answer.addEventListener("input", typed);
    source.addEventListener("input", typed);

    const save = (): void => {
      const outcome = validateManualAnswer({
        kind: request.kind,
        answer: answer.value,
        verdict: request.kind === "sic" ? draft.verdict : undefined,
        source: source.value,
      });
      if (!outcome.ok) {
        error.setText(outcome.error);
        return;
      }
      this.submitted = true;
      request.onDraft(null);
      this.close();
      this.onSubmit(outcome.result);
    };

    // The footer: the shortcut on the left, the buttons on the right.
    const footer = contentEl.createDiv({ cls: "modal-button-container lacuna-modal-footer" });
    footer.createSpan({ cls: "lacuna-modal-shortcut", text: `${Platform.isMacOS ? "⌘" : "Ctrl"}+Enter to save` });
    footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      request.onDraft(null); // an explicit cancel throws the draft away; a stray click does not
      this.close();
    });
    footer.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", save);

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

/** "Answer myself": no model, no network. The user types the answer, which then goes through the same history note. */
export class ManualResolver implements Resolver {
  readonly id = MANUAL_RESOLVER;
  readonly name = "Answer myself";

  constructor(private readonly app: App) {}

  solve(request: ManualRequest, signal: AbortSignal): Promise<SolveResult> {
    return new Promise((resolve, reject) => {
      const modal = new ManualModal(this.app, request, resolve, () => reject(new CancelledError()));
      signal.addEventListener("abort", () => modal.close(), { once: true });
      modal.open();
    });
  }
}
