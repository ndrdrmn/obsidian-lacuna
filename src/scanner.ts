import type { App, TFile } from "obsidian";
import { parseMarkers, type Marker, type ParseOptions } from "./marker";

export interface IndexHost {
  parseOptions(): ParseOptions;
  /** Notes that must never be scanned (the history notes). */
  isExcluded(path: string): boolean;
}

const BATCH = 50;

function sameMarkers(a: readonly Marker[], b: readonly Marker[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (m, i) => m.start === b[i].start && m.raw === b[i].raw && m.kind === b[i].kind && m.question === b[i].question,
  );
}

/**
 * In-memory index of the markers of each note.
 *
 * - Cheap by construction: a note without `==?` is not parsed at all.
 * - Incremental: only the note that changed is read again.
 * - The whole vault is scanned once, the first time somebody asks for it (`build`).
 *   Until then only the notes that were opened are indexed.
 */
export class MarkerIndex {
  /** Every scanned note, with its markers (possibly none). */
  private readonly files = new Map<string, Marker[]>();
  private built = false;
  private building: Promise<void> | null = null;
  /** Bumped by `reset`, so that a scan started before it cannot store stale results. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly app: App,
    private readonly host: IndexHost,
  ) {}

  isBuilt(): boolean {
    return this.built;
  }

  /** Called when the markers of some note changed. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  get(path: string): readonly Marker[] {
    return this.files.get(path) ?? [];
  }

  /** The notes that have at least one marker, sorted by path. */
  all(): [string, readonly Marker[]][] {
    return [...this.files.entries()].filter(([, ms]) => ms.length > 0).sort(([a], [b]) => a.localeCompare(b));
  }

  /** Store a note's markers. Returns true when they differ from what was there. */
  private store(path: string, text: string): boolean {
    if (this.host.isExcluded(path)) return this.files.delete(path);
    const markers = text.includes("==?") ? parseMarkers(text, this.host.parseOptions()) : [];
    const changed = !sameMarkers(this.files.get(path) ?? [], markers);
    this.files.set(path, markers);
    return changed;
  }

  /** The note's text is known (for instance, it is being edited right now). */
  setFromText(path: string, text: string): void {
    if (this.store(path, text)) this.emit();
  }

  /** Read the note from the vault and index it. */
  async updateFile(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    if (this.host.isExcluded(file.path)) {
      if (this.files.delete(file.path)) this.emit();
      return;
    }
    const generation = this.generation;
    const text = await this.app.vault.cachedRead(file);
    if (generation !== this.generation) return;
    this.setFromText(file.path, text);
  }

  /** Index the note unless it has been scanned already. */
  async ensure(file: TFile): Promise<void> {
    if (!this.files.has(file.path)) await this.updateFile(file);
  }

  remove(path: string): void {
    const had = (this.files.get(path)?.length ?? 0) > 0;
    this.files.delete(path);
    if (had) this.emit();
  }

  rename(oldPath: string, file: TFile): void {
    this.remove(oldPath);
    void this.updateFile(file);
  }

  /** Scan every note of the vault, once. */
  build(): Promise<void> {
    if (this.built) return Promise.resolve();
    if (!this.building) {
      const generation = this.generation;
      this.building = (async () => {
        const files = this.app.vault.getMarkdownFiles().filter((f) => !this.host.isExcluded(f.path));
        for (let i = 0; i < files.length; i += BATCH) {
          await Promise.all(
            files.slice(i, i + BATCH).map(async (f) => {
              try {
                const text = await this.app.vault.cachedRead(f);
                if (generation === this.generation) this.store(f.path, text);
              } catch (e) {
                console.error(`Lacuna: could not read ${f.path}`, e);
              }
            }),
          );
          if (generation !== this.generation) return;
        }
        this.built = true;
        this.building = null;
        this.emit();
      })();
    }
    return this.building;
  }

  /**
   * The settings changed (keywords, default kind, history folder): everything
   * indexed so far may be wrong. Forget it, and scan the vault again if it had been.
   */
  reset(): void {
    const wasBuilt = this.built || this.building !== null;
    this.generation++;
    this.files.clear();
    this.built = false;
    this.building = null;
    this.emit();
    if (wasBuilt) void this.build();
  }
}
