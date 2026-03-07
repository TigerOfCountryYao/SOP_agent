import nodeFs from "node:fs";
import nodePath from "node:path";
import { formatSOPSchedule, isValidSOPSchedule } from "./schedule.js";
import type { SOPSchedule } from "./types.js";

export type GenerateSOPOptions = {
  name: string;
  description: string;
  sopsDir: string;
  steps?: string[];
  schedule?: SOPSchedule;
  triggers?: string[];
  llmCall?: (prompt: string) => Promise<string | null>;
  overwrite?: boolean;
};

export type GenerateSOPResult = {
  dirPath: string;
  filePath: string;
  mdPath: string;
  mode: "template" | "llm";
  code: string;
  specValid: boolean;
};

export type SOPSpecModel = {
  name: string;
  description: string;
  objective: string;
  prerequisites: string[];
  inputs: string[];
  outputs: string[];
  steps: string[];
  validation: string[];
  recovery: string[];
  done: string[];
  schedule?: SOPSchedule;
  triggers?: string[];
};

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

  if (schedule && !isValidSOPSchedule(schedule)) {
    throw new Error("Invalid SOP schedule. Expected weekly days plus HH:MM time.");
  }

  const spec = buildSpecModel({ name, description, steps, schedule, triggers });
  return materializeSOP({
    spec,
    sopsDir,
    llmCall,
    overwrite,
  });
}

export async function materializeSOP(opts: {
  spec: SOPSpecModel;
  sopsDir: string;
  llmCall?: (prompt: string) => Promise<string | null>;
  overwrite?: boolean;
}): Promise<GenerateSOPResult> {
  const { spec, sopsDir, llmCall, overwrite = false } = opts;
  const dirPath = nodePath.join(nodePath.resolve(sopsDir), spec.name);
  const filePath = nodePath.join(dirPath, "sop.ts");
  const mdPath = nodePath.join(dirPath, "SOP.md");

  if (!overwrite) {
    try {
      await nodeFs.promises.access(filePath);
      throw new Error(`SOP already exists: ${filePath}. Set overwrite=true to replace.`);
    } catch (err) {
      if ((err as { code?: string })?.code !== "ENOENT") {
        throw err;
      }
    }
  }

  const md = buildSOPSpecMarkdown(spec);

  let code: string;
  let mode: "template" | "llm";
  if (llmCall) {
    const prompt = buildGeneratePrompt(spec, md);
    const response = await llmCall(prompt);
    code = extractCodeFromResponse(response ?? "") ?? buildExecutableTemplateCode(spec);
    mode = response ? "llm" : "template";
  } else {
    code = buildExecutableTemplateCode(spec);
    mode = "template";
  }

  await nodeFs.promises.mkdir(dirPath, { recursive: true });
  await nodeFs.promises.writeFile(mdPath, md, "utf-8");
  await nodeFs.promises.writeFile(filePath, code, "utf-8");

  return {
    dirPath,
    filePath,
    mdPath,
    mode,
    code,
    specValid: true,
  };
}

export function buildSpecModel(params: {
  name: string;
  description: string;
  steps: string[];
  schedule?: SOPSchedule;
  triggers?: string[];
}): SOPSpecModel {
  const normalizedSteps =
    params.steps.length > 0
      ? params.steps
      : [
          "Read required runtime inputs from ctx.args and validate they are present.",
          "Open the target page or resource and capture the initial state.",
          "Execute the main workflow action and validate the result.",
          "Write a concise execution artifact for later review.",
        ];

  return {
    name: params.name,
    description: params.description,
    objective: params.description,
    prerequisites: [
      "The caller provides required runtime arguments in ctx.args.",
      "Browser control is available if the workflow touches web pages.",
      "The workflow may create artifact files inside the current workspace.",
    ],
    inputs: [
      "`ctx.args.url` or `ctx.args.targetUrl`: target page/resource to operate on.",
      "`ctx.args.artifactDir` (optional): output directory for execution artifacts.",
    ],
    outputs: [
      "A structured object describing the target, validations, and artifact paths.",
      "Execution artifacts written to the workspace when applicable.",
    ],
    steps: normalizedSteps,
    validation: [
      "Required runtime inputs must be present before any external action starts.",
      "Critical browser or file-system actions must be followed by verify.* checks.",
      "The workflow must abort when expected page state or outputs are missing.",
    ],
    recovery: [
      "When execution fails, inspect SOP.md plus the latest step and log history before changing sop.ts.",
      "Preserve the existing control flow and only change the minimum code required to satisfy the spec.",
      "After repair, validate the SOP loads successfully before retrying execution.",
    ],
    done: [
      "The workflow completes without throwing.",
      "The returned result is non-empty and describes what happened.",
      "Artifacts and validations are consistent with the spec.",
    ],
    schedule: params.schedule,
    triggers: params.triggers,
  };
}

export function buildSOPSpecMarkdown(spec: SOPSpecModel): string {
  const frontmatter = [
    "---",
    `name: ${spec.name}`,
    `description: ${spec.description}`,
    "---",
    "",
  ].join("\n");

  const blocks = [
    `# ${spec.name}`,
    "",
    spec.description,
    "",
    "## Objective",
    "",
    spec.objective,
    "",
    "## Prerequisites",
    "",
    ...spec.prerequisites.map((item) => `- ${item}`),
    "",
    "## Inputs",
    "",
    ...spec.inputs.map((item) => `- ${item}`),
    "",
    "## Outputs",
    "",
    ...spec.outputs.map((item) => `- ${item}`),
    "",
    "## Steps",
    "",
    ...spec.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Validation",
    "",
    ...spec.validation.map((item) => `- ${item}`),
    "",
    "## Recovery",
    "",
    ...spec.recovery.map((item) => `- ${item}`),
    "",
    "## Done",
    "",
    ...spec.done.map((item) => `- ${item}`),
  ];

  if (spec.schedule) {
    blocks.push("", "## Schedule", "", `- Weekly: \`${formatSOPSchedule(spec.schedule)}\``);
  }
  if (spec.triggers?.length) {
    blocks.push("", "## Triggers", "", ...spec.triggers.map((item) => `- \`${item}\``));
  }

  return `${frontmatter}${blocks.join("\n")}\n`;
}

export function buildExecutableTemplateCode(spec: SOPSpecModel): string {
  const scheduleField = spec.schedule
    ? `\n  schedule: ${JSON.stringify(spec.schedule, null, 2)
        .split("\n")
        .join("\n  ")},`
    : "";
  const triggersField = spec.triggers?.length
    ? `\n  triggers: ${JSON.stringify(spec.triggers)},`
    : "";
  const stepLogs = spec.steps
    .map((step, index) => `    ctx.log(${JSON.stringify(`Step ${index + 1}: ${step}`)});`)
    .join("\n");

  return `import path from "node:path";
import { defineSOP, browser, fs, verify } from "openclaw/sop";

export default defineSOP({
  name: ${JSON.stringify(spec.name)},
  description: ${JSON.stringify(spec.description)},${scheduleField}${triggersField}

  async run(ctx) {
    const targetUrl = String(ctx.args.url ?? ctx.args.targetUrl ?? "").trim();
    if (!targetUrl) {
      ctx.abort("Missing required input: ctx.args.url or ctx.args.targetUrl");
    }

    const artifactDir = String(ctx.args.artifactDir ?? "artifacts/sop");
    await fs.mkdir(artifactDir);

${stepLogs}
    const { targetId } = await browser.open(targetUrl);
    verify.notEmpty(targetId, "browser.open must return a targetId");

    await verify.urlContains(targetId, new URL(targetUrl).hostname);

    const { snapshot } = await browser.snapshot(targetId);
    verify.notEmpty(snapshot, "browser.snapshot must return a non-empty snapshot");

    const reportPath = path.join(artifactDir, "${spec.name}-report.txt");
    const report = [
      "SOP: ${spec.name}",
      "Target: " + targetUrl,
      "Snapshot length: " + String(snapshot.length),
    ].join("\\n");
    await fs.write(reportPath, report);
    await verify.fileExists(reportPath);

    return {
      targetUrl,
      targetId,
      reportPath,
      snapshotLength: snapshot.length,
    };
  },
});
`;
}

function buildGeneratePrompt(spec: SOPSpecModel, md: string): string {
  return `You are generating an executable OpenClaw SOP.

Write a complete TypeScript SOP implementation that satisfies the following SOP specification.
The output must be executable and use real SDK actions, not logging-only placeholders.

Requirements:
- Keep the import/export shape compatible with \`openclaw/sop\`.
- Read required inputs from \`ctx.args\`.
- Use real \`browser\`, \`fs\`, \`shell\`, or \`verify\` calls.
- Add \`ctx.log(...)\` for operator-readable progress, but do not use logs as a substitute for actions.
- Return a structured object with meaningful results.
- Abort clearly when required inputs are missing.
- Preserve the weekly \`schedule\` object if one is present.

SOP.md
\`\`\`md
${md}
\`\`\`

Return only a TypeScript code block.`;
}

function extractCodeFromResponse(response: string): string | undefined {
  const match = /```(?:typescript|ts)\n([\s\S]*?)```/i.exec(response);
  if (match?.[1]) {
    return match[1].trim();
  }

  const codeMatch = /<code>([\s\S]*?)<\/code>/i.exec(response);
  if (codeMatch?.[1]) {
    return codeMatch[1].trim();
  }

  if (response.includes("defineSOP") && response.includes("export default")) {
    return response.trim();
  }

  return undefined;
}
