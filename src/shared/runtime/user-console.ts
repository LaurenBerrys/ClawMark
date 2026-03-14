import type {
  AgentLocalOverlay,
  AgentRecord,
  RuntimeUserConsoleStore,
  RuntimeUserModel,
  SurfaceRecord,
  SurfaceRoleOverlay,
  TaskReportPolicy,
} from "./contracts.js";
import {
  loadRuntimeUserConsoleStore,
  saveRuntimeUserConsoleStore,
  type RuntimeStoreOptions,
} from "./store.js";

type UserModelUpdateInput = Partial<
  Pick<
    RuntimeUserModel,
    | "displayName"
    | "communicationStyle"
    | "interruptionThreshold"
    | "reportVerbosity"
    | "confirmationBoundary"
    | "reportPolicy"
    | "metadata"
  >
>;

type AgentUpsertInput = {
  id?: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  roleBase?: string;
  memoryNamespace?: string;
  skillIds?: string[];
  active?: boolean;
  overlay?: Partial<Pick<AgentLocalOverlay, "communicationStyle" | "reportPolicy" | "notes">>;
  metadata?: Record<string, unknown>;
};

type SurfaceUpsertInput = {
  id?: string;
  channel: string;
  accountId: string;
  label: string;
  ownerKind: SurfaceRecord["ownerKind"];
  ownerId?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
};

type SurfaceRoleOverlayUpsertInput = {
  id?: string;
  surfaceId: string;
  role: string;
  businessGoal?: string;
  tone?: string;
  initiative?: SurfaceRoleOverlay["initiative"];
  allowedTopics?: string[];
  restrictedTopics?: string[];
  reportTarget?: string;
  localBusinessPolicy?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index < 0) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function normalizeReportPolicy(value: unknown): TaskReportPolicy | undefined {
  return value === "silent" ||
    value === "reply" ||
    value === "proactive" ||
    value === "reply_and_proactive"
    ? value
    : undefined;
}

function requireStore(opts: RuntimeStoreOptions = {}): RuntimeUserConsoleStore {
  return loadRuntimeUserConsoleStore(opts);
}

export function getRuntimeUserModel(opts: RuntimeStoreOptions = {}): RuntimeUserModel {
  return requireStore(opts).userModel;
}

export function updateRuntimeUserModel(
  input: UserModelUpdateInput,
  opts: RuntimeStoreOptions = {},
): RuntimeUserModel {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  const next: RuntimeUserModel = {
    ...store.userModel,
    displayName:
      typeof input.displayName === "string"
        ? input.displayName.trim() || undefined
        : store.userModel.displayName,
    communicationStyle:
      typeof input.communicationStyle === "string"
        ? input.communicationStyle.trim() || undefined
        : store.userModel.communicationStyle,
    interruptionThreshold:
      input.interruptionThreshold === "low" ||
      input.interruptionThreshold === "medium" ||
      input.interruptionThreshold === "high"
        ? input.interruptionThreshold
        : store.userModel.interruptionThreshold,
    reportVerbosity:
      input.reportVerbosity === "brief" ||
      input.reportVerbosity === "balanced" ||
      input.reportVerbosity === "detailed"
        ? input.reportVerbosity
        : store.userModel.reportVerbosity,
    confirmationBoundary:
      input.confirmationBoundary === "strict" ||
      input.confirmationBoundary === "balanced" ||
      input.confirmationBoundary === "light"
        ? input.confirmationBoundary
        : store.userModel.confirmationBoundary,
    reportPolicy: normalizeReportPolicy(input.reportPolicy) ?? store.userModel.reportPolicy,
    updatedAt: now,
    metadata: input.metadata ?? store.userModel.metadata,
  };
  saveRuntimeUserConsoleStore(
    {
      ...store,
      userModel: next,
    },
    opts,
  );
  return next;
}

export function listRuntimeAgents(opts: RuntimeStoreOptions = {}): AgentRecord[] {
  return [...requireStore(opts).agents].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name),
  );
}

export function upsertRuntimeAgent(
  input: AgentUpsertInput,
  opts: RuntimeStoreOptions = {},
): AgentRecord {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  const id =
    typeof input.id === "string" && input.id.trim().length > 0
      ? input.id.trim()
      : `agent-${now.toString(36)}`;
  const existing = store.agents.find((entry) => entry.id === id);
  const nextAgent: AgentRecord = {
    id,
    name: input.name.trim(),
    description:
      typeof input.description === "string"
        ? input.description.trim() || undefined
        : existing?.description,
    avatarUrl:
      typeof input.avatarUrl === "string"
        ? input.avatarUrl.trim() || undefined
        : existing?.avatarUrl,
    roleBase:
      typeof input.roleBase === "string" ? input.roleBase.trim() || undefined : existing?.roleBase,
    memoryNamespace:
      typeof input.memoryNamespace === "string" && input.memoryNamespace.trim().length > 0
        ? input.memoryNamespace.trim()
        : (existing?.memoryNamespace ?? `agent/${id}`),
    skillIds: Array.isArray(input.skillIds)
      ? input.skillIds.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : (existing?.skillIds ?? []),
    active: typeof input.active === "boolean" ? input.active : (existing?.active ?? true),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: input.metadata ?? existing?.metadata,
  };
  const nextOverlay =
    input.overlay == null
      ? store.agentOverlays.find((entry) => entry.agentId === id)
      : {
          id:
            store.agentOverlays.find((entry) => entry.agentId === id)?.id ?? `agent-overlay-${id}`,
          agentId: id,
          communicationStyle:
            typeof input.overlay.communicationStyle === "string"
              ? input.overlay.communicationStyle.trim() || undefined
              : store.agentOverlays.find((entry) => entry.agentId === id)?.communicationStyle,
          reportPolicy:
            normalizeReportPolicy(input.overlay.reportPolicy) ??
            store.agentOverlays.find((entry) => entry.agentId === id)?.reportPolicy,
          notes:
            typeof input.overlay.notes === "string"
              ? input.overlay.notes.trim() || undefined
              : store.agentOverlays.find((entry) => entry.agentId === id)?.notes,
          updatedAt: now,
          metadata: input.metadata,
        };

  saveRuntimeUserConsoleStore(
    {
      ...store,
      agents: upsertById(store.agents, nextAgent),
      agentOverlays:
        nextOverlay == null ? store.agentOverlays : upsertById(store.agentOverlays, nextOverlay),
    },
    opts,
  );
  return nextAgent;
}

export function deleteRuntimeAgent(
  id: string,
  opts: RuntimeStoreOptions = {},
): {
  removed: boolean;
  id: string;
} {
  const store = requireStore(opts);
  const existing = store.agents.find((entry) => entry.id === id);
  if (!existing) {
    return { removed: false, id };
  }
  saveRuntimeUserConsoleStore(
    {
      ...store,
      agents: store.agents.filter((entry) => entry.id !== id),
      agentOverlays: store.agentOverlays.filter((entry) => entry.agentId !== id),
      surfaces: store.surfaces.map((surface) =>
        surface.ownerKind === "agent" && surface.ownerId === id
          ? { ...surface, ownerKind: "user", ownerId: undefined, updatedAt: resolveNow(opts.now) }
          : surface,
      ),
    },
    opts,
  );
  return { removed: true, id };
}

export function listRuntimeSurfaces(opts: RuntimeStoreOptions = {}): SurfaceRecord[] {
  return [...requireStore(opts).surfaces].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label),
  );
}

export function upsertRuntimeSurface(
  input: SurfaceUpsertInput,
  opts: RuntimeStoreOptions = {},
): SurfaceRecord {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  if (input.ownerKind === "agent") {
    const agentId = typeof input.ownerId === "string" ? input.ownerId.trim() : "";
    if (!agentId || !store.agents.some((entry) => entry.id === agentId)) {
      throw new Error("surface ownerId must reference an existing agent");
    }
  }
  const id =
    typeof input.id === "string" && input.id.trim().length > 0
      ? input.id.trim()
      : `surface-${now.toString(36)}`;
  const existing = store.surfaces.find((entry) => entry.id === id);
  const next: SurfaceRecord = {
    id,
    channel: input.channel.trim(),
    accountId: input.accountId.trim(),
    label: input.label.trim(),
    ownerKind: input.ownerKind,
    ownerId: input.ownerKind === "agent" ? input.ownerId?.trim() : undefined,
    active: typeof input.active === "boolean" ? input.active : (existing?.active ?? true),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: input.metadata ?? existing?.metadata,
  };
  saveRuntimeUserConsoleStore(
    {
      ...store,
      surfaces: upsertById(store.surfaces, next),
    },
    opts,
  );
  return next;
}

export function upsertRuntimeSurfaceRoleOverlay(
  input: SurfaceRoleOverlayUpsertInput,
  opts: RuntimeStoreOptions = {},
): SurfaceRoleOverlay {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  if (!store.surfaces.some((entry) => entry.id === input.surfaceId)) {
    throw new Error("surfaceId must reference an existing surface");
  }
  const existing = store.surfaceRoleOverlays.find(
    (entry) => entry.id === input.id || entry.surfaceId === input.surfaceId,
  );
  const next: SurfaceRoleOverlay = {
    id:
      typeof input.id === "string" && input.id.trim().length > 0
        ? input.id.trim()
        : (existing?.id ?? `surface-role-${input.surfaceId}`),
    surfaceId: input.surfaceId,
    role: input.role.trim(),
    businessGoal:
      typeof input.businessGoal === "string"
        ? input.businessGoal.trim() || undefined
        : existing?.businessGoal,
    tone: typeof input.tone === "string" ? input.tone.trim() || undefined : existing?.tone,
    initiative:
      input.initiative === "low" || input.initiative === "medium" || input.initiative === "high"
        ? input.initiative
        : existing?.initiative,
    allowedTopics: Array.isArray(input.allowedTopics)
      ? input.allowedTopics.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : (existing?.allowedTopics ?? []),
    restrictedTopics: Array.isArray(input.restrictedTopics)
      ? input.restrictedTopics.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : (existing?.restrictedTopics ?? []),
    reportTarget:
      typeof input.reportTarget === "string"
        ? input.reportTarget.trim() || undefined
        : existing?.reportTarget,
    localBusinessPolicy: input.localBusinessPolicy ?? existing?.localBusinessPolicy,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: input.metadata ?? existing?.metadata,
  };
  saveRuntimeUserConsoleStore(
    {
      ...store,
      surfaceRoleOverlays: upsertById(store.surfaceRoleOverlays, next),
    },
    opts,
  );
  return next;
}
