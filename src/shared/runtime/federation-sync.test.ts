import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncRuntimeFederationRemote } from "./federation-sync.js";
import { loadRuntimeFederationStore } from "./store.js";

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
  it("pushes local envelopes and pulls remote packages through outbound-only sync", async () => {
    await withTempRoot("openclaw-runtime-federation-remote-", async (_root, env) => {
      const observed: {
        pushBody?: unknown;
        pullBody?: unknown;
        authHeaders: string[];
      } = {
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
          now: 1_700_000_700_100,
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
                ],
              },
            },
          },
        });

        expect(result.pushUrl).toBe(`${baseUrl}/outbox`);
        expect(result.pullUrl).toBe(`${baseUrl}/inbox`);
        expect(result.pushedEnvelopeKeys).toEqual([
          "runtimeManifest",
          "strategyDigest",
          "newsDigest",
          "shadowTelemetry",
          "capabilityGovernance",
        ]);
        expect(result.pulledPackageCount).toBe(1);
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
          },
        });
        expect(observed.pullBody).toMatchObject({
          schemaVersion: "v1",
          type: "runtime-inbox-pull",
        });

        const federationStore = loadRuntimeFederationStore({
          env,
          now: 1_700_000_700_100,
        });
        expect(federationStore.inbox).toHaveLength(1);
        expect(federationStore.inbox[0]?.packageType).toBe("team-knowledge-package");
        expect(federationStore.syncCursor?.lastPushedAt).toBe(1_700_000_700_100);
        expect(federationStore.syncCursor?.lastPulledAt).toBe(1_700_000_700_100);
        expect(federationStore.teamKnowledge).toEqual([]);
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });
});
