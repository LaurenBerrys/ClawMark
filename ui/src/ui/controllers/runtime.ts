import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  FederationRuntimeSnapshot,
  LegacyRuntimeImportApplyResult,
  LegacyRuntimeImportReport,
  RuntimeDashboardSnapshot,
} from "../types.ts";

export type RuntimeState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  runtimeLoading: boolean;
  runtimeError: string | null;
  runtimeSnapshot: RuntimeDashboardSnapshot | null;
  runtimeImportPreview: LegacyRuntimeImportReport | null;
  runtimeImportBusy: boolean;
  runtimeImportApplyResult: LegacyRuntimeImportApplyResult | null;
  federationLoading: boolean;
  federationError: string | null;
  federationStatus: FederationRuntimeSnapshot | null;
};

export async function loadRuntime(state: RuntimeState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.runtimeLoading = true;
  state.federationLoading = true;
  state.runtimeError = null;
  state.federationError = null;
  try {
    const [snapshotRes, previewRes, federationRes] = await Promise.allSettled([
      state.client.request("runtime.snapshot", {}),
      state.client.request("runtime.import.preview", {}),
      state.client.request("federation.status", {}),
    ]);

    if (snapshotRes.status === "fulfilled") {
      state.runtimeSnapshot = snapshotRes.value as RuntimeDashboardSnapshot;
    } else {
      state.runtimeError = String(snapshotRes.reason);
    }

    if (previewRes.status === "fulfilled") {
      state.runtimeImportPreview = previewRes.value as LegacyRuntimeImportReport;
    } else if (!state.runtimeImportPreview && state.runtimeSnapshot) {
      state.runtimeImportPreview = state.runtimeSnapshot.importPreview;
    } else if (!state.runtimeError) {
      state.runtimeError = String(previewRes.reason);
    }

    if (federationRes.status === "fulfilled") {
      state.federationStatus = federationRes.value as FederationRuntimeSnapshot;
    } else if (!state.federationStatus && state.runtimeSnapshot) {
      state.federationStatus = state.runtimeSnapshot.federation;
    } else {
      state.federationError = String(federationRes.reason);
    }
  } finally {
    state.runtimeLoading = false;
    state.federationLoading = false;
  }
}

export async function applyRuntimeLegacyImport(state: RuntimeState) {
  if (!state.client || !state.connected || state.runtimeImportBusy) {
    return;
  }
  state.runtimeImportBusy = true;
  state.runtimeError = null;
  try {
    const result = await state.client.request("runtime.import.apply", {});
    state.runtimeImportApplyResult = result as LegacyRuntimeImportApplyResult;
    await loadRuntime(state);
  } catch (error) {
    state.runtimeError = String(error);
  } finally {
    state.runtimeImportBusy = false;
  }
}

export async function syncRuntimeFederationRemote(state: RuntimeState) {
  if (!state.client || !state.connected || state.federationLoading) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request("federation.remote.sync", {});
    await loadRuntime(state);
  } catch (error) {
    state.federationError = String(error);
  } finally {
    state.federationLoading = false;
  }
}
