import type { Kind } from "./lang/packs";
import { formatAlias } from "./marker";
import type { Candidate, Source, Verdict } from "./resolvers/resolver";

export type HistoryStatus = "pending" | "resolved" | "rejected";

export function isHistoryStatus(v: unknown): v is HistoryStatus {
  return v === "pending" || v === "resolved" || v === "rejected";
}

export interface HistoryNoteInput {
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
  /** The text that was sent to the search, marker included. Empty when nothing was sent. */
  context: string;
  candidates: Candidate[];
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

/** `2026-11-20 Windows 95 — exact release date` (without the extension). */
export function historyFileName(date: Date, article: string, title: string): string {
  const slug = sanitize(title, 60) || "lacuna";
  return `${formatLocalDate(date)} ${sanitize(article, 40) || "note"} — ${slug}`;
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
    `kind: ${i.kind}`,
    ...(i.alias ? [`alias: ${yaml(formatAlias(i.alias))}`] : []),
    `question: ${yaml(i.question)}`,
    `article: ${yaml(i.articleLink)}`,
    `marker: ${yaml(normalizeMarker(i.marker))}`,
    `asked: ${formatLocalDateTime(i.asked)}`,
    `resolver: ${i.resolver}`,
    ...(i.verdict ? [`verdict: ${i.verdict}`] : []),
    "answer:",
    "answered:",
    "---",
  ].join("\n");

  const parts = [front, `# ${i.title}`];
  // "Answer myself" sends nothing anywhere, so it has no context to show.
  if (i.context.trim() !== "") {
    parts.push(`> Context sent to the search:\n>\n${quoteBlock(normalizeMarker(i.context))}`);
  }
  i.candidates.forEach((c, n) => {
    const section = [`## Candidate ${n + 1}`, c.answer.trim()];
    if (c.sources.length > 0) section.push("", c.sources.map(sourceLine).join("\n"));
    parts.push(section.join("\n"));
  });
  return `${parts.join("\n\n")}\n`;
}

/** What is known of a history note without reading its body (from the metadata cache). */
export interface HistoryEntry {
  path: string;
  status: HistoryStatus;
  /** The `marker` property. */
  marker: string;
  /** The note the `article` property points to, if it resolves. */
  articlePath: string | null;
  asked: string;
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
