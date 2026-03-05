/**
 * defineSOP() — SOP 定义 API
 *
 * 每个 sop.ts 文件通过 export default defineSOP({...}) 定义 SOP。
 * 当前为 identity 函数，未来可添加验证、注册逻辑。
 */

import type { SOPDefinition } from "./types.js";

export function defineSOP(def: SOPDefinition): SOPDefinition {
  if (!def.name?.trim()) {
    throw new Error("SOP name is required");
  }
  if (!def.run || typeof def.run !== "function") {
    throw new Error("SOP run function is required");
  }
  return def;
}
