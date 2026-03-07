import nodeFs from "node:fs/promises";
import type { SOPSchedule } from "./types.js";

export async function updateSOPSchedule(
  filePath: string,
  schedule?: SOPSchedule,
): Promise<void> {
  const source = await nodeFs.readFile(filePath, "utf-8");
  const range = findDefineSOPObjectRange(source);
  if (!range) {
    throw new Error(`Invalid SOP source: ${filePath}`);
  }

  const objectText = source.slice(range.start, range.end + 1);
  const nextObjectText = patchScheduleProperty(objectText, schedule);
  if (nextObjectText === objectText) {
    return;
  }

  const nextSource = `${source.slice(0, range.start)}${nextObjectText}${source.slice(range.end + 1)}`;
  await nodeFs.writeFile(filePath, nextSource, "utf-8");
}

function patchScheduleProperty(objectText: string, schedule?: SOPSchedule): string {
  const runMatch = /\n([ \t]*)(async\s+run\s*\(|run\s*:)/.exec(objectText);
  const indent = runMatch?.[1] ?? "  ";
  const existingPattern = /\n([ \t]*)schedule\s*:\s*\{[\s\S]*?\n\1\},?/m;
  const scheduleBlock = schedule ? renderScheduleBlock(indent, schedule) : "";

  if (existingPattern.test(objectText)) {
    if (!schedule) {
      return objectText.replace(existingPattern, "\n");
    }
    return objectText.replace(existingPattern, scheduleBlock);
  }

  if (!schedule) {
    return objectText;
  }

  if (runMatch?.index != null) {
    return `${objectText.slice(0, runMatch.index)}${scheduleBlock}${objectText.slice(runMatch.index)}`;
  }

  const closingIndex = objectText.lastIndexOf("\n}");
  if (closingIndex >= 0) {
    return `${objectText.slice(0, closingIndex)}${scheduleBlock}\n${objectText.slice(closingIndex + 1)}`;
  }

  throw new Error("Unable to insert schedule into SOP source");
}

function renderScheduleBlock(indent: string, schedule: SOPSchedule): string {
  const days = schedule.days.map((day) => `"${day}"`).join(", ");
  return [
    "",
    `${indent}schedule: {`,
    `${indent}  kind: "weekly",`,
    `${indent}  days: [${days}],`,
    `${indent}  time: "${schedule.time}",`,
    `${indent}},`,
  ].join("\n");
}

function findDefineSOPObjectRange(source: string): { start: number; end: number } | null {
  const marker = "defineSOP({";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const start = markerIndex + "defineSOP(".length;
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }

    if (char === "{") {
      depth++;
      continue;
    }

    if (char === "}") {
      depth--;
      if (depth === 0) {
        return { start, end: i };
      }
    }
  }

  return null;
}
