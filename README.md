# Lacuna

An Obsidian plugin for writers. When you don't know a fact while writing, drop a marker, keep going, and resolve it later with sourced answers from Claude. Or answer it yourself.

```
Windows 95 was released on ==?suppl: exact retail release date==.
```

A *lacuna* is a gap in a manuscript that an editor later fills. Every answer is recorded in a **history note** in an `Apparatus/` folder, named after the *apparatus criticus*, the notes of a scholarly edition that record sources and alternative readings.

- A marker is an ordinary `==highlight==` that starts with `?`. It shows yellow without the plugin, and other plugins such as Dataview ignore it.
- **Claude proposes, you decide.** Nothing enters your text until you accept it. You can edit a candidate first.
- **Every answer is sourced**: the candidates come with the pages they were found on, and the history note keeps them.
- **Nothing else leaves your computer**: only the question, the note's title and the paragraph around the marker go to Claude's web search. See [Privacy](#privacy).

## Requirements

- Obsidian **desktop** 1.5.7 or later (the plugin starts the `claude` program, so it is desktop only).
- The [Claude Code](https://claude.com/claude-code) command line, installed and logged in with your own account. Lacuna runs it with your login, so it uses your Claude subscription: a search uses some of your plan's allowance. **Answer myself** needs none of this and works offline.
- For the `/adloc` command: the **Slash commands** core plugin switched on (Settings → Core plugins). The other ways to insert a marker do not need it.

## Install

Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/lacuna/`, then enable **Lacuna** under Settings → Community plugins.

To build them yourself: `npm install`, then `npm run build`; the three files are in the repository's root.

## Using it

### Add a marker

Any of these:

- Type `==?` and pick a keyword from the popup.
- Run **Insert marker (adloc)**: type `/adloc` with the Slash commands plugin on, or give the command a hotkey in Settings → Hotkeys.
- Select some words and right-click → **Ask about this…**, or run `/adloc`: the selection becomes the question.
- Just type `==?suppl: your question==`.

A marker looks like `==?keyword: question==`. It may run over several lines of a paragraph. A marker without a keyword gets the **default kind** (`suppl`, unless you change it).

### The kinds

| Kind | Keyword | What it asks | What replaces the marker |
|---|---|---|---|
| `suppl` | `suppl`, `fill` | supply a missing value | the answer |
| `sic` | `sic`, `check` | verify the claim just before the marker | confirmed: nothing but the citation. Wrong: `(actually: the correction)`. Your sentence is never rewritten. |
| `fontes` | `fontes`, `find` | find sources | a short mention of the source |
| `glossa` | `glossa`, `explain` | explain | the explanation |
| `cf` | `cf`, `compare` | compare | the comparison |

When the marker sits alone on its line, a `glossa` or `cf` answer may be several paragraphs, a list or a table. Inside a line of text it is always one line.

### Solve it

Open the **Lacuna** sidebar (the highlighter icon in the ribbon). It lists the lacunae of the current note, or of the whole vault. For each one:

- **Solve** asks Claude. Searches run one at a time in the background; you can keep writing. A notice tells you when one ends.
- **Answer myself** opens a dialog where you type the answer yourself, with an optional source (a link, or free text such as a book or "from memory"). It is applied at once.
- When the answers are in, **Review** opens a dialog with the paragraph around the marker and each candidate with its sources. **Accept** puts a candidate in your text. **Edit** lets you change it first. **Reject** leaves the marker as it is. **Search again** rejects these and asks again, telling Claude not to repeat them. Closing the dialog changes nothing.

Clicking the question in the sidebar jumps to the marker.

### What you get in the text

With the default **footnote** citation:

```
Windows 95 went on sale on August 24, 1995[^lac-3].

[^lac-3]: See [[Lacuna 3 — Windows 95 — exact retail release date|Lacuna #3]]: “exact retail release date”.
```

With the **inline** citation: `Windows 95 went on sale on August 24, 1995 [[Lacuna 3 — …|ad loc.]].`

Either way the answered paragraph gets an invisible anchor (`^adloc-1`, visible only in Source mode) that the history note links back to. Applying an answer is one undo step in the editor. It also works when the note is in Reading mode or is not open.

## The apparatus

Each question leaves a **history note**, named `Lacuna 3 — Windows 95 — exact retail release date`, in the `Apparatus/` folder: one for the whole vault, or one in the folder of each article that has lacunae, as you choose. It holds:

- the passage the question was about, the candidates and their sources (page, quote);
- properties: `lacuna` (`pending`, `resolved` or `rejected`), the numbered `id`, `kind`, `article`, `at` (a link to the answered paragraph), `asked`, `resolver`, `answer`, `answered`;
- under its title, `Answered at … ad loc.` with a few words of the answered sentence.

Notes in this folder are never scanned for markers. A new search for the same marker makes a new note, and rejected ones stay as the record. The numbers are one more than the highest in the vault, so deleting the notes restarts them at 1. Rename or move a history note and the links to it keep working.

## Languages

Keywords are recognised in the languages you check in the settings, ignoring case and accents (`Vérifier` = `verifier`):

| Kind | Latin | English | Français | Italiano | Español | Deutsch | Esperanto |
|---|---|---|---|---|---|---|---|
| supply | `suppl` | fill | compléter | integra | completar | ergänzen | kompletigi |
| verify | `sic` | check | vérifier | verifica | verificar | prüfen | kontroli |
| sources | `fontes` | find | sources | fonti | fuentes | quellen | fontoj |
| explain | `glossa` | explain | expliquer | spiega | explicar | erklären | klarigi |
| compare | `cf` | compare | comparer | confronta | comparar | vergleichen | kompari |

Latin and English are checked at first. The **Idiolect** is your own language: one word of your choice for each kind. A word is refused, with the reason under the field, if it already means another kind in any language. The history note always records the Latin kind, and the word you typed.

## Settings

| Setting | What it does |
|---|---|
| Default kind | What a marker without a known keyword asks for. *None* ignores such markers. |
| Popup language | The language of the keywords listed after `==?`. |
| Recognised languages, Idiolect | Which keywords are understood, and your own words. |
| Apparatus folder | The name of the folder of the history notes. |
| Vault-wide or local apparatus | One apparatus folder for the whole vault, or one in the folder of each article that has lacunae (shared by the articles in it). The folder has the name chosen above either way. |
| Citation | Footnote (default) or inline link. |
| Context sent | The sentence, the paragraph (default), the paragraph and its neighbours, or the whole note. |
| Maximum candidates | 1 to 5 answers per search. |
| Claude CLI, model, timeout | The `claude` command or its full path (with a **Test** button), the model (`sonnet` by default), and how long to wait. |

## Privacy

- Only a search leaves your computer: the question, the note's title, and the context you chose. Other lacunae in that passage are replaced by `[…]`. The history note records exactly that text under "Context sent to the search".
- Claude runs in an empty temporary folder, with only its web search and page-reading tools. It cannot see your vault.
- **Answer myself** sends nothing anywhere.

## Development

```
npm install
npm run dev     # rebuilds into test-vault/.obsidian/plugins/lacuna on every change
npm test        # unit tests
npm run build   # type check, then the release build in the repository's root
```

Open `test-vault/` as a vault in Obsidian and enable the plugin; `test-vault/Windows 95.md` is an example note with one marker of each kind. Ctrl+R reloads the plugin after a build. The design and its decisions are in [docs/](docs/00-overview.md): the [plan](docs/lacuna-plan.md), the [syntax and language packs](docs/01-syntax-and-keywords.md), the [architecture](docs/02-architecture.md), the [Claude CLI](docs/03-claude-cli.md) and the [backlog](docs/04-backlog.md).
