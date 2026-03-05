/**
 * SOP SDK
 *
 * 提供 browser / shell / fs / verify 工具函数。
 * 每个函数是对 OpenClaw 现有能力的薄封装，添加步骤日志记录。
 *
 * 使用方式: import { browser, shell, fs, verify } from "openclaw/sop";
 *
 * 注意: SDK 函数依赖一个运行时上下文 (activeLogger)，
 * 由 runner.ts 在执行 SOP 前通过 setActiveLogger() 设置。
 */

import {
  browserOpenTab,
  browserSnapshot,
  browserCloseTab,
  browserTabs,
} from "../browser/client.js";
import {
  browserAct,
  browserNavigate,
  browserScreenshotAction,
} from "../browser/client-actions.js";
import { resolveBrowserConfig } from "../browser/config.js";
import { loadConfig } from "../config/config.js";
import { exec as nodeExec } from "node:child_process";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { promisify } from "node:util";

import type { SOPLogger } from "./logger.js";
import { SOPVerifyError } from "./types.js";

const execAsync = promisify(nodeExec);

// ---------------------------------------------------------------------------
// 运行时上下文 — 由 runner.ts 在执行前设置
// ---------------------------------------------------------------------------

// Use global symbol to share logger instance across potential module duplicates (jiti/esm)
const LOGGER_SYMBOL = Symbol.for("OpenClaw.SOP.ActiveLogger");

export function setActiveLogger(logger: SOPLogger | null): void {
  (globalThis as any)[LOGGER_SYMBOL] = logger;
}

function getLogger(): SOPLogger {
  const logger = (globalThis as any)[LOGGER_SYMBOL] as SOPLogger | undefined;
  if (!logger) {
    throw new Error("SOP SDK called outside of SOP execution context. Use runner.ts to execute SOPs.");
  }
  return logger;
}

// ---------------------------------------------------------------------------
// Browser SDK
// ---------------------------------------------------------------------------

function getBrowserBaseUrl(): string {
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  return `http://127.0.0.1:${resolved.controlPort}`;
}

// Allow overriding browser implementation for testing/mocking
// Use global symbol to share mock instance across modules
const BROWSER_MOCK_SYMBOL = Symbol.for("OpenClaw.SOP.BrowserMock");
export function setBrowserOverride(mock: typeof browser | null) {
  (globalThis as any)[BROWSER_MOCK_SYMBOL] = mock;
}
function getBrowserOverride(): typeof browser | undefined {
  return (globalThis as any)[BROWSER_MOCK_SYMBOL];
}

export const browser = {
  /** 打开新标签页 */
  async open(url: string, opts?: { profile?: string }): Promise<{ targetId: string }> {
    const mock = getBrowserOverride();
    if (mock) return mock.open(url, opts);

    return getLogger().recordStep("browser.open", { url, ...opts }, async () => {
      const baseUrl = getBrowserBaseUrl();
      const result = await browserOpenTab(baseUrl, url, { profile: opts?.profile });
      return { targetId: (result as { targetId?: string }).targetId ?? "" };
    });
  },

  /** 获取页面可访问性快照 */
  async snapshot(targetId: string, opts?: { refs?: "role" | "aria" }): Promise<{ snapshot: string }> {
    return getLogger().recordStep("browser.snapshot", { targetId, ...opts }, async () => {
      const baseUrl = getBrowserBaseUrl();
      const result = await browserSnapshot(baseUrl, {
        format: "ai",
        targetId,
        refs: opts?.refs,
      });
      const snapshot =
        typeof result === "object" &&
        result !== null &&
        "format" in result &&
        result.format === "ai"
          ? result.snapshot
          : JSON.stringify(result);
      return { snapshot };
    });
  },

  /** 点击元素 */
  async click(targetId: string, opts: { ref: string; doubleClick?: boolean }): Promise<void> {
    await getLogger().recordStep("browser.click", { targetId, ...opts }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserAct(baseUrl, {
        kind: "click",
        ref: opts.ref,
        targetId,
        doubleClick: opts.doubleClick,
      });
    });
  },

  /** 输入文本到指定元素 */
  async type(targetId: string, opts: { ref: string; text: string; submit?: boolean }): Promise<void> {
    await getLogger().recordStep("browser.type", { targetId, ref: opts.ref }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserAct(baseUrl, {
        kind: "type",
        ref: opts.ref,
        text: opts.text,
        targetId,
        submit: opts.submit,
      });
    });
  },

  /** 填充多个表单字段 */
  async fill(targetId: string, fields: { ref: string; value: string; type?: string }[]): Promise<void> {
    await getLogger().recordStep("browser.fill", { targetId, fieldCount: fields.length }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserAct(baseUrl, {
        kind: "fill",
        fields: fields.map((f) => ({ ref: f.ref, value: f.value, type: f.type ?? "text" })),
        targetId,
      });
    });
  },

  /** 导航到指定 URL */
  async navigate(targetId: string, url: string): Promise<void> {
    await getLogger().recordStep("browser.navigate", { targetId, url }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserNavigate(baseUrl, { targetId, url });
    });
  },

  /** 执行 JavaScript */
  async evaluate(targetId: string, js: string): Promise<unknown> {
    const mock = getBrowserOverride();
    if (mock) return mock.evaluate(targetId, js);

    return getLogger().recordStep("browser.evaluate", { targetId, js: js.slice(0, 100) }, async () => {
      const baseUrl = getBrowserBaseUrl();
      const result = await browserAct(baseUrl, {
        kind: "evaluate",
        fn: js,
        targetId,
      });
      return result.result;
    });
  },

  /** 截图 */
  async screenshot(targetId: string, opts?: { fullPage?: boolean }): Promise<string> {
    return getLogger().recordStep("browser.screenshot", { targetId, ...opts }, async () => {
      const baseUrl = getBrowserBaseUrl();
      const result = await browserScreenshotAction(baseUrl, {
        targetId,
        fullPage: opts?.fullPage,
      });
      return (result as { path?: string })?.path ?? "";
    });
  },

  /** 等待条件 */
  async wait(targetId: string, opts: {
    text?: string;
    textGone?: string;
    timeMs?: number;
    selector?: string;
    url?: string;
    loadState?: "load" | "domcontentloaded" | "networkidle";
  }): Promise<void> {
    const mock = getBrowserOverride();
    if (mock) return mock.wait(targetId, opts);

    await getLogger().recordStep("browser.wait", { targetId, ...opts }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserAct(baseUrl, {
        kind: "wait",
        targetId,
        text: opts.text,
        textGone: opts.textGone,
        timeMs: opts.timeMs,
        selector: opts.selector,
        url: opts.url,
        loadState: opts.loadState,
      });
    });
  },

  /** 按下键盘按键 */
  async press(targetId: string, key: string): Promise<void> {
    await getLogger().recordStep("browser.press", { targetId, key }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserAct(baseUrl, {
        kind: "press",
        key,
        targetId,
      });
    });
  },

  /** 悬停在元素上 */
  async hover(targetId: string, ref: string): Promise<void> {
    await getLogger().recordStep("browser.hover", { targetId, ref }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserAct(baseUrl, {
        kind: "hover",
        ref,
        targetId,
      });
    });
  },

  /** 下拉选择 */
  async select(targetId: string, opts: { ref: string; values: string[] }): Promise<void> {
    await getLogger().recordStep("browser.select", { targetId, ...opts }, async () => {
      const baseUrl = getBrowserBaseUrl();
      await browserAct(baseUrl, {
        kind: "select",
        ref: opts.ref,
        values: opts.values,
        targetId,
      });
    });
  },

  /** 关闭标签页 */
  async close(targetId?: string): Promise<void> {
    const mock = getBrowserOverride();
    if (mock) return mock.close(targetId);

    await getLogger().recordStep("browser.close", { targetId }, async () => {
      if (targetId) {
        const baseUrl = getBrowserBaseUrl();
        await browserCloseTab(baseUrl, targetId);
      }
    });
  },

  /** 获取标签页列表 */
  async tabs(profile?: string): Promise<unknown[]> {
    return getLogger().recordStep("browser.tabs", { profile }, async () => {
      const baseUrl = getBrowserBaseUrl();
      const result = await browserTabs(baseUrl, { profile });
      return Array.isArray(result) ? result : [];
    });
  },
};

// ---------------------------------------------------------------------------
// Shell SDK
// ---------------------------------------------------------------------------

export const shell = {
  /** 执行 shell 命令 */
  async run(
    command: string,
    opts?: { cwd?: string; stdin?: string; timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return getLogger().recordStep("shell.run", { command: command.slice(0, 200), ...opts }, async () => {
      try {
        const result = await execAsync(command, {
          cwd: opts?.cwd,
          timeout: opts?.timeoutMs ?? 60_000,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        return {
          stdout: result.stdout?.toString() ?? "",
          stderr: result.stderr?.toString() ?? "",
          exitCode: 0,
        };
      } catch (err) {
        const execErr = err as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number };
        return {
          stdout: execErr.stdout?.toString() ?? "",
          stderr: execErr.stderr?.toString() ?? "",
          exitCode: execErr.code ?? 1,
        };
      }
    });
  },
};

// ---------------------------------------------------------------------------
// File System SDK
// ---------------------------------------------------------------------------

export const fs = {
  /** 读取文件内容 */
  async read(filePath: string): Promise<string> {
    return getLogger().recordStep("fs.read", { path: filePath }, async () => {
      return nodeFs.promises.readFile(filePath, "utf-8");
    });
  },

  /** 写入文件 */
  async write(filePath: string, content: string): Promise<void> {
    await getLogger().recordStep("fs.write", { path: filePath, length: content.length }, async () => {
      await nodeFs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
      await nodeFs.promises.writeFile(filePath, content, "utf-8");
    });
  },

  /** 检查文件是否存在 */
  async exists(filePath: string): Promise<boolean> {
    return getLogger().recordStep("fs.exists", { path: filePath }, async () => {
      try {
        await nodeFs.promises.access(filePath);
        return true;
      } catch {
        return false;
      }
    });
  },

  /** 列出目录内容 */
  async list(dirPath: string): Promise<string[]> {
    return getLogger().recordStep("fs.list", { path: dirPath }, async () => {
      return nodeFs.promises.readdir(dirPath);
    });
  },

  /** 创建目录 */
  async mkdir(dirPath: string): Promise<void> {
    await getLogger().recordStep("fs.mkdir", { path: dirPath }, async () => {
      await nodeFs.promises.mkdir(dirPath, { recursive: true });
    });
  },

  /** 删除文件或目录 */
  async remove(filePath: string): Promise<void> {
    await getLogger().recordStep("fs.remove", { path: filePath }, async () => {
      await nodeFs.promises.rm(filePath, { recursive: true, force: true });
    });
  },

  /** 复制文件 */
  async copy(src: string, dest: string): Promise<void> {
    await getLogger().recordStep("fs.copy", { src, dest }, async () => {
      await nodeFs.promises.mkdir(nodePath.dirname(dest), { recursive: true });
      await nodeFs.promises.copyFile(src, dest);
    });
  },
};

// ---------------------------------------------------------------------------
// Verify SDK
// ---------------------------------------------------------------------------

export const verify = {
  /** 验证快照包含指定文本 */
  async snapshotContains(targetId: string, text: string): Promise<void> {
    const { snapshot } = await browser.snapshot(targetId);
    if (!snapshot.includes(text)) {
      throw new SOPVerifyError(
        `Snapshot does not contain "${text}"`,
        "verify.snapshotContains",
      );
    }
  },

  /** 验证当前 URL 包含指定文本 */
  async urlContains(targetId: string, text: string): Promise<void> {
    const result = await browser.evaluate(targetId, "window.location.href");
    const url = typeof result === "string" ? result : String(result);
    if (!url.includes(text)) {
      throw new SOPVerifyError(
        `URL "${url}" does not contain "${text}"`,
        "verify.urlContains",
      );
    }
  },

  /** 验证值不为空 */
  notEmpty(value: unknown, msg?: string): void {
    if (value === undefined || value === null || value === "" ||
        (Array.isArray(value) && value.length === 0)) {
      throw new SOPVerifyError(
        msg ?? "Value is empty",
        "verify.notEmpty",
      );
    }
  },

  /** 验证文件存在 */
  async fileExists(filePath: string): Promise<void> {
    const exists = await fs.exists(filePath);
    if (!exists) {
      throw new SOPVerifyError(
        `File does not exist: ${filePath}`,
        "verify.fileExists",
      );
    }
  },

  /** 验证值相等 */
  equals(actual: unknown, expected: unknown, msg?: string): void {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
      throw new SOPVerifyError(
        msg ?? `Expected ${expectedStr}, got ${actualStr}`,
        "verify.equals",
      );
    }
  },

  /** 验证正则匹配 */
  match(value: string, pattern: RegExp, msg?: string): void {
    if (!pattern.test(value)) {
      throw new SOPVerifyError(
        msg ?? `Value "${value.slice(0, 100)}" does not match pattern ${pattern}`,
        "verify.match",
      );
    }
  },

  /** 验证数值大于等于 */
  gte(actual: number, expected: number, msg?: string): void {
    if (actual < expected) {
      throw new SOPVerifyError(
        msg ?? `Expected >= ${expected}, got ${actual}`,
        "verify.gte",
      );
    }
  },
};
