import type {
  IntelDeliveryKind,
  IntelDeliveryRecord,
  IntelDeliveryTarget,
  IntelDeliveryTargetKind,
  IntelDigestItem,
  RuntimeIntelStore,
  RuntimeMetadata,
} from "./contracts.js";
import type { IntelDomain } from "./intel-pipeline.js";
import { normalizeRuntimeInfoDomain } from "./intel-domains.js";
import { resolveRuntimeIntelPanelConfig } from "./intel-refresh.js";
import {
  appendRuntimeEvent,
  loadRuntimeIntelStore,
  loadRuntimeUserConsoleStore,
  saveRuntimeIntelStore,
  type RuntimeStoreOptions,
} from "./store.js";
import { listRuntimeResolvedSurfaceProfiles } from "./user-console.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const INSTANT_ALERT_WINDOW_MS = 2 * DAY_MS;
const DELIVERY_LOG_RETENTION_MS = 30 * DAY_MS;
const DELIVERY_LOG_LIMIT = 400;

type RuntimeIntelDeliveryLogEntry = IntelDeliveryRecord;

export type RuntimeIntelDeliveryKind = IntelDeliveryKind;

export type RuntimeIntelDeliveryItem = {
  id: string;
  kind: IntelDeliveryKind;
  digestItemId: string;
  domain: IntelDomain;
  title: string;
  summary: string;
  score: number;
  exploit: boolean;
  sourceIds: string[];
  createdAt: number;
  targets: IntelDeliveryTarget[];
  url?: string;
};

export type RuntimeIntelResolvedDeliveryTargets = {
  availableTargets: IntelDeliveryTarget[];
  dailyTargets: IntelDeliveryTarget[];
  instantTargets: IntelDeliveryTarget[];
  staleDailyTargetIds: string[];
  staleInstantTargetIds: string[];
};

export type RuntimeIntelDeliveryPreview = {
  generatedAt: number;
  dailyDigestDue: boolean;
  dailyDigestCount: number;
  instantAlertCount: number;
  nextDailyPushAt: number | null;
  lastDailyPushAt: number | null;
  lastInstantPushAt: number | null;
  items: RuntimeIntelDeliveryItem[];
};

export type RuntimeIntelDeliveryDispatchResult = {
  dispatchedAt: number;
  deliveredCount: number;
  dailyDigestCount: number;
  instantAlertCount: number;
  deliveredItems: RuntimeIntelDeliveryItem[];
  deliveryRecords: IntelDeliveryRecord[];
  preview: RuntimeIntelDeliveryPreview;
  lastDailyPushAt: number | null;
  lastInstantPushAt: number | null;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function clampPercent(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 1) {
    return Math.max(0, Math.min(100, Math.round(value * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(text);
  }
  return output;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildStableId(prefix: string, parts: Array<string | number | null | undefined>): string {
  const seed = parts
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join("|");
  return `${prefix}_${hashText(seed || prefix)}`;
}

function normalizeDeliveryTargetKind(value: unknown, targetId?: string): IntelDeliveryTargetKind {
  if (value === "runtime_user" || value === "agent" || value === "surface") {
    return value;
  }
  const normalizedTargetId = normalizeText(targetId).toLowerCase();
  if (normalizedTargetId.startsWith("agent:")) {
    return "agent";
  }
  if (normalizedTargetId.startsWith("surface:")) {
    return "surface";
  }
  return "runtime_user";
}

function buildRuntimeUserTarget(): IntelDeliveryTarget {
  return {
    id: "runtime-user",
    kind: "runtime_user",
    label: "User 控制台",
    active: true,
    metadata: {
      scope: "runtime-user",
    },
  };
}

export function listRuntimeIntelDeliveryTargets(
  opts: RuntimeStoreOptions = {},
): IntelDeliveryTarget[] {
  const now = resolveNow(opts.now);
  const userConsoleStore = loadRuntimeUserConsoleStore({
    ...opts,
    now,
  });
  const runtimeUserTarget = buildRuntimeUserTarget();
  const agentTargets = [...userConsoleStore.agents]
    .filter((agent) => agent.active)
    .map((agent) => ({
      id: `agent:${agent.id}`,
      kind: "agent" as const,
      label: agent.name,
      active: agent.active,
      metadata: {
        agentId: agent.id,
        roleBase: agent.roleBase,
      },
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  const surfaceTargets = listRuntimeResolvedSurfaceProfiles({
    ...opts,
    now,
  })
    .filter((profile) => profile.surface.active)
    .map((profile) => ({
      id: `surface:${profile.surface.id}`,
      kind: "surface" as const,
      label: profile.surface.label,
      active: profile.surface.active,
      channel: profile.surface.channel,
      ownerLabel: profile.ownerLabel,
      metadata: {
        surfaceId: profile.surface.id,
        channel: profile.surface.channel,
        accountId: profile.surface.accountId,
        ownerKind: profile.surface.ownerKind,
        effectiveRole: profile.effectiveRole,
      },
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  return [runtimeUserTarget, ...agentTargets, ...surfaceTargets];
}

export function resolveRuntimeIntelDeliveryTargets(
  store: RuntimeIntelStore,
  opts: RuntimeStoreOptions = {},
): RuntimeIntelResolvedDeliveryTargets {
  const availableTargets = listRuntimeIntelDeliveryTargets(opts);
  const availableById = new Map(
    availableTargets.map((target) => [target.id.toLowerCase(), target]),
  );
  const config = resolveRuntimeIntelPanelConfig(store);

  const resolveSelected = (targetIds: string[]) => {
    const resolved: IntelDeliveryTarget[] = [];
    const staleTargetIds: string[] = [];
    for (const targetId of uniqueStrings(targetIds)) {
      const match = availableById.get(targetId.toLowerCase());
      if (match) {
        resolved.push(match);
      } else {
        staleTargetIds.push(targetId);
      }
    }
    if (resolved.length === 0) {
      const fallback = availableById.get("runtime-user");
      if (fallback) {
        resolved.push(fallback);
      }
    }
    return {
      targets: resolved,
      staleTargetIds,
    };
  };

  const daily = resolveSelected(config.dailyPushTargetIds);
  const instant = resolveSelected(config.instantPushTargetIds);
  return {
    availableTargets,
    dailyTargets: daily.targets,
    instantTargets: instant.targets,
    staleDailyTargetIds: daily.staleTargetIds,
    staleInstantTargetIds: instant.staleTargetIds,
  };
}

function readRuntimeIntelDeliveryLog(
  metadata: RuntimeMetadata | undefined,
  now: number,
): RuntimeIntelDeliveryLogEntry[] {
  const rawEntries = toArray<Record<string, unknown>>(metadata?.deliveryLog);
  return rawEntries
    .map<RuntimeIntelDeliveryLogEntry | null>((entry) => {
      const kind: IntelDeliveryKind = entry.kind === "daily_digest" ? "daily_digest" : "instant_alert";
      const domain = normalizeRuntimeInfoDomain(entry.domain);
      const digestItemId = normalizeText(entry.digestItemId);
      const deliveredAt = toNumber(entry.deliveredAt);
      const title = normalizeText(entry.title);
      const targetId = normalizeText(entry.targetId) || "runtime-user";
      const targetKind = normalizeDeliveryTargetKind(entry.targetKind, targetId);
      const targetLabel =
        normalizeText(entry.targetLabel) ||
        (targetKind === "runtime_user" ? "User 控制台" : targetId);
      if (!digestItemId || !Number.isFinite(deliveredAt) || deliveredAt <= 0) {
        return null;
      }
      const nextEntry: RuntimeIntelDeliveryLogEntry = {
        id:
          normalizeText(entry.id) ||
          buildStableId("runtime_intel_delivery", [kind, targetId, digestItemId, deliveredAt]),
        kind,
        digestItemId,
        targetId,
        targetKind,
        targetLabel,
        deliveredAt,
        domain,
        title,
        metadata: toRecord(entry.metadata),
      };
      return nextEntry;
    })
    .filter((entry): entry is RuntimeIntelDeliveryLogEntry => entry !== null)
    .filter((entry) => now - entry.deliveredAt <= DELIVERY_LOG_RETENTION_MS)
    .toSorted((left, right) => right.deliveredAt - left.deliveredAt)
    .slice(0, DELIVERY_LOG_LIMIT);
}

function writeRuntimeIntelDeliveryLog(
  metadata: RuntimeMetadata | undefined,
  entries: RuntimeIntelDeliveryLogEntry[],
): RuntimeMetadata {
  return {
    ...metadata,
    deliveryLog: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      digestItemId: entry.digestItemId,
      targetId: entry.targetId,
      targetKind: entry.targetKind,
      targetLabel: entry.targetLabel,
      deliveredAt: entry.deliveredAt,
      domain: entry.domain,
      title: entry.title,
      metadata: entry.metadata,
    })),
  };
}

export function listRuntimeIntelDeliveryHistory(
  opts: RuntimeStoreOptions = {},
  limit = 20,
): IntelDeliveryRecord[] {
  const now = resolveNow(opts.now);
  const store = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  return readRuntimeIntelDeliveryLog(store.metadata, now).slice(0, Math.max(0, limit));
}

function readDeliveryTimestamp(
  metadata: RuntimeMetadata | undefined,
  key: "lastDailyPushAt" | "lastInstantPushAt",
): number | null {
  const value = toNumber(metadata?.[key]);
  return value > 0 ? value : null;
}

function resolveDailySchedule(now: number, hour: number, minute: number) {
  const scheduled = new Date(now);
  scheduled.setHours(hour, minute, 0, 0);
  const scheduledAt = scheduled.getTime();
  return {
    scheduledAt,
    nextScheduledAt: now >= scheduledAt ? scheduledAt + DAY_MS : scheduledAt,
    windowStart: scheduledAt - DAY_MS,
  };
}

function readDigestItemScore(item: IntelDigestItem): number {
  const metadata = toRecord(item.metadata);
  return clampPercent(
    toNumber(metadata?.candidateScore) ||
      toNumber(metadata?.selectionScore) ||
      (item.exploit ? 92 : 80),
    item.exploit ? 92 : 80,
  );
}

function buildDeliveryItem(
  kind: IntelDeliveryKind,
  item: IntelDigestItem,
  targets: IntelDeliveryTarget[],
): RuntimeIntelDeliveryItem {
  const metadata = toRecord(item.metadata);
  return {
    id: buildStableId("runtime_intel_delivery_item", [kind, item.id]),
    kind,
    digestItemId: item.id,
    domain: item.domain,
    title: item.title,
    summary: item.conclusion,
    score: readDigestItemScore(item),
    exploit: item.exploit,
    sourceIds: [...item.sourceIds],
    createdAt: item.createdAt,
    targets,
    url: normalizeText(metadata?.sourceUrl) || undefined,
  };
}

function previewRuntimeIntelDeliveriesFromStore(
  store: RuntimeIntelStore,
  targetResolution: RuntimeIntelResolvedDeliveryTargets,
  now: number,
): RuntimeIntelDeliveryPreview {
  const panelConfig = resolveRuntimeIntelPanelConfig(store);
  const lastDailyPushAt = readDeliveryTimestamp(store.metadata, "lastDailyPushAt");
  const lastInstantPushAt = readDeliveryTimestamp(store.metadata, "lastInstantPushAt");
  const nextDailyPushAt =
    store.enabled && store.digestEnabled && panelConfig.dailyPushEnabled
      ? resolveDailySchedule(
          now,
          panelConfig.dailyPushHourLocal,
          panelConfig.dailyPushMinuteLocal,
        ).nextScheduledAt
      : null;
  if (!store.enabled || ! store.digestEnabled) {
    return {
      generatedAt: now,
      dailyDigestDue: false,
      dailyDigestCount: 0,
      instantAlertCount: 0,
      nextDailyPushAt,
      lastDailyPushAt,
      lastInstantPushAt,
      items: [],
    };
  }

  const deliveryLog = readRuntimeIntelDeliveryLog(store.metadata, now);
  const deliveredKeys = new Set(
    deliveryLog.map((entry) => `${entry.kind}:${entry.targetId}:${entry.digestItemId}`),
  );
  const digestItems = [...store.digestItems].toSorted(
    (left, right) => right.createdAt - left.createdAt,
  );

  let dailyDigestItems: RuntimeIntelDeliveryItem[] = [];
  if (panelConfig.dailyPushEnabled) {
    const schedule = resolveDailySchedule(
      now,
      panelConfig.dailyPushHourLocal,
      panelConfig.dailyPushMinuteLocal,
    );
    const due =
      now >= schedule.scheduledAt && (!lastDailyPushAt || lastDailyPushAt < schedule.scheduledAt);
    if (due) {
      const lowerBound = Math.max(lastDailyPushAt ?? 0, schedule.windowStart);
      dailyDigestItems = digestItems
        .filter((item) => item.createdAt >= lowerBound)
        .filter((item) =>
          targetResolution.dailyTargets.some(
            (target) => !deliveredKeys.has(`daily_digest:${target.id}:${item.id}`),
          ),
        )
        .slice(0, panelConfig.dailyPushItemCount)
        .map((item) => buildDeliveryItem("daily_digest", item, targetResolution.dailyTargets));
    }
  }

  let instantAlertItems: RuntimeIntelDeliveryItem[] = [];
  if (panelConfig.instantPushEnabled) {
    const lowerBound = Math.max(lastInstantPushAt ?? 0, now - INSTANT_ALERT_WINDOW_MS);
    instantAlertItems = digestItems
      .filter((item) => item.createdAt >= lowerBound)
      .filter((item) => readDigestItemScore(item) >= panelConfig.instantPushMinScore)
      .filter((item) =>
        targetResolution.instantTargets.some(
          (target) => !deliveredKeys.has(`instant_alert:${target.id}:${item.id}`),
        ),
      )
      .map((item) => buildDeliveryItem("instant_alert", item, targetResolution.instantTargets));
  }

  const items = [...instantAlertItems, ...dailyDigestItems].toSorted(
    (left, right) =>
      right.createdAt - left.createdAt ||
      (left.kind === right.kind ? 0 : left.kind === "instant_alert" ? -1 : 1),
  );
  return {
    generatedAt: now,
    dailyDigestDue: dailyDigestItems.length > 0,
    dailyDigestCount: dailyDigestItems.length,
    instantAlertCount: instantAlertItems.length,
    nextDailyPushAt,
    lastDailyPushAt,
    lastInstantPushAt,
    items,
  };
}

export function previewRuntimeIntelDeliveries(
  opts: RuntimeStoreOptions = {},
): RuntimeIntelDeliveryPreview {
  const now = resolveNow(opts.now);
  const store = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  const targetResolution = resolveRuntimeIntelDeliveryTargets(store, {
    ...opts,
    now,
  });
  return previewRuntimeIntelDeliveriesFromStore(store, targetResolution, now);
}

export function dispatchRuntimeIntelDeliveries(
  opts: RuntimeStoreOptions = {},
): RuntimeIntelDeliveryDispatchResult {
  const now = resolveNow(opts.now);
  const store = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  const targetResolution = resolveRuntimeIntelDeliveryTargets(store, {
    ...opts,
    now,
  });
  const pending = previewRuntimeIntelDeliveriesFromStore(store, targetResolution, now);
  if (pending.items.length === 0) {
    return {
      dispatchedAt: now,
      deliveredCount: 0,
      dailyDigestCount: 0,
      instantAlertCount: 0,
      deliveredItems: [],
      deliveryRecords: [],
      preview: pending,
      lastDailyPushAt: pending.lastDailyPushAt,
      lastInstantPushAt: pending.lastInstantPushAt,
    };
  }

  const deliveryLog = readRuntimeIntelDeliveryLog(store.metadata, now);
  const deliveredKeys = new Set(
    deliveryLog.map((entry) => `${entry.kind}:${entry.targetId}:${entry.digestItemId}`),
  );
  const deliveredRecords: IntelDeliveryRecord[] = [];
  for (const item of pending.items) {
    for (const target of item.targets) {
      const key = `${item.kind}:${target.id}:${item.digestItemId}`;
      if (deliveredKeys.has(key)) {
        continue;
      }
      const record: RuntimeIntelDeliveryLogEntry = {
        id: buildStableId("runtime_intel_delivery", [item.kind, target.id, item.digestItemId, now]),
        kind: item.kind,
        digestItemId: item.digestItemId,
        targetId: target.id,
        targetKind: target.kind,
        targetLabel: target.label,
        deliveredAt: now,
        domain: item.domain,
        title: item.title,
        metadata: {
          channel: target.channel,
          ownerLabel: target.ownerLabel,
          url: item.url,
          score: item.score,
        },
      };
      deliveryLog.unshift(record);
      deliveredKeys.add(key);
      deliveredRecords.push(record);
    }
  }

  store.metadata = writeRuntimeIntelDeliveryLog(store.metadata, deliveryLog);
  if (pending.dailyDigestCount > 0) {
    store.metadata = {
      ...store.metadata,
      lastDailyPushAt: now,
    };
  }
  if (pending.instantAlertCount > 0) {
    store.metadata = {
      ...store.metadata,
      lastInstantPushAt: now,
    };
  }
  const saved = saveRuntimeIntelStore(store, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_intel_deliveries_dispatched",
    {
      deliveredCount: deliveredRecords.length,
      dailyDigestCount: pending.dailyDigestCount,
      instantAlertCount: pending.instantAlertCount,
      targetCounts: {
        daily: targetResolution.dailyTargets.length,
        instant: targetResolution.instantTargets.length,
      },
      items: pending.items.map((item) => ({
        kind: item.kind,
        digestItemId: item.digestItemId,
        domain: item.domain,
        title: item.title,
        score: item.score,
        targetIds: item.targets.map((target) => target.id),
      })),
    },
    {
      ...opts,
      now,
    },
  );
  const preview = previewRuntimeIntelDeliveriesFromStore(
    saved,
    resolveRuntimeIntelDeliveryTargets(saved, {
      ...opts,
      now,
    }),
    now,
  );
  return {
    dispatchedAt: now,
    deliveredCount: deliveredRecords.length,
    dailyDigestCount: pending.dailyDigestCount,
    instantAlertCount: pending.instantAlertCount,
    deliveredItems: pending.items,
    deliveryRecords: deliveredRecords,
    preview,
    lastDailyPushAt: readDeliveryTimestamp(saved.metadata, "lastDailyPushAt"),
    lastInstantPushAt: readDeliveryTimestamp(saved.metadata, "lastInstantPushAt"),
  };
}
