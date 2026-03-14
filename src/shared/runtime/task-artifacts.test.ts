import { describe, expect, it } from "vitest";
import {
  buildShareableReviewEnvelope,
  buildTaskLifecycleArtifacts,
  buildTaskRecordSnapshot,
  buildTaskReviewOutcome,
  buildTaskReviewRecord,
  buildTaskRunSnapshot,
  buildTaskStepSnapshot,
  buildTaskTransitionStep,
} from "./task-artifacts.js";

describe("buildTaskRecordSnapshot", () => {
  it("normalizes legacy task status and deduplicates refs", () => {
    const record = buildTaskRecordSnapshot({
      id: "task-1",
      title: "Sync runtime changes",
      route: "coder",
      status: "done",
      priority: "high",
      budgetMode: "deep",
      retrievalMode: "deep",
      worker: "main",
      skillIds: ["patch.apply", "patch.apply", "repo.read"],
      memoryRefs: ["mem-1", "mem-1", "mem-2"],
      artifactRefs: ["artifact-1", "artifact-1"],
      recurring: true,
      maintenance: false,
      createdAt: 10,
      updatedAt: 20,
    });

    expect(record.status).toBe("completed");
    expect(record.skillIds).toEqual(["patch.apply", "repo.read"]);
    expect(record.memoryRefs).toEqual(["mem-1", "mem-2"]);
    expect(record.artifactRefs).toEqual(["artifact-1"]);
    expect(record.recurring).toBe(true);
    expect(record.maintenance).toBe(false);
  });
});

describe("buildTaskRunSnapshot", () => {
  it("fills completion fields for completed runs", () => {
    const run = buildTaskRunSnapshot({
      taskId: "task-1",
      status: "completed",
      thinkingLane: "system2",
      startedAt: 100,
      updatedAt: 120,
      concurrencyKey: "coder:main",
    });

    expect(run.status).toBe("completed");
    expect(run.thinkingLane).toBe("system2");
    expect(run.completedAt).toBe(120);
    expect(run.concurrencyKey).toBe("coder:main");
    expect(run.id).toMatch(/^run_/);
  });
});

describe("buildTaskStepSnapshot", () => {
  it("builds a manual task step with normalized fields", () => {
    const step = buildTaskStepSnapshot({
      taskId: "task-1",
      runId: "run-1",
      kind: "executor",
      status: "completed",
      idempotencyKey: "task-1:run-1:executor",
      worker: "main",
      route: "coder",
      skillId: "patch.apply",
      startedAt: 100,
      completedAt: 120,
    });

    expect(step.kind).toBe("executor");
    expect(step.status).toBe("completed");
    expect(step.idempotencyKey).toBe("task-1:run-1:executor");
  });
});

describe("buildTaskTransitionStep", () => {
  it("maps waiting_user to a queued notify step", () => {
    const step = buildTaskTransitionStep({
      taskId: "task-1",
      runId: "run-1",
      status: "waiting_human",
      idempotencyKey: "task-1:waiting-user",
      occurredAt: 222,
    });

    expect(step.kind).toBe("notify");
    expect(step.status).toBe("queued");
    expect(step.startedAt).toBeUndefined();
    expect(step.completedAt).toBeUndefined();
  });

  it("maps blocked to a failed recovery step", () => {
    const step = buildTaskTransitionStep({
      taskId: "task-1",
      runId: "run-1",
      status: "blocked",
      idempotencyKey: "task-1:blocked",
      occurredAt: 333,
      error: "worker blocked",
    });

    expect(step.kind).toBe("recovery");
    expect(step.status).toBe("failed");
    expect(step.startedAt).toBe(333);
    expect(step.completedAt).toBe(333);
    expect(step.error).toBe("worker blocked");
  });
});

describe("buildTaskReviewOutcome", () => {
  it("maps canonical and legacy task statuses into review outcomes", () => {
    expect(buildTaskReviewOutcome("completed")).toBe("success");
    expect(buildTaskReviewOutcome("done")).toBe("success");
    expect(buildTaskReviewOutcome("waiting_user")).toBe("blocked");
    expect(buildTaskReviewOutcome("cancelled")).toBe("cancelled");
    expect(buildTaskReviewOutcome("waiting_external")).toBe("partial");
  });
});

describe("buildTaskReviewRecord", () => {
  it("builds a review with extracted memories and strategy candidates", () => {
    const review = buildTaskReviewRecord({
      taskId: "task-1",
      runId: "run-1",
      status: "completed",
      summary: "Patched runtime wiring and verified build.",
      extractedMemoryIds: ["mem-1", "mem-1", "mem-2"],
      strategyCandidateIds: ["strategy-1", "strategy-1"],
      createdAt: 444,
    });

    expect(review.outcome).toBe("success");
    expect(review.extractedMemoryIds).toEqual(["mem-1", "mem-2"]);
    expect(review.strategyCandidateIds).toEqual(["strategy-1"]);
    expect(review.id).toMatch(/^review_/);
  });
});

describe("buildShareableReviewEnvelope", () => {
  it("wraps a review into a shareable derived envelope", () => {
    const review = buildTaskReviewRecord({
      taskId: "task-1",
      runId: "run-1",
      status: "blocked",
      summary: "Worker stalled on invalid memory refs.",
      createdAt: 555,
    });
    const envelope = buildShareableReviewEnvelope(review, {
      generatedAt: 666,
      metadata: { export: "local" },
    });

    expect(envelope.shareScope).toBe("shareable_derived");
    expect(envelope.generatedAt).toBe(666);
    expect(envelope.taskReview.id).toBe(review.id);
    expect(envelope.metadata).toEqual({ export: "local" });
  });
});

describe("buildTaskLifecycleArtifacts", () => {
  it("composes task, run, step, review and shareable review together", () => {
    const artifacts = buildTaskLifecycleArtifacts({
      now: 1000,
      task: {
        id: "task-1",
        title: "Promote runtime review artifacts",
        route: "coder",
        status: "completed",
        priority: "high",
        budgetMode: "balanced",
        retrievalMode: "light",
        worker: "main",
        skillIds: ["repo.read", "patch.apply"],
        memoryRefs: ["mem-1"],
        artifactRefs: ["artifact-1"],
        createdAt: 900,
        updatedAt: 1000,
      },
      run: {
        status: "completed",
        thinkingLane: "system2",
        startedAt: 950,
        updatedAt: 1000,
      },
      step: {
        kind: "review",
        status: "completed",
        idempotencyKey: "task-1:review:1000",
        completedAt: 1000,
      },
      review: {
        summary: "Runtime task artifacts emitted to event log.",
        extractedMemoryIds: ["mem-1"],
        strategyCandidateIds: ["strategy-1"],
      },
      shareableReview: {
        generatedAt: 1001,
      },
    });

    expect(artifacts.taskRecord.activeRunId).toBe(artifacts.taskRun.id);
    expect(artifacts.taskRecord.latestReviewId).toBe(artifacts.taskReview?.id);
    expect(artifacts.taskStep?.kind).toBe("review");
    expect(artifacts.taskReview?.outcome).toBe("success");
    expect(artifacts.shareableReview?.generatedAt).toBe(1001);
  });
});
