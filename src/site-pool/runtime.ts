import { chromium, type Browser, type Page } from "playwright-core";
import type { SitePoolAccount } from "./types.js";
import { isChromeReachable, launchOpenClawChrome } from "../browser/chrome.js";
import { resolveBrowserConfig, resolveProfile } from "../browser/config.js";
import { loadConfig } from "../config/config.js";
import {
  resolveSiteAdapter,
  type SitePoolCheckOutcome,
  type SitePoolReauthOutcome,
} from "./adapters.js";

export async function runSitePoolCheck(account: SitePoolAccount): Promise<SitePoolCheckOutcome> {
  const adapter = resolveSiteAdapter(account);
  return await withSitePoolPage(
    account.browserProfile,
    async (page) => await adapter.check(page, account),
  );
}

export async function runSitePoolReauth(account: SitePoolAccount): Promise<SitePoolReauthOutcome> {
  const adapter = resolveSiteAdapter(account);
  return await withSitePoolPage(
    account.browserProfile,
    async (page) => await adapter.reauth(page, account),
  );
}

async function withSitePoolPage<T>(
  browserProfile: string | undefined,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const { cdpUrl, mustCloseConnection } = await ensureBrowserForSitePool(browserProfile);
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 20_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return await fn(page);
  } finally {
    if (browser && mustCloseConnection) {
      await browser.close().catch(() => {});
    }
  }
}

async function ensureBrowserForSitePool(browserProfile?: string): Promise<{
  cdpUrl: string;
  mustCloseConnection: boolean;
}> {
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const preferredProfile = browserProfile?.trim() || resolved.defaultProfile;
  const profile = resolveProfile(resolved, preferredProfile);
  if (!profile) {
    throw new Error(`browser profile not found: ${preferredProfile}`);
  }
  const reachable = await isChromeReachable(profile.cdpUrl, 1_000);
  if (!reachable) {
    if (!profile.cdpIsLoopback) {
      throw new Error(`remote browser profile not reachable: ${profile.name}`);
    }
    if (resolved.attachOnly) {
      throw new Error(`browser attachOnly is enabled and profile ${profile.name} is not running`);
    }
    await launchOpenClawChrome(resolved, profile);
  }
  return {
    cdpUrl: profile.cdpUrl,
    mustCloseConnection: true,
  };
}
