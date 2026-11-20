# Syntax, kinds and language packs

## Marker grammar

```
==?keyword: question==
```

- Only `==?…==` is a marker. Plain `==highlights==` are never touched.
- It renders yellow without the plugin, and Dataview ignores it.
- Single line. The question can't contain `==`. Code blocks and inline code are ignored.
- The **keyword** is the word before the first `:`. It is matched against the enabled language packs, ignoring case and accents (`verifier` = `vérifier`).
- With no keyword, or an unknown one, the **default kind** setting decides (see below).

## Kinds (Latin canonical names)

| Kind | Meaning | Replacement in the article |
|---|---|---|
| `suppl` | supply a missing value | `answer<cite>` |
| `sic` | verify the claim just before the marker | confirmed: `<cite>`. Wrong: `(actually: correction<cite>)`. The user's sentence is never rewritten. |
| `fontes` | find sources | a short source mention `<cite>` |
| `glossa` | explain | the full text `<cite>` |
| `cf` | compare | the full text `<cite>` |

For `glossa` and `cf`, a table or multi-paragraph answer is only allowed when the marker sits alone on its line. The prompt tells the agent whether the marker is inline or a block.

## Keyword table

| Kind | la | en | fr | it | es | de | eo |
|---|---|---|---|---|---|---|---|
| supply a value | `suppl` | fill | compléter | integra | completar | ergänzen | kompletigi |
| verify a claim | `sic` | check | vérifier | verifica | verificar | prüfen | kontroli |
| find sources | `fontes` | find | sources | fonti | fuentes | quellen | fontoj |
| explain | `glossa` | explain | expliquer | spiega | explicar | erklären | klarigi |
| compare | `cf` | compare | comparer | confronta | comparar | vergleichen | kompari |

## Language packs

- Built-in packs: Latin (canonical), English, Français, Italiano, Español, Deutsch, Esperanto.
- **Idiolect** is the user's own pack, with one alias per kind. A kind left empty has no alias.
- Setting **Recognised languages:** one checkbox per pack. Latin isn't mandatory, but unchecking the last pack checks Latin again, so at least one language is always on. Markers using an unchecked language are no longer recognised; they fall back to the default kind, or are ignored when it is None.
- Setting **Popup language:** a single choice, so the suggestion list stays short. Choosing it also checks it as recognised.
- No import or export of packs.

## Default kind

Setting with one of `suppl` (default value), `sic`, `fontes`, `glossa`, `cf`, or **None (keyword required)**.

- **With a default kind:** a marker with no keyword is a question of that kind. With an unknown keyword, the whole text is the question.
- **With None:** both cases are ignored completely, like a plain highlight.
- Changing the setting changes the meaning, or the visibility, of markers that have no keyword and aren't solved yet. Solved markers aren't affected, because their kind is stored in the history note.
- When the default kind is None, every insertion method (`/adloc`, hotkey, right-click) inserts `==?` and opens the keyword popup right away.

## Collisions

- **Built-in packs:** a unit test requires every alias to be unique across all built-in packs and Latin, and to be a single word with no `:`, `==` or spaces. Enabling built-in packs can therefore never cause a clash.
- **Idiolect:** each alias is validated as it is typed, against Latin, every built-in pack (enabled or not) and the rest of the Idiolect. A clash is refused with a message such as "already means *sic* in Italiano". Reusing a word for the same kind is allowed.
- **On language select:** a cheap re-check, in case an update added a built-in pack containing a word the Idiolect already uses.

## Inserting a marker

Defaults: the recognised languages are Latin and English, the popup language is Latin, the default kind is `suppl`.

- **Command `/adloc`** ("Insert marker (adloc)"). Typing `/adloc` in the Slash commands core plugin finds it, because that plugin lists commands by name. The core plugin is off in a new vault: enable it in Settings → Core plugins.
- **Hotkey:** none by default, as the Obsidian guidelines advise. Assign one to the same command in Settings → Hotkeys.
- **Right-click** "Ask about this…" does the same as the command.
- **Typing `==?`** opens a popup listing the keywords of the popup language, the default kind first. It filters as you type and closes as soon as you type a space or a colon, so an ordinary question is never blocked.

What the command and the right-click entry insert:

| Situation | Result |
|---|---|
| No selection, default kind set | `==? ==`, cursor before the closing `==` |
| Selection, default kind set | `==?selection==` (the selection becomes the question, on one line) |
| Default kind None | A picker asks for the kind first, then inserts `==?kw: ==` or `==?kw: selection==` |
| Selection containing `==` | Refused with a notice: a marker cannot contain `==` |

With the default kind None the picker is a modal (Obsidian's `SuggestModal`), not the inline popup, because a programmatic insertion is not guaranteed to trigger the inline one.

## What the history note records

- `kind:` always holds the Latin canonical name.
- `alias:` records the word that was typed and its pack, e.g. `verifica (it)`. It is omitted when the Latin form was used.

## Adding a fixed pack later

1. Add one entry to `src/lang/packs.ts`: `{ id, name (endonym), aliases: Record<Kind, string> }`. TypeScript rejects a pack that is missing a kind.
2. `tests/packs.test.ts` checks alias format and global uniqueness automatically.
3. Settings store the ids of the enabled packs, so the new pack ships unchecked and changes nothing for existing users.

Adding a new kind makes the compiler list every built-in pack that needs a translation.
