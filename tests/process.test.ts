import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ProcessError, runProcess } from "../src/process";

const node = process.execPath;
const cwd = tmpdir();

async function failure(p: Promise<unknown>): Promise<ProcessError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ProcessError);
    return e as ProcessError;
  }
  throw new Error("expected a failure");
}

describe("runProcess", () => {
  it("feeds stdin and collects stdout", async () => {
    const r = await runProcess(node, ["-e", "process.stdin.pipe(process.stdout)"], {
      cwd,
      timeoutMs: 10_000,
      input: "héllo wörld",
    });
    expect(r.stdout).toBe("héllo wörld");
  });

  it("runs in the given directory", async () => {
    const r = await runProcess(node, ["-e", "process.stdout.write(process.cwd())"], { cwd, timeoutMs: 10_000 });
    expect(r.stdout.toLowerCase()).toBe(cwd.toLowerCase());
  });

  it("never interprets the arguments (no shell)", async () => {
    const tricky = 'a & echo injected | "quoted" $(x)';
    const r = await runProcess(node, ["-e", "process.stdout.write(process.argv[1])", tricky], {
      cwd,
      timeoutMs: 10_000,
    });
    expect(r.stdout).toBe(tricky);
  });

  it("fails with the exit code and the output when the program fails", async () => {
    const e = await failure(
      runProcess(node, ["-e", "console.error('boom'); process.stdout.write('out'); process.exit(3)"], {
        cwd,
        timeoutMs: 10_000,
      }),
    );
    expect(e.reason).toBe("exit");
    expect(e.message).toMatch(/code 3/);
    expect(e.stderr).toContain("boom");
    expect(e.stdout).toBe("out");
  });

  it("reports a program that does not exist", async () => {
    const e = await failure(runProcess("lacuna-no-such-program-xyz", [], { cwd, timeoutMs: 10_000 }));
    expect(e.reason).toBe("not-found");
  });

  it("times out and stops the process", async () => {
    const started = Date.now();
    const e = await failure(runProcess(node, ["-e", "setTimeout(() => {}, 30000)"], { cwd, timeoutMs: 300 }));
    expect(e.reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("aborts when the signal fires", async () => {
    const abort = new AbortController();
    const running = runProcess(node, ["-e", "setTimeout(() => {}, 30000)"], {
      cwd,
      timeoutMs: 30_000,
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 200);
    expect((await failure(running)).reason).toBe("aborted");
  });

  it("does not start when the signal is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const e = await failure(runProcess(node, ["-e", ""], { cwd, timeoutMs: 10_000, signal: abort.signal }));
    expect(e.reason).toBe("aborted");
  });

  it("copes with a program that exits without reading its input", async () => {
    const big = "x".repeat(2_000_000);
    const r = await runProcess(node, ["-e", "process.stdout.write('done')"], { cwd, timeoutMs: 10_000, input: big });
    expect(r.stdout).toBe("done");
  });
});
