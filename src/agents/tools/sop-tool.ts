/**
 * SOP Agent Tool
 *
 * 为 LLM 代理提供 SOP 操作能力：
 * - list: 列出所有可用 SOP
 * - status: 查看调度器状态
 * - run: 执行指定 SOP
 * - create: 生成新 SOP
 * - history: 查看 SOP 运行历史
 */

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SOP_ACTIONS = ["list", "status", "run", "create", "history"] as const;

const SOPToolSchema = Type.Object({
  action: stringEnum(SOP_ACTIONS),
  /** SOP 名称 (run/history 必需) */
  name: Type.Optional(Type.String()),
  /** SOP 描述 (create 必需) */
  description: Type.Optional(Type.String()),
  /** 运行参数 (run 时可选) */
  args: Type.Optional(Type.Object({}, { additionalProperties: true })),
  /** 步骤描述列表 (create 时可选) */
  steps: Type.Optional(Type.Array(Type.String())),
  /** Cron 表达式 (create 时可选) */
  schedule: Type.Optional(Type.String()),
  /** 事件触发列表 (create 时可选) */
  triggers: Type.Optional(Type.Array(Type.String())),
});

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

type SOPToolOptions = {
  /** SOP 目录 */
  sopsDir?: string;
  /** 配置目录 */
  configDir?: string;
};

export function createSOPTool(opts?: SOPToolOptions): AnyAgentTool {
  const sopsDir = opts?.sopsDir ?? "sops";
  const configDir = opts?.configDir ?? ".openclaw/sop";

  return {
    label: "SOP",
    name: "sop",
    description: `Manage SOPs (Standard Operating Procedures) — reusable automated workflows.

ACTIONS:
- list: List all available SOPs with descriptions
- status: Show scheduler status (scheduled + triggered SOPs)
- run: Execute a SOP by name (requires name, optional args)
- create: Generate a new SOP from description (requires name + description, optional steps/schedule/triggers)
- history: View run history for a SOP (requires name)

SOPs are executable TypeScript files in the sops/ directory. Each SOP defines browser, shell, and file system automation steps with verification.`,
    parameters: SOPToolSchema,
    execute: async (_toolCallId, rawArgs) => {
      const params = rawArgs as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "list": {
          const { discoverSOPs } = await import("../../sop/runner.js");
          const entries = await discoverSOPs(sopsDir);
          return jsonResult({
            count: entries.length,
            sops: entries.map((e) => ({
              name: e.name,
              description: e.description,
              version: e.version,
            })),
          });
        }

        case "status": {
          const { discoverSOPs, loadSOP } = await import("../../sop/runner.js");
          const entries = await discoverSOPs(sopsDir);

          const scheduled: { name: string; schedule: string }[] = [];
          const triggered: { name: string; triggers: string[] }[] = [];

          for (const entry of entries) {
            try {
              const def = await loadSOP(entry.filePath);
              if (def.schedule) {
                scheduled.push({ name: entry.name, schedule: def.schedule });
              }
              if (def.triggers?.length) {
                triggered.push({ name: entry.name, triggers: def.triggers });
              }
            } catch {
              // 跳过加载失败的 SOP
            }
          }

          return jsonResult({
            totalSOPs: entries.length,
            scheduledSOPs: scheduled,
            triggeredSOPs: triggered,
          });
        }

        case "run": {
          const name = readStringParam(params, "name", { required: true });
          const args = (params.args as Record<string, unknown>) ?? {};
          const { runSOPByName } = await import("../../sop/runner.js");
          const record = await runSOPByName(sopsDir, name, configDir, { args });
          return jsonResult({
            sopName: record.sopName,
            runId: record.runId,
            status: record.status,
            error: record.error,
            stepsCount: record.steps.length,
            durationMs: record.finishedAt - record.startedAt,
            result: record.result,
          });
        }

        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const description = readStringParam(params, "description", { required: true });
          const steps = Array.isArray(params.steps) ? (params.steps as string[]) : [];
          const schedule = typeof params.schedule === "string" ? params.schedule : undefined;
          const triggers = Array.isArray(params.triggers)
            ? (params.triggers as string[])
            : undefined;

          const { generateSOP } = await import("../../sop/generate.js");
          const result = await generateSOP({
            name,
            description,
            sopsDir,
            steps,
            schedule,
            triggers,
          });

          return jsonResult({
            created: true,
            mode: result.mode,
            dirPath: result.dirPath,
            filePath: result.filePath,
            mdPath: result.mdPath,
          });
        }

        case "history": {
          const name = readStringParam(params, "name", { required: true });
          const { loadRunHistory, resolveSOPDataDir } = await import("../../sop/store.js");
          const dataDir = resolveSOPDataDir(configDir, name);
          const runs = await loadRunHistory(dataDir);

          return jsonResult({
            sopName: name,
            totalRuns: runs.length,
            runs: runs.slice(-10).map((r) => ({
              runId: r.runId,
              status: r.status,
              startedAt: new Date(r.startedAt).toISOString(),
              durationMs: r.finishedAt - r.startedAt,
              stepsCount: r.steps.length,
              error: r.error,
            })),
          });
        }

        default:
          throw new Error(`Unknown SOP action: ${action}`);
      }
    },
  };
}
