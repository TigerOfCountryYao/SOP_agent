/**
 * SOP 控制器
 *
 * 通过 Gateway WebSocket RPC 管理 SOP：
 * - loadSOPs: 调用 sop.list
 * - loadSOPStatus: 调用 sop.status
 * - runSOP: 调用 sop.run
 * - createSOP: 调用 sop.create
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
  schedule?: string;
  triggers?: string[];
  filePath?: string;
  loadError?: boolean;
};

export type SOPsViewPanel = "list" | "status" | "history";

export type SOPListResult = {
  count: number;
  sops: SOPEntry[];
};

export type SOPStatusResult = {
  totalSOPs: number;
  scheduledSOPs: { name: string; schedule: string }[];
  triggeredSOPs: { name: string; triggers: string[] }[];
};

export type SOPRunResult = {
  sopName: string;
  runId: string;
  status: string;
  error?: string;
  stepsCount: number;
  durationMs: number;
  result?: unknown;
};

export type SOPCreateResult = {
  created: boolean;
  mode: string;
  dirPath: string;
  filePath: string;
  mdPath: string;
};

export type SOPHistoryEntry = {
  runId: string;
  status: string;
  startedAt: string;
  durationMs: number;
  stepsCount: number;
  error?: string;
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
  opts: { name: string; description: string; steps?: string[]; schedule?: string },
) {
  if (!state.client || !state.connected) return;
  state.sopsLoading = true;
  state.sopsError = null;
  try {
    await state.client.request<SOPCreateResult>("sop.create", {
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
