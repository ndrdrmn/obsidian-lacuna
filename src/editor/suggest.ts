import {
  EditorSuggest,
  SuggestModal,
  type App,
  type Editor,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type TFile,
} from "obsidian";
import { matchTrigger } from "../insert";
import { normalize, type KeywordItem } from "../lang/keywords";
import { KIND_HINTS } from "../lang/packs";
import type LacunaPlugin from "../main";
import { lineKind } from "../marker";

/** How far up to look for the start of the paragraph. Typing must stay instant. */
const MAX_LINES_UP = 200;

/** The text of the paragraph from its start to the cursor (see `lineKind`). */
function paragraphPrefix(editor: Editor, cursor: EditorPosition): string {
  let prefix = editor.getLine(cursor.line).slice(0, cursor.ch);
  let kind = lineKind(editor.getLine(cursor.line));
  for (let n = cursor.line; kind === "text" && n > 0 && cursor.line - n < MAX_LINES_UP; n--) {
    const above = editor.getLine(n - 1);
    kind = lineKind(above);
    if (kind === "blank" || kind === "single") break;
    prefix = `${above}\n${prefix}`;
  }
  return prefix;
}

function renderItem(item: KeywordItem, el: HTMLElement): void {
  el.createDiv({ text: item.word });
  el.createEl("small", { text: KIND_HINTS[item.kind] });
}

/** The popup that appears while you type the keyword right after `==?`. */
export class MarkerSuggest extends EditorSuggest<KeywordItem> {
  constructor(private readonly plugin: LacunaPlugin) {
    super(plugin.app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const t = matchTrigger(paragraphPrefix(editor, cursor));
    if (!t) return null;
    return { start: { line: cursor.line, ch: cursor.ch - t.query.length }, end: cursor, query: t.query };
  }

  getSuggestions(context: EditorSuggestContext): KeywordItem[] {
    const q = normalize(context.query);
    return this.plugin.popupItems().filter((i) => normalize(i.word).startsWith(q));
  }

  renderSuggestion(item: KeywordItem, el: HTMLElement): void {
    renderItem(item, el);
  }

  selectSuggestion(item: KeywordItem, _evt: MouseEvent | KeyboardEvent): void {
    const ctx = this.context;
    if (!ctx) return;
    const text = `${item.word}: `;
    ctx.editor.replaceRange(text, ctx.start, ctx.end);
    ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + text.length });
  }
}

/**
 * Asks for the kind before inserting a marker. Used when the default kind is None,
 * because a marker without a keyword would then be ignored.
 */
export class KeywordModal extends SuggestModal<KeywordItem> {
  constructor(
    app: App,
    private readonly items: KeywordItem[],
    private readonly onChoose: (item: KeywordItem) => void,
  ) {
    super(app);
    this.setPlaceholder("What kind of lacuna?");
  }

  getSuggestions(query: string): KeywordItem[] {
    const q = normalize(query);
    return this.items.filter((i) => normalize(i.word).includes(q) || normalize(KIND_HINTS[i.kind]).includes(q));
  }

  renderSuggestion(item: KeywordItem, el: HTMLElement): void {
    renderItem(item, el);
  }

  onChooseSuggestion(item: KeywordItem, _evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(item);
  }
}
