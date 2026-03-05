import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  SitePoolAccount,
  SitePoolEvent,
  SitePoolKeepalivePolicy,
  SitePoolLoginType,
  SitePoolQrTask,
} from "../types.ts";

export type SitePoolState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sitePoolLoading: boolean;
  sitePoolBusy: boolean;
  sitePoolError: string | null;
  sitePoolAccounts: SitePoolAccount[];
  sitePoolEventsById: Record<string, SitePoolEvent[]>;
  sitePoolQrById: Record<string, SitePoolQrTask | null>;
  sitePoolCreateForm: {
    siteKey: string;
    displayName: string;
    browserProfile: string;
    loginType: SitePoolLoginType;
    keepalivePolicy: SitePoolKeepalivePolicy;
    keepaliveUntil: string;
    notifyOnExpire: boolean;
    notifyOnQrRequired: boolean;
  };
};

function toError(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function loadSitePoolAccounts(state: SitePoolState) {
  if (!state.client || !state.connected || state.sitePoolLoading) {
    return;
  }
  state.sitePoolLoading = true;
  state.sitePoolError = null;
  try {
    const res = await state.client.request<{ accounts?: SitePoolAccount[] }>("sitepool.list", {});
    state.sitePoolAccounts = Array.isArray(res.accounts) ? res.accounts : [];
  } catch (err) {
    state.sitePoolError = toError(err);
  } finally {
    state.sitePoolLoading = false;
  }
}

export async function createSitePoolAccount(state: SitePoolState) {
  if (!state.client || !state.connected || state.sitePoolBusy) {
    return;
  }
  const siteKey = state.sitePoolCreateForm.siteKey.trim();
  const displayName = state.sitePoolCreateForm.displayName.trim();
  if (!siteKey || !displayName) {
    state.sitePoolError = "site key and display name are required";
    return;
  }
  state.sitePoolBusy = true;
  state.sitePoolError = null;
  try {
    await state.client.request("sitepool.create", {
      siteKey,
      displayName,
      browserProfile: state.sitePoolCreateForm.browserProfile.trim() || undefined,
      loginType: state.sitePoolCreateForm.loginType,
      keepalivePolicy: state.sitePoolCreateForm.keepalivePolicy,
      keepaliveUntil: state.sitePoolCreateForm.keepaliveUntil.trim() || undefined,
      notifyOnExpire: state.sitePoolCreateForm.notifyOnExpire,
      notifyOnQrRequired: state.sitePoolCreateForm.notifyOnQrRequired,
    });
    state.sitePoolCreateForm = {
      ...state.sitePoolCreateForm,
      siteKey: "",
      displayName: "",
      browserProfile: "",
      keepaliveUntil: "",
    };
    await loadSitePoolAccounts(state);
  } catch (err) {
    state.sitePoolError = toError(err);
  } finally {
    state.sitePoolBusy = false;
  }
}

export async function checkSitePoolAccount(state: SitePoolState, id: string) {
  if (!state.client || !state.connected || state.sitePoolBusy) {
    return;
  }
  state.sitePoolBusy = true;
  state.sitePoolError = null;
  try {
    await state.client.request("sitepool.check", { id });
    await loadSitePoolAccounts(state);
  } catch (err) {
    state.sitePoolError = toError(err);
  } finally {
    state.sitePoolBusy = false;
  }
}

export async function reauthSitePoolAccount(state: SitePoolState, id: string) {
  if (!state.client || !state.connected || state.sitePoolBusy) {
    return;
  }
  state.sitePoolBusy = true;
  state.sitePoolError = null;
  try {
    await state.client.request("sitepool.reauth", { id });
    await Promise.all([loadSitePoolAccounts(state), loadSitePoolQr(state, id)]);
  } catch (err) {
    state.sitePoolError = toError(err);
  } finally {
    state.sitePoolBusy = false;
  }
}

export async function updateSitePoolPolicy(
  state: SitePoolState,
  params: {
    id: string;
    keepalivePolicy: SitePoolKeepalivePolicy;
    keepaliveUntil?: string;
    notifyOnExpire?: boolean;
    notifyOnQrRequired?: boolean;
  },
) {
  if (!state.client || !state.connected || state.sitePoolBusy) {
    return;
  }
  state.sitePoolBusy = true;
  state.sitePoolError = null;
  try {
    await state.client.request("sitepool.policy.update", params);
    await loadSitePoolAccounts(state);
  } catch (err) {
    state.sitePoolError = toError(err);
  } finally {
    state.sitePoolBusy = false;
  }
}

export async function loadSitePoolQr(state: SitePoolState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ qrTask?: SitePoolQrTask | null }>("sitepool.qr", {
      id,
    });
    state.sitePoolQrById = {
      ...state.sitePoolQrById,
      [id]: res.qrTask ?? null,
    };
  } catch (err) {
    state.sitePoolError = toError(err);
  }
}

export async function loadSitePoolEvents(state: SitePoolState, id: string, limit = 20) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ events?: SitePoolEvent[] }>("sitepool.events", {
      id,
      limit,
    });
    state.sitePoolEventsById = {
      ...state.sitePoolEventsById,
      [id]: Array.isArray(res.events) ? res.events : [],
    };
  } catch (err) {
    state.sitePoolError = toError(err);
  }
}
