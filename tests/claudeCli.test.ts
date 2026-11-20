import { describe, expect, it } from "vitest";
import { ClaudeCliResolver, claudeArgs, claudeSchema, parseClaudeOutput } from "../src/resolvers/claudeCli";
import { ResolverError } from "../src/resolvers/resolver";

/** Trimmed from a real `claude -p --output-format json --json-schema …` run (CLI 2.1.329). */
const REAL = {
  stop_reason: "tool_use",
  total_cost_usd: 0.1039668,
  terminal_reason: "completed",
  is_error: false,
  subtype: "success",
  result:
    '{"verdict":"corrected","candidates":[{"answer":"July 14, 1995 (RTM)","sources":[{"title":"Windows 95 – Wikipedia","url":"https://en.wikipedia.org/wiki/Windows_95","quote":"released to manufacturing on July 14, 1995"}]}]}',
  structured_output: {
    verdict: "corrected",
    candidates: [
      {
        answer: "July 14, 1995 (RTM)",
        sources: [
          {
            title: "Windows 95 – Wikipedia",
            url: "https://en.wikipedia.org/wiki/Windows_95",
            quote: "released to manufacturing on July 14, 1995",
          },
        ],
      },
      {
        answer: "August 24, 1995 (retail)",
        sources: [{ title: "PCjs", url: "https://www.pcjs.org/software/pcx86/sys/windows/win95/4.00.950/" }],
      },
    ],
  },
};

const out = (o: unknown): string => JSON.stringify(o);

describe("claudeArgs", () => {
  const args = claudeArgs("sonnet", 3);

  it("asks for JSON on stdin-fed print mode, with the schema", () => {
    expect(args[0]).toBe("-p");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]);
    expect(schema.properties.candidates.maxItems).toBe(3);
    expect(schema.required).toEqual(["candidates"]);
  });

  it("gives the agent the two web tools and nothing else", () => {
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
  });

  it("does not save the session, and never uses --bare (it would disable the subscription login)", () => {
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--bare");
  });

  it("passes the model, and the prompt is not an argument", () => {
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(claudeArgs("opus", 1)[claudeArgs("opus", 1).indexOf("--model") + 1]).toBe("opus");
  });

  it("limits the candidates in the schema", () => {
    expect((claudeSchema(1) as { properties: { candidates: { maxItems: number } } }).properties.candidates.maxItems).toBe(1);
  });
});

describe("parseClaudeOutput", () => {
  it("reads structured_output", () => {
    const r = parseClaudeOutput(out(REAL), "sonnet");
    expect(r.resolver).toBe("claude-cli/sonnet");
    expect(r.verdict).toBe("corrected");
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]).toEqual({
      answer: "July 14, 1995 (RTM)",
      sources: [
        {
          title: "Windows 95 – Wikipedia",
          url: "https://en.wikipedia.org/wiki/Windows_95",
          quote: "released to manufacturing on July 14, 1995",
        },
      ],
    });
    expect(r.candidates[1].sources[0].quote).toBeUndefined();
  });

  it("falls back to the result string", () => {
    const { structured_output: _unused, ...withoutStructured } = REAL;
    const r = parseClaudeOutput(out(withoutStructured), "opus");
    expect(r.resolver).toBe("claude-cli/opus");
    expect(r.candidates).toHaveLength(1);
  });

  it("reports an error envelope, with Claude's own words", () => {
    const e = () => parseClaudeOutput(out({ is_error: true, result: "Not logged in · Please run /login" }), "sonnet");
    expect(e).toThrow(ResolverError);
    expect(e).toThrow(/Not logged in/);
  });

  it("rejects output that is not JSON or has the wrong shape", () => {
    expect(() => parseClaudeOutput("not json", "sonnet")).toThrow(/valid JSON/);
    expect(() => parseClaudeOutput(out({ is_error: false }), "sonnet")).toThrow(/expected shape/);
    expect(() => parseClaudeOutput(out({ structured_output: { candidates: "x" } }), "sonnet")).toThrow(/expected shape/);
  });

  it("reports an empty list of candidates as no answer", () => {
    expect(() => parseClaudeOutput(out({ structured_output: { candidates: [] } }), "sonnet")).toThrow(/did not find/);
  });

  it("drops candidates without an answer, and sources without a web link", () => {
    const r = parseClaudeOutput(
      out({
        structured_output: {
          candidates: [
            { answer: "  ", sources: [] },
            { answer: 42, sources: [] },
            {
              answer: " ok ",
              sources: [
                { title: "bad", url: "javascript:alert(1)" },
                { title: "file", url: "file:///etc/passwd" },
                { title: "", url: " https://example.com/x " },
                { title: "no url" },
                "junk",
              ],
            },
          ],
        },
      }),
      "sonnet",
    );
    expect(r.candidates).toEqual([{ answer: "ok", sources: [{ title: "https://example.com/x", url: "https://example.com/x" }] }]);
  });

  it("ignores a verdict it does not know", () => {
    const r = parseClaudeOutput(out({ structured_output: { verdict: "maybe", candidates: [{ answer: "a", sources: [] }] } }), "s");
    expect(r.verdict).toBeUndefined();
  });
});

describe("ClaudeCliResolver (failures that need no Claude)", () => {
  const options = (executable: string) => () => ({ executable, model: "sonnet", timeoutSec: 5, maxCandidates: 3 });
  const request = { kind: "suppl" as const, prompt: "hi", question: "q", inline: true };

  it("says where to look when the program is not found", async () => {
    const r = new ClaudeCliResolver(options("lacuna-no-such-program-xyz"));
    await expect(r.solve(request, new AbortController().signal)).rejects.toThrow(/Could not start .*settings/);
  });

  it("refuses a .cmd shim, which cannot be started without a shell", async () => {
    const r = new ClaudeCliResolver(options("C:\\tools\\claude.cmd"));
    await expect(r.solve(request, new AbortController().signal)).rejects.toThrow(/claude\.exe/);
  });

  it("rejects when already cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const r = new ClaudeCliResolver(options(process.execPath));
    await expect(r.solve(request, abort.signal)).rejects.toThrow(/Cancelled/);
  });
});
