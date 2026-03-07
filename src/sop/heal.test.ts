import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { healSOP } from "./heal.js";
import { runSOP } from "./runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("healSOP", () => {
  it("uses SOP.md context to repair a failed SOP and retries with repair metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-heal-"));
    tempDirs.push(dir);
    const sopDir = path.join(dir, "demo");
    const sopFilePath = path.join(sopDir, "sop.ts");
    const sopMdPath = path.join(sopDir, "SOP.md");
    const configDir = path.join(dir, "state");

    await fs.mkdir(sopDir, { recursive: true });
    await fs.writeFile(
      sopFilePath,
      [
        'import { defineSOP } from "openclaw/sop";',
        "",
        "export default defineSOP({",
        '  name: "demo",',
        '  description: "demo",',
        "  async run() {",
        '    throw new Error("broken");',
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      sopMdPath,
      [
        "---",
        "name: demo",
        "description: demo",
        "---",
        "",
        "# demo",
        "",
        "## Objective",
        "",
        "Repair the SOP.",
        "",
        "## Steps",
        "",
        "1. Return a success object.",
        "",
        "## Validation",
        "",
        "- The run completes without throwing.",
        "",
        "## Recovery",
        "",
        "- Keep the exported shape intact.",
        "",
        "## Done",
        "",
        "- Returns a structured object.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const failedRecord = await runSOP({
      filePath: sopFilePath,
      sopName: "demo",
      configDir,
    });

    let prompt = "";
    const result = await healSOP({
      failedRecord,
      sopFilePath,
      sopMdPath,
      configDir,
      sopsDir: dir,
      llmCall: async (input) => {
        prompt = input;
        return [
          "<analysis>Use SOP.md to return a structured result.</analysis>",
          "<code>",
          'import { defineSOP } from "openclaw/sop";',
          "",
          "export default defineSOP({",
          '  name: "demo",',
          '  description: "demo",',
          "  async run(ctx) {",
          '    ctx.log("repaired");',
          '    return { ok: true, source: "repaired" };',
          "  },",
          "});",
          "</code>",
        ].join("\n");
      },
    });

    expect(prompt).toContain("SOP.md");
    expect(prompt).toContain("## Objective");
    expect(result.success).toBe(true);
    expect(result.retryRecord?.status).toBe("ok");
    expect(result.retryRecord?.repair?.healStrategy).toBe("llm-fix");
    expect(result.retryRecord?.repair?.healedFromRunId).toBe(failedRecord.runId);
  });
});
