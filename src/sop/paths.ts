import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";

export type ResolveSOPDirsOptions = {
  config: OpenClawConfig;
  agentId?: string;
  workspaceDir?: string;
  sopsDir?: string;
  dataDir?: string;
};

export type ResolvedSOPDirs = {
  agentId: string;
  workspaceDir: string;
  sopsDir: string;
  dataDir: string;
};

export function resolveSOPDirs(opts: ResolveSOPDirsOptions): ResolvedSOPDirs {
  const agentId = opts.agentId?.trim() || resolveDefaultAgentId(opts.config);
  const workspaceDir =
    opts.workspaceDir?.trim() || resolveAgentWorkspaceDir(opts.config, agentId);
  const sopsDir = opts.sopsDir?.trim()
    ? path.resolve(workspaceDir, opts.sopsDir)
    : path.join(workspaceDir, "sops");
  const dataDir = opts.dataDir?.trim()
    ? path.resolve(opts.dataDir)
    : path.join(resolveStateDir(process.env), "sop", agentId);

  return {
    agentId,
    workspaceDir,
    sopsDir,
    dataDir,
  };
}
