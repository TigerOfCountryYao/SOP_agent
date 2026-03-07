import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSOP } from "./runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("runSOP", () => {
  it("stores ctx.log output separately from SDK step records", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-run-"));
    tempDirs.push(dir);
    const sopDir = path.join(dir, "log-only");
    await fs.mkdir(sopDir, { recursive: true });
    await fs.writeFile(
      path.join(sopDir, "sop.ts"),
      [
        'import { defineSOP } from "openclaw/sop";',
        "",
        "export default defineSOP({",
        '  name: "log-only",',
        '  description: "log only",',
        "  async run(ctx) {",
        '    ctx.log("first");',
        '    ctx.log("second");',
        "    return { ok: true };",
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );

    const record = await runSOP({
      filePath: path.join(sopDir, "sop.ts"),
      sopName: "log-only",
      configDir: path.join(dir, "state"),
    });

    expect(record.status).toBe("ok");
    expect(record.steps).toHaveLength(0);
    expect(record.logs).toHaveLength(2);
    expect(record.logs?.[0]).toContain("first");
  });
});
