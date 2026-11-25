import { MarkdownView, type App, type Editor, type TFile } from "obsidian";
import {
  CITATION_LABEL,
  applyEdits,
  newFootnoteId,
  planAccept,
  type CitationStyle,
  type Edit,
} from "./apply";
import { formatLocalDateTime } from "./history-note";
import type { Kind } from "./lang/packs";
import { parseMarkers, pickMarker, type ParseOptions } from "./marker";

export interface AcceptRequest {
  /** The article the marker is in, and the history note that records the answer. */
  article: TFile;
  historyNote: TFile;
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

/** The edits that accept the answer in `text`, or null when the marker is no longer there. */
function planFor(env: AcceptEnv, req: AcceptRequest, text: string): Edit[] | null {
  const marker = pickMarker(parseMarkers(text, env.parseOptions), req.markerRaw, req.markerStart);
  if (!marker) return null;
  const style = env.citationStyle;
  // The link is built from the article's path, so that it is right for the user's link settings
  // and Obsidian keeps it up to date if the history note is renamed or moved.
  const link = env.app.fileManager.generateMarkdownLink(req.historyNote, req.article.path, undefined, CITATION_LABEL);
  return planAccept(text, marker, {
    kind: req.kind,
    answer: req.answer,
    verdict: req.verdict,
    style,
    link,
    footnoteId: style === "footnote" ? newFootnoteId(text) : undefined,
  });
}

/**
 * Put the answer in the article in place of its marker, with a citation to the history note,
 * then mark the history note `resolved`. Throws, changing nothing, when the marker is gone.
 *
 * An open note is changed through its editor, in a single transaction, so that Ctrl+Z undoes it.
 * A closed one is changed on disk.
 */
export async function acceptAnswer(env: AcceptEnv, req: AcceptRequest): Promise<void> {
  const gone = new Error("The marker is no longer in the note, so the answer was not applied.");
  const { app } = env;

  const editor = openEditor(app, req.article);
  if (editor) {
    const edits = planFor(env, req, editor.getValue());
    if (!edits) throw gone;
    // From the end of the note, so that the positions stay right whichever way the editor applies them.
    const changes = [...edits]
      .sort((a, b) => b.from - a.from)
      .map((e) => ({ from: editor.offsetToPos(e.from), to: editor.offsetToPos(e.to), text: e.insert }));
    editor.transaction({ changes });
  } else {
    let applied = false;
    await app.vault.process(req.article, (data) => {
      const edits = planFor(env, req, data);
      if (!edits) return data;
      applied = true;
      return applyEdits(data, edits);
    });
    if (!applied) throw gone;
  }

  await app.fileManager.processFrontMatter(req.historyNote, (fm: Record<string, unknown>) => {
    fm.lacuna = "resolved";
    fm.answer = req.answer;
    fm.answered = formatLocalDateTime(new Date());
  });
}
