import nodeFs from "node:fs";
import nodePath from "node:path";
import os from "node:os";
import type { SOPRepairRecord, SOPRunRecord, SOPSourceRun, SOPStepRecord } from "./types.js";

export type HealStrategy = "retry" | "llm-fix";

export type HealResult = {
  strategy: HealStrategy;
  success: boolean;
  retryRecord?: SOPRunRecord;
  fixedCode?: string;
  analysis?: string;
  error?: string;
};

export type HealOptions = {
  failedRecord: SOPRunRecord;
  sopFilePath: string;
  sopMdPath?: string;
  configDir: string;
  sopsDir: string;
  maxRetries?: number;
  llmCall?: (prompt: string) => Promise<string | null>;
  sourceRun?: SOPSourceRun;
};

export async function healSOP(opts: HealOptions): Promise<HealResult> {
  const { failedRecord, maxRetries = 2 } = opts;

  if (isTransientError(failedRecord) && maxRetries > 0) {
    const retryResult = await retryHeal(opts);
    if (retryResult.success) {
      return retryResult;
    }
  }

  if (opts.llmCall) {
    return llmFixHeal(opts);
  }

  return {
    strategy: "retry",
    success: false,
    error: "No heal strategy available. Provide llmCall for LLM-based repair.",
  };
}

async function retryHeal(opts: HealOptions): Promise<HealResult> {
  const { failedRecord, sopFilePath, configDir, maxRetries = 2 } = opts;
  const { runSOP } = await import("./runner.js");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const record = await runSOP({
      filePath: sopFilePath,
      sopName: failedRecord.sopName,
      configDir,
      args: failedRecord.triggerArgs,
      trigger: failedRecord.trigger,
      repair: {
        attempt,
        healedFromRunId: failedRecord.runId,
        healStrategy: "retry",
      },
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

async function llmFixHeal(opts: HealOptions): Promise<HealResult> {
  const { failedRecord, sopFilePath, sopMdPath, configDir, maxRetries = 2, llmCall } = opts;

  if (!llmCall) {
    return {
      strategy: "llm-fix",
      success: false,
      error: "llmCall not provided",
    };
  }

  const { loadSOP, runSOP } = await import("./runner.js");

  let sourceCode: string;
  let specMarkdown = "";
  try {
    sourceCode = await nodeFs.promises.readFile(sopFilePath, "utf-8");
  } catch {
    return {
      strategy: "llm-fix",
      success: false,
      error: `Cannot read SOP file: ${sopFilePath}`,
    };
  }

  if (sopMdPath) {
    try {
      specMarkdown = await nodeFs.promises.readFile(sopMdPath, "utf-8");
    } catch {
      specMarkdown = "";
    }
  }

  let currentSource = sourceCode;
  let latestAnalysis: string | undefined;
  let latestFixedCode: string | undefined;
  let latestError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const prompt = buildFixPrompt({
      sourceCode: currentSource,
      specMarkdown,
      failedRecord,
      attempt,
      sourceRun: opts.sourceRun,
    });
    const response = await llmCall(prompt);
    if (!response) {
      latestError = "LLM returned empty response";
      continue;
    }

    const parsed = parseLLMFixResponse(response);
    latestAnalysis = parsed.analysis;
    latestFixedCode = parsed.fixedCode;

    if (!parsed.fixedCode) {
      latestError = "LLM did not produce valid fix code";
      continue;
    }

    const backupPath = `${sopFilePath}.backup.${Date.now()}.${attempt}`;
    try {
      await nodeFs.promises.copyFile(sopFilePath, backupPath);
      await nodeFs.promises.writeFile(sopFilePath, parsed.fixedCode, "utf-8");
      await loadSOP(sopFilePath);
    } catch (err) {
      latestError = `Static validation failed: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }

    currentSource = parsed.fixedCode;
    const repair: SOPRepairRecord = {
      attempt,
      healedFromRunId: failedRecord.runId,
      healStrategy: "llm-fix",
    };
    const record = await runSOP({
      filePath: sopFilePath,
      sopName: failedRecord.sopName,
      configDir,
      args: failedRecord.triggerArgs,
      trigger: failedRecord.trigger,
      repair,
    });

    if (record.status === "ok") {
      return {
        strategy: "llm-fix",
        success: true,
        retryRecord: record,
        fixedCode: parsed.fixedCode,
        analysis: parsed.analysis,
      };
    }

    latestError = record.error ?? `Repair attempt ${attempt} failed`;
  }

  return {
    strategy: "llm-fix",
    success: false,
    fixedCode: latestFixedCode,
    analysis: latestAnalysis,
    error: latestError ?? `Repair failed after ${maxRetries} attempts`,
  };
}

function isTransientError(record: SOPRunRecord): boolean {
  if (!record.error) {
    return false;
  }

  const err = record.error.toLowerCase();
  return [
    "timeout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "network",
    "fetch failed",
    "dns",
    "etimeout",
    "enotfound",
    "429",
    "503",
    "502",
    "504",
    "timed out",
  ].some((pattern) => err.includes(pattern));
}

function buildFixPrompt(params: {
  sourceCode: string;
  specMarkdown: string;
  failedRecord: SOPRunRecord;
  attempt: number;
  sourceRun?: SOPSourceRun;
}): string {
  const { sourceCode, specMarkdown, failedRecord, attempt, sourceRun } = params;
  const stepsLog = failedRecord.steps.map(formatStepSummary).join("\n");
  const logs = (failedRecord.logs ?? []).map((line) => `  - ${line}`).join("\n");
  const sourceSummary = sourceRun
    ? [
        `- Session: ${sourceRun.sessionKey}`,
        sourceRun.runId ? `- Run ID: ${sourceRun.runId}` : "",
        `- User request: ${sourceRun.userRequest}`,
        sourceRun.finalResponse ? `- Final response: ${sourceRun.finalResponse}` : "",
        sourceRun.replayArgs
          ? `- Replay args: ${JSON.stringify(sourceRun.replayArgs)}`
          : "",
        sourceRun.steps.length > 0
          ? `- Source steps:\n${sourceRun.steps.map((step) => `  - ${step.summary}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "  (source run not available)";

  return `You are repairing an OpenClaw SOP implementation.

Goal:
- Update sop.ts so it satisfies SOP.md.
- Keep the same exported SOP name and shape.
- Preserve working behavior where possible.
- Use real SDK actions and verify checks, not logging-only placeholders.
- Make the minimum code change needed to satisfy the spec and fix the observed failure.

Repair attempt: ${attempt}

SOP.md
\`\`\`md
${specMarkdown || "(missing SOP.md specification)"}
\`\`\`

Current sop.ts
\`\`\`typescript
${sourceCode}
\`\`\`

Latest run result
- SOP: ${failedRecord.sopName}
- Status: ${failedRecord.status}
- Error: ${failedRecord.error ?? "none"}
- Step count: ${failedRecord.steps.length}
- Log count: ${(failedRecord.logs ?? []).length}

Captured successful source run
${sourceSummary}

Step history
${stepsLog || "  (no steps recorded)"}

Run logs
${logs || "  (no logs recorded)"}

Return:
<analysis>short repair analysis</analysis>
<code>full fixed TypeScript source</code>`;
}

function formatStepSummary(step: SOPStepRecord): string {
  const duration = step.finishedAt - step.startedAt;
  return [
    `  - ${step.action}`,
    `status=${step.status}`,
    `durationMs=${duration}`,
    step.error ? `error=${step.error}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function parseLLMFixResponse(response: string): {
  analysis?: string;
  fixedCode?: string;
} {
  const analysisMatch = /<analysis>([\s\S]*?)<\/analysis>/i.exec(response);
  const codeMatch = /<code>([\s\S]*?)<\/code>/i.exec(response);

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

export async function createOpenClawLLMCall(opts: {
  config: unknown;
}): Promise<(prompt: string) => Promise<string | null>> {
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
        timeoutMs: 60_000,
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
          await fsPromises.rm(nodePath.dirname(tempSessionFile), {
            recursive: true,
            force: true,
          });
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  };
}
