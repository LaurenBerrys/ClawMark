import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configureRuntimeFederationPushPolicy } from "./federation-policy.js";
import { listRuntimeFederationAssignments } from "./federation-assignments.js";
import {
  configureRuntimeFederationRemoteSyncMaintenance,
  readFederationRemoteSyncMaintenanceControls,
} from "./federation-remote-maintenance.js";
import { distillTaskOutcomeToMemory } from "./mutations.js";
import { previewRuntimeFederationRemote, syncRuntimeFederationRemote } from "./federation-sync.js";
import { buildFederationRuntimeSnapshot } from "./runtime-dashboard.js";
import { loadRuntimeFederationStore, loadRuntimeTaskStore, saveRuntimeTaskStore } from "./store.js";

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
    OPENCLAW_LEGACY_RUNTIME_ROOT: path.join(root, "legacy"),
  } as NodeJS.ProcessEnv;
  try {
    await run(root, env);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function readRequestBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

describe("runtime federation remote sync", () => {
  it("previews the next managed sync batch from the authoritative outbox journal", async () => {
    await withTempRoot("openclaw-runtime-federation-preview-", async (_root, env) => {
      const now = 1_700_000_695_100;
      const task = {
        id: "task-remote-preview",
        title: "Preview managed federation sync",
        route: "ops",
        status: "completed" as const,
        priority: "normal" as const,
        budgetMode: "balanced" as const,
        retrievalMode: "light" as const,
        worker: "main",
        skillIds: ["preview-runtime-sync"],
        memoryRefs: [],
        artifactRefs: [],
        recurring: false,
        maintenance: false,
        createdAt: now,
        updatedAt: now,
      };
      const review = {
        id: "review-remote-preview",
        taskId: task.id,
        runId: "run-remote-preview",
        summary: "Preview must show the next outbound shareable batch before remote sync.",
        outcome: "success" as const,
        extractedMemoryIds: [],
        strategyCandidateIds: [],
        createdAt: now,
      };
      distillTaskOutcomeToMemory(
        {
          task,
          review,
          now,
        },
        { env, now },
      );
      const taskStore = loadRuntimeTaskStore({ env, now });
      taskStore.tasks = [task];
      taskStore.reviews = [review];
      saveRuntimeTaskStore(taskStore, { env, now });

      const preview = previewRuntimeFederationRemote({
        env,
        now,
        config: {
          federation: {
            remote: {
              enabled: true,
              url: "https://brain.example.test/runtime",
            },
            push: {
              allowedScopes: [
                "shareable_derived",
                "strategy_digest",
                "news_digest",
                "shadow_telemetry",
                "capability_governance",
                "team_shareable_knowledge",
              ],
            },
          },
        },
      });

      const federationStore = loadRuntimeFederationStore({
        env,
        now,
      });
      const snapshot = buildFederationRuntimeSnapshot({
        env,
        now,
      });

      expect(preview.ready).toBe(true);
      expect(preview.issue).toBeNull();
      expect(preview.pushUrl).toBe("https://brain.example.test/runtime/outbox");
      expect(preview.pullUrl).toBe("https://brain.example.test/runtime/inbox");
      expect(preview.pushedEnvelopeKeys).toEqual([
        "runtimeManifest",
        "shareableReviews",
        "shareableMemories",
        "strategyDigest",
        "newsDigest",
        "shadowTelemetry",
        "capabilityGovernance",
        "teamKnowledge",
      ]);
      expect(preview.envelopeCounts.runtimeManifest).toBe(1);
      expect(preview.envelopeCounts.shareableReviews).toBe(1);
      expect(preview.envelopeCounts.shareableMemories).toBeGreaterThan(0);
      expect(preview.envelopeCounts.teamKnowledge).toBe(1);
      expect(preview.pendingOutboxEventCount).toBeGreaterThan(0);
      expect(preview.pendingEvents[0]).toMatchObject({
        operation: "upsert",
      });
      expect(preview.localOutboxHeadEventId).toBe(federationStore.syncCursor?.metadata?.localOutboxHeadEventId);
      expect(snapshot.pendingOutboxEventCount).toBe(preview.pendingOutboxEventCount);
    });
  });

  it("uses the authoritative local federation push policy to trim remote preview envelopes", async () => {
    await withTempRoot("openclaw-runtime-federation-preview-local-policy-", async (_root, env) => {
      const now = 1_700_000_695_700;
      const task = {
        id: "task-remote-preview-local-policy",
        title: "Preview local federation push policy",
        route: "ops",
        status: "completed" as const,
        priority: "normal" as const,
        budgetMode: "balanced" as const,
        retrievalMode: "light" as const,
        worker: "main",
        skillIds: ["preview-runtime-sync"],
        memoryRefs: [],
        artifactRefs: [],
        recurring: false,
        maintenance: false,
        createdAt: now,
        updatedAt: now,
      };
      const review = {
        id: "review-remote-preview-local-policy",
        taskId: task.id,
        runId: "run-remote-preview-local-policy",
        summary: "Local export policy should trim optional upstream envelopes.",
        outcome: "success" as const,
        extractedMemoryIds: [],
        strategyCandidateIds: [],
        createdAt: now,
      };
      distillTaskOutcomeToMemory(
        {
          task,
          review,
          now,
        },
        { env, now },
      );
      const taskStore = loadRuntimeTaskStore({ env, now });
      taskStore.tasks = [task];
      taskStore.reviews = [review];
      saveRuntimeTaskStore(taskStore, { env, now });
      configureRuntimeFederationPushPolicy(
        {
          allowedPushScopes: ["shareable_derived", "capability_governance"],
        },
        { env, now },
      );

      const preview = previewRuntimeFederationRemote({
        env,
        now,
        config: {
          federation: {
            remote: {
              enabled: true,
              url: "https://brain.example.test/runtime",
            },
            push: {
              allowedScopes: [
                "shareable_derived",
                "strategy_digest",
                "news_digest",
                "shadow_telemetry",
                "capability_governance",
                "team_shareable_knowledge",
              ],
            },
          },
        },
      });

      expect(preview.allowedPushScopes).toEqual([
        "shareable_derived",
        "capability_governance",
      ]);
      expect(preview.pushedEnvelopeKeys).toEqual([
        "runtimeManifest",
        "shareableReviews",
        "shareableMemories",
        "capabilityGovernance",
      ]);
      expect(preview.envelopeCounts.strategyDigest).toBe(0);
      expect(preview.envelopeCounts.newsDigest).toBe(0);
      expect(preview.envelopeCounts.shadowTelemetry).toBe(0);
      expect(preview.envelopeCounts.teamKnowledge).toBe(0);
      expect(preview.suppressedPushScopes.map((entry) => entry.scope)).toEqual(
        expect.arrayContaining(["strategy_digest", "news_digest"]),
      );
      expect(
        preview.suppressedPushScopes.find((entry) => entry.scope === "strategy_digest"),
      ).toMatchObject({
        envelopeCount: 1,
        envelopeKinds: ["strategy-digest"],
      });
    });
  });

  it("surfaces remote configuration issues while still building the local preview batch", async () => {
    await withTempRoot("openclaw-runtime-federation-preview-disabled-", async (_root, env) => {
      const now = 1_700_000_696_100;

      const preview = previewRuntimeFederationRemote({
        env,
        now,
        config: {
          federation: {
            enabled: false,
          },
        },
      });

      expect(preview.ready).toBe(false);
      expect(preview.issue).toBe("federation remote sync is disabled");
      expect(preview.pushUrl).toBeNull();
      expect(preview.pullUrl).toBeNull();
      expect(preview.pushedEnvelopeKeys).toContain("runtimeManifest");
      expect(preview.envelopeCounts.runtimeManifest).toBe(1);
      expect(preview.pendingOutboxEventCount).toBeGreaterThanOrEqual(1);
    });
  });

  it("pushes local envelopes and pulls remote packages through outbound-only sync", async () => {
    await withTempRoot("openclaw-runtime-federation-remote-", async (_root, env) => {
      const now = 1_700_000_700_100;
      const observed: {
        pushBody?: unknown;
        pushBodies: unknown[];
        pullBody?: unknown;
        authHeaders: string[];
      } = {
        pushBodies: [],
        authHeaders: [],
      };

      const server = http.createServer(async (req, res) => {
        observed.authHeaders.push(String(req.headers.authorization ?? ""));
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        if (req.url === "/runtime/outbox") {
          observed.pushBody = await readRequestBody(req);
          observed.pushBodies.push(observed.pushBody);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/runtime/inbox") {
          observed.pullBody = await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              schemaVersion: "v1",
              packages: [
                {
                  schemaVersion: "v1",
                  type: "team-knowledge-package",
                  sourceRuntimeId: "brain-os-runtime",
                  generatedAt: 1_700_000_700_000,
                  payload: {
                    records: [
                      {
                        id: "team-knowledge-remote-1",
                        namespace: "team-shareable",
                        title: "Refund playbook",
                        summary: "Escalate high-value refunds before approval.",
                        tags: ["finance", "support"],
                        createdAt: 1_700_000_690_000,
                        updatedAt: 1_700_000_690_100,
                      },
                    ],
                  },
                },
              ],
              assignments: [
                {
                  id: "assignment-remote-1",
                  title: "Review the remote follow-up",
                  summary: "Persist this assignment into the authoritative local inbox.",
                  sourceRuntimeId: "brain-os-runtime",
                  sourcePackageId: "pkg-assignment-remote",
                  sourceTaskId: "remote-task-remote-1",
                  route: "sales",
                  worker: "closer",
                },
              ],
            }),
          );
          return;
        }
        res.writeHead(404).end();
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;

      try {
        const task = {
          id: "task-remote-shareable",
          title: "Publish shareable runtime artifacts",
          route: "ops",
          status: "completed" as const,
          priority: "normal" as const,
          budgetMode: "balanced" as const,
          retrievalMode: "light" as const,
          worker: "main",
          skillIds: ["sync-runtime"],
          memoryRefs: [],
          artifactRefs: [],
          recurring: false,
          maintenance: false,
          createdAt: now,
          updatedAt: now,
        };
        const review = {
          id: "review-remote-shareable",
          taskId: task.id,
          runId: "run-remote-shareable",
          summary: "Remote sync can export shareable reviews and formal memory envelopes.",
          outcome: "success" as const,
          extractedMemoryIds: [],
          strategyCandidateIds: [],
          createdAt: now,
        };
        distillTaskOutcomeToMemory(
          {
            task,
            review,
            now,
          },
          { env, now },
        );
        const taskStore = loadRuntimeTaskStore({ env, now });
        taskStore.tasks = [task];
        taskStore.reviews = [review];
        saveRuntimeTaskStore(taskStore, { env, now });

        const result = await syncRuntimeFederationRemote({
          env,
          now,
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
              push: {
                allowedScopes: [
                  "shareable_derived",
                  "strategy_digest",
                  "news_digest",
                  "shadow_telemetry",
                  "capability_governance",
                  "team_shareable_knowledge",
                ],
              },
            },
          },
        });

        expect(result.pushUrl).toBe(`${baseUrl}/outbox`);
        expect(result.pullUrl).toBe(`${baseUrl}/inbox`);
        expect(result.pushedEnvelopeKeys).toEqual([
          "runtimeManifest",
          "shareableReviews",
          "shareableMemories",
          "strategyDigest",
          "newsDigest",
          "shadowTelemetry",
          "capabilityGovernance",
          "teamKnowledge",
        ]);
        expect(result.pulledPackageCount).toBe(1);
        expect(result.pulledAssignmentCount).toBe(1);
        expect(observed.authHeaders).toEqual(["Bearer brain-token", "Bearer brain-token"]);
        expect(observed.pushBody).toMatchObject({
          schemaVersion: "v1",
          type: "runtime-outbox-batch",
          envelopes: {
            runtimeManifest: {
              type: "runtime-manifest",
            },
            newsDigest: {
              type: "news-digest",
            },
            teamKnowledge: {
              type: "team-knowledge",
            },
          },
        });
        const pushBody = observed.pushBody as {
          events?: Array<{ id?: string; envelopeKey?: string; operation?: string }>;
          cursor?: {
            lastOutboxEventId?: string;
          };
          envelopes?: {
            shareableReviews?: Array<{ shareScope?: string }>;
            shareableMemories?: Array<{ shareScope?: string }>;
          };
        };
        expect(pushBody.cursor?.lastOutboxEventId).toBeUndefined();
        expect((pushBody.events ?? []).length).toBeGreaterThan(0);
        expect(pushBody.events?.every((entry) => entry.operation === "upsert")).toBe(true);
        expect(pushBody.envelopes?.shareableReviews).toHaveLength(1);
        expect(pushBody.envelopes?.shareableReviews?.[0]?.shareScope).toBe("shareable_derived");
        expect((pushBody.envelopes?.shareableMemories ?? []).length).toBeGreaterThan(0);
        expect(
          pushBody.envelopes?.shareableMemories?.every(
            (entry) => entry.shareScope === "shareable_derived",
          ),
        ).toBe(true);
        expect(observed.pullBody).toMatchObject({
          schemaVersion: "v1",
          type: "runtime-inbox-pull",
        });

        const federationStore = loadRuntimeFederationStore({
          env,
          now,
        });
        const assignments = listRuntimeFederationAssignments({
          env,
          now,
        });
        const federationSnapshot = buildFederationRuntimeSnapshot({
          env,
          now,
        });
        expect(federationStore.inbox).toHaveLength(1);
        expect(federationStore.inbox[0]?.packageType).toBe("team-knowledge-package");
        expect(federationStore.syncCursor?.lastPushedAt).toBe(now);
        expect(federationStore.syncCursor?.lastPulledAt).toBe(now);
        expect(federationStore.syncCursor?.lastOutboxEventId).toBe(result.outboxSync.latestOutboxEventId);
        expect(federationStore.syncCursor?.metadata?.pendingOutboxEventCount).toBe(0);
        expect(federationStore.syncCursor?.metadata?.localOutboxHeadEventId).toBe(
          result.outboxSync.latestOutboxEventId,
        );
        expect(federationStore.syncCursor?.metadata?.lastRemotePullAssignmentCount).toBe(1);
        expect(federationStore.teamKnowledge).toEqual([]);
        expect(assignments).toHaveLength(1);
        expect(assignments[0]).toMatchObject({
          id: "assignment-remote-1",
          sourceRuntimeId: "brain-os-runtime",
          sourcePackageId: "pkg-assignment-remote",
          sourceTaskId: "remote-task-remote-1",
          route: "sales",
          worker: "closer",
          state: "pending",
        });
        expect(federationSnapshot.assignmentInbox.total).toBe(1);
        expect(federationSnapshot.assignmentInbox.stateCounts.pending).toBe(1);
        expect(federationSnapshot.assignmentInbox.latestAssignments[0]).toMatchObject({
          id: "assignment-remote-1",
          state: "pending",
          availableActions: ["materialize", "block"],
        });
        expect(federationSnapshot.latestSyncAttempts[0]).toMatchObject({
          status: "success",
          stage: "sync_inbox",
          pulledPackageCount: 1,
        });
        expect(federationSnapshot.latestSyncAttempts[0]?.metadata).toMatchObject({
          acknowledgedOutboxEventId: result.outboxSync.latestOutboxEventId,
          pulledAssignmentCount: 1,
        });

        const secondResult = await syncRuntimeFederationRemote({
          env,
          now: now + 5_000,
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
              push: {
                allowedScopes: [
                  "shareable_derived",
                  "strategy_digest",
                  "news_digest",
                  "shadow_telemetry",
                  "capability_governance",
                  "team_shareable_knowledge",
                ],
              },
            },
          },
        });
        expect(secondResult.outboxSync.pendingOutboxEventCount).toBe(0);
        expect(observed.pushBodies).toHaveLength(2);
        const secondPushBody = observed.pushBodies[1] as {
          cursor?: { lastOutboxEventId?: string };
          events?: unknown[];
        };
        expect(secondPushBody.cursor?.lastOutboxEventId).toBe(result.outboxSync.latestOutboxEventId);
        expect(secondPushBody.events).toEqual([]);
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });

  it("records failed remote sync attempts without losing local federation state", async () => {
    await withTempRoot("openclaw-runtime-federation-remote-failure-", async (_root, env) => {
      const now = 1_700_000_710_100;
      const server = http.createServer((_req, res) => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "temporarily unavailable" }));
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;

      try {
        await expect(
          syncRuntimeFederationRemote({
            env,
            now,
            config: {
              federation: {
                remote: {
                  enabled: true,
                  url: baseUrl,
                  token: "brain-token",
                  allowPrivateNetwork: true,
                },
              },
            },
          }),
        ).rejects.toThrow("federation remote sync failed with status 503");

        const federationStore = loadRuntimeFederationStore({
          env,
          now,
        });
        const federationSnapshot = buildFederationRuntimeSnapshot({
          env,
          now,
        });
        expect(federationStore.inbox).toHaveLength(0);
        expect(federationSnapshot.latestSyncAttempts[0]).toMatchObject({
          status: "failed",
          stage: "push",
          retryable: true,
          error: "federation remote sync failed with status 503",
        });
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });

  it("records scheduled remote sync maintenance metadata after a successful managed sync", async () => {
    await withTempRoot("openclaw-runtime-federation-remote-maintenance-success-", async (_root, env) => {
      const now = 1_700_000_711_100;
      const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        await readRequestBody(req);
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/runtime/inbox") {
          res.end(JSON.stringify({ schemaVersion: "v1", packages: [], assignments: [] }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;

      try {
        configureRuntimeFederationRemoteSyncMaintenance(
          {
            enabled: true,
            syncIntervalMinutes: 90,
            retryAfterFailureMinutes: 20,
          },
          { env, now: now - 1_000 },
        );

        await syncRuntimeFederationRemote({
          env,
          now,
          trigger: "scheduled",
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
            },
          },
        });

        const federationStore = loadRuntimeFederationStore({ env, now });
        const controls = readFederationRemoteSyncMaintenanceControls(federationStore.metadata);
        const snapshot = buildFederationRuntimeSnapshot({
          env,
          now,
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
            },
          },
        });

        expect(controls).toMatchObject({
          enabled: true,
          syncIntervalMinutes: 90,
          retryAfterFailureMinutes: 20,
          lastAutoSyncAttemptAt: now,
          lastAutoSyncStatus: "success",
          lastAutoSyncSucceededAt: now,
        });
        expect(snapshot.remoteMaintenance).toMatchObject({
          enabled: true,
          due: false,
          lastAttemptAt: now,
          lastAttemptStatus: "success",
          lastSuccessfulSyncAt: now,
          nextSyncAt: now + 90 * 60 * 1000,
        });
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });

  it("does not mark manual remote sync as an auto-maintenance attempt", async () => {
    await withTempRoot("openclaw-runtime-federation-remote-maintenance-manual-", async (_root, env) => {
      const now = 1_700_000_712_100;
      const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        await readRequestBody(req);
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/runtime/inbox") {
          res.end(JSON.stringify({ schemaVersion: "v1", packages: [], assignments: [] }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;

      try {
        configureRuntimeFederationRemoteSyncMaintenance(
          {
            enabled: true,
            syncIntervalMinutes: 60,
            retryAfterFailureMinutes: 15,
          },
          { env, now: now - 1_000 },
        );

        await syncRuntimeFederationRemote({
          env,
          now,
          trigger: "manual",
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
            },
          },
        });

        const federationStore = loadRuntimeFederationStore({ env, now });
        const controls = readFederationRemoteSyncMaintenanceControls(federationStore.metadata);

        expect(controls.lastAutoSyncAttemptAt).toBeUndefined();
        expect(controls.lastAutoSyncStatus).toBeUndefined();
        expect(controls.lastAutoSyncSucceededAt).toBeUndefined();
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });

  it("keeps remote packages with blocked scope in the inbox validation path without adopting them", async () => {
    await withTempRoot("openclaw-runtime-federation-remote-invalid-package-", async (_root, env) => {
      const now = 1_700_000_720_100;
      const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        if (req.url === "/runtime/outbox") {
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/runtime/inbox") {
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              schemaVersion: "v1",
              packages: [
                {
                  schemaVersion: "v1",
                  type: "team-knowledge-package",
                  sourceRuntimeId: "brain-os-runtime",
                  generatedAt: 1_700_000_720_000,
                  payload: {
                    records: [
                      {
                        id: "team-knowledge-private-1",
                        namespace: "private",
                        title: "Private note should not import",
                        summary: "This record must stay outside the local shareable namespace.",
                        tags: ["private"],
                        createdAt: 1_700_000_719_000,
                        updatedAt: 1_700_000_719_100,
                      },
                    ],
                  },
                },
              ],
            }),
          );
          return;
        }
        res.writeHead(404).end();
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;

      try {
        const result = await syncRuntimeFederationRemote({
          env,
          now,
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
              push: {
                allowedScopes: ["team_shareable_knowledge"],
              },
            },
          },
        });

        const federationStore = loadRuntimeFederationStore({
          env,
          now,
        });
        const snapshot = buildFederationRuntimeSnapshot({
          env,
          now,
        });

        expect(result.pulledPackageCount).toBe(1);
        expect(federationStore.inbox).toHaveLength(1);
        expect(federationStore.inbox[0]?.packageType).toBe("team-knowledge-package");
        expect(federationStore.inbox[0]?.state).toBe("received");
        expect(federationStore.inbox[0]?.validationErrors).toContain(
          "payload.records[0].namespace must be team-shareable",
        );
        expect(federationStore.teamKnowledge).toEqual([]);
        expect(snapshot.inbox.latestPackages[0]).toMatchObject({
          packageType: "team-knowledge-package",
          validationErrorCount: 1,
          validationErrors: ["payload.records[0].namespace must be team-shareable"],
        });
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });

  it("persists malformed remote packages as invalid inbox records instead of failing managed sync", async () => {
    await withTempRoot("openclaw-runtime-federation-remote-malformed-package-", async (_root, env) => {
      const now = 1_700_000_721_100;
      const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        if (req.url === "/runtime/outbox") {
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/runtime/inbox") {
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              schemaVersion: "v1",
              packages: [
                {
                  schemaVersion: "v1",
                  sourceRuntimeId: "brain-os-runtime",
                  generatedAt: 1_700_000_721_000,
                  payload: {
                    records: [],
                  },
                },
              ],
            }),
          );
          return;
        }
        res.writeHead(404).end();
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;

      try {
        const result = await syncRuntimeFederationRemote({
          env,
          now,
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
              push: {
                allowedScopes: ["team_shareable_knowledge"],
              },
            },
          },
        });

        const federationStore = loadRuntimeFederationStore({
          env,
          now,
        });
        const snapshot = buildFederationRuntimeSnapshot({
          env,
          now,
        });

        expect(result.pulledPackageCount).toBe(1);
        expect(federationStore.inbox).toHaveLength(1);
        expect(federationStore.inbox[0]).toMatchObject({
          packageType: "invalid-package",
          state: "received",
          sourceRuntimeId: "brain-os-runtime",
        });
        expect(federationStore.inbox[0]?.validationErrors).toContain("type must be a non-empty string");
        expect(snapshot.inbox.latestPackages[0]).toMatchObject({
          packageType: "invalid-package",
          validationErrorCount: 1,
          localLandingLabel: "invalid-package",
        });
        expect(snapshot.inbox.latestPackages[0]?.payloadPreview).toEqual(
          expect.arrayContaining(["type must be a non-empty string"]),
        );
        expect(snapshot.latestSyncAttempts[0]).toMatchObject({
          status: "success",
          stage: "sync_inbox",
          pulledPackageCount: 1,
          inboxProcessedCount: 1,
        });
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });
});
