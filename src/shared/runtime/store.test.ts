import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SurfaceLocalBusinessPolicy } from "./contracts.js";
import {
  buildRuntimeRetrievalSourceSet,
  loadRuntimeFederationStore,
  loadRuntimeGovernanceStore,
  loadRuntimeTaskStore,
  loadRuntimeUserConsoleStore,
  resolveRuntimeStorePaths,
  saveRuntimeFederationStore,
  saveRuntimeGovernanceStore,
  saveRuntimeTaskStore,
  saveRuntimeUserConsoleStore,
} from "./store.js";
import { updateRuntimeUserModel } from "./user-console.js";
import { syncRuntimeUserModelMirror } from "./user-model-mirror.js";

async function withTempRoot(
  prefix: string,
  run: (root: string, env: NodeJS.ProcessEnv) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const env = {
    OPENCLAW_INSTANCE_ROOT: path.join(root, "instance"),
    OPENCLAW_DATA_ROOT: path.join(root, "instance", "data"),
    OPENCLAW_RUNTIME_ROOT: path.join(root, "instance", "runtime"),
    OPENCLAW_STATE_ROOT: path.join(root, "instance", "state"),
    OPENCLAW_CONFIG_ROOT: path.join(root, "instance", "config"),
    OPENCLAW_EXTENSIONS_ROOT: path.join(root, "instance", "extensions"),
    OPENCLAW_ARCHIVE_ROOT: path.join(root, "instance", "archive"),
    OPENCLAW_WORKSPACE_ROOT: path.join(root, "instance", "workspace"),
  } as NodeJS.ProcessEnv;
  try {
    await run(root, env);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("runtime store metadata normalization", () => {
  it("upgrades imported legacy task metadata into canonical runtime keys on load", async () => {
    await withTempRoot("openclaw-runtime-store-", async (_root, env) => {
      const paths = resolveRuntimeStorePaths({ env, now: 1_700_000_000_000 });
      await fs.mkdir(path.dirname(paths.taskStorePath), { recursive: true });
      await fs.writeFile(
        paths.taskStorePath,
        JSON.stringify(
          {
            version: "v1",
            defaults: {
              defaultBudgetMode: "balanced",
              defaultRetrievalMode: "light",
              maxInputTokensPerTurn: 6000,
              maxContextChars: 9000,
              maxRemoteCallsPerTask: 6,
            },
            tasks: [
              {
                id: "task-1",
                title: "Imported task",
                route: "general",
                status: "queued",
                priority: "normal",
                budgetMode: "balanced",
                retrievalMode: "light",
                skillIds: [],
                memoryRefs: [],
                artifactRefs: [],
                recurring: false,
                maintenance: false,
                createdAt: 1_700_000_000_000,
                updatedAt: 1_700_000_000_100,
                metadata: {
                  legacyCompatibility: {
                    workspace: "/tmp/workspace",
                    notes: "migrated context",
                  },
                  legacyRunState: {
                    lastThinkingLane: "system2",
                    remoteCallCount: 3,
                  },
                },
              },
            ],
            runs: [],
            steps: [],
            reviews: [],
            reports: [],
          },
          null,
          2,
        ),
        "utf8",
      );

      const store = loadRuntimeTaskStore({ env, now: 1_700_000_000_100 });
      const task = store.tasks[0];

      expect(task?.metadata?.taskContext).toEqual({
        workspace: "/tmp/workspace",
        notes: "migrated context",
      });
      expect(task?.metadata?.runtimeTask).toEqual({
        runState: {
          lastThinkingLane: "system2",
          remoteCallCount: 3,
        },
      });
      expect("legacyCompatibility" in (task?.metadata ?? {})).toBe(false);
      expect("legacyRunState" in (task?.metadata ?? {})).toBe(false);
    });
  });

  it("persists runtime task reports in sqlite", async () => {
    await withTempRoot("openclaw-runtime-task-store-", async (_root, env) => {
      const now = 1_700_100_100_000;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "balanced",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 90_000,
            maxConcurrentRunsPerWorker: 2,
            maxConcurrentRunsPerRoute: 3,
          },
          tasks: [
            {
              id: "task-report-1",
              title: "Persist runtime report ledger",
              route: "ops",
              status: "waiting_user",
              priority: "high",
              budgetMode: "balanced",
              retrievalMode: "light",
              skillIds: [],
              memoryRefs: [],
              artifactRefs: [],
              recurring: false,
              maintenance: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
          runs: [
            {
              id: "run-report-1",
              taskId: "task-report-1",
              status: "waiting_user",
              thinkingLane: "system1",
              startedAt: now,
              updatedAt: now,
            },
          ],
          steps: [],
          reviews: [],
          reports: [
            {
              id: "report-waiting-user-1",
              taskId: "task-report-1",
              runId: "run-report-1",
              taskStatus: "waiting_user",
              kind: "waiting_user",
              state: "pending",
              reportPolicy: "reply",
              title: "Task waiting for user input: Persist runtime report ledger",
              summary: "Confirm whether the runtime should keep the waiting-user task open.",
              nextAction: "Reply with approval or rejection.",
              requiresUserAction: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        { env, now },
      );

      const store = loadRuntimeTaskStore({ env, now: now + 1 });
      expect(store.reports).toHaveLength(1);
      expect(store.reports[0]).toMatchObject({
        id: "report-waiting-user-1",
        taskId: "task-report-1",
        runId: "run-report-1",
        kind: "waiting_user",
        state: "pending",
        reportPolicy: "reply",
        requiresUserAction: true,
      });
    });
  });

  it("persists runtime governance mcp grants in sqlite", async () => {
    await withTempRoot("openclaw-runtime-governance-store-", async (_root, env) => {
      const now = 1_700_100_200_000;
      saveRuntimeGovernanceStore(
        {
          version: "v1",
          entries: [],
          mcpGrants: [
            {
              id: "grant-agent-research-github",
              agentId: "research",
              mcpServerId: "github",
              state: "allowed",
              summary: "Research agent may use the GitHub MCP surface.",
              updatedAt: now,
            },
          ],
          shadowEvaluations: [],
        },
        { env, now },
      );

      const store = loadRuntimeGovernanceStore({ env, now: now + 1 });
      expect(store.mcpGrants).toHaveLength(1);
      expect(store.mcpGrants[0]).toMatchObject({
        id: "grant-agent-research-github",
        agentId: "research",
        mcpServerId: "github",
        state: "allowed",
      });
    });
  });

  it("persists the runtime user console store in sqlite", async () => {
    await withTempRoot("openclaw-runtime-user-store-", async (_root, env) => {
      const now = 1_700_100_000_000;
      saveRuntimeUserConsoleStore(
        {
          version: "v1",
          userModel: {
            id: "runtime-user",
            displayName: "Operator",
            communicationStyle: "direct and concise",
            interruptionThreshold: "medium",
            reportVerbosity: "brief",
            confirmationBoundary: "balanced",
            reportPolicy: "reply",
            createdAt: now,
            updatedAt: now,
          },
          sessionWorkingPreferences: [
            {
              id: "session-pref-launch",
              sessionId: "session-launch",
              label: "Launch Week",
              communicationStyle: "high-touch",
              reportPolicy: "reply_and_proactive",
              createdAt: now,
              updatedAt: now,
            },
          ],
          agents: [
            {
              id: "agent-sales",
              name: "Sales Agent",
              memoryNamespace: "agent/agent-sales",
              skillIds: ["pitch", "follow-up"],
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          agentOverlays: [
            {
              id: "agent-overlay-sales",
              agentId: "agent-sales",
              reportPolicy: "proactive",
              updatedAt: now,
            },
          ],
          surfaces: [
            {
              id: "surface-wechat-sales",
              channel: "wechat",
              accountId: "wx-sales-01",
              label: "WeChat Sales",
              ownerKind: "agent",
              ownerId: "agent-sales",
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          surfaceRoleOverlays: [
            {
              id: "surface-role-wechat-sales",
              surfaceId: "surface-wechat-sales",
              role: "sales",
              businessGoal: "close qualified leads",
              allowedTopics: ["pricing", "shipping"],
              restrictedTopics: ["refund policy exceptions"],
              createdAt: now,
              updatedAt: now,
            },
          ],
          roleOptimizationCandidates: [],
          userModelOptimizationCandidates: [],
        },
        { env, now },
      );

      const store = loadRuntimeUserConsoleStore({ env, now });
      expect(store.userModel.displayName).toBe("Operator");
      expect(store.agents.map((agent) => agent.id)).toEqual(["agent-sales"]);
      expect(store.surfaces[0]?.ownerKind).toBe("agent");
      expect(store.surfaceRoleOverlays[0]?.role).toBe("sales");

      const retrievalSources = buildRuntimeRetrievalSourceSet({ env, now });
      expect(retrievalSources.sessions.map((entry) => entry.recordId)).toContain("runtime-user");
      expect(retrievalSources.sessions.map((entry) => entry.recordId)).toContain(
        "session-launch",
      );
      expect(retrievalSources.sessions.map((entry) => entry.recordId)).toContain("agent-sales");
      expect(retrievalSources.sessions.map((entry) => entry.recordId)).toContain(
        "surface-wechat-sales",
      );
    });
  });

  it("sanitizes persisted surface local business policies when legacy data is loaded", async () => {
    await withTempRoot("openclaw-runtime-surface-policy-load-", async (_root, env) => {
      const now = 1_700_100_050_000;
      saveRuntimeUserConsoleStore(
        {
          version: "v1",
          userModel: {
            id: "runtime-user",
            displayName: "Operator",
            createdAt: now,
            updatedAt: now,
          },
          sessionWorkingPreferences: [],
          agents: [],
          agentOverlays: [],
          surfaces: [
            {
              id: "surface-wechat-support",
              channel: "wechat",
              accountId: "wx-support-01",
              label: "WeChat Support",
              ownerKind: "agent",
              ownerId: "agent-support",
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          surfaceRoleOverlays: [
            {
              id: "surface-role-wechat-support",
              surfaceId: "surface-wechat-support",
              role: "support_operator",
              allowedTopics: [],
              restrictedTopics: [],
              localBusinessPolicy: ({
                runtimeCoreBinding: "allowed",
                formalMemoryWrite: true,
                userModelWrite: true,
                surfaceRoleWrite: true,
                taskCreation: "direct",
                escalationTarget: "coordinator",
                privacyBoundary: "user-local",
                roleScope: "  support   queue  ",
                customLeak: "should-drop",
              } as unknown as SurfaceLocalBusinessPolicy),
              createdAt: now,
              updatedAt: now,
            },
          ],
          roleOptimizationCandidates: [],
          userModelOptimizationCandidates: [],
        },
        { env, now },
      );

      const store = loadRuntimeUserConsoleStore({ env, now: now + 1 });

      expect(store.surfaceRoleOverlays[0]?.localBusinessPolicy).toEqual({
        runtimeCoreBinding: "forbidden",
        formalMemoryWrite: false,
        userModelWrite: false,
        surfaceRoleWrite: false,
        taskCreation: "recommend_only",
        escalationTarget: "runtime-user",
        privacyBoundary: "agent-local",
        roleScope: "support queue",
      });
    });
  });

  it("emits actionable runtime session signals into retrieval sources", async () => {
    await withTempRoot("openclaw-runtime-retrieval-session-", async (_root, env) => {
      const now = 1_700_100_300_000;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "balanced",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 90_000,
            maxConcurrentRunsPerWorker: 2,
            maxConcurrentRunsPerRoute: 3,
          },
          tasks: [
            {
              id: "task-sales-followup",
              title: "Follow up on the WeChat lead",
              route: "office",
              status: "waiting_user",
              priority: "high",
              budgetMode: "balanced",
              retrievalMode: "light",
              skillIds: [],
              memoryRefs: [],
              artifactRefs: [],
              recurring: false,
              maintenance: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
          runs: [
            {
              id: "run-sales-followup",
              taskId: "task-sales-followup",
              status: "waiting_user",
              thinkingLane: "system1",
              startedAt: now,
              updatedAt: now,
            },
          ],
          steps: [],
          reviews: [],
          reports: [
            {
              id: "report-sales-followup",
              taskId: "task-sales-followup",
              runId: "run-sales-followup",
              taskStatus: "waiting_user",
              kind: "waiting_user",
              state: "pending",
              reportPolicy: "reply",
              title: "Task waiting for user confirmation",
              summary: "Confirm whether the operator wants the runtime to send the follow-up.",
              nextAction: "Approve or reject the outbound follow-up.",
              requiresUserAction: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        { env, now },
      );

      saveRuntimeUserConsoleStore(
        {
          version: "v1",
          userModel: {
            id: "runtime-user",
            reportPolicy: "reply",
            confirmationBoundary: "balanced",
            createdAt: now,
            updatedAt: now,
          },
          sessionWorkingPreferences: [],
          agents: [
            {
              id: "agent-sales",
              name: "Sales Agent",
              memoryNamespace: "agent/agent-sales",
              skillIds: ["pitch", "follow-up"],
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          agentOverlays: [],
          surfaces: [
            {
              id: "surface-wechat-sales",
              channel: "wechat",
              accountId: "wx-sales-01",
              label: "WeChat Sales",
              ownerKind: "agent",
              ownerId: "agent-sales",
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          surfaceRoleOverlays: [
            {
              id: "surface-role-wechat-sales",
              surfaceId: "surface-wechat-sales",
              role: "sales_operator",
              businessGoal: "close qualified leads",
              allowedTopics: ["pricing"],
              restrictedTopics: [],
              createdAt: now,
              updatedAt: now,
            },
          ],
          roleOptimizationCandidates: [
            {
              id: "role-opt-wechat-sales",
              surfaceId: "surface-wechat-sales",
              agentId: "agent-sales",
              ownerKind: "agent",
              summary: "Increase initiative on qualified leads.",
              reasoning: ["Recent qualified lead threads stalled after the first reply."],
              proposedOverlay: {
                role: "closer",
                businessGoal: "book a pricing call",
              },
              observationCount: 4,
              confidence: 88,
              state: "recommended",
              source: "local-review",
              createdAt: now,
              updatedAt: now,
              recommendedAt: now,
            },
          ],
          userModelOptimizationCandidates: [
            {
              id: "user-opt-report-policy",
              field: "reportPolicy",
              summary: "Prefer proactive runtime summaries for outbound sales work.",
              reasoning: ["Three active sessions converged on proactive summaries."],
              proposedUserModel: {
                reportPolicy: "reply_and_proactive",
              },
              observedSessionIds: ["sales-session-1", "sales-session-2", "sales-session-3"],
              observationCount: 3,
              confidence: 90,
              state: "recommended",
              source: "local-review",
              createdAt: now,
              updatedAt: now,
              recommendedAt: now,
            },
          ],
        },
        { env, now },
      );

      saveRuntimeFederationStore(
        {
          version: "v1",
          inbox: [],
          coordinatorSuggestions: [
            {
              id: "coord-suggestion-sales",
              title: "Queue the outbound follow-up after approval",
              summary: "Keep the sales follow-up pending until the operator confirms.",
              taskId: "task-sales-followup",
              sourceRuntimeId: "runtime-central",
              sourcePackageId: "pkg-coord-sales",
              createdAt: now,
              updatedAt: now,
              adoptedAt: now,
              metadata: {
                route: "office",
              },
            },
          ],
          sharedStrategies: [],
          teamKnowledge: [],
        },
        { env, now },
      );

      const retrievalSources = buildRuntimeRetrievalSourceSet({ env, now });
      const sessionIds = retrievalSources.sessions.map((entry) => entry.recordId);
      expect(sessionIds).toContain("report-sales-followup");
      expect(sessionIds).toContain("coord-suggestion-sales");
      expect(sessionIds).toContain("user-opt-report-policy");
      expect(sessionIds).toContain("role-opt-wechat-sales");

      const taskReportCandidate = retrievalSources.sessions.find(
        (entry) => entry.recordId === "report-sales-followup",
      );
      expect(taskReportCandidate).toMatchObject({
        sourceRef: "runtime-task-report",
        metadata: expect.objectContaining({
          sessionSignalKind: "task-report",
          taskId: "task-sales-followup",
          route: "office",
          requiresUserAction: true,
          reportKind: "waiting_user",
          reportState: "pending",
        }),
      });

      const coordinatorSuggestion = retrievalSources.sessions.find(
        (entry) => entry.recordId === "coord-suggestion-sales",
      );
      expect(coordinatorSuggestion?.metadata).toMatchObject({
        sessionSignalKind: "coordinator-suggestion",
        taskId: "task-sales-followup",
        route: "office",
      });

      const userOptimization = retrievalSources.sessions.find(
        (entry) => entry.recordId === "user-opt-report-policy",
      );
      expect(userOptimization?.metadata).toMatchObject({
        sessionSignalKind: "user-model-optimization",
        candidateState: "recommended",
        field: "reportPolicy",
      });

      const roleOptimization = retrievalSources.sessions.find(
        (entry) => entry.recordId === "role-opt-wechat-sales",
      );
      expect(roleOptimization?.metadata).toMatchObject({
        sessionSignalKind: "role-optimization",
        candidateState: "recommended",
        surfaceId: "surface-wechat-sales",
        agentId: "agent-sales",
      });

      const federationStore = loadRuntimeFederationStore({ env, now });
      expect(federationStore.coordinatorSuggestions).toHaveLength(1);
    });
  });

  it("links materialized coordinator suggestions to local task ids in the session retrieval plane", async () => {
    await withTempRoot("openclaw-runtime-store-coordinator-materialized-", async (_root, env) => {
      const now = 1_700_000_004_500;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "balanced",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 90_000,
            maxConcurrentRunsPerWorker: 2,
            maxConcurrentRunsPerRoute: 3,
          },
          tasks: [
            {
              id: "task-local-followup",
              rootTaskId: "task-local-followup",
              title: "Local follow-up task",
              goal: "Resume the approved customer follow-up locally.",
              route: "office",
              status: "queued",
              priority: "normal",
              budgetMode: "balanced",
              retrievalMode: "light",
              skillIds: [],
              memoryRefs: [],
              artifactRefs: [],
              recurring: false,
              maintenance: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
          runs: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now },
      );

      saveRuntimeFederationStore(
        {
          version: "v1",
          inbox: [],
          coordinatorSuggestions: [
            {
              id: "coord-suggestion-materialized",
              title: "Resume approved customer follow-up",
              summary: "Brain OS suggests resuming the local follow-up after approval.",
              taskId: "remote-task-900",
              localTaskId: "task-local-followup",
              sourceRuntimeId: "runtime-central",
              sourcePackageId: "pkg-coord-materialized",
              createdAt: now,
              updatedAt: now,
              adoptedAt: now,
              materializedAt: now + 5,
              metadata: {
                route: "office",
              },
            },
          ],
          sharedStrategies: [],
          teamKnowledge: [],
        },
        { env, now },
      );

      const retrievalSources = buildRuntimeRetrievalSourceSet({ env, now: now + 10 });
      const coordinatorSuggestion = retrievalSources.sessions.find(
        (entry) => entry.recordId === "coord-suggestion-materialized",
      );

      expect(coordinatorSuggestion).toMatchObject({
        excerpt: expect.stringContaining("task:Local follow-up task"),
        metadata: expect.objectContaining({
          sessionSignalKind: "coordinator-suggestion",
          taskId: "task-local-followup",
          localTaskId: "task-local-followup",
          sourceTaskId: "remote-task-900",
          route: "office",
        }),
      });
    });
  });

  it("surfaces requeued coordinator suggestions as session signals with rematerialization context", async () => {
    await withTempRoot("openclaw-runtime-store-coordinator-requeued-", async (_root, env) => {
      const now = 1_700_000_004_900;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "balanced",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 90_000,
            maxConcurrentRunsPerWorker: 2,
            maxConcurrentRunsPerRoute: 3,
          },
          tasks: [
            {
              id: "task-local-cancelled",
              rootTaskId: "task-local-cancelled",
              title: "Cancelled local follow-up",
              goal: "Keep the cancelled local task visible to retrieval.",
              route: "office",
              status: "cancelled",
              priority: "normal",
              budgetMode: "balanced",
              retrievalMode: "light",
              skillIds: [],
              memoryRefs: [],
              artifactRefs: [],
              recurring: false,
              maintenance: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
          runs: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now },
      );
      saveRuntimeFederationStore(
        {
          version: "v1",
          inbox: [],
          coordinatorSuggestions: [
            {
              id: "coord-suggestion-requeued",
              title: "Retry the cancelled follow-up",
              summary: "Bring the coordinator suggestion back after the local task was cancelled.",
              taskId: "remote-task-901",
              sourceRuntimeId: "runtime-central",
              sourcePackageId: "pkg-coord-requeued",
              createdAt: now,
              updatedAt: now,
              adoptedAt: now,
              localTaskStatus: "cancelled",
              lastMaterializedLocalTaskId: "task-local-cancelled",
              lastMaterializedAt: now - 5,
              rematerializeReason: "Linked local task task-local-cancelled was cancelled locally.",
              metadata: {
                route: "office",
              },
            },
          ],
          sharedStrategies: [],
          teamKnowledge: [],
        },
        { env, now },
      );

      const retrievalSources = buildRuntimeRetrievalSourceSet({ env, now: now + 10 });
      const coordinatorSuggestion = retrievalSources.sessions.find(
        (entry) => entry.recordId === "coord-suggestion-requeued",
      );

      expect(coordinatorSuggestion).toMatchObject({
        excerpt: expect.stringContaining("requeue:Linked local task task-local-cancelled was cancelled locally."),
        metadata: expect.objectContaining({
          sessionSignalKind: "coordinator-suggestion",
          localTaskStatus: "cancelled",
          lastMaterializedLocalTaskId: "task-local-cancelled",
          rematerializeReason: "Linked local task task-local-cancelled was cancelled locally.",
          route: "office",
        }),
      });
    });
  });

  it("projects surface task-creation policy into coordinator suggestion session signals", async () => {
    await withTempRoot("openclaw-runtime-store-coordinator-surface-policy-", async (_root, env) => {
      const now = 1_700_000_005_200;
      saveRuntimeUserConsoleStore(
        {
          version: "v1",
          userModel: {
            id: "runtime-user",
            displayName: "Operator",
            communicationStyle: "direct",
            interruptionThreshold: "medium",
            reportVerbosity: "brief",
            confirmationBoundary: "balanced",
            reportPolicy: "reply",
            createdAt: now,
            updatedAt: now,
          },
          sessionWorkingPreferences: [],
          agents: [],
          agentOverlays: [],
          surfaces: [
            {
              id: "surface-sales",
              channel: "wechat",
              accountId: "wechat-sales-001",
              label: "WeChat Sales",
              ownerKind: "user",
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          surfaceRoleOverlays: [
            {
              id: "surface-role-sales",
              surfaceId: "surface-sales",
              role: "sales_closer",
              reportTarget: "runtime-user",
              allowedTopics: [],
              restrictedTopics: [],
              localBusinessPolicy: {
                runtimeCoreBinding: "forbidden",
                formalMemoryWrite: false,
                userModelWrite: false,
                surfaceRoleWrite: false,
                taskCreation: "disabled",
                escalationTarget: "surface-owner",
                privacyBoundary: "user-local",
                roleScope: "sales-queue",
              },
              createdAt: now,
              updatedAt: now,
            },
          ],
          roleOptimizationCandidates: [],
          userModelOptimizationCandidates: [],
        },
        { env, now },
      );

      saveRuntimeFederationStore(
        {
          version: "v1",
          inbox: [],
          coordinatorSuggestions: [
            {
              id: "coord-suggestion-surface-policy",
              title: "Coordinate the next sales follow-up",
              summary: "Queue a local sales follow-up only if the surface policy allows it.",
              taskId: "remote-task-sales",
              sourceRuntimeId: "runtime-central",
              sourcePackageId: "pkg-surface-policy",
              createdAt: now,
              updatedAt: now,
              adoptedAt: now,
              metadata: {
                route: "sales",
                surfaceId: "surface-sales",
              },
            },
          ],
          sharedStrategies: [],
          teamKnowledge: [],
        },
        { env, now },
      );

      const retrievalSources = buildRuntimeRetrievalSourceSet({ env, now: now + 10 });
      const coordinatorSuggestion = retrievalSources.sessions.find(
        (entry) => entry.recordId === "coord-suggestion-surface-policy",
      );

      expect(coordinatorSuggestion).toMatchObject({
        excerpt: expect.stringContaining("surface:WeChat Sales"),
        score: 0.52,
        metadata: expect.objectContaining({
          sessionSignalKind: "coordinator-suggestion",
          surfaceId: "surface-sales",
          taskCreationPolicy: "disabled",
          escalationTarget: "surface-owner",
          materializationBlocked: true,
        }),
      });
    });
  });

  it("adds pending USER.md imports to the session retrieval plane", async () => {
    await withTempRoot("openclaw-runtime-store-user-model-mirror-", async (_root, env) => {
      const now = 1_700_000_006_000;
      updateRuntimeUserModel(
        {
          displayName: "Lauren",
          communicationStyle: "direct and concise",
          reportPolicy: "reply",
        },
        { env, now },
      );
      const mirror = syncRuntimeUserModelMirror({}, { env, now: now + 10 });
      const current = await fs.readFile(mirror.path, "utf8");
      await fs.writeFile(
        mirror.path,
        current.replace('"reportPolicy": "reply"', '"reportPolicy": "reply_and_proactive"'),
        "utf8",
      );

      const retrievalSources = buildRuntimeRetrievalSourceSet({ env, now: now + 20 });
      const mirrorSignal = retrievalSources.sessions.find(
        (entry) => entry.recordId === "runtime-user-model-mirror",
      );

      expect(mirrorSignal).toMatchObject({
        sourceRef: "runtime-user-model-mirror",
        metadata: expect.objectContaining({
          sessionSignalKind: "user-model-mirror",
          requiresUserAction: true,
          mirrorPath: mirror.path,
        }),
      });
    });
  });
});
