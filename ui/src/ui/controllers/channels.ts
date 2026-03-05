import type { ChannelsState } from "./channels.types.ts";
import { ChannelsStatusSnapshot } from "../types.ts";

export type { ChannelsState };

export async function loadChannels(state: ChannelsState, probe: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.channelsLoading) {
    return;
  }
  state.channelsLoading = true;
  state.channelsError = null;
  try {
    const res = await state.client.request<ChannelsStatusSnapshot | null>("channels.status", {
      probe,
      timeoutMs: 8000,
    });
    state.channelsSnapshot = res;
    const accounts = res?.channelAccounts?.whatsapp ?? [];
    const fallback =
      state.whatsappAccountId ??
      res?.channelDefaultAccountId?.whatsapp ??
      accounts[0]?.accountId ??
      "default";
    state.whatsappAccountId = accounts.some((entry) => entry.accountId === fallback)
      ? fallback
      : (res?.channelDefaultAccountId?.whatsapp ?? accounts[0]?.accountId ?? "default");
    state.channelsLastSuccess = Date.now();
  } catch (err) {
    state.channelsError = String(err);
  } finally {
    state.channelsLoading = false;
  }
}

function resolveWhatsAppAccountId(state: ChannelsState, accountId?: string): string {
  const explicit = (accountId ?? "").trim();
  if (explicit) {
    return explicit;
  }
  return (
    state.whatsappAccountId ??
    state.channelsSnapshot?.channelDefaultAccountId?.whatsapp ??
    state.channelsSnapshot?.channelAccounts?.whatsapp?.[0]?.accountId ??
    "default"
  );
}

export async function startWhatsAppLogin(state: ChannelsState, force: boolean, accountId?: string) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const resolvedAccountId = resolveWhatsAppAccountId(state, accountId);
    state.whatsappAccountId = resolvedAccountId;
    const res = await state.client.request<{ message?: string; qrDataUrl?: string }>(
      "web.login.start",
      {
        force,
        timeoutMs: 30000,
        accountId: resolvedAccountId,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginQrDataUrl = res.qrDataUrl ?? null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function waitWhatsAppLogin(state: ChannelsState, accountId?: string) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const resolvedAccountId = resolveWhatsAppAccountId(state, accountId);
    state.whatsappAccountId = resolvedAccountId;
    const res = await state.client.request<{ message?: string; connected?: boolean }>(
      "web.login.wait",
      {
        timeoutMs: 120000,
        accountId: resolvedAccountId,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginConnected = res.connected ?? null;
    if (res.connected) {
      state.whatsappLoginQrDataUrl = null;
    }
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function logoutWhatsApp(state: ChannelsState, accountId?: string) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const resolvedAccountId = resolveWhatsAppAccountId(state, accountId);
    state.whatsappAccountId = resolvedAccountId;
    await state.client.request("channels.logout", { channel: "whatsapp", accountId: resolvedAccountId });
    state.whatsappLoginMessage = "Logged out.";
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
  } finally {
    state.whatsappBusy = false;
  }
}
