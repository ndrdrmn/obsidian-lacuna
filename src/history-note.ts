import { KINDS, type Kind } from "./lang/packs";
import { formatAlias, frontmatterLength } from "./marker";
import type { Candidate, Source, Verdict } from "./resolvers/resolver";

export type HistoryStatus = "pending" | "resolved" | "rejected";

export function isHistoryStatus(v: unknown): v is HistoryStatus {
  return v === "pending" || v === "resolved" || v === "rejected";
}

export interface HistoryNoteInput {
  /** The number of the note, unique in the vault: one more than the highest there is (`nextHistoryId`). */
  id: number;
  kind: Kind;
  alias?: { word: string; packId: string };
  /** The first line of the note, and the basis of its file name. */
  title: string;
  question: string;
  /** A link to the article, as `app.fileManager.generateMarkdownLink` built it. */
  articleLink: string;
  /** The marker text exactly as it is in the article. */
  marker: string;
  asked: Date;
  resolver: string;
  verdict?: Verdict;
  /** The passage around the marker, marker included, as the search got it or as it stood when asked. */
  context: string;
  /** True when `context` was sent to a search; false for "Answer myself", where nothing leaves the machine. */
  contextSent: boolean;
  candidates: Candidate[];
}

/** The number in a history note's file name, `Lacuna 122 — Windows 95 — question`, or null for any other name. */
export function historyNumberOfName(basename: string): number | null {
  const m = /^Lacuna (\d+) — /.exec(basename);
  return m ? Number(m[1]) : null;
}

/** The number for the next history note: one more than the largest of those known (null: no number). */
export function nextHistoryId(known: Iterable<number | null>): number {
  let max = 0;
  for (const n of known) if (n !== null && Number.isFinite(n) && n > max) max = Math.floor(n);
  return max + 1;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `2026-11-20T16:40`, local time. */
export function formatLocalDateTime(d: Date): string {
  return `${formatLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The editor always uses "\n", a file may use "\r\n": compare markers with this. */
export function normalizeMarker(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

/** Identifies one marker of one note, for the queue. */
export function jobKey(articlePath: string, markerRaw: string): string {
  return `${articlePath}\u0000${normalizeMarker(markerRaw)}`;
}

/** Characters a file name cannot hold on some platform, or that break Obsidian links. */
function sanitize(text: string, max: number): string {
  const cleaned = text
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned.replace(/[. ]+$/, "");
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[. ]+$/, "");
}

/** `Lacuna 122 — Windows 95 — exact release date` (without the extension). The date is in the properties. */
export function historyFileName(id: number, article: string, title: string): string {
  const slug = sanitize(title, 60) || "lacuna";
  return `Lacuna ${id} — ${sanitize(article, 40) || "note"} — ${slug}`;
}

/** A double-quoted YAML scalar. JSON strings are valid YAML, line breaks included. */
function yaml(value: string): string {
  return JSON.stringify(value);
}

function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

function sourceLine(s: Source): string {
  // A source without a link is a reference the user wrote down: keep it as plain text.
  if (!s.url) return `- ${s.title.replace(/\s+/g, " ").trim()}`;
  const title = s.title.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ");
  const url = s.url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  const quote = s.quote ? ` — “${s.quote.replace(/\s+/g, " ")}”` : "";
  return `- [${title}](${url})${quote}`;
}

/**
 * The history note, as it is written when the answers come in: status `pending`,
 * candidates in the body. Step 6 reads it back to review it and to record the choice.
 *
 * Each candidate is a `## Candidate N` section: the answer, then (after a blank line)
 * its sources as a list of links. An answer must not contain a `#` heading.
 */
export function buildHistoryNote(i: HistoryNoteInput): string {
  const front = [
    "---",
    "lacuna: pending",
    `id: ${i.id}`,
    `kind: ${i.kind}`,
    ...(i.alias ? [`alias: ${yaml(formatAlias(i.alias))}`] : []),
    `question: ${yaml(i.question)}`,
    `article: ${yaml(i.articleLink)}`,
    // Empty until the answer is accepted. Written now so that it sits next to `article` (what article,
    // what anchor), where the update finds it and fills it in without moving it.
    "at:",
    `marker: ${yaml(normalizeMarker(i.marker))}`,
    `asked: ${formatLocalDateTime(i.asked)}`,
    `resolver: ${i.resolver}`,
    ...(i.verdict ? [`verdict: ${i.verdict}`] : []),
    "answer:",
    "answered:",
    "---",
  ].join("\n");

  const parts = [front, `# Lacuna ${i.id} · ${i.title}`];
  if (i.context.trim() !== "") {
    const what = i.contextSent ? "Context sent to the search:" : "Context:";
    parts.push(`> ${what}\n>\n${quoteBlock(normalizeMarker(i.context))}`);
  }
  i.candidates.forEach((c, n) => {
    const section = [`## Candidate ${n + 1}`, c.answer.trim()];
    if (c.sources.length > 0) section.push("", c.sources.map(sourceLine).join("\n"));
    parts.push(section.join("\n"));
  });
  return `${parts.join("\n\n")}\n`;
}

/**
 * Once the answer is in the article, say where, under the title:
 * `Answered at [[Windows 95#^adloc-1|ad loc.]] — “…under the codename Chicago and went on…”`.
 * `link` is built with `generateMarkdownLink`. The excerpt says which lacuna of a paragraph this was.
 * The note is returned as it is when it has no title.
 */
export function addAnsweredAt(noteText: string, link: string, excerpt = ""): string {
  const off = frontmatterLength(noteText);
  const m = /^# .*$/m.exec(noteText.slice(off));
  if (!m) return noteText;
  const at = off + m.index + m[0].length;
  const quote = excerpt === "" ? "" : ` — “${excerpt}”`;
  return `${noteText.slice(0, at)}\n\nAnswered at ${link}${quote}${noteText.slice(at)}`;
}

/** What is known of a history note without reading its body (from the metadata cache). */
export interface HistoryEntry {
  path: string;
  /** The number in the `id` property. */
  id: number | null;
  status: HistoryStatus;
  /** The `marker` property. */
  marker: string;
  /** The note the `article` property points to, if it resolves. */
  articlePath: string | null;
  asked: string;
  /** The `kind` and `question` properties, to say what an orphan was about without opening it. */
  kind?: Kind;
  question?: string;
}

/** Every note of one status that belongs to a marker (same article, same marker text), oldest first. */
export function matchHistoryAll(
  entries: readonly HistoryEntry[],
  articlePath: string,
  markerRaw: string,
  status: HistoryStatus,
): HistoryEntry[] {
  const wanted = normalizeMarker(markerRaw);
  return entries
    .filter((e) => e.status === status && e.articlePath === articlePath && normalizeMarker(e.marker) === wanted)
    .sort((a, b) => (a.asked < b.asked ? -1 : a.asked > b.asked ? 1 : (a.id ?? 0) - (b.id ?? 0)));
}

// ---- Reading a note back ---------------------------------------------------

/** The frontmatter (without its fences) and the rest of a note. */
export function splitFrontmatter(text: string): { yaml: string; body: string } {
  const m = /^---[ \t]*\r?\n((?:[\s\S]*?\r?\n)?)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { yaml: m[1], body: text.slice(m[0].length) } : { yaml: "", body: text };
}

/** `- [title](url)` with an optional ` — “quote”`: what `sourceLine` writes for a source with a link. */
const SOURCE_LINE = /^- \[(.*?)\]\((\S*)\)(?: — “(.*)”)?$/;

/**
 * The candidates of a note body, as `buildHistoryNote` wrote them: a section for each exact
 * line `## Candidate N`; in it the sources are the trailing lines shaped like `SOURCE_LINE`, after
 * a blank line, and the answer is everything before. (An answer that itself ends in such a list
 * after a blank line loses it to the sources: rare, and harmless to review.)
 */
export function parseCandidates(body: string): Candidate[] {
  const sections = body.replace(/\r\n/g, "\n").split(/^## Candidate \d+[ \t]*$/m).slice(1);
  const out: Candidate[] = [];
  for (const section of sections) {
    const lines = section.trim().split("\n");
    let first = lines.length;
    while (first > 0 && SOURCE_LINE.test(lines[first - 1])) first--;
    // Only a list that follows a blank line is a list of sources.
    const hasSources = first < lines.length && first > 0 && lines[first - 1].trim() === "";
    const answer = (hasSources ? lines.slice(0, first) : lines).join("\n").trim();
    if (answer === "") continue;
    const sources: Source[] = [];
    if (hasSources) {
      for (const line of lines.slice(first)) {
        const m = SOURCE_LINE.exec(line);
        if (m) sources.push({ title: m[1], url: m[2], ...(m[3] ? { quote: m[3] } : {}) });
      }
    }
    out.push({ answer, sources });
  }
  return out;
}

/** A history note, read back from its file. */
export interface HistoryData {
  id: number;
  status: HistoryStatus;
  kind: Kind;
  question: string;
  /** The marker text, with `\n` line breaks. */
  marker: string;
  resolver: string;
  verdict?: Verdict;
  candidates: Candidate[];
}

/** The note's properties (parsed YAML) and body as a `HistoryData`, or null if this is not a Lacuna note. */
export function toHistoryData(fm: unknown, body: string): HistoryData | null {
  if (typeof fm !== "object" || fm === null) return null;
  const f = fm as Record<string, unknown>;
  if (!isHistoryStatus(f.lacuna)) return null;
  if (typeof f.id !== "number" || !Number.isInteger(f.id)) return null;
  if (typeof f.kind !== "string" || !(KINDS as readonly string[]).includes(f.kind)) return null;
  if (typeof f.marker !== "string" || f.marker === "") return null;
  const verdict = f.verdict === "confirmed" || f.verdict === "corrected" || f.verdict === "uncertain" ? f.verdict : undefined;
  return {
    id: f.id,
    status: f.lacuna,
    kind: f.kind as Kind,
    question: typeof f.question === "string" ? f.question : "",
    marker: normalizeMarker(f.marker),
    resolver: typeof f.resolver === "string" ? f.resolver : "",
    verdict,
    candidates: parseCandidates(body),
  };
}

/**
 * The answers to tell a search not to repeat, from the candidates of rejected notes, oldest
 * note first: each on one line and cut short, and only the most recent `max`.
 */
export function rejectedAnswers(notes: readonly (readonly Candidate[])[], max = 12, maxLen = 300): string[] {
  const all = notes.flatMap((candidates) => candidates.map((c) => c.answer.replace(/\s+/g, " ").trim()));
  return all
    .filter((a) => a !== "")
    .slice(-max)
    .map((a) => (a.length > maxLen ? `${a.slice(0, maxLen - 1).trimEnd()}…` : a));
}

/**
 * The history note that belongs to a marker: same article, same marker text.
 * A resolved note does not count (its marker has been replaced). A pending note wins over
 * a rejected one, then the most recent wins.
 */
export function matchHistory(
  entries: readonly HistoryEntry[],
  articlePath: string,
  markerRaw: string,
): HistoryEntry | undefined {
  const wanted = normalizeMarker(markerRaw);
  let best: HistoryEntry | undefined;
  for (const e of entries) {
    if (e.status === "resolved" || e.articlePath !== articlePath || normalizeMarker(e.marker) !== wanted) continue;
    if (!best) best = e;
    else if (e.status !== best.status) best = e.status === "pending" ? e : best;
    else if (e.asked > best.asked) best = e;
  }
  return best;
}
