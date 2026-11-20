import { describe, expect, it } from "vitest";
import { buildAliasMap } from "../src/lang/keywords";
import type { Kind } from "../src/lang/packs";
import { formatAlias, frontmatterLength, maskNonProse, parseMarkers } from "../src/marker";

function parse(text: string, langs = ["la", "en", "it"], defaultKind: Kind | null = "suppl", idiolect = {}) {
  return parseMarkers(text, { aliasMap: buildAliasMap(langs, idiolect), defaultKind });
}

describe("parseMarkers: grammar", () => {
  it("parses a Latin keyword with its question, offsets and position", () => {
    const text = "Windows 95 was released on ==?suppl: exact date==.";
    const [m, ...rest] = parse(text);
    expect(rest).toHaveLength(0);
    expect(m).toMatchObject({
      kind: "suppl",
      question: "exact date",
      raw: "==?suppl: exact date==",
      line: 0,
      ch: 27,
    });
    expect(m.alias).toBeUndefined();
    expect(text.slice(m.start, m.end)).toBe(m.raw);
  });

  it("records the typed word and pack for a non-Latin keyword", () => {
    const [m] = parse("x ==?Verifica: the year==");
    expect(m.kind).toBe("sic");
    expect(m.alias).toEqual({ word: "Verifica", packId: "it" });
    expect(formatAlias(m.alias!)).toBe("Verifica (it)");
    const [e] = parse("x ==?check: the year==");
    expect(e.alias).toEqual({ word: "check", packId: "en" });
  });

  it("finds two markers on one line", () => {
    const ms = parse("==?fill: a== and ==?find: b==");
    expect(ms.map((m) => [m.kind, m.question])).toEqual([
      ["suppl", "a"],
      ["fontes", "b"],
    ]);
    expect(ms[1].ch).toBe(17);
  });

  it("ignores plain highlights", () => {
    expect(parse("a ==plain== highlight")).toEqual([]);
  });

  it("does not mistake the closing delimiter of a highlight followed by ? for a marker", () => {
    expect(parse("Is it ==important==? Yes ==really==.")).toEqual([]);
  });

  it("keeps a colon inside the question", () => {
    const [m] = parse("==?suppl: date: exact==");
    expect(m.question).toBe("date: exact");
  });

  it("allows an empty question (a freshly inserted marker)", () => {
    expect(parse("==? ==")[0]).toMatchObject({ kind: "suppl", question: "" });
    expect(parse("==?sic:==")[0]).toMatchObject({ kind: "sic", question: "" });
  });
});

describe("parseMarkers: default kind and unknown keywords", () => {
  it("uses the default kind when there is no keyword", () => {
    expect(parse("==?release date==", ["la"], "glossa")[0]).toMatchObject({ kind: "glossa", question: "release date" });
  });

  it("treats the whole text as the question when the keyword is unknown", () => {
    const [m] = parse("==?foo: bar==");
    expect(m).toMatchObject({ kind: "suppl", question: "foo: bar" });
    expect(m.alias).toBeUndefined();
  });

  it("treats text before a colon as a question when it is more than one word", () => {
    expect(parse("==?release date: 1995==")[0].question).toBe("release date: 1995");
  });

  it("ignores such markers entirely when the default kind is None", () => {
    expect(parse("==?release date==", ["la"], null)).toEqual([]);
    expect(parse("==?foo: bar==", ["la"], null)).toEqual([]);
    expect(parse("==? ==", ["la"], null)).toEqual([]);
    // ...but a marker with a known keyword still counts.
    expect(parse("==?suppl: x==", ["la"], null)).toHaveLength(1);
  });

  it("treats a keyword of a disabled pack as unknown", () => {
    const [m] = parse("==?fill: x==", ["la"]);
    expect(m.question).toBe("fill: x");
    expect(parse("==?fill: x==", ["la"], null)).toEqual([]);
  });

  it("works with no Latin at all", () => {
    expect(parse("==?verifica: x==", ["it"], null)[0].kind).toBe("sic");
    expect(parse("==?sic: x==", ["it"], null)).toEqual([]);
  });

  it("is case and accent insensitive", () => {
    const fr = (t: string) => parse(t, ["fr"], null)[0];
    expect(fr("==?Vérifier: x==").kind).toBe("sic");
    expect(fr("==?verifier: x==").kind).toBe("sic");
    expect(fr("==?COMPLÉTER: x==").kind).toBe("suppl");
  });

  it("uses the Idiolect when it is enabled", () => {
    const ms = parse("==?gap: x==", ["la", "idiolect"], null, { suppl: "gap" });
    expect(ms[0]).toMatchObject({ kind: "suppl", alias: { word: "gap", packId: "idiolect" } });
  });
});

describe("parseMarkers: code and frontmatter", () => {
  it("skips fenced code blocks", () => {
    const text = "before\n```\n==?suppl: in code==\n```\nafter ==?suppl: real==";
    const ms = parse(text);
    expect(ms.map((m) => m.question)).toEqual(["real"]);
    expect(ms[0].line).toBe(4);
  });

  it("skips ~~~ fences and longer fences", () => {
    expect(parse("~~~\n==?a==\n~~~")).toEqual([]);
    expect(parse("````\n```\n==?a==\n```\n````")).toEqual([]);
  });

  it("treats an unclosed fence as running to the end of the note", () => {
    expect(parse("text\n```js\n==?a==\nmore")).toEqual([]);
  });

  it("skips inline code, single and double backtick", () => {
    expect(parse("use `==?suppl: x==` here")).toEqual([]);
    expect(parse("use ``==?suppl: `x` y==`` here")).toEqual([]);
  });

  it("does not treat a lone backtick as code", () => {
    expect(parse("a ` b ==?suppl: x==")).toHaveLength(1);
  });

  it("does not let inline code cross a blank line", () => {
    expect(parse("a ` b\n\n==?suppl: x== `")).toHaveLength(1);
  });

  it("keeps a marker that contains inline code with ==", () => {
    const [m] = parse("==?cf: `a==b` versus c==");
    expect(m.question).toBe("`a==b` versus c");
  });

  it("skips the YAML frontmatter, where history notes quote their marker", () => {
    const text = '---\nmarker: "==?suppl: quoted=="\n---\nbody ==?suppl: real==';
    const ms = parse(text);
    expect(ms.map((m) => m.question)).toEqual(["real"]);
    expect(ms[0].line).toBe(3);
  });

  it("does not take a horizontal rule at the top for frontmatter without a closing line", () => {
    expect(parse("---\n==?suppl: x==")).toHaveLength(1);
  });
});

describe("parseMarkers: positions", () => {
  it("reports line and ch on several lines", () => {
    const ms = parse("one\ntwo ==?suppl: a==\n\nthree ==?sic: b==");
    expect(ms.map((m) => [m.line, m.ch])).toEqual([
      [1, 4],
      [3, 6],
    ]);
  });

  it("handles CRLF line endings", () => {
    const text = "one\r\ntwo ==?suppl: a==\r\nthree ==?sic: b==\r\n";
    const ms = parse(text);
    expect(ms).toHaveLength(2);
    expect(ms[0].question).toBe("a");
    for (const m of ms) expect(text.slice(m.start, m.end)).toBe(m.raw);
    expect(ms[1].line).toBe(2);
  });

  it("copes with astral characters before the marker", () => {
    const text = "😀 ==?suppl: x==";
    const [m] = parse(text);
    expect(text.slice(m.start, m.end)).toBe("==?suppl: x==");
  });
});

describe("maskNonProse / frontmatterLength", () => {
  it("keeps the length and the newlines", () => {
    const text = "---\na: b\n---\ntext `code` more\n```\nfenced\n```\nend";
    const masked = maskNonProse(text);
    expect(masked).toHaveLength(text.length);
    expect(masked.split("\n").length).toBe(text.split("\n").length);
    expect(masked).not.toContain("code");
    expect(masked).not.toContain("fenced");
    expect(masked).toContain("text");
    expect(masked).toContain("end");
  });

  it("measures the frontmatter", () => {
    expect(frontmatterLength("---\na: 1\n---\nbody")).toBe("---\na: 1\n---\n".length);
    expect(frontmatterLength("---\n---\nbody")).toBe("---\n---\n".length);
    expect(frontmatterLength("no frontmatter")).toBe(0);
  });
});
