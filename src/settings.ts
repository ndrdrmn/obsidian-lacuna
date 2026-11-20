import { PluginSettingTab, Setting, type App } from "obsidian";
import { ALL_PACK_IDS, KINDS, KIND_HINTS, getPack, packName } from "./lang/packs";
import type LacunaPlugin from "./main";
import { cleanFolderName } from "./paths";
import { DEFAULT_SETTINGS, setPopupLang, toggleLang, type DefaultKind } from "./settings-model";

const APPARATUS_URL = "https://en.wikipedia.org/wiki/Critical_apparatus";

/**
 * Minimal settings tab: what steps 3 and 4 need (default kind, languages, history folder).
 * The Idiolect editor, the history-note location and the rest come with step 7.
 */
export class LacunaSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LacunaPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl).setName("Markers").setHeading();

    new Setting(containerEl)
      .setName("Default kind")
      .setDesc(
        "What a marker without a known keyword asks for. With 'None', such markers are ignored, like plain " +
          "highlights, and inserting a marker asks for the kind first. Changing this changes the meaning, or " +
          "the visibility, of unsolved markers that have no keyword. Solved ones are not affected.",
      )
      .addDropdown((dd) => {
        dd.addOption("none", "None (a keyword is required)");
        for (const kind of KINDS) dd.addOption(kind, `${kind}: ${KIND_HINTS[kind]}`);
        dd.setValue(settings.defaultKind).onChange(async (value) => {
          this.plugin.settings.defaultKind = value as DefaultKind;
          await this.plugin.applySettings();
        });
      });

    new Setting(containerEl)
      .setName("Popup language")
      .setDesc(
        "The language of the keywords listed after you type ==?. One at a time keeps the list short. " +
          "Choosing a language also recognises it.",
      )
      .addDropdown((dd) => {
        for (const id of ALL_PACK_IDS) dd.addOption(id, packName(id));
        dd.setValue(settings.popupLang).onChange(async (id) => {
          this.plugin.settings = setPopupLang(this.plugin.settings, id);
          await this.plugin.applySettings();
          this.display();
        });
      });

    new Setting(containerEl).setName("Recognised languages").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Keywords of the checked languages are recognised in your notes. In a note, a marker that uses an " +
        "unchecked language falls back to the default kind (or is ignored when it is None). At least one " +
        "language always stays checked.",
    });

    for (const id of ALL_PACK_IDS) {
      const pack = getPack(id);
      const words = pack ? KINDS.map((k) => pack.aliases[k]).join(" · ") : "your own words (editor coming)";
      new Setting(containerEl)
        .setName(packName(id))
        .setDesc(words)
        .addToggle((t) =>
          t.setValue(settings.enabledLangs.includes(id)).onChange(async (on) => {
            this.plugin.settings = toggleLang(this.plugin.settings, id, on);
            await this.plugin.applySettings();
            this.display();
          }),
        );
    }

    new Setting(containerEl).setName("History notes").setHeading();

    const desc = document.createDocumentFragment();
    const link = document.createElement("a");
    link.href = APPARATUS_URL;
    link.textContent = "apparatus criticus";
    desc.append(
      "The folder of the history notes: one per question, recording the candidates, the sources and your " +
        "choice. Named after the ",
      link,
      " of a scholarly edition, which records the sources and the alternative readings. Notes in this " +
        "folder are never scanned for markers.",
    );
    new Setting(containerEl)
      .setName("Apparatus folder")
      .setDesc(desc)
      .addText((t) => {
        t.setPlaceholder(DEFAULT_SETTINGS.historyFolder)
          .setValue(settings.historyFolder)
          .onChange(async (value) => {
            // Saved as you type; applied (a rescan) when you leave the field.
            const folder = cleanFolderName(value);
            this.plugin.settings.historyFolder = folder === "" ? DEFAULT_SETTINGS.historyFolder : folder;
            await this.plugin.saveSettings();
          });
        t.inputEl.addEventListener("blur", () => void this.plugin.applySettings());
      });
  }
}
