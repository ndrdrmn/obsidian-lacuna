import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { extractContext } from "../src/context";
import { buildPrompt } from "../src/prompt";
import { ClaudeCliResolver, testClaude } from "../src/resolvers/claudeCli";

/**
 * Calls the real Claude CLI: it takes about half a minute and uses the subscription.
 * Off by default. Run it with:  LACUNA_LIVE=1 npx vitest run tests/claudeCli.live.test.ts
 */
describe.skipIf(!process.env.LACUNA_LIVE)("Claude CLI, for real", () => {
  const executable = process.env.LACUNA_CLAUDE ?? "claude";

  it("starts, and reports its version", async () => {
    expect(await testClaude(executable)).toMatch(/Claude Code/);
  });

  it("answers a suppl question with web sources, and leaves no temp folder behind", async () => {
    const text = "Windows 95 was released by Microsoft on ==?suppl: exact release date (RTM)== in 1995.";
    const start = text.indexOf("==?");
    const marker = "==?suppl: exact release date (RTM)==";
    const context = extractContext(text, { start, end: start + marker.length }, "paragraph");
    const prompt = buildPrompt({
      kind: "suppl",
      question: "exact release date (RTM)",
      noteTitle: "Windows 95",
      context,
      inline: true,
      rejected: [],
      maxCandidates: 2,
    });

    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith("lacuna-")));
    const resolver = new ClaudeCliResolver(() => ({ executable, model: "sonnet", timeoutSec: 180, maxCandidates: 2 }));
    const result = await resolver.solve({ kind: "suppl", prompt, question: "exact release date (RTM)", inline: true }, new AbortController().signal);

    console.log(JSON.stringify(result, null, 2));
    expect(result.resolver).toBe("claude-cli/sonnet");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(2);
    for (const c of result.candidates) {
      expect(c.answer.length).toBeGreaterThan(0);
      expect(c.answer).not.toContain("\n"); // the prompt asked for a single line
      for (const s of c.sources) expect(s.url).toMatch(/^https?:\/\//);
    }
    expect(result.candidates.some((c) => c.sources.length > 0)).toBe(true);

    const after = readdirSync(tmpdir()).filter((n) => n.startsWith("lacuna-") && !before.has(n));
    expect(after).toEqual([]);
  }, 240_000);
});
