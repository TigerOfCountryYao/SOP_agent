/**
 * SOP Self-Healing
 *
 * 当 SOP 执行失败时，提供多种恢复策略：
 * 1. 重试 — 简单重新执行 (适用于临时网络/超时错误)
 * 2. 回退 — 使用上一个成功的运行参数 (store 中保存)
 * 3. LLM 修复 — 发送失败上下文给 LLM，生成修复后的 SOP 代码
 *
 * LLM 修复使用 runEmbeddedPiAgent (和 llm-slug-generator 相同的模式)。
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import os from "node:os";

import type { SOPRunRecord, SOPStepRecord } from "./types.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 自愈策略 */
export type HealStrategy = "retry" | "llm-fix";

/** 自愈结果 */
export type HealResult = {
  strategy: HealStrategy;
  success: boolean;
  /** 修复后的运行记录 (如果重新执行了) */
  retryRecord?: SOPRunRecord;
  /** LLM 生成的修复代码 (如果使用了 llm-fix) */
  fixedCode?: string;
  /** LLM 分析报告 */
  analysis?: string;
  error?: string;
};

/** 自愈选项 */
export type HealOptions = {
  /** 失败的运行记录 */
  failedRecord: SOPRunRecord;
  /** SOP 文件路径 */
  sopFilePath: string;
  /** 配置目录 */
  configDir: string;
  /** SOP 目录 */
  sopsDir: string;
  /** 最大重试次数 (默认 2) */
  maxRetries?: number;
  /** LLM 修复函数 (由上层注入，避免直接依赖 OpenClaw config) */
  llmCall?: (prompt: string) => Promise<string | null>;
};

// ---------------------------------------------------------------------------
// 自愈入口
// ---------------------------------------------------------------------------

/** 根据失败记录自动选择并执行自愈策略 */
export async function healSOP(opts: HealOptions): Promise<HealResult> {
  const { failedRecord, maxRetries = 2 } = opts;

  // 策略1: 判断是否是临时错误 → 重试
  if (isTransientError(failedRecord) && maxRetries > 0) {
    return await retryHeal(opts);
  }

  // 策略2: LLM 修复 (需要 llmCall)
  if (opts.llmCall) {
    return await llmFixHeal(opts);
  }

  // 无法自愈
  return {
    strategy: "retry",
    success: false,
    error: "No heal strategy available. Provide llmCall for LLM-based repair.",
  };
}

// ---------------------------------------------------------------------------
// 策略1: 重试
// ---------------------------------------------------------------------------

async function retryHeal(opts: HealOptions): Promise<HealResult> {
  const { failedRecord, sopFilePath, configDir, maxRetries = 2 } = opts;

  // 动态导入 runner 避免循环依赖
  const { runSOP } = await import("./runner.js");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 指数退避
    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const record = await runSOP({
      filePath: sopFilePath,
      sopName: failedRecord.sopName,
      configDir,
      args: failedRecord.triggerArgs,
      trigger: failedRecord.trigger,
    });

    if (record.status === "ok") {
      return {
        strategy: "retry",
        success: true,
        retryRecord: record,
      };
    }
  }

  return {
    strategy: "retry",
    success: false,
    error: `Failed after ${maxRetries} retries`,
  };
}

// ---------------------------------------------------------------------------
// 策略2: LLM 修复
// ---------------------------------------------------------------------------

async function llmFixHeal(opts: HealOptions): Promise<HealResult> {
  const { failedRecord, sopFilePath, llmCall } = opts;

  if (!llmCall) {
    return {
      strategy: "llm-fix",
      success: false,
      error: "llmCall not provided",
    };
  }

  // 读取当前 SOP 源代码
  let sourceCode: string;
  try {
    sourceCode = await nodeFs.promises.readFile(sopFilePath, "utf-8");
  } catch {
    return {
      strategy: "llm-fix",
      success: false,
      error: `Cannot read SOP file: ${sopFilePath}`,
    };
  }

  // 构建上下文给 LLM
  const prompt = buildFixPrompt(sourceCode, failedRecord);

  // 调用 LLM
  const response = await llmCall(prompt);
  if (!response) {
    return {
      strategy: "llm-fix",
      success: false,
      error: "LLM returned empty response",
    };
  }

  // 解析 LLM 响应
  const parsed = parseLLMFixResponse(response);

  if (parsed.fixedCode) {
    // 写入修复后的代码
    const backupPath = `${sopFilePath}.backup.${Date.now()}`;
    try {
      await nodeFs.promises.copyFile(sopFilePath, backupPath);
      await nodeFs.promises.writeFile(sopFilePath, parsed.fixedCode, "utf-8");
    } catch (writeErr) {
      return {
        strategy: "llm-fix",
        success: false,
        fixedCode: parsed.fixedCode,
        analysis: parsed.analysis,
        error: `Failed to write fixed code: ${(writeErr as Error).message}`,
      };
    }

    return {
      strategy: "llm-fix",
      success: true,
      fixedCode: parsed.fixedCode,
      analysis: parsed.analysis,
    };
  }

  return {
    strategy: "llm-fix",
    success: false,
    analysis: parsed.analysis,
    error: "LLM did not produce valid fix code",
  };
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 判断是否是临时性错误 (网络、超时等) */
function isTransientError(record: SOPRunRecord): boolean {
  if (!record.error) return false;
  const err = record.error.toLowerCase();
  const transientPatterns = [
    "timeout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "network",
    "fetch failed",
    "dns",
    "etimeout",
    "enotfound",
    "429",             // rate limit
    "503",             // service unavailable
    "502",             // bad gateway
    "504",             // gateway timeout
    "timed out",
  ];
  return transientPatterns.some((p) => err.includes(p));
}

/** 构建 LLM 修复提示词 */
function buildFixPrompt(sourceCode: string, failedRecord: SOPRunRecord): string {
  const stepsLog = failedRecord.steps
    .map((s: SOPStepRecord) => {
      const status = s.status === "ok" ? "✓" : "✗";
      const duration = s.finishedAt - s.startedAt;
      const error = s.error ? ` | Error: ${s.error}` : "";
      return `  ${status} ${s.action} (${duration}ms)${error}`;
    })
    .join("\n");

  return `你是一个 SOP (Standard Operating Procedure) 代码修复专家。

一个自动化 SOP 在执行过程中失败了。请分析错误原因并生成修复后的完整代码。

## 当前 SOP 代码

\`\`\`typescript
${sourceCode}
\`\`\`

## 执行结果

- **SOP名称**: ${failedRecord.sopName}
- **状态**: ${failedRecord.status}
- **错误**: ${failedRecord.error ?? "无"}
- **总步骤数**: ${failedRecord.steps.length}
- **步骤执行日志**:
${stepsLog || "  (无步骤记录)"}

## 要求

1. 分析失败原因
2. 生成修复后的 **完整** SOP 代码 (保持相同的 import 和 export default 结构)
3. 在修复部分添加注释说明改动
4. 确保版本号 +1 (如有 version 字段)

## 输出格式

先用 <analysis> 标签输出分析，再用 <code> 标签输出完整修复代码：

<analysis>
你的分析...
</analysis>

<code>
修复后的完整 TypeScript 代码...
</code>`;
}

/** 解析 LLM 返回的修复响应 */
function parseLLMFixResponse(response: string): {
  analysis?: string;
  fixedCode?: string;
} {
  const analysisMatch = /<analysis>([\s\S]*?)<\/analysis>/i.exec(response);
  const codeMatch = /<code>([\s\S]*?)<\/code>/i.exec(response);

  // 如果没有 <code> 标签，尝试提取 ```typescript 代码块
  let fixedCode = codeMatch?.[1]?.trim();
  if (!fixedCode) {
    const mdMatch = /```(?:typescript|ts)\n([\s\S]*?)```/i.exec(response);
    fixedCode = mdMatch?.[1]?.trim();
  }

  return {
    analysis: analysisMatch?.[1]?.trim(),
    fixedCode,
  };
}

// ---------------------------------------------------------------------------
// LLM 调用工厂 (与 OpenClaw 集成时使用)
// ---------------------------------------------------------------------------

/** 创建一个使用 runEmbeddedPiAgent 的 LLM 调用函数 */
export async function createOpenClawLLMCall(opts: {
  config: unknown; // OpenClawConfig (避免直接引用类型)
}): Promise<(prompt: string) => Promise<string | null>> {
  // 延迟导入避免硬依赖
  const { resolveDefaultAgentId, resolveAgentWorkspaceDir, resolveAgentDir } =
    await import("../agents/agent-scope.js");
  const { runEmbeddedPiAgent } = await import("../agents/pi-embedded.js");
  const fsPromises = nodeFs.promises;

  const config = opts.config as {
    agents?: { defaultAgentId?: string };
  };

  return async (prompt: string): Promise<string | null> => {
    let tempSessionFile: string | null = null;

    try {
      const agentId = resolveDefaultAgentId(config as never);
      const workspaceDir = resolveAgentWorkspaceDir(config as never, agentId);
      const agentDir = resolveAgentDir(config as never, agentId);

      const tempDir = await fsPromises.mkdtemp(nodePath.join(os.tmpdir(), "openclaw-sop-heal-"));
      tempSessionFile = nodePath.join(tempDir, "session.jsonl");

      const result = await runEmbeddedPiAgent({
        sessionId: `sop-heal-${Date.now()}`,
        sessionKey: "temp:sop-heal",
        agentId,
        sessionFile: tempSessionFile,
        workspaceDir,
        agentDir,
        config: config as never,
        prompt,
        timeoutMs: 60_000, // 60 秒超时 (修复代码需要更多时间)
        runId: `sop-heal-${Date.now()}`,
      });

      if (result.payloads && result.payloads.length > 0) {
        return result.payloads[0]?.text ?? null;
      }

      return null;
    } catch (err) {
      console.error("[sop-heal] LLM call failed:", err);
      return null;
    } finally {
      if (tempSessionFile) {
        try {
          await fsPromises.rm(nodePath.dirname(tempSessionFile), { recursive: true, force: true });
        } catch {
          // 忽略清理错误
        }
      }
    }
  };
}
