export const ADMIN_SCOPE = "operator.admin" as const;
export const READ_SCOPE = "operator.read" as const;
export const WRITE_SCOPE = "operator.write" as const;
export const APPROVALS_SCOPE = "operator.approvals" as const;
export const PAIRING_SCOPE = "operator.pairing" as const;

export type OperatorScope =
  | typeof ADMIN_SCOPE
  | typeof READ_SCOPE
  | typeof WRITE_SCOPE
  | typeof APPROVALS_SCOPE
  | typeof PAIRING_SCOPE;

export const CLI_DEFAULT_OPERATOR_SCOPES: OperatorScope[] = [
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
];

const NODE_ROLE_METHODS = new Set([
  "node.invoke.result",
  "node.event",
  "node.pending.drain",
  "node.canvas.capability.refresh",
  "node.pending.pull",
  "node.pending.ack",
  "skills.bins",
]);

const METHOD_SCOPE_GROUPS: Record<OperatorScope, readonly string[]> = {
  [APPROVALS_SCOPE]: [
    "exec.approval.request",
    "exec.approval.waitDecision",
    "exec.approval.resolve",
  ],
  [PAIRING_SCOPE]: [
    "node.pair.request",
    "node.pair.list",
    "node.pair.approve",
    "node.pair.reject",
    "node.pair.verify",
    "device.pair.list",
    "device.pair.approve",
    "device.pair.reject",
    "device.pair.remove",
    "device.token.rotate",
    "device.token.revoke",
    "node.rename",
  ],
  [READ_SCOPE]: [
    "health",
    "doctor.memory.status",
    "logs.tail",
    "desktop.getBootstrapState",
    "desktop.getShellSnapshot",
    "desktop.getRuntimeProcessState",
    "desktop.openLogs",
    "channels.status",
    "status",
    "usage.status",
    "usage.cost",
    "tts.status",
    "tts.providers",
    "models.list",
    "tools.catalog",
    "agents.list",
    "agent.identity.get",
    "skills.status",
    "voicewake.get",
    "sessions.list",
    "sessions.get",
    "sessions.preview",
    "sessions.resolve",
    "sessions.usage",
    "sessions.usage.timeseries",
    "sessions.usage.logs",
    "cron.list",
    "cron.status",
    "cron.runs",
    "runtime.snapshot",
    "runtime.getDashboard",
    "runtime.getHealth",
    "runtime.tasks.list",
    "runtime.getTask",
    "runtime.memory.list",
    "runtime.listMemories",
    "runtime.listStrategies",
    "runtime.user.get",
    "runtime.user.console.detail",
    "runtime.user.model.optimization.list",
    "runtime.role.optimization.list",
    "runtime.agents.list",
    "runtime.surfaces.list",
    "runtime.retrieval.status",
    "runtime.intel.status",
    "runtime.capabilities.status",
    "runtime.getGovernanceState",
    "runtime.evolution.status",
    "runtime.listEvolutionCandidates",
    "runtime.getSettings",
    "runtime.import.preview",
    "federation.status",
    "runtime.getFederationState",
    "federation.inbox.list",
    "gateway.identity.get",
    "system-presence",
    "last-heartbeat",
    "node.list",
    "node.describe",
    "chat.history",
    "config.get",
    "config.schema.lookup",
    "talk.config",
    "agents.files.list",
    "agents.files.get",
  ],
  [WRITE_SCOPE]: [
    "send",
    "poll",
    "agent",
    "agent.wait",
    "wake",
    "talk.mode",
    "tts.enable",
    "tts.disable",
    "tts.convert",
    "tts.setProvider",
    "voicewake.set",
    "node.invoke",
    "chat.send",
    "chat.abort",
    "browser.request",
    "push.test",
    "node.pending.enqueue",
  ],
  [ADMIN_SCOPE]: [
    "desktop.initializeInstance",
    "desktop.restartRuntime",
    "channels.logout",
    "agents.create",
    "agents.update",
    "agents.delete",
    "skills.install",
    "skills.update",
    "secrets.reload",
    "secrets.resolve",
    "cron.add",
    "cron.update",
    "cron.remove",
    "cron.run",
    "runtime.import.apply",
    "runtime.tick",
    "runtime.user.update",
    "runtime.user.mirror.sync",
    "runtime.user.mirror.import",
    "runtime.user.model.optimization.review",
    "runtime.user.console.maintenance.configure",
    "runtime.user.console.maintenance.review",
    "runtime.user.model.optimization.adopt",
    "runtime.user.model.optimization.reject",
    "runtime.role.optimization.review",
    "runtime.role.optimization.adopt",
    "runtime.role.optimization.reject",
    "runtime.user.session.list",
    "runtime.user.session.upsert",
    "runtime.user.session.delete",
    "runtime.user.preferences.resolve",
    "runtime.agent.upsert",
    "runtime.agent.delete",
    "runtime.surface.upsert",
    "runtime.surface.role.upsert",
    "runtime.tasks.configure",
    "runtime.task.upsert",
    "runtime.task.plan",
    "runtime.task.retry",
    "runtime.task.cancel",
    "runtime.task.waiting_user.respond",
    "runtime.task.result.apply",
    "runtime.memory.invalidate",
    "runtime.memory.configure",
    "runtime.memory.review",
    "runtime.memory.rollback",
    "runtime.memory.reinforce",
    "runtime.intel.refresh",
    "runtime.intel.delivery.dispatch",
    "runtime.intel.pin",
    "runtime.intel.configure",
    "runtime.intel.source.upsert",
    "runtime.intel.source.delete",
    "runtime.intel.pipeline.run",
    "runtime.capabilities.sync",
    "runtime.capabilities.entry.set",
    "runtime.capabilities.mcp.grant.set",
    "runtime.evolution.configure",
    "runtime.evolution.run",
    "runtime.evolution.candidate.set",
    "runtime.evolution.candidate.verification.ack",
    "runtime.evolution.adopt",
    "runtime.evolution.reject",
    "runtime.evolution.revert",
    "federation.inbox.maintenance.configure",
    "federation.inbox.maintenance.review",
    "federation.push.configure",
    "federation.inbox.sync",
    "federation.package.transition",
    "federation.coordinator-suggestion.materialize",
    "federation.assignment.transition",
    "federation.assignment.materialize",
    "federation.outbox.sync",
    "runtime.federation.sync",
    "federation.remote.maintenance.configure",
    "federation.remote.preview",
    "federation.remote.sync",
    "sessions.patch",
    "sessions.reset",
    "sessions.delete",
    "sessions.compact",
    "connect",
    "chat.inject",
    "web.login.start",
    "web.login.wait",
    "set-heartbeats",
    "system-event",
    "agents.files.set",
  ],
};

const ADMIN_METHOD_PREFIXES = ["exec.approvals.", "config.", "wizard.", "update."] as const;

const METHOD_SCOPE_BY_NAME = new Map<string, OperatorScope>(
  Object.entries(METHOD_SCOPE_GROUPS).flatMap(([scope, methods]) =>
    methods.map((method) => [method, scope as OperatorScope]),
  ),
);

function resolveScopedMethod(method: string): OperatorScope | undefined {
  const explicitScope = METHOD_SCOPE_BY_NAME.get(method);
  if (explicitScope) {
    return explicitScope;
  }
  if (ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return ADMIN_SCOPE;
  }
  return undefined;
}

export function isApprovalMethod(method: string): boolean {
  return resolveScopedMethod(method) === APPROVALS_SCOPE;
}

export function isPairingMethod(method: string): boolean {
  return resolveScopedMethod(method) === PAIRING_SCOPE;
}

export function isReadMethod(method: string): boolean {
  return resolveScopedMethod(method) === READ_SCOPE;
}

export function isWriteMethod(method: string): boolean {
  return resolveScopedMethod(method) === WRITE_SCOPE;
}

export function isNodeRoleMethod(method: string): boolean {
  return NODE_ROLE_METHODS.has(method);
}

export function isAdminOnlyMethod(method: string): boolean {
  return resolveScopedMethod(method) === ADMIN_SCOPE;
}

export function resolveRequiredOperatorScopeForMethod(method: string): OperatorScope | undefined {
  return resolveScopedMethod(method);
}

export function resolveLeastPrivilegeOperatorScopesForMethod(method: string): OperatorScope[] {
  const requiredScope = resolveRequiredOperatorScopeForMethod(method);
  if (requiredScope) {
    return [requiredScope];
  }
  // Default-deny for unclassified methods.
  return [];
}

export function authorizeOperatorScopesForMethod(
  method: string,
  scopes: readonly string[],
): { allowed: true } | { allowed: false; missingScope: OperatorScope } {
  if (scopes.includes(ADMIN_SCOPE)) {
    return { allowed: true };
  }
  const requiredScope = resolveRequiredOperatorScopeForMethod(method) ?? ADMIN_SCOPE;
  if (requiredScope === READ_SCOPE) {
    if (scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE)) {
      return { allowed: true };
    }
    return { allowed: false, missingScope: READ_SCOPE };
  }
  if (scopes.includes(requiredScope)) {
    return { allowed: true };
  }
  return { allowed: false, missingScope: requiredScope };
}

export function isGatewayMethodClassified(method: string): boolean {
  if (isNodeRoleMethod(method)) {
    return true;
  }
  return resolveRequiredOperatorScopeForMethod(method) !== undefined;
}
