import type { HistoryEntry } from "./history-note";
import type { JobStatus } from "./queue";

/** What the sidebar shows for one marker. */
export type ItemState =
  | { state: "idle" }
  | { state: "queued" }
  | { state: "searching" }
  | { state: "failed"; error: string }
  /** The answers are in a pending history note, waiting for the user to choose. */
  | { state: "ready"; notePath: string }
  | { state: "rejected"; notePath: string };

export interface JobView {
  status: JobStatus;
  error?: string;
  /** The history note's path, when `ready`. */
  result?: string;
}

/**
 * A job in this session decides first (it is the freshest news); otherwise the history note
 * found in the vault, which is what survives a restart of Obsidian.
 */
export function itemState(job: JobView | undefined, entry: HistoryEntry | undefined): ItemState {
  if (job) {
    if (job.status === "queued") return { state: "queued" };
    if (job.status === "searching") return { state: "searching" };
    if (job.status === "failed") return { state: "failed", error: job.error ?? "Something went wrong." };
    if (job.result) return { state: "ready", notePath: job.result };
  }
  if (entry?.status === "pending") return { state: "ready", notePath: entry.path };
  if (entry?.status === "rejected") return { state: "rejected", notePath: entry.path };
  return { state: "idle" };
}
