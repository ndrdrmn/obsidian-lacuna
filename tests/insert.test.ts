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

  it("keeps the line breaks of a multi-line selection, a highlight can span lines", () => {
    expect(buildInsertion("a\nb\r\n  c")).toEqual({ text: "==?a\nb\nc==", cursor: 10 });
  });

  it("drops blank lines, which would end the highlight", () => {
    expect(buildInsertion("first\n\n  \nsecond")).toEqual({ text: "==?first\nsecond==", cursor: 17 });
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
    expect(matchTrigger("text ==?")).toEqual({ query: "" });
  });

  it("returns what has been typed of the keyword", () => {
    expect(matchTrigger("text ==?su")).toEqual({ query: "su" });
    expect(matchTrigger("==?Vérif")).toEqual({ query: "Vérif" });
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
    expect(matchTrigger("==?fill: a== and ==?s")).toEqual({ query: "s" });
    expect(matchTrigger("==b== ==?")).toEqual({ query: "" });
  });

  it("does not fire on the closing delimiter of a highlight or marker", () => {
    expect(matchTrigger("==important==?")).toBeNull();
    expect(matchTrigger("==?fill: a==?x")).toBeNull();
  });

  it("does not fire on ===?", () => {
    expect(matchTrigger("===?")).toBeNull();
  });

  describe("over several lines (the prefix is the paragraph up to the cursor)", () => {
    it("fires after a marker that was closed on an earlier line", () => {
      expect(matchTrigger("==?fill: a\nb== and ==?s")).toEqual({ query: "s" });
    });

    it("does not fire on the closing delimiter of a marker opened on an earlier line", () => {
      expect(matchTrigger("==?suppl: foo\nbar ==?")).toBeNull();
      expect(matchTrigger("==?fill: a\nb==?x")).toBeNull();
    });

    it("does not fire on the closing delimiter of a highlight opened on an earlier line", () => {
      expect(matchTrigger("==important\nhere==?")).toBeNull();
    });
  });
});
