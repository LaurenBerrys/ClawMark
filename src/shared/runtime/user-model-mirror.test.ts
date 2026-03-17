import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRuntimeDashboardSnapshot } from "./runtime-dashboard.js";
import {
  buildRuntimeUserModelMirrorStatus,
  markRuntimeUserModelMirrorImported,
  readRuntimeUserModelMirrorImport,
  syncRuntimeUserModelMirror,
} from "./user-model-mirror.js";
import { getRuntimeUserModel, updateRuntimeUserModel } from "./user-console.js";

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

describe("runtime user model mirror", () => {
  it("writes USER.md and surfaces mirror status in the runtime dashboard", async () => {
    await withTempRoot("openclaw-runtime-user-mirror-", async (_root, env) => {
      const now = 1_705_000_000_000;
      updateRuntimeUserModel(
        {
          displayName: "Lauren",
          communicationStyle: "direct and concise",
          interruptionThreshold: "low",
          reportVerbosity: "brief",
          confirmationBoundary: "balanced",
          reportPolicy: "reply",
        },
        { env, now },
      );

      const sync = syncRuntimeUserModelMirror({}, { env, now: now + 10 });
      const file = await fs.readFile(sync.path, "utf8");
      const dashboard = buildRuntimeDashboardSnapshot({ env, now: now + 20 });

      expect(sync.skipped).toBe(false);
      expect(file).toContain("# USER.md");
      expect(file).toContain("Lauren");
      expect(file).toContain("OPENCLAW_RUNTIME_USER_MODEL_JSON_START");
      expect(dashboard.userConsole.mirror).toMatchObject({
        path: sync.path,
        exists: true,
        pendingImport: false,
      });
      expect(dashboard.userConsole.mirror.lastSyncedAt).toBe(now + 10);
    });
  });

  it("refuses to overwrite pending manual edits unless forced", async () => {
    await withTempRoot("openclaw-runtime-user-mirror-pending-", async (_root, env) => {
      const now = 1_705_000_100_000;
      updateRuntimeUserModel(
        {
          displayName: "Lauren",
          communicationStyle: "balanced",
          reportPolicy: "reply",
        },
        { env, now },
      );

      const firstSync = syncRuntimeUserModelMirror({}, { env, now: now + 10 });
      const original = await fs.readFile(firstSync.path, "utf8");
      const edited = original.replace('"reportPolicy": "reply"', '"reportPolicy": "silent"');
      await fs.writeFile(firstSync.path, edited, "utf8");

      const status = buildRuntimeUserModelMirrorStatus({ env, now: now + 20 });
      const blockedSync = syncRuntimeUserModelMirror({}, { env, now: now + 30 });
      const forcedSync = syncRuntimeUserModelMirror({ force: true }, { env, now: now + 40 });
      const rewritten = await fs.readFile(firstSync.path, "utf8");

      expect(status.pendingImport).toBe(true);
      expect(blockedSync).toMatchObject({
        skipped: true,
        reason: "pending_external_edits",
        pendingImport: true,
      });
      expect(forcedSync.skipped).toBe(false);
      expect(rewritten).toContain('"reportPolicy": "reply"');
    });
  });

  it("imports USER.md edits back into the authoritative runtime user model", async () => {
    await withTempRoot("openclaw-runtime-user-mirror-import-", async (_root, env) => {
      const now = 1_705_000_200_000;
      updateRuntimeUserModel(
        {
          displayName: "Lauren",
          communicationStyle: "steady",
          interruptionThreshold: "medium",
          reportVerbosity: "balanced",
          confirmationBoundary: "balanced",
          reportPolicy: "reply",
        },
        { env, now },
      );
      const sync = syncRuntimeUserModelMirror({}, { env, now: now + 10 });
      const current = await fs.readFile(sync.path, "utf8");
      const edited = current
        .replace('"communicationStyle": "steady"', '"communicationStyle": "very concise"')
        .replace('"interruptionThreshold": "medium"', '"interruptionThreshold": "high"')
        .replace('"reportPolicy": "reply"', '"reportPolicy": "reply_and_proactive"');
      await fs.writeFile(sync.path, edited, "utf8");

      const imported = readRuntimeUserModelMirrorImport({ env, now: now + 20 });
      updateRuntimeUserModel(imported.patch, { env, now: now + 30 });
      markRuntimeUserModelMirrorImported(
        {
          lastModifiedAt: imported.lastModifiedAt,
        },
        { env, now: now + 40 },
      );
      syncRuntimeUserModelMirror({ force: true }, { env, now: now + 50 });

      const userModel = getRuntimeUserModel({ env, now: now + 60 });
      const dashboard = buildRuntimeDashboardSnapshot({ env, now: now + 60 });

      expect(imported.patch).toMatchObject({
        communicationStyle: "very concise",
        interruptionThreshold: "high",
        reportPolicy: "reply_and_proactive",
      });
      expect(userModel).toMatchObject({
        communicationStyle: "very concise",
        interruptionThreshold: "high",
        reportPolicy: "reply_and_proactive",
      });
      expect(dashboard.userConsole.mirror.pendingImport).toBe(false);
      expect(dashboard.userConsole.mirror.lastImportedAt).toBe(now + 40);
    });
  });
});
