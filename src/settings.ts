import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type { ContextMode } from "./context";
import { ALL_PACK_IDS, KINDS, KIND_HINTS, getPack, packName } from "./lang/packs";
import type LacunaPlugin from "./main";
import { cleanFolderName } from "./paths";
import { testClaude } from "./resolvers/claudeCli";
import {
  CONTEXT_MODES,
  DEFAULT_SETTINGS,
  isValidModel,
  setPopupLang,
  toggleLang,
  type DefaultKind,
  type HistoryLocation,
} from "./settings-model";

const APPARATUS_URL = "https://en.wikipedia.org/wiki/Critical_apparatus";

/**
 * Settings tab: what steps 3 to 5 need. The Idiolect editor, the citation style and the
 * rest come with steps 6 and 7.
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

    new Setting(containerEl)
      .setName("Where the history notes go")
      .setDesc("One folder in the vault, or a folder of that name next to each article.")
      .addDropdown((dd) => {
        dd.addOption("vault", "One folder in the vault");
        dd.addOption("article", "Next to each article");
        dd.setValue(settings.historyLocation).onChange(async (value) => {
          this.plugin.settings.historyLocation = value as HistoryLocation;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Search").setHeading();

    new Setting(containerEl)
      .setName("Context sent")
      .setDesc(
        "How much of the note is sent along with the question, besides the note's title. " +
          "Everything you send goes to Claude's web search; nothing else leaves your computer.",
      )
      .addDropdown((dd) => {
        for (const mode of CONTEXT_MODES) dd.addOption(mode, CONTEXT_LABELS[mode]);
        dd.setValue(settings.contextMode).onChange(async (value) => {
          this.plugin.settings.contextMode = value as ContextMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Maximum candidates")
      .setDesc("How many answers to ask for (1 to 5).")
      .addText((t) =>
        t.setValue(String(settings.maxCandidates)).onChange(async (value) => {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1 || n > 5) return;
          this.plugin.settings.maxCandidates = n;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Claude").setHeading();

    new Setting(containerEl)
      .setName("Claude CLI")
      .setDesc(
        "The claude command, or the full path to claude.exe. Lacuna runs it with your own login, so it uses " +
          "your Claude subscription. The agent starts in an empty temporary folder and may only search and " +
          "read the web: it cannot see your vault. Use Test to check that Obsidian can start it.",
      )
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.claudePath)
          .setValue(settings.claudePath)
          .onChange(async (value) => {
            this.plugin.settings.claudePath = value.trim() === "" ? DEFAULT_SETTINGS.claudePath : value.trim();
            await this.plugin.saveSettings();
          }),
      )
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          b.setDisabled(true);
          try {
            new Notice(`Claude CLI found: ${await testClaude(this.plugin.settings.claudePath)}`);
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e), 10_000);
          } finally {
            b.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("For example sonnet, opus or haiku. Letters, digits and . _ : [ ] - only.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(settings.model)
          .onChange(async (value) => {
            if (!isValidModel(value.trim())) return;
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Timeout (seconds)")
      .setDesc("How long to wait for Claude before giving up (10 to 900). A search usually takes 20 to 60 seconds.")
      .addText((t) =>
        t.setValue(String(settings.timeoutSec)).onChange(async (value) => {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 10 || n > 900) return;
          this.plugin.settings.timeoutSec = n;
          await this.plugin.saveSettings();
        }),
      );
  }
}

const CONTEXT_LABELS: Record<ContextMode, string> = {
  sentence: "The sentence",
  paragraph: "The paragraph (default)",
  paragraphPlusMinusOne: "The paragraph and its neighbours",
  note: "The whole note",
};
