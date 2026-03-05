import fs from "node:fs";
import path from "node:path";
import type { SitePoolAccount } from "./types.js";
import { DEFAULT_SITE_POOL_DIR } from "./store.js";

const SITE_POOL_SCRIPT_PATH = path.join(DEFAULT_SITE_POOL_DIR, "scripts.json");

export type SitePoolHealthScript = {
  version: 1;
  siteKey: string;
  url?: string;
  loggedInSelectors: string[];
  qrSelectors: string[];
  reauthTriggerSelectors: string[];
  waitAfterActionMs: number;
  source: "builtin" | "learned";
};

type SitePoolScriptStore = {
  version: 1;
  scripts: Record<string, SitePoolHealthScript>;
};

export type SitePoolScriptEvidence = {
  matchedLoggedInSelector?: string;
  matchedQrSelector?: string;
  matchedReauthTriggerSelector?: string;
};

const DEFAULT_QR_SELECTORS = [
  "canvas",
  "img[src^='data:image']",
  "img[src*='qr']",
  "img[src*='qrcode']",
  "[class*='qr'] img",
  "[class*='qrcode'] img",
];

const DEFAULT_LOGGED_IN_SELECTORS = [
  "[class*='avatar']",
  "[data-e2e*='avatar']",
  "img[alt*='avatar']",
  "[class*='profile'] [class*='name']",
];

const DEFAULT_REAUTH_TRIGGER_SELECTORS = [
  "button:has-text('\\u91cd\\u65b0\\u767b\\u5f55')",
  "button:has-text('\\u767b\\u5f55')",
  "a:has-text('\\u91cd\\u65b0\\u767b\\u5f55')",
  "a:has-text('\\u767b\\u5f55')",
  "[role='button']:has-text('\\u91cd\\u65b0\\u767b\\u5f55')",
  "[role='button']:has-text('\\u767b\\u5f55')",
  "button:has-text('Sign in')",
  "a:has-text('Sign in')",
];

function normalizeSiteKey(siteKey: string): string {
  return siteKey.trim().toLowerCase();
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeScript(raw: SitePoolHealthScript): SitePoolHealthScript {
  const waitAfterActionMs = Number.isFinite(raw.waitAfterActionMs)
    ? Math.max(200, Math.floor(raw.waitAfterActionMs))
    : 1200;
  return {
    version: 1,
    siteKey: normalizeSiteKey(raw.siteKey),
    url: raw.url?.trim() || undefined,
    loggedInSelectors: unique(raw.loggedInSelectors),
    qrSelectors: unique(raw.qrSelectors),
    reauthTriggerSelectors: unique(raw.reauthTriggerSelectors),
    waitAfterActionMs,
    source: raw.source === "learned" ? "learned" : "builtin",
  };
}

function createDefaultStore(): SitePoolScriptStore {
  return { version: 1, scripts: {} };
}

async function readStore(): Promise<SitePoolScriptStore> {
  try {
    const raw = await fs.promises.readFile(SITE_POOL_SCRIPT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SitePoolScriptStore>;
    const scriptsRaw = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
    const scripts: Record<string, SitePoolHealthScript> = {};
    for (const [key, value] of Object.entries(scriptsRaw)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      scripts[normalizeSiteKey(key)] = normalizeScript(value as SitePoolHealthScript);
    }
    return { version: 1, scripts };
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return createDefaultStore();
    }
    throw err;
  }
}

async function writeStore(next: SitePoolScriptStore): Promise<void> {
  await fs.promises.mkdir(path.dirname(SITE_POOL_SCRIPT_PATH), { recursive: true });
  const tmp = `${SITE_POOL_SCRIPT_PATH}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.promises.rename(tmp, SITE_POOL_SCRIPT_PATH);
}

function defaultScriptForAccount(account: SitePoolAccount): SitePoolHealthScript {
  const siteKey = normalizeSiteKey(account.siteKey);
  if (siteKey === "douyin" || siteKey.includes("douyin")) {
    return {
      version: 1,
      siteKey,
      url: "https://creator.douyin.com/",
      loggedInSelectors: [
        ...DEFAULT_LOGGED_IN_SELECTORS,
        "a[href*='creator.douyin.com/creator-micro']",
      ],
      qrSelectors: DEFAULT_QR_SELECTORS,
      reauthTriggerSelectors: DEFAULT_REAUTH_TRIGGER_SELECTORS,
      waitAfterActionMs: 1400,
      source: "builtin",
    };
  }
  return {
    version: 1,
    siteKey,
    loggedInSelectors: DEFAULT_LOGGED_IN_SELECTORS,
    qrSelectors: DEFAULT_QR_SELECTORS,
    reauthTriggerSelectors: DEFAULT_REAUTH_TRIGGER_SELECTORS,
    waitAfterActionMs: 1200,
    source: "builtin",
  };
}

export async function loadSiteHealthScript(account: SitePoolAccount): Promise<SitePoolHealthScript> {
  const store = await readStore();
  const siteKey = normalizeSiteKey(account.siteKey);
  const existing = store.scripts[siteKey];
  if (existing) {
    return existing;
  }
  return defaultScriptForAccount(account);
}

export async function learnSiteHealthScript(params: {
  account: SitePoolAccount;
  baseScript: SitePoolHealthScript;
  evidence: SitePoolScriptEvidence;
}): Promise<void> {
  const { account, baseScript, evidence } = params;
  const siteKey = normalizeSiteKey(account.siteKey);
  const store = await readStore();
  const current = store.scripts[siteKey] ?? baseScript;
  const next: SitePoolHealthScript = {
    ...current,
    siteKey,
    source: "learned",
    loggedInSelectors: unique([
      evidence.matchedLoggedInSelector ?? "",
      ...current.loggedInSelectors,
    ]),
    qrSelectors: unique([evidence.matchedQrSelector ?? "", ...current.qrSelectors]),
    reauthTriggerSelectors: unique([
      evidence.matchedReauthTriggerSelector ?? "",
      ...current.reauthTriggerSelectors,
    ]),
  };
  store.scripts[siteKey] = normalizeScript(next);
  await writeStore(store);
}
