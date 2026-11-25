import type { ContextPiece } from "../resolvers/manual-answer";

/**
 * The note around a marker, in a dialog: the marker's own paragraph in the normal colour, its
 * neighbours muted, the marker highlighted. Scrolled so that the marker is in view.
 */
export function renderContext(parent: HTMLElement, pieces: readonly ContextPiece[]): void {
  const box = parent.createDiv({ cls: "lacuna-modal-context" });
  let markerEl: HTMLElement | null = null;
  for (const piece of pieces) {
    const el = box.createSpan({ cls: `lacuna-ctx-${piece.role}`, text: piece.text });
    if (piece.role === "marker") markerEl = el;
  }
  markerEl?.scrollIntoView({ block: "center" });
}
