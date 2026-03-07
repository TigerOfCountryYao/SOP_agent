import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSOPFromSourceRun, validateGeneratedSOP } from "./catalog.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("SOP catalog lifecycle", () => {
  it("creates and publishes a SOP from a successful source run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-catalog-"));
    tempDirs.push(dir);
    const sopsDir = path.join(dir, "sops");
    const dataDir = path.join(dir, "state");

    const result = await createSOPFromSourceRun({
      name: "captured-demo",
      sopsDir,
      dataDir,
      sourceRun: {
        sessionKey: "agent:main:main",
        userRequest: "Open the target page and capture a validation snapshot.",
        replayArgs: {
          targetUrl: "https://example.com",
        },
        steps: [
          {
            toolName: "browser",
            action: "open",
            summary: 'browser (open) - targetUrl="https://example.com"',
            arguments: {
              action: "open",
              targetUrl: "https://example.com",
            },
          },
        ],
      },
      llmCall: async () =>
        [
          "```ts",
          'import path from "node:path";',
          'import { defineSOP, fs, verify } from "openclaw/sop";',
          "",
          "export default defineSOP({",
          '  name: "captured-demo",',
          '  description: "captured demo",',
          "  async run() {",
          '    const artifactDir = "artifacts/sop";',
          "    await fs.mkdir(artifactDir);",
          '    const reportPath = path.join(artifactDir, "captured-demo.txt");',
          '    await fs.write(reportPath, "ok");',
          "    await verify.fileExists(reportPath);",
          "    return { reportPath };",
          "  },",
          "});",
          "```",
        ].join("\n"),
    });

    expect(result.meta.status).toBe("validated");
    expect(result.meta.validation.staticOk).toBe(true);
    expect(result.meta.validation.dynamicOk).toBe(true);
    expect(await fs.readFile(result.mdPath, "utf-8")).toContain("## Objective");
    expect(await fs.readFile(result.filePath, "utf-8")).toContain('name: "captured-demo"');
  });

  it.skip("repairs a broken generated SOP during validation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-catalog-"));
    tempDirs.push(dir);
    const sopsDir = path.join(dir, "sops");
    const dataDir = path.join(dir, "state");

    const created = await createSOPFromSourceRun({
      name: "repair-demo",
      sopsDir,
      dataDir,
      sourceRun: {
        sessionKey: "agent:main:main",
        runId: "run-123",
        userRequest: "Open the target page and capture a validation snapshot.",
        replayArgs: {
          targetUrl: "https://example.com",
        },
        steps: [
          {
            toolName: "browser",
            action: "open",
            summary: 'browser (open) - targetUrl="https://example.com"',
            arguments: {
              action: "open",
              targetUrl: "https://example.com",
            },
          },
        ],
      },
      llmCall: async () =>
        [
          "```ts",
          'import path from "node:path";',
          'import { defineSOP, fs, verify } from "openclaw/sop";',
          "",
          "export default defineSOP({",
          '  name: "repair-demo",',
          '  description: "repair demo",',
          "  async run() {",
          '    const artifactDir = "artifacts/sop";',
          "    await fs.mkdir(artifactDir);",
          '    const reportPath = path.join(artifactDir, "repair-demo.txt");',
          '    await fs.write(reportPath, "ok");',
          "    await verify.fileExists(reportPath);",
          "    return { reportPath };",
          "  },",
          "});",
          "```",
        ].join("\n"),
    });

    await fs.writeFile(
      created.filePath,
      [
        'import { defineSOP } from "openclaw/sop";',
        "",
        "export default defineSOP({",
        '  name: "repair-demo",',
        '  description: "broken",',
        "  async run() {",
        '    throw new Error("broken");',
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );

    const validated = await validateGeneratedSOP({
      name: "repair-demo",
      filePath: created.filePath,
      mdPath: created.mdPath,
      dataDir,
      sourceRun: created.meta.sourceRun,
      llmCall: async () =>
        [
          "<analysis>Restore the captured browser replay.</analysis>",
          "<code>",
          'import path from "node:path";',
          'import { defineSOP, fs, verify } from "openclaw/sop";',
          "",
          "export default defineSOP({",
          '  name: "repair-demo",',
          '  description: "repair demo",',
          "  async run() {",
          '    const artifactDir = "artifacts/sop";',
          "    await fs.mkdir(artifactDir);",
          "    const reportPath = path.join(artifactDir, \"repair-demo.txt\");",
          '    await fs.write(reportPath, "ok");',
          "    await verify.fileExists(reportPath);",
          "    return { reportPath };",
          "  },",
          "});",
          "</code>",
        ].join("\n"),
    });

    expect(validated.status).toBe("validated");
    expect(validated.repair?.status).toBe("validated");
  });
});
