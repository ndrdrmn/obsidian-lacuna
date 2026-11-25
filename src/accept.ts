import { MarkdownView, type App, type Editor, type TFile } from "obsidian";
import {
  CITATION_LABEL,
  applyEdits,
  blockAnchorIdFor,
  footnoteIdFor,
  footnoteLabel,
  planAccept,
  type AcceptPlan,
  type CitationStyle,
} from "./apply";
import { addAnsweredAt, formatLocalDateTime } from "./history-note";
import type { Kind } from "./lang/packs";
import { parseMarkers, pickMarker, type ParseOptions } from "./marker";

export interface AcceptRequest {
  /** The article the marker is in, and the history note that records the answer. */
  article: TFile;
  historyNote: TFile;
  /** The number of the history note, from its `id` property. */
  noteId: number;
  /** What the footnote says the lacuna was about: the question, or the claim. */
  question: string;
  kind: Kind;
  /** The marker as it was listed: it is found again in the note as it is now. */
  markerRaw: string;
  markerStart: number;
  /** The answer to put in the text. */
  answer: string;
  /** `sic` only. */
  verdict?: "confirmed" | "corrected";
}

export interface AcceptEnv {
  app: App;
  parseOptions: ParseOptions;
  citationStyle: CitationStyle;
}

/**
 * The article's view, if it is open in a tab that has been loaded and shows the editor
 * (Live Preview or Source). A note in Reading mode has no live editor to write through.
 */
function openEditorView(app: App, file: TFile): MarkdownView | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file?.path === file.path && view.getMode() === "source") return view;
  }
  return null;
}

const unix = (s: string): string => s.replace(/\r\n/g, "\n");

/**
 * Apply the answer through the editor, so that Ctrl+Z undoes it, and make sure it reached the file.
 * Returns null when the editor ignored the change (it is left as it was): the caller then writes the file.
 * Throws when the change is half there, which must not pass for success.
 */
async function applyThroughEditor(
  env: AcceptEnv,
  req: AcceptRequest,
  view: MarkdownView,
): Promise<{ anchor: string | null; excerpt: string } | null> {
  const editor: Editor = view.editor;
  const before = editor.getValue();
  const plan = planFor(env, req, before);
  if (!plan) throw new Error(MARKER_GONE);
  const expected = applyEdits(before, plan.edits);

  // From the end of the note, so that the positions stay right whichever way the editor applies them.
  const changes = [...plan.edits]
    .sort((a, b) => b.from - a.from)
    .map((e) => ({ from: editor.offsetToPos(e.from), to: editor.offsetToPos(e.to), text: e.insert }));
  editor.transaction({ changes });

  const now = editor.getValue();
  if (now === before) return null;
  if (now !== expected) throw new Error("The editor changed the note in an unexpected way, so the answer was not applied. Check the note.");

  // Write it now rather than in two seconds, and look at the file: the history note must not say
  // "resolved" about an answer that is not in the note.
  await view.save();
  const onDisk = await env.app.vault.read(req.article);
  if (unix(onDisk) !== expected) {
    throw new Error("The answer is in the editor but the note was not saved. Save it, or undo the change.");
  }
  return { anchor: plan.anchor, excerpt: plan.excerpt };
}

const MARKER_GONE = "The marker is no longer in the note, so the answer was not applied.";

/** What accepting the answer changes in `text`, or null when the marker is no longer there. */
function planFor(env: AcceptEnv, req: AcceptRequest, text: string): AcceptPlan | null {
  const marker = pickMarker(parseMarkers(text, env.parseOptions), req.markerRaw, req.markerStart);
  if (!marker) return null;
  const style = env.citationStyle;
  // The link is built from the article's path, so that it is right for the user's link settings
  // and Obsidian keeps it up to date if the history note is renamed or moved.
  const label = style === "footnote" ? footnoteLabel(req.noteId) : CITATION_LABEL;
  const link = env.app.fileManager.generateMarkdownLink(req.historyNote, req.article.path, undefined, label);
  return planAccept(text, marker, {
    kind: req.kind,
    answer: req.answer,
    verdict: req.verdict,
    style,
    link,
    footnoteId: footnoteIdFor(req.noteId, text),
    anchorId: blockAnchorIdFor(text),
    question: req.question,
  });
}

/**
 * Put the answer in the article in place of its marker, with a citation to the history note
 * and an invisible anchor the history note links back to; then mark the history note
 * `resolved`. Throws, changing nothing, when the marker is gone.
 *
 * A note open in the editor is changed through it, in a single transaction, so that Ctrl+Z undoes
 * it, and the file is checked afterwards. Any other note (closed, or in Reading mode) is changed
 * on disk; so is one whose editor did not take the change.
 */
export async function acceptAnswer(env: AcceptEnv, req: AcceptRequest): Promise<void> {
  const { app } = env;
  // Assigned inside callbacks as well, which the compiler does not follow: say what it can be.
  let anchor = null as string | null;
  let excerpt = "";

  const view = openEditorView(app, req.article);
  const viaEditor = view ? await applyThroughEditor(env, req, view) : null;
  if (viaEditor) {
    anchor = viaEditor.anchor;
    excerpt = viaEditor.excerpt;
  } else {
    let applied = false;
    await app.vault.process(req.article, (data) => {
      const plan = planFor(env, req, data);
      if (!plan) return data;
      applied = true;
      anchor = plan.anchor;
      excerpt = plan.excerpt;
      return applyEdits(data, plan.edits);
    });
    if (!applied) throw new Error(MARKER_GONE);
  }

  // Where the answer is: the block's anchor, or just the article when the block cannot take one (a heading).
  // The property holds the plain link; the line under the title says "ad loc." (at the place) and quotes the passage.
  const subpath = anchor ? `#^${anchor}` : undefined;
  const at = app.fileManager.generateMarkdownLink(req.article, req.historyNote.path, subpath);
  const atPlace = app.fileManager.generateMarkdownLink(req.article, req.historyNote.path, subpath, CITATION_LABEL);
  await app.vault.process(req.historyNote, (data) => addAnsweredAt(data, atPlace, excerpt));
  await app.fileManager.processFrontMatter(req.historyNote, (fm: Record<string, unknown>) => {
    fm.lacuna = "resolved";
    fm.at = at;
    fm.answer = req.answer;
    fm.answered = formatLocalDateTime(new Date());
  });
}
