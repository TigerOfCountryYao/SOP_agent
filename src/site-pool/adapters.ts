import type { Locator, Page } from "playwright-core";
import type { SitePoolAccount, SitePoolStatus } from "./types.js";
import {
  learnSiteHealthScript,
  loadSiteHealthScript,
  type SitePoolHealthScript,
} from "./scripts.js";

const DEFAULT_SITE_POOL_NAV_TIMEOUT_MS = 60_000;
const DEFAULT_SITE_POOL_SETTLE_WAIT_MS = 1_500;

function readEnvTimeoutMs(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

type SitePoolCheckOutcome = {
  status: SitePoolStatus;
  expiresAt?: string;
  qrDataUrl?: string;
  qrRawText?: string;
  details?: Record<string, unknown>;
};

type SitePoolReauthOutcome = {
  status: SitePoolStatus;
  qrDataUrl?: string;
  qrRawText?: string;
  expiresAt?: string;
  details?: Record<string, unknown>;
};

type SiteAdapter = {
  check: (page: Page, account: SitePoolAccount) => Promise<SitePoolCheckOutcome>;
  reauth: (page: Page, account: SitePoolAccount) => Promise<SitePoolReauthOutcome>;
};

type SelectorMatch = {
  selector: string;
  locator: Locator;
};

const scriptedAdapter: SiteAdapter = {
  async check(page, account) {
    return await evaluateSiteScript(page, account, "check");
  },
  async reauth(page, account) {
    return await evaluateSiteScript(page, account, "reauth");
  },
};

export function resolveSiteAdapter(_account: SitePoolAccount): SiteAdapter {
  return scriptedAdapter;
}

async function evaluateSiteScript(
  page: Page,
  account: SitePoolAccount,
  mode: "check" | "reauth",
): Promise<SitePoolCheckOutcome> {
  const script = await loadSiteHealthScript(account);
  const target = resolveTargetUrl(account, script);
  const navTimeoutMs = readEnvTimeoutMs(
    "OPENCLAW_SITEPOOL_NAV_TIMEOUT_MS",
    DEFAULT_SITE_POOL_NAV_TIMEOUT_MS,
    5_000,
    180_000,
  );
  const settleWaitMs = readEnvTimeoutMs(
    "OPENCLAW_SITEPOOL_SETTLE_WAIT_MS",
    DEFAULT_SITE_POOL_SETTLE_WAIT_MS,
    0,
    30_000,
  );
  await page.goto(target, {
    waitUntil: "domcontentloaded",
    timeout: navTimeoutMs,
  });
  await page.waitForTimeout(settleWaitMs);

  const loggedIn = await firstVisibleSelector(page, script.loggedInSelectors);
  if (loggedIn) {
    await learnSiteHealthScript({
      account,
      baseScript: script,
      evidence: { matchedLoggedInSelector: loggedIn.selector },
    }).catch(() => {});
    return {
      status: "active",
      details: {
        mode,
        signal: "logged_in_selector",
        selector: loggedIn.selector,
        scriptSource: script.source,
      },
    };
  }

  const initialQr = await findQrMatch(page, script.qrSelectors);
  if (initialQr) {
    await learnSiteHealthScript({
      account,
      baseScript: script,
      evidence: { matchedQrSelector: initialQr.selector },
    }).catch(() => {});
    return {
      status: "reauth_required",
      qrDataUrl: initialQr.qrDataUrl,
      details: {
        mode,
        signal: "qr_detected_initial",
        selector: initialQr.selector,
        scriptSource: script.source,
      },
    };
  }

  const trigger = await firstVisibleSelector(page, script.reauthTriggerSelectors);
  if (trigger) {
    await trigger.locator.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(script.waitAfterActionMs);
    const afterClickQr = await findQrMatch(page, script.qrSelectors);
    if (afterClickQr) {
      await learnSiteHealthScript({
        account,
        baseScript: script,
        evidence: {
          matchedReauthTriggerSelector: trigger.selector,
          matchedQrSelector: afterClickQr.selector,
        },
      }).catch(() => {});
      return {
        status: "reauth_required",
        qrDataUrl: afterClickQr.qrDataUrl,
        details: {
          mode,
          signal: "qr_detected_after_reauth_click",
          triggerSelector: trigger.selector,
          qrSelector: afterClickQr.selector,
          scriptSource: script.source,
        },
      };
    }
  }

  return {
    status: "unknown",
    details: {
      mode,
      signal: "no_login_or_qr_signal",
      scriptSource: script.source,
    },
  };
}

function resolveTargetUrl(account: SitePoolAccount, script: SitePoolHealthScript): string {
  const raw = script.url?.trim() || account.siteKey.trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  return `https://${raw}`;
}

async function firstVisibleSelector(
  page: Page,
  selectors: string[],
): Promise<SelectorMatch | null> {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const normalized = selector.trim();
      if (!normalized) {
        continue;
      }
      try {
        const locator = frame.locator(normalized).first();
        if ((await locator.count()) === 0) {
          continue;
        }
        if (!(await locator.isVisible())) {
          continue;
        }
        return { selector: normalized, locator };
      } catch {
        // Keep probing; heterogeneous frontends often invalidate some selectors.
      }
    }
  }
  return null;
}

async function findQrMatch(
  page: Page,
  selectors: string[],
): Promise<{ selector: string; qrDataUrl?: string } | null> {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const normalized = selector.trim();
      if (!normalized) {
        continue;
      }
      try {
        const locator = frame.locator(normalized).first();
        if ((await locator.count()) === 0) {
          continue;
        }
        if (!(await locator.isVisible())) {
          continue;
        }
        const qrDataUrl = await extractElementAsDataUrl(locator);
        return { selector: normalized, qrDataUrl };
      } catch {
        // Keep probing; heterogeneous frontends often invalidate some selectors.
      }
    }
  }
  return null;
}

async function extractElementAsDataUrl(locator: Locator): Promise<string | undefined> {
  const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
  if (tagName === "img") {
    const src = await locator.evaluate((el) => (el as { src?: string }).src ?? "").catch(() => "");
    if (typeof src === "string" && src.startsWith("data:image/")) {
      return src;
    }
  }
  if (tagName === "canvas") {
    const data = await locator
      .evaluate((el) => (el as { toDataURL?: (type?: string) => string }).toDataURL?.("image/png"))
      .catch(() => "");
    if (typeof data === "string" && data.startsWith("data:image/")) {
      return data;
    }
  }
  const handle = await locator.elementHandle();
  if (!handle) {
    return undefined;
  }
  const png = await handle.screenshot({ type: "png" }).catch(() => null);
  if (!png) {
    return undefined;
  }
  return `data:image/png;base64,${png.toString("base64")}`;
}

export type { SitePoolCheckOutcome, SitePoolReauthOutcome };
