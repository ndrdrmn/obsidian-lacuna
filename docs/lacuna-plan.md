# Lacuna — Obsidian plugin design & v1 plan

> Repo: `C:\repos\obsidian-findlater`. It contains only `docs/ask-later-plan.md`, an earlier draft of this design under the name "Ask Later".
> Design agreed through 5 Q&A rounds on 2026-11-18. Name, keywords and language packs were redesigned on 2026-11-20.
> **First implementation step:** write this plan to `docs/lacuna-plan.md` and delete `docs/ask-later-plan.md`, since this plan replaces it entirely. Then write the handover docs (§8).

## 1. Context

While writing an article in Obsidian, a missing fact (date, name, place, source, explanation) breaks the writer's flow.
**Lacuna** lets the writer drop a visible marker containing the question, keep writing, and resolve it later.
Claude, run through the user's own Claude Code CLI (subscription, no API credits), proposes answers with sources.
The user picks or edits one. The marker is replaced by the answer plus a citation pointing to a **history note**, which records the question, the candidates, the sources and the choice.
Requirements throughout: plain markdown, private (everything stays local except the context explicitly sent to the search), simple to use and simple to build.

**Naming vocabulary (textual criticism):**
- A *lacuna* is a gap in a manuscript that an editor later fills.
- *Ad locum* ("at the place") is a note on one specific passage, hence the `/adloc` command.
- The *apparatus criticus* is the footnote record of sources and alternative readings. That is what the history notes are, hence the `Apparatus/` folder.

## 2. Decisions (✅ = agreed with user)

| # | Topic | Decision |
|---|---|---|
| D1 | Resolver | The plugin spawns the local `claude -p` CLI. The history-note format is the contract, so a terminal skill can be added later. |
| D2 | Syntax | `==?keyword: question==`. Only `==?…==` is a marker; plain `==highlights==` are never touched. It renders yellow without the plugin, and Dataview ignores it. The keyword is the word before the first `:`, matched against the enabled language packs, ignoring case and accents (§3b). A marker may run over several lines like any highlight, but never across a blank line, a heading, a table row or from one list item into the next (see `docs/01`); the question can't contain `==`; code blocks and inline code are ignored. With no keyword, or an unknown one, the marker follows D23. |
| D3 | Long answers | The full text (paragraph or table) replaces the marker, with the citation appended. |
| D4 | Sidebar scope | Current note by default, with a toggle for the whole vault (grouped by note). |
| D5 | Kinds | Latin canonical names: `suppl` (supply a missing value), `sic` (verify the claim just before the marker), `fontes` (find sources), `glossa` (explain), `cf` (compare). |
| D6 | AI context | Setting: sentence / **paragraph (default)** / paragraph ±1 / whole note. The note title is always sent. |
| D7 | Reject | The marker stays yellow. The history note gets status `rejected` and keeps its candidates. Retry tells the agent "not these". |
| D8 | Insertion | A `/adloc` command (core Slash commands) inserting `==? ==` with the cursor inside. A hotkey for the same command that wraps a selection. An EditorSuggest on `==?` listing the kinds in the popup language, with the default kind first. A right-click "Ask about this…". When the default kind is None (D23), every insertion method inserts `==?` and opens the keyword popup right away. |
| D9 | History location | Folder `Apparatus/` by default. Settings: the folder name, and its location (one vault folder, or a subfolder next to the article). The settings tab explains the name in one line and links to https://en.wikipedia.org/wiki/Critical_apparatus. File name: `Lacuna <id> — <article> — <question slug>.md`; every note has a number, kept in a counter in `data.json` and checked against the notes in the vault. The date lives in the properties. |
| D10 | `sic` correction | The user's sentence is never rewritten. Wrong claim → the marker becomes `(actually: … <citation>)`. Correct claim → the marker becomes just `<citation>`. |
| D11 | Citation | Setting: footnote (**default**) or inline link. It **always points only to the history note**. Links are built with `app.fileManager.generateMarkdownLink` so renaming or moving the history note keeps them valid. After resolution the plugin reads only the history note's frontmatter, never its body. Footnote ids `[^lac-122]`, from the note's number; the footnote reads `See [[…|Lacuna #122]]: “question”.`. Inline label: **`ad loc.`**, for answers from Claude and from the user alike (`ai-source` was rejected: it would be wrong on an answer the user wrote). The answered block gets an invisible block id (` ^lac-122`) that the history note links back to. |
| D12 | Language | Answers are written in the language of the note. |
| D13 | Audience | For the user first, built to community-store standards (English UI, README). Installed manually or through BRAT. |
| D14 | Platform | Desktop only (`isDesktopOnly: true`). |
| D15 | Resolvers | Claude CLI + "Answer myself" (offline), behind a `Resolver` interface. An answer the user typed is **applied at once** (there is nothing to review); it still leaves a history note, which goes straight to `resolved`. |
| D16 | Queue | Background queue, one job at a time: `queued → searching → ready` (or `failed`). |
| D17 | Review UI | A sidebar card expands in place. Candidates are radio options with their sources, plus an editable answer field and Accept / Reject / Retry… / Open note. |
| D18 | Solve all | No. One by one only. |
| D19 | Model | `sonnet` by default (setting). |
| D20 | Name ✅ | **Lacuna**, plugin id `lacuna`. Command `/adloc`. Frontmatter status key `lacuna:`. |
| D21 | Language packs ✅ | Built-in packs: Latin (canonical), English, Français, Italiano, Español, Deutsch, Esperanto, plus **Idiolect**, the user's own pack with one alias per kind. Setting **Recognised languages:** one checkbox per pack. Latin isn't mandatory, but unchecking the last pack checks Latin again. Setting **Popup language:** a single choice; choosing it also checks it as recognised. No import or export of packs. |
| D22 | Collisions ✅ | **Built-in packs:** a unit test requires every alias to be unique across all built-in packs and Latin, and to be a single word with no `:`, `==` or spaces. **Idiolect:** each alias is validated as it is typed, against Latin, every built-in pack (enabled or not) and the rest of the Idiolect. A clash is refused with a message such as "already means *sic* in Italiano". Reusing a word for the same kind is allowed. **On language select:** a cheap re-check, in case an update added a built-in pack containing a word the Idiolect already uses. |
| D23 | Default kind ✅ | Setting, one of `suppl` (**default**), `sic`, `fontes`, `glossa`, `cf`, or **None (keyword required)**. **With a default kind:** a marker with no keyword is a question of that kind; with an unknown keyword, the whole text is the question. **With None:** both cases are ignored completely, like a plain highlight. The setting's description warns that changing it changes the meaning, or the visibility, of markers that have no keyword and aren't solved yet. Solved markers aren't affected. |
| D24 | Kind in history ✅ | `kind:` always holds the Latin canonical name. `alias:` records the word that was typed and its pack, e.g. `verifica (it)`, and is omitted when the Latin form was used. |

**Keyword table**

| Kind | la | en | fr | it | es | de | eo |
|---|---|---|---|---|---|---|---|
| supply a value | `suppl` | fill | compléter | integra | completar | ergänzen | kompletigi |
| verify a claim | `sic` | check | vérifier | verifica | verificar | prüfen | kontroli |
| find sources | `fontes` | find | sources | fonti | fuentes | quellen | fontoj |
| explain | `glossa` | explain | expliquer | spiega | explicar | erklären | klarigi |
| compare | `cf` | compare | comparer | confronta | comparar | vergleichen | kompari |

## 3. Architecture: "the vault is the API"

```
Article (.md)                 Sidebar view                     History note (Apparatus/*.md)
==?suppl: release date==  ─▶  scanner lists markers   ──Solve─▶ queue ─▶ resolver (claude -p / manual)
                              matches pending notes  ◀──────── writes note: lacuna: pending + candidates
                              Accept ─▶ replace marker + citation; note → resolved
                              Reject ─▶ marker stays;            note → rejected
```

The history note is created **before** the user decides, with status `pending` and the candidates in its body. That way:
- Results survive a restart of Obsidian.
- Any future producer (a terminal skill, a different resolver) only has to write the same format.

**History note format**

```markdown
---
lacuna: pending          # pending | resolved | rejected
id: 122                  # the number of the note
kind: suppl              # always the Latin canonical name
alias: integra (it)      # only if a non-Latin keyword was typed
question: exact release date
article: "[[windows-95]]"      # Obsidian updates this on rename
at:                      # set on accept, next to `article`: link to the answered passage
marker: "==?integra: exact release date=="
asked: 2026-11-18T16:40
resolver: claude-cli/sonnet
answer:                  # set on accept
answered:
---
# Lacuna 122 · exact release date
> Context sent to the search: "…paragraph…"     ("Context:" for Answer myself)

## Candidate 1
August 24, 1995
- [Microsoft – Windows 95 launch](https://…) — "quote"

## Candidate 2
…

## Rejected attempts
…
```

**Pending note ↔ marker matching:** by the `article` link plus the exact `marker` text. If no marker matches, the item is shown as an orphan with *Discard*.

**Replacement per kind**
- `suppl`: `answer<cite>`.
- `sic`: `<cite>` if confirmed, `(actually: correction<cite>)` if not.
- `fontes`: a short source mention `<cite>`.
- `glossa` / `cf`: the full text `<cite>`. A table or multi-paragraph answer is only allowed when the marker sits alone on its line; the prompt tells the agent whether the marker is inline or a block.

**Citation forms**
- Footnote (default): `[^lac-122]`, with `[^lac-122]: See [[Apparatus/…|Lacuna #122]]: “question”.` appended at the end of the note. The id is the note's number, and is made unique in the article.
- Inline: ` [ad loc.](link)` or `[[link|ad loc.]]`, following the vault's link setting.
- Both: the answered block gets a block id ` ^lac-122`, and the history note links back to it.

**Applying a replacement:** if the article is open in an editor, use one `editor.transaction` so the change (answer, footnote and anchor) is a single undo step. Otherwise use `app.vault.process`. In both cases the marker's position is found again in the *current* text at accept time, because the user may have edited the article during the search.

### 3b. Keywords and language packs

**Packs are data:**
- `src/lang/packs.ts` holds a list of `{ id, name, aliases: Record<Kind, string> }`, where `name` is the endonym.
- TypeScript rejects a pack that is missing a kind.
- The Idiolect is stored in the settings as `Partial<Record<Kind, string>>`. A kind left empty has no alias.

**Adding a fixed pack later:**
1. Add one entry to `packs.ts`.
2. The collision and format test checks it automatically.
3. Settings store the ids of the enabled packs, so the new pack ships unchecked.

Adding a new kind makes the compiler list every built-in pack that needs a translation.

**Parsing pipeline:**
1. Prefilter with `indexOf('==?')`.
2. Take the word before the first `:` with one fixed pattern.
3. Normalise it to lowercase with accents stripped (NFD, then remove combining marks).
4. Look it up in a `Map<alias, Kind>`, built from the enabled packs whenever the settings change.

The number of languages has no effect on speed.

**Indexing:**
- `metadataCache` doesn't index highlights. It is used for its `changed`, rename and delete events, so only the affected note is scanned again, and its `sections` let the scanner skip code blocks.
- The vault index is kept in memory and built the first time the vault toggle is used.

## 4. Claude CLI resolver (verified against the installed CLI v2.1.327)

```
claude -p --output-format json --json-schema <schema> --tools "WebSearch,WebFetch" \
       --no-session-persistence --model <setting>        # prompt on stdin
```

- **Never use `--bare`:** it disables the OAuth/subscription login.
- The working directory is an empty temp folder and only the two web tools are allowed, so the agent cannot read the vault.
- Schema: `{ verdict?: "confirmed"|"corrected"|"uncertain", candidates: [{ answer, sources: [{title, url, quote?}] }] }`, with at most 3 candidates (setting).
- Settings: executable path (default `claude`, with a **Test** button that runs `claude --version`, because Electron's PATH may differ on Windows), model, timeout (180 s), maximum candidates.
- The exact shape of the JSON output (where the structured result sits, presumably `structured_output`) is confirmed in implementation step 1 with a real run.

## 5. Project layout (standard obsidian-sample-plugin: TypeScript + esbuild, no UI framework)

```
manifest.json  package.json  esbuild.config.mjs  tsconfig.json  versions.json  README.md
src/main.ts               plugin entry: view, commands, suggest, context menu, settings, events
src/lang/packs.ts         Kind type, Latin + built-in packs (la en fr it es de eo)              (pure)
src/lang/keywords.ts      normalise(), buildAliasMap(enabled, idiolect), findCollision()        (pure)
src/marker.ts             grammar + parse(text, aliasMap, defaultKind) → Marker{kind, alias?, question, raw, line, ch}; skips code (pure)
src/context.ts            extract sentence/paragraph/±1/whole note; the claim for sic           (pure)
src/apply.ts              build the replacement + footnote; unique ids                          (pure)
src/prompt.ts             prompt per kind, language rule, inline/block hint, rejected list      (pure)
src/scanner.ts            per-file marker index; metadataCache 'changed' + rename/delete; '==?' prefilter
src/history.ts            create, update and list history notes (processFrontMatter, metadataCache)
src/queue.ts              serial job queue with status events and cancel
src/resolvers/resolver.ts interface Resolver { id; name; solve(req, signal) }
src/resolvers/claudeCli.ts child_process.spawn, stdin prompt, timeout/abort, JSON parsing
src/resolvers/manual.ts   modal: type the answer yourself
src/view/SidebarView.ts   ItemView: scope toggle, cards per state, review card
src/editor/suggest.ts     EditorSuggest for '==?' (popup language, default kind first)
src/settings.ts           settings tab
tests/*.test.ts           vitest for the pure modules, incl. packs.test.ts
test-vault/               sample articles; plugin built into .obsidian/plugins/lacuna
```

## 6. Implementation order

1. **Docs, scaffold and spike:**
   - Write this plan to `docs/lacuna-plan.md`, delete `docs/ask-later-plan.md`, and write the handover docs (§8).
   - Scaffold the plugin (id `lacuna`).
   - Do a manual `claude -p … --json-schema` run to confirm the output shape and the latency.
2. **Pure core:** `lang/packs.ts`, `lang/keywords.ts`, `marker.ts`, `context.ts`, `apply.ts` and `prompt.ts`, with vitest tests.
   - Marker edge cases: code blocks, inline code, two markers on one line, empty `sic`, unknown keyword, existing footnotes.
   - Keyword cases: case and accent folding, default kind None, a disabled pack.
   - Pack tests: global alias uniqueness and alias format.
3. **Insertion:** `/adloc` (slash + hotkey + wrapping a selection), the EditorSuggest and the context-menu entry, including the behaviour when the default kind is None.
4. **Listing:** the scanner and the sidebar list, current note and vault toggle. Clicking an item jumps to the marker.
5. **Solving:** `history.ts` (`kind` + `alias`), the queue and both resolvers. The pending note gets written.
6. **Review and apply:** the review card (Accept/Reject/Retry/Open note), the replacement and citation, and the history-note status updates.
7. **Settings tab and README:**
   - Apparatus folder name and location, with the explanation and Wikipedia link.
   - Recognised languages, popup language, and the Idiolect editor with live collision messages.
   - Default kind, with its warning.
   - Context, citation, resolver and model settings.

## 7. Verification

- `npm test`: unit tests for the grammar, keyword lookup, packs, context extraction, replacement and footnotes.
- `npm run build` with no type errors. Then load `test-vault/` in Obsidian (`npm run dev` watches the build into the plugin folder) and check:
  - All 4 insertion methods produce `==? ==` with the cursor inside, and wrapping a selection works. With the default kind None they produce `==?` and open the popup.
  - Markers are listed for the current note and for the vault. Markers inside code blocks are ignored, and plain `==highlights==` are ignored.
  - `==?verifica: …==` is recognised only while Italiano is checked. `==?Vérifier: …==` and `==?verifier: …==` both match `sic` when Français is checked.
  - With the default kind None, `==?question==` and `==?foo: bar==` don't appear in the sidebar.
  - Unchecking the last recognised language checks Latin again. Choosing a popup language checks it.
  - Typing an Idiolect alias such as `verifica` for `suppl` is refused with the collision message.
  - Solve a `suppl` marker: the status moves through queued → searching → ready, and a pending note appears in `Apparatus/` with `kind: suppl`. A marker using an Italian keyword gets `alias: … (it)`.
  - Accept: the marker becomes `answer[^lac-…]`, the footnote is added, and the note becomes `resolved`. Undo works.
  - Rename and move the history note: the footnote link still resolves.
  - Reject: the marker stays yellow and the note becomes `rejected`. Retry: the prompt includes the rejected answers.
  - `sic` on a true claim and on a false claim. `glossa` on its own line produces a block.
  - "Answer myself" works with the network disabled.
  - With Dataview enabled, there are no stray fields and nothing is broken.
- Privacy: confirm the spawned process's cwd is a temp folder and that only `WebSearch,WebFetch` are allowed.

## 8. Handover docs (written to the repo at step 1)

- `docs/lacuna-plan.md`: this plan.
- `docs/00-overview.md`: problem, constraints, naming vocabulary and the decision table (§1–2).
- `docs/01-syntax-and-keywords.md`: grammar, kinds, the keyword table, language packs, Idiolect, collisions, default kind, replacement rules, and how to add a pack.
- `docs/02-architecture.md`: the vault-as-API idea, the history-note format, resolvers, the queue, indexing.
- `docs/03-claude-cli.md`: CLI flags, the `--bare` warning, privacy setup, schema.
- `docs/04-backlog.md`: later items.
  - A terminal skill resolver, custom command / Ollama resolvers, mobile review, community-store submission, editor decorations for markers.
  - A per-kind model, and "solve all".
  - Persisting the marker index with file modification times, if the first vault scan feels slow.
