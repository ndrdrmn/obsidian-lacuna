import { Modal, type App } from "obsidian";
import { KIND_HINTS, type Kind } from "../lang/packs";
import type { ContextPiece } from "../resolvers/manual-answer";
import type { Candidate, Source, Verdict } from "../resolvers/resolver";
import { reviewMode } from "../review";
import { renderContext } from "./context-box";

/** What the dialog needs. The three actions throw an error with a message fit to show when they cannot be done. */
export interface ReviewRequest {
  kind: Kind;
  question: string;
  /** The number of the history note, and who wrote its candidates. */
  noteId: number;
  resolver: string;
  verdict?: Verdict;
  /** True when the marker is inside a line of text, so that line breaks in an answer are joined. */
  inline: boolean;
  /** The paragraph of the marker and its neighbours, cut into pieces to draw. */
  context: ContextPiece[];
  candidates: Candidate[];
  /** Put this answer in the article. */
  accept(answer: string): Promise<void>;
  /** None of these: the marker stays and the note is marked rejected. */
  reject(): Promise<void>;
  /** Reject, then search again without repeating these answers. */
  searchAgain(): Promise<void>;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  confirmed: "Claude says the claim is right.",
  corrected: "Claude says the claim is wrong.",
  uncertain: "Claude could not tell whether the claim holds.",
};

function sourceItem(list: HTMLElement, s: Source): void {
  const li = list.createEl("li");
  if (s.url && /^https?:\/\//i.test(s.url)) {
    li.createEl("a", { text: s.title || s.url, cls: "external-link", href: s.url, attr: { target: "_blank", rel: "noopener" } });
  } else {
    li.createSpan({ text: s.title });
  }
  if (s.quote) li.createSpan({ cls: "lacuna-source-quote", text: ` — “${s.quote}”` });
}

/** "Review answers": read Claude's candidates in place, edit one, accept it, reject them all or search again. */
export class ReviewModal extends Modal {
  private error!: HTMLElement;

  /** `onClosed` is called once the dialog is gone, whichever way it was closed. */
  constructor(
    app: App,
    private readonly req: ReviewRequest,
    private readonly onClosed: () => void = () => undefined,
  ) {
    super(app);
  }

  /** Run an action with the buttons off. On success the dialog closes; on failure it stays, with the reason. */
  private async run(action: () => Promise<void>): Promise<void> {
    const buttons = Array.from(this.contentEl.querySelectorAll("button"));
    buttons.forEach((b) => (b.disabled = true));
    this.error.setText("");
    try {
      await action();
      this.close();
    } catch (e) {
      this.error.setText(e instanceof Error ? e.message : String(e));
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  onOpen(): void {
    const { contentEl, req } = this;
    this.modalEl.addClass("lacuna-answer-modal");
    this.setTitle("Review answers");

    const what = contentEl.createDiv({ cls: "lacuna-modal-what" });
    what.createSpan({ cls: "lacuna-kind", text: req.kind, attr: { title: KIND_HINTS[req.kind] } });
    const asked = req.question || (req.kind === "sic" ? "Is the claim right?" : "(no question)");
    // kind  Lacuna #5 · the question · who answered
    what.createSpan({ cls: "lacuna-modal-id", text: `Lacuna #${req.noteId}` });
    what.createSpan({ cls: "lacuna-modal-sep", text: "·" });
    what.createSpan({ cls: "lacuna-modal-question", text: asked });
    what.createSpan({ cls: "lacuna-modal-sep", text: "·" });
    what.createSpan({ cls: "lacuna-modal-resolver", text: req.resolver });

    renderContext(contentEl, req.context);

    const mode = reviewMode(req.kind, req.verdict);
    if (req.kind === "sic") {
      contentEl.createDiv({
        cls: `lacuna-verdict lacuna-verdict-${req.verdict ?? "uncertain"}`,
        text: VERDICT_TEXT[req.verdict ?? "uncertain"],
      });
    }
    if (mode === "none") {
      contentEl.createDiv({
        cls: "lacuna-modal-hint",
        text: "There is nothing to accept. You can search again, or reject this and answer it yourself.",
      });
    }
    if (req.candidates.length === 0) {
      contentEl.createDiv({
        cls: "lacuna-modal-hint",
        text: "No answer could be read from the note. Open it to see what is there.",
      });
    }
    req.candidates.forEach((c, n) => this.renderCandidate(contentEl, c, n, mode));

    this.error = contentEl.createDiv({ cls: "lacuna-error", attr: { role: "alert" } });

    const footer = contentEl.createDiv({ cls: "modal-button-container lacuna-modal-footer" });
    const reject = footer.createEl("button", { text: "Reject" });
    reject.title = "None of these: the marker stays and the note is marked rejected";
    reject.addEventListener("click", () => void this.run(() => req.reject()));
    const again = footer.createEl("button", { text: "Search again" });
    again.title = "Reject these and ask Claude again, without repeating them";
    again.addEventListener("click", () => void this.run(() => req.searchAgain()));
    footer.createSpan({ cls: "lacuna-modal-shortcut" });
    footer.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
  }

  private renderCandidate(parent: HTMLElement, c: Candidate, n: number, mode: "pick" | "confirm" | "none"): void {
    const { req } = this;
    const card = parent.createDiv({ cls: "lacuna-candidate" });
    let editing = false;
    let draft = c.answer;

    const paint = (): void => {
      card.empty();
      card.createDiv({ cls: "lacuna-candidate-head", text: `Candidate ${n + 1}` });

      if (editing) {
        const area = card.createEl("textarea", {
          cls: "lacuna-modal-answer",
          attr: { rows: req.inline ? "3" : "8", "aria-label": `Candidate ${n + 1}, edited` },
        });
        area.value = draft;
        area.addEventListener("input", () => {
          draft = area.value;
          this.error.setText("");
        });
        if (req.inline) {
          card.createDiv({ cls: "lacuna-field-hint", text: "The marker is inside a line of text: line breaks will be joined." });
        }
        queueMicrotask(() => area.focus());
      } else {
        card.createDiv({ cls: "lacuna-candidate-text", text: c.answer });
      }

      if (c.sources.length > 0) {
        const list = card.createEl("ul", { cls: "lacuna-sources" });
        c.sources.forEach((s) => sourceItem(list, s));
      }
      if (mode === "none") return;

      const actions = card.createDiv({ cls: "lacuna-candidate-actions" });
      if (mode === "pick") {
        const edit = actions.createEl("button", { text: editing ? "Cancel edit" : "Edit" });
        edit.addEventListener("click", () => {
          editing = !editing;
          draft = c.answer;
          this.error.setText("");
          paint();
        });
      }
      const accept = actions.createEl("button", {
        text: mode === "confirm" ? "Accept: the claim is right" : editing ? "Accept edited" : "Accept",
        cls: "mod-cta",
      });
      accept.addEventListener("click", () => {
        const answer = editing ? draft : c.answer;
        if (answer.trim() === "") {
          this.error.setText("The answer is empty.");
          return;
        }
        void this.run(() => req.accept(answer));
      });
    };
    paint();
  }

  onClose(): void {
    this.contentEl.empty();
    this.onClosed();
  }
}
