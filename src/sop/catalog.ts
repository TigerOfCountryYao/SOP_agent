import crypto from "node:crypto";
import { materializeSOP, type SOPSpecModel } from "./generate.js";
import { healSOP } from "./heal.js";
import { loadSOP, loadSOPSpecSummary, runSOP } from "./runner.js";
import { appendRunRecord, loadSOPMeta, resolveSOPDataDir, saveSOPMeta } from "./store.js";
import type {
  SOPMetaRecord,
  SOPRunRecord,
  SOPSchedule,
  SOPSourceRun,
  SOPStatus,
  SOPValidationState,
} from "./types.js";

export async function createSOPFromSourceRun(params: {
  name: string;
  sopsDir: string;
  dataDir: string;
  sourceRun: SOPSourceRun;
  schedule?: SOPSchedule;
  llmCall?: (prompt: string) => Promise<string | null>;
  overwrite?: boolean;
}): Promise<{
  dirPath: string;
  filePath: string;
  mdPath: string;
  mode: "template" | "llm";
  meta: SOPMetaRecord;
}> {
  const spec = buildSpecFromSourceRun({
    name: params.name,
    schedule: params.schedule,
    sourceRun: params.sourceRun,
  });
  const materialized = await materializeSOP({
    spec,
    sopsDir: params.sopsDir,
    llmCall: params.llmCall,
    overwrite: params.overwrite,
  });

  const dataDir = resolveSOPDataDir(params.dataDir, params.name);
  const draftMeta: SOPMetaRecord = {
    version: 1,
    name: params.name,
    status: "draft",
    validation: {
      staticOk: false,
      dynamicOk: false,
    },
    sourceRun: params.sourceRun,
  };
  await saveSOPMeta(dataDir, draftMeta);

  const meta = await validateGeneratedSOP({
    name: params.name,
    filePath: materialized.filePath,
    mdPath: materialized.mdPath,
    dataDir: params.dataDir,
    sourceRun: params.sourceRun,
    llmCall: params.llmCall,
  });

  return {
    ...materialized,
    meta,
  };
}

export async function validateGeneratedSOP(params: {
  name: string;
  filePath: string;
  mdPath: string;
  dataDir: string;
  sourceRun: SOPSourceRun;
  llmCall?: (prompt: string) => Promise<string | null>;
}): Promise<SOPMetaRecord> {
  const dataDir = resolveSOPDataDir(params.dataDir, params.name);
  const existing = (await loadSOPMeta(dataDir)) ?? {
    version: 1 as const,
    name: params.name,
    status: "draft" as const,
    validation: { staticOk: false, dynamicOk: false },
    sourceRun: params.sourceRun,
  };

  const specSummary = await loadSOPSpecSummary(params.mdPath);
  if (!specSummary.hasSpec || !specSummary.specValid) {
    const meta = buildMeta(existing, "failed", {
      staticOk: false,
      dynamicOk: false,
      lastValidatedAt: Date.now(),
      lastError: "SOP.md failed validation",
    });
    await saveSOPMeta(dataDir, meta);
    return meta;
  }

  try {
    await loadSOP(params.filePath);
  } catch (err) {
    const failedRecord = buildSyntheticFailureRecord({
      sopName: params.name,
      error: err instanceof Error ? err.message : String(err),
      triggerArgs: params.sourceRun.replayArgs,
    });
    await appendRunRecord(dataDir, failedRecord);
    return attemptRepair({
      baseMeta: existing,
      failedRecord,
      filePath: params.filePath,
      mdPath: params.mdPath,
      dataDir: params.dataDir,
      sourceRun: params.sourceRun,
      llmCall: params.llmCall,
    });
  }

  const validationRun = await runSOP({
    filePath: params.filePath,
    sopName: params.name,
    configDir: params.dataDir,
    args: params.sourceRun.replayArgs,
    trigger: "manual",
  });
  if (validationRun.status === "ok") {
    const meta = buildMeta(existing, "validated", {
      staticOk: true,
      dynamicOk: true,
      lastValidatedAt: Date.now(),
    });
    await saveSOPMeta(dataDir, meta);
    return meta;
  }

  return attemptRepair({
    baseMeta: existing,
    failedRecord: validationRun,
    filePath: params.filePath,
    mdPath: params.mdPath,
    dataDir: params.dataDir,
    sourceRun: params.sourceRun,
    llmCall: params.llmCall,
  });
}

export async function requireValidatedSOP(dataDirRoot: string, sopName: string): Promise<SOPMetaRecord> {
  const meta = await loadSOPMeta(resolveSOPDataDir(dataDirRoot, sopName));
  if (!meta || meta.status !== "validated") {
    throw new Error(`SOP is not ready: ${sopName}`);
  }
  return meta;
}

function buildSpecFromSourceRun(params: {
  name: string;
  sourceRun: SOPSourceRun;
  schedule?: SOPSchedule;
}): SOPSpecModel {
  const steps = params.sourceRun.steps.map((step, index) => {
    return `Replay source step ${index + 1}: ${step.summary}`;
  });
  const validation = [
    "The SOP must preserve the original execution order captured from the successful task.",
    "Critical actions must keep real SDK calls and follow them with verify.* checks where possible.",
    "The replay result must complete with a non-empty structured return value.",
  ];
  if (params.sourceRun.replayArgs && Object.keys(params.sourceRun.replayArgs).length > 0) {
    validation.push(
      `The SOP must remain replayable with these captured args: ${JSON.stringify(params.sourceRun.replayArgs)}`,
    );
  }

  return {
    name: params.name,
    description: params.sourceRun.userRequest,
    objective: params.sourceRun.userRequest,
    prerequisites: [
      "This SOP was captured from a previously successful agent task.",
      "The runtime must have the same tools available as the source task.",
      "The caller should preserve the captured replay inputs unless intentionally changing the workflow.",
    ],
    inputs: Object.entries(params.sourceRun.replayArgs ?? {}).map(
      ([key, value]) => `\`ctx.args.${key}\` defaults to ${JSON.stringify(value)}`,
    ),
    outputs: [
      "A structured summary of the replayed workflow.",
      "Any artifacts or URLs captured during validation.",
    ],
    steps: steps.length > 0
      ? steps
      : ["Replay the source task using the captured runtime inputs and verify the result."],
    validation,
    recovery: [
      "If replay fails, repair sop.ts against this SOP.md and the captured source execution trace.",
      "Prefer the minimum code change that restores the original successful behavior.",
      "Re-run static load checks and dynamic replay after each repair attempt.",
    ],
    done: [
      "The replay finishes successfully using the captured source inputs.",
      "The returned result describes the completed task in a structured object.",
      "The implementation remains aligned with the captured successful run.",
    ],
    schedule: params.schedule,
  };
}

async function attemptRepair(params: {
  baseMeta: SOPMetaRecord;
  failedRecord: SOPRunRecord;
  filePath: string;
  mdPath: string;
  dataDir: string;
  sourceRun: SOPSourceRun;
  llmCall?: (prompt: string) => Promise<string | null>;
}): Promise<SOPMetaRecord> {
  const dataDir = resolveSOPDataDir(params.dataDir, params.baseMeta.name);
  const repairingMeta: SOPMetaRecord = {
    ...params.baseMeta,
    status: "repairing",
    validation: {
      staticOk: false,
      dynamicOk: false,
      lastValidatedAt: Date.now(),
      lastError: params.failedRecord.error,
    },
    repair: {
      attempt: (params.baseMeta.repair?.attempt ?? 0) + 1,
      status: "repairing",
      lastError: params.failedRecord.error,
      lastAttemptAt: Date.now(),
    },
  };
  await saveSOPMeta(dataDir, repairingMeta);

  const healed = await healSOP({
    failedRecord: params.failedRecord,
    sopFilePath: params.filePath,
    sopMdPath: params.mdPath,
    configDir: params.dataDir,
    sopsDir: "",
    llmCall: params.llmCall,
    sourceRun: params.sourceRun,
  });

  if (healed.retryRecord?.status === "ok") {
    const meta: SOPMetaRecord = {
      ...repairingMeta,
      status: "validated",
      validation: {
        staticOk: true,
        dynamicOk: true,
        lastValidatedAt: Date.now(),
      },
      repair: repairingMeta.repair
        ? {
            ...repairingMeta.repair,
            status: "validated",
          }
        : undefined,
    };
    await saveSOPMeta(dataDir, meta);
    return meta;
  }

  const meta: SOPMetaRecord = {
    ...repairingMeta,
    status: "failed",
    validation: {
      staticOk: false,
      dynamicOk: false,
      lastValidatedAt: Date.now(),
      lastError: healed.error ?? params.failedRecord.error ?? "Validation failed",
    },
    repair: repairingMeta.repair
      ? {
          ...repairingMeta.repair,
          status: "failed",
          lastError: healed.error ?? params.failedRecord.error,
          lastAttemptAt: Date.now(),
        }
      : undefined,
  };
  await saveSOPMeta(dataDir, meta);
  return meta;
}

function buildMeta(
  baseMeta: SOPMetaRecord,
  status: SOPStatus,
  validation: SOPValidationState,
): SOPMetaRecord {
  return {
    ...baseMeta,
    status,
    validation,
  };
}

function buildSyntheticFailureRecord(params: {
  sopName: string;
  error: string;
  triggerArgs?: Record<string, unknown>;
}): SOPRunRecord {
  const now = Date.now();
  return {
    sopName: params.sopName,
    runId: crypto.randomUUID(),
    startedAt: now,
    finishedAt: now,
    status: "error",
    error: params.error,
    steps: [],
    logs: ["Static validation failed immediately after SOP generation."],
    trigger: "manual",
    triggerArgs: params.triggerArgs,
  };
}
