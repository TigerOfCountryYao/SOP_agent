import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSOP } from "./runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("loadSOP", () => {
  it("loads workspace SOP files that import the SDK via openclaw/sop", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "sop.ts");
    await fs.writeFile(
      filePath,
      [
        'import { defineSOP } from "openclaw/sop";',
        "",
        "export default defineSOP({",
        '  name: "demo",',
        '  description: "demo",',
        "  async run() {",
        "    return { ok: true };",
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );

    const loaded = await loadSOP(filePath);

    expect(loaded.name).toBe("demo");
    await expect(loaded.run({} as never)).resolves.toEqual({ ok: true });
  });
});
