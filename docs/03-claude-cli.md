# Claude CLI resolver

The plugin spawns the user's local Claude Code CLI, so it uses their subscription and needs no API credits.

```
claude -p --output-format json --json-schema <schema> --tools "WebSearch,WebFetch" \
       --no-session-persistence --model <setting>        # prompt on stdin
```

## Warnings

- **Never use `--bare`:** it disables the OAuth/subscription login.
## Output shape (confirmed 2026-11-20 with CLI 2.1.329, `--model sonnet`)

One JSON object on stdout. The fields the resolver needs:

- `structured_output`: the result, already parsed and matching the schema. **Read this one.**
- `result`: the same JSON as a string (fallback if `structured_output` is missing).
- `is_error` (boolean), `subtype` (`"success"`), `terminal_reason` (`"completed"`): check these before trusting the result.
- `total_cost_usd`, `duration_api_ms`, `usage`: informational. `total_cost_usd` is the CLI's own estimate at pay-per-use API list prices (`costBasis: "list"`), **not** a charge. On a subscription each call counts against the plan's usage allowance instead; how much is unknown. Never show this figure to the user as money spent.

Spike measurements: a `suppl` question with web search took **about 26 s wall time** and 5 turns, so the default timeout of 180 s leaves plenty of margin. The run in an empty cwd touched no files.

Observation: with a `suppl` question the model still filled `verdict` ("corrected"). The prompt must say that `verdict` is only used for `sic`, and the plugin must ignore it for the other kinds.

## Privacy setup

- The working directory is an empty temp folder.
- Only `WebSearch` and `WebFetch` are allowed, so the agent cannot read the vault.
- Only the configured context (sentence / paragraph / paragraph ±1 / whole note, plus the note title) is sent.

## Schema

```
{ verdict?: "confirmed" | "corrected" | "uncertain",
  candidates: [ { answer, sources: [ { title, url, quote? } ] } ] }
```

At most 3 candidates (setting). `verdict` is used by the `sic` kind.

## Settings

- Executable path (default `claude`), with a **Test** button that runs `claude --version`, because Electron's PATH may differ on Windows.
- Model (default `sonnet`).
- Timeout (default 180 s).
- Maximum candidates.

## Prompt

Built per kind in `src/prompt.ts`. It states the language rule (answers are written in the language of the note), whether the marker is inline or a block, and, on Retry, the list of rejected answers ("not these").

## How the plugin runs it (`src/resolvers/claudeCli.ts`, `src/process.ts`)

- The program is started **without a shell** (`child_process.spawn`), so nothing in the arguments is ever interpreted. Consequence: a `.cmd` or `.bat` shim cannot be started; the setting must point to `claude.exe`. A plain `claude` works when `claude.exe` is on the PATH (it was verified on Windows with the native installer at `~/.local/bin/claude.exe`).
- The prompt goes through **stdin**; the schema is the only large argument.
- The working directory is a fresh empty folder in the system temp directory, deleted afterwards (checked by the live test).
- **Timeout** (default 180 s, setting) and **Cancel** kill the whole process tree (`taskkill /T /F` on Windows), not just the top process.
- A failure is turned into a message that says what to do: program not found (check the path), timeout (raise it), and for a failed login or quota error the message Claude itself printed in its JSON envelope.
- The result is validated by hand (`parseClaudeOutput`): candidates without an answer are dropped, sources without an `http(s)` URL are dropped, a `verdict` it does not know is ignored, and no candidate left means "Claude did not find an answer".
- The **Test** button of the settings runs `claude --version` in a temp folder.
- `tests/claudeCli.live.test.ts` calls the real CLI. It is off by default: `LACUNA_LIVE=1 npx vitest run tests/claudeCli.live.test.ts` (about 30 s, and it counts against your subscription's usage allowance; set `LACUNA_CLAUDE` to the executable if it is not on the PATH).
