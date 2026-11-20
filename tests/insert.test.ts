import { describe, expect, it } from "vitest";
import { buildInsertion, matchTrigger } from "../src/insert";

describe("buildInsertion", () => {
  it("inserts an empty marker with the cursor inside", () => {
    expect(buildInsertion("")).toEqual({ text: "==? ==", cursor: 4 });
  });

  it("inserts the keyword when one is given, cursor after it", () => {
    expect(buildInsertion("", "suppl")).toEqual({ text: "==?suppl: ==", cursor: 10 });
    const r = buildInsertion("", "verifica");
    expect("text" in r && r.text.slice(0, "cursor" in r ? r.cursor : 0)).toBe("==?verifica: ");
  });

  it("wraps a selection: it becomes the question, cursor after the marker", () => {
    expect(buildInsertion("release date")).toEqual({ text: "==?release date==", cursor: 17 });
    expect(buildInsertion("release date", "sic")).toEqual({ text: "==?sic: release date==", cursor: 22 });
  });

  it("puts a multi-line selection on one line", () => {
    expect(buildInsertion("a\nb\r\n  c")).toEqual({ text: "==?a b c==", cursor: 10 });
  });

  it("treats a blank selection as no selection", () => {
    expect(buildInsertion("  \n ")).toEqual({ text: "==? ==", cursor: 4 });
  });

  it("refuses a selection containing ==", () => {
    expect(buildInsertion("a == b")).toHaveProperty("error");
  });
});

describe("matchTrigger", () => {
  it("fires right after ==?", () => {
    expect(matchTrigger("text ==?")).toEqual({ start: 8, query: "" });
  });

  it("returns what has been typed of the keyword", () => {
    expect(matchTrigger("text ==?su")).toEqual({ start: 8, query: "su" });
    expect(matchTrigger("==?Vérif")).toEqual({ start: 3, query: "Vérif" });
  });

  it("stops at a space or a colon, so a typed question closes the popup", () => {
    expect(matchTrigger("==?release date")).toBeNull();
    expect(matchTrigger("==?suppl:")).toBeNull();
    expect(matchTrigger("==?suppl: ")).toBeNull();
  });

  it("ignores text without ==?", () => {
    expect(matchTrigger("plain text")).toBeNull();
    expect(matchTrigger("==plain")).toBeNull();
    expect(matchTrigger("what?")).toBeNull();
  });

  it("works after a complete marker or highlight on the same line", () => {
    expect(matchTrigger("==?fill: a== and ==?s")).toEqual({ start: 20, query: "s" });
    expect(matchTrigger("==b== ==?")).toEqual({ start: 9, query: "" });
  });

  it("does not fire on the closing delimiter of a highlight or marker", () => {
    expect(matchTrigger("==important==?")).toBeNull();
    expect(matchTrigger("==?fill: a==?x")).toBeNull();
  });

  it("does not fire on ===?", () => {
    expect(matchTrigger("===?")).toBeNull();
  });
});
