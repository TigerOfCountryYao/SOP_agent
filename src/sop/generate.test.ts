import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSOP } from "./generate.js";
import { loadSOP } from "./runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("generateSOP", () => {
  it("creates a spec markdown and executable SOP template", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-generate-"));
    tempDirs.push(dir);

    const result = await generateSOP({
      name: "demo-sop",
      description: "Demo workflow",
      sopsDir: dir,
      steps: ["Open the target page", "Capture a snapshot"],
      schedule: {
        kind: "weekly",
        days: ["monday", "wednesday"],
        time: "09:30",
      },
    });

    const md = await fs.readFile(result.mdPath, "utf-8");
    const code = await fs.readFile(result.filePath, "utf-8");
    const loaded = await loadSOP(result.filePath);

    expect(result.specValid).toBe(true);
    expect(md).toContain("## Objective");
    expect(md).toContain("## Steps");
    expect(md).toContain("## Validation");
    expect(md).toContain("## Recovery");
    expect(md).toContain("Weekly: `Mon, Wed 09:30`");
    expect(code).toContain("await browser.open");
    expect(code).toContain("await verify.urlContains");
    expect(code).toContain("await fs.write");
    expect(code).toContain('"kind": "weekly"');
    expect(loaded.name).toBe("demo-sop");
    expect(loaded.schedule).toEqual({
      kind: "weekly",
      days: ["monday", "wednesday"],
      time: "09:30",
    });
  });
});
