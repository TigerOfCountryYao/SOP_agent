import { createSubsystemLogger } from "../logging/subsystem.js";
import { runSitePoolCheck } from "./runtime.js";
import { applySitePoolCheckOutcome, listSitePoolAccounts, markSitePoolFailure } from "./store.js";
import type { SitePoolAccount } from "./types.js";
import {
  buildQrOutcomeFingerprint,
  sendSitePoolQrRequiredNotification,
} from "./notify.js";

const log = createSubsystemLogger("site-pool").child("keepalive");
const DEFAULT_KEEPALIVE_INTERVAL_MS = 5 * 60_000;
const MIN_KEEPALIVE_INTERVAL_MS = 30_000;
const QR_NOTIFY_DEDUPE_WINDOW_MS = 15 * 60_000;

export type SitePoolKeepaliveService = {
  stop: () => void;
  runNow: () => Promise<void>;
};

function shouldRunKeepalive(account: SitePoolAccount, nowMs: number): boolean {
  if (account.keepalivePolicy === "off") {
    return false;
  }
  if (account.keepalivePolicy === "continuous") {
    return true;
  }
  if (account.keepalivePolicy !== "until_date") {
    return false;
  }
  const untilRaw = account.keepaliveUntil?.trim() ?? "";
  if (!untilRaw) {
    return false;
  }
  const untilMs = Date.parse(untilRaw);
  if (!Number.isFinite(untilMs)) {
    return false;
  }
  return nowMs <= untilMs;
}

function resolveKeepaliveIntervalMs(): number {
  const raw = Number(process.env.OPENCLAW_SITEPOOL_KEEPALIVE_MS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_KEEPALIVE_INTERVAL_MS;
  }
  const value = Math.floor(raw);
  if (value < MIN_KEEPALIVE_INTERVAL_MS) {
    return MIN_KEEPALIVE_INTERVAL_MS;
  }
  return value;
}

export function startSitePoolKeepaliveService(): SitePoolKeepaliveService {
  let inFlight = false;
  const qrNotifyState = new Map<string, { fingerprint: string; sentAtMs: number }>();

  const runNow = async () => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      const nowMs = Date.now();
      const accounts = await listSitePoolAccounts();
      for (const account of accounts) {
        if (!shouldRunKeepalive(account, nowMs)) {
          continue;
        }
        try {
          const outcome = await runSitePoolCheck(account);
          const updated = await applySitePoolCheckOutcome({ id: account.id, outcome });
          if (
            updated &&
            updated.notifyOnExpire &&
            (updated.status === "expiring" || updated.status === "expired")
          ) {
            log.warn(
              `account ${updated.id} (${updated.siteKey}/${updated.displayName}) requires expiry handling: ${updated.status}`,
            );
          }
          if (
            account.notifyOnQrRequired &&
            (outcome.status === "reauth_required" || outcome.qrDataUrl || outcome.qrRawText)
          ) {
            log.warn(
              `account ${account.id} (${account.siteKey}/${account.displayName}) requires QR reauth`,
            );
            const fingerprint = buildQrOutcomeFingerprint(outcome);
            const nowMsForNotify = Date.now();
            const prev = qrNotifyState.get(account.id);
            const shouldNotify =
              !prev ||
              prev.fingerprint !== fingerprint ||
              nowMsForNotify - prev.sentAtMs > QR_NOTIFY_DEDUPE_WINDOW_MS;
            if (shouldNotify) {
              const sent = await sendSitePoolQrRequiredNotification({
                account,
                outcome,
              }).catch((err) => {
                log.warn(`QR notify failed for ${account.id}: ${String(err)}`);
                return false;
              });
              if (sent) {
                qrNotifyState.set(account.id, {
                  fingerprint,
                  sentAtMs: nowMsForNotify,
                });
              }
            }
          } else if (outcome.status === "active") {
            qrNotifyState.delete(account.id);
          }
        } catch (err) {
          await markSitePoolFailure({
            id: account.id,
            eventType: "refresh_failed",
            message: String(err),
          });
          log.warn(`keepalive check failed for ${account.id}: ${String(err)}`);
        }
      }
    } catch (err) {
      log.error(`keepalive sweep failed: ${String(err)}`);
    } finally {
      inFlight = false;
    }
  };

  const intervalMs = resolveKeepaliveIntervalMs();
  const interval = setInterval(() => {
    void runNow();
  }, intervalMs);
  const initial = setTimeout(() => {
    void runNow();
  }, 10_000);

  log.info(`site-pool keepalive service started (${intervalMs}ms interval)`);

  return {
    stop: () => {
      clearInterval(interval);
      clearTimeout(initial);
      log.info("site-pool keepalive service stopped");
    },
    runNow,
  };
}
