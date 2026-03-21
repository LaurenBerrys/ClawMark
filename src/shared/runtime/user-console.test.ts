import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upsertRuntimeCapabilityRegistryEntry } from "./capability-plane.js";
import {
  loadRuntimeGovernanceStore,
  loadRuntimeMemoryStore,
  loadRuntimeUserConsoleStore,
} from "./store.js";
import { applyRuntimeTaskResult, planRuntimeTask, upsertRuntimeTask } from "./task-engine.js";
import {
  adoptRuntimeUserModelOptimizationCandidate,
  adoptRuntimeRoleOptimizationCandidate,
  configureRuntimeUserConsoleMaintenance,
  deleteRuntimeAgent,
  getRuntimeUserModel,
  listRuntimeResolvedSurfaceProfiles,
  listRuntimeUserModelOptimizationCandidates,
  listRuntimeRoleOptimizationCandidates,
  rejectRuntimeUserModelOptimizationCandidate,
  rejectRuntimeRoleOptimizationCandidate,
  reviewRuntimeUserModelOptimizations,
  reviewRuntimeRoleOptimizations,
  reviewRuntimeUserConsoleMaintenance,
  resolveRuntimeUserPreferenceView,
  updateRuntimeUserModel,
  upsertRuntimeAgent,
  upsertRuntimeSessionWorkingPreference,
  upsertRuntimeSurface,
  upsertRuntimeSurfaceRoleOverlay,
} from "./user-console.js";

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

describe("runtime user console memory hooks", () => {
  it("writes user and communication memories when the runtime user model changes", async () => {
    await withTempRoot("openclaw-runtime-user-console-", async (_root, env) => {
      const now = 1_700_320_000_000;
      updateRuntimeUserModel(
        {
          displayName: "Lauren",
          communicationStyle: "direct",
          interruptionThreshold: "low",
          reportVerbosity: "detailed",
          confirmationBoundary: "strict",
          reportPolicy: "reply_and_proactive",
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now });

      expect(memoryStore.memories.some((entry) => entry.memoryType === "user")).toBe(true);
      expect(memoryStore.memories.some((entry) => entry.memoryType === "communication")).toBe(true);
    });
  });

  it("writes surface communication memory when a surface role overlay is updated", async () => {
    await withTempRoot("openclaw-runtime-surface-memory-", async (_root, env) => {
      const now = 1_700_321_000_000;
      const surface = upsertRuntimeSurface(
        {
          channel: "wecom",
          accountId: "sales-1",
          label: "WeCom Sales",
          ownerKind: "user",
        },
        { env, now },
      );

      upsertRuntimeSurfaceRoleOverlay(
        {
          surfaceId: surface.id,
          role: "sales",
          businessGoal: "Convert qualified leads",
          allowedTopics: ["pricing", "demo"],
          restrictedTopics: ["legal"],
          reportTarget: "runtime-user",
        },
        { env, now: now + 10 },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const overlayMemory = memoryStore.memories.find(
        (entry) => entry.scope === `surface:${surface.id}`,
      );

      expect(overlayMemory?.memoryType).toBe("communication");
      expect(overlayMemory?.summary).toContain("WeCom Sales");
      expect(overlayMemory?.detail).toContain("allow=pricing/demo");
    });
  });

  it("keeps session working preferences separate from the long-term user model", async () => {
    await withTempRoot("openclaw-runtime-session-preference-", async (_root, env) => {
      const now = 1_700_322_000_000;
      updateRuntimeUserModel(
        {
          displayName: "Lauren",
          communicationStyle: "steady and concise",
          reportPolicy: "reply",
        },
        { env, now },
      );
      const beforeMemoryCount = loadRuntimeMemoryStore({ env, now }).memories.length;

      const sessionPreference = upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-alpha",
          label: "Launch week",
          communicationStyle: "proactive and high-touch",
          interruptionThreshold: "low",
          reportVerbosity: "detailed",
          confirmationBoundary: "strict",
          reportPolicy: "reply_and_proactive",
        },
        { env, now: now + 10 },
      );

      const afterMemoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const resolved = resolveRuntimeUserPreferenceView(
        {
          sessionId: sessionPreference.sessionId,
        },
        { env, now: now + 10 },
      );

      expect(resolved.userModel.communicationStyle).toBe("steady and concise");
      expect(resolved.sessionWorkingPreference?.communicationStyle).toBe(
        "proactive and high-touch",
      );
      expect(resolved.effective.communicationStyle).toBe("proactive and high-touch");
      expect(resolved.sources.communicationStyle).toBe("session");
      expect(afterMemoryStore.memories).toHaveLength(beforeMemoryCount);
    });
  });

  it("runs user console maintenance without letting expired session overlays linger in the authoritative store", async () => {
    await withTempRoot("openclaw-runtime-user-console-maintenance-", async (_root, env) => {
      const now = 1_700_322_500_000;
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-expired",
          communicationStyle: "temporary high-touch",
          expiresAt: now - 1_000,
        },
        { env, now },
      );
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-active",
          communicationStyle: "still active",
          expiresAt: now + 60 * 60 * 1000,
        },
        { env, now: now + 10 },
      );

      const result = reviewRuntimeUserConsoleMaintenance({ env, now: now + 20 });
      const consoleStore = loadRuntimeUserConsoleStore({ env, now: now + 20 });

      expect(result.expiredSessionPreferenceCount).toBe(1);
      expect(result.removedSessionPreferenceIds).toEqual(["session-pref-session-expired"]);
      expect(consoleStore.sessionWorkingPreferences.map((entry) => entry.sessionId)).toEqual([
        "session-active",
      ]);
      expect(consoleStore.metadata?.lastReviewAt).toBe(now + 20);
      expect(consoleStore.metadata?.lastSessionCleanupAt).toBe(now + 20);
    });
  });

  it("configures authoritative user console maintenance controls with bounded cadence", async () => {
    await withTempRoot("openclaw-runtime-user-console-maintenance-config-", async (_root, env) => {
      const now = 1_700_322_600_000;
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-expired",
          communicationStyle: "temporary high-touch",
          expiresAt: now - 1_000,
        },
        { env, now },
      );

      reviewRuntimeUserConsoleMaintenance({ env, now: now + 20 });
      const configured = configureRuntimeUserConsoleMaintenance(
        {
          enabled: false,
          reviewIntervalHours: 999,
        },
        { env, now: now + 40 },
      );
      const consoleStore = loadRuntimeUserConsoleStore({ env, now: now + 40 });

      expect(configured.enabled).toBe(false);
      expect(configured.reviewIntervalHours).toBe(168);
      expect(configured.lastReviewAt).toBe(now + 20);
      expect(configured.lastSessionCleanupAt).toBe(now + 20);
      expect(consoleStore.metadata?.enabled).toBe(false);
      expect(consoleStore.metadata?.reviewIntervalHours).toBe(168);
      expect(consoleStore.metadata?.lastReviewAt).toBe(now + 20);
      expect(consoleStore.metadata?.lastSessionCleanupAt).toBe(now + 20);
    });
  });

  it("resolves effective preferences with session overrides above agent overlays above user core", async () => {
    await withTempRoot("openclaw-runtime-session-resolution-", async (_root, env) => {
      const now = 1_700_323_000_000;
      updateRuntimeUserModel(
        {
          communicationStyle: "direct",
          interruptionThreshold: "high",
          reportVerbosity: "brief",
          confirmationBoundary: "balanced",
          reportPolicy: "reply",
        },
        { env, now },
      );
      const agent = upsertRuntimeAgent(
        {
          name: "Sales Agent",
          roleBase: "sales",
          overlay: {
            communicationStyle: "friendly and persuasive",
            reportPolicy: "proactive",
          },
        },
        { env, now: now + 10 },
      );
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-beta",
          communicationStyle: "high-context executive brief",
          interruptionThreshold: "low",
          reportVerbosity: "detailed",
          confirmationBoundary: "strict",
          reportPolicy: "silent",
        },
        { env, now: now + 20 },
      );

      const resolved = resolveRuntimeUserPreferenceView(
        {
          agentId: agent.id,
          sessionId: "session-beta",
        },
        { env, now: now + 20 },
      );

      expect(resolved.effective.communicationStyle).toBe("high-context executive brief");
      expect(resolved.effective.interruptionThreshold).toBe("low");
      expect(resolved.effective.reportVerbosity).toBe("detailed");
      expect(resolved.effective.confirmationBoundary).toBe("strict");
      expect(resolved.effective.reportPolicy).toBe("silent");
      expect(resolved.sources.communicationStyle).toBe("session");
      expect(resolved.sources.reportPolicy).toBe("session");
    });
  });

  it("materializes local agents into authoritative governance and preserves explicit governance state across edits and deletes", async () => {
    await withTempRoot("openclaw-runtime-agent-governance-", async (_root, env) => {
      const now = 1_700_323_500_000;
      const created = upsertRuntimeAgent(
        {
          id: "sales-agent",
          name: "Sales Agent",
          roleBase: "sales",
          skillIds: ["pitch-deck", "stale-shadow"],
        },
        { env, now },
      );

      let governanceStore = loadRuntimeGovernanceStore({ env, now });
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "agent" && entry.targetId === created.id,
        )?.state,
      ).toBe("shadow");
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "skill" && entry.targetId === "pitch-deck",
        )?.state,
      ).toBe("shadow");
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "skill" && entry.targetId === "stale-shadow",
        )?.state,
      ).toBe("shadow");

      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "agent",
          targetId: created.id,
          state: "candidate",
          summary: "Keep this agent staged for approval before it reaches the live lane.",
        },
        { env, now: now + 10 },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "pitch-deck",
          state: "adopted",
          summary: "This local skill has already been approved for live use.",
        },
        { env, now: now + 15 },
      );
      upsertRuntimeAgent(
        {
          id: created.id,
          name: "Sales Agent v2",
          roleBase: "sales",
          skillIds: ["pitch-deck", "proposal-draft"],
        },
        { env, now: now + 20 },
      );

      governanceStore = loadRuntimeGovernanceStore({ env, now: now + 20 });
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "agent" && entry.targetId === created.id,
        )?.state,
      ).toBe("candidate");
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "skill" && entry.targetId === "pitch-deck",
        )?.state,
      ).toBe("adopted");
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "skill" && entry.targetId === "proposal-draft",
        )?.state,
      ).toBe("shadow");
      expect(
        governanceStore.entries.some(
          (entry) => entry.registryType === "skill" && entry.targetId === "stale-shadow",
        ),
      ).toBe(false);

      const deleted = deleteRuntimeAgent(created.id, {
        env,
        now: now + 30,
      });

      governanceStore = loadRuntimeGovernanceStore({ env, now: now + 30 });
      expect(deleted.removed).toBe(true);
      expect(
        governanceStore.entries.some(
          (entry) => entry.registryType === "agent" && entry.targetId === created.id,
        ),
      ).toBe(false);
      expect(
        governanceStore.entries.some(
          (entry) => entry.registryType === "skill" && entry.targetId === "proposal-draft",
        ),
      ).toBe(false);
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "skill" && entry.targetId === "pitch-deck",
        )?.state,
      ).toBe("adopted");
      expect(governanceStore.mcpGrants.some((grant) => grant.agentId === created.id)).toBe(false);
    });
  });

  it("reviews local surface role optimizations and emits recommendable candidates without mutating the overlay", async () => {
    await withTempRoot("openclaw-runtime-role-review-", async (_root, env) => {
      const now = 1_700_324_000_000;
      updateRuntimeUserModel(
        {
          communicationStyle: "direct and concise",
          reportPolicy: "reply",
        },
        { env, now },
      );
      const agent = upsertRuntimeAgent(
        {
          name: "Sales Agent",
          roleBase: "sales_operator",
          overlay: {
            communicationStyle: "friendly and persuasive",
          },
        },
        { env, now: now + 10 },
      );
      const surface = upsertRuntimeSurface(
        {
          channel: "wechat",
          accountId: "wx-sales-1",
          label: "WeChat Sales",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 20 },
      );

      const result = reviewRuntimeRoleOptimizations({ env, now: now + 30 });
      const candidates = listRuntimeRoleOptimizationCandidates({ env, now: now + 30 });
      const candidate = candidates.find((entry) => entry.surfaceId === surface.id);
      const consoleStore = resolveRuntimeUserPreferenceView({}, { env, now: now + 30 });

      expect(result.recommended).toBeGreaterThanOrEqual(1);
      expect(candidate?.state).toBe("recommended");
      expect(candidate?.proposedOverlay.role).toBe("sales_operator");
      expect(candidate?.proposedOverlay.reportTarget).toBe("runtime-user");
      expect(candidate?.proposedOverlay.localBusinessPolicy).toMatchObject({
        formalMemoryWrite: false,
        taskCreation: "recommend_only",
      });
      expect(candidate?.reasoning.join(" ")).toContain("role overlay");
      expect(consoleStore.userModel.reportPolicy).toBe("reply");
    });
  });

  it("adopts and rejects local role optimization candidates through the persisted user console store", async () => {
    await withTempRoot("openclaw-runtime-role-adopt-", async (_root, env) => {
      const now = 1_700_325_000_000;
      const adoptSurface = upsertRuntimeSurface(
        {
          channel: "wecom",
          accountId: "ops-1",
          label: "WeCom Ops",
          ownerKind: "user",
        },
        { env, now },
      );
      const rejectSurface = upsertRuntimeSurface(
        {
          channel: "wechat",
          accountId: "sales-2",
          label: "WeChat Sales",
          ownerKind: "user",
        },
        { env, now: now + 1 },
      );
      reviewRuntimeRoleOptimizations({ env, now: now + 10 });
      const candidates = listRuntimeRoleOptimizationCandidates({ env, now: now + 10 });
      const adoptCandidate = candidates.find((entry) => entry.surfaceId === adoptSurface.id);
      const rejectCandidate = candidates.find((entry) => entry.surfaceId === rejectSurface.id);
      if (!adoptCandidate || !rejectCandidate) {
        throw new Error("expected role optimization candidates");
      }

      const adopted = adoptRuntimeRoleOptimizationCandidate(adoptCandidate.id, {
        env,
        now: now + 20,
      });
      const afterAdopt = listRuntimeRoleOptimizationCandidates({ env, now: now + 20 }).find(
        (entry) => entry.id === adoptCandidate.id,
      );
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 20 });

      expect(adopted.candidate.state).toBe("adopted");
      expect(adopted.overlay.surfaceId).toBe(adoptSurface.id);
      expect(afterAdopt?.state).toBe("adopted");
      expect(
        memoryStore.memories.some(
          (entry) =>
            entry.scope === `surface:${adoptSurface.id}` &&
            entry.metadata?.overlayId === adopted.overlay.id,
        ),
      ).toBe(true);

      const rejected = rejectRuntimeRoleOptimizationCandidate(
        {
          id: rejectCandidate.id,
          reason: "keep the existing local overlay",
        },
        { env, now: now + 30 },
      );

      expect(rejected.candidate.state).toBe("rejected");
      expect(rejected.candidate.metadata?.rejectionReason).toBe("keep the existing local overlay");
    });
  });

  it("derives local role optimization recommendations from recent surface task outcomes", async () => {
    await withTempRoot("openclaw-runtime-role-ops-review-", async (_root, env) => {
      const now = 1_700_325_250_000;
      const agent = upsertRuntimeAgent(
        {
          name: "Sales Agent",
          roleBase: "sales_operator",
        },
        { env, now },
      );
      const surface = upsertRuntimeSurface(
        {
          channel: "wechat",
          accountId: "wx-sales-ops-1",
          label: "WeChat Sales Ops",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 10 },
      );
      upsertRuntimeSurfaceRoleOverlay(
        {
          surfaceId: surface.id,
          role: "sales_operator",
          businessGoal: "Convert qualified leads without policy drift.",
          tone: "clear, persuasive, and respectful",
          initiative: "high",
          reportTarget: "runtime-user",
          localBusinessPolicy: {
            taskCreation: "recommend_only",
            escalationTarget: "runtime-user",
          },
        },
        { env, now: now + 20 },
      );

      const waitingTaskA = upsertRuntimeTask(
        {
          title: "Follow up with pricing objection A",
          route: "runtime",
          goal: "Handle the first pricing objection.",
          surfaceId: surface.id,
          sessionId: "surface-ops-session-a",
        },
        { env, now: now + 30 },
      ).task;
      planRuntimeTask(waitingTaskA.id, { env, now: now + 40 });
      applyRuntimeTaskResult(
        {
          taskId: waitingTaskA.id,
          status: "waiting_user",
          summary: "Need a local decision before quoting the custom discount.",
          now: now + 50,
        },
        { env, now: now + 50 },
      );

      const waitingTaskB = upsertRuntimeTask(
        {
          title: "Follow up with pricing objection B",
          route: "runtime",
          goal: "Handle the second pricing objection.",
          surfaceId: surface.id,
          sessionId: "surface-ops-session-b",
        },
        { env, now: now + 60 },
      ).task;
      planRuntimeTask(waitingTaskB.id, { env, now: now + 70 });
      applyRuntimeTaskResult(
        {
          taskId: waitingTaskB.id,
          status: "waiting_user",
          summary: "Need confirmation before committing the delivery date.",
          now: now + 80,
        },
        { env, now: now + 80 },
      );

      const waitingTaskC = upsertRuntimeTask(
        {
          title: "Follow up with pricing objection C",
          route: "runtime",
          goal: "Handle the third pricing objection.",
          surfaceId: surface.id,
          sessionId: "surface-ops-session-c",
        },
        { env, now: now + 90 },
      ).task;
      planRuntimeTask(waitingTaskC.id, { env, now: now + 100 });
      applyRuntimeTaskResult(
        {
          taskId: waitingTaskC.id,
          status: "waiting_user",
          summary:
            "Need one more local decision before the owning agent can close the objection cleanly.",
          now: now + 110,
        },
        { env, now: now + 110 },
      );

      const result = reviewRuntimeRoleOptimizations({ env, now: now + 120 });
      const candidate = listRuntimeRoleOptimizationCandidates({ env, now: now + 120 }).find(
        (entry) => entry.surfaceId === surface.id,
      );

      expect(result.recommended).toBeGreaterThanOrEqual(1);
      expect(candidate?.state).toBe("recommended");
      expect(candidate?.summary).toContain("tune local surface routing");
      expect(candidate?.proposedOverlay.reportTarget).toBe("surface-owner");
      expect(candidate?.proposedOverlay.initiative).toBe("medium");
      expect(candidate?.proposedOverlay.localBusinessPolicy).toMatchObject({
        escalationTarget: "surface-owner",
        taskCreation: "recommend_only",
      });
      expect(candidate?.reasoning.join(" ")).toContain(
        "first-pass reports should route to the owning agent",
      );
      expect(candidate?.metadata).toMatchObject({
        signalSource: "surface-operations",
        waitingUserCount: 3,
        blockedCount: 0,
        followUpPressure: 3,
      });
    });
  });

  it("builds effective surface profiles from user, agent, and local overlay signals", async () => {
    await withTempRoot("openclaw-runtime-surface-profile-", async (_root, env) => {
      const now = 1_700_325_500_000;
      updateRuntimeUserModel(
        {
          communicationStyle: "operator-direct",
          reportPolicy: "reply",
        },
        { env, now },
      );
      const agent = upsertRuntimeAgent(
        {
          name: "Sales Agent",
          roleBase: "sales_operator",
          overlay: {
            communicationStyle: "friendly and persuasive",
          },
        },
        { env, now: now + 10 },
      );
      const surface = upsertRuntimeSurface(
        {
          channel: "wechat",
          accountId: "wx-sales-1",
          label: "WeChat Sales",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 20 },
      );
      upsertRuntimeSurfaceRoleOverlay(
        {
          surfaceId: surface.id,
          role: "lead_closer",
          businessGoal: "Convert high-intent leads",
          allowedTopics: ["pricing", "demo"],
          restrictedTopics: ["legal"],
        },
        { env, now: now + 30 },
      );

      const profile = listRuntimeResolvedSurfaceProfiles({ env, now: now + 40 }).find(
        (entry) => entry.surface.id === surface.id,
      );

      expect(profile?.ownerLabel).toBe("Sales Agent");
      expect(profile?.effectiveRole).toBe("lead_closer");
      expect(profile?.effectiveBusinessGoal).toBe("Convert high-intent leads");
      expect(profile?.effectiveTone).toBe("friendly and persuasive");
      expect(profile?.effectiveReportTarget).toBe("runtime-user");
      expect(profile?.effectiveLocalBusinessPolicy).toMatchObject({
        formalMemoryWrite: false,
        escalationTarget: "runtime-user",
      });
      expect(profile?.sources.localBusinessPolicy).toBe("overlay");
      expect(profile?.sources.role).toBe("overlay");
      expect(profile?.sources.tone).toBe("agent");
      expect(profile?.overlayPresent).toBe(true);
    });
  });

  it("sanitizes surface local business policies so service overlays cannot expand runtime authority", async () => {
    await withTempRoot("openclaw-runtime-surface-policy-", async (_root, env) => {
      const now = 1_700_325_750_000;
      const agent = upsertRuntimeAgent(
        {
          name: "Support Agent",
          roleBase: "support_operator",
        },
        { env, now },
      );
      const surface = upsertRuntimeSurface(
        {
          channel: "wechat",
          accountId: "wx-support-1",
          label: "WeChat Support",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 10 },
      );

      const overlay = upsertRuntimeSurfaceRoleOverlay(
        {
          surfaceId: surface.id,
          role: "support_operator",
          localBusinessPolicy: {
            runtimeCoreBinding: "allowed",
            formalMemoryWrite: true,
            userModelWrite: true,
            surfaceRoleWrite: true,
            taskCreation: "disabled",
            escalationTarget: "surface-owner",
            privacyBoundary: "user-local",
            roleScope: "  support   queue  ",
          },
        },
        { env, now: now + 20 },
      );

      const profile = listRuntimeResolvedSurfaceProfiles({ env, now: now + 30 }).find(
        (entry) => entry.surface.id === surface.id,
      );

      expect(overlay.localBusinessPolicy).toEqual({
        runtimeCoreBinding: "forbidden",
        formalMemoryWrite: false,
        userModelWrite: false,
        surfaceRoleWrite: false,
        taskCreation: "disabled",
        escalationTarget: "surface-owner",
        privacyBoundary: "agent-local",
        roleScope: "support queue",
      });
      expect(profile?.effectiveLocalBusinessPolicy).toEqual(overlay.localBusinessPolicy);
      expect(profile?.sources.localBusinessPolicy).toBe("overlay");
    });
  });

  it("sanitizes invalid surface reportTarget values back to the allowlisted defaults", async () => {
    await withTempRoot("openclaw-runtime-surface-report-target-", async (_root, env) => {
      const now = 1_700_325_800_000;
      const agent = upsertRuntimeAgent(
        {
          name: "Sales Agent",
          roleBase: "sales_operator",
        },
        { env, now },
      );
      const surface = upsertRuntimeSurface(
        {
          channel: "wechat",
          accountId: "wx-sales-allowlist",
          label: "WeChat Sales",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 10 },
      );

      const overlay = upsertRuntimeSurfaceRoleOverlay(
        {
          surfaceId: surface.id,
          role: "lead_closer",
          reportTarget: "brain-core",
        },
        { env, now: now + 20 },
      );

      const profile = listRuntimeResolvedSurfaceProfiles({ env, now: now + 30 }).find(
        (entry) => entry.surface.id === surface.id,
      );

      expect(overlay.reportTarget).toBeUndefined();
      expect(profile?.effectiveReportTarget).toBe("runtime-user");
      expect(profile?.sources.reportTarget).toBe("default");
    });
  });

  it("reviews repeated session preferences into user model optimization candidates without mutating the long-term user core", async () => {
    await withTempRoot("openclaw-runtime-user-model-review-", async (_root, env) => {
      const now = 1_700_326_000_000;
      updateRuntimeUserModel(
        {
          communicationStyle: "steady and concise",
          interruptionThreshold: "high",
          reportVerbosity: "brief",
          confirmationBoundary: "balanced",
          reportPolicy: "reply",
        },
        { env, now },
      );
      const beforeMemoryCount = loadRuntimeMemoryStore({ env, now }).memories.length;

      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-1",
          communicationStyle: "high-context executive brief",
          reportPolicy: "reply_and_proactive",
          reportVerbosity: "detailed",
        },
        { env, now: now + 10 },
      );
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-2",
          communicationStyle: "high-context executive brief",
          reportPolicy: "reply_and_proactive",
          reportVerbosity: "detailed",
        },
        { env, now: now + 20 },
      );
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-3",
          communicationStyle: "high-context executive brief",
          reportPolicy: "reply_and_proactive",
        },
        { env, now: now + 30 },
      );

      const result = reviewRuntimeUserModelOptimizations({ env, now: now + 40 });
      const candidates = listRuntimeUserModelOptimizationCandidates({ env, now: now + 40 });
      const styleCandidate = candidates.find((entry) => entry.field === "communicationStyle");
      const policyCandidate = candidates.find((entry) => entry.field === "reportPolicy");
      const userModel = getRuntimeUserModel({ env, now: now + 40 });
      const afterMemoryCount = loadRuntimeMemoryStore({ env, now: now + 40 }).memories.length;

      expect(result.recommended).toBeGreaterThanOrEqual(2);
      expect(styleCandidate?.state).toBe("recommended");
      expect(styleCandidate?.proposedUserModel.communicationStyle).toBe(
        "high-context executive brief",
      );
      expect(styleCandidate?.observedSessionIds).toEqual(["session-1", "session-2", "session-3"]);
      expect(policyCandidate?.proposedUserModel.reportPolicy).toBe("reply_and_proactive");
      expect(userModel.communicationStyle).toBe("steady and concise");
      expect(userModel.reportPolicy).toBe("reply");
      expect(afterMemoryCount).toBe(beforeMemoryCount);
    });
  });

  it("learns report policy candidates from recent task-report behavior tied to real sessions", async () => {
    await withTempRoot("openclaw-runtime-user-model-report-policy-review-", async (_root, env) => {
      const now = 1_700_326_500_000;
      updateRuntimeUserModel(
        {
          reportPolicy: "reply",
        },
        { env, now },
      );

      const taskA = upsertRuntimeTask(
        {
          title: "Session A proactive task",
          route: "runtime",
          goal: "Create a proactive completion report for session A.",
          sessionId: "session-report-a",
          reportPolicy: "reply_and_proactive",
        },
        { env, now: now + 10 },
      ).task;
      const taskB = upsertRuntimeTask(
        {
          title: "Session B proactive task",
          route: "runtime",
          goal: "Create a proactive completion report for session B.",
          sessionId: "session-report-b",
          reportPolicy: "reply_and_proactive",
        },
        { env, now: now + 20 },
      ).task;

      planRuntimeTask(taskA.id, { env, now: now + 30 });
      applyRuntimeTaskResult(
        {
          taskId: taskA.id,
          status: "completed",
          summary: "Session A finished with a proactive report.",
          now: now + 40,
        },
        { env, now: now + 40 },
      );

      planRuntimeTask(taskB.id, { env, now: now + 50 });
      applyRuntimeTaskResult(
        {
          taskId: taskB.id,
          status: "completed",
          summary: "Session B finished with a proactive report.",
          now: now + 60,
        },
        { env, now: now + 60 },
      );

      const result = reviewRuntimeUserModelOptimizations({ env, now: now + 70 });
      const candidate = listRuntimeUserModelOptimizationCandidates({ env, now: now + 70 }).find(
        (entry) => entry.field === "reportPolicy",
      );

      expect(result.recommended).toBeGreaterThanOrEqual(1);
      expect(candidate?.state).toBe("recommended");
      expect(candidate?.proposedUserModel.reportPolicy).toBe("reply_and_proactive");
      expect(candidate?.observedSessionIds).toEqual(["session-report-a", "session-report-b"]);
      expect(candidate?.metadata?.taskReportObservationCount).toBe(2);
    });
  });

  it("adopts user model optimization candidates into the local user core and writes preference memories", async () => {
    await withTempRoot("openclaw-runtime-user-model-adopt-", async (_root, env) => {
      const now = 1_700_327_000_000;
      updateRuntimeUserModel(
        {
          interruptionThreshold: "high",
          reportVerbosity: "brief",
        },
        { env, now },
      );
      const beforeMemoryCount = loadRuntimeMemoryStore({ env, now }).memories.length;

      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-a",
          interruptionThreshold: "low",
          reportVerbosity: "detailed",
        },
        { env, now: now + 10 },
      );
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-b",
          interruptionThreshold: "low",
          reportVerbosity: "detailed",
        },
        { env, now: now + 20 },
      );

      reviewRuntimeUserModelOptimizations({ env, now: now + 30 });
      const candidate = listRuntimeUserModelOptimizationCandidates({ env, now: now + 30 }).find(
        (entry) => entry.field === "interruptionThreshold",
      );
      if (!candidate) {
        throw new Error("expected user model optimization candidate");
      }

      const adopted = adoptRuntimeUserModelOptimizationCandidate(candidate.id, {
        env,
        now: now + 40,
      });
      const afterCandidate = listRuntimeUserModelOptimizationCandidates({
        env,
        now: now + 40,
      }).find((entry) => entry.id === candidate.id);
      const userModel = getRuntimeUserModel({ env, now: now + 40 });
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 40 });

      expect(adopted.candidate.state).toBe("adopted");
      expect(adopted.userModel.interruptionThreshold).toBe("low");
      expect(afterCandidate?.state).toBe("adopted");
      expect(userModel.interruptionThreshold).toBe("low");
      expect(memoryStore.memories.length).toBeGreaterThanOrEqual(beforeMemoryCount);
      expect(
        memoryStore.memories.some(
          (entry) =>
            entry.memoryType === "user" &&
            (entry.detail?.includes("interruption_threshold") ||
              entry.summary.includes("打扰阈值=low") ||
              entry.metadata?.interruptionThreshold === "low"),
        ),
      ).toBe(true);
    });
  });

  it("rejects user model optimization candidates and persists the rejection reason", async () => {
    await withTempRoot("openclaw-runtime-user-model-reject-", async (_root, env) => {
      const now = 1_700_328_000_000;
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-x",
          confirmationBoundary: "strict",
        },
        { env, now },
      );
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-y",
          confirmationBoundary: "strict",
        },
        { env, now: now + 10 },
      );
      reviewRuntimeUserModelOptimizations({ env, now: now + 20 });
      const candidate = listRuntimeUserModelOptimizationCandidates({ env, now: now + 20 }).find(
        (entry) => entry.field === "confirmationBoundary",
      );
      if (!candidate) {
        throw new Error("expected user model optimization candidate");
      }

      const rejected = rejectRuntimeUserModelOptimizationCandidate(
        {
          id: candidate.id,
          reason: "keep confirmations looser for now",
        },
        { env, now: now + 30 },
      );
      const persisted = listRuntimeUserModelOptimizationCandidates({ env, now: now + 30 }).find(
        (entry) => entry.id === candidate.id,
      );

      expect(rejected.candidate.state).toBe("rejected");
      expect(rejected.candidate.metadata?.rejectionReason).toBe(
        "keep confirmations looser for now",
      );
      expect(persisted?.state).toBe("rejected");
    });
  });
});
