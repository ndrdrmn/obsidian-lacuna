import { spawn, type ChildProcess } from "node:child_process";

export type ProcessFailure = "not-found" | "spawn" | "timeout" | "aborted" | "exit";

export class ProcessError extends Error {
  constructor(
    readonly reason: ProcessFailure,
    message: string,
    readonly stdout = "",
    readonly stderr = "",
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Written to the process's stdin, which is then closed. */
  input?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Kill the process and whatever it started. `child.kill()` alone leaves the children running on Windows. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      // Nothing more to do.
    }
  }
  child.kill("SIGKILL");
}

/**
 * Run a program without a shell (so nothing in the arguments is ever interpreted),
 * feed it `input`, and collect its output. Resolves on exit code 0.
 */
export function runProcess(executable: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new ProcessError("aborted", "Cancelled"));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(executable, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      reject(new ProcessError("spawn", e instanceof Error ? e.message : String(e)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = (): void => {
      killTree(child);
      finish(() => reject(new ProcessError("aborted", "Cancelled", stdout, stderr)));
    };

    timer = setTimeout(() => {
      killTree(child);
      finish(() => reject(new ProcessError("timeout", `Timed out after ${opts.timeoutMs / 1000} s`, stdout, stderr)));
    }, opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr?.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e: NodeJS.ErrnoException) =>
      finish(() => reject(new ProcessError(e.code === "ENOENT" ? "not-found" : "spawn", e.message))),
    );
    child.on("close", (code) =>
      finish(() =>
        code === 0
          ? resolve({ stdout, stderr })
          : reject(new ProcessError("exit", `exited with code ${code}`, stdout, stderr)),
      ),
    );

    // The process may exit before reading its input: that is not an error here.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(opts.input ?? "");
  });
}
