/**
 * SOP Runner
 *
 * 负责发现、加载和执行 SOP 文件。
 * - 扫描 sops/ 目录发现 SOP
 * - 动态导入 sop.ts
 * - 构建 SOPContext
 * - 执行 run() 并记录结果
 */

import crypto from "node:crypto";
import nodeFs from "node:fs";
import nodePath from "node:path";

import type {
  SOPContext,
  SOPDefinition,
  SOPEntry,
  SOPRunRecord,
} from "./types.js";
import { SOPAbortError } from "./types.js";
import { SOPLogger } from "./logger.js";
import { setActiveLogger } from "./sdk.js";
import {
  appendRunRecord,
  loadSOPKVStore,
  resolveSOPDataDir,
} from "./store.js";

// ---------------------------------------------------------------------------
// SOP 发现
// ---------------------------------------------------------------------------

const SOP_FILE_NAME = "sop.ts";
const SOP_MD_NAME = "SOP.md";

/** 扫描指定目录下的所有 SOP */
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
    if (!dirent.isDirectory()) continue;

    const dirPath = nodePath.join(resolvedDir, dirent.name);
    const filePath = nodePath.join(dirPath, SOP_FILE_NAME);
    const mdPath = nodePath.join(dirPath, SOP_MD_NAME);

    try {
      await nodeFs.promises.access(filePath);
    } catch {
      continue; // 没有 sop.ts，跳过
    }

    // 尝试从 SOP.md frontmatter 或文件名推断元信息
    let description = "";
    let hasMd = false;
    try {
      const mdContent = await nodeFs.promises.readFile(mdPath, "utf-8");
      hasMd = true;
      const descMatch = /description:\s*(.+)/i.exec(mdContent);
      if (descMatch) {
        description = descMatch[1].trim();
      }
    } catch {
      // SOP.md 是可选的
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

// ---------------------------------------------------------------------------
// SOP 加载
// ---------------------------------------------------------------------------

/** 动态导入 sop.ts 并返回 SOPDefinition */
export async function loadSOP(filePath: string): Promise<SOPDefinition> {
  const absPath = nodePath.resolve(filePath);
  // 使用 jiti 来支持 TypeScript 动态导入
  const { createJiti } = await import("jiti");
  const jiti = createJiti(absPath, {
    interopDefault: true,
    moduleCache: false, // 不缓存，支持自愈后重新加载
  });

  const mod = await jiti.import(absPath) as { default?: SOPDefinition };
  const def = mod.default ?? mod;

  if (!def || typeof def !== "object" || typeof (def as SOPDefinition).run !== "function") {
    throw new Error(`Invalid SOP file: ${filePath} — must export default defineSOP({...})`);
  }

  return def as SOPDefinition;
}

// ---------------------------------------------------------------------------
// SOP 执行
// ---------------------------------------------------------------------------

export type RunSOPOptions = {
  /** SOP 文件路径 */
  filePath: string;
  /** SOP 名称 */
  sopName: string;
  /** OpenClaw 配置目录 (用于存储状态) */
  configDir: string;
  /** 触发参数 */
  args?: Record<string, unknown>;
  /** 触发类型 */
  trigger?: "manual" | "cron" | "event";
  /** 超时 (ms), 默认 5 分钟 */
  timeoutMs?: number;
};

/** 执行一个 SOP */
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

  // 加载 KV 存储
  const { store: kvStore, flush: flushKV } = await loadSOPKVStore(dataDir);

  // 构建 SOPContext
  const ctx: SOPContext = {
    env: process.env as Record<string, string | undefined>,
    args,
    date: (fmt?: string) => {
      const now = new Date();
      if (!fmt) return now.toISOString();
      // 简易格式化
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

  // 设置运行时日志上下文
  setActiveLogger(logger);

  let status: SOPRunRecord["status"] = "ok";
  let error: string | undefined;
  let result: unknown;

  try {
    // 加载 SOP 定义
    const def = await loadSOP(filePath);

    // 超时竞赛
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

  // 持久化 KV 存储
  try {
    await flushKV();
  } catch {
    // best-effort
  }

  // 构建运行记录
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

  // 保存运行历史
  try {
    await appendRunRecord(dataDir, record);
  } catch {
    // best-effort — 不让历史写入失败影响 SOP 结果
  }

  return record;
}

// ---------------------------------------------------------------------------
// 便捷入口
// ---------------------------------------------------------------------------

/** 按名称运行 SOP (在 sopsDir 中查找) */
export async function runSOPByName(
  sopsDir: string,
  sopName: string,
  configDir: string,
  opts?: { args?: Record<string, unknown>; trigger?: "manual" | "cron" | "event" },
): Promise<SOPRunRecord> {
  const entries = await discoverSOPs(sopsDir);
  const entry = entries.find((e) => e.name === sopName);
  if (!entry) {
    throw new Error(`SOP not found: ${sopName}. Available: ${entries.map((e) => e.name).join(", ") || "none"}`);
  }
  return runSOP({
    filePath: entry.filePath,
    sopName: entry.name,
    configDir,
    args: opts?.args,
    trigger: opts?.trigger,
  });
}
