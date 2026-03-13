import { loadConfig } from "../../config/config.js";
import {
  applyLegacyRuntimeImport,
  buildFederationRuntimeSnapshot,
  buildRuntimeCapabilitiesStatus,
  buildRuntimeDashboardSnapshot,
  buildRuntimeEvolutionStatus,
  buildRuntimeIntelStatus,
  buildRuntimeMemoryList,
  buildRuntimeRetrievalStatus,
  buildRuntimeTasksList,
} from "../../shared/runtime/runtime-dashboard.js";
import type { GatewayRequestHandlers } from "./types.js";

function loadConfigSafe(): Record<string, unknown> | null {
  try {
    return loadConfig() as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const runtimeHandlers: GatewayRequestHandlers = {
  "runtime.snapshot": async ({ respond }) => {
    respond(true, buildRuntimeDashboardSnapshot({ config: loadConfigSafe() }), undefined);
  },
  "runtime.tasks.list": async ({ respond }) => {
    respond(true, buildRuntimeTasksList(), undefined);
  },
  "runtime.memory.list": async ({ respond }) => {
    respond(true, buildRuntimeMemoryList(), undefined);
  },
  "runtime.retrieval.status": async ({ respond }) => {
    respond(true, buildRuntimeRetrievalStatus(), undefined);
  },
  "runtime.intel.status": async ({ respond }) => {
    respond(true, buildRuntimeIntelStatus(), undefined);
  },
  "runtime.capabilities.status": async ({ respond }) => {
    respond(true, buildRuntimeCapabilitiesStatus({ config: loadConfigSafe() }), undefined);
  },
  "runtime.evolution.status": async ({ respond }) => {
    respond(true, buildRuntimeEvolutionStatus(), undefined);
  },
  "runtime.import.preview": async ({ respond }) => {
    respond(
      true,
      buildRuntimeDashboardSnapshot({ config: loadConfigSafe() }).importPreview,
      undefined,
    );
  },
  "runtime.import.apply": async ({ respond }) => {
    respond(true, applyLegacyRuntimeImport({ config: loadConfigSafe() }), undefined);
  },
  "federation.status": async ({ respond }) => {
    const config = loadConfigSafe();
    const dashboard = buildRuntimeDashboardSnapshot({ config });
    respond(
      true,
      buildFederationRuntimeSnapshot({
        config,
        runtimeManifest: dashboard.runtimeManifest,
      }),
      undefined,
    );
  },
};
