/**
 * SOP Module — 公共导出
 *
 * 用法:
 *   import { defineSOP, browser, shell, fs, verify } from "openclaw/sop";
 */

// 定义 API
export { defineSOP } from "./define.js";

// 类型
export type {
  SOPDefinition,
  SOPContext,
  SOPResult,
  SOPRunRecord,
  SOPStepRecord,
  SOPEntry,
  SOPKVStore,
} from "./types.js";
export { SOPAbortError, SOPVerifyError } from "./types.js";

// SDK 工具
export { browser, shell, fs, verify } from "./sdk.js";

// Runner
export { discoverSOPs, loadSOP, runSOP, runSOPByName } from "./runner.js";
export type { RunSOPOptions } from "./runner.js";

// Store
export { loadRunHistory } from "./store.js";

// Scheduler
export { SOPScheduler } from "./scheduler.js";
export type { SOPSchedulerOpts } from "./scheduler.js";
export type { SOPSchedulerStatus } from "./types.js";

// Self-Healing
export { healSOP, createOpenClawLLMCall } from "./heal.js";
export type { HealStrategy, HealResult, HealOptions } from "./heal.js";

// SOP Generation
export { generateSOP } from "./generate.js";
export type { GenerateSOPOptions, GenerateSOPResult } from "./generate.js";
