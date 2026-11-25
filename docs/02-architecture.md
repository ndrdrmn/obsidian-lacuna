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
id: 122                  # the number of the note, unique in the vault
kind: suppl              # always the Latin canonical name
alias: "integra (it)"    # only if a non-Latin keyword was typed
question: "exact release date"
article: "[[windows-95]]"      # Obsidian updates this on rename
at:                      # set on accept, next to `article`: link to the answered passage, "[[windows-95#^lac-122]]"
marker: "==?integra: exact release date=="   # JSON-quoted: a multi-line marker has \n escapes
asked: 2026-11-18T16:40
resolver: claude-cli/sonnet
verdict: confirmed       # sic only: confirmed | corrected | uncertain
answer:                  # set on accept
answered:
---
# Lacuna 122 · exact release date
Answered at [[windows-95#^lac-122]]     <- added on accept

> Context sent to the search: "…paragraph…"     <- "Context:" for Answer myself

## Candidate 1
August 24, 1995
- [Microsoft – Windows 95 launch](https://…) — "quote"

## Candidate 2
…

## Rejected attempts
…
```

- **Location:** folder `Apparatus/` by default. Settings: the folder name, and its location (one vault folder, or a subfolder next to the article).
- **File name:** `Lacuna <id> — <article> — <question slug>.md`. The date is in the properties (`asked`, `answered`), not in the name.
- **The number** is one more than the larger of two values: `lastHistoryId`, kept in `data.json` beside the settings, and the highest `id` among the history notes in the metadata cache (`nextHistoryId`, pure). The stored value saves reading anything; the cache guards against a `data.json` that was reset or synced from another device. It is reserved before any `await`, so two notes made at once cannot share it.
- **The context is always kept**, as a block quote: the passage chosen in the settings, labelled "Context sent to the search" for Claude and "Context" for Answer myself, where nothing was sent.
- **Pending note ↔ marker matching:** by the `article` link plus the exact `marker` text. If no marker matches, the item is shown as an orphan with *Discard*.
- **A marker can span lines**, so `marker:` must be written as a double-quoted YAML string with `\n` escapes (JSON-style quoting), never as a plain scalar. Compare with line endings normalised: the editor uses `\n` while the file may use `\r\n`.
- **Reject:** the marker stays yellow, the note gets status `rejected` and keeps its candidates. Retry tells the agent "not these".

## Citation

- **Footnote (default):** `[^lac-122]`, with `[^lac-122]: See [[Apparatus/…|Lacuna #122]]: “the question”.` appended at the end of the note. The id comes from the number of the history note (`anchorIdFor`); if the article already uses it, it becomes `lac-122-2`. The question is cut at about 80 characters.
- **Inline:** ` [ad loc.](link)` or `[[link|ad loc.]]`, following the vault's link setting.
- The citation **always points only to the history note**. Links are built with `app.fileManager.generateMarkdownLink` so renaming or moving the history note keeps them valid.
- After resolution the plugin reads only the history note's frontmatter, never its body.
- The inline label is `ad loc.` (`CITATION_LABEL` in `src/apply.ts`), whoever wrote the answer. A footnote says `Lacuna #N` instead, because in the footnote list "ad loc." alone tells the reader nothing.
- **Link back:** the answered block gets an invisible anchor, a block id such as ` ^lac-122` (`planAnchor`). In a paragraph or a list item it is at the end of the last line; a table or a quote takes it on a line of its own after a blank line; a block that already has an id keeps it; a heading takes none, and the link goes to the article only. The history note records the link in `at` and under its title ("Answered at"). Obsidian keeps both links valid when either note is renamed.

## Applying a replacement

`acceptAnswer` (`src/accept.ts`) does it. If the article is open in an editor, the marker's replacement and the footnote definition go in **one `editor.transaction`**, so a single Ctrl+Z undoes both; the view is then saved at once and the file is read back to check that the answer is really in it. Otherwise it uses `app.vault.process`: a note that is closed, one in Reading mode (it has no live editor), and one whose editor ignored the change. A change that is only half there is an error, and the history note stays `pending`: it never says `resolved` about an answer that is not in the note. In both cases the marker's position is found again in the *current* text at accept time, because the user may have edited the article during the search; if it is gone, nothing is changed and an error is thrown. What changes in the text is worked out by the pure `planAccept` (`src/apply.ts`), which returns edits as data. Last, the history note's frontmatter is set to `lacuna: resolved`, with `answer` and `answered`.

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
3. The answers are written to a **pending history note** (`history-note.ts` builds the text, `history.ts` writes it): `Apparatus/Lacuna <id> — <article> — <question>.md`, or a folder of that name next to the article, per the settings. Nothing is overwritten.
4. The sidebar then shows "answers ready" and **Open note** (the review card comes with step 6). Which history note belongs to which marker is decided from the metadata cache alone, by the `article` link plus the exact `marker` text, so it survives a restart of Obsidian (`matchHistory`). A job in this session takes precedence over what the vault says (`status.ts`).
5. A notice announces the end of every search, so the sidebar does not have to be open.

The body of a history note is `# title`, the context that was sent as a block quote, then one `## Candidate N` section per candidate: the answer, a blank line, and its sources as `- [title](url) — “quote”` lines. An answer must not contain a `#` heading. Only `http` and `https` sources are kept.

The plugin never reads the vault from the resolver's side: the only thing that leaves the machine is the prompt (the title, the context chosen in the settings, the question).

### "Answer myself"

The offline resolver (`src/resolvers/manual.ts`): a dialog where the user types the answer, with an optional source. It is behind the same `Resolver` interface and writes the same history note (`resolver: manual`, one candidate), but **the answer is applied at once**: it is the user's own text, so there is nothing to review. `answerMyself` in `main.ts` writes the note, calls `acceptAnswer`, and the note ends up `resolved`. If applying fails (the marker was deleted meanwhile), the note stays `pending` and a message says so; the answer is not lost.

- It **does not go through the queue**, which runs one job at a time and must not be held up by a dialog.
- **Nothing is sent anywhere**, so the note's context block is labelled "Context" and not "Context sent to the search", and the dialog can show more of the note than a search would get: the marker's paragraph and the ones before and after it (`splitContext`, pure). For `sic` the claim is underlined in it.
- For `sic` the dialog asks whether the claim is right or wrong: a confirmed claim needs no text (only the citation is added), a wrong one needs the correction.
- **The source is free text or a link.** A link (`http`/`https`) is written in the note as `- [host](url)`; anything else (a book, "from memory") as a plain line `- text`. `Source.url` is therefore optional.
- **An answer cannot contain a heading** (a line starting with `#`, up to 3 spaces of indent): the review step finds candidates by their headings. `validateManualAnswer` refuses it with a message. It is pure and tested.
- **A draft survives an accidental close.** What was typed is kept in memory per marker (`manualDrafts` in `main.ts`) when the dialog is closed by Esc or a click outside, and comes back when it is reopened. Save and the Cancel button discard it.
- It is offered next to Solve, after a failure (for instance when offline), and after a rejection. It works without a question for every kind.
