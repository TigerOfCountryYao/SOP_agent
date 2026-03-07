import { loadSessionEntry, readSessionMessages } from "../gateway/session-utils.js";
import type { SOPSourceRun, SOPSourceStep } from "./types.js";

type TranscriptMessage = {
  role?: string;
  content?: Array<Record<string, unknown>>;
  stopReason?: string;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
};

type TranscriptTurn = {
  userMessage: TranscriptMessage;
  messages: TranscriptMessage[];
};

export async function captureSuccessfulRunFromSession(params: {
  sessionKey: string;
  runId?: string;
}): Promise<SOPSourceRun> {
  const { sessionKey, runId } = params;
  const { storePath, entry } = loadSessionEntry(sessionKey);
  const sessionId = entry?.sessionId;
  if (!storePath || !sessionId) {
    throw new Error(`Session not found: ${sessionKey}`);
  }

  const transcript = readSessionMessages(sessionId, storePath, entry?.sessionFile) as TranscriptMessage[];
  const turns = splitTranscriptIntoTurns(transcript);
  const turn = [...turns].reverse().find(isSuccessfulTurn);
  if (!turn) {
    throw new Error(`No successful task found in session ${sessionKey}`);
  }

  const userRequest = extractText(turn.userMessage).trim();
  const steps = extractSourceSteps(turn.messages);
  if (steps.length === 0) {
    throw new Error(`Session ${sessionKey} has no tool execution trace to capture as a SOP`);
  }

  return {
    sessionKey,
    runId,
    userRequest,
    finalResponse: extractFinalAssistantText(turn.messages),
    replayArgs: buildReplayArgs(steps),
    steps,
  };
}

function splitTranscriptIntoTurns(messages: TranscriptMessage[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let current: TranscriptTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      if (current) {
        turns.push(current);
      }
      current = {
        userMessage: message,
        messages: [],
      };
      continue;
    }

    if (current) {
      current.messages.push(message);
    }
  }

  if (current) {
    turns.push(current);
  }

  return turns;
}

function isSuccessfulTurn(turn: TranscriptTurn): boolean {
  const assistantMessages = turn.messages.filter((message) => message.role === "assistant");
  if (assistantMessages.length === 0) {
    return false;
  }

  const finalAssistant = [...assistantMessages].reverse().find((message) => {
    return extractText(message).trim() || collectToolCalls([message]).length > 0;
  });
  if (!finalAssistant) {
    return false;
  }

  return finalAssistant.stopReason !== "error" && !finalAssistant.errorMessage;
}

function extractSourceSteps(messages: TranscriptMessage[]): SOPSourceStep[] {
  const toolCalls = collectToolCalls(messages);
  const toolResults = new Map(
    messages
      .filter((message) => message.role === "toolResult" && typeof message.toolCallId === "string")
      .map((message) => [message.toolCallId as string, message]),
  );

  return toolCalls.map((call) => {
    const action =
      typeof call.arguments.action === "string" ? String(call.arguments.action).trim() : undefined;
    const resultMessage = toolResults.get(call.id);
    return {
      toolName: call.name,
      action,
      summary: summarizeToolCall(call.name, action, call.arguments),
      arguments: call.arguments,
      result: resultMessage?.details,
    };
  });
}

function collectToolCalls(messages: TranscriptMessage[]) {
  const calls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }> = [];

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (part?.type !== "toolCall" || typeof part.id !== "string" || typeof part.name !== "string") {
        continue;
      }
      calls.push({
        id: part.id,
        name: part.name,
        arguments: isRecord(part.arguments) ? part.arguments : {},
      });
    }
  }

  return calls;
}

function buildReplayArgs(steps: SOPSourceStep[]): Record<string, unknown> | undefined {
  const replayArgs: Record<string, unknown> = {};

  for (const step of steps) {
    const args = step.arguments ?? {};
    if (step.toolName === "browser") {
      if (typeof args.targetUrl === "string" && !replayArgs.targetUrl) {
        replayArgs.targetUrl = args.targetUrl;
      }
      if (typeof args.url === "string" && !replayArgs.url) {
        replayArgs.url = args.url;
      }
    }
    if (step.toolName === "shell" && typeof args.command === "string" && !replayArgs.command) {
      replayArgs.command = args.command;
    }
  }

  return Object.keys(replayArgs).length > 0 ? replayArgs : undefined;
}

function summarizeToolCall(
  toolName: string,
  action: string | undefined,
  args: Record<string, unknown>,
): string {
  const extras = Object.entries(args)
    .filter(([key]) => key !== "action")
    .slice(0, 3)
    .map(([key, value]) => `${key}=${summarizeValue(value)}`);
  return [toolName, action ? `(${action})` : "", extras.length > 0 ? `- ${extras.join(", ")}` : ""]
    .filter(Boolean)
    .join(" ");
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (isRecord(value)) {
    return "{...}";
  }
  return JSON.stringify(value);
}

function extractFinalAssistantText(messages: TranscriptMessage[]): string | undefined {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const text = extractText(assistantMessages[index]).trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function extractText(message: TranscriptMessage): string {
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
