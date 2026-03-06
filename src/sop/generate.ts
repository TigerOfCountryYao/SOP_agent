/**
 * SOP Generator
 *
 * 从任务描述生成 SOP 骨架代码和 SOP.md 文件。
 * 支持两种模式：
 * 1. 模板生成 — 根据任务描述生成可填充的骨架代码
 * 2. LLM 生成 — 使用 LLM 生成完整的 SOP 实现
 */

import nodeFs from "node:fs";
import nodePath from "node:path";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type GenerateSOPOptions = {
  /** SOP 名称 (用作目录名和 SOP 标识) */
  name: string;
  /** SOP 描述 */
  description: string;
  /** SOP 目录 (sops/ 的路径) */
  sopsDir: string;
  /** 需要的步骤描述列表 */
  steps?: string[];
  /** Cron 表达式 (可选) */
  schedule?: string;
  /** 事件触发列表 (可选) */
  triggers?: string[];
  /** LLM 调用函数 (可选，提供则生成完整实现) */
  llmCall?: (prompt: string) => Promise<string | null>;
  /** 是否覆盖已存在的 SOP */
  overwrite?: boolean;
};

export type GenerateSOPResult = {
  /** 生成的 SOP 目录 */
  dirPath: string;
  /** 生成的 sop.ts 路径 */
  filePath: string;
  /** 生成的 SOP.md 路径 */
  mdPath: string;
  /** 生成模式 */
  mode: "template" | "llm";
  /** 生成的代码 */
  code: string;
};

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 生成 SOP 文件 */
export async function generateSOP(opts: GenerateSOPOptions): Promise<GenerateSOPResult> {
  const {
    name,
    description,
    sopsDir,
    steps = [],
    schedule,
    triggers,
    llmCall,
    overwrite = false,
  } = opts;

  const dirPath = nodePath.join(nodePath.resolve(sopsDir), name);
  const filePath = nodePath.join(dirPath, "sop.ts");
  const mdPath = nodePath.join(dirPath, "SOP.md");

  // 检查是否已存在
  if (!overwrite) {
    try {
      await nodeFs.promises.access(filePath);
      throw new Error(`SOP already exists: ${filePath}. Set overwrite=true to replace.`);
    } catch (err) {
      if ((err as { code?: string })?.code !== "ENOENT") throw err;
    }
  }

  // 生成代码
  let code: string;
  let mode: "template" | "llm";

  if (llmCall) {
    // LLM 模式: 让 LLM 生成完整实现
    const prompt = buildGeneratePrompt(name, description, steps, schedule, triggers);
    const response = await llmCall(prompt);
    if (response) {
      code = extractCodeFromResponse(response) ?? buildTemplateCode(name, description, steps, schedule, triggers);
      mode = "llm";
    } else {
      code = buildTemplateCode(name, description, steps, schedule, triggers);
      mode = "template";
    }
  } else {
    // 模板模式: 生成骨架代码
    code = buildTemplateCode(name, description, steps, schedule, triggers);
    mode = "template";
  }

  // 生成 SOP.md
  const md = buildSOPMd(name, description, steps, schedule, triggers);

  // 写入文件
  await nodeFs.promises.mkdir(dirPath, { recursive: true });
  await nodeFs.promises.writeFile(filePath, code, "utf-8");
  await nodeFs.promises.writeFile(mdPath, md, "utf-8");

  return { dirPath, filePath, mdPath, mode, code };
}

// ---------------------------------------------------------------------------
// 模板生成
// ---------------------------------------------------------------------------

/** 生成骨架代码 */
function buildTemplateCode(
  name: string,
  description: string,
  steps: string[],
  schedule?: string,
  triggers?: string[],
): string {
  const imports = ['import { defineSOP, browser, shell, fs, verify } from "openclaw/sop";'];

  const scheduleField = schedule ? `\n  schedule: "${schedule}",` : "";
  const triggersField = triggers?.length ? `\n  triggers: ${JSON.stringify(triggers)},` : "";

  const stepComments = steps.length > 0
    ? steps.map((s, i) => `    // 步骤 ${i + 1}: ${s}\n    // TODO: 实现此步骤\n    ctx.log("步骤 ${i + 1}: ${s}");`).join("\n\n")
    : '    // TODO: 在此添加 SOP 步骤\n    ctx.log("SOP 开始执行...");';

  return `${imports.join("\n")}

export default defineSOP({
  name: "${name}",
  description: "${description}",${scheduleField}${triggersField}

  async run(ctx) {
${stepComments}

    return {};
  },
});
`;
}

/** 生成 SOP.md */
function buildSOPMd(
  name: string,
  description: string,
  steps: string[],
  schedule?: string,
  triggers?: string[],
): string {
  let md = `---
name: ${name}
description: ${description}
---

# ${name}

${description}
`;

  if (schedule) {
    md += `\n## 调度\n\nCron 表达式: \`${schedule}\`\n`;
  }

  if (triggers?.length) {
    md += `\n## 触发事件\n\n${triggers.map((t) => `- \`${t}\``).join("\n")}\n`;
  }

  if (steps.length > 0) {
    md += `\n## 执行步骤\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`;
  }

  return md;
}

// ---------------------------------------------------------------------------
// LLM 生成
// ---------------------------------------------------------------------------

/** 构建 LLM 生成提示词 */
function buildGeneratePrompt(
  name: string,
  description: string,
  steps: string[],
  schedule?: string,
  triggers?: string[],
): string {
  const stepsText = steps.length > 0
    ? `\n## 步骤描述\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  return `你是一个 SOP 代码生成专家。请根据以下描述生成一个完整可执行的 SOP TypeScript 文件。

## 任务描述

- **名称**: ${name}
- **描述**: ${description}
${schedule ? `- **调度**: \`${schedule}\`\n` : ""}${triggers?.length ? `- **触发事件**: ${triggers.join(", ")}\n` : ""}${stepsText}

## SDK API

可用的工具函数：

\`\`\`typescript
// 浏览器操作
browser.open(url) → { targetId }
browser.snapshot(targetId) → { snapshot }
browser.click(targetId, { ref }) → void
browser.type(targetId, { ref, text }) → void
browser.fill(targetId, fields) → void
browser.navigate(targetId, url) → void
browser.evaluate(targetId, js) → unknown
browser.screenshot(targetId) → string (file path)
browser.wait(targetId, { text?, textGone?, timeMs? }) → void
browser.close(targetId?) → void

// Shell 操作
shell.run(command, { cwd?, timeoutMs? }) → { stdout, stderr, exitCode }

// 文件操作
fs.read(path) → string
fs.write(path, content) → void
fs.exists(path) → boolean
fs.list(dir) → string[]
fs.mkdir(dir) → void
fs.remove(path) → void
fs.copy(src, dest) → void

// 验证
verify.snapshotContains(targetId, text) → void (抛异常)
verify.urlContains(targetId, text) → void
verify.notEmpty(value, msg?) → void
verify.fileExists(path) → void
verify.equals(actual, expected, msg?) → void
verify.match(value, pattern, msg?) → void
\`\`\`

## 代码模板

\`\`\`typescript
import { defineSOP, browser, shell, fs, verify } from "openclaw/sop";

export default defineSOP({
  name: "${name}",
  description: "${description}",
  ${schedule ? `schedule: "${schedule}",` : ""}
  ${triggers?.length ? `triggers: ${JSON.stringify(triggers)},` : ""}

  async run(ctx) {
    // 你的实现...
    return {};
  },
});
\`\`\`

## 要求

1. 生成完整可执行的代码
2. 每个关键步骤都添加 ctx.log() 日志
3. 每个关键步骤后添加 verify.* 验证
4. 处理可能的错误场景
5. 只输出代码，不需要解释

用 \`\`\`typescript 代码块包裹你的代码。`;
}

/** 从 LLM 响应中提取代码 */
function extractCodeFromResponse(response: string): string | undefined {
  // 尝试匹配 ```typescript 代码块
  const match = /```(?:typescript|ts)\n([\s\S]*?)```/i.exec(response);
  if (match?.[1]) {
    return match[1].trim();
  }

  // 尝试匹配 <code> 标签
  const codeMatch = /<code>([\s\S]*?)<\/code>/i.exec(response);
  if (codeMatch?.[1]) {
    return codeMatch[1].trim();
  }

  // 如果整个响应看起来像代码，直接返回
  if (response.includes("defineSOP") && response.includes("export default")) {
    return response.trim();
  }

  return undefined;
}
