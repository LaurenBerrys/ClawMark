import { describe, expect, it } from "vitest";

import {
  buildTaskStatusCounts,
  compareTaskQueueOrder,
  getTaskStatusAliases,
  isRunnableTaskStatus,
  isTerminalTaskStatus,
  normalizeOptionalTaskStatus,
  normalizeTaskStatus,
  shouldTaskRun,
} from "./task-loop.js";

describe("normalizeTaskStatus", () => {
  it("maps legacy statuses into canonical runtime statuses", () => {
    expect(normalizeTaskStatus("waiting_human")).toBe("waiting_user");
    expect(normalizeTaskStatus("done")).toBe("completed");
    expect(normalizeTaskStatus("ready")).toBe("ready");
  });

  it("falls back for unknown values and keeps optional parsing strict", () => {
    expect(normalizeTaskStatus("unknown", "planning")).toBe("planning");
    expect(normalizeOptionalTaskStatus("unknown")).toBeNull();
    expect(normalizeOptionalTaskStatus(" completed ")).toBe("completed");
  });
});

describe("getTaskStatusAliases", () => {
  it("returns legacy-compatible aliases for waiting_user and completed", () => {
    expect(getTaskStatusAliases("waiting_user")).toEqual(["waiting_user", "waiting_human"]);
    expect(getTaskStatusAliases("completed")).toEqual(["completed", "done"]);
  });
});

describe("task runnability", () => {
  it("treats waiting_user, completed, and cancelled as non-runnable", () => {
    expect(isRunnableTaskStatus("queued")).toBe(true);
    expect(isRunnableTaskStatus("waiting_user")).toBe(false);
    expect(isRunnableTaskStatus("completed")).toBe(false);
    expect(isRunnableTaskStatus("cancelled")).toBe(false);
    expect(isTerminalTaskStatus("completed")).toBe(true);
    expect(isTerminalTaskStatus("cancelled")).toBe(true);
  });

  it("uses canonical due semantics for scheduled and unscheduled tasks", () => {
    expect(shouldTaskRun({ status: "ready" }, 1000)).toBe(true);
    expect(shouldTaskRun({ status: "waiting_external", nextRunAt: 999 }, 1000)).toBe(true);
    expect(shouldTaskRun({ status: "waiting_external", nextRunAt: 1001 }, 1000)).toBe(false);
    expect(shouldTaskRun({ status: "waiting_user" }, 1000)).toBe(false);
    expect(shouldTaskRun({ status: "completed" }, 1000)).toBe(false);
  });
});

describe("compareTaskQueueOrder", () => {
  it("orders by priority, then status rank, then timestamps", () => {
    const tasks = [
      {
        id: "running-normal",
        priority: "normal",
        status: "running",
        nextRunAt: 100,
        updatedAt: 15,
      },
      {
        id: "queued-high",
        priority: "high",
        status: "queued",
        nextRunAt: 200,
        updatedAt: 20,
      },
      {
        id: "blocked-normal",
        priority: "normal",
        status: "blocked",
        nextRunAt: 150,
        updatedAt: 10,
      },
      {
        id: "queued-normal-older",
        priority: "normal",
        status: "queued",
        nextRunAt: 120,
        updatedAt: 5,
      },
    ];

    const ordered = tasks.toSorted(compareTaskQueueOrder).map((task) => task.id);
    expect(ordered).toEqual([
      "queued-high",
      "blocked-normal",
      "queued-normal-older",
      "running-normal",
    ]);
  });
});

describe("buildTaskStatusCounts", () => {
  it("summarizes canonical counts and due tasks with legacy compatibility", () => {
    const counts = buildTaskStatusCounts(
      [
        { status: "queued" },
        { status: "planning" },
        { status: "ready" },
        { status: "waiting_human" },
        { status: "done" },
        { status: "waiting_external", nextRunAt: 50 },
        { status: "waiting_external", nextRunAt: 500 },
        { status: "blocked" },
      ],
      100,
    );

    expect(counts).toEqual({
      total: 8,
      queued: 1,
      planning: 1,
      ready: 1,
      running: 0,
      waitingExternal: 2,
      waitingUser: 1,
      blocked: 1,
      completed: 1,
      cancelled: 0,
      due: 5,
    });
  });
});
