export type JobStatus = "queued" | "searching" | "ready" | "failed";

export interface Job<P, R> {
  readonly id: number;
  /** What the job is about: asking again for the same key does nothing while it is queued or running. */
  readonly key: string;
  readonly payload: P;
  status: JobStatus;
  /** Set when `failed`. */
  error?: string;
  /** Set when `ready`. */
  result?: R;
}

type Listener<P, R> = (job: Job<P, R> | undefined) => void;

/**
 * A background queue that runs one job at a time: queued → searching → ready (or failed).
 * One at a time keeps a vault full of questions from starting dozens of searches at once.
 * A cancelled job leaves the queue; a finished one stays, so the sidebar can show it, until `remove`.
 */
export class JobQueue<P, R> {
  private readonly jobs = new Map<string, Job<P, R>>();
  private readonly order: Job<P, R>[] = [];
  private readonly aborts = new Map<number, AbortController>();
  private readonly listeners = new Set<Listener<P, R>>();
  private nextId = 1;
  private running = false;

  constructor(private readonly run: (payload: P, signal: AbortSignal) => Promise<R>) {}

  /** Called whenever a job changes. `undefined` means one was removed or cancelled. */
  onChange(listener: Listener<P, R>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(job?: Job<P, R>): void {
    for (const listener of this.listeners) listener(job);
  }

  get(key: string): Job<P, R> | undefined {
    return this.jobs.get(key);
  }

  /** Queue a job. If one with this key is queued or running, that one is returned. A finished one is replaced. */
  enqueue(key: string, payload: P): Job<P, R> {
    const existing = this.jobs.get(key);
    if (existing && (existing.status === "queued" || existing.status === "searching")) return existing;
    const job: Job<P, R> = { id: this.nextId++, key, payload, status: "queued" };
    this.jobs.set(key, job);
    this.order.push(job);
    this.emit(job);
    void this.pump();
    return job;
  }

  /** Cancel a queued or running job. It leaves the queue. */
  cancel(key: string): void {
    const job = this.jobs.get(key);
    if (!job || (job.status !== "queued" && job.status !== "searching")) return;
    this.jobs.delete(key);
    const at = this.order.indexOf(job);
    if (at !== -1) this.order.splice(at, 1);
    this.aborts.get(job.id)?.abort();
    this.emit();
  }

  /** Cancel everything that is queued or running, for instance when the plugin is unloaded. */
  cancelAll(): void {
    for (const key of [...this.jobs.keys()]) this.cancel(key);
  }

  /** Forget a finished job (for instance, before asking again). */
  remove(key: string): void {
    if (this.jobs.delete(key)) this.emit();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let job: Job<P, R> | undefined;
      while ((job = this.order.shift())) {
        const abort = new AbortController();
        this.aborts.set(job.id, abort);
        job.status = "searching";
        this.emit(job);
        try {
          const result = await this.run(job.payload, abort.signal);
          if (this.jobs.get(job.key) === job) {
            job.status = "ready";
            job.result = result;
            this.emit(job);
          }
        } catch (e) {
          // A job cancelled while it ran has already left the queue.
          if (this.jobs.get(job.key) === job) {
            job.status = "failed";
            job.error = e instanceof Error ? e.message : String(e);
            this.emit(job);
          }
        } finally {
          this.aborts.delete(job.id);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
