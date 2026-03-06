import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SitePoolCheckOutcome, SitePoolReauthOutcome } from "./adapters.js";
import type {
  SitePoolAccount,
  SitePoolEvent,
  SitePoolEventType,
  SitePoolKeepalivePolicy,
  SitePoolLoginType,
  SitePoolQrTask,
  SitePoolStatus,
  SitePoolStoreFile,
} from "./types.js";
import { CONFIG_DIR } from "../utils.js";

export const DEFAULT_SITE_POOL_DIR = path.join(CONFIG_DIR, "site-pool");
export const DEFAULT_SITE_POOL_STORE_PATH = path.join(DEFAULT_SITE_POOL_DIR, "accounts.json");

let updateChain: Promise<void> = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function normalizeBrowserProfileName(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function assertBrowserProfileIsolated(
  store: SitePoolStoreFile,
  browserProfile: string | undefined,
  exceptAccountId?: string,
) {
  const normalized = normalizeBrowserProfileName(browserProfile);
  if (!normalized) {
    return;
  }
  const occupied = store.accounts.find(
    (entry) =>
      entry.id !== exceptAccountId &&
      normalizeBrowserProfileName(entry.browserProfile) === normalized,
  );
  if (occupied) {
    throw new Error(
      `browserProfile "${normalized}" is already used by site account ${occupied.id} (${occupied.siteKey}/${occupied.displayName}); use a dedicated profile per account`,
    );
  }
}

function normalizeStore(value: unknown): SitePoolStoreFile {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    version: 1,
    accounts: Array.isArray(record.accounts) ? (record.accounts as SitePoolAccount[]) : [],
    events: Array.isArray(record.events) ? (record.events as SitePoolEvent[]) : [],
    qrTasks: Array.isArray(record.qrTasks) ? (record.qrTasks as SitePoolQrTask[]) : [],
  };
}

async function readStore(storePath = DEFAULT_SITE_POOL_STORE_PATH): Promise<SitePoolStoreFile> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return { version: 1, accounts: [], events: [], qrTasks: [] };
    }
    throw err;
  }
}

async function writeStore(storePath: string, next: SitePoolStoreFile): Promise<void> {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.promises.rename(tmp, storePath);
}

export async function listSitePoolAccounts(storePath = DEFAULT_SITE_POOL_STORE_PATH) {
  const store = await readStore(storePath);
  return store.accounts;
}

export async function getSitePoolAccountById(
  id: string,
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolAccount | null> {
  const store = await readStore(storePath);
  return store.accounts.find((entry) => entry.id === id) ?? null;
}

export async function createSitePoolAccount(
  input: {
    siteKey: string;
    displayName: string;
    browserProfile?: string;
    loginType: SitePoolLoginType;
    keepalivePolicy: SitePoolKeepalivePolicy;
    keepaliveUntil?: string;
    notifyOnExpire: boolean;
    notifyOnQrRequired: boolean;
  },
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolAccount> {
  let created: SitePoolAccount | null = null;
  await updateSitePoolStore(storePath, (store) => {
    const browserProfile = normalizeBrowserProfileName(input.browserProfile);
    assertBrowserProfileIsolated(store, browserProfile);
    const now = nowIso();
    created = {
      id: randomUUID(),
      siteKey: input.siteKey,
      displayName: input.displayName,
      browserProfile,
      loginType: input.loginType,
      status: "unknown",
      keepalivePolicy: input.keepalivePolicy,
      keepaliveUntil: input.keepaliveUntil,
      notifyOnExpire: input.notifyOnExpire,
      notifyOnQrRequired: input.notifyOnQrRequired,
      createdAt: now,
      updatedAt: now,
    };
    store.accounts.unshift(created);
  });
  if (!created) {
    throw new Error("failed to create site account");
  }
  return created;
}

export async function updateSitePoolPolicy(
  input: {
    id: string;
    keepalivePolicy: SitePoolKeepalivePolicy;
    browserProfile?: string;
    keepaliveUntil?: string;
    notifyOnExpire?: boolean;
    notifyOnQrRequired?: boolean;
  },
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolAccount | null> {
  let updated: SitePoolAccount | null = null;
  await updateSitePoolStore(storePath, (store) => {
    const account = store.accounts.find((entry) => entry.id === input.id);
    if (!account) {
      return;
    }
    if (input.browserProfile !== undefined) {
      const browserProfile = normalizeBrowserProfileName(input.browserProfile);
      assertBrowserProfileIsolated(store, browserProfile, account.id);
      account.browserProfile = browserProfile;
    }
    account.keepalivePolicy = input.keepalivePolicy;
    account.keepaliveUntil = input.keepaliveUntil;
    if (typeof input.notifyOnExpire === "boolean") {
      account.notifyOnExpire = input.notifyOnExpire;
    }
    if (typeof input.notifyOnQrRequired === "boolean") {
      account.notifyOnQrRequired = input.notifyOnQrRequired;
    }
    account.updatedAt = nowIso();
    updated = { ...account };
  });
  return updated;
}

export async function checkSitePoolAccount(
  id: string,
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolAccount | null> {
  let nextEntry: SitePoolAccount | null = null;
  await updateSitePoolStore(storePath, (store) => {
    const account = store.accounts.find((entry) => entry.id === id);
    if (!account) {
      return;
    }
    const now = Date.now();
    const nextStatus = inferStatus(account, now);
    const changed = nextStatus !== account.status;
    account.status = nextStatus;
    account.lastCheckAt = new Date(now).toISOString();
    account.updatedAt = account.lastCheckAt;
    if (changed) {
      pushSitePoolEvent(store, account.id, "status_changed", {
        status: nextStatus,
      });
    }
    nextEntry = { ...account };
  });
  return nextEntry;
}

export async function applySitePoolCheckOutcome(
  input: { id: string; outcome: SitePoolCheckOutcome },
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolAccount | null> {
  let nextEntry: SitePoolAccount | null = null;
  await updateSitePoolStore(storePath, (store) => {
    const account = store.accounts.find((entry) => entry.id === input.id);
    if (!account) {
      return;
    }
    const before = account.status;
    const now = nowIso();
    account.status = input.outcome.status;
    account.lastCheckAt = now;
    account.updatedAt = now;
    if (input.outcome.expiresAt) {
      account.expiresAt = input.outcome.expiresAt;
    }
    if (input.outcome.status === "active") {
      account.lastSuccessAt = now;
    }
    if (before !== account.status) {
      pushSitePoolEvent(store, account.id, "status_changed", {
        from: before,
        to: account.status,
      });
    }
    if (input.outcome.qrDataUrl || input.outcome.qrRawText) {
      const qrTask: SitePoolQrTask = {
        id: randomUUID(),
        siteAccountId: account.id,
        status: "ready",
        qrImageUrl: input.outcome.qrDataUrl,
        qrRawText: input.outcome.qrRawText,
        expiredAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        createdAt: nowIso(),
      };
      store.qrTasks.unshift(qrTask);
      pushSitePoolEvent(store, account.id, "qr_detected", {
        qrTaskId: qrTask.id,
        source: input.outcome.details ?? {},
      });
    }
    nextEntry = { ...account };
  });
  return nextEntry;
}

export async function requestSitePoolReauth(
  id: string,
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<{ account: SitePoolAccount; qrTask: SitePoolQrTask } | null> {
  let next: { account: SitePoolAccount; qrTask: SitePoolQrTask } | null = null;
  await updateSitePoolStore(storePath, (store) => {
    const account = store.accounts.find((entry) => entry.id === id);
    if (!account) {
      return;
    }
    account.status = "reauth_required";
    account.updatedAt = nowIso();
    const qrTask: SitePoolQrTask = {
      id: randomUUID(),
      siteAccountId: account.id,
      status: "ready",
      // Placeholder URL for UI rendering until site adapters are integrated.
      qrImageUrl: `/api/site-pool/accounts/${encodeURIComponent(account.id)}/qr/image`,
      expiredAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      createdAt: nowIso(),
    };
    store.qrTasks.unshift(qrTask);
    pushSitePoolEvent(store, account.id, "qr_detected", {
      qrTaskId: qrTask.id,
      status: qrTask.status,
    });
    next = { account: { ...account }, qrTask };
  });
  return next;
}

export async function applySitePoolReauthOutcome(
  input: { id: string; outcome: SitePoolReauthOutcome },
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<{ account: SitePoolAccount; qrTask: SitePoolQrTask | null } | null> {
  let next: { account: SitePoolAccount; qrTask: SitePoolQrTask | null } | null = null;
  await updateSitePoolStore(storePath, (store) => {
    const account = store.accounts.find((entry) => entry.id === input.id);
    if (!account) {
      return;
    }
    account.status = input.outcome.status;
    account.lastCheckAt = nowIso();
    account.updatedAt = account.lastCheckAt;
    if (input.outcome.expiresAt) {
      account.expiresAt = input.outcome.expiresAt;
    }
    let qrTask: SitePoolQrTask | null = null;
    if (input.outcome.qrDataUrl || input.outcome.qrRawText) {
      qrTask = {
        id: randomUUID(),
        siteAccountId: account.id,
        status: "ready",
        qrImageUrl: input.outcome.qrDataUrl,
        qrRawText: input.outcome.qrRawText,
        expiredAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        createdAt: nowIso(),
      };
      store.qrTasks.unshift(qrTask);
      pushSitePoolEvent(store, account.id, "qr_detected", {
        qrTaskId: qrTask.id,
        source: input.outcome.details ?? {},
      });
    }
    next = { account: { ...account }, qrTask };
  });
  return next;
}

export async function markSitePoolFailure(
  input: {
    id: string;
    eventType: Extract<SitePoolEventType, "login_failed" | "refresh_failed">;
    message: string;
  },
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolAccount | null> {
  let nextEntry: SitePoolAccount | null = null;
  await updateSitePoolStore(storePath, (store) => {
    const account = store.accounts.find((entry) => entry.id === input.id);
    if (!account) {
      return;
    }
    account.lastCheckAt = nowIso();
    account.updatedAt = account.lastCheckAt;
    pushSitePoolEvent(store, account.id, input.eventType, {
      message: input.message,
    });
    nextEntry = { ...account };
  });
  return nextEntry;
}

export async function getSitePoolQrTask(
  siteAccountId: string,
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolQrTask | null> {
  const store = await readStore(storePath);
  const now = Date.now();
  const latest = store.qrTasks.find((entry) => entry.siteAccountId === siteAccountId);
  if (!latest) {
    return null;
  }
  if (latest.expiredAt && Date.parse(latest.expiredAt) <= now && latest.status === "ready") {
    latest.status = "expired";
    await writeStore(storePath, store);
  }
  return latest;
}

export async function listSitePoolEvents(
  input: { siteAccountId: string; limit: number },
  storePath = DEFAULT_SITE_POOL_STORE_PATH,
): Promise<SitePoolEvent[]> {
  const store = await readStore(storePath);
  const limit = Math.max(1, Math.min(200, input.limit));
  return store.events
    .filter((entry) => entry.siteAccountId === input.siteAccountId)
    .slice(0, limit);
}

function inferStatus(account: SitePoolAccount, nowMs: number): SitePoolStatus {
  if (!account.expiresAt) {
    return account.status === "reauth_required" ? account.status : "active";
  }
  const expiresAtMs = Date.parse(account.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return account.status === "reauth_required" ? account.status : "unknown";
  }
  const remain = expiresAtMs - nowMs;
  if (remain <= 0) {
    return "expired";
  }
  if (remain <= 24 * 60 * 60 * 1000) {
    return "expiring";
  }
  return account.status === "reauth_required" ? account.status : "active";
}

function pushSitePoolEvent(
  store: SitePoolStoreFile,
  siteAccountId: string,
  eventType: SitePoolEventType,
  payload: Record<string, unknown>,
) {
  store.events.unshift({
    id: randomUUID(),
    siteAccountId,
    eventType,
    payload,
    createdAt: nowIso(),
  });
  if (store.events.length > 2000) {
    store.events = store.events.slice(0, 2000);
  }
}

async function updateSitePoolStore(
  storePath: string,
  mutate: (store: SitePoolStoreFile) => void,
): Promise<void> {
  const run = async () => {
    const store = await readStore(storePath);
    mutate(store);
    await writeStore(storePath, store);
  };
  const next = updateChain.then(run, run);
  // Keep the shared chain alive even if one update fails.
  updateChain = next.catch(() => {});
  await next;
}
