import { html, nothing } from "lit";
import type {
  SOPEntry,
  SOPHistoryResult,
  SOPListResult,
  SOPRunResult,
  SOPStatusResult,
  SOPsViewPanel,
} from "../controllers/sops.ts";

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
  createForm: SOPCreateForm;
  onCreateFormChange: (patch: Partial<SOPCreateForm>) => void;
  onCreate: () => void;
  editingScheduleName: string | null;
  scheduleForm: SOPScheduleForm;
  onEditSchedule: (
    name: string,
    schedule?: { kind: "weekly"; days: string[]; time: string },
  ) => void;
  onScheduleFormChange: (patch: Partial<SOPScheduleForm>) => void;
  onSaveSchedule: (name: string, clearSchedule?: boolean) => void;
  onCancelSchedule: () => void;
  showCreate: boolean;
  onToggleCreate: () => void;
};

export type SOPCreateForm = {
  name: string;
  sessionKey: string;
  runId: string;
  scheduleDays: string[];
  scheduleTime: string;
};

export type SOPScheduleForm = {
  days: string[];
  time: string;
};

const WEEKDAY_OPTIONS: Array<[string, string]> = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"],
];

export function renderSOPs(props: SOPsProps) {
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">SOPs</div>
          <div class="card-sub">Standard Operating Procedures - automated multi-step workflows.</div>
        </div>
        <div class="row" style="gap: 6px;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Loading..." : "Refresh"}
          </button>
          <button class="btn primary" @click=${props.onToggleCreate}>
            ${props.showCreate ? "Cancel" : "+ Capture"}
          </button>
        </div>
      </div>

      <div class="row" style="gap: 4px; margin-top: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
        ${(["list", "status", "history"] as const).map(
          (panel) => html`
            <button
              class="btn${props.panel === panel ? " primary" : ""}"
              style="font-size: 12px; padding: 4px 10px;"
              @click=${() => props.onPanelChange(panel)}
            >
              ${panel === "list" ? "SOPs" : panel === "status" ? "Schedule" : "History"}
            </button>
          `,
        )}
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
        : nothing}

      ${props.showCreate ? renderCreateForm(props) : nothing}
      ${props.panel === "list" ? renderSOPList(props) : nothing}
      ${props.panel === "status" ? renderSOPStatus(props) : nothing}
      ${props.panel === "history" ? renderSOPHistory(props) : nothing}
    </section>
  `;
}

function renderSOPList(props: SOPsProps) {
  const sops = props.sopsList?.sops ?? [];
  if (sops.length === 0) {
    return html`<div class="muted" style="margin-top: 16px;">No published SOPs yet. Capture one from a successful task.</div>`;
  }

  return html`
    <div class="list" style="margin-top: 16px;">
      ${sops.map((sop) => renderSOPItem(sop, props))}
    </div>
  `;
}

function renderSOPItem(sop: SOPEntry, props: SOPsProps) {
  const isRunning = props.sopsRunning === sop.name;
  const scheduleLabel =
    sop.schedule?.label ??
    sop.scheduleLabel ??
    (sop.schedule ? `${sop.schedule.days.join(", ")} ${sop.schedule.time}` : undefined);

  return html`
    <div class="list-item">
      <div class="list-main">
      <div class="list-title">
          SOP ${sop.name}
          ${sop.version
            ? html`<span class="muted" style="font-size: 11px; margin-left: 6px;">v${sop.version}</span>`
            : nothing}
          ${renderSOPStatusPill(sop)}
        </div>
        <div class="list-sub">${sop.description ?? "No description."}</div>
        <div class="row" style="gap: 10px; margin-top: 4px;">
          ${scheduleLabel
            ? html`<span class="pill" style="font-size: 11px;">Schedule: ${scheduleLabel}</span>`
            : nothing}
          ${sop.triggers?.length
            ? html`<span class="pill" style="font-size: 11px;">Triggers: ${sop.triggers.join(", ")}</span>`
            : nothing}
        </div>
        ${isRunning ? html`<div class="muted" style="margin-top: 6px;">Running...</div>` : nothing}
        ${sop.validation?.lastError && sop.status !== "validated"
          ? html`<div class="muted" style="margin-top: 6px;">${sop.validation.lastError}</div>`
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
            ${isRunning ? "Running..." : "Run"}
          </button>
          <button class="btn" @click=${() => props.onViewHistory(sop.name)}>
            History
          </button>
          <button class="btn" @click=${() => props.onEditSchedule(sop.name, sop.schedule)}>
            Schedule
          </button>
        </div>
      </div>
      ${props.editingScheduleName === sop.name
        ? renderScheduleEditor(sop.name, props)
        : nothing}
    </div>
  `;
}

function renderRunResult(result: SOPRunResult) {
  const isOk = result.status === "ok";
  return html`
    <div class="callout ${isOk ? "" : "danger"}" style="margin-top: 8px; font-size: 12px;">
      <strong>${isOk ? "OK" : "Error"} ${result.status}</strong>
      - ${result.stepsCount} steps, ${result.logsCount ?? 0} logs, ${result.durationMs}ms
      ${result.repairTriggered
        ? html`<br /><span class="muted">Repair: ${result.repair?.healStrategy} attempt ${result.repair?.attempt}</span>`
        : nothing}
      ${result.error ? html`<br /><span class="muted">Error: ${result.error}</span>` : nothing}
    </div>
  `;
}

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
            <div class="card-title" style="font-size: 13px; margin-top: 12px;">Scheduled</div>
            <div class="list">
              ${status.scheduledSOPs.map(
                (entry) => html`
                  <div class="list-item" style="padding: 8px 0;">
                    <div class="list-main">
                      <div class="list-title">${entry.name}</div>
                    </div>
                    <div class="list-meta"><span class="pill">${entry.scheduleLabel}</span></div>
                  </div>
                `,
              )}
            </div>
          `
        : html`<div class="muted" style="margin-top: 8px;">No scheduled SOPs.</div>`}
      ${status.triggeredSOPs.length > 0
        ? html`
            <div class="card-title" style="font-size: 13px; margin-top: 12px;">Event-Triggered</div>
            <div class="list">
              ${status.triggeredSOPs.map(
                (entry) => html`
                  <div class="list-item" style="padding: 8px 0;">
                    <div class="list-main">
                      <div class="list-title">${entry.name}</div>
                    </div>
                    <div class="list-meta"><span class="pill">${entry.triggers.join(", ")}</span></div>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderScheduleEditor(name: string, props: SOPsProps) {
  const form = props.scheduleForm;
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div class="card-title" style="font-size: 13px;">Edit Weekly Schedule</div>
      <div class="muted" style="margin-top: 4px;">Choose one or more weekdays and a time.</div>
      <label class="field" style="margin-top: 8px;">
        <span>Days</span>
        <div class="row" style="gap: 6px; flex-wrap: wrap; margin-top: 6px;">
          ${WEEKDAY_OPTIONS.map(
            ([value, label]) => html`
              <label class="pill" style="cursor: pointer;">
                <input
                  type="checkbox"
                  .checked=${form.days.includes(value)}
                  @change=${(e: Event) =>
                    props.onScheduleFormChange({
                      days: toggleScheduleDay(
                        form.days,
                        value,
                        (e.target as HTMLInputElement).checked,
                      ),
                    })}
                />
                ${label}
              </label>
            `,
          )}
        </div>
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Time</span>
        <input
          .value=${form.time}
          placeholder="09:00"
          @input=${(e: Event) =>
            props.onScheduleFormChange({ time: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="row" style="margin-top: 10px; gap: 8px;">
        <button
          class="btn primary"
          ?disabled=${!form.time.trim() || form.days.length === 0 || props.loading}
          @click=${() => props.onSaveSchedule(name, false)}
        >
          Save Schedule
        </button>
        <button class="btn" ?disabled=${props.loading} @click=${() => props.onSaveSchedule(name, true)}>
          Remove Schedule
        </button>
        <button class="btn" @click=${props.onCancelSchedule}>Cancel</button>
      </div>
    </div>
  `;
}

function renderSOPHistory(props: SOPsProps) {
  return html`
    <div style="margin-top: 16px;">
      <div class="row" style="gap: 8px;">
        <label class="field" style="flex: 1;">
          <span>SOP Name</span>
          <input
            .value=${props.sopsHistoryName}
            placeholder="Enter SOP name..."
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
      <div class="muted" style="margin-bottom: 8px;">Total runs: ${history.totalRuns}</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border);">
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Time</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Status</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Duration</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Steps</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Logs</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Repair</th>
            <th style="text-align: left; padding: 6px 8px; color: var(--muted-color);">Error</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(
            (run) => html`
              <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 6px 8px; font-family: monospace;">
                  ${run.startedAt?.replace("T", " ").slice(0, 19) ?? "-"}
                </td>
                <td style="padding: 6px 8px;">
                  <span class="pill ${run.status === "ok" ? "" : "danger"}">${run.status}</span>
                </td>
                <td style="padding: 6px 8px; font-family: monospace;">${run.durationMs}ms</td>
                <td style="padding: 6px 8px;">${run.stepsCount}</td>
                <td style="padding: 6px 8px;">${run.logsCount ?? 0}</td>
                <td style="padding: 6px 8px;">
                  ${run.repair ? `${run.repair.healStrategy} #${run.repair.attempt}` : "-"}
                </td>
                <td style="padding: 6px 8px; color: var(--danger-color, #d14343);">${run.error ?? "-"}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function renderCreateForm(props: SOPsProps) {
  const form = props.createForm;
  return html`
    <div class="callout" style="margin-top: 14px;">
      <div class="card-title" style="font-size: 14px;">Capture SOP From Successful Session</div>
      <label class="field" style="margin-top: 10px;">
        <span>Name *</span>
        <input
          .value=${form.name}
          placeholder="my-sop"
          @input=${(e: Event) =>
            props.onCreateFormChange({ name: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Session Key *</span>
        <input
          .value=${form.sessionKey}
          placeholder="agent:main:main"
          @input=${(e: Event) =>
            props.onCreateFormChange({ sessionKey: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Run ID</span>
        <input
          .value=${form.runId}
          placeholder="Optional. Keep empty to capture the latest successful task in this session."
          @input=${(e: Event) =>
            props.onCreateFormChange({ runId: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Weekly Schedule Days</span>
        <div class="muted" style="margin-top: 4px;">Optional. Set a weekly plan now, or add one later from the SOP card.</div>
        <div class="row" style="gap: 6px; flex-wrap: wrap; margin-top: 6px;">
          ${WEEKDAY_OPTIONS.map(
            ([value, label]) => html`
              <label class="pill" style="cursor: pointer;">
                <input
                  type="checkbox"
                  .checked=${form.scheduleDays.includes(value)}
                  @change=${(e: Event) =>
                    props.onCreateFormChange({
                      scheduleDays: toggleScheduleDay(
                        form.scheduleDays,
                        value,
                        (e.target as HTMLInputElement).checked,
                      ),
                    })}
                />
                ${label}
              </label>
            `,
          )}
        </div>
      </label>
      <label class="field" style="margin-top: 8px;">
        <span>Weekly Schedule Time</span>
        <input
          .value=${form.scheduleTime}
          placeholder="09:00"
          @input=${(e: Event) =>
            props.onCreateFormChange({ scheduleTime: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="row" style="margin-top: 12px; gap: 8px;">
        <button
          class="btn primary"
          ?disabled=${!form.name.trim() || !form.sessionKey.trim() || props.loading}
          @click=${props.onCreate}
        >
          Capture SOP
        </button>
        <button class="btn" @click=${props.onToggleCreate}>Cancel</button>
      </div>
    </div>
  `;
}

function renderSOPStatusPill(sop: SOPEntry) {
  if (sop.loadError) {
    return html`<span class="pill danger" style="margin-left: 6px;">Load Error</span>`;
  }
  switch (sop.status) {
    case "validated":
      return html`<span class="pill" style="margin-left: 6px;">Ready</span>`;
    case "repairing":
      return html`<span class="pill" style="margin-left: 6px;">Repairing</span>`;
    case "draft":
      return html`<span class="pill" style="margin-left: 6px;">Validating</span>`;
    case "failed":
      return html`<span class="pill danger" style="margin-left: 6px;">Needs Attention</span>`;
    default:
      return nothing;
  }
}

function toggleScheduleDay(days: string[], value: string, checked: boolean) {
  const next = new Set(days);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return [...next];
}
