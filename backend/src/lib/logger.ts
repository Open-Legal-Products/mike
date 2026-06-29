import { appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

function defaultLogDir(): string {
  return process.env.AGENT_LOG_DIR?.trim() || path.join(process.cwd(), "logs");
}

const RUN_ID_RE = /^run_\d{14}(?:_\d+)?(?:_[0-9a-f]{8})?$/i;
const LOG_FILENAME_RE = /^agent-[0-9a-f-]+\.jsonl$/i;

export function buildAgentRunLogDownloadUrl(
  runId: string,
  filename: string,
): string {
  return `/agent-run-logs/${encodeURIComponent(runId)}/${encodeURIComponent(filename)}`;
}

export function resolveAgentRunLogFilePath(
  runId: string,
  filename: string,
): string | null {
  if (!RUN_ID_RE.test(runId) || !LOG_FILENAME_RE.test(filename)) return null;
  const logsRoot = path.resolve(defaultLogDir());
  const resolved = path.resolve(path.join(logsRoot, runId, filename));
  if (!resolved.startsWith(`${logsRoot}${path.sep}`)) return null;
  return resolved;
}

/** Formats a date as yyyymmddhhiiss, e.g. 20260629173430. */
export function formatRunDatetime(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}${s}`;
}

/**
 * Returns a per-run log directory: logs/run_yyyymmddhhiiss/
 * If that folder already exists (same-second collision), appends _2, _3, …
 */
export function createAgentRunLogDir(logsRoot = defaultLogDir()): string {
  const stamp = formatRunDatetime();
  let candidate = path.join(logsRoot, `run_${stamp}`);
  if (!existsSync(candidate)) return candidate;

  for (let i = 2; i < 1000; i++) {
    candidate = path.join(logsRoot, `run_${stamp}_${i}`);
    if (!existsSync(candidate)) return candidate;
  }

  return path.join(logsRoot, `run_${stamp}_${randomUUID().slice(0, 8)}`);
}

function stringifyLogValue(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, innerValue: unknown) => {
    if (typeof innerValue === "bigint") return innerValue.toString();
    if (innerValue instanceof Error) {
      return {
        name: innerValue.name,
        message: innerValue.message,
        stack: innerValue.stack,
      };
    }
    if (innerValue && typeof innerValue === "object") {
      if (seen.has(innerValue)) return "[Circular]";
      seen.add(innerValue);
    }
    return innerValue;
  });
}

/**
 * Appends JSON lines to a file under the logs directory.
 */
export class Logger {
  private readonly filePath: string;
  private readonly logDir: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(relativeFilename: string, logDir = defaultLogDir()) {
    this.logDir = logDir;
    this.filePath = path.join(logDir, relativeFilename);
  }

  log(entry: Record<string, unknown>): void {
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const line = `${stringifyLogValue(record)}\n`;
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(this.logDir, { recursive: true });
        await appendFile(this.filePath, line, "utf8");
      })
      .catch((error) => {
        console.error("[Logger] failed to write log", {
          filePath: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}
