import type {
  GovernanceRegistryEntry,
  GovernanceState,
  GovernanceRegistryType,
  RuntimeMetadata,
  RuntimeGovernanceStore,
  RuntimeMcpGrantRecord,
  RuntimeMcpGrantState,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeFederationStore,
  loadRuntimeGovernanceStore,
  loadRuntimeUserConsoleStore,
  saveRuntimeGovernanceStore,
  type RuntimeStoreOptions,
} from "./store.js";

export type RuntimeCapabilityRegistrySyncResult = {
  entries: GovernanceRegistryEntry[];
  counts: Record<GovernanceRegistryType, number>;
};

export type RuntimeCapabilityRegistryEntryUpsertInput = {
  id?: string;
  registryType: GovernanceRegistryType;
  targetId: string;
  state: GovernanceState;
  summary?: string;
  metadata?: RuntimeMetadata;
  reason?: string;
};

export type RuntimeCapabilityRegistryEntryUpsertResult = {
  entry: GovernanceRegistryEntry;
  entries: GovernanceRegistryEntry[];
  counts: Record<GovernanceRegistryType, number>;
};

export type RuntimeCapabilityMcpGrantUpsertInput = {
  id?: string;
  agentId: string;
  mcpServerId: string;
  state: RuntimeMcpGrantState;
  summary?: string;
  metadata?: RuntimeMetadata;
  reason?: string;
};

export type RuntimeCapabilityMcpGrantUpsertResult = {
  grant: RuntimeMcpGrantRecord;
  mcpGrants: RuntimeMcpGrantRecord[];
  allowedCount: number;
  deniedCount: number;
};

export type RuntimeCapabilityPolicy = {
  entries: GovernanceRegistryEntry[];
  mcpGrants: RuntimeMcpGrantRecord[];
  overlayCount: number;
  counts: Record<GovernanceRegistryType, number>;
  mcpGrantCount: number;
  allowedMcpGrantCount: number;
  deniedMcpGrantCount: number;
  isAllowed: (registryType: GovernanceRegistryType, targetId: string) => boolean;
  isLiveEligible: (registryType: GovernanceRegistryType, targetId: string) => boolean;
  resolveEntry: (
    registryType: GovernanceRegistryType,
    targetId: string,
  ) => GovernanceRegistryEntry | undefined;
  resolveExecutionStatus: (
    registryType: GovernanceRegistryType,
    targetId: string,
  ) => RuntimeCapabilityExecutionStatus;
  sortByExecutionPreference: (
    registryType: GovernanceRegistryType,
    targetIds: Array<string | null | undefined>,
  ) => string[];
  isMcpAllowed: (agentId: string, mcpServerId: string) => boolean;
  resolveMcpGrant: (agentId: string, mcpServerId: string) => RuntimeMcpGrantRecord | undefined;
};

export type RuntimeCapabilityExecutionMode = "blocked" | "shadow_only" | "candidate_only" | "live";

export type RuntimeCapabilityExecutionStatus = {
  state: GovernanceState | "implicit";
  mode: RuntimeCapabilityExecutionMode;
  liveEligible: boolean;
  preferenceRank: number;
  preferenceLabel: string;
  summary: string;
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

function buildEntryId(registryType: GovernanceRegistryType, targetId: string): string {
  return `governance_${registryType}_${hashText(targetId)}`;
}

function buildMcpGrantId(agentId: string, mcpServerId: string): string {
  return `governance_mcp_grant_${hashText(`${agentId}::${mcpServerId}`)}`;
}

function normalizeGovernanceState(value: unknown): GovernanceState {
  return value === "blocked" || value === "candidate" || value === "adopted" || value === "core"
    ? value
    : "shadow";
}

function normalizeMcpGrantState(value: unknown): RuntimeMcpGrantState {
  return value === "allowed" ? "allowed" : "denied";
}

function buildExecutionStatusForState(
  state: GovernanceState | "implicit",
): RuntimeCapabilityExecutionStatus {
  if (state === "blocked") {
    return {
      state,
      mode: "blocked",
      liveEligible: false,
      preferenceRank: 0,
      preferenceLabel: "blocked",
      summary: "Blocked. Keep this capability off the live runtime route.",
    };
  }
  if (state === "shadow") {
    return {
      state,
      mode: "shadow_only",
      liveEligible: false,
      preferenceRank: 1,
      preferenceLabel: "shadow",
      summary:
        "Shadow only. Observe it, but do not place it on the live execution lane by default.",
    };
  }
  if (state === "candidate") {
    return {
      state,
      mode: "candidate_only",
      liveEligible: false,
      preferenceRank: 2,
      preferenceLabel: "candidate",
      summary:
        "Candidate only. Keep it staged for review and promotion instead of routing live work to it by default.",
    };
  }
  if (state === "core") {
    return {
      state,
      mode: "live",
      liveEligible: true,
      preferenceRank: 4,
      preferenceLabel: "core",
      summary: "Core. Prefer this capability first on the live execution path.",
    };
  }
  if (state === "adopted") {
    return {
      state,
      mode: "live",
      liveEligible: true,
      preferenceRank: 3,
      preferenceLabel: "adopted",
      summary: "Adopted. This capability is eligible for live execution.",
    };
  }
  return {
    state,
    mode: "live",
    liveEligible: true,
    preferenceRank: 2.5,
    preferenceLabel: "implicit",
    summary:
      "Implicit live fallback. No authoritative governance entry exists yet, so the runtime keeps this capability available for compatibility until it is explicitly governed.",
  };
}

export function resolveRuntimeCapabilityExecutionStatus(
  entry?: GovernanceRegistryEntry,
): RuntimeCapabilityExecutionStatus {
  return buildExecutionStatusForState(entry?.state ?? "implicit");
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
      if (typeof entry === "string") {
        return entry;
      }
      const record = toRecord(entry);
      return normalizeText(record?.id ?? record?.agentId ?? record?.name);
    }),
  ).toSorted((left, right) => left.localeCompare(right));
}

function collectLocalAgentIds(opts: RuntimeStoreOptions & { now: number }): string[] {
  const userConsoleStore = loadRuntimeUserConsoleStore(opts);
  return uniqueStrings(userConsoleStore.agents.map((agent) => agent.id)).toSorted((left, right) =>
    left.localeCompare(right),
  );
}

function collectLocalSkillIds(opts: RuntimeStoreOptions & { now: number }): string[] {
  const userConsoleStore = loadRuntimeUserConsoleStore(opts);
  return uniqueStrings(userConsoleStore.agents.flatMap((agent) => agent.skillIds ?? [])).toSorted(
    (left, right) => left.localeCompare(right),
  );
}

function collectConfiguredSkills(config: Record<string, unknown> | null): string[] {
  const tools = toRecord(config?.tools);
  const toolSkills = toRecord(tools?.skills) ?? {};
  const directSkills = toRecord(config?.skills) ?? {};
  const configured = new Set<string>();
  for (const [skillId, value] of Object.entries(toolSkills)) {
    if (isEnabledRecord(value)) {
      configured.add(skillId);
    }
  }
  for (const [skillId, value] of Object.entries(directSkills)) {
    if (isEnabledRecord(value)) {
      configured.add(skillId);
    }
  }
  return [...configured].toSorted((left, right) => left.localeCompare(right));
}

function collectConfiguredMcps(config: Record<string, unknown> | null): string[] {
  const mcp = toRecord(config?.mcp);
  const servers = toRecord(mcp?.servers) ?? {};
  const configured = new Set<string>();
  for (const [serverId, value] of Object.entries(servers)) {
    if (isEnabledRecord(value)) {
      configured.add(serverId);
    }
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
      if (targetId && isEnabledRecord(record)) {
        configured.add(targetId);
      }
    }
  }
  return [...configured].toSorted((left, right) => left.localeCompare(right));
}

function buildConfiguredEntries(
  config: Record<string, unknown> | null,
  existingEntries: GovernanceRegistryEntry[],
  localAgentIds: string[],
  localSkillIds: string[],
  now: number,
): GovernanceRegistryEntry[] {
  const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));
  const nextEntries: GovernanceRegistryEntry[] = [];
  const configuredAgents = collectConfiguredAgents(config);
  const configuredSkills = collectConfiguredSkills(config);
  const configuredSets = {
    agent: uniqueStrings([...configuredAgents, ...localAgentIds]).toSorted((left, right) =>
      left.localeCompare(right),
    ),
    skill: uniqueStrings([...configuredSkills, ...localSkillIds]).toSorted((left, right) =>
      left.localeCompare(right),
    ),
    mcp: collectConfiguredMcps(config),
  } satisfies Record<GovernanceRegistryType, string[]>;

  for (const registryType of ["agent", "skill", "mcp"] as const) {
    for (const targetId of configuredSets[registryType]) {
      const entryId = buildEntryId(registryType, targetId);
      const existing = existingById.get(entryId);
      const agentIsConfigured = registryType !== "agent" || configuredAgents.includes(targetId);
      const agentIsLocal = registryType === "agent" && localAgentIds.includes(targetId);
      const skillIsConfigured = registryType !== "skill" || configuredSkills.includes(targetId);
      const skillIsLocal = registryType === "skill" && localSkillIds.includes(targetId);
      const defaultState = registryType === "agent" && targetId === "main" ? "core" : "shadow";
      nextEntries.push({
        id: entryId,
        registryType,
        targetId,
        state: existing?.state ?? defaultState,
        summary:
          existing?.summary ||
          (registryType === "agent" && agentIsLocal && !agentIsConfigured
            ? `Local agent ${targetId} is staged in shadow until the runtime explicitly adopts it into the live route.`
            : registryType === "skill" && skillIsLocal && !skillIsConfigured
              ? `Local skill ${targetId} is staged in shadow until the runtime explicitly adopts it into the live route.`
              : `${registryType} ${targetId} is available in the runtime capability plane.`),
        updatedAt: now,
        metadata: {
          ...existing?.metadata,
          configured:
            registryType === "agent"
              ? agentIsConfigured
              : registryType === "skill"
                ? skillIsConfigured
                : true,
          localAgent: agentIsLocal || undefined,
          localSkill: skillIsLocal || undefined,
          source:
            registryType === "agent" && agentIsLocal && !agentIsConfigured
              ? "runtime-user-console"
              : registryType === "skill" && skillIsLocal && !skillIsConfigured
                ? "runtime-user-console"
                : "runtime-config",
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
        ...entry.metadata,
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

function buildConfiguredMcpGrants(
  config: Record<string, unknown> | null,
  existingGrants: RuntimeMcpGrantRecord[],
  localAgentIds: string[],
  now: number,
): RuntimeMcpGrantRecord[] {
  const existingById = new Map(existingGrants.map((grant) => [grant.id, grant]));
  const nextGrants: RuntimeMcpGrantRecord[] = [];
  const configuredAgents = collectConfiguredAgents(config);
  const effectiveAgents = uniqueStrings([...configuredAgents, ...localAgentIds]).toSorted(
    (left, right) => left.localeCompare(right),
  );
  const configuredMcps = collectConfiguredMcps(config);

  for (const agentId of effectiveAgents) {
    for (const mcpServerId of configuredMcps) {
      const grantId = buildMcpGrantId(agentId, mcpServerId);
      const existing = existingById.get(grantId);
      const defaultState: RuntimeMcpGrantState = agentId === "main" ? "allowed" : "denied";
      const nextState = existing ? normalizeMcpGrantState(existing.state) : defaultState;
      const agentIsConfigured = configuredAgents.includes(agentId);
      const agentIsLocal = localAgentIds.includes(agentId);
      nextGrants.push({
        id: grantId,
        agentId,
        mcpServerId,
        state: nextState,
        summary:
          normalizeText(existing?.summary) ||
          `Runtime host ${nextState === "allowed" ? "allows" : "denies"} agent ${agentId} to access MCP ${mcpServerId}.`,
        updatedAt: now,
        metadata: {
          ...existing?.metadata,
          configured: agentIsConfigured,
          localAgent: agentIsLocal || undefined,
          source: agentIsLocal && !agentIsConfigured ? "runtime-user-console" : "runtime-config",
          defaultGrant: !existing,
        },
      });
    }
  }

  for (const grant of existingGrants) {
    if (nextGrants.some((candidate) => candidate.id === grant.id)) {
      continue;
    }
    nextGrants.push({
      ...grant,
      updatedAt: now,
      metadata: {
        ...grant.metadata,
        configured: false,
        source: "runtime-config",
      },
    });
  }

  return nextGrants.toSorted((left, right) => {
    if (left.agentId !== right.agentId) {
      return left.agentId.localeCompare(right.agentId);
    }
    return left.mcpServerId.localeCompare(right.mcpServerId);
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

function countMcpGrants(grants: RuntimeMcpGrantRecord[]): {
  allowedCount: number;
  deniedCount: number;
} {
  return {
    allowedCount: grants.filter((grant) => grant.state === "allowed").length,
    deniedCount: grants.filter((grant) => grant.state === "denied").length,
  };
}

function readAppliedPolicyOverlayEntries(
  opts: RuntimeStoreOptions & {
    route?: string;
    now: number;
  },
): GovernanceRegistryEntry[] {
  const federationStore = loadRuntimeFederationStore(opts);
  const overlays = toRecord(federationStore.metadata?.appliedPolicyOverlays) ?? {};
  const requestedRoute = normalizeText(opts.route);
  const records = Object.entries(overlays)
    .map(([overlayId, value]) => {
      const overlay = toRecord(value);
      const policy = toRecord(overlay?.policy) ?? {};
      const route = normalizeText(overlay?.route);
      return {
        overlayId,
        route,
        appliedAt:
          typeof overlay?.appliedAt === "number" && Number.isFinite(overlay.appliedAt)
            ? overlay.appliedAt
            : opts.now,
        policy,
      };
    })
    .filter((overlay) => {
      if (!requestedRoute) {
        return true;
      }
      return !overlay.route || overlay.route === requestedRoute;
    })
    .toSorted((left, right) => left.appliedAt - right.appliedAt);

  const nextEntries: GovernanceRegistryEntry[] = [];

  function pushOverlayEntry(
    registryType: GovernanceRegistryType,
    targetId: string,
    state: unknown,
    overlayId: string,
    route: string,
    appliedAt: number,
    summary?: string,
    metadata?: RuntimeMetadata,
  ) {
    const normalizedTargetId = normalizeText(targetId);
    if (!normalizedTargetId) {
      return;
    }
    const normalizedState = normalizeGovernanceState(state);
    nextEntries.push({
      id: buildEntryId(registryType, normalizedTargetId),
      registryType,
      targetId: normalizedTargetId,
      state: normalizedState,
      summary:
        normalizeText(summary) ||
        `Federation overlay marks ${registryType} ${normalizedTargetId} as ${normalizedState}.`,
      updatedAt: appliedAt,
      metadata: {
        ...metadata,
        source: "federation-policy-overlay",
        overlayId,
        route: route || undefined,
      },
    });
  }

  for (const overlay of records) {
    const governanceEntries = Array.isArray(overlay.policy.governanceEntries)
      ? overlay.policy.governanceEntries
      : [];
    for (const entry of governanceEntries) {
      const record = toRecord(entry);
      const registryType =
        record?.registryType === "agent" || record?.registryType === "mcp"
          ? record.registryType
          : "skill";
      pushOverlayEntry(
        registryType,
        normalizeText(record?.targetId ?? record?.id ?? record?.name),
        record?.state,
        overlay.overlayId,
        overlay.route,
        overlay.appliedAt,
        normalizeText(record?.summary),
        toRecord(record?.metadata) ?? undefined,
      );
    }

    const stateMaps = [
      ["skillStates", "skill"],
      ["agentStates", "agent"],
      ["mcpStates", "mcp"],
    ] as const satisfies ReadonlyArray<[string, GovernanceRegistryType]>;
    for (const [field, registryType] of stateMaps) {
      const stateMap = toRecord(overlay.policy[field]);
      if (!stateMap) {
        continue;
      }
      for (const [targetId, state] of Object.entries(stateMap)) {
        pushOverlayEntry(
          registryType,
          targetId,
          state,
          overlay.overlayId,
          overlay.route,
          overlay.appliedAt,
        );
      }
    }

    const blockedLists = [
      ["blockedSkills", "skill"],
      ["blockedAgents", "agent"],
      ["blockedMcps", "mcp"],
    ] as const satisfies ReadonlyArray<[string, GovernanceRegistryType]>;
    for (const [field, registryType] of blockedLists) {
      const blocked = Array.isArray(overlay.policy[field]) ? overlay.policy[field] : [];
      for (const targetId of blocked) {
        if (typeof targetId !== "string") {
          continue;
        }
        pushOverlayEntry(
          registryType,
          targetId,
          "blocked",
          overlay.overlayId,
          overlay.route,
          overlay.appliedAt,
        );
      }
    }
  }

  return nextEntries;
}

function readAppliedPolicyOverlayMcpGrants(
  opts: RuntimeStoreOptions & {
    route?: string;
    now: number;
  },
): RuntimeMcpGrantRecord[] {
  const federationStore = loadRuntimeFederationStore(opts);
  const overlays = toRecord(federationStore.metadata?.appliedPolicyOverlays) ?? {};
  const requestedRoute = normalizeText(opts.route);
  const records = Object.entries(overlays)
    .map(([overlayId, value]) => {
      const overlay = toRecord(value);
      const policy = toRecord(overlay?.policy) ?? {};
      const route = normalizeText(overlay?.route);
      return {
        overlayId,
        route,
        appliedAt:
          typeof overlay?.appliedAt === "number" && Number.isFinite(overlay.appliedAt)
            ? overlay.appliedAt
            : opts.now,
        policy,
      };
    })
    .filter((overlay) => {
      if (!requestedRoute) {
        return true;
      }
      return !overlay.route || overlay.route === requestedRoute;
    })
    .toSorted((left, right) => left.appliedAt - right.appliedAt);

  const nextGrants: RuntimeMcpGrantRecord[] = [];

  function pushOverlayGrant(
    agentId: unknown,
    mcpServerId: unknown,
    state: unknown,
    overlayId: string,
    route: string,
    appliedAt: number,
    summary?: string,
    metadata?: RuntimeMetadata,
  ) {
    const normalizedAgentId = normalizeText(agentId);
    const normalizedMcpServerId = normalizeText(mcpServerId);
    if (!normalizedAgentId || !normalizedMcpServerId) {
      return;
    }
    const normalizedState = normalizeMcpGrantState(state);
    nextGrants.push({
      id: buildMcpGrantId(normalizedAgentId, normalizedMcpServerId),
      agentId: normalizedAgentId,
      mcpServerId: normalizedMcpServerId,
      state: normalizedState,
      summary:
        normalizeText(summary) ||
        `Federation overlay ${normalizedState === "allowed" ? "allows" : "denies"} agent ${normalizedAgentId} for MCP ${normalizedMcpServerId}.`,
      updatedAt: appliedAt,
      metadata: {
        ...metadata,
        source: "federation-policy-overlay",
        overlayId,
        route: route || undefined,
      },
    });
  }

  for (const overlay of records) {
    const grants = Array.isArray(overlay.policy.mcpGrants) ? overlay.policy.mcpGrants : [];
    for (const grant of grants) {
      const record = toRecord(grant);
      pushOverlayGrant(
        record?.agentId ?? record?.agent ?? record?.targetId,
        record?.mcpServerId ?? record?.mcpId ?? record?.serverId,
        record?.state,
        overlay.overlayId,
        overlay.route,
        overlay.appliedAt,
        normalizeText(record?.summary),
        toRecord(record?.metadata) ?? undefined,
      );
    }

    const grantMatrix = toRecord(overlay.policy.mcpGrantMatrix);
    if (!grantMatrix) {
      continue;
    }
    for (const [agentId, value] of Object.entries(grantMatrix)) {
      const record = toRecord(value);
      const allowed = Array.isArray(record?.allowed) ? record.allowed : [];
      const denied = Array.isArray(record?.denied) ? record.denied : [];
      for (const mcpServerId of allowed) {
        pushOverlayGrant(
          agentId,
          mcpServerId,
          "allowed",
          overlay.overlayId,
          overlay.route,
          overlay.appliedAt,
        );
      }
      for (const mcpServerId of denied) {
        pushOverlayGrant(
          agentId,
          mcpServerId,
          "denied",
          overlay.overlayId,
          overlay.route,
          overlay.appliedAt,
        );
      }
    }
  }

  return nextGrants;
}

export function resolveRuntimeCapabilityPolicy(
  config: Record<string, unknown> | null,
  opts: RuntimeStoreOptions & { route?: string } = {},
): RuntimeCapabilityPolicy {
  const now = resolveNow(opts.now);
  const localAgentIds = collectLocalAgentIds({
    ...opts,
    now,
  });
  const localSkillIds = collectLocalSkillIds({
    ...opts,
    now,
  });
  const governanceStore = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const baseEntries =
    governanceStore.entries.length > 0
      ? [...governanceStore.entries]
      : buildConfiguredEntries(config, [], localAgentIds, localSkillIds, now);
  const baseMcpGrants =
    governanceStore.mcpGrants.length > 0
      ? [...governanceStore.mcpGrants]
      : buildConfiguredMcpGrants(config, [], localAgentIds, now);
  const configuredEntries = buildConfiguredEntries(
    config,
    baseEntries,
    localAgentIds,
    localSkillIds,
    now,
  );
  const configuredMcpGrants = buildConfiguredMcpGrants(config, baseMcpGrants, localAgentIds, now);
  const effectiveById = new Map(configuredEntries.map((entry) => [entry.id, entry]));
  const effectiveMcpGrantsById = new Map(configuredMcpGrants.map((grant) => [grant.id, grant]));
  const overlayEntries = readAppliedPolicyOverlayEntries({
    ...opts,
    now,
  });
  const overlayMcpGrants = readAppliedPolicyOverlayMcpGrants({
    ...opts,
    now,
  });
  for (const overlayEntry of overlayEntries) {
    const existing = effectiveById.get(overlayEntry.id);
    effectiveById.set(overlayEntry.id, {
      ...existing,
      ...overlayEntry,
      metadata: {
        ...existing?.metadata,
        ...overlayEntry.metadata,
      },
    });
  }
  for (const overlayGrant of overlayMcpGrants) {
    const existing = effectiveMcpGrantsById.get(overlayGrant.id);
    effectiveMcpGrantsById.set(overlayGrant.id, {
      ...existing,
      ...overlayGrant,
      metadata: {
        ...existing?.metadata,
        ...overlayGrant.metadata,
      },
    });
  }
  const entries = [...effectiveById.values()].toSorted((left, right) => {
    if (left.registryType !== right.registryType) {
      return left.registryType.localeCompare(right.registryType);
    }
    return left.targetId.localeCompare(right.targetId);
  });
  const mcpGrants = [...effectiveMcpGrantsById.values()].toSorted((left, right) => {
    if (left.agentId !== right.agentId) {
      return left.agentId.localeCompare(right.agentId);
    }
    return left.mcpServerId.localeCompare(right.mcpServerId);
  });
  const byRegistryType = {
    agent: new Map<string, GovernanceRegistryEntry>(),
    skill: new Map<string, GovernanceRegistryEntry>(),
    mcp: new Map<string, GovernanceRegistryEntry>(),
  } satisfies Record<GovernanceRegistryType, Map<string, GovernanceRegistryEntry>>;
  for (const entry of entries) {
    byRegistryType[entry.registryType].set(entry.targetId.toLowerCase(), entry);
  }
  const mcpGrantByAgent = new Map<string, Map<string, RuntimeMcpGrantRecord>>();
  for (const grant of mcpGrants) {
    const agentKey = grant.agentId.toLowerCase();
    const mcpKey = grant.mcpServerId.toLowerCase();
    const grantsForAgent =
      mcpGrantByAgent.get(agentKey) ?? new Map<string, RuntimeMcpGrantRecord>();
    grantsForAgent.set(mcpKey, grant);
    mcpGrantByAgent.set(agentKey, grantsForAgent);
  }
  const grantCounts = countMcpGrants(mcpGrants);
  return {
    entries,
    mcpGrants,
    overlayCount: overlayEntries.length + overlayMcpGrants.length,
    counts: countEntriesByType(entries),
    mcpGrantCount: mcpGrants.length,
    allowedMcpGrantCount: grantCounts.allowedCount,
    deniedMcpGrantCount: grantCounts.deniedCount,
    isAllowed(registryType, targetId) {
      const key = normalizeText(targetId).toLowerCase();
      if (!key) {
        return true;
      }
      return byRegistryType[registryType].get(key)?.state !== "blocked";
    },
    isLiveEligible(registryType, targetId) {
      const key = normalizeText(targetId).toLowerCase();
      if (!key) {
        return true;
      }
      return resolveRuntimeCapabilityExecutionStatus(byRegistryType[registryType].get(key))
        .liveEligible;
    },
    resolveEntry(registryType, targetId) {
      const key = normalizeText(targetId).toLowerCase();
      if (!key) {
        return undefined;
      }
      return byRegistryType[registryType].get(key);
    },
    resolveExecutionStatus(registryType, targetId) {
      const key = normalizeText(targetId).toLowerCase();
      if (!key) {
        return resolveRuntimeCapabilityExecutionStatus(undefined);
      }
      return resolveRuntimeCapabilityExecutionStatus(byRegistryType[registryType].get(key));
    },
    sortByExecutionPreference(registryType, targetIds) {
      const normalized = uniqueStrings(targetIds);
      return normalized
        .map((targetId, index) => ({
          targetId,
          index,
          status: this.resolveExecutionStatus(registryType, targetId),
        }))
        .toSorted((left, right) => {
          if (left.status.liveEligible !== right.status.liveEligible) {
            return left.status.liveEligible ? -1 : 1;
          }
          if (left.status.preferenceRank !== right.status.preferenceRank) {
            return right.status.preferenceRank - left.status.preferenceRank;
          }
          return left.index - right.index;
        })
        .map((entry) => entry.targetId);
    },
    isMcpAllowed(agentId, mcpServerId) {
      const agentKey = normalizeText(agentId).toLowerCase();
      const mcpKey = normalizeText(mcpServerId).toLowerCase();
      if (!agentKey || !mcpKey) {
        return false;
      }
      if (!this.isLiveEligible("agent", agentKey) || !this.isLiveEligible("mcp", mcpKey)) {
        return false;
      }
      return mcpGrantByAgent.get(agentKey)?.get(mcpKey)?.state === "allowed";
    },
    resolveMcpGrant(agentId, mcpServerId) {
      const agentKey = normalizeText(agentId).toLowerCase();
      const mcpKey = normalizeText(mcpServerId).toLowerCase();
      if (!agentKey || !mcpKey) {
        return undefined;
      }
      return mcpGrantByAgent.get(agentKey)?.get(mcpKey);
    },
  };
}

export function upsertRuntimeCapabilityRegistryEntry(
  input: RuntimeCapabilityRegistryEntryUpsertInput,
  opts: RuntimeStoreOptions = {},
): RuntimeCapabilityRegistryEntryUpsertResult {
  const now = resolveNow(opts.now);
  const targetId = normalizeText(input.targetId);
  if (!targetId) {
    throw new Error("targetId is required");
  }
  const store = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const entryId = normalizeText(input.id) || buildEntryId(input.registryType, targetId);
  const existing = store.entries.find((entry) => entry.id === entryId);
  const nextEntry: GovernanceRegistryEntry = {
    id: entryId,
    registryType: input.registryType,
    targetId,
    state: normalizeGovernanceState(input.state),
    summary:
      normalizeText(input.summary) ||
      existing?.summary ||
      `${input.registryType} ${targetId} is governed by the authoritative runtime registry.`,
    updatedAt: now,
    metadata: {
      ...existing?.metadata,
      ...input.metadata,
      source: "runtime-control",
    },
  };
  const nextEntries =
    store.entries.findIndex((entry) => entry.id === entryId) === -1
      ? [...store.entries, nextEntry]
      : store.entries.map((entry) => (entry.id === entryId ? nextEntry : entry));
  const nextStore: RuntimeGovernanceStore = {
    ...store,
    entries: nextEntries.toSorted((left, right) => {
      if (left.registryType !== right.registryType) {
        return left.registryType.localeCompare(right.registryType);
      }
      return left.targetId.localeCompare(right.targetId);
    }),
    lastImportedAt: now,
  };
  saveRuntimeGovernanceStore(nextStore, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_capability_registry_entry_upserted",
    {
      id: nextEntry.id,
      registryType: nextEntry.registryType,
      targetId: nextEntry.targetId,
      state: nextEntry.state,
      reason: normalizeText(input.reason) || undefined,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    entry: nextEntry,
    entries: nextStore.entries,
    counts: countEntriesByType(nextStore.entries),
  };
}

export function syncRuntimeCapabilityRegistry(
  config: Record<string, unknown> | null,
  opts: RuntimeStoreOptions = {},
): RuntimeCapabilityRegistrySyncResult {
  const now = resolveNow(opts.now);
  const localAgentIds = collectLocalAgentIds({
    ...opts,
    now,
  });
  const localSkillIds = collectLocalSkillIds({
    ...opts,
    now,
  });
  const store = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const entries = buildConfiguredEntries(config, store.entries, localAgentIds, localSkillIds, now);
  const mcpGrants = buildConfiguredMcpGrants(config, store.mcpGrants, localAgentIds, now);
  const nextStore: RuntimeGovernanceStore = {
    ...store,
    entries,
    mcpGrants,
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

export function removeRuntimeCapabilityRegistryTargets(
  input: {
    registryType: GovernanceRegistryType;
    targetId: string;
    reason?: string;
    removeMcpGrantsForAgentId?: string;
  },
  opts: RuntimeStoreOptions = {},
): {
  removedEntryCount: number;
  removedMcpGrantCount: number;
  entries: GovernanceRegistryEntry[];
  mcpGrants: RuntimeMcpGrantRecord[];
  counts: Record<GovernanceRegistryType, number>;
} {
  const now = resolveNow(opts.now);
  const targetId = normalizeText(input.targetId);
  if (!targetId) {
    throw new Error("targetId is required");
  }
  const removeMcpGrantsForAgentId = normalizeText(input.removeMcpGrantsForAgentId);
  const store = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const nextEntries = store.entries.filter(
    (entry) =>
      !(
        entry.registryType === input.registryType &&
        entry.targetId.toLowerCase() === targetId.toLowerCase()
      ),
  );
  const nextMcpGrants = removeMcpGrantsForAgentId
    ? store.mcpGrants.filter(
        (grant) => grant.agentId.toLowerCase() !== removeMcpGrantsForAgentId.toLowerCase(),
      )
    : store.mcpGrants;
  const removedEntryCount = store.entries.length - nextEntries.length;
  const removedMcpGrantCount = store.mcpGrants.length - nextMcpGrants.length;
  if (removedEntryCount < 1 && removedMcpGrantCount < 1) {
    return {
      removedEntryCount,
      removedMcpGrantCount,
      entries: store.entries,
      mcpGrants: store.mcpGrants,
      counts: countEntriesByType(store.entries),
    };
  }
  const nextStore: RuntimeGovernanceStore = {
    ...store,
    entries: nextEntries,
    mcpGrants: nextMcpGrants,
    lastImportedAt: now,
  };
  saveRuntimeGovernanceStore(nextStore, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_capability_registry_target_removed",
    {
      registryType: input.registryType,
      targetId,
      removedEntryCount,
      removedMcpGrantCount,
      reason: normalizeText(input.reason) || undefined,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    removedEntryCount,
    removedMcpGrantCount,
    entries: nextEntries,
    mcpGrants: nextMcpGrants,
    counts: countEntriesByType(nextEntries),
  };
}

export function upsertRuntimeMcpGrant(
  input: RuntimeCapabilityMcpGrantUpsertInput,
  opts: RuntimeStoreOptions = {},
): RuntimeCapabilityMcpGrantUpsertResult {
  const now = resolveNow(opts.now);
  const agentId = normalizeText(input.agentId);
  const mcpServerId = normalizeText(input.mcpServerId);
  if (!agentId) {
    throw new Error("agentId is required");
  }
  if (!mcpServerId) {
    throw new Error("mcpServerId is required");
  }
  const store = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const grantId = normalizeText(input.id) || buildMcpGrantId(agentId, mcpServerId);
  const existing = store.mcpGrants.find((grant) => grant.id === grantId);
  const nextGrant: RuntimeMcpGrantRecord = {
    id: grantId,
    agentId,
    mcpServerId,
    state: normalizeMcpGrantState(input.state),
    summary:
      normalizeText(input.summary) ||
      existing?.summary ||
      `Runtime host ${normalizeMcpGrantState(input.state) === "allowed" ? "allows" : "denies"} agent ${agentId} to access MCP ${mcpServerId}.`,
    updatedAt: now,
    metadata: {
      ...existing?.metadata,
      ...input.metadata,
      source: "runtime-control",
    },
  };
  const nextGrants =
    store.mcpGrants.findIndex((grant) => grant.id === grantId) === -1
      ? [...store.mcpGrants, nextGrant]
      : store.mcpGrants.map((grant) => (grant.id === grantId ? nextGrant : grant));
  const nextStore: RuntimeGovernanceStore = {
    ...store,
    mcpGrants: nextGrants.toSorted((left, right) => {
      if (left.agentId !== right.agentId) {
        return left.agentId.localeCompare(right.agentId);
      }
      return left.mcpServerId.localeCompare(right.mcpServerId);
    }),
    lastImportedAt: now,
  };
  saveRuntimeGovernanceStore(nextStore, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_capability_mcp_grant_upserted",
    {
      id: nextGrant.id,
      agentId: nextGrant.agentId,
      mcpServerId: nextGrant.mcpServerId,
      state: nextGrant.state,
      reason: normalizeText(input.reason) || undefined,
    },
    {
      ...opts,
      now,
    },
  );
  const grantCounts = countMcpGrants(nextStore.mcpGrants);
  return {
    grant: nextGrant,
    mcpGrants: nextStore.mcpGrants,
    allowedCount: grantCounts.allowedCount,
    deniedCount: grantCounts.deniedCount,
  };
}
