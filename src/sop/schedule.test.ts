import { describe, expect, it } from "vitest";
import {
  computeNextWeeklyRun,
  formatSOPSchedule,
  isValidSOPSchedule,
} from "./schedule.js";

describe("sop schedule helpers", () => {
  it("validates weekly schedules", () => {
    expect(
      isValidSOPSchedule({
        kind: "weekly",
        days: ["monday", "friday"],
        time: "09:15",
      }),
    ).toBe(true);

    expect(
      isValidSOPSchedule({
        kind: "weekly",
        days: [],
        time: "09:15",
      }),
    ).toBe(false);

    expect(
      isValidSOPSchedule({
        kind: "weekly",
        days: ["monday"],
        time: "24:00",
      }),
    ).toBe(false);
  });

  it("formats schedule labels for display", () => {
    expect(
      formatSOPSchedule({
        kind: "weekly",
        days: ["monday", "wednesday", "friday"],
        time: "08:00",
      }),
    ).toBe("Mon, Wed, Fri 08:00");
  });

  it("computes the next weekly run in the future", () => {
    const mondayMorningLocal = new Date(2026, 2, 2, 8, 0, 0).getTime();
    const next = computeNextWeeklyRun(
      {
        kind: "weekly",
        days: ["monday", "wednesday"],
        time: "09:30",
      },
      mondayMorningLocal,
    );

    expect(next).toBe(new Date(2026, 2, 2, 9, 30, 0).getTime());
  });

  it("rolls over to the next matching day once today's time passed", () => {
    const mondayLateLocal = new Date(2026, 2, 2, 10, 0, 0).getTime();
    const next = computeNextWeeklyRun(
      {
        kind: "weekly",
        days: ["monday", "wednesday"],
        time: "09:30",
      },
      mondayLateLocal,
    );

    expect(next).toBe(new Date(2026, 2, 4, 9, 30, 0).getTime());
  });
});
