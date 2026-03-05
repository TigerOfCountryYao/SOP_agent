/**
 * SOP 列表 / 管理页面视图
 *
 * 与 Skills 页面并列，位于 Agent 模块下。
 * 使用与其它 views 相同的 Lit HTML 模板风格。
 */

import { html, nothing } from "lit";
import type {
  SOPEntry,
  SOPListResult,
  SOPRunResult,
  SOPStatusResult,
  SOPHistoryResult,
  SOPsViewPanel,
} from "../controllers/sops.ts";

// ---------------------------------------------------------------------------
// 主视图 Props
// ---------------------------------------------------------------------------

export type SOPsProps = {
  loading: boolean;
  error: string | null;
  sopsList: SOPListResult | null;
  sopsStatus: SOPStatusResult | null;
  sopsRunning: string | null;
  sopsRunResult: SOPRunResult | null;
  sopsHistory: SOPHistoryResult | null;
  sopsHistoryName: string;
  panel: SOPsViewPanel;
  onRefresh: () => void;
  onRun: (name: string) => void;
  onViewHistory: (name: string) => void;
  onPanelChange: (panel: SOPsViewPanel) => void;
  onHistoryNameChange: (name: string) => void;
  onLoadStatus: () => void;
  onLoadHistory: (name: string) => void;
  // Create form
  createForm: SOPCreateForm;
  onCreateFormChange: (patch: Partial<SOPCreateForm>) => void;
  onCreate: () => void;
  showCreate: boolean;
  onToggleCreate: () => void;
};

export type SOPCreateForm = {
  name: string;
  description: string;
  steps: string;
  schedule: string;
};

// ---------------------------------------------------------------------------
// 主渲染入口
// ---------------------------------------------------------------------------

export function renderSOPs(props: SOPsProps) {
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">SOPs</div>
          <div class="card-sub">Standard Operating Procedures — automated multi-step workflows.</div>
        </div>
        <div class="row" style="gap: 6px;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Loading…" : "Refresh"}
          </button>
          <button class="btn primary" @click=${props.onToggleCreate}>
            ${props.showCreate ? "Cancel" : "+ Create"}
          </button>
        </div>
      </div>

      <!-- Sub-navigation -->
      <div class="row" style="gap: 4px; margin-top: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
        ${(["list", "status", "history"] as const).map(
          (p) => html`
            <button
              class="btn${props.panel === p ? " primary" : ""}"
              style="font-size: 12px; padding: 4px 10px;"
              @click=${() => props.onPanelChange(p)}
            >
              ${p === "list" ? "SOPs" : p === "status" ? "Schedule" : "History"}
            </button>
          `,
        )}
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
        : nothing}

      <!-- Create form -->
      ${props.showCreate ? renderCreateForm(props) : nothing}

      <!-- Panels -->
      ${props.panel === "list" ? renderSOPList(props) : nothing}
      ${props.panel === "status" ? renderSOPStatus(props) : nothing}
      ${props.panel === "history" ? renderSOPHistory(props) : nothing}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// SOP 列表
// ---------------------------------------------------------------------------

function renderSOPList(props: SOPsProps) {
  const sops = props.sopsList?.sops ?? [];
  if (sops.length === 0) {
    return html`<div class="muted" style="margin-top: 16px;">No SOPs found. Create one to get started.</div>`;
  }
  return html`
    <div class="list" style="margin-top: 16px;">
      ${sops.map((sop) => renderSOPItem(sop, props))}
    </div>
  `;
}

function renderSOPItem(sop: SOPEntry, props: SOPsProps) {
  const isRunning = props.sopsRunning === sop.name;
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          📋 ${sop.name}
          ${sop.version ? html`<span class="muted" style="font-size: 11px; margin-left: 6px;">v${sop.version}</span>` : nothing}
          ${sop.loadError ? html`<span class="pill danger" style="margin-left: 6px;">Load Error</span>` : nothing}
        </div>
        <div class="list-sub">${sop.description ?? "No description."}</div>
        <div class="row" style="gap: 10px; margin-top: 4px;">
          ${sop.schedule
            ? html`<span class="pill" style="font-size: 11px;">⏱ ${sop.schedule}</span>`
            : nothing}
          ${sop.triggers?.length
            ? html`<span class="pill" style="font-size: 11px;">⚡ ${sop.triggers.join(", ")}</span>`
            : nothing}
        </div>
        ${isRunning
          ? html`<div class="muted" style="margin-top: 6px;">Running…</div>`
          : nothing}
        ${!isRunning && props.sopsRunResult?.sopName === sop.name
          ? renderRunResult(props.sopsRunResult)
          : nothing}
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; gap: 6px;">
          <button
            class="btn primary"
            ?disabled=${isRunning || !!props.sopsRunning}
            @click=${() => props.onRun(sop.name)}
          >
            ${isRunning ? "Running…" : "▶ Run"}
          </button>
          <button class="btn" @click=${() => props.onViewHistory(sop.name)}>
            History
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderRunResult(result: SOPRunResult) {
  const isOk = result.status === "ok";
  return html`
    <div class="callout ${isOk ? "" : "danger"}" style="margin-top: 8px; font-size: 12px;">
      <strong>${isOk ? "✅" : "❌"} ${result.status}</strong>
      — ${result.stepsCount} steps, ${result.durationMs}ms
      ${result.error ? html`<br/><span class="muted">Error: ${result.error}</span>` : nothing}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 调度状态
// ---------------------------------------------------------------------------

function renderSOPStatus(props: SOPsProps) {
  const status = props.sopsStatus;
  if (!status) {
    return html`
      <div style="margin-top: 16px;">
        <button class="btn" ?disabled=${props.loading} @click=${props.onLoadStatus}>
          Load Schedule Status
        </button>
      </div>
    `;
  }
  return html`
    <div style="margin-top: 16px;">
      <div class="muted" style="margin-bottom: 8px;">Total SOPs: ${status.totalSOPs}</div>
      ${status.scheduledSOPs.length > 0
        ? html`
          <div class="card-title" style="font-size: 13px; margin-top: 12px;">⏱ Scheduled</div>
          <div class="list">
            ${status.scheduledSOPs.map(
              (s) => html`
                <div class="list-item" style="padding: 8px 0;">
                  <div class="list-main">
                    <div class="list-title">${s.name}</div>
                  </div>
                  <div class="list-meta"><span class="pill">${s.schedule}</span></div>
                </div>
              `,
            )}
          </div>
        `
        : html`<div class="muted" style="margin-top: 8px;">No scheduled SOPs.</div>`}
      ${status.triggeredSOPs.length > 0
        ? html`
          <div class="card-title" style="font-size: 13px; margin-top: 12px;">⚡ Event-Triggered</div>
          <div class="list">
            ${status.triggeredSOPs.map(
              (s) => html`
                <div class="list-item" style="padding: 8px 0;">
                  <div class="list-main">
                    <div class="list-title">${s.name}</div>
                  </div>
                  <div class="list-meta"><span class="pill">${s.triggers.join(", ")}</span></div>
                </div>
              `,
            )}
          </div>
        `
        : nothing}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 运行历史
// ---------------------------------------------------------------------------

function renderSOPHistory(props: SOPsProps) {
  return html`
    <div style="margin-top: 16px;">
      <div class="row" style="gap: 8px;">
        <label class="field" style="flex: 1;">
          <span>SOP Name</span>
          <input
            .value=${props.sopsHistoryName}
            placeholder="Enter SOP name…"
            @input=${(e: Event) => props.onHistoryNameChange((e.target as HTMLInputElement).value)}
          />
        </label>
        <button
          class="btn primary"
          style="align-self: flex-end;"
          ?disabled=${!props.sopsHistoryName.trim() || props.loading}
          @click=${() => props.onLoadHistory(props.sopsHistoryName.trim())}
        >
          Load
        </button>
      </div>
      ${props.sopsHistory ? renderHistoryTable(props.sopsHistory) : nothing}
    </div>
  `;
}

function renderHistoryTable(history: SOPHistoryResult) {
  if (history.runs.length === 0) {
    return html`<div class="muted" style="margin-top: 12px;">No runs recorded for "${history.sopName}".</div>`;
  }
  const sorted = [...history.runs].reverse();
  return html`
    <div style="margin-top: 12px;">
      <div class="muted" style="margin-bottom: 8px;">
        Total runs: ${history.totalRuns}
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border);">
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Time</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Status</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Duration</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Steps</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Error</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(
            (r) => html`
              <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 6px 8px; font-family: monospace;">${r.startedAt?.replace("T", " ").slice(0, 19) ?? "-"}</td>
                <td style="padding: 6px 8px;">
                  <span class="pill ${r.status === "ok" ? "" : "danger"}">${r.status}</span>
                </td>
                <td style="padding: 6px 8px; font-family: monospace;">${r.durationMs}ms</td>
                <td style="padding: 6px 8px;">${r.stepsCount}</td>
                <td style="padding: 6px 8px; color: var(--danger-color, #d14343);">${r.error ?? "-"}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 创建表单
// ---------------------------------------------------------------------------

function renderCreateForm(props: SOPsProps) {
  const form = props.createForm;
  return html`
    <div class="callout" style="margin-top: 14px;">
      <div class="card-title" style="font-size: 14px;">Create New SOP</div>
      <label class="field" style="margin-top: 10px;">
        <span>Name *</span>
        <input
          .value=${form.name}
          placeholder="my-sop"
          @input=${(e: Event) => props.onCreateFormChange({ name: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Description *</span>
        <textarea
          .value=${form.description}
          placeholder="What does this SOP do…"
          rows="2"
          @input=${(e: Event) => props.onCreateFormChange({ description: (e.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Steps (one per line)</span>
        <textarea
          .value=${form.steps}
          placeholder="Open browser\nNavigate to page\nCapture screenshot"
          rows="3"
          @input=${(e: Event) => props.onCreateFormChange({ steps: (e.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Schedule (cron expression, optional)</span>
        <input
          .value=${form.schedule}
          placeholder="0 9 * * *"
          @input=${(e: Event) => props.onCreateFormChange({ schedule: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="row" style="margin-top: 12px; gap: 8px;">
        <button
          class="btn primary"
          ?disabled=${!form.name.trim() || !form.description.trim() || props.loading}
          @click=${props.onCreate}
        >
          Create SOP
        </button>
        <button class="btn" @click=${props.onToggleCreate}>Cancel</button>
      </div>
    </div>
  `;
}
