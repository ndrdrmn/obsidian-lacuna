import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type { ContextMode } from "./context";
import type { CitationStyle } from "./apply";
import { findIdiolectConflicts } from "./lang/keywords";
import { ALL_PACK_IDS, IDIOLECT_ID, KINDS, KIND_HINTS, getPack, packName } from "./lang/packs";
import type LacunaPlugin from "./main";
import { cleanFolderName } from "./paths";
import { testClaude } from "./resolvers/claudeCli";
import {
  CONTEXT_MODES,
  DEFAULT_SETTINGS,
  isValidModel,
  setIdiolectWord,
  setPopupLang,
  toggleLang,
  type DefaultKind,
  type HistoryLocation,
} from "./settings-model";

const APPARATUS_URL = "https://en.wikipedia.org/wiki/Critical_apparatus";

/** The settings tab: markers and languages (with the Idiolect editor), history notes, citation, search and Claude. */
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
      const own = KINDS.filter((k) => settings.idiolect[k]).map((k) => settings.idiolect[k]);
      const words = pack
        ? KINDS.map((k) => pack.aliases[k]).join(" · ")
        : own.length > 0
          ? own.join(" · ")
          : "your own words, edited below once it is checked";
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

    if (settings.enabledLangs.includes(IDIOLECT_ID)) this.renderIdiolect(containerEl);

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
      .setName("Vault-wide or local apparatus")
      .setDesc(
        "Vault-wide keeps all history notes in one place. Local puts them in an apparatus folder in the same " +
          "folder as the article, so a folder you move or share takes its history notes with it. In both cases " +
          "the folder is named as chosen in “Apparatus folder” above.",
      )
      .addDropdown((dd) => {
        dd.addOption("vault", "Vault-wide: one folder");
        dd.addOption("article", "Local: in the articles' folder");
        dd.setValue(settings.historyLocation).onChange(async (value) => {
          this.plugin.settings.historyLocation = value as HistoryLocation;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Citation").setHeading();

    new Setting(containerEl)
      .setName("How an answer points to its history note")
      .setDesc(
        "Footnote: the answer is followed by a reference such as [^lac-7], and a footnote at the end of the " +
          "note reads “See Lacuna #7: the question”, linked to the history note. Inline link: a small “ad loc.” " +
          "link right after the answer. Either way, the answered paragraph gets an invisible anchor (^adloc-1) " +
          "that the history note links back to.",
      )
      .addDropdown((dd) => {
        dd.addOption("footnote", "Footnote (default)");
        dd.addOption("inline", "Inline link");
        dd.setValue(settings.citationStyle).onChange(async (value) => {
          this.plugin.settings.citationStyle = value as CitationStyle;
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

  /**
   * The Idiolect: one word of your own for each kind. Each is checked as you type, against every
   * built-in language (checked or not) and your other words; a word that clashes is refused, with
   * the reason under the field, and what stays stored is the last word that was fine.
   */
  private renderIdiolect(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Idiolect: your own keywords").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "A word of your own for each kind, if you want one. It must be a single word without ':', '=' or '?', and " +
        "it cannot be a word that already means another kind in any language, checked or not. Leave a kind empty " +
        "to have no word of your own for it.",
    });
    // A stored word can clash after an update that adds a language containing it.
    for (const c of findIdiolectConflicts(this.plugin.settings.idiolect)) {
      containerEl.createEl("p", {
        cls: "lacuna-setting-error",
        text: `Your word "${c.word}" for ${c.kind} now also means ${c.collision.kind} in ${c.collision.packName}, which wins. Pick another.`,
      });
    }

    for (const kind of KINDS) {
      const setting = new Setting(containerEl).setName(kind).setDesc(KIND_HINTS[kind]);
      const message = setting.descEl.createDiv({ cls: "lacuna-setting-error" });
      let refused = false;
      setting.addText((t) => {
        t.setPlaceholder("(none)")
          .setValue(this.plugin.settings.idiolect[kind] ?? "")
          .onChange(async (value) => {
            const result = setIdiolectWord(this.plugin.settings, kind, value);
            refused = result.error !== null;
            message.setText(result.error ?? "");
            t.inputEl.toggleClass("lacuna-invalid", refused);
            if (refused) return;
            this.plugin.settings = result.settings;
            await this.plugin.saveSettings();
          });
        t.inputEl.addEventListener("blur", () => {
          // Leaving a refused word in the field would show something that is not stored.
          if (refused) {
            t.setValue(this.plugin.settings.idiolect[kind] ?? "");
            message.setText("");
            t.inputEl.removeClass("lacuna-invalid");
            refused = false;
          }
          // A rescan, once, instead of one per keystroke.
          void this.plugin.applySettings();
        });
      });
    }
  }
}

const CONTEXT_LABELS: Record<ContextMode, string> = {
  sentence: "The sentence",
  paragraph: "The paragraph (default)",
  paragraphPlusMinusOne: "The paragraph and its neighbours",
  note: "The whole note",
};
