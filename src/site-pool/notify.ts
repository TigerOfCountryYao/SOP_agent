import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/config.js";
import { resolveTelegramAccount } from "../telegram/accounts.js";
import { sendMessageTelegram } from "../telegram/send.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { DEFAULT_SITE_POOL_DIR } from "./store.js";
import type { SitePoolCheckOutcome } from "./adapters.js";
import type { SitePoolAccount } from "./types.js";

const log = createSubsystemLogger("site-pool").child("notify");
const QR_NOTIFY_DIR = path.join(DEFAULT_SITE_POOL_DIR, "qr-notify");
const QR_NOTIFY_RETENTION_MS = 12 * 60 * 60 * 1000;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveTelegramTarget(): { to: string; accountId?: string } | null {
  const cfg = loadConfig();
  const accountId = trimText(process.env.OPENCLAW_SITEPOOL_NOTIFY_TELEGRAM_ACCOUNT) || undefined;
  const explicitTo = trimText(process.env.OPENCLAW_SITEPOOL_NOTIFY_TELEGRAM_TO);
  if (explicitTo) {
    return { to: explicitTo, accountId };
  }

  const account = resolveTelegramAccount({ cfg, accountId }).config;
  const fallback = (account.allowFrom ?? [])
    .map((entry) => String(entry).trim())
    .find((entry) => entry && entry !== "*");
  if (!fallback) {
    return null;
  }
  return { to: fallback, accountId };
}

async function cleanupNotifyDir(): Promise<void> {
  try {
    const entries = await fs.promises.readdir(QR_NOTIFY_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(QR_NOTIFY_DIR, entry.name);
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat) {
        continue;
      }
      if (now - stat.mtimeMs > QR_NOTIFY_RETENTION_MS) {
        await fs.promises.unlink(filePath).catch(() => {});
      }
    }
  } catch {
    // Ignore cleanup failures; notification path is best-effort.
  }
}

function parseImageDataUrl(dataUrl: string): { ext: string; bytes: Buffer } | null {
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const subtype = match[1].toLowerCase();
  const ext = subtype === "jpeg" ? "jpg" : subtype;
  return {
    ext,
    bytes: Buffer.from(match[2], "base64"),
  };
}

async function writeQrTempImage(params: {
  accountId: string;
  dataUrl?: string;
}): Promise<string | undefined> {
  const dataUrl = trimText(params.dataUrl);
  if (!dataUrl) {
    return undefined;
  }
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return undefined;
  }
  await fs.promises.mkdir(QR_NOTIFY_DIR, { recursive: true });
  await cleanupNotifyDir();
  const stamp = Date.now();
  const filename = `${params.accountId}-${stamp}.${parsed.ext}`;
  const filePath = path.join(QR_NOTIFY_DIR, filename);
  await fs.promises.writeFile(filePath, parsed.bytes);
  return filePath;
}

export function buildQrOutcomeFingerprint(outcome: SitePoolCheckOutcome): string {
  const payload = {
    status: outcome.status,
    qrRawText: trimText(outcome.qrRawText),
    qrDataHash: outcome.qrDataUrl
      ? createHash("sha1").update(outcome.qrDataUrl).digest("hex")
      : undefined,
    details: outcome.details ?? {},
  };
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

export async function sendSitePoolQrRequiredNotification(params: {
  account: SitePoolAccount;
  outcome: SitePoolCheckOutcome;
}): Promise<boolean> {
  const target = resolveTelegramTarget();
  if (!target) {
    log.warn("skip QR notification: telegram target unresolved");
    return false;
  }

  const { account, outcome } = params;
  const mediaPath = await writeQrTempImage({
    accountId: account.id,
    dataUrl: outcome.qrDataUrl,
  }).catch(() => undefined);

  const lines = [
    "SitePool login requires reauth",
    `Site: ${account.displayName} (${account.siteKey})`,
    `Status: ${outcome.status}`,
  ];
  if (outcome.qrRawText) {
    lines.push(`QR: ${outcome.qrRawText}`);
  }
  const text = lines.join("\n");

  await sendMessageTelegram(target.to, text, {
    accountId: target.accountId,
    textMode: "html",
    mediaUrl: mediaPath,
    mediaLocalRoots: [DEFAULT_SITE_POOL_DIR],
  });
  return true;
}
