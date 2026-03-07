import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSOP } from "./runner.js";
import { updateSOPSchedule } from "./update.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("updateSOPSchedule", () => {
  it("inserts a weekly schedule into an existing SOP", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-update-"));
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

    await updateSOPSchedule(filePath, {
      kind: "weekly",
      days: ["tuesday", "thursday"],
      time: "18:45",
    });

    const loaded = await loadSOP(filePath);
    expect(loaded.schedule).toEqual({
      kind: "weekly",
      days: ["tuesday", "thursday"],
      time: "18:45",
    });
  });

  it("removes an existing schedule", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sop-update-"));
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
        "  schedule: {",
        '    kind: "weekly",',
        '    days: ["monday"],',
        '    time: "09:00",',
        "  },",
        "  async run() {",
        "    return { ok: true };",
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );

    await updateSOPSchedule(filePath, undefined);

    const loaded = await loadSOP(filePath);
    expect(loaded.schedule).toBeUndefined();
  });
});
