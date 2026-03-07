/**
 * SOP 控制器
 *
 * 通过 Gateway WebSocket RPC 管理 SOP：
 * - loadSOPs: 调用 sop.list
 * - loadSOPStatus: 调用 sop.status
 * - runSOP: 调用 sop.run
 * - createSOP: 调用 sop.createFromRun
 * - loadSOPHistory: 调用 sop.history
 */

import type { GatewayBrowserClient } from "../gateway.ts";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type SOPEntry = {
  name: string;
  description?: string;
  version?: string;
  status?: "draft" | "repairing" | "validated" | "failed";
  validation?: {
    staticOk: boolean;
    dynamicOk: boolean;
    lastValidatedAt?: number;
    lastError?: string;
  };
  repair?: {
    attempt: number;
    status: "repairing" | "validated" | "failed";
    lastError?: string;
    lastAttemptAt?: number;
  };
  schedule?: {
    kind: "weekly";
    days: string[];
    time: string;
    label?: string;
  };
  scheduleLabel?: string;
  triggers?: string[];
  filePath?: string;
  mdPath?: string;
  loadError?: string | false;
};

export type SOPsViewPanel = "list" | "status" | "history";

export type SOPListResult = {
  count: number;
  sops: SOPEntry[];
};

export type SOPStatusResult = {
  totalSOPs: number;
  scheduledSOPs: {
    name: string;
    schedule: { kind: "weekly"; days: string[]; time: string };
    scheduleLabel: string;
  }[];
  triggeredSOPs: { name: string; triggers: string[] }[];
};

export type SOPRunResult = {
  sopName: string;
  runId: string;
  status: string;
  error?: string;
  stepsCount: number;
  logsCount?: number;
  durationMs: number;
  result?: unknown;
  repairTriggered?: boolean;
  repair?: {
    attempt: number;
    healedFromRunId: string;
    healStrategy: string;
  };
};

export type SOPUpdateResult = {
  updated: boolean;
  sopName: string;
  schedule?: { kind: "weekly"; days: string[]; time: string };
  scheduleLabel?: string;
};

export type SOPCreateResult = {
  created: boolean;
  mode: string;
  dirPath: string;
  filePath: string;
  mdPath: string;
  sourceSessionKey?: string;
  sourceRunId?: string;
  status?: "draft" | "repairing" | "validated" | "failed";
  validation?: SOPEntry["validation"];
  repair?: SOPEntry["repair"];
};

export type SOPHistoryEntry = {
  runId: string;
  status: string;
  startedAt: string;
  durationMs: number;
  stepsCount: number;
  logsCount?: number;
  error?: string;
  repair?: {
    attempt: number;
    healedFromRunId: string;
    healStrategy: string;
  };
};

export type SOPHistoryResult = {
  sopName: string;
  totalRuns: number;
  runs: SOPHistoryEntry[];
};

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

export type SOPsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sopsAgentId?: string;
  sopsLoading: boolean;
  sopsList: SOPListResult | null;
  sopsError: string | null;
  sopsRunning: string | null;
  sopsRunResult: SOPRunResult | null;
  sopsHistory: SOPHistoryResult | null;
  sopsHistoryName: string;
  sopsStatus: SOPStatusResult | null;
  sopsEditingSchedule: string | null;
  sopsScheduleForm: {
    days: string[];
    time: string;
  };
};

// ---------------------------------------------------------------------------
// 控制器
// ---------------------------------------------------------------------------

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function loadSOPs(state: SOPsState) {
  if (!state.client || !state.connected) return;
  if (state.sopsLoading) return;
  state.sopsLoading = true;
  state.sopsError = null;
  try {
    const res = await state.client.request<SOPListResult>("sop.list", {
      ...(state.sopsAgentId ? { agentId: state.sopsAgentId } : {}),
    });
    if (res) state.sopsList = res;
  } catch (err) {
    state.sopsError = getErrorMessage(err);
  } finally {
    state.sopsLoading = false;
  }
}

export async function loadSOPStatus(state: SOPsState) {
  if (!state.client || !state.connected) return;
  state.sopsLoading = true;
  state.sopsError = null;
  try {
    const res = await state.client.request<SOPStatusResult>("sop.status", {
      ...(state.sopsAgentId ? { agentId: state.sopsAgentId } : {}),
    });
    if (res) state.sopsStatus = res;
  } catch (err) {
    state.sopsError = getErrorMessage(err);
  } finally {
    state.sopsLoading = false;
  }
}

export async function runSOP(state: SOPsState, name: string) {
  if (!state.client || !state.connected) return;
  state.sopsRunning = name;
  state.sopsRunResult = null;
  state.sopsError = null;
  try {
    const res = await state.client.request<SOPRunResult>("sop.run", {
      name,
      ...(state.sopsAgentId ? { agentId: state.sopsAgentId } : {}),
    });
    if (res) state.sopsRunResult = res;
  } catch (err) {
    state.sopsError = getErrorMessage(err);
  } finally {
    state.sopsRunning = null;
  }
}

export async function createSOP(
  state: SOPsState,
  opts: {
    name: string;
    sessionKey: string;
    runId?: string;
    scheduleDays?: string[];
    scheduleTime?: string;
  },
) {
  if (!state.client || !state.connected) return;
  state.sopsLoading = true;
  state.sopsError = null;
  try {
    await state.client.request<SOPCreateResult>("sop.createFromRun", {
      ...opts,
      ...(state.sopsAgentId ? { agentId: state.sopsAgentId } : {}),
    });
    await loadSOPs(state);
  } catch (err) {
    state.sopsError = getErrorMessage(err);
  } finally {
    state.sopsLoading = false;
  }
}

export async function updateSOPSchedule(
  state: SOPsState,
  name: string,
  opts: {
    scheduleDays?: string[];
    scheduleTime?: string;
    clearSchedule?: boolean;
  },
) {
  if (!state.client || !state.connected) return;
  state.sopsLoading = true;
  state.sopsError = null;
  try {
    await state.client.request<SOPUpdateResult>("sop.update", {
      name,
      ...opts,
      ...(state.sopsAgentId ? { agentId: state.sopsAgentId } : {}),
    });
    await Promise.all([loadSOPs(state), loadSOPStatus(state)]);
  } catch (err) {
    state.sopsError = getErrorMessage(err);
  } finally {
    state.sopsLoading = false;
  }
}

export async function loadSOPHistory(state: SOPsState, name: string) {
  if (!state.client || !state.connected) return;
  state.sopsLoading = true;
  state.sopsError = null;
  state.sopsHistoryName = name;
  try {
    const res = await state.client.request<SOPHistoryResult>("sop.history", {
      name,
      ...(state.sopsAgentId ? { agentId: state.sopsAgentId } : {}),
    });
    if (res) state.sopsHistory = res;
  } catch (err) {
    state.sopsError = getErrorMessage(err);
  } finally {
    state.sopsLoading = false;
  }
}
