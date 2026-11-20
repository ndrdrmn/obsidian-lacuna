import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../src/history-note";
import { itemState } from "../src/status";

const entry = (status: HistoryEntry["status"]): HistoryEntry => ({
  path: "Apparatus/n.md",
  status,
  marker: "==?x==",
  articlePath: "a.md",
  asked: "",
});

describe("itemState", () => {
  it("is idle with neither a job nor a history note", () => {
    expect(itemState(undefined, undefined)).toEqual({ state: "idle" });
  });

  it("follows the job while it is queued, running or failed", () => {
    expect(itemState({ status: "queued" }, undefined)).toEqual({ state: "queued" });
    expect(itemState({ status: "searching" }, entry("pending"))).toEqual({ state: "searching" });
    expect(itemState({ status: "failed", error: "nope" }, undefined)).toEqual({ state: "failed", error: "nope" });
    expect(itemState({ status: "failed" }, undefined)).toMatchObject({ state: "failed" });
  });

  it("is ready, with the note, when the job produced one", () => {
    expect(itemState({ status: "ready", result: "Apparatus/x.md" }, undefined)).toEqual({
      state: "ready",
      notePath: "Apparatus/x.md",
    });
  });

  it("falls back to the history note found in the vault (after a restart)", () => {
    expect(itemState(undefined, entry("pending"))).toEqual({ state: "ready", notePath: "Apparatus/n.md" });
    expect(itemState(undefined, entry("rejected"))).toEqual({ state: "rejected", notePath: "Apparatus/n.md" });
    expect(itemState(undefined, entry("resolved"))).toEqual({ state: "idle" });
  });
});
