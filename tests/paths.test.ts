import { describe, expect, it } from "vitest";
import { cleanFolderName, isHistoryPath } from "../src/paths";

describe("cleanFolderName", () => {
  it("trims and normalises slashes", () => {
    expect(cleanFolderName("  Apparatus/ ")).toBe("Apparatus");
    expect(cleanFolderName("\\Research\\Apparatus\\")).toBe("Research/Apparatus");
    expect(cleanFolderName("a//b")).toBe("a/b");
  });

  it("rejects an empty name and names that climb", () => {
    expect(cleanFolderName("")).toBe("");
    expect(cleanFolderName("  / ")).toBe("");
    expect(cleanFolderName("../outside")).toBe("");
    expect(cleanFolderName("a/../b")).toBe("");
    expect(cleanFolderName(".")).toBe("");
  });
});

describe("isHistoryPath", () => {
  it("matches a note inside the folder, at any depth", () => {
    expect(isHistoryPath("Apparatus/2026 note.md", "Apparatus")).toBe(true);
    expect(isHistoryPath("Apparatus/sub/note.md", "Apparatus")).toBe(true);
  });

  it("matches the folder next to the article, wherever it is", () => {
    expect(isHistoryPath("Articles/Apparatus/note.md", "Apparatus")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isHistoryPath("apparatus/note.md", "Apparatus")).toBe(true);
  });

  it("does not match a file called like the folder, or a longer folder name", () => {
    expect(isHistoryPath("Apparatus.md", "Apparatus")).toBe(false);
    expect(isHistoryPath("Notes/Apparatus.md", "Apparatus")).toBe(false);
    expect(isHistoryPath("Apparatus notes/a.md", "Apparatus")).toBe(false);
    expect(isHistoryPath("My Apparatus/a.md", "Apparatus")).toBe(false);
  });

  it("supports a folder name made of several segments", () => {
    expect(isHistoryPath("Research/Apparatus/a.md", "Research/Apparatus")).toBe(true);
    expect(isHistoryPath("Apparatus/Research/a.md", "Research/Apparatus")).toBe(false);
    expect(isHistoryPath("X/Research/Apparatus/a.md", "Research/Apparatus")).toBe(true);
  });

  it("matches nothing for an empty folder name", () => {
    expect(isHistoryPath("Apparatus/a.md", "")).toBe(false);
  });
});
