import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { runSitePoolCheck, runSitePoolReauth } from "../../site-pool/runtime.js";
import {
  applySitePoolCheckOutcome,
  applySitePoolReauthOutcome,
  checkSitePoolAccount,
  createSitePoolAccount,
  getSitePoolAccountById,
  getSitePoolQrTask,
  listSitePoolAccounts,
  listSitePoolEvents,
  markSitePoolFailure,
  requestSitePoolReauth,
  updateSitePoolPolicy,
} from "../../site-pool/store.js";
import {
  SITE_POOL_KEEPALIVE_POLICIES,
  SITE_POOL_LOGIN_TYPES,
  type SitePoolKeepalivePolicy,
  type SitePoolLoginType,
} from "../../site-pool/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function respondBadRequest(respond: RespondFn, message: string) {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function parseLoginType(value: unknown): SitePoolLoginType | null {
  const raw = readString(value);
  if (!raw) {
    return "unknown";
  }
  return SITE_POOL_LOGIN_TYPES.includes(raw as SitePoolLoginType)
    ? (raw as SitePoolLoginType)
    : null;
}

function parseKeepalivePolicy(value: unknown): SitePoolKeepalivePolicy | null {
  const raw = readString(value);
  if (!raw) {
    return "off";
  }
  return SITE_POOL_KEEPALIVE_POLICIES.includes(raw as SitePoolKeepalivePolicy)
    ? (raw as SitePoolKeepalivePolicy)
    : null;
}

export const sitePoolHandlers: GatewayRequestHandlers = {
  "sitepool.list": async ({ respond }) => {
    const accounts = await listSitePoolAccounts();
    respond(true, { ts: Date.now(), count: accounts.length, accounts }, undefined);
  },
  "sitepool.create": async ({ params, respond }) => {
    const siteKey = readString(params.siteKey);
    const displayName = readString(params.displayName);
    const browserProfile = readString(params.browserProfile) || undefined;
    const loginType = parseLoginType(params.loginType);
    const keepalivePolicy = parseKeepalivePolicy(params.keepalivePolicy);
    const keepaliveUntil = readString(params.keepaliveUntil) || undefined;
    const notifyOnExpire =
      typeof params.notifyOnExpire === "boolean" ? params.notifyOnExpire : true;
    const notifyOnQrRequired =
      typeof params.notifyOnQrRequired === "boolean" ? params.notifyOnQrRequired : true;

    if (!siteKey) {
      respondBadRequest(respond, "invalid sitepool.create params: siteKey required");
      return;
    }
    if (!displayName) {
      respondBadRequest(respond, "invalid sitepool.create params: displayName required");
      return;
    }
    if (!loginType) {
      respondBadRequest(respond, "invalid sitepool.create params: unsupported loginType");
      return;
    }
    if (!keepalivePolicy) {
      respondBadRequest(respond, "invalid sitepool.create params: unsupported keepalivePolicy");
      return;
    }
    const created = await createSitePoolAccount({
      siteKey,
      displayName,
      browserProfile,
      loginType,
      keepalivePolicy,
      keepaliveUntil,
      notifyOnExpire,
      notifyOnQrRequired,
    });
    respond(true, created, undefined);
  },
  "sitepool.policy.update": async ({ params, respond }) => {
    const id = readString(params.id);
    const browserProfile = readString(params.browserProfile) || undefined;
    const keepalivePolicy = parseKeepalivePolicy(params.keepalivePolicy);
    const keepaliveUntil = readString(params.keepaliveUntil) || undefined;
    const notifyOnExpire =
      typeof params.notifyOnExpire === "boolean" ? params.notifyOnExpire : undefined;
    const notifyOnQrRequired =
      typeof params.notifyOnQrRequired === "boolean" ? params.notifyOnQrRequired : undefined;

    if (!id) {
      respondBadRequest(respond, "invalid sitepool.policy.update params: id required");
      return;
    }
    if (!keepalivePolicy) {
      respondBadRequest(
        respond,
        "invalid sitepool.policy.update params: unsupported keepalivePolicy",
      );
      return;
    }

    const updated = await updateSitePoolPolicy({
      id,
      keepalivePolicy,
      browserProfile,
      keepaliveUntil,
      notifyOnExpire,
      notifyOnQrRequired,
    });
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "site account not found"));
      return;
    }
    respond(true, updated, undefined);
  },
  "sitepool.check": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respondBadRequest(respond, "invalid sitepool.check params: id required");
      return;
    }
    const account = await getSitePoolAccountById(id);
    if (!account) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "site account not found"));
      return;
    }
    try {
      const outcome = await runSitePoolCheck(account);
      const updated = await applySitePoolCheckOutcome({ id, outcome });
      respond(true, updated ?? account, undefined);
      return;
    } catch (err) {
      await markSitePoolFailure({
        id,
        eventType: "refresh_failed",
        message: String(err),
      });
      const fallback = await checkSitePoolAccount(id);
      respond(
        false,
        fallback ?? undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sitepool.check failed: ${String(err)}`),
      );
      return;
    }
  },
  "sitepool.reauth": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respondBadRequest(respond, "invalid sitepool.reauth params: id required");
      return;
    }
    const account = await getSitePoolAccountById(id);
    if (!account) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "site account not found"));
      return;
    }
    try {
      const outcome = await runSitePoolReauth(account);
      const result = await applySitePoolReauthOutcome({ id, outcome });
      respond(true, result, undefined);
      return;
    } catch (err) {
      await markSitePoolFailure({
        id,
        eventType: "login_failed",
        message: String(err),
      });
      // Keep backward-compatible fallback reauth task creation if runtime fails.
      const fallback = await requestSitePoolReauth(id);
      respond(
        false,
        fallback ?? undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sitepool.reauth failed: ${String(err)}`),
      );
      return;
    }
  },
  "sitepool.qr": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respondBadRequest(respond, "invalid sitepool.qr params: id required");
      return;
    }
    const qrTask = await getSitePoolQrTask(id);
    respond(true, { id, qrTask }, undefined);
  },
  "sitepool.events": async ({ params, respond }) => {
    const id = readString(params.id);
    const limitRaw = Number(params.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.floor(limitRaw)) : 50;
    if (!id) {
      respondBadRequest(respond, "invalid sitepool.events params: id required");
      return;
    }
    const events = await listSitePoolEvents({ siteAccountId: id, limit });
    respond(true, { id, count: events.length, events }, undefined);
  },
};
