/**
 * SOP Gateway RPC Handlers
 *
 * 提供 WebSocket RPC 方法供 Control UI（前端）调用：
 * - sop.list: 列出所有 SOP
 * - sop.status: 查看调度状态
 * - sop.run: 执行 SOP
 * - sop.create: 生成新 SOP
 * - sop.history: 查看运行历史
 */

import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

// 延迟导入 SOP 模块，避免影响 gateway 启动速度
async function importSOP() {
  const { discoverSOPs, loadSOP, runSOPByName } = await import("../../sop/runner.js");
  const { generateSOP } = await import("../../sop/generate.js");
  const { loadRunHistory, resolveSOPDataDir } = await import("../../sop/store.js");
  return { discoverSOPs, loadSOP, runSOPByName, generateSOP, loadRunHistory, resolveSOPDataDir };
}

/** 默认 SOP 目录 */
const DEFAULT_SOPS_DIR = "sops";
/** 默认 SOP 配置目录 */
const DEFAULT_CONFIG_DIR = ".openclaw/sop";

export const sopHandlers: GatewayRequestHandlers = {
  "sop.list": async ({ params, respond }) => {
    try {
      const { discoverSOPs, loadSOP } = await importSOP();
      const p = (params ?? {}) as { sopsDir?: string };
      const sopsDir = p.sopsDir ?? DEFAULT_SOPS_DIR;
      const entries = await discoverSOPs(sopsDir);

      // 加载每个 SOP 的定义获取完整信息
      const sops = await Promise.all(
        entries.map(async (entry) => {
          try {
            const def = await loadSOP(entry.filePath);
            return {
              name: entry.name,
              description: entry.description ?? def.description,
              version: entry.version ?? def.version,
              schedule: def.schedule,
              triggers: def.triggers,
              filePath: entry.filePath,
            };
          } catch {
            return {
              name: entry.name,
              description: entry.description,
              version: entry.version,
              filePath: entry.filePath,
              loadError: true,
            };
          }
        }),
      );

      respond(true, { count: sops.length, sops }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sop.list failed: ${String(err)}`),
      );
    }
  },

  "sop.status": async ({ params, respond }) => {
    try {
      const { discoverSOPs, loadSOP } = await importSOP();
      const p = (params ?? {}) as { sopsDir?: string };
      const sopsDir = p.sopsDir ?? DEFAULT_SOPS_DIR;
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

      respond(
        true,
        { totalSOPs: entries.length, scheduledSOPs: scheduled, triggeredSOPs: triggered },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sop.status failed: ${String(err)}`),
      );
    }
  },

  "sop.run": async ({ params, respond }) => {
    const p = (params ?? {}) as {
      name?: string;
      sopsDir?: string;
      configDir?: string;
      args?: Record<string, unknown>;
    };

    if (!p.name?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.run requires 'name' parameter"),
      );
      return;
    }

    try {
      const { runSOPByName } = await importSOP();
      const record = await runSOPByName(
        p.sopsDir ?? DEFAULT_SOPS_DIR,
        p.name.trim(),
        p.configDir ?? DEFAULT_CONFIG_DIR,
        { args: p.args },
      );

      respond(
        true,
        {
          sopName: record.sopName,
          runId: record.runId,
          status: record.status,
          error: record.error,
          stepsCount: record.steps.length,
          durationMs: record.finishedAt - record.startedAt,
          result: record.result,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sop.run failed: ${String(err)}`),
      );
    }
  },

  "sop.create": async ({ params, respond }) => {
    const p = (params ?? {}) as {
      name?: string;
      description?: string;
      sopsDir?: string;
      steps?: string[];
      schedule?: string;
      triggers?: string[];
    };

    if (!p.name?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.create requires 'name' parameter"),
      );
      return;
    }
    if (!p.description?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.create requires 'description' parameter"),
      );
      return;
    }

    try {
      const { generateSOP } = await importSOP();
      const result = await generateSOP({
        name: p.name.trim(),
        description: p.description.trim(),
        sopsDir: p.sopsDir ?? DEFAULT_SOPS_DIR,
        steps: p.steps,
        schedule: p.schedule,
        triggers: p.triggers,
      });

      respond(
        true,
        {
          created: true,
          mode: result.mode,
          dirPath: result.dirPath,
          filePath: result.filePath,
          mdPath: result.mdPath,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sop.create failed: ${String(err)}`),
      );
    }
  },

  "sop.history": async ({ params, respond }) => {
    const p = (params ?? {}) as {
      name?: string;
      configDir?: string;
      limit?: number;
    };

    if (!p.name?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.history requires 'name' parameter"),
      );
      return;
    }

    try {
      const { loadRunHistory, resolveSOPDataDir } = await importSOP();
      const dataDir = resolveSOPDataDir(p.configDir ?? DEFAULT_CONFIG_DIR, p.name.trim());
      const runs = await loadRunHistory(dataDir);
      const limit = p.limit ?? 20;

      respond(
        true,
        {
          sopName: p.name.trim(),
          totalRuns: runs.length,
          runs: runs.slice(-limit).map((r) => ({
            runId: r.runId,
            status: r.status,
            startedAt: new Date(r.startedAt).toISOString(),
            durationMs: r.finishedAt - r.startedAt,
            stepsCount: r.steps.length,
            error: r.error,
          })),
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sop.history failed: ${String(err)}`),
      );
    }
  },
};
