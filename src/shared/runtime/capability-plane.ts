import type {
  GovernanceRegistryEntry,
  GovernanceRegistryType,
  RuntimeGovernanceStore,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeGovernanceStore,
  saveRuntimeGovernanceStore,
  type RuntimeStoreOptions,
} from "./store.js";

export type RuntimeCapabilityRegistrySyncResult = {
  entries: GovernanceRegistryEntry[];
  counts: Record<GovernanceRegistryType, number>;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
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

function buildEntryId(registryType: GovernanceRegistryType, targetId: string): string {
  return `governance_${registryType}_${hashText(targetId)}`;
}

function isEnabledRecord(value: unknown): boolean {
  const record = toRecord(value);
  if (!record) {
    return value !== false;
  }
  return record.enabled !== false;
}

function collectConfiguredAgents(config: Record<string, unknown> | null): string[] {
  const agents = toRecord(config?.agents);
  const list = Array.isArray(agents?.list) ? agents.list : [];
  return uniqueStrings(
    list.map((entry) => {
      if (typeof entry === "string") return entry;
      const record = toRecord(entry);
      return normalizeText(record?.id ?? record?.agentId ?? record?.name);
    }),
  ).toSorted((left, right) => left.localeCompare(right));
}

function collectConfiguredSkills(config: Record<string, unknown> | null): string[] {
  const tools = toRecord(config?.tools);
  const toolSkills = toRecord(tools?.skills) ?? {};
  const directSkills = toRecord(config?.skills) ?? {};
  const configured = new Set<string>();
  for (const [skillId, value] of Object.entries(toolSkills)) {
    if (isEnabledRecord(value)) configured.add(skillId);
  }
  for (const [skillId, value] of Object.entries(directSkills)) {
    if (isEnabledRecord(value)) configured.add(skillId);
  }
  return [...configured].toSorted((left, right) => left.localeCompare(right));
}

function collectConfiguredMcps(config: Record<string, unknown> | null): string[] {
  const mcp = toRecord(config?.mcp);
  const servers = toRecord(mcp?.servers) ?? {};
  const configured = new Set<string>();
  for (const [serverId, value] of Object.entries(servers)) {
    if (isEnabledRecord(value)) configured.add(serverId);
  }
  const entryLists = [mcp?.entries, mcp?.list].filter(Array.isArray);
  for (const list of entryLists) {
    for (const entry of list) {
      if (typeof entry === "string") {
        configured.add(entry);
        continue;
      }
      const record = toRecord(entry);
      const targetId = normalizeText(record?.id ?? record?.name ?? record?.serverId);
      if (targetId && isEnabledRecord(record)) configured.add(targetId);
    }
  }
  return [...configured].toSorted((left, right) => left.localeCompare(right));
}

function buildConfiguredEntries(
  config: Record<string, unknown> | null,
  existingEntries: GovernanceRegistryEntry[],
  now: number,
): GovernanceRegistryEntry[] {
  const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));
  const nextEntries: GovernanceRegistryEntry[] = [];
  const configuredSets = {
    agent: collectConfiguredAgents(config),
    skill: collectConfiguredSkills(config),
    mcp: collectConfiguredMcps(config),
  } satisfies Record<GovernanceRegistryType, string[]>;

  for (const registryType of ["agent", "skill", "mcp"] as const) {
    for (const targetId of configuredSets[registryType]) {
      const entryId = buildEntryId(registryType, targetId);
      const existing = existingById.get(entryId);
      const defaultState = registryType === "agent" && targetId === "main" ? "core" : "shadow";
      nextEntries.push({
        id: entryId,
        registryType,
        targetId,
        state: existing?.state ?? defaultState,
        summary:
          existing?.summary ||
          `${registryType} ${targetId} is available in the runtime capability plane.`,
        updatedAt: now,
        metadata: {
          ...(existing?.metadata ?? {}),
          configured: true,
          source: "runtime-config",
          accessMode:
            registryType === "mcp"
              ? "read_only_minimal"
              : registryType === "agent"
                ? "shadow_execution"
                : "shadow_skill",
        },
      });
    }
  }

  for (const entry of existingEntries) {
    if (nextEntries.some((candidate) => candidate.id === entry.id)) {
      continue;
    }
    nextEntries.push({
      ...entry,
      updatedAt: now,
      metadata: {
        ...(entry.metadata ?? {}),
        configured: false,
        source: "runtime-config",
      },
    });
  }

  return nextEntries.toSorted((left, right) => {
    if (left.registryType !== right.registryType) {
      return left.registryType.localeCompare(right.registryType);
    }
    return left.targetId.localeCompare(right.targetId);
  });
}

function countEntriesByType(
  entries: GovernanceRegistryEntry[],
): Record<GovernanceRegistryType, number> {
  return {
    agent: entries.filter((entry) => entry.registryType === "agent").length,
    skill: entries.filter((entry) => entry.registryType === "skill").length,
    mcp: entries.filter((entry) => entry.registryType === "mcp").length,
  };
}

export function syncRuntimeCapabilityRegistry(
  config: Record<string, unknown> | null,
  opts: RuntimeStoreOptions = {},
): RuntimeCapabilityRegistrySyncResult {
  const now = resolveNow(opts.now);
  const store = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const entries = buildConfiguredEntries(config, store.entries, now);
  const nextStore: RuntimeGovernanceStore = {
    ...store,
    entries,
    lastImportedAt: now,
  };
  saveRuntimeGovernanceStore(nextStore, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_capability_registry_synced",
    {
      entryCount: entries.length,
      counts: countEntriesByType(entries),
    },
    {
      ...opts,
      now,
    },
  );
  return {
    entries,
    counts: countEntriesByType(entries),
  };
}
