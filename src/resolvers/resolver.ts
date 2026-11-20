import type { Kind } from "../lang/packs";

export interface Source {
  title: string;
  url: string;
  /** A short verbatim quote from the page, when the resolver has one. */
  quote?: string;
}

export interface Candidate {
  answer: string;
  sources: Source[];
}

/** `sic` only: whether the claim holds. */
export type Verdict = "confirmed" | "corrected" | "uncertain";

export interface SolveRequest {
  kind: Kind;
  /** The finished prompt (see `buildPrompt`). */
  prompt: string;
}

export interface SolveResult {
  /** Who produced it, e.g. `claude-cli/sonnet`. Recorded in the history note. */
  resolver: string;
  verdict?: Verdict;
  candidates: Candidate[];
}

/**
 * Something that can answer a question. The history note is the contract between a
 * resolver and the rest of the plugin, so a new resolver only has to return this.
 * `solve` rejects when `signal` aborts.
 */
export interface Resolver {
  readonly id: string;
  readonly name: string;
  solve(request: SolveRequest, signal: AbortSignal): Promise<SolveResult>;
}

/** A failure whose message is fit to show the user as it is. */
export class ResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolverError";
  }
}
