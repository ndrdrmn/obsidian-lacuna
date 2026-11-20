import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessError, runProcess } from "../process";
import {
  ResolverError,
  type Candidate,
  type Resolver,
  type SolveRequest,
  type SolveResult,
  type Source,
  type Verdict,
} from "./resolver";

export interface ClaudeCliOptions {
  /** `claude`, or the full path to `claude.exe`. */
  executable: string;
  model: string;
  timeoutSec: number;
  maxCandidates: number;
}

/** The only tools the agent gets: it can search and read the web, nothing else. */
const TOOLS = "WebSearch,WebFetch";

export function claudeSchema(maxCandidates: number): object {
  return {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["confirmed", "corrected", "uncertain"] },
      candidates: {
        type: "array",
        maxItems: maxCandidates,
        items: {
          type: "object",
          properties: {
            answer: { type: "string" },
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: { title: { type: "string" }, url: { type: "string" }, quote: { type: "string" } },
                required: ["title", "url"],
              },
            },
          },
          required: ["answer", "sources"],
        },
      },
    },
    required: ["candidates"],
  };
}

/**
 * Never add `--bare`: it turns off the OAuth login, so the subscription would not be used.
 * The prompt goes through stdin, not the arguments.
 */
export function claudeArgs(model: string, maxCandidates: number): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(claudeSchema(maxCandidates)),
    "--tools",
    TOOLS,
    "--no-session-persistence",
    "--model",
    model,
  ];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toSource(v: unknown): Source | null {
  if (!isRecord(v)) return null;
  const { title, url, quote } = v;
  // Only web links: the url ends up in a note, and `javascript:` or `file:` have no place there.
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return null;
  return {
    title: typeof title === "string" && title.trim() !== "" ? title.trim() : url.trim(),
    url: url.trim(),
    quote: typeof quote === "string" && quote.trim() !== "" ? quote.trim() : undefined,
  };
}

function toCandidate(v: unknown): Candidate | null {
  if (!isRecord(v) || typeof v.answer !== "string" || v.answer.trim() === "") return null;
  const sources = Array.isArray(v.sources) ? v.sources.map(toSource).filter((s): s is Source => s !== null) : [];
  return { answer: v.answer.trim(), sources };
}

/**
 * Read what `claude -p --output-format json` printed.
 * The result is in `structured_output` (confirmed with CLI 2.1.329); the same JSON is also
 * in `result` as a string, which is the fallback.
 */
export function parseClaudeOutput(stdout: string, model: string): SolveResult {
  const envelope = tryParse(stdout.trim());
  if (!isRecord(envelope)) throw new ResolverError("Claude's answer was not valid JSON.");

  if (envelope.is_error === true) {
    const why = typeof envelope.result === "string" && envelope.result !== "" ? envelope.result : "unknown error";
    throw new ResolverError(`Claude reported an error: ${why}`);
  }

  const payload = envelope.structured_output ?? (typeof envelope.result === "string" ? tryParse(envelope.result) : undefined);
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new ResolverError("Claude's answer did not have the expected shape.");
  }
  const candidates = payload.candidates.map(toCandidate).filter((c): c is Candidate => c !== null);
  if (candidates.length === 0) throw new ResolverError("Claude did not find an answer.");

  const verdicts: readonly unknown[] = ["confirmed", "corrected", "uncertain"];
  const verdict = verdicts.includes(payload.verdict) ? (payload.verdict as Verdict) : undefined;
  return { resolver: `claude-cli/${model}`, verdict, candidates };
}

function checkRunnable(executable: string): void {
  if (/\.(cmd|bat)$/i.test(executable)) {
    throw new ResolverError(
      "A .cmd or .bat shim cannot be started directly. Point the setting to claude.exe instead.",
    );
  }
}

/** Turn a process failure into a message that says what to do. */
function explain(e: unknown, o: ClaudeCliOptions): Error {
  if (!(e instanceof ProcessError)) return e instanceof Error ? e : new Error(String(e));
  switch (e.reason) {
    case "not-found":
      return new ResolverError(`Could not start "${o.executable}". Check the Claude CLI path in Lacuna's settings.`);
    case "timeout":
      return new ResolverError(
        `Claude did not answer within ${o.timeoutSec} s. Try again, or raise the timeout in Lacuna's settings.`,
      );
    case "aborted":
      return e;
    default: {
      // A failed login or quota error still prints a JSON envelope on stdout.
      const envelope = tryParse(e.stdout.trim());
      const detail =
        isRecord(envelope) && typeof envelope.result === "string" && envelope.result !== ""
          ? envelope.result
          : e.stderr.trim().split("\n").slice(-3).join(" ") || e.message;
      return new ResolverError(`Claude CLI failed: ${detail}`);
    }
  }
}

/**
 * Asks the user's own Claude Code CLI, so it runs on their subscription.
 *
 * Privacy: the agent starts in an empty temporary folder and may only use WebSearch and
 * WebFetch, so it cannot read the vault. Only the prompt leaves the machine.
 */
export class ClaudeCliResolver implements Resolver {
  readonly id = "claude-cli";
  readonly name = "Claude (CLI)";

  constructor(private readonly options: () => ClaudeCliOptions) {}

  async solve(request: SolveRequest, signal: AbortSignal): Promise<SolveResult> {
    const o = this.options();
    checkRunnable(o.executable);
    const cwd = await mkdtemp(join(tmpdir(), "lacuna-"));
    try {
      const { stdout } = await runProcess(o.executable, claudeArgs(o.model, o.maxCandidates), {
        cwd,
        timeoutMs: o.timeoutSec * 1000,
        signal,
        input: request.prompt,
      });
      return parseClaudeOutput(stdout, o.model);
    } catch (e) {
      throw explain(e, o);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** The "Test" button of the settings: does the executable start, and which version is it? */
export async function testClaude(executable: string): Promise<string> {
  checkRunnable(executable);
  const cwd = await mkdtemp(join(tmpdir(), "lacuna-"));
  try {
    const { stdout } = await runProcess(executable, ["--version"], { cwd, timeoutMs: 15_000 });
    return stdout.trim();
  } catch (e) {
    throw explain(e, { executable, model: "", timeoutSec: 15, maxCandidates: 0 });
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}
