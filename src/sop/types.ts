/**
 * SOP (Standard Operating Procedure) 核心类型定义
 * 定义 SOP 的结构、运行上下文、执行记录和验证类型
 */

// ---------------------------------------------------------------------------
// SOP 定义
// ---------------------------------------------------------------------------

/** SOP 运行函数的返回值 */
export type SOPResult = Record<string, unknown> | void;

/** SOP 运行上下文 — 注入到每次 run() 调用中 */
export type SOPContext = {
  /** 环境变量 (process.env 的只读快照) */
  env: Readonly<Record<string, string | undefined>>;
  /** 触发时传入的参数 */
  args: Record<string, unknown>;
  /** 格式化当前日期 (使用 Intl) */
  date: (fmt?: string) => string;
  /** 记录日志到步骤记录 */
  log: (msg: string) => void;
  /** 中止 SOP 执行（抛出 SOPAbortError） */
  abort: (reason: string) => never;
  /** 持久化 key-value 存储（跨执行保持） */
  store: SOPKVStore;
};

/** SOP 定义 — sop.ts 文件中 defineSOP() 的参数 */
export type SOPDefinition = {
  /** SOP 名称（唯一标识） */
  name: string;
  /** SOP 描述 */
  description: string;
  /** 版本号（自愈更新时自增） */
  version?: number;
  /** Cron 表达式（Phase 2） */
  schedule?: string;
  /** 事件触发列表（Phase 2） */
  triggers?: string[];
  /** SOP 执行函数 */
  run: (ctx: SOPContext) => Promise<SOPResult>;
};

// ---------------------------------------------------------------------------
// 执行记录
// ---------------------------------------------------------------------------

/** 单步执行记录 */
export type SOPStepRecord = {
  /** 动作名称 (如 "browser.open", "shell.run") */
  action: string;
  /** 动作参数摘要 */
  params?: Record<string, unknown>;
  /** 步骤开始时间 (ms since epoch) */
  startedAt: number;
  /** 步骤结束时间 */
  finishedAt: number;
  /** 执行状态 */
  status: "ok" | "error";
  /** 错误信息 */
  error?: string;
  /** 返回值摘要 */
  result?: unknown;
};

/** SOP 单次运行记录 */
export type SOPRunRecord = {
  /** SOP 名称 */
  sopName: string;
  /** 运行 ID */
  runId: string;
  /** 运行开始时间 */
  startedAt: number;
  /** 运行结束时间 */
  finishedAt: number;
  /** 运行状态 */
  status: "ok" | "error" | "aborted";
  /** 错误信息 */
  error?: string;
  /** 执行步骤列表 */
  steps: SOPStepRecord[];
  /** SOP run() 返回值 */
  result?: unknown;
  /** 触发方式 */
  trigger?: "manual" | "cron" | "event";
  /** 触发参数 */
  triggerArgs?: Record<string, unknown>;
};

/** 运行历史文件格式 */
export type SOPHistoryFile = {
  version: 1;
  runs: SOPRunRecord[];
};

// ---------------------------------------------------------------------------
// 持久化存储
// ---------------------------------------------------------------------------

/** 每个 SOP 的持久化 key-value 存储 */
export type SOPKVStore = {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
};

/** KV 存储文件格式 */
export type SOPKVStoreFile = {
  version: 1;
  data: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// SOP 清单（发现的 SOP 列表）
// ---------------------------------------------------------------------------

/** 发现的 SOP 条目 */
export type SOPEntry = {
  /** SOP 名称 */
  name: string;
  /** SOP 描述 */
  description: string;
  /** SOP 目录路径 */
  dirPath: string;
  /** sop.ts 文件路径 */
  filePath: string;
  /** SOP.md 文件路径（可选） */
  mdPath?: string;
  /** 版本号 */
  version?: number;
};

// ---------------------------------------------------------------------------
// 调度器状态
// ---------------------------------------------------------------------------

/** 调度器状态报告 */
export type SOPSchedulerStatus = {
  /** 是否正在运行 */
  running: boolean;
  /** 已调度的 SOP 列表 */
  scheduledSOPs: {
    name: string;
    schedule: string;
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: "ok" | "error" | "aborted";
  }[];
  /** 事件触发的 SOP 列表 */
  triggeredSOPs: {
    name: string;
    triggers: string[];
  }[];
};

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** SOP 主动中止错误 */
export class SOPAbortError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SOPAbortError";
  }
}

/** SOP 验证失败错误 */
export class SOPVerifyError extends Error {
  constructor(
    message: string,
    public readonly action?: string,
  ) {
    super(message);
    this.name = "SOPVerifyError";
  }
}
