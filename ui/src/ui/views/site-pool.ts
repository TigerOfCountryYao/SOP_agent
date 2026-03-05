import { html, nothing } from "lit";
import type {
  SitePoolAccount,
  SitePoolEvent,
  SitePoolKeepalivePolicy,
  SitePoolLoginType,
  SitePoolQrTask,
} from "../types.ts";

export type SitePoolProps = {
  loading: boolean;
  busy: boolean;
  error: string | null;
  accounts: SitePoolAccount[];
  eventsById: Record<string, SitePoolEvent[]>;
  qrById: Record<string, SitePoolQrTask | null>;
  createForm: {
    siteKey: string;
    displayName: string;
    browserProfile: string;
    loginType: SitePoolLoginType;
    keepalivePolicy: SitePoolKeepalivePolicy;
    keepaliveUntil: string;
    notifyOnExpire: boolean;
    notifyOnQrRequired: boolean;
  };
  onRefresh: () => void;
  onCreateFormPatch: (
    patch: Partial<{
      siteKey: string;
      displayName: string;
      browserProfile: string;
      loginType: SitePoolLoginType;
      keepalivePolicy: SitePoolKeepalivePolicy;
      keepaliveUntil: string;
      notifyOnExpire: boolean;
      notifyOnQrRequired: boolean;
    }>,
  ) => void;
  onCreate: () => void;
  onCheck: (id: string) => void;
  onReauth: (id: string) => void;
  onPolicyChange: (id: string, next: SitePoolKeepalivePolicy) => void;
  onLoadQr: (id: string) => void;
  onLoadEvents: (id: string) => void;
};

function formatTs(value?: string) {
  if (!value) {
    return "n/a";
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) {
    return value;
  }
  return d.toLocaleString();
}

export function renderSitePool(props: SitePoolProps) {
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Website Pool</div>
          <div class="card-sub">Track per-site auth status and trigger QR re-auth.</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}

      <div class="form-grid" style="margin-top: 14px;">
        <label class="field">
          <span>Site key</span>
          <input
            .value=${props.createForm.siteKey}
            @input=${(event: Event) =>
              props.onCreateFormPatch({ siteKey: (event.target as HTMLInputElement).value })}
            placeholder="douyin"
          />
        </label>
        <label class="field">
          <span>Display name</span>
          <input
            .value=${props.createForm.displayName}
            @input=${(event: Event) =>
              props.onCreateFormPatch({ displayName: (event.target as HTMLInputElement).value })}
            placeholder="Douyin Main"
          />
        </label>
        <label class="field">
          <span>Browser profile</span>
          <input
            .value=${props.createForm.browserProfile}
            @input=${(event: Event) =>
              props.onCreateFormPatch({ browserProfile: (event.target as HTMLInputElement).value })}
            placeholder="openclaw (default)"
          />
        </label>
        <label class="field">
          <span>Login type</span>
          <select
            .value=${props.createForm.loginType}
            @change=${(event: Event) =>
              props.onCreateFormPatch({
                loginType: (event.target as HTMLSelectElement).value as SitePoolLoginType,
              })}
          >
            <option value="qr">qr</option>
            <option value="password_2fa">password_2fa</option>
            <option value="sms">sms</option>
            <option value="email_code">email_code</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <label class="field">
          <span>Keepalive policy</span>
          <select
            .value=${props.createForm.keepalivePolicy}
            @change=${(event: Event) =>
              props.onCreateFormPatch({
                keepalivePolicy: (event.target as HTMLSelectElement)
                  .value as SitePoolKeepalivePolicy,
              })}
          >
            <option value="off">off</option>
            <option value="until_date">until_date</option>
            <option value="continuous">continuous</option>
          </select>
        </label>
      </div>
      <div class="row" style="margin-top: 10px;">
        <button class="btn primary" ?disabled=${props.busy} @click=${props.onCreate}>
          ${props.busy ? "Saving..." : "Add site"}
        </button>
      </div>
    </section>

    <section class="card" style="margin-top: 16px;">
      <div class="card-title">Accounts</div>
      ${
        props.accounts.length === 0
          ? html`
              <div class="muted" style="margin-top: 10px">No websites added yet.</div>
            `
          : html`<div class="list" style="margin-top: 10px;">
              ${props.accounts.map((account) => renderSiteRow(account, props))}
            </div>`
      }
    </section>
  `;
}

function renderSiteRow(account: SitePoolAccount, props: SitePoolProps) {
  const qrTask = props.qrById[account.id] ?? null;
  const events = props.eventsById[account.id] ?? [];
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${account.displayName} <span class="muted">(${account.siteKey})</span></div>
        <div class="list-sub">
          status=${account.status} | login=${account.loginType} | policy=${account.keepalivePolicy}
        </div>
        <div class="muted">profile: ${account.browserProfile || "default"}</div>
        <div class="muted">checked: ${formatTs(account.lastCheckAt)} | updated: ${formatTs(account.updatedAt)}</div>
        ${
          qrTask
            ? html`<div class="callout" style="margin-top: 8px;">
                QR: ${qrTask.status}
                ${qrTask.expiredAt ? html` | expires ${formatTs(qrTask.expiredAt)}` : nothing}
                ${
                  qrTask.qrImageUrl
                    ? html`<div><a href=${qrTask.qrImageUrl} target="_blank" rel="noreferrer">Open QR link</a></div>`
                    : nothing
                }
              </div>`
            : nothing
        }
        ${
          events.length > 0
            ? html`<div class="muted" style="margin-top: 8px;">
                last event: ${events[0]?.eventType} @ ${formatTs(events[0]?.createdAt)}
              </div>`
            : nothing
        }
      </div>
      <div class="list-meta">
        <div class="row" style="gap: 6px; justify-content: flex-end;">
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onCheck(account.id)}>Check</button>
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onReauth(account.id)}>Re-auth</button>
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onLoadQr(account.id)}>QR</button>
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onLoadEvents(account.id)}>
            Events
          </button>
        </div>
        <label class="field" style="margin-top: 8px;">
          <span>Policy</span>
          <select
            .value=${account.keepalivePolicy}
            @change=${(event: Event) =>
              props.onPolicyChange(
                account.id,
                (event.target as HTMLSelectElement).value as SitePoolKeepalivePolicy,
              )}
          >
            <option value="off">off</option>
            <option value="until_date">until_date</option>
            <option value="continuous">continuous</option>
          </select>
        </label>
      </div>
    </div>
  `;
}
