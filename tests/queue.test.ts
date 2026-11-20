import { describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue";

/** A promise you resolve or reject by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("JobQueue", () => {
  it("runs one job at a time, in order: queued → searching → ready", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const started: string[] = [];
    const q = new JobQueue<string, string>((p) => {
      started.push(p);
      const g = deferred<string>();
      gates.set(p, g);
      return g.promise;
    });

    const a = q.enqueue("a", "a");
    const b = q.enqueue("b", "b");
    await tick();
    expect(started).toEqual(["a"]);
    expect([a.status, b.status]).toEqual(["searching", "queued"]);

    gates.get("a")!.resolve("result-a");
    await tick();
    expect(a).toMatchObject({ status: "ready", result: "result-a" });
    expect(started).toEqual(["a", "b"]);
    expect(b.status).toBe("searching");

    gates.get("b")!.resolve("result-b");
    await tick();
    expect(b.status).toBe("ready");
  });

  it("returns the running job when the same key is asked again", async () => {
    const q = new JobQueue<number, number>(() => deferred<number>().promise);
    const first = q.enqueue("k", 1);
    expect(q.enqueue("k", 2)).toBe(first);
    await tick();
    expect(q.enqueue("k", 3)).toBe(first);
  });

  it("marks a failing job as failed, with the message, and carries on", async () => {
    const q = new JobQueue<string, string>(async (p) => {
      if (p === "bad") throw new Error("it broke");
      return "fine";
    });
    const bad = q.enqueue("bad", "bad");
    const good = q.enqueue("good", "good");
    await tick();
    await tick();
    expect(bad).toMatchObject({ status: "failed", error: "it broke" });
    expect(good).toMatchObject({ status: "ready", result: "fine" });
  });

  it("replaces a failed job when asked again", async () => {
    let calls = 0;
    const q = new JobQueue<number, number>(async () => {
      if (++calls === 1) throw new Error("first");
      return 42;
    });
    const first = q.enqueue("k", 0);
    await tick();
    expect(first.status).toBe("failed");
    const second = q.enqueue("k", 0);
    expect(second).not.toBe(first);
    await tick();
    expect(q.get("k")).toMatchObject({ status: "ready", result: 42 });
  });

  it("cancels a queued job: it leaves the queue and never runs", async () => {
    const started: string[] = [];
    const gate = deferred<string>();
    const q = new JobQueue<string, string>((p) => {
      started.push(p);
      return p === "a" ? gate.promise : Promise.resolve("x");
    });
    q.enqueue("a", "a");
    q.enqueue("b", "b");
    await tick();
    q.cancel("b");
    expect(q.get("b")).toBeUndefined();
    gate.resolve("done");
    await tick();
    expect(started).toEqual(["a"]);
  });

  it("cancels a running job: its signal aborts, it leaves the queue, the next one runs, nothing is marked failed", async () => {
    let signalOfA: AbortSignal | undefined;
    const q = new JobQueue<string, string>((p, signal) => {
      if (p === "a") {
        signalOfA = signal;
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Cancelled"))));
      }
      return Promise.resolve("b done");
    });
    q.enqueue("a", "a");
    const b = q.enqueue("b", "b");
    await tick();
    q.cancel("a");
    await tick();
    expect(signalOfA?.aborted).toBe(true);
    expect(q.get("a")).toBeUndefined();
    expect(b).toMatchObject({ status: "ready", result: "b done" });
  });

  it("cancelAll stops the running job and drops the queued ones, but keeps finished ones", async () => {
    const aborted: string[] = [];
    const q = new JobQueue<string, string>((p, signal) => {
      if (p === "done") return Promise.resolve("ok");
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => {
          aborted.push(p);
          reject(new Error("Cancelled"));
        }),
      );
    });
    q.enqueue("done", "done");
    await tick();
    q.enqueue("running", "running");
    q.enqueue("waiting", "waiting");
    await tick();
    q.cancelAll();
    await tick();
    expect(aborted).toEqual(["running"]);
    expect(q.get("running")).toBeUndefined();
    expect(q.get("waiting")).toBeUndefined();
    expect(q.get("done")?.status).toBe("ready");
  });

  it("does not cancel a finished job, and remove forgets it", async () => {
    const q = new JobQueue<number, number>(async () => 1);
    q.enqueue("k", 0);
    await tick();
    q.cancel("k");
    expect(q.get("k")?.status).toBe("ready");
    q.remove("k");
    expect(q.get("k")).toBeUndefined();
  });

  it("tells the listeners about every change, and stops after unsubscribe", async () => {
    const q = new JobQueue<number, number>(async () => 1);
    const seen: (string | undefined)[] = [];
    const off = q.onChange((job) => seen.push(job?.status));
    q.enqueue("k", 0);
    await tick();
    expect(seen).toEqual(["queued", "searching", "ready"]);
    q.remove("k");
    expect(seen.at(-1)).toBeUndefined();
    off();
    const before = seen.length;
    q.enqueue("k2", 0);
    await tick();
    expect(seen).toHaveLength(before);
  });
});
