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
- `total_cost_usd`, `duration_api_ms`, `usage`: informational. The call is billed to the subscription, but the CLI still reports a list-price cost.

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
