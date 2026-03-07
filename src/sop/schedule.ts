import type { SOPSchedule, SOPWeekday } from "./types.js";

const WEEKDAYS: SOPWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const WEEKDAY_LABELS: Record<SOPWeekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export function isValidSOPSchedule(schedule: SOPSchedule | undefined): boolean {
  if (!schedule) {
    return true;
  }
  if (schedule.kind !== "weekly") {
    return false;
  }
  if (!Array.isArray(schedule.days) || schedule.days.length === 0) {
    return false;
  }
  if (!schedule.days.every((day) => WEEKDAYS.includes(day))) {
    return false;
  }
  return /^\d{2}:\d{2}$/.test(schedule.time) && parseTime(schedule.time) !== null;
}

export function formatSOPSchedule(schedule: SOPSchedule): string {
  const labels = schedule.days
    .map((day) => WEEKDAY_LABELS[day])
    .join(", ");
  return `${labels} ${schedule.time}`;
}

export function computeNextWeeklyRun(
  schedule: SOPSchedule,
  nowMs: number,
): number | undefined {
  const time = parseTime(schedule.time);
  if (!time || schedule.days.length === 0) {
    return undefined;
  }

  const allowedDays = new Set(schedule.days.map(toJsDay));
  const now = new Date(nowMs);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(nowMs);
    candidate.setSeconds(0, 0);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(time.hours, time.minutes, 0, 0);
    if (!allowedDays.has(candidate.getDay())) {
      continue;
    }
    if (candidate.getTime() > nowMs) {
      return candidate.getTime();
    }
  }

  return undefined;
}

function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

function toJsDay(day: SOPWeekday): number {
  return WEEKDAYS.indexOf(day);
}
