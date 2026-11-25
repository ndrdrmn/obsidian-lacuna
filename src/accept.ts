import { MarkdownView, type App, type Editor, type TFile } from "obsidian";
import {
  CITATION_LABEL,
  anchorIdFor,
  applyEdits,
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

/** The editor of the article, if it is open in a tab that has been loaded. */
function openEditor(app: App, file: TFile): Editor | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) return leaf.view.editor;
  }
  return null;
}

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
    id: anchorIdFor(req.noteId, text),
    question: req.question,
  });
}

/**
 * Put the answer in the article in place of its marker, with a citation to the history note
 * and an invisible anchor the history note links back to; then mark the history note
 * `resolved`. Throws, changing nothing, when the marker is gone.
 *
 * An open note is changed through its editor, in a single transaction, so that Ctrl+Z undoes it.
 * A closed one is changed on disk.
 */
export async function acceptAnswer(env: AcceptEnv, req: AcceptRequest): Promise<void> {
  const gone = new Error("The marker is no longer in the note, so the answer was not applied.");
  const { app } = env;
  // Assigned inside callbacks as well, which the compiler does not follow: say what it can be.
  let anchor = null as string | null;

  const editor = openEditor(app, req.article);
  if (editor) {
    const plan = planFor(env, req, editor.getValue());
    if (!plan) throw gone;
    anchor = plan.anchor;
    // From the end of the note, so that the positions stay right whichever way the editor applies them.
    const changes = [...plan.edits]
      .sort((a, b) => b.from - a.from)
      .map((e) => ({ from: editor.offsetToPos(e.from), to: editor.offsetToPos(e.to), text: e.insert }));
    editor.transaction({ changes });
  } else {
    let applied = false;
    await app.vault.process(req.article, (data) => {
      const plan = planFor(env, req, data);
      if (!plan) return data;
      applied = true;
      anchor = plan.anchor;
      return applyEdits(data, plan.edits);
    });
    if (!applied) throw gone;
  }

  // Where the answer is: the block's anchor, or just the article when the block cannot take one (a heading).
  const at = app.fileManager.generateMarkdownLink(req.article, req.historyNote.path, anchor ? `#^${anchor}` : undefined);
  await app.vault.process(req.historyNote, (data) => addAnsweredAt(data, at));
  await app.fileManager.processFrontMatter(req.historyNote, (fm: Record<string, unknown>) => {
    fm.lacuna = "resolved";
    fm.at = at;
    fm.answer = req.answer;
    fm.answered = formatLocalDateTime(new Date());
  });
}
