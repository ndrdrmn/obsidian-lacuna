import { Notice, Plugin, type Editor } from "obsidian";
import { KeywordModal, MarkerSuggest } from "./editor/suggest";
import { buildInsertion } from "./insert";
import { popupKeywords, type KeywordItem } from "./lang/keywords";
import { LacunaSettingTab } from "./settings";
import {
  DEFAULT_SETTINGS,
  defaultKindOrNull,
  normalizeSettings,
  type LacunaSettings,
} from "./settings-model";

export default class LacunaPlugin extends Plugin {
  settings: LacunaSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new LacunaSettingTab(this.app, this));
    this.registerEditorSuggest(new MarkerSuggest(this));

    // The Slash commands core plugin lists every command by name, so typing /adloc finds this one.
    // No default hotkey: assign one in Settings > Hotkeys to wrap a selection from the keyboard.
    this.addCommand({
      id: "insert-marker",
      name: "Insert marker (adloc)",
      editorCallback: (editor) => this.insertMarker(editor),
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
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** The keywords of the popup language, the default kind first. */
  popupItems(): KeywordItem[] {
    const s = this.settings;
    return popupKeywords(s.popupLang, s.idiolect, defaultKindOrNull(s));
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
      editor.replaceRange(result.text, from, to);
      editor.setCursor({ line: from.line, ch: from.ch + result.cursor });
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
