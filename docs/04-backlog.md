# Backlog (not in v1)

- A terminal skill resolver that writes the same history-note format.
- Custom command and Ollama resolvers.
- Mobile review.
- Community-store submission.
- Editor decorations for markers (see also the colours below).
- A per-kind model setting.
- "Solve all".
- Persist the marker index with file modification times, if the first vault scan feels slow on a very large vault.
- Choose a licence (there is none yet) and add a `LICENSE` file.
- A release process: tag, attach `main.js`, `manifest.json` and `styles.css`, and keep `versions.json` in step. BRAT only installs from GitHub, so it is not an option for a GitLab repository.

## Ideas to plan (written down on 2026-11-25, not designed yet)

### 1. Choose the context for each lacuna

Today the context sent to a search is one setting for everything (sentence, paragraph, paragraph and neighbours, whole note). Let the user choose it for one resolution: a small selector next to **Solve** in the sidebar, defaulting to the setting, and the same choice on **Search again** ("not enough context: widen it"). The history note already records what was sent; it would also record which mode that was. Open questions: is the choice remembered for the marker, and does *Answer myself* care (it shows its own, wider context and sends nothing)?

### 2. The whole note as context, copied into every history note

Today the history note quotes the context it records. With the *whole note* mode that is the entire note, once per lacuna: a long article with ten lacunae stores ten copies. That wastes space, bloats Obsidian's search and index with duplicates, and copies private text around.

**Proposition:** record the context verbatim up to a limit (about 2,000 characters, which covers the sentence, the paragraph and most paragraph-and-neighbours cases), and beyond it keep only the marker's paragraph, plus a line that says what was really sent: `Context sent: the whole note, 12,431 characters (only the paragraph around the marker is quoted)`. The mode and the length are always recorded. What is lost is the exact text of a note that has changed since (the lacunae get answered, so the article is not what it was), but the point of the quote is to show what the marker was about, and the paragraph does that. Rejected alternatives: a link to the article (it keeps changing, so it proves nothing about what was sent), a hash only (cannot be read), and compressing the text (unreadable in a note).

### 3. Coloured markers: what accepting a colour emoji would cost

Obsidian's `==` highlights can be coloured by a colour emoji, which a colouring plugin reads. To accept `==🟡?suppl: …==` (or wherever that plugin puts the emoji; this needs to be checked against the plugin the user has) the parser has to let one colour character stand between `==` and `?`.

**Cost: small, about a day, mostly tests.** The work is in seven places that each spell out `==?` on their own: the parser's check that a pair of `==` starts with `?` and its `start + 3` offsets (`marker.ts`), the prefilter `text.includes("==?")` (`scanner.ts`), the three copies of the marker regex (`context.ts` twice, `apply.ts`), the insertion helpers and the `==?` typing trigger (`insert.ts`, `editor/suggest.ts`). The first step would be to put the marker syntax in one place, then add the colour to it. Points to settle: the list of accepted emoji (the squares and circles, with or without the variation selector U+FE0F), that an emoji is two UTF-16 units, so every offset must use string length and not a count of characters, and that `marker:` in a history note then holds the raw text with its emoji, which still matches. Nothing else changes: the kind, the question and the replacement do not depend on the colour. We would not draw the colour ourselves, so it only shows if the colouring plugin is installed.

### 4. A colour for each kind, chosen in the settings

Two routes, which are not equally good:

- **Through the emoji** (builds on item 3): inserting a marker puts the kind's colour emoji in it. It depends on a third-party plugin, and changing a colour in the settings would mean rewriting the user's notes. Not recommended.
- **Through our own rendering** (builds on "Editor decorations for markers"): a CodeMirror decoration for Live Preview and Source mode, and a Markdown post-processor for Reading mode, that give each marker a class by kind, with the colour coming from a CSS variable set from the settings (a colour picker for each kind, with a reset). Nothing is written into the text, it works without any other plugin, and a changed colour applies at once. **Cost: medium, about one to two days**, mostly the two renderers and the Reading-mode case.

If item 4 is wanted, the second route makes item 3 unnecessary, except for someone who already colours highlights by emoji.

### 5. Undo a resolution

Today: Ctrl+Z in the editor right after accepting undoes the text in one step (in editing mode), but the history note stays `resolved` and nothing restores a lacuna later. Everything needed to do it properly is already recorded: the history note has the marker (`marker`), the answer (`answer`), the kind, the number (`id`, which gives the footnote `lac-<id>`), the link to the paragraph (`at`) and the citation style is a setting.

**Proposition:** a *Restore the lacuna* action on a resolved history note (a command, and an entry in the note's file menu), with a confirmation: "This puts the marker back in *Article* and cancels this history note. The answer will no longer be in the text." What it does:

1. Finds what was inserted. The text is rebuilt from the recorded answer and the citation (`buildReplacement` with the same arguments), and found in the article next to its footnote reference or its link.
2. Puts the recorded marker back, removes the footnote definition, and removes the paragraph's anchor only if no other history note points to it (a paragraph can hold several lacunae).
3. Sets the history note to a status that says it no longer counts, so that the lacuna is idle again and can be solved afresh. Keep the note as the record (status `discarded`, shared with the orphan discard) or put it in the trash: to decide.

Cases to handle: the answer text was edited since (the rebuilt text is not found: restore only what can be found, say what was left, and never guess); the article is in Reading mode or closed (same write path as *Accept*); a `sic` confirmed leaves only a citation, so the marker simply comes back. It is a mirror image of `planAccept`, so it can be a pure function with the same kind of tests.
