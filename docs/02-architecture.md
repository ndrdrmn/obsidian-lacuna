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
alias: integra (it)      # only if a non-Latin keyword was typed
question: exact release date
article: "[[windows-95]]"      # Obsidian updates this on rename
marker: "==?integra: exact release date=="
asked: 2026-11-18T16:40
resolver: claude-cli/sonnet
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

- `metadataCache` doesn't index highlights. It is used for its `changed`, rename and delete events, so only the affected note is scanned again, and its `sections` let the scanner skip code blocks.
- The vault index is kept in memory and built the first time the vault toggle is used.

## Queue and resolvers

- **Queue:** background, one job at a time: `queued → searching → ready` (or `failed`), with status events and cancel.
- **Resolvers** sit behind `interface Resolver { id; name; solve(req, signal) }`: the Claude CLI resolver and "Answer myself" (offline, a modal).

## Sidebar review

A sidebar card expands in place. Candidates are radio options with their sources, plus an editable answer field and Accept / Reject / Retry… / Open note. Scope is the current note by default, with a toggle for the whole vault (grouped by note). No "solve all": one by one only.
