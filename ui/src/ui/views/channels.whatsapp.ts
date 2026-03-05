import { html, nothing } from "lit";
import type { ChannelAccountSnapshot, WhatsAppStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import { renderChannelConfigSection } from "./channels.config.ts";

export function renderWhatsAppCard(params: {
  props: ChannelsProps;
  whatsapp?: WhatsAppStatus;
  whatsappAccounts: ChannelAccountSnapshot[];
  selectedAccountId: string;
  accountCountLabel: unknown;
}) {
  const { props, whatsapp, whatsappAccounts, selectedAccountId, accountCountLabel } = params;
  const selectedAccount = whatsappAccounts.find((entry) => entry.accountId === selectedAccountId);
  const configured = selectedAccount?.configured ?? whatsapp?.configured;
  const linked = selectedAccount?.linked ?? whatsapp?.linked;
  const running = selectedAccount?.running ?? whatsapp?.running;
  const connected = selectedAccount?.connected ?? whatsapp?.connected;
  const lastConnectedAt = selectedAccount?.lastConnectedAt ?? whatsapp?.lastConnectedAt;
  const lastMessageAt = selectedAccount?.lastInboundAt ?? whatsapp?.lastMessageAt;
  const lastError = selectedAccount?.lastError ?? whatsapp?.lastError;

  return html`
    <div class="card">
      <div class="card-title">WhatsApp</div>
      <div class="card-sub">Link WhatsApp Web and monitor connection health.</div>
      ${accountCountLabel}
      ${
        whatsappAccounts.length > 0
          ? html`
            <label class="field" style="margin-top: 12px;">
              <span>Account</span>
              <select
                .value=${selectedAccountId}
                ?disabled=${props.whatsappBusy}
                @change=${(event: Event) =>
                  props.onWhatsAppAccountChange((event.target as HTMLSelectElement).value)}
              >
                ${whatsappAccounts.map(
                  (account) =>
                    html`<option .value=${account.accountId}>
                      ${account.name || account.accountId} (${account.accountId})
                    </option>`,
                )}
              </select>
            </label>
          `
          : nothing
      }

      <div class="status-list" style="margin-top: 16px;">
        <div>
          <span class="label">Configured</span>
          <span>${configured ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Linked</span>
          <span>${linked ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Running</span>
          <span>${running ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Connected</span>
          <span>${connected ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Last connect</span>
          <span>
            ${lastConnectedAt ? formatRelativeTimestamp(lastConnectedAt) : "n/a"}
          </span>
        </div>
        <div>
          <span class="label">Last message</span>
          <span>
            ${lastMessageAt ? formatRelativeTimestamp(lastMessageAt) : "n/a"}
          </span>
        </div>
        <div>
          <span class="label">Auth age</span>
          <span>
            ${whatsapp?.authAgeMs != null ? formatDurationHuman(whatsapp.authAgeMs) : "n/a"}
          </span>
        </div>
      </div>

      ${
        lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">
            ${lastError}
          </div>`
          : nothing
      }

      ${
        props.whatsappMessage
          ? html`<div class="callout" style="margin-top: 12px;">
            ${props.whatsappMessage}
          </div>`
          : nothing
      }

      ${
        props.whatsappQrDataUrl
          ? html`<div class="qr-wrap">
            <img src=${props.whatsappQrDataUrl} alt="WhatsApp QR" />
          </div>`
          : nothing
      }

      <div class="row" style="margin-top: 14px; flex-wrap: wrap;">
        <button
          class="btn primary"
          ?disabled=${props.whatsappBusy}
          @click=${() => props.onWhatsAppStart(false, selectedAccountId)}
        >
          ${props.whatsappBusy ? "Working..." : "Show QR"}
        </button>
        <button
          class="btn"
          ?disabled=${props.whatsappBusy}
          @click=${() => props.onWhatsAppStart(true, selectedAccountId)}
        >
          Relink
        </button>
        <button
          class="btn"
          ?disabled=${props.whatsappBusy}
          @click=${() => props.onWhatsAppWait(selectedAccountId)}
        >
          Wait for scan
        </button>
        <button
          class="btn danger"
          ?disabled=${props.whatsappBusy}
          @click=${() => props.onWhatsAppLogout(selectedAccountId)}
        >
          Logout
        </button>
        <button class="btn" @click=${() => props.onRefresh(true)}>
          Refresh
        </button>
      </div>

      ${renderChannelConfigSection({ channelId: "whatsapp", props })}
    </div>
  `;
}
