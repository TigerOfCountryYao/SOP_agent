/**
 * SOP Scheduler
 *
 * 轻量级调度器，独立于 CronService。
 * - 使用 croner 解析 cron 表达式
 * - 心跳定时器 (30s) 检查到期 SOP
 * - 事件触发分发
 * - 直接调用 runSOP() 执行
 */

import { Cron } from "croner";
import type { SOPDefinition, SOPEntry, SOPRunRecord, SOPSchedulerStatus } from "./types.js";
import { discoverSOPs, loadSOP, runSOP } from "./runner.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** 每个已调度 SOP 的运行时状态 */
type ScheduledSOPState = {
  entry: SOPEntry;
  def: SOPDefinition;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "aborted";
  running: boolean;
};

// ---------------------------------------------------------------------------
// SOPScheduler
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 秒心跳

export type SOPSchedulerOpts = {
  /** SOP 文件目录 */
  sopsDir: string;
  /** 配置目录 (用于存储运行数据) */
  configDir: string;
  /** 日志 */
  log?: Logger;
  /** 心跳间隔 (ms)，默认 30s */
  heartbeatMs?: number;
  /** 自定义时钟 (测试用) */
  nowMs?: () => number;
};

export class SOPScheduler {
  private readonly sopsDir: string;
  private readonly configDir: string;
  private readonly log: Logger;
  private readonly heartbeatMs: number;
  private readonly nowMs: () => number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private sopStates: Map<string, ScheduledSOPState> = new Map();
  private started = false;

  constructor(opts: SOPSchedulerOpts) {
    this.sopsDir = opts.sopsDir;
    this.configDir = opts.configDir;
    this.log = opts.log ?? noopLogger;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** 启动调度器 — 发现 SOP，加载定义，启动心跳 */
  async start(): Promise<void> {
    if (this.started) return;

    await this.loadAllSOPs();

    const scheduled = [...this.sopStates.values()].filter((s) => s.def.schedule);
    const triggered = [...this.sopStates.values()].filter((s) => s.def.triggers?.length);

    this.log.info(
      {
        scheduledCount: scheduled.length,
        triggeredCount: triggered.length,
        heartbeatMs: this.heartbeatMs,
      },
      "sop-scheduler: started",
    );

    this.timer = setInterval(() => void this.heartbeat(), this.heartbeatMs);
    this.started = true;
  }

  /** 停止调度器 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
    this.log.info({}, "sop-scheduler: stopped");
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** 获取调度器状态 */
  status(): SOPSchedulerStatus {
    const scheduledSOPs: SOPSchedulerStatus["scheduledSOPs"] = [];
    const triggeredSOPs: SOPSchedulerStatus["triggeredSOPs"] = [];

    for (const state of this.sopStates.values()) {
      if (state.def.schedule) {
        scheduledSOPs.push({
          name: state.entry.name,
          schedule: state.def.schedule,
          nextRunAtMs: state.nextRunAtMs,
          lastRunAtMs: state.lastRunAtMs,
          lastStatus: state.lastStatus,
        });
      }
      if (state.def.triggers?.length) {
        triggeredSOPs.push({
          name: state.entry.name,
          triggers: state.def.triggers,
        });
      }
    }

    return {
      running: this.started,
      scheduledSOPs,
      triggeredSOPs,
    };
  }

  /** 触发事件 — 执行所有匹配该事件名的 SOP */
  async trigger(eventName: string, args?: Record<string, unknown>): Promise<SOPRunRecord[]> {
    const results: SOPRunRecord[] = [];

    for (const state of this.sopStates.values()) {
      if (!state.def.triggers?.includes(eventName)) continue;
      if (state.running) {
        this.log.warn(
          { sop: state.entry.name, event: eventName },
          "sop-scheduler: skipped (already running)",
        );
        continue;
      }

      this.log.info(
        { sop: state.entry.name, event: eventName },
        "sop-scheduler: event triggered",
      );

      const record = await this.executeSOP(state, "event", { event: eventName, ...args });
      results.push(record);
    }

    return results;
  }

  /** 手动运行指定 SOP */
  async runNow(sopName: string, args?: Record<string, unknown>): Promise<SOPRunRecord> {
    let state = this.sopStates.get(sopName);
    if (!state) {
      // 尝试重新发现
      await this.loadAllSOPs();
      state = this.sopStates.get(sopName);
    }
    if (!state) {
      throw new Error(`SOP not found: ${sopName}`);
    }

    return this.executeSOP(state, "manual", args);
  }

  /** 重新加载所有 SOP 定义 */
  async reload(): Promise<void> {
    await this.loadAllSOPs();
    this.log.info({ sopCount: this.sopStates.size }, "sop-scheduler: reloaded");
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** 心跳：检查到期 SOP 并执行 */
  private async heartbeat(): Promise<void> {
    const now = this.nowMs();

    for (const state of this.sopStates.values()) {
      if (!state.def.schedule) continue;
      if (state.running) continue;
      if (!state.nextRunAtMs || state.nextRunAtMs > now) continue;

      this.log.info(
        { sop: state.entry.name, dueAt: state.nextRunAtMs },
        "sop-scheduler: cron due",
      );

      // 不 await — 允许多个 SOP 并发执行
      void this.executeSOP(state, "cron").catch((err) => {
        this.log.error(
          { sop: state.entry.name, error: (err as Error).message },
          "sop-scheduler: execution error",
        );
      });
    }
  }

  /** 执行单个 SOP 并更新状态 */
  private async executeSOP(
    state: ScheduledSOPState,
    trigger: "manual" | "cron" | "event",
    args?: Record<string, unknown>,
  ): Promise<SOPRunRecord> {
    state.running = true;

    try {
      const record = await runSOP({
        filePath: state.entry.filePath,
        sopName: state.entry.name,
        configDir: this.configDir,
        args,
        trigger,
      });

      state.lastRunAtMs = record.finishedAt;
      state.lastStatus = record.status;

      // 重新计算下次运行时间
      if (state.def.schedule) {
        state.nextRunAtMs = computeNextRun(state.def.schedule, this.nowMs());
      }

      this.log.info(
        {
          sop: state.entry.name,
          status: record.status,
          durationMs: record.finishedAt - record.startedAt,
          steps: record.steps.length,
          nextRunAtMs: state.nextRunAtMs,
        },
        "sop-scheduler: execution complete",
      );

      return record;
    } finally {
      state.running = false;
    }
  }

  /** 发现并加载所有 SOP */
  private async loadAllSOPs(): Promise<void> {
    const entries = await discoverSOPs(this.sopsDir);
    const now = this.nowMs();

    for (const entry of entries) {
      // 已加载的跳过 (除非文件可能更新了，暂不做热更新检测)
      if (this.sopStates.has(entry.name)) continue;

      try {
        const def = await loadSOP(entry.filePath);

        // 只要有 schedule 或 triggers 就注册
        if (!def.schedule && (!def.triggers || def.triggers.length === 0)) {
          // 无调度需求，但仍注册用于 runNow
        }

        const nextRunAtMs = def.schedule ? computeNextRun(def.schedule, now) : undefined;

        this.sopStates.set(entry.name, {
          entry,
          def,
          nextRunAtMs,
          running: false,
        });
      } catch (err) {
        this.log.error(
          { sop: entry.name, error: (err as Error).message },
          "sop-scheduler: failed to load SOP",
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cron 工具
// ---------------------------------------------------------------------------

/** 计算 cron 表达式的下次运行时间 */
function computeNextRun(expr: string, nowMs: number): number | undefined {
  try {
    const cron = new Cron(expr, { catch: false });
    const nowSecondMs = Math.floor(nowMs / 1000) * 1000;
    const next = cron.nextRun(new Date(nowSecondMs));
    if (!next) return undefined;
    const nextMs = next.getTime();
    return Number.isFinite(nextMs) && nextMs > nowSecondMs ? nextMs : undefined;
  } catch {
    return undefined;
  }
}
