import { listAgentIds, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveSOPDirs } from "../../sop/paths.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

async function importSOP() {
  const { discoverSOPs, loadSOP, runSOPByName } = await import("../../sop/runner.js");
  const { generateSOP } = await import("../../sop/generate.js");
  const { loadRunHistory, resolveSOPDataDir } = await import("../../sop/store.js");
  return { discoverSOPs, loadSOP, runSOPByName, generateSOP, loadRunHistory, resolveSOPDataDir };
}

type SOPParams = {
  agentId?: string;
  sopsDir?: string;
  configDir?: string;
};

function resolveSOPTarget(params?: SOPParams) {
  const cfg = loadConfig();
  const agentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
  const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : resolveDefaultAgentId(cfg);
  if (agentIdRaw) {
    const knownAgents = listAgentIds(cfg);
    if (!knownAgents.includes(agentId)) {
      throw new Error(`unknown agent id "${agentIdRaw}"`);
    }
  }
  return resolveSOPDirs({
    config: cfg,
    agentId,
    sopsDir: typeof params?.sopsDir === "string" ? params.sopsDir : undefined,
    dataDir: typeof params?.configDir === "string" ? params.configDir : undefined,
  });
}

export const sopHandlers: GatewayRequestHandlers = {
  "sop.list": async ({ params, respond }) => {
    try {
      const { discoverSOPs, loadSOP } = await importSOP();
      const dirs = resolveSOPTarget(params as SOPParams);
      const entries = await discoverSOPs(dirs.sopsDir);
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

      respond(true, { count: sops.length, sops, agentId: dirs.agentId, sopsDir: dirs.sopsDir }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.list failed: ${message}`));
    }
  },

  "sop.status": async ({ params, respond }) => {
    try {
      const { discoverSOPs, loadSOP } = await importSOP();
      const dirs = resolveSOPTarget(params as SOPParams);
      const entries = await discoverSOPs(dirs.sopsDir);

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
          // Ignore invalid SOPs in status view.
        }
      }

      respond(
        true,
        {
          totalSOPs: entries.length,
          scheduledSOPs: scheduled,
          triggeredSOPs: triggered,
          agentId: dirs.agentId,
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.status failed: ${message}`));
    }
  },

  "sop.run": async ({ params, respond }) => {
    const p = (params ?? {}) as SOPParams & {
      name?: string;
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
      const dirs = resolveSOPTarget(p);
      const record = await runSOPByName(dirs.sopsDir, p.name.trim(), dirs.dataDir, {
        args: p.args,
      });

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
          agentId: dirs.agentId,
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.run failed: ${message}`));
    }
  },

  "sop.create": async ({ params, respond }) => {
    const p = (params ?? {}) as SOPParams & {
      name?: string;
      description?: string;
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
      const dirs = resolveSOPTarget(p);
      const result = await generateSOP({
        name: p.name.trim(),
        description: p.description.trim(),
        sopsDir: dirs.sopsDir,
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
          agentId: dirs.agentId,
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.create failed: ${message}`));
    }
  },

  "sop.history": async ({ params, respond }) => {
    const p = (params ?? {}) as SOPParams & {
      name?: string;
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
      const dirs = resolveSOPTarget(p);
      const dataDir = resolveSOPDataDir(dirs.dataDir, p.name.trim());
      const runs = await loadRunHistory(dataDir);
      const limit = p.limit ?? 20;

      respond(
        true,
        {
          sopName: p.name.trim(),
          totalRuns: runs.length,
          runs: runs.slice(-limit).map((run) => ({
            runId: run.runId,
            status: run.status,
            startedAt: new Date(run.startedAt).toISOString(),
            durationMs: run.finishedAt - run.startedAt,
            stepsCount: run.steps.length,
            error: run.error,
          })),
          agentId: dirs.agentId,
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.history failed: ${message}`));
    }
  },
};
