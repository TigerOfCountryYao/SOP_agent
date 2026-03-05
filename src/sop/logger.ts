/**
 * SOP Step Logger
 *
 * 记录每个 SDK 调用的执行时间、参数、结果。
 * 供 runner 使用来构建 SOPRunRecord。
 */

import type { SOPStepRecord } from "./types.js";

export class SOPLogger {
  private readonly steps: SOPStepRecord[] = [];
  private readonly logs: string[] = [];

  /** 记录一个步骤的执行 */
  async recordStep<T>(
    action: string,
    params: Record<string, unknown> | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await fn();
      this.steps.push({
        action,
        params,
        startedAt,
        finishedAt: Date.now(),
        status: "ok",
        result: summarizeResult(result),
      });
      return result;
    } catch (err) {
      this.steps.push({
        action,
        params,
        startedAt,
        finishedAt: Date.now(),
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** 添加用户日志 */
  addLog(msg: string): void {
    this.logs.push(`[${new Date().toISOString()}] ${msg}`);
  }

  /** 获取所有步骤记录 */
  getSteps(): SOPStepRecord[] {
    return this.steps.slice();
  }

  /** 获取所有用户日志 */
  getLogs(): string[] {
    return this.logs.slice();
  }
}

/** 摘要化结果，避免日志过大 */
function summarizeResult(result: unknown): unknown {
  if (result === undefined || result === null) {
    return result;
  }
  if (typeof result === "string") {
    return result.length > 200 ? `${result.slice(0, 200)}... (${result.length} chars)` : result;
  }
  if (typeof result === "number" || typeof result === "boolean") {
    return result;
  }
  if (typeof result === "object") {
    try {
      const json = JSON.stringify(result);
      return json.length > 500 ? `${json.slice(0, 500)}... (truncated)` : result;
    } catch {
      return "[non-serializable]";
    }
  }
  return String(result);
}
