import { Type } from "@sinclair/typebox";
import type { SOPSchedule, SOPWeekday } from "../../sop/types.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const SOP_ACTIONS = [
  "list",
  "listAll",
  "status",
  "run",
  "createFromRun",
  "validate",
  "repair",
  "update",
  "history",
] as const;

const SOPToolSchema = Type.Object({
  action: stringEnum(SOP_ACTIONS),
  name: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String()),
  runId: Type.Optional(Type.String()),
  args: Type.Optional(Type.Object({}, { additionalProperties: true })),
  scheduleDays: Type.Optional(Type.Array(Type.String())),
  scheduleTime: Type.Optional(Type.String()),
  clearSchedule: Type.Optional(Type.Boolean()),
  triggers: Type.Optional(Type.Array(Type.String())),
});

type SOPToolOptions = {
  sopsDir?: string;
  configDir?: string;
  config?: unknown;
};

export function createSOPTool(opts?: SOPToolOptions): AnyAgentTool {
  const sopsDir = opts?.sopsDir ?? "sops";
  const configDir = opts?.configDir ?? ".openclaw/sop";

  return {
    label: "SOP",
    name: "sop",
    description: `Manage SOPs (Standard Operating Procedures) as executable automation workflows.

ACTIONS:
- list: list published SOPs only
- listAll: list published plus draft/repairing/failed SOPs
- status: show weekly schedule status and event triggers
- run: execute a SOP by name
- createFromRun: publish a SOP from a successful task session
- validate: re-run static and dynamic validation for a SOP
- repair: force a repair/validation cycle for a SOP
- update: update an existing SOP schedule
- history: view recent run history

SOPs use two files per directory:
- sop.ts: executable automation implementation
- SOP.md: workflow spec used for generation and repair

Formal SOPs must come from a successful task. Do not create a formal SOP before the task has completed successfully.
Runs automatically attempt repair using SOP.md when execution fails.`,
    parameters: SOPToolSchema,
    execute: async (_toolCallId, rawArgs) => {
      const params = rawArgs as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "list": {
          const { discoverSOPs, loadSOP } = await import("../../sop/runner.js");
          const { formatSOPSchedule } = await import("../../sop/schedule.js");
          const { loadSOPMeta, resolveSOPDataDir } = await import("../../sop/store.js");
          const entries = await discoverSOPs(sopsDir);
          const sops = await Promise.all(
            entries.map(async (entry) => {
              const meta = await loadSOPMeta(resolveSOPDataDir(configDir, entry.name));
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
                  schedule: def.schedule
                    ? { ...def.schedule, label: formatSOPSchedule(def.schedule) }
                    : undefined,
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
          return jsonResult({ count: filtered.length, sops: filtered });
        }

        case "listAll": {
          const { discoverSOPs, loadSOP } = await import("../../sop/runner.js");
          const { formatSOPSchedule } = await import("../../sop/schedule.js");
          const { loadSOPMeta, resolveSOPDataDir } = await import("../../sop/store.js");
          const entries = await discoverSOPs(sopsDir);
          const sops = await Promise.all(
            entries.map(async (entry) => {
              const meta = await loadSOPMeta(resolveSOPDataDir(configDir, entry.name));
              try {
                const def = await loadSOP(entry.filePath);
                return {
                  name: entry.name,
                  description: entry.description ?? def.description,
                  version: entry.version ?? def.version,
                  status: meta?.status ?? "failed",
                  validation: meta?.validation,
                  repair: meta?.repair,
                  schedule: def.schedule
                    ? { ...def.schedule, label: formatSOPSchedule(def.schedule) }
                    : undefined,
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
          return jsonResult({ count: sops.length, sops });
        }

        case "status": {
          const { discoverSOPs, loadSOP } = await import("../../sop/runner.js");
          const { formatSOPSchedule } = await import("../../sop/schedule.js");
          const { loadSOPMeta, resolveSOPDataDir } = await import("../../sop/store.js");
          const entries = await discoverSOPs(sopsDir);
          const scheduled: { name: string; schedule: SOPSchedule; scheduleLabel: string }[] = [];
          const triggered: { name: string; triggers: string[] }[] = [];
          let validatedCount = 0;

          for (const entry of entries) {
            const meta = await loadSOPMeta(resolveSOPDataDir(configDir, entry.name));
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
              // Ignore invalid SOPs in status output.
            }
          }

          return jsonResult({
            totalSOPs: validatedCount,
            scheduledSOPs: scheduled,
            triggeredSOPs: triggered,
          });
        }

        case "run": {
          const name = readStringParam(params, "name", { required: true });
          const args = (params.args as Record<string, unknown>) ?? {};
          const { requireValidatedSOP } = await import("../../sop/catalog.js");
          const { createOpenClawLLMCall } = await import("../../sop/heal.js");
          const { runSOPByName } = await import("../../sop/runner.js");
          await requireValidatedSOP(configDir, name);
          const llmCall = opts?.config
            ? await createOpenClawLLMCall({ config: opts.config })
            : undefined;
          const record = await runSOPByName(sopsDir, name, configDir, {
            args,
            autoHeal: {
              enabled: true,
              llmCall,
            },
          });
          return jsonResult({
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
          });
        }

        case "createFromRun": {
          const name = readStringParam(params, "name", { required: true });
          const sessionKey = readStringParam(params, "sessionKey", { required: true });
          const schedule = buildWeeklySchedule(
            Array.isArray(params.scheduleDays) ? (params.scheduleDays as string[]) : undefined,
            typeof params.scheduleTime === "string" ? params.scheduleTime : undefined,
          );
          const { createOpenClawLLMCall } = await import("../../sop/heal.js");
          const { createSOPFromSourceRun } = await import("../../sop/catalog.js");
          const { captureSuccessfulRunFromSession } = await import("../../sop/source-run.js");
          const sourceRun = await captureSuccessfulRunFromSession({
            sessionKey,
            runId: typeof params.runId === "string" ? params.runId : undefined,
          });
          const llmCall = opts?.config
            ? await createOpenClawLLMCall({ config: opts.config })
            : undefined;
          const result = await createSOPFromSourceRun({
            name,
            sopsDir,
            dataDir: configDir,
            sourceRun,
            schedule,
            llmCall,
          });

          return jsonResult({
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
          });
        }

        case "validate":
        case "repair": {
          const name = readStringParam(params, "name", { required: true });
          const { discoverSOPs } = await import("../../sop/runner.js");
          const { loadSOPMeta, resolveSOPDataDir } = await import("../../sop/store.js");
          const { validateGeneratedSOP } = await import("../../sop/catalog.js");
          const { createOpenClawLLMCall } = await import("../../sop/heal.js");
          const entry = (await discoverSOPs(sopsDir)).find((candidate) => candidate.name === name);
          if (!entry) {
            throw new Error(`SOP not found: ${name}`);
          }
          const meta = await loadSOPMeta(resolveSOPDataDir(configDir, name));
          if (!meta) {
            throw new Error(`SOP metadata not found: ${name}`);
          }
          const llmCall = opts?.config
            ? await createOpenClawLLMCall({ config: opts.config })
            : undefined;
          const validated = await validateGeneratedSOP({
            name,
            filePath: entry.filePath,
            mdPath: entry.mdPath,
            dataDir: configDir,
            sourceRun: meta.sourceRun,
            llmCall,
          });
          return jsonResult({
            sopName: name,
            status: validated.status,
            validation: validated.validation,
            repair: validated.repair,
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
            runs: runs.slice(-10).map((run) => ({
              runId: run.runId,
              status: run.status,
              startedAt: new Date(run.startedAt).toISOString(),
              durationMs: run.finishedAt - run.startedAt,
              stepsCount: run.steps.length,
              logsCount: run.logs?.length ?? 0,
              error: run.error,
              repair: run.repair,
            })),
          });
        }

        case "update": {
          const name = readStringParam(params, "name", { required: true });
          const schedule = buildWeeklySchedule(
            Array.isArray(params.scheduleDays) ? (params.scheduleDays as string[]) : undefined,
            typeof params.scheduleTime === "string" ? params.scheduleTime : undefined,
          );
          const clearSchedule =
            params.clearSchedule === true ||
            (!schedule && (!params.scheduleDays || (params.scheduleDays as unknown[]).length === 0));

          const { discoverSOPs, loadSOP } = await import("../../sop/runner.js");
          const { formatSOPSchedule } = await import("../../sop/schedule.js");
          const { requireValidatedSOP } = await import("../../sop/catalog.js");
          const { updateSOPSchedule } = await import("../../sop/update.js");
          const entries = await discoverSOPs(sopsDir);
          const entry = entries.find((candidate) => candidate.name === name);
          if (!entry) {
            throw new Error(`SOP not found: ${name}`);
          }
          await requireValidatedSOP(configDir, name);

          await updateSOPSchedule(entry.filePath, clearSchedule ? undefined : schedule);
          const def = await loadSOP(entry.filePath);
          return jsonResult({
            updated: true,
            sopName: name,
            schedule: def.schedule,
            scheduleLabel: def.schedule ? formatSOPSchedule(def.schedule) : undefined,
          });
        }

        default:
          throw new Error(`Unknown SOP action: ${action}`);
      }
    },
  };
}

function buildWeeklySchedule(days?: string[], time?: string): SOPSchedule | undefined {
  const normalizedDays = (days ?? [])
    .map((day) => day.trim().toLowerCase())
    .filter((day): day is SOPWeekday => isWeekday(day));
  const normalizedTime = time?.trim();
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
