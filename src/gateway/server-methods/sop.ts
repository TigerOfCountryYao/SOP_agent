import { listAgentIds, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveSOPDirs } from "../../sop/paths.js";
import type { SOPSchedule, SOPWeekday } from "../../sop/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

async function importSOP() {
  const { discoverSOPs, loadSOP, runSOPByName } = await import("../../sop/runner.js");
  const { loadRunHistory, resolveSOPDataDir, loadSOPMeta } = await import("../../sop/store.js");
  const { createOpenClawLLMCall } = await import("../../sop/heal.js");
  const {
    createSOPFromSourceRun,
    validateGeneratedSOP,
    requireValidatedSOP,
  } = await import("../../sop/catalog.js");
  const { captureSuccessfulRunFromSession } = await import("../../sop/source-run.js");
  return {
    discoverSOPs,
    loadSOP,
    runSOPByName,
    loadRunHistory,
    resolveSOPDataDir,
    loadSOPMeta,
    createOpenClawLLMCall,
    createSOPFromSourceRun,
    validateGeneratedSOP,
    requireValidatedSOP,
    captureSuccessfulRunFromSession,
  };
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
      const { discoverSOPs, loadSOP, loadSOPMeta, resolveSOPDataDir } = await importSOP();
      const { formatSOPSchedule } = await import("../../sop/schedule.js");
      const dirs = resolveSOPTarget(params as SOPParams);
      const entries = await discoverSOPs(dirs.sopsDir);
      const sops = await Promise.all(
        entries.map(async (entry) => {
          const meta = await loadSOPMeta(resolveSOPDataDir(dirs.dataDir, entry.name));
          if (!meta || meta.status !== "validated") {
            return null;
          }
          try {
            const def = await loadSOP(entry.filePath);
            return {
              name: entry.name,
              description: entry.description ?? def.description,
              version: entry.version ?? def.version,
              status: meta.status,
              validation: meta.validation,
              repair: meta.repair,
              schedule: def.schedule,
              scheduleLabel: def.schedule ? formatSOPSchedule(def.schedule) : undefined,
              triggers: def.triggers,
              filePath: entry.filePath,
              mdPath: entry.mdPath,
              loadError: false,
            };
          } catch (err) {
            return {
              name: entry.name,
              description: entry.description,
              version: entry.version,
              status: meta.status,
              validation: meta.validation,
              repair: meta.repair,
              filePath: entry.filePath,
              mdPath: entry.mdPath,
              loadError: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      const filtered = sops.filter((item): item is NonNullable<typeof item> => item !== null);
      respond(true, { count: filtered.length, sops: filtered, agentId: dirs.agentId, sopsDir: dirs.sopsDir }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.list failed: ${message}`));
    }
  },

  "sop.listAll": async ({ params, respond }) => {
    try {
      const { discoverSOPs, loadSOP, loadSOPMeta, resolveSOPDataDir } = await importSOP();
      const { formatSOPSchedule } = await import("../../sop/schedule.js");
      const dirs = resolveSOPTarget(params as SOPParams);
      const entries = await discoverSOPs(dirs.sopsDir);
      const sops = await Promise.all(
        entries.map(async (entry) => {
          const meta = await loadSOPMeta(resolveSOPDataDir(dirs.dataDir, entry.name));
          try {
            const def = await loadSOP(entry.filePath);
            return {
              name: entry.name,
              description: entry.description ?? def.description,
              version: entry.version ?? def.version,
              status: meta?.status ?? "failed",
              validation: meta?.validation,
              repair: meta?.repair,
              schedule: def.schedule,
              scheduleLabel: def.schedule ? formatSOPSchedule(def.schedule) : undefined,
              triggers: def.triggers,
              filePath: entry.filePath,
              mdPath: entry.mdPath,
              loadError: false,
            };
          } catch (err) {
            return {
              name: entry.name,
              description: entry.description,
              version: entry.version,
              status: meta?.status ?? "failed",
              validation: meta?.validation,
              repair: meta?.repair,
              filePath: entry.filePath,
              mdPath: entry.mdPath,
              loadError: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      respond(true, { count: sops.length, sops, agentId: dirs.agentId, sopsDir: dirs.sopsDir }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.listAll failed: ${message}`));
    }
  },

  "sop.status": async ({ params, respond }) => {
    try {
      const { discoverSOPs, loadSOP, loadSOPMeta, resolveSOPDataDir } = await importSOP();
      const { formatSOPSchedule } = await import("../../sop/schedule.js");
      const dirs = resolveSOPTarget(params as SOPParams);
      const entries = await discoverSOPs(dirs.sopsDir);

      const scheduled: { name: string; schedule: SOPSchedule; scheduleLabel: string }[] = [];
      const triggered: { name: string; triggers: string[] }[] = [];
      let validatedCount = 0;

      for (const entry of entries) {
        const meta = await loadSOPMeta(resolveSOPDataDir(dirs.dataDir, entry.name));
        if (!meta || meta.status !== "validated") {
          continue;
        }
        validatedCount += 1;
        try {
          const def = await loadSOP(entry.filePath);
          if (def.schedule) {
            scheduled.push({
              name: entry.name,
              schedule: def.schedule,
              scheduleLabel: formatSOPSchedule(def.schedule),
            });
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
          totalSOPs: validatedCount,
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
      const { createOpenClawLLMCall, requireValidatedSOP, runSOPByName } = await importSOP();
      const dirs = resolveSOPTarget(p);
      await requireValidatedSOP(dirs.dataDir, p.name.trim());
      const llmCall = await createOpenClawLLMCall({ config: loadConfig() });
      const record = await runSOPByName(dirs.sopsDir, p.name.trim(), dirs.dataDir, {
        args: p.args,
        autoHeal: {
          enabled: true,
          llmCall,
        },
      });

      respond(
        true,
        {
          sopName: record.sopName,
          runId: record.runId,
          status: record.status,
          error: record.error,
          stepsCount: record.steps.length,
          logsCount: record.logs?.length ?? 0,
          durationMs: record.finishedAt - record.startedAt,
          result: record.result,
          repairTriggered: Boolean(record.repair),
          repair: record.repair,
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

  "sop.create": async ({ respond }) => {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "sop.create is no longer supported. Use sop.createFromRun after a successful task.",
      ),
    );
  },

  "sop.createFromRun": async ({ params, respond }) => {
    const p = (params ?? {}) as SOPParams & {
      name?: string;
      sessionKey?: string;
      runId?: string;
      scheduleDays?: string[];
      scheduleTime?: string;
    };

    if (!p.name?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.createFromRun requires 'name' parameter"),
      );
      return;
    }
    if (!p.sessionKey?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.createFromRun requires 'sessionKey' parameter"),
      );
      return;
    }

    try {
      const { captureSuccessfulRunFromSession, createOpenClawLLMCall, createSOPFromSourceRun } =
        await importSOP();
      const dirs = resolveSOPTarget(p);
      const sourceRun = await captureSuccessfulRunFromSession({
        sessionKey: p.sessionKey.trim(),
        runId: p.runId?.trim(),
      });
      const llmCall = await createOpenClawLLMCall({ config: loadConfig() });
      const result = await createSOPFromSourceRun({
        name: p.name.trim(),
        sopsDir: dirs.sopsDir,
        dataDir: dirs.dataDir,
        sourceRun,
        schedule: buildWeeklySchedule(p.scheduleDays, p.scheduleTime),
        llmCall,
      });

      respond(
        true,
        {
          created: true,
          sourceSessionKey: sourceRun.sessionKey,
          sourceRunId: sourceRun.runId,
          mode: result.mode,
          dirPath: result.dirPath,
          filePath: result.filePath,
          mdPath: result.mdPath,
          status: result.meta.status,
          validation: result.meta.validation,
          repair: result.meta.repair,
          agentId: dirs.agentId,
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.createFromRun failed: ${message}`));
    }
  },

  "sop.validate": async ({ params, respond }) => {
    const p = (params ?? {}) as SOPParams & { name?: string };
    if (!p.name?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.validate requires 'name' parameter"),
      );
      return;
    }
    try {
      const { discoverSOPs, loadSOPMeta, resolveSOPDataDir, validateGeneratedSOP, createOpenClawLLMCall } =
        await importSOP();
      const dirs = resolveSOPTarget(p);
      const entry = (await discoverSOPs(dirs.sopsDir)).find((candidate) => candidate.name === p.name?.trim());
      if (!entry) {
        throw new Error(`SOP not found: ${p.name?.trim()}`);
      }
      const meta = await loadSOPMeta(resolveSOPDataDir(dirs.dataDir, entry.name));
      if (!meta) {
        throw new Error(`SOP metadata not found: ${entry.name}`);
      }
      const llmCall = await createOpenClawLLMCall({ config: loadConfig() });
      const validated = await validateGeneratedSOP({
        name: entry.name,
        filePath: entry.filePath,
        mdPath: entry.mdPath,
        dataDir: dirs.dataDir,
        sourceRun: meta.sourceRun,
        llmCall,
      });
      respond(true, { sopName: entry.name, status: validated.status, validation: validated.validation, repair: validated.repair, agentId: dirs.agentId }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.validate failed: ${message}`));
    }
  },

  "sop.repair": async ({ params, respond }) => {
    const p = (params ?? {}) as SOPParams & { name?: string };
    if (!p.name?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.repair requires 'name' parameter"),
      );
      return;
    }
    try {
      const { discoverSOPs, loadSOPMeta, resolveSOPDataDir, validateGeneratedSOP, createOpenClawLLMCall } =
        await importSOP();
      const dirs = resolveSOPTarget(p);
      const entry = (await discoverSOPs(dirs.sopsDir)).find((candidate) => candidate.name === p.name?.trim());
      if (!entry) {
        throw new Error(`SOP not found: ${p.name?.trim()}`);
      }
      const meta = await loadSOPMeta(resolveSOPDataDir(dirs.dataDir, entry.name));
      if (!meta) {
        throw new Error(`SOP metadata not found: ${entry.name}`);
      }
      const llmCall = await createOpenClawLLMCall({ config: loadConfig() });
      const repaired = await validateGeneratedSOP({
        name: entry.name,
        filePath: entry.filePath,
        mdPath: entry.mdPath,
        dataDir: dirs.dataDir,
        sourceRun: meta.sourceRun,
        llmCall,
      });
      respond(true, { sopName: entry.name, status: repaired.status, validation: repaired.validation, repair: repaired.repair, agentId: dirs.agentId }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.repair failed: ${message}`));
    }
  },

  "sop.update": async ({ params, respond }) => {
    const p = (params ?? {}) as SOPParams & {
      name?: string;
      scheduleDays?: string[];
      scheduleTime?: string;
      clearSchedule?: boolean;
    };

    if (!p.name?.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sop.update requires 'name' parameter"),
      );
      return;
    }

    try {
      const { discoverSOPs, loadSOP, requireValidatedSOP } = await importSOP();
      const { formatSOPSchedule } = await import("../../sop/schedule.js");
      const { updateSOPSchedule } = await import("../../sop/update.js");
      const dirs = resolveSOPTarget(p);
      const entries = await discoverSOPs(dirs.sopsDir);
      const entry = entries.find((candidate) => candidate.name === p.name?.trim());
      if (!entry) {
        throw new Error(`SOP not found: ${p.name?.trim()}`);
      }
      await requireValidatedSOP(dirs.dataDir, entry.name);

      const schedule = p.clearSchedule
        ? undefined
        : buildWeeklySchedule(p.scheduleDays, p.scheduleTime);
      await updateSOPSchedule(entry.filePath, schedule);
      const def = await loadSOP(entry.filePath);

      respond(
        true,
        {
          updated: true,
          sopName: entry.name,
          schedule: def.schedule,
          scheduleLabel: def.schedule ? formatSOPSchedule(def.schedule) : undefined,
          agentId: dirs.agentId,
        },
        undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith("unknown agent id ") ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, `sop.update failed: ${message}`));
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
            logsCount: run.logs?.length ?? 0,
            error: run.error,
            repair: run.repair,
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

function buildWeeklySchedule(
  days?: string[],
  time?: string,
): SOPSchedule | undefined {
  const normalizedDays = (days ?? [])
    .map((day) => day.trim().toLowerCase())
    .filter((day): day is SOPWeekday => isWeekday(day));
  const normalizedTime = typeof time === "string" ? time.trim() : "";
  if (!normalizedTime || normalizedDays.length === 0) {
    return undefined;
  }
  return {
    kind: "weekly",
    days: normalizedDays,
    time: normalizedTime,
  };
}

function isWeekday(value: string): value is SOPWeekday {
  return [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].includes(value);
}
