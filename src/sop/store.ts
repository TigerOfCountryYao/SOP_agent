/**
 * SOP Store
 *
 * 管理每个 SOP 的：
 * 1. 持久化 KV 存储 (store.json) — 跨执行保持数据
 * 2. 运行历史 (history.json) — 执行记录
 *
 * 采用和 cron/store.ts 相同的原子写入模式。
 */

import fs from "node:fs";
import path from "node:path";
import type {
  SOPHistoryFile,
  SOPKVStore,
  SOPKVStoreFile,
  SOPMetaRecord,
  SOPRunRecord,
} from "./types.js";

const MAX_HISTORY_RUNS = 100;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Resolve per-SOP runtime data directory under the configured SOP state root. */
export function resolveSOPDataDir(configDir: string, sopName: string): string {
  return path.join(configDir, sopName);
}

function kvStorePath(dataDir: string): string {
  return path.join(dataDir, "store.json");
}

function historyPath(dataDir: string): string {
  return path.join(dataDir, "history.json");
}

function metaPath(dataDir: string): string {
  return path.join(dataDir, "meta.json");
}

// ---------------------------------------------------------------------------
// Atomic file write (same pattern as cron/store.ts)
// ---------------------------------------------------------------------------

async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, json, "utf-8");
  await fs.promises.rename(tmp, filePath);
}

async function readJSONSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") {
      return fallback;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// KV Store
// ---------------------------------------------------------------------------

/** 创建一个 SOP 的 KV 存储实例 */
export async function loadSOPKVStore(dataDir: string): Promise<{
  store: SOPKVStore;
  flush: () => Promise<void>;
}> {
  const file = kvStorePath(dataDir);
  const state = await readJSONSafe<SOPKVStoreFile>(file, { version: 1, data: {} });
  let dirty = false;

  const store: SOPKVStore = {
    get<T = unknown>(key: string): T | undefined {
      return state.data[key] as T | undefined;
    },
    set(key: string, value: unknown): void {
      state.data[key] = value;
      dirty = true;
    },
  };

  const flush = async () => {
    if (dirty) {
      await atomicWriteJSON(file, state);
      dirty = false;
    }
  };

  return { store, flush };
}

// ---------------------------------------------------------------------------
// Run History
// ---------------------------------------------------------------------------

/** 追加一条运行记录 */
export async function appendRunRecord(dataDir: string, record: SOPRunRecord): Promise<void> {
  const file = historyPath(dataDir);
  const history = await readJSONSafe<SOPHistoryFile>(file, { version: 1, runs: [] });
  history.runs.push(record);

  // 保留最近 N 条记录
  if (history.runs.length > MAX_HISTORY_RUNS) {
    history.runs = history.runs.slice(-MAX_HISTORY_RUNS);
  }

  await atomicWriteJSON(file, history);
}

/** 读取运行历史 */
export async function loadRunHistory(dataDir: string): Promise<SOPRunRecord[]> {
  const file = historyPath(dataDir);
  const history = await readJSONSafe<SOPHistoryFile>(file, { version: 1, runs: [] });
  return history.runs;
}

export async function loadSOPMeta(dataDir: string): Promise<SOPMetaRecord | null> {
  const file = metaPath(dataDir);
  try {
    const raw = await fs.promises.readFile(file, "utf-8");
    return JSON.parse(raw) as SOPMetaRecord;
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function saveSOPMeta(dataDir: string, meta: SOPMetaRecord): Promise<void> {
  await atomicWriteJSON(metaPath(dataDir), meta);
}
