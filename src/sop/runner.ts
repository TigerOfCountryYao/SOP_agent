import crypto from "node:crypto";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import type { SOPContext, SOPDefinition, SOPEntry, SOPRunRecord } from "./types.js";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";
import { SOPAbortError } from "./types.js";
import { SOPLogger } from "./logger.js";
import { setActiveLogger } from "./sdk.js";
import { appendRunRecord, loadSOPKVStore, resolveSOPDataDir } from "./store.js";

const SOP_FILE_NAME = "sop.ts";
const SOP_MD_NAME = "SOP.md";

function resolveSOPSdkAliasPath(): string {
  const repoRoot = resolveOpenClawPackageRootSync({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });
  const candidates = [
    repoRoot ? nodePath.join(repoRoot, "src", "sop", "index.ts") : null,
    fileURLToPath(new URL("./index.ts", import.meta.url)),
    fileURLToPath(new URL("./index.js", import.meta.url)),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (nodeFs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? fileURLToPath(new URL("./index.ts", import.meta.url));
}

export async function discoverSOPs(sopsDir: string): Promise<SOPEntry[]> {
  const resolvedDir = nodePath.resolve(sopsDir);
  const entries: SOPEntry[] = [];

  let dirents: nodeFs.Dirent[];
  try {
    dirents = await nodeFs.promises.readdir(resolvedDir, { withFileTypes: true });
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const dirPath = nodePath.join(resolvedDir, dirent.name);
    const filePath = nodePath.join(dirPath, SOP_FILE_NAME);
    const mdPath = nodePath.join(dirPath, SOP_MD_NAME);

    try {
      await nodeFs.promises.access(filePath);
    } catch {
      continue;
    }

    let description = "";
    let hasMd = false;
    try {
      const mdContent = await nodeFs.promises.readFile(mdPath, "utf-8");
      hasMd = true;
      const descMatch = /description:\s*(.+)/i.exec(mdContent);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
      }
    } catch {
      // SOP.md is optional metadata.
    }

    entries.push({
      name: dirent.name,
      description: description || dirent.name,
      dirPath,
      filePath,
      mdPath: hasMd ? mdPath : undefined,
    });
  }

  return entries;
}

export async function loadSOP(filePath: string): Promise<SOPDefinition> {
  const absPath = nodePath.resolve(filePath);
  const sopSdkPath = resolveSOPSdkAliasPath();
  const { createJiti } = await import("jiti");
  const jiti = createJiti(absPath, {
    interopDefault: true,
    moduleCache: false,
    // Workspace SOPs can live outside the repo, so alias the SDK import explicitly.
    alias: {
      "openclaw/sop": sopSdkPath,
    },
  });

  const mod = (await jiti.import(absPath)) as { default?: SOPDefinition };
  const def = mod.default ?? mod;

  if (!def || typeof def !== "object" || typeof (def as SOPDefinition).run !== "function") {
    throw new Error(`Invalid SOP file: ${filePath} - must export default defineSOP({...})`);
  }

  return def as SOPDefinition;
}

export type RunSOPOptions = {
  filePath: string;
  sopName: string;
  configDir: string;
  args?: Record<string, unknown>;
  trigger?: "manual" | "cron" | "event";
  timeoutMs?: number;
};

export async function runSOP(opts: RunSOPOptions): Promise<SOPRunRecord> {
  const {
    filePath,
    sopName,
    configDir,
    args = {},
    trigger = "manual",
    timeoutMs = 5 * 60 * 1000,
  } = opts;

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const logger = new SOPLogger();
  const dataDir = resolveSOPDataDir(configDir, sopName);
  const { store: kvStore, flush: flushKV } = await loadSOPKVStore(dataDir);

  const ctx: SOPContext = {
    env: process.env as Record<string, string | undefined>,
    args,
    date: (fmt?: string) => {
      const now = new Date();
      if (!fmt) {
        return now.toISOString();
      }
      return fmt
        .replace("YYYY", String(now.getFullYear()))
        .replace("MM", String(now.getMonth() + 1).padStart(2, "0"))
        .replace("DD", String(now.getDate()).padStart(2, "0"))
        .replace("HH", String(now.getHours()).padStart(2, "0"))
        .replace("mm", String(now.getMinutes()).padStart(2, "0"))
        .replace("ss", String(now.getSeconds()).padStart(2, "0"));
    },
    log: (msg: string) => logger.addLog(msg),
    abort: (reason: string) => {
      throw new SOPAbortError(reason);
    },
    store: kvStore,
  };

  setActiveLogger(logger);

  let status: SOPRunRecord["status"] = "ok";
  let error: string | undefined;
  let result: unknown;

  try {
    const def = await loadSOP(filePath);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`SOP timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    result = await Promise.race([def.run(ctx), timeoutPromise]);
  } catch (err) {
    if (err instanceof SOPAbortError) {
      status = "aborted";
      error = err.message;
    } else {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    setActiveLogger(null);
  }

  try {
    await flushKV();
  } catch {
    // Best-effort persistence only.
  }

  const record: SOPRunRecord = {
    sopName,
    runId,
    startedAt,
    finishedAt: Date.now(),
    status,
    error,
    steps: logger.getSteps(),
    result: result ?? undefined,
    trigger,
    triggerArgs: Object.keys(args).length > 0 ? args : undefined,
  };

  try {
    await appendRunRecord(dataDir, record);
  } catch {
    // History write failures should not change execution result.
  }

  return record;
}

export async function runSOPByName(
  sopsDir: string,
  sopName: string,
  configDir: string,
  opts?: { args?: Record<string, unknown>; trigger?: "manual" | "cron" | "event" },
): Promise<SOPRunRecord> {
  const entries = await discoverSOPs(sopsDir);
  const entry = entries.find((candidate) => candidate.name === sopName);
  if (!entry) {
    throw new Error(
      `SOP not found: ${sopName}. Available: ${entries.map((candidate) => candidate.name).join(", ") || "none"}`,
    );
  }
  return runSOP({
    filePath: entry.filePath,
    sopName: entry.name,
    configDir,
    args: opts?.args,
    trigger: opts?.trigger,
  });
}
