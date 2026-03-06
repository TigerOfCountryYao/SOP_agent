import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveSOPDirs } from "./paths.js";

describe("resolveSOPDirs", () => {
  it("defaults SOP definitions to the agent workspace and runtime data to state dir", () => {
    const cfg = {
      agents: {
        list: [{ id: "main", default: true, workspace: "/tmp/main-workspace" }],
      },
    };

    vi.stubEnv("OPENCLAW_STATE_DIR", "/tmp/openclaw-state");
    try {
      const result = resolveSOPDirs({ config: cfg });
      expect(result.agentId).toBe("main");
      expect(result.workspaceDir).toBe(path.resolve("/tmp/main-workspace"));
      expect(result.sopsDir).toBe(path.join(path.resolve("/tmp/main-workspace"), "sops"));
      expect(result.dataDir).toBe(path.join(path.resolve("/tmp/openclaw-state"), "sop", "main"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resolves custom sopsDir relative to the workspace", () => {
    const cfg = {
      agents: {
        list: [{ id: "ops", workspace: "/tmp/ops-workspace" }],
      },
    };

    const result = resolveSOPDirs({
      config: cfg,
      agentId: "ops",
      sopsDir: ".openclaw/sops",
    });

    expect(result.sopsDir).toBe(path.join(path.resolve("/tmp/ops-workspace"), ".openclaw", "sops"));
  });
});
