import { describe, expect, it } from "vitest";
import { buildPrompt, GAP, type PromptRequest } from "../src/prompt";

const TEXT = "Windows 95 was released on ==?suppl: exact date== by Microsoft.";
const MARKER = "==?suppl: exact date==";

function req(over: Partial<PromptRequest> = {}): PromptRequest {
  const markerStart = TEXT.indexOf(MARKER);
  return {
    kind: "suppl",
    question: "exact date",
    noteTitle: "Windows 95",
    context: { text: TEXT, markerStart, markerEnd: markerStart + MARKER.length },
    inline: true,
    rejected: [],
    maxCandidates: 3,
    ...over,
  };
}

describe("buildPrompt", () => {
  it("puts the title, the question and the passage with the marker replaced by a gap", () => {
    const p = buildPrompt(req());
    expect(p).toContain("Note title: Windows 95");
    expect(p).toContain("Question: exact date");
    expect(p).toContain(`Windows 95 was released on ${GAP} by Microsoft.`);
    expect(p).not.toContain("==?");
  });

  it("states the language rule", () => {
    expect(buildPrompt(req())).toMatch(/language of the passage/);
  });

  it("asks for one-line answers for an inline marker and allows blocks otherwise", () => {
    expect(buildPrompt(req({ inline: true }))).toMatch(/single line of plain text/);
    expect(buildPrompt(req({ inline: false }))).toMatch(/Markdown table/);
  });

  it("lists rejected answers on a retry, and only then", () => {
    expect(buildPrompt(req())).not.toMatch(/rejected/);
    const p = buildPrompt(req({ rejected: ["July 1995", "August 1995"] }));
    expect(p).toContain("- July 1995");
    expect(p).toContain("- August 1995");
    expect(p).toMatch(/already rejected/);
  });

  it("limits the number of candidates", () => {
    expect(buildPrompt(req({ maxCandidates: 1 }))).toContain("at most 1 candidate,");
    expect(buildPrompt(req({ maxCandidates: 3 }))).toContain("at most 3 candidates,");
  });

  it("tells the agent that verdict is only for sic", () => {
    expect(buildPrompt(req())).toMatch(/only for the kind "sic"/);
  });

  it("includes the claim for sic", () => {
    const p = buildPrompt(req({ kind: "sic", claim: "Windows 95 was released in 1995" }));
    expect(p).toContain('"Windows 95 was released in 1995"');
    expect(p).toMatch(/confirmed/);
    expect(p).toMatch(/actually:/);
  });

  it("copes with a sic marker that has no claim before it", () => {
    expect(buildPrompt(req({ kind: "sic" }))).toMatch(/not directly before the gap/);
  });

  it("has a different task for each kind", () => {
    const tasks = (["suppl", "sic", "fontes", "glossa", "cf"] as const).map((kind) =>
      buildPrompt(req({ kind })).split("\n\n").find((s) => s.startsWith("Task")),
    );
    expect(new Set(tasks).size).toBe(5);
  });

  it("says so when no question was given", () => {
    expect(buildPrompt(req({ question: "" }))).toContain("Question: (none given)");
  });
});
