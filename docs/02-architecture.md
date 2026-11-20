# Architecture: "the vault is the API"

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

## History note format

```markdown
---
lacuna: pending          # pending | resolved | rejected
kind: suppl              # always the Latin canonical name
alias: "integra (it)"    # only if a non-Latin keyword was typed
question: "exact release date"
article: "[[windows-95]]"      # Obsidian updates this on rename
marker: "==?integra: exact release date=="   # JSON-quoted: a multi-line marker has \n escapes
asked: 2026-11-18T16:40
resolver: claude-cli/sonnet
verdict: confirmed       # sic only: confirmed | corrected | uncertain
answer:                  # set on accept
answered:
---
# exact release date
> Context sent: "…paragraph…"

## Candidate 1
August 24, 1995
- [Microsoft – Windows 95 launch](https://…) — "quote"

## Candidate 2
…

## Rejected attempts
…
```

- **Location:** folder `Apparatus/` by default. Settings: the folder name, and its location (one vault folder, or a subfolder next to the article).
- **File name:** `YYYY-MM-DD <article> — <question slug>.md`.
- **Pending note ↔ marker matching:** by the `article` link plus the exact `marker` text. If no marker matches, the item is shown as an orphan with *Discard*.
- **A marker can span lines**, so `marker:` must be written as a double-quoted YAML string with `\n` escapes (JSON-style quoting), never as a plain scalar. Compare with line endings normalised: the editor uses `\n` while the file may use `\r\n`.
- **Reject:** the marker stays yellow, the note gets status `rejected` and keeps its candidates. Retry tells the agent "not these".

## Citation

- **Footnote (default):** `[^lac-k3f9]`, with `[^lac-k3f9]: [[Apparatus/…|<label>]]` appended at the end of the note. The id is random and checked for uniqueness in that note.
- **Inline:** ` [<label>](link)` or `[[link|<label>]]`, following the vault's link setting.
- The citation **always points only to the history note**. Links are built with `app.fileManager.generateMarkdownLink` so renaming or moving the history note keeps them valid.
- After resolution the plugin reads only the history note's frontmatter, never its body.
- Label still open: `ai-source` (upfront that an AI produced it) or `ad loc.` (fits the theme).

## Applying a replacement

If the article is open in an editor, use `editor.replaceRange` so the change is undoable. Otherwise use `app.vault.process`. In both cases the marker's position is found again in the *current* text at accept time, because the user may have edited the article during the search.

## Parsing and indexing

1. Prefilter with `indexOf('==?')`.
2. Take the word before the first `:` with one fixed pattern.
3. Normalise it to lowercase with accents stripped (NFD, then remove combining marks).
4. Look it up in a `Map<alias, Kind>`, built from the enabled packs whenever the settings change.

The number of languages has no effect on speed.

- `metadataCache` doesn't index highlights. It is only used to learn *which* note changed (its `changed` event, plus vault rename and delete); that note is then read and parsed again. The parser skips code itself (`maskNonProse`), so the cache's `sections` are not needed.
- While you type, the open note is re-parsed from the editor's text (`editor-change`, debounced 250 ms), without waiting for a save.
- `src/scanner.ts` (`MarkerIndex`) keeps one entry per scanned note. A note without `==?` is never parsed. The vault is scanned once, the first time the vault toggle is used, in batches of 50 notes. Before that, only opened notes are indexed, and `metadataCache` events are ignored for other notes so that Obsidian's startup indexing doesn't make us read the whole vault.
- **Notes inside the history folder are never scanned** (`isHistoryPath`): they quote their marker. With the "next to the article" location, any directory of the path may be the history folder.
- **A settings change** (languages, Idiolect, default kind, history folder) calls `reset()`: the index is cleared, and the vault is scanned again if it had been scanned. A scan that was running during the reset throws its results away (generation counter).

## Sidebar list

- `src/view/SidebarView.ts`: an `ItemView` with a toggle between **This note** and **Whole vault** (grouped by note). The toggle is saved with the workspace layout. Open it from the ribbon icon or the command "Open sidebar".
- Each item shows the canonical kind and the question; a marker with no question yet is shown as "(no question yet)".
- Clicking an item opens the note (reusing a tab that already shows it), switches it to editing mode if it was in reading mode, and selects the marker. If the line changed in the meantime, the marker is searched again on that line.

## Queue and resolvers

- **Queue:** background, one job at a time: `queued → searching → ready` (or `failed`), with status events and cancel.
- **Resolvers** sit behind `interface Resolver { id; name; solve(req, signal) }`: the Claude CLI resolver and "Answer myself" (offline, a modal).

## Sidebar review

A sidebar card expands in place. Candidates are radio options with their sources, plus an editable answer field and Accept / Reject / Retry… / Open note. Scope is the current note by default, with a toggle for the whole vault (grouped by note). No "solve all": one by one only.

## Solving a marker (step 5)

1. **Solve** on a sidebar item puts a job in the queue (`src/queue.ts`), one job at a time: `queued → searching → ready` (or `failed`). Asking again for a marker that is queued or running does nothing; Cancel removes the job and stops the process.
2. When the job runs (`main.ts`, `runSolve`): the note's current text is read (including unsaved edits), the marker is **found again** in it (it may have moved), the context is cut (`context.ts`), the prompt is built (`prompt.ts`), and the resolver is called.
3. The answers are written to a **pending history note** (`history-note.ts` builds the text, `history.ts` writes it): `Apparatus/YYYY-MM-DD <article> — <question>.md`, or a folder of that name next to the article, per the settings. A name that is taken gets a number; nothing is overwritten.
4. The sidebar then shows "answers ready" and **Open note** (the review card comes with step 6). Which history note belongs to which marker is decided from the metadata cache alone, by the `article` link plus the exact `marker` text, so it survives a restart of Obsidian (`matchHistory`). A job in this session takes precedence over what the vault says (`status.ts`).
5. A notice announces the end of every search, so the sidebar does not have to be open.

The body of a history note is `# title`, the context that was sent as a block quote, then one `## Candidate N` section per candidate: the answer, a blank line, and its sources as `- [title](url) — “quote”` lines. An answer must not contain a `#` heading. Only `http` and `https` sources are kept.

The plugin never reads the vault from the resolver's side: the only thing that leaves the machine is the prompt (the title, the context chosen in the settings, the question).
